/**
 * lib/enrich.ts — the ONE place a live price/NAV/FX overlay happens.
 *
 * Consolidates the three per-route enrichers (previously inline in
 * app/api/{snapshot,usstocks,mutualfunds}/route.ts) so every consumer —
 * Overview, Allocation, tabs, score, sync, drawer — reads the SAME enriched
 * silo data. The route bodies now import these; `buildBook()` (lib/valuation.ts)
 * composes them via `enrichSilos()`.
 *
 * Each enricher is best-effort and falls back to the stored file values on any
 * failure, so a surface is never half-live/half-raw within a silo — and
 * `enrichSilos({ live: false })` skips the network entirely for deterministic
 * raw-file mode (score, tests).
 *
 * Server-side only (node:fs + network fetch clients).
 */
import { readFile } from "node:fs/promises";
import {
  SNAPSHOT_FILE,
  US_STOCKS_FILE,
  MUTUAL_FUNDS_FILE,
  BONDS_FILE,
} from "./paths";
import {
  SnapshotSchema,
  USStocksDataSchema,
  parseOrThrow,
} from "./schemas";
import { parseMutualFunds, type MFSummary } from "./parsers";
import { getHoldings, readSession } from "./kite";
import { fetchUSQuotes, fetchUsdInr } from "./usquote";
import { fetchAllNAVs } from "./mfapi";
import { resolveFx } from "./fx";
import { withinMs, PAINT_BUDGET_MS } from "./timeoutRace";
import type { z } from "zod";

export type Snapshot = z.output<typeof SnapshotSchema>;
export type USData = z.output<typeof USStocksDataSchema>;
export type { MFSummary };

