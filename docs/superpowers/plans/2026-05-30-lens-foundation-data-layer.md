# Lens Foundation — Plan 1: Profile Data Layer + Demo Fallback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated per-user `Profile` (goals / allocation / limits / strategy) loaded from the data dir with code constants as fallback, plus a `sample-data/` demo fallback and a "DEMO DATA" badge — so a fresh clone runs and the owner's values override defaults.

**Architecture:** A new `lib/profile.ts` is the single source for "the user's strategy config." It reads `profile.json` from `MEMORY_DIR`; if absent, it falls back to `sample-data/profile.json` and flags `isDemo`. Validated values are merged over code defaults (derived from the existing `lib/policy.ts` + `lib/allocation.ts` constants), so missing fields fall back cleanly. Consumers (allocation) take the resolved targets as a parameter to avoid an import cycle.

**Tech Stack:** Next 16 (app router), TypeScript, zod, vitest. No new dependencies.

**Why this is Plan 1 of 4:** This is the spine. It does NOT yet remove the personal data from `page.tsx`/`StrategyInfoModal` — that lands in:
- **Plan 2 — Research externalization:** `ResearchEntrySchema`, `research/*.json`, `/api/research`, migration of `US_CANDIDATES`/`MF_CANDIDATES`/IN idea arrays out of `page.tsx`.
- **Plan 3 — Strategy modal externalization:** `strategy.md` + render `StrategyInfoModal` from `profile` (removes hardcoded net worth/goals/rules).
- **Plan 4 — Migration script + `DEPENDENCIES.md` + final scrub verification** (the success-criteria grep).

The full privacy win completes after Plans 2–3; this plan is the prerequisite mechanic (loader + defaults/override + demo fallback) they depend on.

**Out of scope (per spec §3):** broker fetch, agent setup, encryption, the rich guided onboarding. The first-run onboarding one-pager (§6.5) is **already built** (`components/Onboarding.tsx`); the only related follow-up (move its seen-flag from `localStorage` to `ui_state.json`) is Task 8 here.

---

## File Structure

- **Create** `lib/profile.ts` — `defaultProfile()`, `loadProfile(dir?)`, `resolveRoleTargets(profile)`. The only place that knows how profile data merges with code defaults.
- **Modify** `lib/schemas.ts` — add `ProfileSchema` (zod).
- **Modify** `lib/paths.ts` — add `PROFILE_FILE`, `STRATEGY_FILE`, `RESEARCH_DIR`, `UI_STATE_FILE`, `SAMPLE_DATA_DIR`.
- **Modify** `lib/allocation.ts` — `loadAllocation()` accepts an optional `roleTargets` override (default = existing `ROLE_TARGET`). No new imports (avoids a cycle with `profile.ts`).
- **Create** `app/api/profile/route.ts` — read route → `{ profile, isDemo }`.
- **Modify** `app/api/allocation/route.ts` — resolve role targets from the profile, pass into `loadAllocation`.
- **Create** `sample-data/profile.json`, `sample-data/latest_snapshot.json` — generic, fictional, real tickers / fake quantities.
- **Modify** `app/page.tsx` — fetch `/api/profile`; render a persistent "DEMO DATA" badge when `isDemo`.
- **Modify** `components/Onboarding.tsx` + **create** `app/api/ui-state/route.ts` — move the onboarding seen-flag to `ui_state.json` (Task 8).
- **Create/Modify** `__tests__/profile.test.ts`, `__tests__/schemas.test.ts`, `__tests__/sampleData.test.ts`.

---

## Task 1: ProfileSchema in lib/schemas.ts

**Files:**
- Modify: `lib/schemas.ts` (append after `MFRotationsFileSchema`, before the Helpers section)
- Test: `__tests__/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/schemas.test.ts`:

```ts
import { ProfileSchema } from "../lib/schemas";

describe("ProfileSchema", () => {
  const valid = {
    version: 1,
    goals: { ladder: [{ label: "Base", value: 1000000 }] },
    allocation: {
      buckets: [{ key: "equity", label: "Equity", targetPct: 80 }],
      roleTargets: [{ role: "compounders", targetPct: 30 }],
    },
    limits: { singleNameCapPct: 12 },
    strategy: {
      convictionLevel: "medium",
      sectorViews: [{ sector: "IT", stance: "bullish", confidence: 0.7 }],
    },
  };

  it("accepts a valid profile", () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a wrong version", () => {
    expect(ProfileSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
  });

  it("rejects sectorView confidence outside 0..1", () => {
    const bad = {
      ...valid,
      strategy: { sectorViews: [{ sector: "IT", stance: "bullish", confidence: 5 }] },
    };
    expect(ProfileSchema.safeParse(bad).success).toBe(false);
  });

  it("applies defaults for optional sections", () => {
    const minimal = { version: 1, goals: { ladder: [] }, allocation: { buckets: [] } };
    const parsed = ProfileSchema.parse(minimal);
    expect(parsed.strategy).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/schemas.test.ts`
Expected: FAIL — `ProfileSchema` is not exported.

- [ ] **Step 3: Add the schema**

Append to `lib/schemas.ts` (after `MFRotationsFileSchema`, line ~229):

```ts
// ───────────────────────────────────────────────────────────────────────────
// Profile (per-user strategy config) — see lib/profile.ts for loading/merging.
// ───────────────────────────────────────────────────────────────────────────
const GoalRungSchema = z.object({
  label: z.string(),
  value: z.number(),
  impliedCagrPct: z.number().optional(),
  likelihood: z.enum(["high", "med", "low"]).optional(),
});

const AllocationBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  targetPct: z.number(),
  bandPct: z.number().optional(),
  floorPct: z.number().optional(),
  ceilingPct: z.number().optional(),
});

const RoleTargetSchema = z.object({ role: z.string(), targetPct: z.number() });

const SectorViewSchema = z.object({
  sector: z.string(),
  stance: z.enum(["bullish", "neutral", "bearish"]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["user", "agent"]).optional(),
});

export const ProfileSchema = z.object({
  version: z.literal(1),
  goals: z.object({
    horizonYears: z.number().optional(),
    currentBaseline: z.number().optional(),
    ladder: z.array(GoalRungSchema),
    notes: z.string().optional(),
  }),
  allocation: z.object({
    buckets: z.array(AllocationBucketSchema),
    roleTargets: z.array(RoleTargetSchema).optional(),
  }),
  limits: z
    .object({
      singleNameCapPct: z.number().optional(),
      usSingleNameCapPct: z.number().optional(),
      reassessDrawdownPct: z.number().optional(),
      trimGainPct: z.number().optional(),
      idleCashThreshold: z.number().optional(),
    })
    .optional(),
  strategy: z
    .object({
      convictionLevel: z.enum(["high", "medium", "low", "unsure"]).optional(),
      formedBy: z.enum(["user", "agent", "hybrid"]).optional(),
      sectorViews: z.array(SectorViewSchema).optional(),
      lastReviewed: z.string().optional(),
    })
    .default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/schemas.test.ts`
Expected: PASS (all 4 ProfileSchema cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas.ts __tests__/schemas.test.ts
git commit -m "feat(profile): add ProfileSchema with zod validation"
```

---

## Task 2: Path constants in lib/paths.ts

**Files:**
- Modify: `lib/paths.ts` (append after `TRIGGERS_FILE`, line ~31)

- [ ] **Step 1: Add the path constants**

Append to `lib/paths.ts`:

```ts
// ───────────────────────────────────────────────────────────────────────────
// Foundation: per-user profile + research data + first-run UI state.
// Sample data ships in-repo (sample-data/) as the demo fallback.
// ───────────────────────────────────────────────────────────────────────────
export const PROFILE_FILE = path.join(MEMORY_DIR, "profile.json");
export const STRATEGY_FILE = path.join(MEMORY_DIR, "strategy.md");
export const RESEARCH_DIR = path.join(MEMORY_DIR, "research");
export const UI_STATE_FILE = path.join(MEMORY_DIR, "ui_state.json");
export const SAMPLE_DATA_DIR = path.join(process.cwd(), "sample-data");
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add lib/paths.ts
git commit -m "feat(profile): add profile/strategy/research/ui-state/sample-data paths"
```

---

## Task 3: lib/profile.ts — defaults, loader, role-target resolver

**Files:**
- Create: `lib/profile.ts`
- Test: `__tests__/profile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/profile.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProfile, loadProfile, resolveRoleTargets } from "../lib/profile";

