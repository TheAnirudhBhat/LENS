/**
 * Task age helpers — shared by the Tasks tab (app/page.tsx) and the
 * TaskExplainerModal so the days-open-vs-tier-lifetime math lives in one place.
 *
 * Tier lifetimes follow strategy_task_maintenance.md: urgent 2d, high 7d,
 * med 30d, low 90d. A task is "overdue" once its days-open exceeds the tier
 * limit for its priority.
 */

export type TaskPriority = "urgent" | "high" | "med" | "low";

export const TIER_LIFETIME_DAYS: Record<TaskPriority, number> = {
  urgent: 2,
  high: 7,
  med: 30,
  low: 90,
};

/** Whole days since an ISO date string. Returns null for "—" / unparseable. */
export function daysBetween(iso: string | undefined | null): number | null {
  if (!iso || iso === "—") return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const diffMs = Date.now() - t;
  return Math.floor(diffMs / (24 * 3600 * 1000));
}

type AgeInput = {
  priority?: TaskPriority;
  createdAt?: string;
};

/**
 * Days the task has been past its tier limit. >0 means overdue. Returns 0 when
 * not overdue (or when age/limit can't be computed) — safe for sort comparisons.
 */
export function overdueDays(t: AgeInput): number {
  const open = daysBetween(t.createdAt);
  if (open === null) return 0;
  const limit = TIER_LIFETIME_DAYS[t.priority ?? "med"];
  return open - limit;
}

/** Open/limit/overdue state for the row's age column. */
export function ageState(t: AgeInput): {
  open: number | null;
  limit: number;
  overdue: boolean;
} {
  const open = daysBetween(t.createdAt);
  const limit = TIER_LIFETIME_DAYS[t.priority ?? "med"];
  return { open, limit, overdue: open !== null && open > limit };
}
