# Lens — Foundation: Code / Data Separation (Design)

- **Date:** 2026-05-30
- **Status:** Draft for review
- **Scope:** Sub-project #1 of the "make Lens a self-hosted product" track. Foundation only.
- **Product:** Lens — a local-first, single-user investing cockpit. This spec makes the code shareable by moving all personal data out of the source.

## 1. Context & goal

Lens already reads holdings from an external data directory (`MEMORY_DIR`), but a lot of **personal data is still hardcoded in the source**: ~39 research/thesis/candidate entries in `app/page.tsx`, the user's goals + strategy in `components/StrategyInfoModal.tsx`, and target allocations / caps in `lib/policy.ts`, `lib/allocation.ts`, plus the tracked universe in `lib/tickerMeta.ts`.

**Goal:** finish the **code / data split** so the repo carries **zero personal data**, all of it lives in a per-user data directory behind validated schemas, and the repo ships with generic **sample data** so a fresh clone runs.

**Hard success test:** with the owner's data directory in place, their Lens renders **byte-identical** to today. With no data directory, a fresh clone shows a clearly-badged **demo**.

## 2. Core principle

> **Code is generic and public. Data is per-user and local.** The source contains logic, schemas, defaults, and sample data — never a real holding, number, thesis, or goal.

## 3. Scope

**In scope (this spec):**
- Externalize every hardcoded personal-data site into the data directory.
- Define a per-user **Profile** (goals, allocation targets, limits, sector views + conviction).
- Define schemas + ship sample/demo data + a demo fallback.
- A one-time **migration** that writes the owner's current hardcoded values into their data dir, so nothing visibly changes for them.
- Refactor the affected components/libs to read from data.
- A **minimal first-run onboarding one-pager** (shown once after first install) explaining *how to use Lens* — its discipline + decision-making value. Testable on demand. (See §6.5.)

**Out of scope (later sub-projects — do NOT build here):**
- #2/#3 multi-broker fetch (Kite + Groww + INDmoney) and bundled skills (`/portfolio-check`, `screener-research`).
- #4 agent-driven setup + strategy-discovery flow (the conviction-gated, subagent fan-out research).
- #5 encryption at rest. #6 the **full** multi-step web onboarding. (The minimal one-pager in §6.5 *is* in scope; the rich guided flow with broker-connect + goal capture is later.)

The foundation only makes the data **externalized and schema-defined** so those plug in cleanly later. (YAGNI: we define the Profile fields they need, but we do not build the flows that populate them.)

## 4. Inventory — what's hardcoded → where it goes

| Source today | Content | Destination |
|---|---|---|
| `app/page.tsx` (~39 `thesis:`/`rationale:`/`WHY:` entries; `US_CANDIDATES`, `MF_CANDIDATES`, IN research/idea arrays) | research ideas, candidates, thesis, position notes | `research/in.json`, `research/us.json`, `research/mf.json` (per-user) — reconcile with existing `project_stock_watchlist.md`, `project_mf_rotations.json`, `multibagger_scans/` |
| `components/StrategyInfoModal.tsx` | goal ladder, net worth, levers, role buckets, rules, anti-patterns | `profile.json` (structured: goals/targets) + `strategy.md` (prose: levers/rules/anti-patterns) |
| `lib/policy.ts` | SAA targets, drift bands, single-name caps, US reassess/trim thresholds | **defaults stay in code**; per-user values move to `profile.limits` / `profile.allocation` and override defaults |
| `lib/allocation.ts` | `ROLE_TARGET` role-bucket targets | `profile.allocation.roleTargets` (defaults in code) |
| `lib/tickerMeta.ts` | ticker → {name, sector, marketCap, isBond} | **stays in repo** as shared reference (public market metadata, not personal). User-added tickers can extend it via an optional `ticker_overrides.json`. |

> The **exact enumeration** of every hardcoded array/site in `page.tsx` is the **first task of the implementation plan** (a grep + read pass). This spec defines the schemas and mechanic; the plan nails the precise line-level inventory.

## 5. Data model

The per-user data dir is the existing `MEMORY_DIR` (`lib/paths.ts`, env-overridable via `PORTFOLIO_MEMORY_DIR`, slug derived from `os.homedir()` — no hardcoded username).

**New file — `profile.json`** (zod-validated in `lib/schemas.ts`, loaded via a new `lib/profile.ts`):

