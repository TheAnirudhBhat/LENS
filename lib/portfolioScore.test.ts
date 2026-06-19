import { describe, it, expect } from "vitest";
import {
  computePortfolioScore,
  type ScoreInput,
} from "@/lib/portfolioScore";

// A well-balanced book: 85/10/5, no over-cap name, cheap funds, low overlap,
// real ballast, fresh capital deployed. Should land near the top of the scale.
function balancedBook(): ScoreInput {
  const total = 1_000_000;
  return {
    asOf: "2026-06-15T00:00:00.000Z",
    total,
    buckets: {
      inEquity: 400_000,
      usEquity: 250_000,
      mf: 200_000, // equity MF
      bonds: 100_000, // 8% SDI + 2% ballast below counts into bonds slot
      metals: 50_000,
      cash: 0,
    },
    positions: [
      // IN book = 400k, spread so the top name (55k) is 13.75% (<15% cap).
      { ticker: "INA", market: "IN", role: "compounders", valueINR: 55_000, pnlPct: 18, weightPctOfBucket: 13.75 },
      { ticker: "INB", market: "IN", role: "growth", valueINR: 50_000, pnlPct: 22 },
      { ticker: "INC", market: "IN", role: "cyclicals", valueINR: 48_000, pnlPct: 9 },
      { ticker: "IND", market: "IN", role: "compounders", valueINR: 45_000, pnlPct: 11 },
      { ticker: "INE", market: "IN", role: "growth", valueINR: 44_000, pnlPct: 14 },
      { ticker: "INF", market: "IN", role: "defensives", valueINR: 43_000, pnlPct: 7 },
      { ticker: "ING", market: "IN", role: "cyclicals", valueINR: 42_000, pnlPct: 6 },
      { ticker: "INH", market: "IN", role: "compounders", valueINR: 40_000, pnlPct: 9 },
      { ticker: "INI", market: "IN", role: "growth", valueINR: 33_000, pnlPct: 12 },
      // US book = 250k, top name (45k) = 18% — comfortably under the 25% cap
      // and outside the 3pp near-cap warn band.
      { ticker: "USA", market: "US", role: "compounders", valueINR: 45_000, pnlPct: 12 },
      { ticker: "USB", market: "US", role: "compounders", valueINR: 44_000, pnlPct: 8 },
      { ticker: "USC", market: "US", role: "compounders", valueINR: 42_000, pnlPct: 10 },
      { ticker: "USD", market: "US", role: "growth", valueINR: 40_000, pnlPct: 9 },
      { ticker: "USE", market: "US", role: "compounders", valueINR: 40_000, pnlPct: 7 },
      { ticker: "USF", market: "US", role: "compounders", valueINR: 39_000, pnlPct: 6 },
    ],
    mfSchemes: [
      { ticker: "FLEXI", category: "Flexi Cap", valueINR: 120_000, ter: 0.55 },
      { ticker: "MID", category: "Mid Cap", valueINR: 80_000, ter: 0.6 },
      { ticker: "ARB", scheme: "Arbitrage Fund", category: "Arbitrage", valueINR: 100_000, ter: 0.4 },
    ],
    worstOverlapPct: 15,
    freshDeployed30d: 60_000,
  };
}

