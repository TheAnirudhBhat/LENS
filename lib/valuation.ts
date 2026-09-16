/**
 * lib/valuation.ts — THE single source of truth for portfolio money.
 *
 * Every rupee figure in LENS (net worth, per-asset-class value, per-role value,
 * invested/cost basis, P&L, allocation weights, drift) is a sum over a filtered
 * set of normalized `CanonHolding`s produced here. No surface re-derives a
 * formula: Overview, Allocation, the silo tabs, /api/score, /api/sync and the
 * per-ticker drawer all project this one `Book`.
 *
 * Data path: enrichSilos() (lib/enrich.ts — the ONE enrichment pass) → normalize
 * to CanonHolding[] (the §A inclusion table) → aggregate() (buckets + totals +
 * weights + drift). Classification reuses lib/book.ts (bucketOf) and the role
 * taxonomy in lib/allocation.ts (no duplication).
 *
 * Server-side only.
 */
import { bucketOf } from "./book";
import {
  type Role,
  ROLE_ORDER,
  DISPLAY_ROLE_ORDER,
  ROLE_TARGET,
  isCashEquivalentMF,
  driftStatusFor,
  fallbackRoleFromExisting,
} from "./roles";
import { getMeta } from "./tickerMeta";
import { enrichSilos, type EnrichedSilos, type Silo } from "./enrich";

export type AssetClass =
  | "in-equity"
  | "us-equity"
  | "mf"
  | "bonds"
  | "metals"
  | "cash";

export type RoleTargets = Record<
  Exclude<Role, "unclassified">,
  { target: number; band: [number, number] }
>;

export type CanonHolding = {
  id: string; // `${silo}:${ticker}`
  silo: Silo;
  ticker: string;
  company: string;
  assetClass: AssetClass;
  role: Role;
  qty: number | null;
  invested: number | null; // cost basis INR, null when unknown
  value: number; // current value INR (enriched)
  hasCost: boolean;
  pnlAbs: number | null; // value - invested when hasCost
  pnlPct: number | null;
  source: "live" | "raw";
  thesisHealth?: "green" | "amber" | "red";
};

export type Bucket<K extends string> = {
  key: K;
  value: number;
  invested: number;
  pnlAbs: number;
  weightPct: number;
  holdings: CanonHolding[];
};

export type RoleBucket = Bucket<Role> & {
  targetPct: number;
  band: [number, number];
  drift: number;
  driftStatus: "ok" | "soft" | "hard";
};

export type Totals = {
  netWorth: number;
  value: number;
  invested: number;
  pnlAbs: number;
  pnlPct: number;
  cashValue: number;
  allocatedValue: number; // netWorth - cashValue (donut denominator)
};

export type Book = {
  asOf: string;
  live: boolean;
  holdings: CanonHolding[];
  byAssetClass: Record<AssetClass, Bucket<AssetClass>>;
  byRole: RoleBucket[]; // DISPLAY_ROLE_ORDER, unclassified last
  totals: Totals;
  provenance: Record<Exclude<Silo, "CASH">, "live" | "raw">;
};