```ts
type Profile = {
  version: 1;
  goals: {
    horizonYears?: number;
    currentBaseline?: number;            // the user's "today" figure (optional)
    ladder: { label: string; value: number; impliedCagrPct?: number;
              likelihood?: "high" | "med" | "low" }[];
    notes?: string;
  };
  allocation: {
    buckets:   { key: string; label: string; targetPct: number;
                 bandPct?: number; floorPct?: number; ceilingPct?: number }[];
    roleTargets?: { role: string; targetPct: number }[];
  };
  limits?: {                              // absent → code defaults apply
    singleNameCapPct?: number;            // e.g. 12
    usSingleNameCapPct?: number;
    reassessDrawdownPct?: number;         // e.g. -25
    trimGainPct?: number;                 // e.g. +35
    idleCashThreshold?: number;
  };
  strategy: {                             // anticipates #4 strategy-discovery
    convictionLevel?: "high" | "medium" | "low" | "unsure";
    formedBy?: "user" | "agent" | "hybrid";
    sectorViews?: { sector: string; stance: "bullish" | "neutral" | "bearish";
                    confidence: number; source?: "user" | "agent" }[];
    lastReviewed?: string;               // ISO
  };
};
```

**New file(s) — research entries** (`research/{in,us,mf}.json`):

```ts
type ResearchEntry = {
  market: "IN" | "US" | "MF";
  ticker?: string;
  name: string;
  category?: string;                      // sector / fund category
  status?: "candidate" | "watch" | "held" | "trim" | "exit";
  thesis?: string;
  rationale?: string;
  source?: string;
  score?: number;
  confidence?: "high" | "med" | "low";
  exitRule?: string;
  addedAt?: string;
  lastVerified?: string;                  // age-badging / idea integrity
};
```

**New file — `strategy.md`**: freeform prose (levers, decision rules, anti-patterns). Rendered as-is in StrategyInfoModal alongside the structured `profile` data.

Defaults vs overrides: `lib/policy.ts` and `lib/allocation.ts` keep **sensible generic defaults** (a reasonable 80/15/5-style template, a 12% cap, etc.). The Profile **overrides** them where present. This is what lets a fresh clone work with zero config.

## 6. Sample data & demo fallback

- Ship `sample-data/` in the repo: a generic `profile.json`, a few example `research/*.json` entries, a tiny synthetic `latest_snapshot.json` / `us_stocks.json` / MF file. **All fictional.**
- Resolver: if `MEMORY_DIR` has no `profile.json` (fresh clone), Lens loads `sample-data/` and shows a persistent **"DEMO DATA"** badge. If real data is present, it's used and the badge disappears.
- Benefits: clone-and-run, schemas documented by example, empty/demo states testable.

## 6.5 First-run onboarding — one-pager

