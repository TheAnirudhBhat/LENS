# LENS

A local-first, single-user investing cockpit for one personal multi-asset book —
Indian equity, US equity, bonds, mutual funds, gold, and cash — with news,
earnings, allocation drift, a portfolio score, a task inbox, and a decision tracker.

It is an **instrument panel**, not a trading system: it reads data that other
tools (broker pulls, a periodic refresh routine) write to local files, and
presents it. It does not place orders.

**It ships empty.** There is no bundled portfolio. You point it at a data
directory and your own agent fills it — see "Keeping it current" below.

## Stack

- Next.js 16, React 19, Tailwind v4
- TypeScript, Zod for input validation at API boundaries
- Vitest for parser/schema tests
- Recharts for charts; Anthropic SDK (optional) for news tagging

## Run

```bash
npm install
npm run dev        # http://localhost:3002
```

Other scripts:

```bash
npm run lens       # production build + start on :3002 (daily-use mode)
npm run lens:dev   # dev server on :3002 (editing mode)
npx tsc --noEmit   # fast typecheck
npm test           # vitest
```

> `npm run build` fetches Google Fonts at build time (`next/font/google`), so it
> needs network access. `npx tsc --noEmit` is the offline-safe compile check.

## Configuration

Copy `.env.example` to `.env.local` and fill in what you use:

| Variable | Purpose |
|---|---|
| `KITE_API_KEY` / `KITE_API_SECRET` | Zerodha Kite Connect (live IN holdings + LTP) |
| `ANTHROPIC_API_KEY` | Optional — enables LLM news tagging; falls back to keyword tagging if absent |
| `PORTFOLIO_MEMORY_DIR` | Optional — override the data directory (see below) |
| `INDMONEY_MCP_JS` / `INDMONEY_BROWSER_DATA_DIR` | Optional — paths to the sibling INDmoney MCP agent |

`.env.local` is gitignored. Never commit real keys.

## Data directory

The dashboard does not store holdings in this repo. It reads local JSON /
markdown files that live outside it:

```
<home>/.claude/projects/<home-as-slug>/memory
```

The slug is derived from your home path automatically (`lib/paths.ts`); set
`PORTFOLIO_MEMORY_DIR` to point somewhere else. Expected inputs include
`latest_snapshot.json`, `project_mutual_funds.md`, `us_stocks.json`,
`tasks.json`, `decisions.json`, and `portfolio_history.json`. These are personal
and are **not** part of this repository.

## Keeping it current (the agent loop)

LENS is the *display*; an agent is the *fill*. The intended setup is a coding
agent (e.g. Claude Code) running a periodic sync routine — pull live holdings
from your broker, diff against the last snapshot, and write the JSON/markdown
files in the data directory. The dashboard reads whatever is there and renders
it; everything is empty-state until the first sync runs. None of that personal
data lives in this repo — only the code that reads it. Bring your own routine,
broker credentials (via `.env.local`), and data directory.

## Layout

- `app/page.tsx` — dashboard shell + most tab views (large single client file)
- `app/api/*` — read/sync routes over the local data files and broker APIs
- `components/` — extracted tabs (News, Earnings, Allocation) + cards + a small `ui/` kit
- `lib/` — data parsers, schemas, broker clients, allocation/analytics, path constants
- `__tests__/` — vitest coverage for the markdown parsers and zod schemas

## Notes

- Personal planning/strategy docs (net worth, holdings, thesis) are kept local
  and gitignored — they are not in this repo.
- `.git` was reinitialized; history starts from the first clean commit.
