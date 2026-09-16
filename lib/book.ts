/**
 * Canonical asset-class bucketing + cross-silo book math — the single source
 * of truth. Every surface that classifies snapshot holdings into asset
 * classes or sums the book (Overview strip, Bonds tab headline, /api/sync
 * totals, /api/score SAA buckets) MUST go through these helpers.
 *
 * Why this exists: the bonds and metals slices drifted out of sync three
 * times in one day (2026-07-07) because this logic lived inline in five
 * places, each with its own classification quirks.
 *
 * Classification is role-FIRST: the snapshot's `role` field is authoritative —
 * TICKER_META doesn't know NCD tickers (1025MBFL27) or ETF tickers (GOLDCASE),
 * so meta-only checks silently misclassify them as equity. Meta and a
 * conservative ticker heuristic are fallbacks for tag-less rows (demo data).
 */
import { getMeta } from "@/lib/tickerMeta";

export type AssetBucket = "in-equity" | "bonds" | "metals" | "cash";

export function bucketOf(h: { ticker: string; role?: string | null }): AssetBucket {
  if (h.role === "debt-equiv") return "bonds";
  if (h.role === "hedges") return "metals";
  if (h.role === "cash") return "cash";
  const meta = getMeta(h.ticker);
  if (meta.asset === "bond") return "bonds";
  if (meta.sector === "Precious Metals") return "metals";
  // Tag-less fallback (kept from /api/score): gold/silver ETFs without roles.
  if (/gold|silver|metal/i.test(h.ticker)) return "metals";
  return "in-equity";
}

export type SnapshotAssetSplit<H> = {
  inEquity: H[];
  bonds: H[];
  metals: H[];
  inEquityValue: number;
  /** Kite-demat bond rows only (live snapshot values). */
  bondsValue: number;
  metalsValue: number;
};

/** Split IN snapshot holdings into asset-class buckets with summed values. */
export function splitSnapshotByAsset<
  H extends { ticker: string; role?: string | null; value?: number; market?: string }
>(holdings: H[]): SnapshotAssetSplit<H> {
  const out: SnapshotAssetSplit<H> = {
    inEquity: [],
    bonds: [],
    metals: [],
    inEquityValue: 0,
    bondsValue: 0,
    metalsValue: 0,
  };
  for (const h of holdings) {
    if ((h.market || "IN") !== "IN") continue;
    const bucket = bucketOf(h);
    if (bucket === "cash") continue;
    const value = h.value ?? 0;
    if (bucket === "bonds") {
      out.bonds.push(h);
      out.bondsValue += value;
    } else if (bucket === "metals") {
      out.metals.push(h);
      out.metalsValue += value;
    } else {
      out.inEquity.push(h);
      out.inEquityValue += value;
    }
  }
  return out;
}

/**
 * The whole bond book = Kite-demat rows (live, inside the snapshot) + the
 * Stable Bonds ACTIVE book (bonds.json only, invested basis — no live mark
 * exists for private SDIs). Used by the Bonds tab headline AND the Overview
 * bonds slice so the two can never disagree.
 */
export function bondBookINR(kiteDematINR: number, stableActiveINR: number): number {
  return kiteDematINR + stableActiveINR;
}

/**
 * Cross-silo net worth. `snapshotTotalINR` covers the WHOLE snapshot
 * (IN equity + metals + Kite-demat bonds); Stable Bonds actives live outside
 * it, so they are added separately — no double counting.
 */
export function netWorthINR(p: {
  snapshotTotalINR: number;
  stableBondsINR: number;
  cashINR: number;
  mfINR: number;
  usINR: number;
}): number {
  return p.snapshotTotalINR + p.stableBondsINR + p.cashINR + p.mfINR + p.usINR;
}
