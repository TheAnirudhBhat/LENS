# Lens Foundation — Plan 2: Research Externalization (US + MF candidates)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the only two hardcoded personal-research arrays out of `app/page.tsx` — `US_CANDIDATES` (14) and `MF_CANDIDATES` (13) — into per-user `research/us.json` + `research/mf.json` behind validated schemas, served by a new `/api/research/[market]` route with a sample-data demo fallback. After this, the source carries **zero** US/MF thesis text; the owner's dashboard renders **byte-identical**.

**Architecture:** Migration-first. (1) Relocate the candidate TYPES to a clean `lib/researchTypes.ts` (no data, stays in repo). (2) Relocate the DATA arrays to a temporary `lib/research-seed.ts`. (3) A one-off script serializes the seed into the owner's data dir as JSON. (4) Add `/api/research/[market]` (validates + demo fallback). (5) Repoint the two tabs from the imported consts to `fetch('/api/research/...')`, mirroring the existing `IndianResearchUnified` pattern. (6) Delete the seed module → source scrubbed. (7) Ship fictional sample data + tests.

**Tech Stack:** Next 16 app router, TypeScript, zod, vitest. No new deps.

**Inventory (from the read pass — this is the canonical map):**
- `USCandidate` type at `app/page.tsx:5251-5262`; `US_CANDIDATES` array at `5280-5695` (14 entries); rendered by `USResearchTab()` (~5697) via a direct const reference.
  - Fields: `ticker, name, sector, thesis, whyNow: string; score: number; confidence: "HIGH"|"MEDIUM-HIGH"|"MEDIUM"|"LOW"; verdict: Verdict ("Buy"|"Watch"|"Avoid"); tags: CouncilTag[]; council?: CouncilBreakdown` (5 seats fundamental/macro/risk/technical/sentiment, each `{ score, confidence, reason, source }`).
- `MFCandidate` type at `6259-6267`; `MF_CANDIDATES` array at `6269-6387` (13 entries); rendered by `MFResearchTab()` (~6389) via direct const reference.
  - Fields: `scheme, amc, category, fiveYCagr, thesis: string; score: number; confidence: <same enum>`.
- `MFResearchTab` has an inline `gaps` array (`~6392-6397`, 4 coverage-gap labels with personal % values).
- `Verdict`, `CouncilTag`, `CouncilBreakdown` types live in `page.tsx` and are also used elsewhere (e.g. `CONFLICT_TAGS_DOC`, `VERDICT_BANDS`) → they must MOVE to a shared types module, not be deleted.
- `app/page.tsx` is `"use client"`; research tabs fetch via `useEffect + fetch()`. `IndianResearchUnified` is the reference pattern (fetches `/api/watchlist` etc.).

**Out of scope (do NOT do here):**
- IN-equity research — already data-backed (watchlist/multibaggers/analysis). Nothing to change.
- `US_SECTOR_MAP` (`~5202-5279`, ticker→sector): public-style metadata like `tickerMeta` (spec §11 keeps that in-repo). **Leaves in repo.** Flag to the owner; can relocate later if they disagree.
- StrategyInfoModal goals/net-worth (Plan 3), migration of profile (Plan 4), brokers/agent setup.

---

## File Structure

- **Create** `lib/researchTypes.ts` — the candidate + council types (moved from page.tsx; no data). Shared by page.tsx, schemas, seed.
- **Create** `lib/research-seed.ts` — `US_CANDIDATES` + `MF_CANDIDATES` arrays (moved from page.tsx). **Temporary — deleted in Task 7.**
- **Modify** `lib/schemas.ts` — add `USCandidateSchema`, `MFCandidateSchema` (mirror researchTypes).
- **Create** `scripts/extract-research.ts` — one-off: seed → validated JSON in `MEMORY_DIR/research/`.
- **Create** `app/api/research/[market]/route.ts` — reads `research/<market>.json`, sample-data fallback, validates, serves `{ entries, isDemo }`.
- **Modify** `app/page.tsx` — move types/data out; repoint `USResearchTab`/`MFResearchTab` to fetch; remove seed import; relocate `gaps`.
- **Create** `sample-data/research/us.json`, `sample-data/research/mf.json` — fictional.
- **Modify** `lib/paths.ts` — add a small `researchFile(market)` helper if useful (optional).
- **Tests:** `__tests__/schemas.test.ts` (research schemas), `__tests__/research.test.ts` (loader/fallback), `__tests__/sampleData.test.ts` (validate sample research).

---

## Task 1: Relocate candidate + council types to `lib/researchTypes.ts`

**Files:** Create `lib/researchTypes.ts`; Modify `app/page.tsx`.

