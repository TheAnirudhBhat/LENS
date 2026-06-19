import { describe, it, expect } from "vitest";
import {
  SAA,
  EQUITY_SUB,
  DRIFT_BANDS,
  CONCENTRATION,
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

  it("equity sub-allocation IN + Intl equals SAA equity target", () => {
    expect(EQUITY_SUB.indian + EQUITY_SUB.international).toBe(SAA.equity);
  });

  it("drift bands are monotonically increasing", () => {
    expect(DRIFT_BANDS.monitor).toBeLessThan(DRIFT_BANDS.softTrigger);
    expect(DRIFT_BANDS.softTrigger).toBeLessThan(DRIFT_BANDS.hardTrigger);
    expect(DRIFT_BANDS.hardTrigger).toBeLessThan(DRIFT_BANDS.active);
    expect(DRIFT_BANDS.active).toBeLessThanOrEqual(DRIFT_BANDS.emergency);
  });

  it("US concentration cap is stricter than IN (US book smaller)", () => {
    expect(CONCENTRATION.usSingleName).toBeGreaterThan(CONCENTRATION.inSingleName);
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
