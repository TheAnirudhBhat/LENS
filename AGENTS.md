# Agent Fast Start

Read this first. It describes the dashboard as it actually is today.

## What this is

- A local-first, single-user investing dashboard ("Lens").
- Stack: Next.js 16, React 19, Tailwind v4, TypeScript, Zod, Vitest.
- The main UI is one large client file: `app/page.tsx` (~12k lines). Most tab
  views are inline; News, Earnings, and Allocation are extracted into
  `components/`.

## How it's wired

- Data lives **outside** the repo, in a local Claude memory folder resolved by
  `lib/paths.ts` (`MEMORY_DIR`, override with `PORTFOLIO_MEMORY_DIR`). Always
  import path constants from `lib/paths.ts`; never hardcode the memory path or a
  username.
- API routes in `app/api/*` read those files (snapshot, mutual funds, US stocks,
  tasks, decisions, history, multibaggers, mf-rotations, indices) and call
  broker APIs (`lib/kite.ts`, `lib/indmoney.ts`). `/api/sync` does a
  deterministic refresh; `/api/news` tags headlines (LLM-optional).
- Secrets come only from `.env.local` via `process.env` (`KITE_API_KEY`,
  `KITE_API_SECRET`, `ANTHROPIC_API_KEY`). Never hardcode keys.

## Tabs a user sees

Overview · Allocation · Indian equity · US equity · Bonds · Mutual funds ·
research mirrors (IN / US / MF) · News · Earnings · Tasks · Decisions.

## Editing rules

- Preserve the visual language: quiet operational dashboard, low chrome,
  `surface` / `surface-subtle`, compact typography, tabular figures, centered
  overlays (`modal-backdrop` / `modal-card`). Rubik for product sans; Source
  Serif only for the brand wordmark. No third font family.
- Use `lib/paths.ts` for all data paths.
- After code edits, run `npx tsc --noEmit` (fast check) and `npm test`.
- `npm run build` needs network (Google Fonts); use `tsc` offline.

## History / direction

- An earlier, ambitious redesign plan ("Cockpit v2": a doctrine engine, a 5-seat
  council, conviction tiers, deploy cool-offs, behavioral guards) was **not**
  built — the project became the information-focused dashboard above. Those
  planning docs (`PRD.md`, `DOCTRINE.md`, `COUNCIL.md`, `IMPLEMENTATION_PLAN.md`,
  `STRATEGY.md`) and `_archive/` are **gitignored and not the current
  direction**. Do not resurrect that architecture unless explicitly asked.

## Next.js caveat

This is Next.js 16; conventions may differ from older training data. If touching
framework behavior, check `node_modules/next` rather than guessing.