- [ ] **Step 1:** Read `app/page.tsx` and copy the EXACT definitions of `Verdict`, `CouncilTag`, `CouncilBreakdown` (+ any `CouncilSeat` sub-type), `USCandidate`, `MFCandidate` into a new `lib/researchTypes.ts`. Export each. Add no data, no React.
- [ ] **Step 2:** In `app/page.tsx`, delete those local type definitions and add `import type { Verdict, CouncilTag, CouncilBreakdown, USCandidate, MFCandidate } from "@/lib/researchTypes";` (include `CouncilSeat` if present). Leave the `US_CANDIDATES`/`MF_CANDIDATES` arrays and all rendering untouched.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. (tsc will flag any reference to a moved type that wasn't repointed; fix imports until clean.) `npx vitest run` → all pass.
- [ ] **Step 4:** Manual: `curl -s -o /dev/null -w "%{http_code}" localhost:3002/` → 200; the US/MF research tabs render unchanged.
- [ ] **Step 5:** Commit `lib/researchTypes.ts` + `app/page.tsx`: `git commit -m "refactor(research): extract candidate/council types to lib/researchTypes (no behavior change)"` (add the Co-Authored-By trailer used in prior commits).

---

## Task 2: Research schemas in `lib/schemas.ts`

**Files:** Modify `lib/schemas.ts`; Test `__tests__/schemas.test.ts`.

- [ ] **Step 1 (test first):** Append to `__tests__/schemas.test.ts` a `describe("research schemas")` with: a valid US candidate object (all fields incl. a `council` with the 5 seats) parses via `USCandidateSchema`; a US object missing `ticker` fails; a bad `confidence` value fails; a valid MF candidate parses via `MFCandidateSchema`; an MF object missing `scheme` fails. (Build the fixtures from the field list in the inventory.)
- [ ] **Step 2:** Run `npx vitest run __tests__/schemas.test.ts` → FAIL (schemas not exported).
- [ ] **Step 3:** Add `USCandidateSchema` and `MFCandidateSchema` to `lib/schemas.ts`, mirroring `lib/researchTypes.ts` EXACTLY (read it; same enums for `confidence`/`verdict`/`CouncilTag`, the council sub-schema with the 5 optional seats each `{ score: number, confidence: string, reason: string, source?: string }`). Keep `council`/`tags` optional where the type marks them optional. Export both schemas.
- [ ] **Step 4:** `npx vitest run __tests__/schemas.test.ts` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 5:** Commit `lib/schemas.ts` + the test: `git commit -m "feat(research): add US/MF candidate zod schemas"`.

---

## Task 3: Relocate the data arrays to `lib/research-seed.ts`

**Files:** Create `lib/research-seed.ts`; Modify `app/page.tsx`.

- [ ] **Step 1:** Move `US_CANDIDATES` (page.tsx 5280-5695) and `MF_CANDIDATES` (6269-6387) **verbatim** into a new `lib/research-seed.ts`. At the top: `import type { USCandidate, MFCandidate } from "@/lib/researchTypes";`. Export both arrays (`export const US_CANDIDATES: USCandidate[] = [...]`, same for MF). Copy the exact entries — do not edit values.
- [ ] **Step 2:** In `app/page.tsx`, delete the two array literals and add `import { US_CANDIDATES, MF_CANDIDATES } from "@/lib/research-seed";`. Leave `USResearchTab`/`MFResearchTab` rendering them exactly as before.
- [ ] **Step 3:** `npx tsc --noEmit` → clean; `npx vitest run` → pass; `curl localhost:3002/` → 200. The two tabs must look identical (byte-identical render — the arrays moved, not changed).
- [ ] **Step 4:** Commit: `git commit -m "refactor(research): relocate US/MF candidate arrays to lib/research-seed (temporary)"`.

> Note: source still contains the data here — that's the intermediate state. It's removed in Task 7. We're on a local branch (no push), so this is safe.

---

## Task 4: One-off migration script → owner's data dir

**Files:** Create `scripts/extract-research.ts`.

- [ ] **Step 1:** Create `scripts/extract-research.ts`:
```ts
// One-off: serialize the seed candidate arrays into the per-user data dir as
// research/{us,mf}.json, validated against the schemas. Run once by the owner.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESEARCH_DIR } from "../lib/paths";
import { US_CANDIDATES, MF_CANDIDATES } from "../lib/research-seed";
import { USCandidateSchema, MFCandidateSchema, parseOrThrow } from "../lib/schemas";
import { z } from "zod";

const us = z.array(USCandidateSchema).parse(US_CANDIDATES);
const mf = z.array(MFCandidateSchema).parse(MF_CANDIDATES);
mkdirSync(RESEARCH_DIR, { recursive: true });
writeFileSync(join(RESEARCH_DIR, "us.json"), JSON.stringify(us, null, 2));
writeFileSync(join(RESEARCH_DIR, "mf.json"), JSON.stringify(mf, null, 2));
console.log(`Wrote ${us.length} US + ${mf.length} MF entries to ${RESEARCH_DIR}`);
```
- [ ] **Step 2:** Run it: `npx tsx scripts/extract-research.ts` (use the repo's TS runner; if `tsx` isn't a dep, run via `node --import tsx` or add `tsx` dev-dep — check `package.json` first; vitest implies a TS toolchain). Expected: "Wrote 14 US + 13 MF entries to …/research".
- [ ] **Step 3:** Verify: `ls "$RESEARCH_DIR"` shows `us.json` (14) + `mf.json` (13); spot-check one US entry has its `council` intact. The `z.array(...).parse` guarantees they validate.
- [ ] **Step 4:** Commit the script only (the JSON lives in the external data dir, not the repo): `git commit -m "chore(research): add one-off extract-research migration script"`.

---

## Task 5: `/api/research/[market]` route + loader

**Files:** Create `app/api/research/[market]/route.ts`; Test `__tests__/research.test.ts`.

- [ ] **Step 1 (test first):** Create `__tests__/research.test.ts` testing a small loader `loadResearch(market, dir?)` (put it in `lib/research.ts`): real `research/us.json` in a temp dir → `{ entries, isDemo:false }` validated; absent → falls back to `sample-data/research/us.json` → `isDemo:true`; corrupt → throws (mirror the `lib/profile.ts` ENOENT-vs-throw pattern). Use temp dirs like `__tests__/profile.test.ts`.
- [ ] **Step 2:** Run → FAIL (no `lib/research.ts`).
- [ ] **Step 3:** Create `lib/research.ts` with `loadResearch(market: "us"|"mf", dir = RESEARCH_DIR)`: read `<dir>/<market>.json`; ENOENT → try `sample-data/research/<market>.json` (isDemo true); corrupt → throw (reuse the readJSON-with-ENOENT pattern from `lib/profile.ts`); validate with the matching schema (`z.array(USCandidateSchema)` / `MFCandidateSchema`). Then create `app/api/research/[market]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { loadResearch } from "@/lib/research";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  if (market !== "us" && market !== "mf")
    return NextResponse.json({ error: "bad market" }, { status: 400 });
  try {
    const { entries, isDemo } = await loadResearch(market);
    return NextResponse.json({ entries, isDemo });
  } catch (e) {
    return NextResponse.json({ error: "research", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
```
(Confirm the Next 16 dynamic-params signature against an existing `app/api/.../[x]/route.ts` if one exists, e.g. `app/api/per-ticker` or `mfnav`; match it.)
- [ ] **Step 4:** `npx vitest run __tests__/research.test.ts` → PASS; `npx tsc --noEmit` → clean; `curl -s localhost:3002/api/research/us | head -c 200` → JSON `entries` (real data, since the owner migrated in Task 4) with `isDemo:false`.
- [ ] **Step 5:** Commit `lib/research.ts` + route + test: `git commit -m "feat(research): add /api/research/[market] with demo fallback"`.

---

## Task 6: Repoint the tabs to fetch (remove the seed import)

**Files:** Modify `app/page.tsx`.

- [ ] **Step 1:** In `USResearchTab`, add a fetch hook mirroring `IndianResearchUnified`: `const [usCandidates, setUsCandidates] = useState<USCandidate[]>([]); useEffect(() => { fetch("/api/research/us").then(r=>r.json()).then(d=>setUsCandidates(d.entries ?? [])).catch(()=>setUsCandidates([])); }, []);` and replace every reference to the imported `US_CANDIDATES` with `usCandidates`. Do the same in `MFResearchTab` for `/api/research/mf` → `mfCandidates`.
- [ ] **Step 2:** Remove `import { US_CANDIDATES, MF_CANDIDATES } from "@/lib/research-seed";` from page.tsx.
- [ ] **Step 3:** `npx tsc --noEmit` → clean; `npx vitest run` → pass; `curl localhost:3002/` → 200. Manually confirm the US + MF research tabs render the same entries as before (now fetched).
- [ ] **Step 4:** Commit: `git commit -m "feat(research): US/MF research tabs read from /api/research instead of hardcoded arrays"`.

---

## Task 7: Delete the seed module — scrub the source

**Files:** Delete `lib/research-seed.ts`.

- [ ] **Step 1:** Confirm nothing imports it anymore: `grep -rn "research-seed" app lib` → only expectations are none (Task 6 removed the page.tsx import; the migration script in Task 4 imports it — decide: the script is a one-off already run; update it to read from the now-migrated JSON OR keep the script importing seed and exclude the script from the "scrubbed" guarantee). **Decision:** the script has served its purpose; change `scripts/extract-research.ts` to instead read from the data-dir JSON (idempotent re-export) OR delete the script too. Simplest: delete `scripts/extract-research.ts` AND `lib/research-seed.ts` together (the migration is done; keeping a personal-data-bearing script in source defeats the scrub).
- [ ] **Step 2:** Delete `lib/research-seed.ts` and `scripts/extract-research.ts`.
- [ ] **Step 3:** Verify the scrub: `git grep -niE "thesis|whyNow|fiveYCagr" -- app lib | grep -iv "schema\|type\|researchTypes\|interface"` → no real thesis prose remains in source (only type/schema field names). Spot-check: the specific US/MF tickers' thesis strings are gone from the repo.
- [ ] **Step 4:** `npx tsc --noEmit` → clean; `npx vitest run` → pass.
- [ ] **Step 5:** Commit: `git commit -m "refactor(research): remove seed module + migration script — US/MF research data now fully external"`.

---

## Task 8: Sample data + `gaps` + final verification

**Files:** Create `sample-data/research/us.json`, `sample-data/research/mf.json`; Modify `app/page.tsx` (gaps); Modify `__tests__/sampleData.test.ts`.

- [ ] **Step 1 (test):** Add to `__tests__/sampleData.test.ts`: `sample-data/research/us.json` validates against `z.array(USCandidateSchema)`; `mf.json` against `z.array(MFCandidateSchema)`.
- [ ] **Step 2:** Run → FAIL (files absent).
- [ ] **Step 3:** Create `sample-data/research/us.json` (2-3 FICTIONAL US candidates — real tickers e.g. NVDA/AVGO, invented thesis/score) and `sample-data/research/mf.json` (2-3 fictional MF candidates). Match the schema shape (include a `council` on at least one US entry to exercise it).
- [ ] **Step 4:** `gaps` array in `MFResearchTab`: move its 4 personal coverage-gap items into `research/mf.json` as a sibling (wrap the file as `{ candidates: [...], coverageGaps: [...] }`) OR — simpler — relocate `gaps` into `profile.strategy`/`strategy.md` (Plan 3 territory). **Decision for this plan:** keep `mf.json` a flat array of candidates; move the `gaps` strings into the owner's `research/mf.json` is awkward given the flat-array shape, so instead **lift `gaps` out as a small `coverageGaps` array fetched from a tiny extension of `/api/research/mf`** is over-engineering. Pragmatic: move the 4 `gaps` strings into `strategy.md` (Plan 3) and for now replace the hardcoded `gaps` with a short static, non-personal placeholder OR read from profile. **Flag this as a micro-decision for the owner during execution** — it's 4 strings, low risk; default: relocate to `strategy.md` notes and render nothing here until Plan 3 wires StrategyInfoModal. (If the owner wants it kept inline short-term, leave a non-personal generic line.)
- [ ] **Step 5:** `npx vitest run` (all, incl. sample research) → pass; `npx tsc --noEmit` → clean. Demo smoke: temporarily point `PORTFOLIO_MEMORY_DIR` at an empty dir (or test via the loader) → `/api/research/us` returns the fictional sample with `isDemo:true`.
- [ ] **Step 6:** Final scrub grep (success criterion): `git grep -niE "<a real US ticker thesis keyword>"` finds nothing in `app`/`lib`. Commit `git commit -m "feat(research): ship fictional sample research + validate; handle MF gaps"`.

---

## Self-Review (run during planning)

- **Spec coverage:** externalize hardcoded research (US+MF) ✓; IN already external (noted out of scope) ✓; schemas ✓ (T2); sample data + demo fallback ✓ (T5/T8); migration byte-identical ✓ (T3/T4 relocate-then-serialize, no value edits); reconciliation ✓ (inventory: no overlap, separate files); source scrubbed ✓ (T7). `US_SECTOR_MAP` consciously left as metadata (flagged).
- **Placeholder check:** the only soft spots are deliberate "read the exact type at page.tsx:NNNN and mirror it" (T1/T2) — concrete instructions tied to exact lines, not TBDs — and the `gaps` micro-decision (T8 Step 4), explicitly flagged for an owner call. Everything else has code/commands.
- **Type consistency:** `USCandidate`/`MFCandidate` defined once in `lib/researchTypes.ts`; consumed by page.tsx, schemas, seed, and the loader. `loadResearch` returns `{ entries, isDemo }`; the route + tabs use that shape.
- **Risk:** the big one is the page.tsx edits (T1, T3, T6) on a 12k-line file. Mitigation: each is a relocation/repoint with tsc + manual render check, on a local branch (rollback = the Plan-1 commits). Byte-identical is guaranteed because values are moved, then serialized, never re-typed.

---

## Execution Handoff

Subagent-driven (same as Plan 1): fresh implementer per task + spec-compliance then code-quality review. The page.tsx tasks (1, 3, 6) get full two-stage review; the additive ones (2, 4, 5, 8) get spec review + controller diff-check. Owner runs the Task-4 migration against their real data dir.