type KiteHolding = {
  tradingsymbol: string;
  exchange: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  day_change?: number;
  day_change_percentage?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// IN snapshot — live Kite holdings overlay (was enrichWithKite in snapshot/route)
// ─────────────────────────────────────────────────────────────────────────────
export async function enrichSnapshot(snapshot: Snapshot): Promise<Snapshot> {
  const session = await readSession();
  if (!session?.access_token) return snapshot;

  let kiteHoldings: KiteHolding[];
  try {
    kiteHoldings = (await getHoldings()) as KiteHolding[];
  } catch (err) {
    console.warn(
      "[enrich] Kite enrichment skipped:",
      err instanceof Error ? err.message : String(err)
    );
    return snapshot;
  }

  const byTicker = new Map<string, KiteHolding>();
  for (const h of kiteHoldings) byTicker.set(h.tradingsymbol.toUpperCase(), h);

  const updatedHoldings = snapshot.holdings.map((h) => {
    const live = byTicker.get(h.ticker.toUpperCase());
    if (!live) return h;
    const ltp = live.last_price;
    const value = ltp * h.qty;
    const cost = (h.avgPrice ?? live.average_price) * h.qty;
    const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : h.pnlPct;
    return {
      ...h,
      ltp,
      value,
      pnlPct,
      dayChangePct:
        live.day_change_percentage !== undefined
          ? live.day_change_percentage
          : h.dayChangePct,
    };
  });

  const inBookTotal =
    updatedHoldings.reduce((s, h) => s + (h.value ?? 0), 0) ||
    snapshot.totalValue;
  const portfolioTotal =
    snapshot.totalPortfolioValue && snapshot.totalPortfolioValue > inBookTotal
      ? snapshot.totalPortfolioValue
      : inBookTotal;
  const recomputed = updatedHoldings.map((h) => {
    if (h.value === undefined) return h;
    const weightInBook = inBookTotal > 0 ? (h.value / inBookTotal) * 100 : 0;
    const weight = portfolioTotal > 0 ? (h.value / portfolioTotal) * 100 : 0;
    return {
      ...h,
      weight: Number(weight.toFixed(2)),
      weightInBook: Number(weightInBook.toFixed(2)),
    };
  });

  // Kite aggregate P&L over every avg>0 row (equity + bonds + metals).
  let liveInEquityPnL = 0;
  let liveInEquityValue = 0;
  let liveInEquityCost = 0;
  for (const h of kiteHoldings) {
    if (!h.average_price || h.average_price === 0) continue;
    liveInEquityPnL += h.pnl;
    liveInEquityValue += h.last_price * h.quantity;
    liveInEquityCost += h.average_price * h.quantity;
  }
  const liveInEquityPnLPct =
    liveInEquityCost > 0 ? (liveInEquityPnL / liveInEquityCost) * 100 : undefined;

  return {
    ...snapshot,
    holdings: recomputed,
    liveInEquityPnL,
    liveInEquityValue,
    liveInEquityCost,
    liveInEquityPnLPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// US — live Yahoo/Stooq price + live FX overlay (was enrichWithLiveQuotes)
// ─────────────────────────────────────────────────────────────────────────────
export async function enrichUS(data: USData): Promise<USData> {
  const positions = data.positions ?? [];
  if (positions.length === 0) return data;
  let quotes: Map<string, number>;
  try {
    quotes = await fetchUSQuotes(positions.map((p) => p.ticker));
  } catch {
    return data;
  }
  if (quotes.size === 0) return data;
  const liveFx = await fetchUsdInr().catch(() => null);
  let fx: number;
  try {
    fx = resolveFx(liveFx, "live");
  } catch {
    fx = Number(data.fx?.usdInr ?? 0);
  }
  let invTot = 0;
  let curTot = 0;
  const newPositions = positions.map((p) => {
    const live = quotes.get(p.ticker.toUpperCase());
    const invested = p.investedINR ?? 0;
    invTot += invested;
    if (!live || fx <= 0) {
      curTot += p.currentINR ?? 0;
      return p;
    }
    const currentINR = Math.round(live * p.quantity * fx);
    curTot += currentINR;
    return {
      ...p,
      currentPriceUSD: Number(live.toFixed(2)),
      currentINR,
      pnlINR: Math.round(currentINR - invested),
      pnlPct:
        invested > 0
          ? Number((((currentINR - invested) / invested) * 100).toFixed(2))
          : p.pnlPct,
    };
  });
  return {
    ...data,
    fx: liveFx
      ? { ...data.fx, usdInr: Number(liveFx.toFixed(2)), asOf: "live" }
      : data.fx,
    positions: newPositions,
    totals: {
      ...data.totals,
      investedINR: Math.round(invTot),
      currentINR: Math.round(curTot),
      pnlINR: Math.round(curTot - invTot),
      pnlPct:
        invTot > 0
          ? Number((((curTot - invTot) / invTot) * 100).toFixed(2))
          : data.totals?.pnlPct,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MF — live mfapi.in NAV overlay (was enrichMfNavs)
// ─────────────────────────────────────────────────────────────────────────────
export async function enrichMF(summary: MFSummary): Promise<MFSummary> {
  try {
    const navs = await fetchAllNAVs();
    const byTicker = new Map(navs.map((n) => [n.ticker, n]));
    let totalLiveValue = 0;
    const entries = summary.entries.map((e) => {
      const live = e.ticker ? byTicker.get(e.ticker) : undefined;
      if (!live) {
        totalLiveValue += e.value || 0;
        return e;
      }
      const value = Number((live.nav * e.units).toFixed(2));
      const pnlPct =
        e.invested && e.invested > 0
          ? Number((((value - e.invested) / e.invested) * 100).toFixed(2))
          : e.pnlPct;
      totalLiveValue += value;
      return { ...e, nav: live.nav, value, pnlPct };
    });
    const totalPnLPct =
      summary.totalInvested && summary.totalInvested > 0
        ? Number(
            (
              ((totalLiveValue - summary.totalInvested) /
                summary.totalInvested) *
              100
            ).toFixed(2)
          )
        : summary.totalPnLPct;
    return {
      ...summary,
      entries,
      totalValue: Number(totalLiveValue.toFixed(2)),
      totalPnLPct,
      navsLive: true,
    };
  } catch (navErr) {
    console.warn(
      "[enrich] mfapi enrichment failed:",
      navErr instanceof Error ? navErr.message : String(navErr)
    );
    return summary;
  }
}

// Last completed NAV business day (IST) as "YYYY-MM-DD". Indian MF NAVs
// publish on business days only, due ~6:30 PM IST but with AMC uploads (and
// mfapi's scrape) trailing into the evening — before 8 PM IST we don't assume
// today's NAV is out. So on weekends and Monday mornings the stored Friday NAV
// IS the latest official NAV: "raw" provenance, but not stale. v1 is weekday
// math only — an exchange holiday still counts as a NAV day, so the morning
// after one can false-alarm; acceptable until a holiday calendar is wired in.
export function lastCompletedNavDay(now: Date = new Date()): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30, no DST
  const ist = new Date(now.getTime() + IST_OFFSET_MS); // read via UTC getters
  if (ist.getUTCHours() < 20) ist.setUTCDate(ist.getUTCDate() - 1);
  while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6)
    ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonds — read bonds.json (no network). Active Stable positions only; the 4
// transferred SDIs live in the Kite snapshot (counted there, not here).
// ─────────────────────────────────────────────────────────────────────────────
export type BondPosition = {
  isin: string;
  name: string;
  issuer?: string;
  units?: number;
  investedINR?: number;
  currentINR?: number | null;
  /** Principal still owed on a bond whose units already left the demat. */
  redemptionReceivableINR?: number | null;
  status?: "active" | "matured" | "transferred" | "redeeming";
  role?: string;
};
export type BondsData = { positions: BondPosition[]; totals?: Record<string, number> };

export async function loadBonds(): Promise<BondsData> {
  try {
    const raw = await readFile(BONDS_FILE, "utf8");
    const parsed = JSON.parse(raw) as BondsData;
    return { positions: parsed.positions ?? [], totals: parsed.totals };
  } catch {
    return { positions: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichSilos — read all four silos, enrich each ONCE under a shared paint
// budget, record per-silo live/raw provenance. The single data path for
// buildBook(). `live:false` returns pure stored-file values (score/tests).
// ─────────────────────────────────────────────────────────────────────────────
export type Silo = "IN" | "US" | "MF" | "BONDS" | "CASH";

export type EnrichedSilos = {
  snapshot: Snapshot;
  us: USData | null;
  mf: MFSummary;
  bonds: BondsData;
  sources: Record<Exclude<Silo, "CASH">, "live" | "raw">;
  asOf: string;
};

async function readSnapshotFile(): Promise<Snapshot> {
  const raw = JSON.parse(await readFile(SNAPSHOT_FILE, "utf8"));
  return parseOrThrow(SnapshotSchema, raw, "snapshot");
}
async function readUSFile(): Promise<USData | null> {
  try {
    const raw = JSON.parse(await readFile(US_STOCKS_FILE, "utf8"));
    return parseOrThrow(USStocksDataSchema, raw, "usstocks");
  } catch {
    return null;
  }
}
async function readMFFile(): Promise<MFSummary> {
  const md = await readFile(MUTUAL_FUNDS_FILE, "utf8").catch(() => "");
  return parseMutualFunds(md);
}

export async function enrichSilos(opts?: {
  live?: boolean;
  budgetMs?: number;
}): Promise<EnrichedSilos> {
  const live = opts?.live ?? true;
  const budgetMs = opts?.budgetMs ?? PAINT_BUDGET_MS;

  const [snapRaw, usRaw, mfRaw, bonds] = await Promise.all([
    readSnapshotFile(),
    readUSFile(),
    readMFFile(),
    loadBonds(),
  ]);

  if (!live) {
    return {
      snapshot: snapRaw,
      us: usRaw,
      mf: mfRaw,
      bonds,
      sources: { IN: "raw", US: "raw", MF: "raw", BONDS: "raw" },
      asOf: snapRaw.asOf,
    };
  }

  // Enrich each silo independently under the paint budget; a slow/failed leg
  // falls back to its stored file (per-silo, never a half-live silo).
  const [snapshot, us, mf] = await Promise.all([
    withinMs(enrichSnapshot(snapRaw), budgetMs, snapRaw),
    usRaw ? withinMs(enrichUS(usRaw), budgetMs, usRaw) : Promise.resolve(null),
    withinMs(enrichMF(mfRaw), budgetMs, mfRaw),
  ]);

  const sources: EnrichedSilos["sources"] = {
    IN: snapshot.liveInEquityValue !== undefined ? "live" : "raw",
    US: us && us.fx?.asOf === "live" ? "live" : "raw",
    // navsLive is set only when the mfapi overlay actually applied — a stored
    // nav>0 must NOT count as live (it made the QA gate pass on lagged NAVs).
    MF: (mf as MFSummary & { navsLive?: boolean }).navsLive ? "live" : "raw",
    BONDS: "raw", // private SDIs have no live mark
  };

  return { snapshot, us, mf, bonds, sources, asOf: snapshot.asOf };
}
