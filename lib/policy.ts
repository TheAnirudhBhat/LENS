/**
 * Policy constants — single source of truth for risk rules, allocation targets,
 * and verdict thresholds. Avoid sprinkling magic numbers across the codebase;
 * import from here so the rules can be tuned in one place.
 *
 * If you change a number here, also update:
 * - memory/strategy_asset_allocation.md (SAA targets, drift bands)
 * - memory/strategy_task_maintenance.md (priority lifetimes)
 * - commands/portfolio-check.md (Phase 0 thresholds, Pass G drift logic)
 */

// ───────────────────────────────────────────────────────────────────────────
// Strategic Asset Allocation (SAA) targets — in percentage points of total
// portfolio value. Sum must equal ~100 (cash 0-3 is an exception range).
// ───────────────────────────────────────────────────────────────────────────
export const SAA = {
  equity: 80,
  debtEquivalent: 15,
  gold: 5,
  cashMin: 0,
  cashMax: 3,
} as const;

// Within-equity sub-allocation (% of total portfolio, not of equity bucket).
export const EQUITY_SUB = {
  indian: 55,
  international: 25,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Drift bands — when allocation deviates from target by N percentage points,
// take the corresponding action.
// ───────────────────────────────────────────────────────────────────────────
export const DRIFT_BANDS = {
  monitor: 3, // < 3pp: no action
  softTrigger: 5, // 3-5pp: redirect next month's new flows
  hardTrigger: 7, // 5-7pp: redirect 2-3 months OR tax-free trim
  active: 10, // 7-10pp: trim using LTCG exemption + flows
  emergency: 10, // > 10pp: trim even with tax cost
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Single-name concentration caps (% of asset bucket).
// ───────────────────────────────────────────────────────────────────────────
export const CONCENTRATION = {
  usSingleName: 25, // any US ticker > 25% of US book → flag trim
  inSingleName: 15, // any IN equity ticker > 15% of IN book → flag trim
} as const;

// ───────────────────────────────────────────────────────────────────────────
// US research task triggers (drawdown / winner-trim).
// ───────────────────────────────────────────────────────────────────────────
export const US_RESEARCH = {
  reassessDrawdownPct: -25, // pnlPct < this → "reassess thesis or harvest loss"
  trimWinnerPct: 35, // pnlPct > this → "trim candidate, de-risk gains"
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Decision verdict logic — refreshed weekly via /portfolio-check Pass H.
// `>5%` favourable → good. `>10%` against → bad. Otherwise stay pending.
// Minimum holding period before a verdict can flip (avoids day-of noise).
// ───────────────────────────────────────────────────────────────────────────
export const VERDICT = {
  favourablePct: 5,
  againstPct: 10,
  minDaysHeld: 30,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Score-band filters for the ideas tab (used in StockResearchTab UI).
// ───────────────────────────────────────────────────────────────────────────
export const SCORE_BANDS = {
  buyMin: 6,
  watchMin: 4.5,
  watchMax: 6,
  lowMax: 4.5,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Task priority lifetimes (days) — after this, the task is overdue per Pass E.
// ───────────────────────────────────────────────────────────────────────────
export const TASK_LIFETIME_DAYS = {
  urgent: 2,
  high: 7,
  med: 30,
  low: Infinity, // audited quarterly, not by daysOpen
} as const;

// Hard cap on active tasks in tasks.json.
export const TASK_CAP = 10;

// ───────────────────────────────────────────────────────────────────────────
// Regime gate thresholds (used by t-regime-watch in tasks.json).
// ───────────────────────────────────────────────────────────────────────────
export const REGIME_GATE = {
  niftyStopDeploy: 23000, // close < this for 2 sessions → halt deploys
  niftyResumeDeploy: 24200, // close > this → resume
  vixMax: 22, // VIX > this → halt deploys regardless of Nifty
  haltSessions: 2, // number of consecutive sessions needed to confirm
} as const;
