/**
 * lib/roles.ts — shared strategic-role vocabulary.
 *
 * Extracted from lib/allocation.ts so both the canonical valuation layer
 * (lib/valuation.ts) and the allocation projection (lib/allocation.ts) can
 * import it without a circular dependency. Role taxonomy is locked in
 * strategy.md (roles are tags, not rules); SAA bands sum to the 85/10/5 asset split
 * (rules.json (rule 2 SAA), doctrine R2).
 */
export type Role =
  | "compounders"
  | "growth"
  | "cyclicals"
  | "defensives"
  | "hedges"
  | "debt-equiv"
  | "cash"
  // Holdings present in a silo but lacking a strategic-role tag. Counted in the
  // total denominator (so weights stay honest) but carry no SAA target.
  | "unclassified";

// Roles that carry SAA targets / bands. "unclassified" is excluded.
export const ROLE_ORDER: Role[] = [
  "compounders",
  "growth",
  "cyclicals",
  "defensives",
  "hedges",
  "debt-equiv",
  "cash",
];

// Display order including the catch-all. Unclassified renders last.
export const DISPLAY_ROLE_ORDER: Role[] = [...ROLE_ORDER, "unclassified"];

// Role targets sum to the asset-class SAA 85/10/5 (equity / debt / gold),
// doctrine R2. Equity roles (compounders+growth+cyclicals+defensives) = 85,
// debt-equiv = 10, hedges = 5. The +5 equity / -5 debt shift vs the older
// 80/15/5 split lands on compounders (the core long-term sleeve).
export const ROLE_TARGET: Record<Exclude<Role, "unclassified">, { target: number; band: [number, number] }> = {
  compounders: { target: 35, band: [30, 40] },
  growth: { target: 25, band: [20, 30] },
  cyclicals: { target: 15, band: [10, 20] },
  defensives: { target: 10, band: [5, 15] },
  hedges: { target: 5, band: [3, 8] },
  "debt-equiv": { target: 10, band: [7, 13] },
  cash: { target: 0, band: [0, 3] },
};

export type AllocationHolding = {
  ticker: string;
  company: string;
  market: "IN" | "US" | "MF" | "BONDS" | "CASH";
  valueINR: number;
  weightPct: number;
  pnlPct: number;
  thesisHealth?: "green" | "amber" | "red";
  role: Role;
};

export type RoleBucket = {
  role: Role;
  valueINR: number;
  weightPct: number;
  targetPct: number;
  band: [number, number];
  drift: number;
  driftStatus: "ok" | "soft" | "hard";
  holdings: AllocationHolding[];
};

export type AllocationPayload = {
  total: number;
  roles: RoleBucket[];
};

function isRole(s: string | undefined): s is Role {
  if (!s) return false;
  return (ROLE_ORDER as string[]).includes(s);
}

export function fallbackRoleFromExisting(raw?: string): Role | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (isRole(lower)) return lower as Role;
  return undefined;
}

// Cash-equivalent MF schemes — arbitrage, liquid, overnight, money-market —
// behave like debt for SAA/role math (low beta, ~repo-rate returns) even though
// arbitrage funds are equity-taxed. Name-based, so no new data is needed.
const CASH_EQUIVALENT_MF_RE = /arbitrage|liquid|overnight|money\s*market/i;

/** True when a MF scheme is a cash-equivalent (debt-bucket) fund by name/category. */
export function isCashEquivalentMF(name?: string, category?: string): boolean {
  return CASH_EQUIVALENT_MF_RE.test(`${name ?? ""} ${category ?? ""}`);
}

export function driftStatusFor(
  weight: number,
  band: [number, number],
): "ok" | "soft" | "hard" {
  const [lo, hi] = band;
  if (weight >= lo && weight <= hi) return "ok";
  const edge = weight < lo ? lo - weight : weight - hi;
  if (edge <= 2) return "soft";
  return "hard";
}
