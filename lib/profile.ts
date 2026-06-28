/**
 * Profile — the single source for the user's strategy config.
 *
 * Reads profile.json from the data dir (MEMORY_DIR). If it's absent (fresh
 * install), returns null. Validated values are merged OVER code defaults
 * (derived from policy.ts + allocation.ts), so a partial profile.json still
 * works.
 *
 * Server-side only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MEMORY_DIR } from "./paths";
import { ProfileSchema, parseOrThrow, type Profile } from "./schemas";
import { SAA, CONCENTRATION, US_RESEARCH } from "./policy";
import { ROLE_ORDER, ROLE_TARGET, type Role } from "./allocation";

/**
 * Roles that carry SAA targets. ROLE_ORDER is typed Role[] but at runtime
 * excludes "unclassified" (see allocation.ts), so this narrowing is safe and
 * lets us index ROLE_TARGET (a Record over Exclude<Role, "unclassified">).
 */
type StrategicRole = Exclude<Role, "unclassified">;
const STRATEGIC_ROLES = ROLE_ORDER as StrategicRole[];

/** Generic, non-personal defaults built from the canonical code constants. */
export function defaultProfile(): Profile {
  return {
    version: 1,
    goals: { ladder: [] },
    allocation: {
      buckets: [
        { key: "equity", label: "Equity", targetPct: SAA.equity },
        { key: "debt", label: "Debt-equivalent", targetPct: SAA.debtEquivalent },
        { key: "gold", label: "Gold / hedges", targetPct: SAA.gold },
        {
          key: "cash",
          label: "Cash",
          targetPct: 0,
          floorPct: SAA.cashMin,
          ceilingPct: SAA.cashMax,
        },
      ],
      roleTargets: STRATEGIC_ROLES.map((r) => ({ role: r, targetPct: ROLE_TARGET[r].target })),
    },
    limits: {
      singleNameCapPct: CONCENTRATION.inSingleName,
      usSingleNameCapPct: CONCENTRATION.usSingleName,
      reassessDrawdownPct: US_RESEARCH.reassessDrawdownPct,
      trimGainPct: US_RESEARCH.trimWinnerPct,
    },
    strategy: {},
  };
}

/** Shallow-merge a validated profile over the code defaults (file wins). */
function mergeWithDefaults(file: Profile): Profile {
  const d = defaultProfile();
  return {
    version: 1,
    goals: file.goals,
    allocation: {
      buckets: file.allocation.buckets.length ? file.allocation.buckets : d.allocation.buckets,
      roleTargets: file.allocation.roleTargets?.length
        ? file.allocation.roleTargets
        : d.allocation.roleTargets,
    },
    limits: { ...d.limits, ...file.limits },
    strategy: file.strategy ?? {},
  };
}

async function readProfileFile(dir: string): Promise<unknown | null> {
  const file = join(dir, "profile.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw new Error(
      `Failed to read/parse ${file}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Load the resolved profile. `dir` defaults to MEMORY_DIR (overridable for tests).
 * - real profile.json present → { profile (merged), isDemo: LENS_DEMO==="1" }
 * - absent → { profile: null, isDemo: LENS_DEMO==="1" }
 * - present but invalid → throws (fail loudly).
 *
 * isDemo reflects the LENS_DEMO env flag (set by `npm run demo`), so the UI's
 * DEMO badge lights up in demo mode and stays off otherwise.
 */
export async function loadProfile(
  dir: string = MEMORY_DIR
): Promise<{ profile: Profile | null; isDemo: boolean }> {
  const isDemo = process.env.LENS_DEMO === "1";
  const raw = await readProfileFile(dir);
  if (raw) {
    const parsed = parseOrThrow(ProfileSchema, raw, "profile.json");
    return { profile: mergeWithDefaults(parsed), isDemo };
  }
  return { profile: null, isDemo };
}

/** Effective role targets: code ROLE_TARGET with profile overrides applied. */
export function resolveRoleTargets(
  profile: Profile
): Record<StrategicRole, { target: number; band: [number, number] }> {
  const out = {} as Record<StrategicRole, { target: number; band: [number, number] }>;
  for (const r of STRATEGIC_ROLES) out[r] = { ...ROLE_TARGET[r] };
  for (const rt of profile.allocation.roleTargets ?? []) {
    if ((ROLE_ORDER as string[]).includes(rt.role)) {
      const r = rt.role as StrategicRole;
      out[r] = { ...out[r], target: rt.targetPct };
    }
  }
  return out;
}
