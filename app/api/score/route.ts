import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_DIR,
  SNAPSHOT_FILE,
  US_STOCKS_FILE,
  MUTUAL_FUNDS_FILE,
  BONDS_FILE,
  PORTFOLIO_HISTORY_FILE,
} from "@/lib/paths";
import { getMeta } from "@/lib/tickerMeta";
import { parseMutualFunds } from "@/lib/parsers";
import { resolveFx } from "@/lib/fx";
import {
  computePortfolioScore,
  type ScoreInput,
  type ScorePosition,
  type ScoreMFScheme,
} from "@/lib/portfolioScore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MF_XRAY_FILE = path.join(MEMORY_DIR, "mf_xray.json");

// Cash-equivalent MF categories — these are NOT equity (they sit in the debt /
// ballast slot per SAA R2). Kept local + name-based so no new data is needed.
const BALLAST_RE = /arbitrage|liquid|overnight|money\s*market/i;

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

type SnapshotHolding = {
  ticker: string;
  value?: number;
  weight?: number;
  pnlPct?: number;
  role?: string;
  sector?: string;
  market?: "IN" | "US";
};
type SnapshotFile = { asOf?: string; cash?: number; holdings?: SnapshotHolding[] };

type USPosition = {
  ticker: string;
  name?: string;
  quantity?: number;
  currentPriceUSD?: number;
  currentINR?: number;
  pnlPct?: number;
  role?: string;
  sector?: string;
};
type USFile = {
  fetchedAt?: string;
  positions?: USPosition[];
  fx?: { usdInr?: number | null; asOf?: string };
};

type BondPosition = {
  isin: string;
  name?: string;
  investedINR?: number;
  status?: "active" | "matured";
};
type BondsFile = { positions?: BondPosition[] };

type XrayScheme = { ter?: string | number; category?: string; valueINR?: number };
type XrayFile = {
  schemes?: Record<string, XrayScheme>;
  overlapPairs?: Record<string, { pct?: number }>;
};

type HistoryEntry = { date?: string; cashInjection?: number | null };
type HistoryFile = HistoryEntry[] | { history?: HistoryEntry[] };

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Snapshot rows carry IN equity, gold/silver ETFs, and Kite SDI bonds together.
// Split them the same way the Book builder classifies assets so the SAA buckets
// (equity vs gold vs debt) stay honest.
function snapAssetKind(ticker: string): "gold" | "bond" | "equity" {
  if (/gold|silver|metal/i.test(ticker)) return "gold";
  const asset = getMeta(ticker).asset;
  if (asset === "bond") return "bond";
  if (asset === "etf" && /gold|silver|metal/i.test(ticker)) return "gold";
  return "equity";
}

