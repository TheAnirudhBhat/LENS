/**
 * Allocation aggregation helpers.
 *
 * Loads every silo (snapshot, US stocks, MF markdown, bonds) and rolls
 * them up by strategic role bucket. Role taxonomy is locked in
 * strategy_role_taxonomy.md and the SAA bands in strategy_asset_allocation.md.
 *
 * Server-side only; uses node:fs/promises via paths in lib/paths.ts.
 */
import { readFile } from "node:fs/promises";
import {
  SNAPSHOT_FILE,
  US_STOCKS_FILE,
  MUTUAL_FUNDS_FILE,
  BONDS_FILE,
} from "./paths";
import { parseMutualFunds } from "./parsers";
import { getMeta } from "./tickerMeta";
import { resolveFx } from "./fx";

export type Role =
  | "compounders"
  | "growth"
  | "cyclicals"
  | "defensives"
  | "hedges"
  | "debt-equiv"
  | "cash"
  // Holdings present in a silo but lacking a strategic-role tag. They ARE
  // counted in the total denominator (so weights are honest) but have no SAA
  // target — surfaced so the user can go tag them.
  | "unclassified";

// Strategic roles that carry SAA targets / bands. "unclassified" is excluded:
// it is a catch-all, not a target bucket.
export const ROLE_ORDER: Role[] = [
  "compounders",
  "growth",
  "cyclicals",
  "defensives",
  "hedges",
  "debt-equiv",
  "cash",
];

// Display order including the catch-all. Unclassified renders last.
export const DISPLAY_ROLE_ORDER: Role[] = [...ROLE_ORDER, "unclassified"];

export const ROLE_TARGET: Record<Exclude<Role, "unclassified">, { target: number; band: [number, number] }> = {
  compounders: { target: 30, band: [25, 35] },
  growth: { target: 25, band: [20, 30] },
  cyclicals: { target: 15, band: [10, 20] },
  defensives: { target: 10, band: [5, 15] },
  hedges: { target: 5, band: [3, 8] },
  "debt-equiv": { target: 15, band: [10, 20] },
  cash: { target: 0, band: [0, 3] },
};

export type AllocationHolding = {
  ticker: string;
  company: string;
  market: "IN" | "US" | "MF" | "BONDS" | "CASH";
  valueINR: number;
  weightPct: number;
  pnlPct: number;
  thesisHealth?: "green" | "amber" | "red";
  role: Role;
};

export type RoleBucket = {
  role: Role;
  valueINR: number;
  weightPct: number;
  targetPct: number;
  band: [number, number];
  drift: number;
  driftStatus: "ok" | "soft" | "hard";
  holdings: AllocationHolding[];
};

