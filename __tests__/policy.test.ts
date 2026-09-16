import { describe, it, expect } from "vitest";
import {
  SAA,
  CONCENTRATION,
  REGIME_GATE,
  US_RESEARCH,
  VERDICT,
  TASK_LIFETIME_DAYS,
  TASK_CAP,
} from "@/lib/policy";

describe("Policy constants — sanity checks", () => {
  it("SAA targets sum to ~100", () => {
    const sum = SAA.equity + SAA.debtEquivalent + SAA.gold + SAA.cashMax;
    expect(sum).toBeGreaterThanOrEqual(100);
    expect(sum).toBeLessThanOrEqual(105);
  });

  it("rule 3 caps: single stock cap is a small share of the book and below the cluster cap", () => {
    expect(CONCENTRATION.singleStockPctOfBook).toBeGreaterThan(0);
    expect(CONCENTRATION.singleStockPctOfBook).toBeLessThan(CONCENTRATION.clusterPctOfBook);
    expect(CONCENTRATION.clusterPctOfBook).toBeLessThan(SAA.equity);
  });

  it("rule 8 regime gate: halt line sits below the resume line", () => {
    expect(REGIME_GATE.niftyStopDeploy).toBeLessThan(REGIME_GATE.niftyResumeDeploy);
    expect(REGIME_GATE.haltSessions).toBeGreaterThanOrEqual(1);
  });

  it("US research drawdown threshold is negative, trim threshold positive", () => {
    expect(US_RESEARCH.reassessDrawdownPct).toBeLessThan(0);
    expect(US_RESEARCH.trimWinnerPct).toBeGreaterThan(0);
  });

  it("verdict thresholds: against > favourable (against is the more conservative bar)", () => {
    expect(VERDICT.againstPct).toBeGreaterThan(VERDICT.favourablePct);
  });

  it("task lifetimes increase with priority laxness", () => {
    expect(TASK_LIFETIME_DAYS.urgent).toBeLessThan(TASK_LIFETIME_DAYS.high);
    expect(TASK_LIFETIME_DAYS.high).toBeLessThan(TASK_LIFETIME_DAYS.med);
    expect(TASK_LIFETIME_DAYS.med).toBeLessThan(TASK_LIFETIME_DAYS.low);
  });

  it("task cap is a sensible small number", () => {
    expect(TASK_CAP).toBeGreaterThan(5);
    expect(TASK_CAP).toBeLessThan(20);
  });
});