describe("computePortfolioScore", () => {
  it("scores a balanced, doctrine-aligned book high with no levers needed", () => {
    const r = computePortfolioScore(balancedBook());
    expect(r.composite).not.toBeNull();
    expect(r.composite!).toBeGreaterThanOrEqual(80);
    expect(["A+", "A"]).toContain(r.grade);
    // Six dimensions, in contract order, weights sum to 1.
    expect(r.dimensions.map((d) => d.key)).toEqual([
      "allocation",
      "concentration",
      "cost",
      "capital",
      "liquidity",
      "deploy",
    ]);
    const wSum = r.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(wSum - 1)).toBeLessThan(1e-9);
    // Healthy book → no dimension is bad, and no levers clear the noise floor.
    expect(r.dimensions.some((d) => d.status === "bad")).toBe(false);
    expect(r.levers.length).toBe(0);
  });

  it("penalises an over-concentrated, under-ballasted book and surfaces the right levers", () => {
    const total = 1_000_000;
    const input: ScoreInput = {
      asOf: "2026-06-15T00:00:00.000Z",
      total,
      buckets: {
        inEquity: 350_000,
        usEquity: 350_000,
        mf: 280_000, // equity-heavy → ~98% equity, 0% ballast
        bonds: 0,
        metals: 20_000,
        cash: 0,
      },
      positions: [
        // One US name = 70% of a 500k US book → breaches the 25% cap hard.
        { ticker: "BIGUS", market: "US", role: "growth", sector: "Semiconductors", valueINR: 245_000, pnlPct: 40 },
        { ticker: "SMUS", market: "US", role: "growth", valueINR: 105_000, pnlPct: 5 },
        // One IN name = 80% of a small IN book → breaches the 15% cap.
        { ticker: "BIGIN", market: "IN", role: "growth", sector: "AI", valueINR: 300_000, pnlPct: 30 },
        { ticker: "SMIN", market: "IN", role: "cyclicals", valueINR: 50_000, pnlPct: 2, monthsHeld: 12 },
      ],
      mfSchemes: [
        { ticker: "ELSS1", category: "ELSS", valueINR: 150_000, ter: 1.6 },
        { ticker: "ELSS2", category: "ELSS", valueINR: 130_000, ter: 4.2 },
      ],
      worstOverlapPct: 55,
      freshDeployed30d: 0,
    };
    const r = computePortfolioScore(input);
    expect(r.composite).not.toBeNull();
    expect(r.composite!).toBeLessThan(64); // C-tier or worse
    // Liquidity is zero ballast → bad.
    const liq = r.dimensions.find((d) => d.key === "liquidity")!;
    expect(liq.status).toBe("bad");
    expect(liq.score).toBe(0);
    // Concentration breaches → bad.
    expect(r.dimensions.find((d) => d.key === "concentration")!.status).toBe("bad");
    // Deploy is zero → bad.
    expect(r.dimensions.find((d) => d.key === "deploy")!.status).toBe("bad");
    // Top levers should include lifting ballast and trimming concentration.
    const ids = r.levers.map((l) => l.id);
    expect(r.levers.length).toBeGreaterThan(0);
    expect(r.levers.length).toBeLessThanOrEqual(3);
    expect(ids).toContain("lift-ballast");
    // Levers carry an imperative action and a ₹ figure.
    for (const l of r.levers) {
      expect(l.action).toMatch(/₹/);
      expect(l.scoreGain).toBeGreaterThan(0);
    }
    // Levers are sorted by scoreGain descending.
    const gains = r.levers.map((l) => l.scoreGain);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });

  it("degrades gracefully on empty input", () => {
    const r = computePortfolioScore({
      asOf: "2026-06-15T00:00:00.000Z",
      total: 0,
      buckets: { inEquity: 0, usEquity: 0, mf: 0, bonds: 0, metals: 0, cash: 0 },
      positions: [],
      mfSchemes: [],
      worstOverlapPct: 0,
      freshDeployed30d: 0,
    });
    expect(r.composite).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.dimensions).toEqual([]);
    expect(r.levers).toEqual([]);
    expect(r.note).toBeTruthy();
  });

  it("flags a single over-cap AI/specialty cluster against the total book", () => {
    const total = 1_000_000;
    const input: ScoreInput = {
      asOf: "2026-06-15T00:00:00.000Z",
      total,
      buckets: {
        inEquity: 350_000,
        usEquity: 350_000,
        mf: 200_000,
        bonds: 100_000,
        metals: 0,
        cash: 0,
      },
      positions: [
        // US book = 350k, spread so no single name >25%.
        // Cluster = 70k+70k semis (US) + 40k AI (IN) = 180k = 18% of 1m total,
        // over the 12% cap, but every single name stays under its silo cap.
        { ticker: "CHIP", market: "US", role: "growth", sector: "Semiconductors", valueINR: 70_000 },
        { ticker: "CHIP2", market: "US", role: "growth", sector: "Semiconductors", valueINR: 70_000 },
        { ticker: "USX", market: "US", role: "compounders", valueINR: 75_000 },
        { ticker: "USY", market: "US", role: "compounders", valueINR: 70_000 },
        { ticker: "USZ", market: "US", role: "compounders", valueINR: 65_000 },
        // IN book = 350k, spread so no single name >15% (top = GENAI 40k = 11.4%).
        { ticker: "GENAI", market: "IN", role: "growth", sector: "AI", valueINR: 40_000 },
        { ticker: "BANK", market: "IN", role: "compounders", valueINR: 50_000 },
        { ticker: "BANK2", market: "IN", role: "compounders", valueINR: 48_000 },
        { ticker: "INFRA", market: "IN", role: "cyclicals", valueINR: 46_000 },
        { ticker: "PHARMA", market: "IN", role: "defensives", valueINR: 44_000 },
        { ticker: "FMCG", market: "IN", role: "defensives", valueINR: 42_000 },
        { ticker: "AUTO", market: "IN", role: "cyclicals", valueINR: 40_000 },
        { ticker: "ENERGY", market: "IN", role: "cyclicals", valueINR: 40_000 },
      ],
      mfSchemes: [
        { ticker: "ARB", scheme: "Arbitrage Fund", category: "Arbitrage", valueINR: 110_000, ter: 0.4 },
        { ticker: "FLEXI", category: "Flexi Cap", valueINR: 290_000, ter: 0.6 },
      ],
      worstOverlapPct: 18,
      freshDeployed30d: 55_000,
    };
    const r = computePortfolioScore(input);
    const conc = r.dimensions.find((d) => d.key === "concentration")!;
    expect(conc.status).toBe("bad");
    expect(conc.detail).toMatch(/cluster/i);
    expect(r.levers.some((l) => l.id === "trim-concentration")).toBe(true);
  });
});
