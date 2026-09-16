# LENS Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship LENS as a public, self-hosted dashboard that contains **zero personal data and zero sample data** in source, and that the user's own AI agent populates on first run.

**Architecture:** The app already reads all real data from an external memory dir (`MEMORY_DIR`, see `lib/paths.ts`) that the `/portfolio-check` agent flow + the `indian-broker` MCP write to. This plan (a) removes the in-repo `sample-data/` fallback and every hardcoded personal value, (b) replaces them with clean empty states whose single call-to-action is "run `/portfolio-check`", (c) externalizes the Strategy modal to `strategy.md` and genericizes the ticker→logo map, (d) documents the first-run agent-fill flow, then (e) publishes a clean single-commit public repo. The user's *local* dashboard stays rich because their real strategy/holdings move to their external memory dir.

**Tech Stack:** Next.js 16.2 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, zod, vitest.

**Privacy invariant (non-negotiable):** After this plan, `git grep` over the committed tree finds no net worth, income, AUM, real holdings/tickers, theses, goals, council names, username, or API keys. This is gated in Task 8 before any push.

---

## File Structure

- `sample-data/**` — **deleted** (no demo data ships).
- `lib/paths.ts` — drop `SAMPLE_DATA_DIR`.
- `lib/profile.ts`, `lib/research.ts` — remove sample fallback; return typed-empty when the memory dir has no file.
- `app/api/profile/route.ts`, `app/api/research/[market]/route.ts` — no fallback; empty when absent.
- `app/page.tsx` — replace the "DEMO DATA" badge with a first-run/empty state; per-tab empty states.
- `components/EmptyState.tsx` — **new**, one reusable empty/first-run block.
- `components/StrategyInfoModal.tsx` — Strategy tab renders from external `strategy.md`; generic template fallback.
- `lib/tickerMeta.ts` — trim to a small generic public-company reference; drop personal small-caps / watchlist / bond NCDs.
- `__tests__/parsers.test.ts` — fictional fixtures.
- `app/api/news/route.ts`, `lib/parsers.ts` — genericize personal code comments.
- `SETUP.md` — **new**, first-run agent-fill flow. `README.md` — open-source framing.
- `package.json` — `name` → `lens`.

---

## Task 1: Remove the sample-data fallback

**Files:**
- Delete: `sample-data/` (entire directory)
- Modify: `lib/paths.ts` (remove `SAMPLE_DATA_DIR`), `lib/profile.ts`, `lib/research.ts`

- [ ] **Step 1:** Read `lib/profile.ts` + `lib/research.ts` + both API routes to find every reference to `SAMPLE_DATA_DIR` / sample fallback.
- [ ] **Step 2:** Make the loaders return typed-empty when the `MEMORY_DIR` file is missing: profile → `null`; research → `[]`. No reads from `sample-data/`.
- [ ] **Step 3:** Delete the `sample-data/` directory and the `SAMPLE_DATA_DIR` constant.
- [ ] **Step 4:** `npx tsc --noEmit` → clean. `npx vitest run` → green (fix any test that imported sample data).
- [ ] **Step 5:** Commit: `chore(release): drop in-repo sample data; loaders return empty when no memory dir`.

## Task 2: First-run state replaces the DEMO badge

**Files:**
- Modify: `app/page.tsx` (the `isDemo` / "DEMO DATA" logic from P1·T7)
- Create: `components/EmptyState.tsx`

- [ ] **Step 1:** Build `EmptyState` (title, one line of copy, a `<Cmd>/portfolio-check</Cmd>` chip). Match dashboard tokens.
- [ ] **Step 2:** Replace `isDemo` with `isEmpty` (true when profile/holdings are absent). Remove the "DEMO DATA" label entirely.
- [ ] **Step 3:** When `isEmpty`, the Overview hero shows the `EmptyState` ("LENS is empty. Run `/portfolio-check` and your agent fills it.") instead of zeroed stats.
- [ ] **Step 4:** `npx tsc --noEmit` clean. Commit: `feat(release): first-run empty state, remove demo badge`.

## Task 3: Empty states for every tab

**Files:** `app/page.tsx` (Overview, Allocation, IN/US equity, Bonds, Mutual funds, Research mirrors, News, Earnings, Tasks, Decision tracker), `components/EarningsTab.tsx`

- [ ] **Step 1:** With an empty `MEMORY_DIR` (temporarily point `PORTFOLIO_MEMORY_DIR` at an empty temp dir), run the dev server and visit every tab. Note which crash, loop on a skeleton, or show raw zeros.
- [ ] **Step 2:** For each, render `EmptyState` when its data source is empty (no infinite skeleton, no NaN, no crash).
- [ ] **Step 3:** `npx tsc --noEmit` clean; re-walk every tab empty → clean. Commit: `feat(release): graceful empty states across tabs`.

## Task 4: Externalize the Strategy modal (Plan 3)

**Files:** `components/StrategyInfoModal.tsx`, `lib/profile.ts` (or a small `app/api/strategy` reader), `lib/paths.ts` (`STRATEGY_FILE` already exists)