export async function GET() {
  try {
    const [snap, us, mfText, bonds, xray, history] = await Promise.all([
      readJson<SnapshotFile>(SNAPSHOT_FILE),
      readJson<USFile>(US_STOCKS_FILE),
      readFile(MUTUAL_FUNDS_FILE, "utf8").catch(() => ""),
      readJson<BondsFile>(BONDS_FILE),
      readJson<XrayFile>(MF_XRAY_FILE),
      readJson<HistoryFile>(PORTFOLIO_HISTORY_FILE),
    ]);

    const positions: ScorePosition[] = [];
    const buckets = {
      inEquity: 0,
      usEquity: 0,
      mf: 0,
      bonds: 0,
      metals: 0,
      cash: 0,
    };

    // ── Snapshot: IN equity + gold/silver + Kite SDI bonds ──────────────────
    for (const h of snap?.holdings ?? []) {
      const value = toNum(h.value) ?? 0;
      if (value <= 0) continue;
      const kind = snapAssetKind(h.ticker);
      if (kind === "gold") buckets.metals += value;
      else if (kind === "bond") buckets.bonds += value;
      else buckets.inEquity += value;
      positions.push({
        ticker: h.ticker,
        name: getMeta(h.ticker).name,
        market: kind === "bond" ? "BONDS" : "IN",
        role: h.role,
        sector: h.sector ?? getMeta(h.ticker).sector,
        valueINR: value,
        pnlPct: toNum(h.pnlPct),
        weightPctOfBucket: toNum(h.weight),
      });
    }

    // ── US positions ────────────────────────────────────────────────────────
    const fx = (us?.positions?.length ?? 0) > 0 ? resolveFx(us?.fx?.usdInr, us?.fx?.asOf) : 0;
    for (const p of us?.positions ?? []) {
      const value =
        toNum(p.currentINR) ??
        (toNum(p.currentPriceUSD) ?? 0) * (toNum(p.quantity) ?? 0) * fx;
      if (value <= 0) continue;
      buckets.usEquity += value;
      positions.push({
        ticker: p.ticker,
        name: p.name ?? p.ticker,
        market: "US",
        role: p.role,
        sector: p.sector ?? getMeta(p.ticker).sector,
        valueINR: value,
        pnlPct: toNum(p.pnlPct),
      });
    }

    // ── Mutual funds (full book from markdown — carries category for split) ──
    const mfSchemes: ScoreMFScheme[] = [];
    const mfSummary = mfText ? parseMutualFunds(mfText) : null;
    // Prefer xray TERs (numeric, audited) keyed by short ticker; markdown is the
    // authoritative value/category list.
    const xrayByTicker = xray?.schemes ?? {};
    for (const e of mfSummary?.entries ?? []) {
      const value = toNum(e.value) ?? 0;
      if (value <= 0) continue;
      const ticker = e.ticker ?? e.scheme;
      const isBallast = BALLAST_RE.test(`${e.scheme} ${e.category ?? ""}`);
      if (isBallast) buckets.bonds += value; // ballast sits in the debt slot
      else buckets.mf += value;
      const xr = ticker ? xrayByTicker[ticker] : undefined;
      const ter = toNum(xr?.ter) ?? toNum(e.expenseRatio);
      mfSchemes.push({
        ticker: ticker ?? e.scheme,
        scheme: e.scheme,
        category: e.category ?? "",
        valueINR: value,
        ter,
      });
      // MF positions also enter the position list (for dead-money detection).
      positions.push({
        ticker: ticker ?? e.scheme,
        name: e.scheme,
        market: "MF",
        role: isBallast ? "debt-equiv" : e.role,
        valueINR: value,
        pnlPct: toNum(e.pnlPct),
        xirr: toNum(e.xirr),
      });
    }

    // ── Stable-bonds-platform SDI/NCD (separate silo from Kite snapshot) ────
    for (const p of bonds?.positions ?? []) {
      if (p.status === "matured") continue;
      const value = toNum(p.investedINR) ?? 0;
      if (value <= 0) continue;
      buckets.bonds += value;
      positions.push({
        ticker: p.isin,
        name: p.name ?? p.isin,
        market: "BONDS",
        role: "debt-equiv",
        valueINR: value,
      });
    }

    // ── Cash float ──────────────────────────────────────────────────────────
    const cashAmount = toNum(snap?.cash) ?? 0;
    if (cashAmount > 0) {
      buckets.cash += cashAmount;
      positions.push({
        ticker: "CASH",
        name: "Cash float",
        market: "CASH",
        role: "cash",
        valueINR: cashAmount,
      });
    }

    const total =
      buckets.inEquity +
      buckets.usEquity +
      buckets.mf +
      buckets.bonds +
      buckets.metals +
      buckets.cash;

    // Graceful empty state — no data assembled.
    if (total <= 0) {
      const empty = computePortfolioScore({
        asOf: snap?.asOf ?? new Date().toISOString(),
        total: 0,
        buckets,
        positions: [],
        mfSchemes: [],
        worstOverlapPct: 0,
        freshDeployed30d: 0,
      });
      return NextResponse.json(empty);
    }

    // ── Worst MF overlap pair ───────────────────────────────────────────────
    const worstOverlapPct = Object.values(xray?.overlapPairs ?? {}).reduce(
      (mx, v) => Math.max(mx, toNum(v?.pct) ?? 0),
      0,
    );

    // ── Fresh deploy over the trailing 30 days ──────────────────────────────
    const histArr: HistoryEntry[] = Array.isArray(history)
      ? history
      : (history?.history ?? []);
    const asOfMs = Date.parse(snap?.asOf ?? new Date().toISOString());
    const windowStart = asOfMs - 30 * 24 * 60 * 60 * 1000;
    const freshDeployed30d = histArr.reduce((s, e) => {
      const t = e.date ? Date.parse(e.date) : NaN;
      const ci = toNum(e.cashInjection) ?? 0;
      if (Number.isFinite(t) && t >= windowStart && t <= asOfMs && ci > 0) {
        return s + ci;
      }
      return s;
    }, 0);

    const input: ScoreInput = {
      asOf: snap?.asOf ?? new Date().toISOString(),
      total,
      buckets,
      positions,
      mfSchemes,
      worstOverlapPct,
      freshDeployed30d,
    };

    return NextResponse.json(computePortfolioScore(input));
  } catch {
    // Generic error body — no username paths leak in a public-shipping app.
    return NextResponse.json(
      { error: "Failed to compute portfolio score." },
      { status: 500 },
    );
  }
}
