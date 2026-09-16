import { describe, it, expect } from "vitest";
import { buildBook } from "./valuation";

/**
 * Single-source-of-truth invariants. These must hold to the rupee against the
 * live data files — they are the gate that keeps every surface consistent.
 * Run in raw-file mode so the result is deterministic (no network).
 */
describe("valuation buildBook invariants", () => {
  it("net worth equals the sum of holdings, asset-class buckets, and role buckets", async () => {
    const b = await buildBook({ live: false });

    const sumHoldings = round2(b.holdings.reduce((s, h) => s + h.value, 0));
    const sumAssetClass = round2(
      Object.values(b.byAssetClass).reduce((s, x) => s + x.value, 0)
    );
    const sumRole = round2(b.byRole.reduce((s, x) => s + x.value, 0));

    expect(b.totals.netWorth).toBeCloseTo(sumHoldings, 2);
    expect(b.totals.netWorth).toBeCloseTo(sumAssetClass, 2);
    expect(b.totals.netWorth).toBeCloseTo(sumRole, 2);
  });

  it("weights sum to 100", async () => {
    const b = await buildBook({ live: false });
    const nw = b.totals.netWorth;
    const sumWeight = b.holdings.reduce((s, h) => s + (h.value / nw) * 100, 0);
    expect(sumWeight).toBeCloseTo(100, 4);
  });

  it("P&L numerator and cost basis cover exactly the same holdings", async () => {
    const b = await buildBook({ live: false });
    const withCost = b.holdings.filter((h) => h.hasCost);
    const sumPnl = round2(withCost.reduce((s, h) => s + (h.pnlAbs ?? 0), 0));
    const sumInvested = round2(withCost.reduce((s, h) => s + (h.invested ?? 0), 0));
    expect(b.totals.pnlAbs).toBeCloseTo(sumPnl, 2);
    expect(b.totals.invested).toBeCloseTo(sumInvested, 2);
    if (b.totals.invested > 0) {
      expect(b.totals.pnlPct).toBeCloseTo((sumPnl / sumInvested) * 100, 1);
    }
  });

  it("bonds appear once each — no transferred/active double count", async () => {
    const b = await buildBook({ live: false });
    const bonds = b.holdings.filter((h) => h.assetClass === "bonds");
    // 4 Kite-demat (transferred, from snapshot) + 4 Stable active (bonds.json).
    // Duplicates would show a repeated ticker/isin.
    const ids = new Set(bonds.map((h) => h.id));
    expect(ids.size).toBe(bonds.length);
  });

  it("role targets sum to the 85/10/5 asset-class SAA", async () => {
    const b = await buildBook({ live: false });
    const t = Object.fromEntries(b.byRole.map((r) => [r.key, r.targetPct]));
    const equity =
      (t.compounders ?? 0) + (t.growth ?? 0) + (t.cyclicals ?? 0) + (t.defensives ?? 0);
    expect(equity).toBe(85);
    expect(t["debt-equiv"] ?? 0).toBe(10);
    expect(t.hedges ?? 0).toBe(5);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