- [ ] **Step 1:** Add a reader for `STRATEGY_FILE` (`MEMORY_DIR/strategy.md`). Render the Strategy tab from that markdown when present.
- [ ] **Step 2:** When absent, render a **generic template** (the section scaffold with placeholder guidance, e.g. "Your goal ladder lives in `strategy.md`; your agent drafts it during setup") — no real numbers, holdings, council names, or dates.
- [ ] **Step 3:** Migration (local only, not committed): write the user's current hardcoded strategy text into their `MEMORY_DIR/strategy.md` so their local dashboard keeps it.
- [ ] **Step 4:** Remove all hardcoded personal content from `StrategyInfoModal.tsx`. `npx tsc --noEmit` clean. Commit: `feat(release): strategy tab reads strategy.md, generic template fallback`.

## Task 5: Genericize the ticker→logo map

**Files:** `lib/tickerMeta.ts`

- [ ] **Step 1:** Replace `TICKER_META` with a small public-company reference set: global large-caps (AMZN, AAPL, MSFT, GOOGL, NVDA, META, TSLA) + a handful of well-known Indian large-caps. Remove personal small-caps, the "watchlist (not yet held)" block, the bond NCDs, and the "your holdings" comments.
- [ ] **Step 2:** Confirm `getMeta` still falls back to `{ name: ticker }` + letter avatar for unknown tickers (so the agent's later holdings render fine, just without a curated logo).
- [ ] **Step 3:** `npx tsc --noEmit` clean. Commit: `refactor(release): genericize ticker reference map, drop personal names`.

## Task 6: Scrub test fixtures and code comments

**Files:** `__tests__/parsers.test.ts`, `app/api/news/route.ts`, `lib/parsers.ts`

- [ ] **Step 1:** Rewrite `parsers.test.ts` fixtures with fictional tickers + round fictional amounts (e.g. `DEMOFLEXI — Demo Flexi Cap`, invested `₹1,00,000`). Keep every assertion valid (logic unchanged).
- [ ] **Step 2:** Genericize the personal comments in `news/route.ts` (~L1097 watchlist names) and `lib/parsers.ts` (~L321 MF examples).
- [ ] **Step 3:** `npx vitest run` green; `npx tsc --noEmit` clean. Commit: `test(release): fictional parser fixtures; scrub comments`.

## Task 7: First-run docs

**Files:** Create `SETUP.md`; modify `README.md`; verify `AGENTS.md` + `docs/**` carry no personal data.

- [ ] **Step 1:** `SETUP.md`: prerequisites, `cp .env.example .env.local`, `npm install`, `npm run lens`, open the dashboard, connect a broker, run `/portfolio-check` → it writes to the memory dir → dashboard fills. State that no data ships and the agent populates everything.
- [ ] **Step 2:** Trim `README.md` to the open-source framing (what LENS is, the agent-driven model, link to `SETUP.md`).
- [ ] **Step 3:** `git grep` `AGENTS.md` + `docs/**` for personal values; genericize any. Commit: `docs(release): SETUP + README for self-hosted agent-fill`.

## Task 8: Final privacy gate + publish

**Files:** `package.json`; git.

- [ ] **Step 1:** Run the privacy gate over the whole tree:
```bash
git grep -nIiE '(net.?worth|₹[0-9][0-9.,]*\s*(Cr|cr|L|lakh)|17\.93|saurabh|maya|priya|raghav|kapur|anirudh|slicebank|KAVACH|PPFCAP|NETWEB|ARTEMISMED|HBLPOWER|\bNKE\b|\bABT\b|\bRIVN\b)' -- . ':(exclude)docs/superpowers/**'
```
Expected: **no hits** in shipped source (plan docs under `docs/superpowers/` may reference scrub targets and are acceptable, or exclude them from the repo). Fix every hit before continuing.
- [ ] **Step 2:** Confirm `.gitignore` still covers `.env*` (except `.env.example`), `*.pem`, `.key*`, the personal docs, and the memory dir. Confirm `.env.local` is **not** staged.
- [ ] **Step 3:** `package.json` `name` → `lens`. `npm run lens` (prod build) succeeds.
- [ ] **Step 4:** Clean history: `git checkout --orphan release-main && git add -A && git commit -m "LENS: self-hosted, agent-driven investing dashboard"`. (Keeps the personal history on the old branch, local-only.)
- [ ] **Step 5:** `gh repo create LENS --public --source=. --remote=lens` then `git push lens release-main:main`. Do **not** push any other branch.
- [ ] **Step 6:** Open the repo on GitHub; confirm the tree shows no personal data and `.env.local` is absent. Report the URL.

---

## Self-Review

- **Spec coverage:** zero sample data (T1), zero personal source (T4/T5/T6/T8 gate), empty-state + agent-fill model (T2/T3/T7), clean public push (T8). Covered.
- **Local UX preserved:** T4 migrates the user's strategy to their memory dir; their holdings already live there. tickerMeta small-caps degrade to letter avatars locally until the agent enriches (accepted tradeoff, noted).
- **Risk:** T3 (empty states) is the least-specified — it requires inspecting each tab's render path, so its first step is an explicit empty-dir walk.
- **Gate before push:** T8 Step 1 is the hard privacy gate; nothing pushes until it returns clean.