export type AllocationPayload = {
  total: number;
  roles: RoleBucket[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function readJSON<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRole(s: string | undefined): s is Role {
  if (!s) return false;
  return (ROLE_ORDER as string[]).includes(s);
}

function fallbackRoleFromExisting(raw?: string): Role | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (isRole(lower)) return lower as Role;
  return undefined;
}

// Cash-equivalent MF schemes — arbitrage, liquid, overnight, money-market —
// behave like debt for SAA/role math (low beta, ~repo-rate returns) even though
// arbitrage funds are equity-taxed. Bucketing them as "growth"/"compounders"
// (whatever the markdown tagged) overstates equity exposure and skews live
// rebalance decisions. Name-based, so no new data is needed.
const CASH_EQUIVALENT_MF_RE = /arbitrage|liquid|overnight|money\s*market/i;

/**
 * True when a mutual-fund scheme is a cash-equivalent (debt-bucket) fund based
 * on its name and/or category text. Exported so the book builder uses the same
 * rule.
 */
export function isCashEquivalentMF(
  name?: string,
  category?: string,
): boolean {
  return CASH_EQUIVALENT_MF_RE.test(`${name ?? ""} ${category ?? ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────

type SnapshotHolding = {
  ticker: string;
  qty?: number;
  ltp?: number;
  value?: number;
  weight?: number;
  pnlPct?: number;
  role?: string;
  thesisHealth?: "green" | "amber" | "red";
  market?: "IN" | "US";
};

type SnapshotFile = {
  cash?: number;
  holdings?: SnapshotHolding[];
};

async function loadFromSnapshot(): Promise<{
  rows: AllocationHolding[];
  cash: number;
}> {
  const snap = await readJSON<SnapshotFile>(SNAPSHOT_FILE);
  const rows: AllocationHolding[] = [];
  if (!snap?.holdings) return { rows, cash: snap?.cash ?? 0 };
  for (const h of snap.holdings) {
    // Untagged holdings go to "unclassified" (counted in the total) rather than
    // being dropped — dropping them silently shrank the denominator and inflated
    // every other weight.
    const r = fallbackRoleFromExisting(h.role) ?? "unclassified";
    const meta = getMeta(h.ticker);
    rows.push({
      ticker: h.ticker,
      company: meta.name || h.ticker,
      market: "IN",
      valueINR: h.value ?? 0,
      weightPct: 0,
      pnlPct: h.pnlPct ?? 0,
      thesisHealth: h.thesisHealth,
      role: r,
    });
  }
  return { rows, cash: snap?.cash ?? 0 };
}

type USPosition = {
  ticker: string;
  name?: string;
  quantity?: number;
  currentPriceUSD?: number;
  currentINR?: number;
  pnlPct?: number;
  thesisHealth?: "green" | "amber" | "red";
  role?: string;
};
type USFile = { positions?: USPosition[]; fx?: { usdInr?: number | null; asOf?: string } };

async function loadFromUS(): Promise<AllocationHolding[]> {
  const us = await readJSON<USFile>(US_STOCKS_FILE);
  if (!us?.positions) return [];
  // Prefer the live rate (persisting it through for future loads); fall back to
  // the last-known stored rate. resolveFx throws if neither exists — a loud
  // error beats silently assuming 1:1 and understating the US silo ~95x.
  const fx = resolveFx(us.fx?.usdInr, us.fx?.asOf);
  const rows: AllocationHolding[] = [];
  for (const p of us.positions) {
    const r = fallbackRoleFromExisting(p.role) ?? "unclassified";
    const valueINR =
      p.currentINR ?? (p.currentPriceUSD ?? 0) * (p.quantity ?? 0) * fx;
    rows.push({
      ticker: p.ticker,
      company: p.name ?? p.ticker,
      market: "US",
      valueINR,
      weightPct: 0,
      pnlPct: p.pnlPct ?? 0,
      thesisHealth: p.thesisHealth,
      role: r,
    });
  }
  return rows;
}

async function loadFromMF(): Promise<AllocationHolding[]> {
  const md = await readFile(MUTUAL_FUNDS_FILE, "utf8").catch(() => "");
  if (!md) return [];
  const summary = parseMutualFunds(md);
  const rows: AllocationHolding[] = [];
  for (const e of summary.entries) {
    const valueINR = e.value ?? 0;
    // Skip zero/negative-value schemes — entries whose markdown block has no
    // parseable "Value:" line (e.g. a switched fund's "Current Value:" after a
    // Regular→Direct switch) would otherwise become phantom 0-value/0-weight
    // holdings rows.
    if (valueINR <= 0) continue;
    // Cash-equivalent funds (arbitrage / liquid / overnight / money-market)
    // are forced into the debt bucket regardless of how the markdown tagged
    // them — otherwise an "Arbitrage Fund" parked in a growth role would
    // overstate equity for SAA. Otherwise honor the tag, falling back to
    // "unclassified" so untagged funds still count toward the total.
    const role: Role = isCashEquivalentMF(e.scheme, e.category)
      ? "debt-equiv"
      : fallbackRoleFromExisting(e.role) ?? "unclassified";
    rows.push({
      ticker: e.ticker ?? e.scheme,
      company: e.scheme,
      market: "MF",
      valueINR,
      weightPct: 0,
      pnlPct: e.pnlPct ?? 0,
      thesisHealth: e.thesisHealth,
      role,
    });
  }
  return rows;
}

type BondPosition = {
  isin: string;
  name: string;
  issuer?: string;
  units?: number;
  investedINR?: number;
  status?: "active" | "matured";
  role?: string;
};
type BondsFile = { positions?: BondPosition[] };

async function loadFromBonds(): Promise<AllocationHolding[]> {
  const bonds = await readJSON<BondsFile>(BONDS_FILE);
  if (!bonds?.positions) return [];
  const rows: AllocationHolding[] = [];
  for (const p of bonds.positions) {
    if (p.status === "matured") continue;
    const r = fallbackRoleFromExisting(p.role) ?? "debt-equiv";
    rows.push({
      ticker: p.isin,
      company: p.name,
      market: "BONDS",
      valueINR: p.investedINR ?? 0,
      weightPct: 0,
      pnlPct: 0,
      role: r,
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation
// ─────────────────────────────────────────────────────────────────────────────

function driftStatusFor(
  weight: number,
  band: [number, number],
): "ok" | "soft" | "hard" {
  const [lo, hi] = band;
  if (weight >= lo && weight <= hi) return "ok";
  const edge = weight < lo ? lo - weight : weight - hi;
  if (edge <= 2) return "soft";
  return "hard";
}

export async function loadAllocation(
  roleTargets: Record<Exclude<Role, "unclassified">, { target: number; band: [number, number] }> = ROLE_TARGET
): Promise<AllocationPayload> {
  const [snap, us, mf, bonds] = await Promise.all([
    loadFromSnapshot(),
    loadFromUS(),
    loadFromMF(),
    loadFromBonds(),
  ]);

  // Snapshot already includes IN equity holdings + the SDI bonds that live in
  // Kite. The bonds.json file is the Stable Bonds platform; rows there are a
  // separate silo with no overlap.
  // Filter snapshot to skip its bond rows (those have role "debt-equiv" and
  // are tracked in book as direct SDI holdings, not part of equity tabs).
  // For the allocation view, snapshot debt-equiv (Kite SDI bonds) + bonds.json
  // active rows = total debt-equiv from positions.
  const all: AllocationHolding[] = [
    ...snap.rows,
    ...us,
    ...mf,
    ...bonds,
  ];

  // Cash bucket from snapshot.cash
  if (snap.cash && snap.cash > 0) {
    all.push({
      ticker: "CASH",
      company: "Cash float",
      market: "CASH",
      valueINR: snap.cash,
      weightPct: 0,
      pnlPct: 0,
      role: "cash",
    });
  }

  const total = all.reduce((s, r) => s + (r.valueINR || 0), 0);
  for (const r of all) {
    r.weightPct = total > 0 ? (r.valueINR / total) * 100 : 0;
  }

  // Group over the DISPLAY order (includes "unclassified") so an untagged
  // holding never lands on an undefined bucket.
  const grouped = new Map<Role, AllocationHolding[]>();
  for (const role of DISPLAY_ROLE_ORDER) grouped.set(role, []);
  for (const r of all) {
    grouped.get(r.role)!.push(r);
  }

  let roles: RoleBucket[] = ROLE_ORDER.map((role) => {
    const holdings = (grouped.get(role) ?? []).slice().sort(
      (a, b) => b.valueINR - a.valueINR,
    );
    const valueINR = holdings.reduce((s, h) => s + h.valueINR, 0);
    const weightPct = total > 0 ? (valueINR / total) * 100 : 0;
    // "unclassified" is the overflow bucket: counted in totals, no target band.
    const { target, band } =
      role === "unclassified"
        ? { target: 0, band: [0, 0] as [number, number] }
        : roleTargets[role];
    const drift = weightPct - target;
    const driftStatus = driftStatusFor(weightPct, band);
    return {
      role,
      valueINR,
      weightPct,
      targetPct: target,
      band,
      drift,
      driftStatus,
      holdings,
    };
  });

  // Append the catch-all bucket only when it actually holds something. It has
  // no SAA target, so target/band are 0 and drift is reported as "ok" (the UI
  // renders it as "untagged — assign a role", not as over/underweight).
  const unclassifiedHoldings = (grouped.get("unclassified") ?? [])
    .slice()
    .sort((a, b) => b.valueINR - a.valueINR);
  if (unclassifiedHoldings.length > 0) {
    const valueINR = unclassifiedHoldings.reduce((s, h) => s + h.valueINR, 0);
    const weightPct = total > 0 ? (valueINR / total) * 100 : 0;
    roles = [
      ...roles,
      {
        role: "unclassified",
        valueINR,
        weightPct,
        targetPct: 0,
        band: [0, 0],
        drift: 0,
        driftStatus: "ok",
        holdings: unclassifiedHoldings,
      },
    ];
  }

  return { total, roles };
}