const ASSET_CLASSES: AssetClass[] = [
  "in-equity",
  "us-equity",
  "mf",
  "bonds",
  "metals",
  "cash",
];

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// Normalization — the §A per-silo inclusion rules. This is the ONLY place a
// silo row becomes a CanonHolding; every downstream number sums these.
// ─────────────────────────────────────────────────────────────────────────────
function normalize(silos: EnrichedSilos): CanonHolding[] {
  const out: CanonHolding[] = [];
  const src = silos.sources;

  // IN snapshot: equity + metals + Kite-demat (transferred) SDI bonds.
  // assetClass via bucketOf; role from the snapshot's authoritative tag.
  for (const h of silos.snapshot.holdings ?? []) {
    if ((h.market ?? "IN") !== "IN") continue;
    const assetClass = bucketOf(h) as AssetClass; // in-equity | bonds | metals | cash
    if (assetClass === "cash") continue; // cash handled from snapshot.cash below
    const value = h.value ?? 0;
    const invested =
      h.avgPrice && h.avgPrice > 0 ? round2(h.avgPrice * h.qty) : null;
    const meta = getMeta(h.ticker);
    out.push({
      id: `IN:${h.ticker}`,
      silo: "IN",
      ticker: h.ticker,
      company: meta.name || h.ticker,
      assetClass,
      role: fallbackRoleFromExisting(h.role ?? undefined) ?? "unclassified",
      qty: h.qty,
      invested,
      value,
      hasCost: invested != null,
      pnlAbs: invested != null ? round2(value - invested) : null,
      pnlPct: invested != null && invested > 0 ? round2(((value - invested) / invested) * 100) : null,
      source: src.IN,
      thesisHealth: h.thesisHealth,
    });
  }

  // US
  for (const p of silos.us?.positions ?? []) {
    const invested = p.investedINR ?? null;
    const value = p.currentINR ?? 0;
    out.push({
      id: `US:${p.ticker}`,
      silo: "US",
      ticker: p.ticker,
      company: p.name ?? p.ticker,
      assetClass: "us-equity",
      role: fallbackRoleFromExisting(p.role ?? undefined) ?? "unclassified",
      qty: p.quantity ?? null,
      invested,
      value,
      hasCost: invested != null && invested > 0,
      pnlAbs: invested != null ? round2(value - invested) : null,
      pnlPct: invested && invested > 0 ? round2(((value - invested) / invested) * 100) : null,
      source: src.US,
      thesisHealth: p.thesisHealth,
    });
  }

  // MF — skip zero/negative-value phantom rows (unparsed "Value:" blocks).
  for (const e of silos.mf.entries ?? []) {
    const value = e.value ?? 0;
    if (value <= 0) continue;
    const invested = e.invested && e.invested > 0 ? e.invested : null;
    const role: Role = isCashEquivalentMF(e.scheme, e.category)
      ? "debt-equiv"
      : fallbackRoleFromExisting(e.role) ?? "unclassified";
    out.push({
      id: `MF:${e.ticker ?? e.scheme}`,
      silo: "MF",
      ticker: e.ticker ?? e.scheme,
      company: e.scheme,
      assetClass: "mf",
      role,
      qty: e.units ?? null,
      invested,
      value,
      hasCost: invested != null,
      pnlAbs: invested != null ? round2(value - invested) : null,
      pnlPct: invested != null && invested > 0 ? round2(((value - invested) / invested) * 100) : null,
      source: src.MF,
      thesisHealth: e.thesisHealth,
    });
  }

  // Stable-Money ACTIVE + REDEEMING bonds (transferred already counted in the
  // snapshot; matured are history). Active = per-position currentINR (cost +
  // accrued — private SDIs have no market quote), else invested basis.
  // Redeeming = units already extinguished from the demat ahead of maturity
  // with principal still owed; carried at the receivable so net worth doesn't
  // dip between demat-debit and payout (Indel Aug'26, ~Rs10K, 2026-08-05).
  for (const p of silos.bonds.positions ?? []) {
    if (p.status !== "active" && p.status !== "redeeming") continue;
    const invested = p.investedINR ?? null;
    const value =
      (p.status === "redeeming" ? p.redemptionReceivableINR : undefined) ??
      p.currentINR ??
      p.investedINR ??
      0;
    out.push({
      id: `BONDS:${p.isin}`,
      silo: "BONDS",
      ticker: p.isin,
      company: p.name,
      assetClass: "bonds",
      role: fallbackRoleFromExisting(p.role) ?? "debt-equiv",
      qty: p.units ?? null,
      invested,
      value,
      hasCost: invested != null,
      pnlAbs: invested != null ? round2(value - invested) : null,
      pnlPct: invested && invested > 0 ? round2(((value - invested) / invested) * 100) : null,
      source: "raw",
    });
  }

  // Cash — snapshot.cash (raw), pnl 0.
  const cash = silos.snapshot.cash ?? 0;
  if (cash > 0) {
    out.push({
      id: "CASH:cash",
      silo: "CASH",
      ticker: "CASH",
      company: "Cash float",
      assetClass: "cash",
      role: "cash",
      qty: null,
      invested: cash,
      value: cash,
      hasCost: true,
      pnlAbs: 0,
      pnlPct: 0,
      source: "raw",
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation — pure. Buckets + totals + weights + role drift. No IO.
// ─────────────────────────────────────────────────────────────────────────────
export function aggregate(
  holdings: CanonHolding[],
  roleTargets: RoleTargets
): {
  byAssetClass: Book["byAssetClass"];
  byRole: RoleBucket[];
  totals: Totals;
} {
  const value = round2(holdings.reduce((s, h) => s + h.value, 0));
  const invested = round2(
    holdings.filter((h) => h.hasCost).reduce((s, h) => s + (h.invested ?? 0), 0)
  );
  const pnlAbs = round2(
    holdings.filter((h) => h.hasCost).reduce((s, h) => s + (h.pnlAbs ?? 0), 0)
  );
  const cashValue = round2(
    holdings.filter((h) => h.assetClass === "cash").reduce((s, h) => s + h.value, 0)
  );
  const netWorth = value;
  const totals: Totals = {
    netWorth,
    value,
    invested,
    pnlAbs,
    pnlPct: invested > 0 ? round2((pnlAbs / invested) * 100) : 0,
    cashValue,
    allocatedValue: round2(netWorth - cashValue),
  };

  // Asset-class buckets
  const byAssetClass = {} as Book["byAssetClass"];
  for (const c of ASSET_CLASSES) {
    const hs = holdings.filter((h) => h.assetClass === c);
    const v = round2(hs.reduce((s, h) => s + h.value, 0));
    byAssetClass[c] = {
      key: c,
      value: v,
      invested: round2(hs.filter((h) => h.hasCost).reduce((s, h) => s + (h.invested ?? 0), 0)),
      pnlAbs: round2(hs.filter((h) => h.hasCost).reduce((s, h) => s + (h.pnlAbs ?? 0), 0)),
      weightPct: netWorth > 0 ? round2((v / netWorth) * 100) : 0,
      holdings: hs,
    };
  }

  // Role buckets (DISPLAY order; unclassified last, no target/band)
  const byRole: RoleBucket[] = [];
  for (const role of DISPLAY_ROLE_ORDER) {
    const hs = holdings.filter((h) => h.role === role);
    if (role === "unclassified" && hs.length === 0) continue;
    const v = round2(hs.reduce((s, h) => s + h.value, 0));
    const weightPct = netWorth > 0 ? round2((v / netWorth) * 100) : 0;
    const t =
      role === "unclassified"
        ? { target: 0, band: [0, 0] as [number, number] }
        : roleTargets[role];
    byRole.push({
      key: role,
      value: v,
      invested: round2(hs.filter((h) => h.hasCost).reduce((s, h) => s + (h.invested ?? 0), 0)),
      pnlAbs: round2(hs.filter((h) => h.hasCost).reduce((s, h) => s + (h.pnlAbs ?? 0), 0)),
      weightPct,
      holdings: hs.slice().sort((a, b) => b.value - a.value),
      targetPct: t.target,
      band: t.band,
      drift: round2(weightPct - t.target),
      driftStatus: role === "unclassified" ? "ok" : driftStatusFor(weightPct, t.band),
    });
  }

  return { byAssetClass, byRole, totals };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildBook — THE entry point. Reads files, enriches ONCE, normalizes, aggregates.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildBook(opts?: {
  live?: boolean;
  budgetMs?: number;
  roleTargets?: RoleTargets;
}): Promise<Book> {
  const silos = await enrichSilos({ live: opts?.live, budgetMs: opts?.budgetMs });
  const roleTargets = opts?.roleTargets ?? ROLE_TARGET;
  const holdings = normalize(silos);
  const { byAssetClass, byRole, totals } = aggregate(holdings, roleTargets);
  return {
    asOf: silos.asOf,
    live: Object.values(silos.sources).some((s) => s === "live"),
    holdings,
    byAssetClass,
    byRole,
    totals,
    provenance: silos.sources,
  };
}

// Re-export role order for consumers projecting the book.
export { ROLE_ORDER, DISPLAY_ROLE_ORDER };