describe("profile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lens-profile-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaultProfile carries no personal data and validates", () => {
    const p = defaultProfile();
    expect(p.version).toBe(1);
    expect(p.goals.ladder).toEqual([]);
    expect(p.allocation.roleTargets?.length).toBeGreaterThan(0);
  });

  it("loads + validates a real profile and merges over defaults", async () => {
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({
        version: 1,
        goals: { ladder: [{ label: "Base", value: 5 }] },
        allocation: { buckets: [], roleTargets: [{ role: "compounders", targetPct: 40 }] },
      }),
    );
    const { profile, isDemo } = await loadProfile(dir);
    expect(isDemo).toBe(false);
    expect(profile.goals.ladder[0].value).toBe(5);
    // limits absent in file → code defaults present
    expect(profile.limits?.singleNameCapPct).toBe(15);
  });

  it("falls back to demo when no profile.json", async () => {
    const { isDemo } = await loadProfile(dir);
    expect(isDemo).toBe(true);
  });

  it("throws on invalid profile.json", async () => {
    writeFileSync(join(dir, "profile.json"), JSON.stringify({ version: 9 }));
    await expect(loadProfile(dir)).rejects.toThrow();
  });

  it("resolveRoleTargets overrides only the named role", () => {
    const p = defaultProfile();
    p.allocation.roleTargets = [{ role: "compounders", targetPct: 40 }];
    const t = resolveRoleTargets(p);
    expect(t.compounders.target).toBe(40);
    expect(t.growth.target).toBe(25); // default untouched
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/profile.test.ts`
Expected: FAIL — cannot find module `../lib/profile`.

- [ ] **Step 3: Implement lib/profile.ts**

Create `lib/profile.ts`:

```ts
/**
 * Profile — the single source for the user's strategy config.
 *
 * Reads profile.json from the data dir (MEMORY_DIR). If it's absent (fresh
 * clone), falls back to sample-data/profile.json and flags isDemo. Validated
 * values are merged OVER code defaults (derived from policy.ts + allocation.ts),
 * so a partial profile.json still works and a missing one still runs.
 *
 * Server-side only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MEMORY_DIR, SAMPLE_DATA_DIR } from "./paths";
import { ProfileSchema, parseOrThrow, type Profile } from "./schemas";
import { SAA, CONCENTRATION, US_RESEARCH } from "./policy";
import { ROLE_ORDER, ROLE_TARGET, type Role } from "./allocation";

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
      roleTargets: ROLE_ORDER.map((r) => ({ role: r, targetPct: ROLE_TARGET[r].target })),
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
      roleTargets: file.allocation.roleTargets ?? d.allocation.roleTargets,
    },
    limits: { ...d.limits, ...file.limits },
    strategy: file.strategy ?? {},
  };
}

async function readProfileFile(dir: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(join(dir, "profile.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Load the resolved profile. `dir` defaults to MEMORY_DIR (overridable for tests).
 * - real profile.json present → { profile (merged), isDemo: false }
 * - absent → load sample-data/profile.json → { profile, isDemo: true }
 * - present but invalid → throws (fail loudly).
 */
export async function loadProfile(
  dir: string = MEMORY_DIR
): Promise<{ profile: Profile; isDemo: boolean }> {
  const raw = await readProfileFile(dir);
  if (raw) {
    const parsed = parseOrThrow(ProfileSchema, raw, "profile.json");
    return { profile: mergeWithDefaults(parsed), isDemo: false };
  }
  const sampleRaw = await readProfileFile(SAMPLE_DATA_DIR);
  if (sampleRaw) {
    const parsed = parseOrThrow(ProfileSchema, sampleRaw, "sample-data/profile.json");
    return { profile: mergeWithDefaults(parsed), isDemo: true };
  }
  // No real and no sample data → bare code defaults, still flagged demo.
  return { profile: defaultProfile(), isDemo: true };
}

/** Effective role targets: code ROLE_TARGET with profile overrides applied. */
export function resolveRoleTargets(
  profile: Profile
): Record<Role, { target: number; band: [number, number] }> {
  const out = {} as Record<Role, { target: number; band: [number, number] }>;
  for (const r of ROLE_ORDER) out[r] = { ...ROLE_TARGET[r] };
  for (const rt of profile.allocation.roleTargets ?? []) {
    if ((ROLE_ORDER as string[]).includes(rt.role)) {
      out[rt.role as Role] = { ...out[rt.role as Role], target: rt.targetPct };
    }
  }
  return out;
}
```

> Note: `profile.ts` imports from `allocation.ts` and `policy.ts` only (one-way). `allocation.ts` must NOT import `profile.ts` (Task 6 keeps the override at the route layer) to avoid a cycle.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/profile.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/profile.ts __tests__/profile.test.ts
git commit -m "feat(profile): add profile loader, defaults, demo fallback, role-target resolver"
```

---

## Task 4: sample-data/ demo files

**Files:**
- Create: `sample-data/profile.json`
- Create: `sample-data/latest_snapshot.json`
- Test: `__tests__/sampleData.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/sampleData.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProfileSchema, SnapshotSchema } from "../lib/schemas";

const dir = join(process.cwd(), "sample-data");

describe("sample-data", () => {
  it("profile.json validates against ProfileSchema", () => {
    const raw = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
    expect(ProfileSchema.safeParse(raw).success).toBe(true);
  });
  it("latest_snapshot.json validates against SnapshotSchema", () => {
    const raw = JSON.parse(readFileSync(join(dir, "latest_snapshot.json"), "utf8"));
    expect(SnapshotSchema.safeParse(raw).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/sampleData.test.ts`
Expected: FAIL — files do not exist.

- [ ] **Step 3: Create the sample files (fictional: real tickers, fake numbers)**

Create `sample-data/profile.json`:

```json
{
  "version": 1,
  "goals": {
    "horizonYears": 15,
    "currentBaseline": 1000000,
    "ladder": [
      { "label": "Base", "value": 5000000, "likelihood": "high" },
      { "label": "Stretch", "value": 10000000, "likelihood": "med" }
    ],
    "notes": "Sample goal ladder — replace with your own in profile.json."
  },
  "allocation": {
    "buckets": [
      { "key": "equity", "label": "Equity", "targetPct": 80 },
      { "key": "debt", "label": "Debt-equivalent", "targetPct": 15 },
      { "key": "gold", "label": "Gold / hedges", "targetPct": 5 },
      { "key": "cash", "label": "Cash", "targetPct": 0, "floorPct": 0, "ceilingPct": 3 }
    ],
    "roleTargets": [
      { "role": "compounders", "targetPct": 30 },
      { "role": "growth", "targetPct": 25 },
      { "role": "cyclicals", "targetPct": 15 },
      { "role": "defensives", "targetPct": 10 },
      { "role": "hedges", "targetPct": 5 },
      { "role": "debt-equiv", "targetPct": 15 },
      { "role": "cash", "targetPct": 0 }
    ]
  },
  "limits": { "singleNameCapPct": 15, "usSingleNameCapPct": 25 },
  "strategy": { "convictionLevel": "unsure", "sectorViews": [] }
}
```

Create `sample-data/latest_snapshot.json` (fictional quantities on real tickers):

```json
{
  "asOf": "2026-01-01",
  "totalValue": 1250000,
  "cash": 25000,
  "equityValue": 1100000,
  "holdings": [
    { "ticker": "INFY", "qty": 100, "value": 150000, "pnlPct": 12.5, "market": "IN", "role": "compounders", "thesisHealth": "green" },
    { "ticker": "HDFCBANK", "qty": 80, "value": 140000, "pnlPct": 4.2, "market": "IN", "role": "compounders", "thesisHealth": "green" },
    { "ticker": "TATAMOTORS", "qty": 120, "value": 110000, "pnlPct": -6.1, "market": "IN", "role": "cyclicals", "thesisHealth": "amber" }
  ],
  "regime": "neutral"
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/sampleData.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add sample-data/profile.json sample-data/latest_snapshot.json __tests__/sampleData.test.ts
git commit -m "feat(profile): ship fictional sample-data + schema-validation test"
```

---

## Task 5: /api/profile read route

**Files:**
- Create: `app/api/profile/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/api/profile/route.ts` (mirror the pattern of an existing thin route, e.g. `app/api/triggers/route.ts`):

```ts
import { NextResponse } from "next/server";
import { loadProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { profile, isDemo } = await loadProfile();
    return NextResponse.json({ profile, isDemo });
  } catch (e) {
    return NextResponse.json(
      { error: "profile", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manually verify the route serves**

Run (dev server already on :3002, or `npm run lens:dev`):
`curl -s localhost:3002/api/profile | head -c 400`
Expected: JSON with `"isDemo":true` (no real `profile.json` in MEMORY_DIR yet) and the sample profile.

- [ ] **Step 4: Commit**

```bash
git add app/api/profile/route.ts
git commit -m "feat(profile): add /api/profile read route"
```

---

## Task 6: Wire profile role-target overrides into allocation

**Files:**
- Modify: `lib/allocation.ts` (signature of `loadAllocation`, lines ~251-318)
- Modify: `app/api/allocation/route.ts`

- [ ] **Step 1: Make `loadAllocation` accept a role-target override**

In `lib/allocation.ts`, change the signature and the lookup. Replace the function declaration line:

```ts
export async function loadAllocation(): Promise<AllocationPayload> {
```

with:

```ts
export async function loadAllocation(
  roleTargets: Record<Role, { target: number; band: [number, number] }> = ROLE_TARGET
): Promise<AllocationPayload> {
```

and inside the `ROLE_ORDER.map(...)` body replace:

```ts
    const { target, band } = ROLE_TARGET[role];
```

with:

```ts
    const { target, band } = roleTargets[role];
```

- [ ] **Step 2: Resolve from profile in the route**

Open `app/api/allocation/route.ts`. Add imports at top:

```ts
import { loadProfile, resolveRoleTargets } from "@/lib/profile";
```

Find the `loadAllocation()` call and replace it with:

```ts
  const { profile } = await loadProfile();
  const payload = await loadAllocation(resolveRoleTargets(profile));
```

(Use `payload` where the previous result variable was used; keep the rest of the route unchanged.)

- [ ] **Step 3: Verify compile + tests + behavior**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all tests pass.

Run: `curl -s localhost:3002/api/allocation | head -c 200`
Expected: 200 with role buckets (targets equal to sample/default values — unchanged on demo).

- [ ] **Step 4: Commit**

```bash
git add lib/allocation.ts app/api/allocation/route.ts
git commit -m "feat(profile): allocation role targets resolve from profile (defaults fallback)"
```

---

## Task 7: "DEMO DATA" badge in page.tsx

**Files:**
- Modify: `app/page.tsx` (the top-level dashboard component + a small fetch)

- [ ] **Step 1: Fetch isDemo and render a badge**

In `app/page.tsx`, near the other top-level data fetches in the dashboard component, add state + fetch:

```tsx
const [isDemo, setIsDemo] = useState(false);
useEffect(() => {
  fetch("/api/profile")
    .then((r) => r.json())
    .then((d) => setIsDemo(!!d.isDemo))
    .catch(() => setIsDemo(false));
}, []);
```

In the sidebar/header region (near the `LENS` wordmark / `StrategyInfoButton`), render a persistent badge when `isDemo`:

```tsx
{isDemo && (
  <span
    className="mono-true text-[10.5px] font-medium px-2 py-0.5 rounded-full"
    style={{ background: "var(--warn-tint)", color: "var(--warn)", border: "1px solid var(--warn-tint)" }}
    title="No profile.json found in your data dir — showing sample data. Add your data dir to see your portfolio."
  >
    DEMO DATA
  </span>
)}
```

(Match the exact placement to the existing header markup; reuse the `--warn-tint`/`--warn` tokens already used by the STALE pill.)

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manually verify the badge**

With no `profile.json` in MEMORY_DIR, load `localhost:3002` → the "DEMO DATA" badge shows. (When the owner's real data dir is present in later plans, `isDemo` is false and the badge is hidden.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(profile): show DEMO DATA badge when running on sample data"
```

---

## Task 8: Move onboarding seen-flag to ui_state.json

**Files:**
- Create: `app/api/ui-state/route.ts`
- Modify: `components/Onboarding.tsx` (replace the `localStorage` seen-flag with the API)

- [ ] **Step 1: Add the ui-state route (GET + POST)**

Create `app/api/ui-state/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { UI_STATE_FILE } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await readFile(UI_STATE_FILE, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({}); // no file yet → empty state
  }
}

export async function POST(req: Request) {
  try {
    const patch = await req.json();
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await readFile(UI_STATE_FILE, "utf8"));
    } catch {
      /* no file yet */
    }
    const next = { ...current, ...patch };
    await mkdir(dirname(UI_STATE_FILE), { recursive: true });
    await writeFile(UI_STATE_FILE, JSON.stringify(next, null, 2));
    return NextResponse.json(next);
  } catch (e) {
    return NextResponse.json(
      { error: "ui-state", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Use the route in Onboarding.tsx**

In `components/Onboarding.tsx`, replace the `localStorage` seen-flag logic:
- In the open effect, instead of `localStorage.getItem(SEEN_KEY)`, fetch `/api/ui-state` and read `onboardingSeenAt`:

```tsx
useEffect(() => {
  const forced = new URLSearchParams(window.location.search).get("onboarding") === "1";
  fetch("/api/ui-state")
    .then((r) => r.json())
    .then((s) => { if (forced || !s?.onboardingSeenAt) setOpen(true); })
    .catch(() => { if (forced) setOpen(true); });
  // ...keep the reopen listener as-is
}, []);
```

- In `finish()`, replace the `localStorage.setItem(SEEN_KEY, ...)` line with:

```tsx
fetch("/api/ui-state", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ onboardingSeenAt: new Date().toISOString() }),
}).catch(() => {});
```

Remove the now-unused `SEEN_KEY` constant and `localStorage` references.

- [ ] **Step 3: Verify compile + behavior**

Run: `npx tsc --noEmit`
Expected: clean.

Manually: load `localhost:3002/?onboarding=1` → onboarding shows; dismiss → `ui_state.json` is written in MEMORY_DIR (verify: `cat "$MEMORY_DIR/ui_state.json"` shows `onboardingSeenAt`). Reload `localhost:3002` (no query) → onboarding does NOT show.

- [ ] **Step 4: Commit**

```bash
git add app/api/ui-state/route.ts components/Onboarding.tsx
git commit -m "feat(onboarding): persist seen-flag to ui_state.json instead of localStorage"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all tests pass.

- [ ] **Step 2: Demo-mode smoke test**

With no `profile.json` in MEMORY_DIR: `npm run lens:dev`, open `localhost:3002` → DEMO DATA badge visible, allocation renders from sample targets, no console errors.

- [ ] **Step 3: Confirm no personal data introduced**

Run: `grep -rniE "17\.9|net.?worth" sample-data lib/profile.ts app/api/profile` 
Expected: no matches (sample data is fictional).

- [ ] **Step 4: Final commit if anything is staged**

```bash
git status -s
```

---

## Self-Review (completed during planning)

- **Spec coverage (this plan's slice):** Profile schema ✓ (§5, Task 1); `lib/profile.ts` loader + defaults/override ✓ (§8, Task 3); paths ✓ (Task 2); sample-data + demo fallback ✓ (§6, Tasks 4/7); `/api/profile` ✓ (§8, Task 5); allocation override ✓ (§8, Task 6); `ui_state.json` seen-flag ✓ (§6.5, Task 8). Deferred to Plans 2–4 (called out in header): research externalization, StrategyInfoModal, migration script, `DEPENDENCIES.md`, full success-criteria grep.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `Profile` type exported from `schemas.ts` and consumed by `profile.ts`; `Role`/`ROLE_TARGET`/`ROLE_ORDER` imported from `allocation.ts`; `loadAllocation(roleTargets)` signature matches `resolveRoleTargets` return type (`Record<Role,{target,band}>`).
- **Cycle check:** `profile.ts` → imports `allocation.ts` + `policy.ts` only; `allocation.ts` does NOT import `profile.ts` (override injected at the route). No cycle.
