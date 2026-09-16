/**
 * Allocation — now a thin PROJECTION of the canonical Book (lib/valuation.ts).
 *
 * The role taxonomy lives in lib/roles.ts; the valuation math lives in
 * lib/valuation.ts. loadAllocation just maps the Book's role buckets into the
 * AllocationPayload the /api/allocation route + components/AllocationTab consume.
 * Because Allocation and Overview now project the SAME Book, they can never
 * disagree — which is the whole point of the single-source-of-truth refactor.
 *
 * (Previously this file re-read every silo from raw files and rolled them up
 * independently — the divergence that made the Allocation tab lag Overview.)
 *
 * Server-side only.
 */
import { buildBook } from "./valuation";
import {
  type Role,
  type AllocationHolding,
  type RoleBucket,
  type AllocationPayload,
  ROLE_ORDER,
  DISPLAY_ROLE_ORDER,
  ROLE_TARGET,
  isCashEquivalentMF,
  fallbackRoleFromExisting,
  driftStatusFor,
} from "./roles";

// Re-export the taxonomy so existing importers keep resolving from here.
export {
  ROLE_ORDER,
  DISPLAY_ROLE_ORDER,
  ROLE_TARGET,
  isCashEquivalentMF,
  fallbackRoleFromExisting,
  driftStatusFor,
};
export type { Role, AllocationHolding, RoleBucket, AllocationPayload };

function siloToMarket(silo: string): AllocationHolding["market"] {
  switch (silo) {
    case "US":
      return "US";
    case "MF":
      return "MF";
    case "BONDS":
      return "BONDS";
    case "CASH":
      return "CASH";
    default:
      return "IN";
  }
}

export async function loadAllocation(
  roleTargets: Record<
    Exclude<Role, "unclassified">,
    { target: number; band: [number, number] }
  > = ROLE_TARGET
): Promise<AllocationPayload> {
  const book = await buildBook({ roleTargets });
  const nw = book.totals.netWorth;
  const roles: RoleBucket[] = book.byRole.map((r) => ({
    role: r.key,
    valueINR: r.value,
    weightPct: r.weightPct,
    targetPct: r.targetPct,
    band: r.band,
    drift: r.drift,
    driftStatus: r.driftStatus,
    holdings: r.holdings.map((h) => ({
      ticker: h.ticker,
      company: h.company,
      market: siloToMarket(h.silo),
      valueINR: h.value,
      weightPct: nw > 0 ? (h.value / nw) * 100 : 0,
      pnlPct: h.pnlPct ?? 0,
      thesisHealth: h.thesisHealth,
      role: h.role,
    })),
  }));
  return { total: nw, roles };
}