A single, value-first screen **shown once after first install** that teaches *how to use Lens* — not a feature tour, a usage philosophy. Minimal placeholder; the full guided onboarding is a later sub-project (#6).

**When it shows:** first run only. A `ui_state.json` in the data dir records `onboardingSeenAt`; absent → show, then stamp it. (A fresh clone on demo data sees it too.)

**Testability (you want to test the flow):** `?onboarding=1` force-opens it regardless of the flag, and a quiet "How to use Lens" link in the sidebar reopens it anytime — so copy/flow can be iterated without reinstalling.

**Form:** centered overlay using the existing `modal-backdrop` / `modal-card` pattern (no new design language); the dashboard/demo sits behind it.

**Content (one page, value-first):**
- *What Lens is:* your whole book in one place + a memory of your decisions. A thinking tool, not a trading app.
- *Why it helps:* **discipline + better decisions** — consolidates fragmented accounts and remembers *why* you acted, so you stop repeating mistakes.
- *The loop:*
  1. **Sync** your book on a cadence (weekly default).
  2. **Journal** every move — log the decision + a one-line exit rule *before* you act.
  3. **Act on the inbox** — Lens surfaces drift, concentration, stale theses, divergence from your strategy; clear the top items.
  4. **Review** your hit-rate over time — the metric that actually makes you better.
- *CTA:* "Explore the demo" now; "Connect your accounts" once fetch lands (#3).

**Scope guard:** copy + the loop only. No interactive setup, broker connect, or goal capture here — those belong to the agent-driven setup (#4) and full onboarding (#6).

## 7. Migration — the byte-identical guarantee

A one-time, owner-run migration (`scripts/extract-personal-data.ts` plus, where needed, agent-assisted export):
1. Captures the current hardcoded values. The `lib/policy` / `lib/allocation` constants are plain imports. The `page.tsx` research arrays live inside a `"use client"` component, so the cleanest path is to **temporarily export them** (or have the agent transcribe them) into the JSON files — the exact mechanism is a plan decision; what matters is the values land in data losslessly.
2. Writes them into the owner's data dir: `profile.json`, `strategy.md`, `research/*.json`.
3. The owner verifies the files look right.

Then the refactor (below) deletes the hardcoded versions and reads from data. **Verification:** screenshot/compare key tabs before vs after — must match. Because the owner's data dir reproduces exactly what was hardcoded, their Lens is unchanged.

## 8. Code affected

- `lib/schemas.ts` — add `ProfileSchema`, `ResearchEntrySchema`.
- `lib/profile.ts` (new) — load + validate Profile, merge with code defaults. Single source for "the user's strategy config."
- `lib/paths.ts` — add `PROFILE_FILE`, `STRATEGY_FILE`, `RESEARCH_DIR`; add the sample-data fallback resolver.
- `lib/policy.ts`, `lib/allocation.ts` — read targets/caps from Profile (fallback to in-file defaults).
- `components/StrategyInfoModal.tsx` — render from `profile` + `strategy.md` (no hardcoded numbers).
- `app/page.tsx` — research tabs read from `research/*.json` via API (extend `/api/watchlist`, `/api/mfrotations`, add `/api/research` as needed); remove the hardcoded arrays.
- `app/api/*` — a thin `/api/profile` read route; reconcile research routes.
- `scripts/extract-personal-data.ts` (new) — the one-time migration.
- `sample-data/` (new) — generic demo data.
- `.gitignore` — ensure the real data dir / any owner exports stay out (already external; sample-data is committed, real data is not in-repo).
- `components/Onboarding.tsx` (new) — the first-run one-pager overlay; reads/stamps `onboardingSeenAt`; honors `?onboarding=1` + a sidebar "How to use Lens" link to reopen.
- `lib/paths.ts` + `app/api/ui-state` (new) — `UI_STATE_FILE` (`ui_state.json`) + a thin read/write route for the seen flag.

## 9. Requirements (dependency + API manifest)

Committed as `DEPENDENCIES.md`. Summary:

- **Runtime (npm):** next 16, react/react-dom 19, tailwindcss v4, zod, recharts, kiteconnect, @anthropic-ai/sdk; dev: typescript, vitest, happy-dom.
- **Bundled tools/processes (later sub-projects):** Playwright+Chromium (Groww/Zerodha/INDmoney logins + Screener.in), the `indian-broker` MCP, a Claude agent runtime, bundled skills `/portfolio-check` + `screener-research`.
- **External APIs/services:** Zerodha Kite Connect (key+secret, ~₹500/mo), Groww + INDmoney (Playwright login — no clean public API), Anthropic API (token cost; first fetch heavy), Screener.in, MFAPI.in, Yahoo Finance, moneycontrol, RSS/Google News, niftyindices.
- **Per-user secrets (`.env.local`, gitignored):** `KITE_API_KEY`/`SECRET`, Groww creds, `ANTHROPIC_API_KEY`, optional path overrides.

For the **foundation specifically**, the only hard runtime dependency is the existing npm stack — none of the brokers/skills are needed to run on sample data.

## 10. Success criteria

- [ ] `grep` of committed files finds **no** real net worth, holdings, thesis, goals, or username.
- [ ] Owner's Lens (pointed at their data dir) renders byte-identical to today (visual + numeric spot-check on Overview, Allocation, the 3 research tabs, StrategyInfoModal).
- [ ] Fresh clone with no data dir shows the demo dashboard with a DEMO badge.
- [ ] `profile.json` and `research/*.json` validate against their schemas; invalid data fails loudly.
- [ ] `npx tsc --noEmit` clean; `npm test` passes (add tests for `lib/profile.ts` + new schemas).
- [ ] Profile schema carries goals + allocation + limits + sector views + conviction (ready for #4).
- [ ] Onboarding one-pager shows once after first install, never again after dismissal; `?onboarding=1` reopens it; copy explains the discipline/decision value (not a feature tour).

## 11. Key decisions & alternatives

- **tickerMeta stays in-repo** (vs per-user): it's public market metadata; shipping it helps every user. Personal-ness comes from *which* tickers you hold (snapshot), not the lookup table. *Alt rejected:* moving it out adds friction for zero privacy gain.
- **Defaults in code + Profile overrides** (vs everything in data): a fresh clone must run without a hand-authored profile. *Alt rejected:* requiring a full profile up front breaks clone-and-run.
- **Structured `profile.json` + prose `strategy.md`** (vs one blob): structured data drives views (goals table, allocation); prose stays human. *Alt rejected:* a single markdown is harder to render into the existing UI reliably.
- **Migration script seeds owner data** (vs hand re-entry): guarantees byte-identical and is the safety net for the refactor.

## 12. Risks & mitigations

- **Refactoring an 11.9k-line `page.tsx` with research arrays woven in** → risk of visual regression. *Mitigation:* migration-first (data exists before code changes), screenshot diff, the local git baseline (commit `4dd1226`) as rollback.
- **Research data reconciliation** (hardcoded arrays vs existing watchlist/rotations/scans files may overlap) → *Mitigation:* explicit reconciliation step in the plan; one home per entry type.
- **Sample data drifting from real schema** → *Mitigation:* validate sample-data against the same zod schemas in a test.

## 13. Open questions

1. Research data: do the ~39 hardcoded entries fully overlap the existing `watchlist`/`mf_rotations`/`multibagger_scans` files, or are some net-new? (Resolved by the inventory pass — first plan task.)
2. Should `strategy.md` be one file or split (goals vs rules vs anti-patterns)? Lean: one file, sectioned.
3. Demo data realism: fully fictional tickers, or real tickers with fictional positions? Lean: real tickers (e.g., INFY, AAPL), fictional quantities — looks real, leaks nothing.
