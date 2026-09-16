/**
 * Policy constants — process thresholds (verdicts, task lifetimes, research
 * triggers) plus doctrine numbers re-exported from lib/rulesSchema.
 *
 * Doctrine lives in ONE place: the data dir's `strategy.md` (prose) and
 * `rules.json` (numbers). lib/rulesSchema.ts carries the shipped defaults;
 * lib/rules.ts loads the live file server-side. Do not add caps or bands here.
 */
import { DEFAULT_RULES } from "@/lib/rulesSchema";

// ───────────────────────────────────────────────────────────────────────────
// Doctrine numbers — derived from lib/rulesSchema DEFAULT_RULES so the client
// bundle and the server agree. The server scores against the LIVE data-dir
// rules.json (lib/rules.ts); these defaults are the same numbers shipped with
// the rulebook. Change rules.json (and DEFAULT_RULES) — never these lines.
// ───────────────────────────────────────────────────────────────────────────
export const SAA = {
  equity: DEFAULT_RULES.saa.equity[0],
  debtEquivalent: DEFAULT_RULES.saa.debt[0],
  gold: DEFAULT_RULES.saa.gold[0],
  cashMin: 0,
  cashMax: DEFAULT_RULES.saa.cashMaxPct,
} as const;

// Rule 3 — single stock vs TOTAL book, cluster vs total. (The old per-silo
// caps, 15% of IN book / 25% of US book, were retired 2026-09-16.)
export const CONCENTRATION = {
  singleStockPctOfBook: DEFAULT_RULES.size.singleStockPct,
  clusterPctOfBook: DEFAULT_RULES.size.clusterPct,
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
// Regime gate thresholds (rule 8) — from DEFAULT_RULES.
// ───────────────────────────────────────────────────────────────────────────
export const REGIME_GATE = {
  niftyStopDeploy: DEFAULT_RULES.regimeGate.niftyHalt,
  niftyResumeDeploy: DEFAULT_RULES.regimeGate.niftyResume,
  vixMax: DEFAULT_RULES.regimeGate.vixHalt,
  haltSessions: DEFAULT_RULES.regimeGate.haltSessions,
} as const;
