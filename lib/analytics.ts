import { getMeta } from "./tickerMeta";

export type Holding = {
  ticker: string;
  qty: number;
  avgPrice?: number;
  ltp: number;
  value: number;
  weight: number;
  pnlPct?: number;
  dayChangePct?: number;
  role?: string;
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
};

export type RiskSummary = {
  top3Weight: number;
  hhi: number; // Herfindahl–Hirschman index of weights (0..10000)
  // Max loss if every holding ≥ -15% trigger gets cut at -15% from cost
  maxLossINRIfCutRule: number;
  drawdownFromPeakPct: number;
  sectorMix: { sector: string; pct: number }[];
  bondsPct: number;
  equityPct: number;
  etfPct: number;
};

export function computeRisk(
  holdings: Holding[],
  totalValue: number,
  peakValue?: number
): RiskSummary {
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const top3Weight = sorted.slice(0, 3).reduce((s, h) => s + h.weight, 0);
  const hhi = sorted.reduce((s, h) => s + h.weight * h.weight, 0);

  // "Open loss to cut rule" — only counts holdings currently in the red
  // (pnlPct < 0). For each, computes the additional ₹ lost if the price
  // continues falling to the −15%-from-cost cut threshold. Winners are
  // excluded because the cut-from-cost rule isn't the right risk gate for
  // them (trailing stop would be) — including them inflates the number with
  // unrealistic 30%+ drops. If a name is already past −15%, it contributes 0
  // here (the rule should already have fired).
  let maxLoss = 0;
  for (const h of holdings) {
    if (h.avgPrice === undefined) continue;
    if ((h.pnlPct ?? 0) >= 0) continue; // skip winners
    const cutPrice = h.avgPrice * 0.85;
    if (h.ltp > cutPrice) {
      maxLoss += (h.ltp - cutPrice) * h.qty;
    }
  }

  const drawdownFromPeakPct = peakValue
    ? ((peakValue - totalValue) / peakValue) * 100
    : 0;

  // Sector aggregation by value (equities + ETFs only; bonds bucketed)
  const sectorMap = new Map<string, number>();
  for (const h of holdings) {
    const meta = getMeta(h.ticker);
    const key =
      meta.asset === "bond"
        ? "Fixed Income"
        : meta.sector || "Uncategorized";
    sectorMap.set(key, (sectorMap.get(key) ?? 0) + h.value);
  }
  const sectorMix = Array.from(sectorMap.entries())
    .map(([sector, val]) => ({ sector, pct: (val / totalValue) * 100 }))
    .sort((a, b) => b.pct - a.pct);

  // Asset split
  let equityVal = 0,
    etfVal = 0,
    bondVal = 0;
  for (const h of holdings) {
    const a = getMeta(h.ticker).asset;
    if (a === "equity") equityVal += h.value;
    else if (a === "etf") etfVal += h.value;
    else if (a === "bond") bondVal += h.value;
  }

  return {
    top3Weight,
    hhi,
    maxLossINRIfCutRule: Math.round(maxLoss),
    drawdownFromPeakPct,
    sectorMix,
    equityPct: (equityVal / totalValue) * 100,
    etfPct: (etfVal / totalValue) * 100,
    bondsPct: (bondVal / totalValue) * 100,
  };
}

// Score concentration risk into a friendly label.
// HHI under 1500 = diversified, 1500-2500 = moderate, >2500 = concentrated.
export function concentrationLabel(hhi: number): {
  label: string;
  tone: "good" | "warn" | "bad";
} {
  if (hhi < 1500) return { label: "diversified", tone: "good" };
  if (hhi < 2500) return { label: "moderate", tone: "warn" };
  return { label: "concentrated", tone: "bad" };
}
