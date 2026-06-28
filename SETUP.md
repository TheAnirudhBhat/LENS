# Setup

LENS is a local-first investing dashboard. This is the exact, ordered path from
a fresh clone to a working app — first with bundled sample data, then with your
own.

## Prerequisites

- **Node.js 20 or newer** (check with `node -v`). That's it.
- No API keys, broker accounts, or corporate certificates are needed for the
  demo. If your machine *does* have a corporate TLS CA (e.g. Netskope), it is
  detected and used automatically; if it doesn't, it is silently skipped — the
  app no longer hardcodes that path, so the clone installs anywhere.

## See it in 30 seconds (demo data)

```bash
git clone <repo-url>
cd portfolio-dashboard
npm install
npm run demo
```

Then open **http://localhost:3002**.

`npm run demo` runs with `LENS_DEMO=1` and points the app at the bundled
`./sample-data/` directory, so the dashboard comes up fully populated with a
**fake** portfolio (RELIANCE / TCS / INFY on the Indian side, AAPL / MSFT /
GOOGL on the US side, a couple of index funds, round made-up amounts). A small
**DEMO DATA** pill sits in the bottom-left corner so you always know you're
looking at sample data, not a real book. None of it is anyone's real holdings.

## What you'll see

- **Overview** — net worth, day change, allocation snapshot, a portfolio health
  score, and a task inbox.
- **Allocation** — target vs. actual across equity / debt / gold / cash, with
  drift.
- **Indian equity · US equity · Bonds · Mutual funds** — per-asset holdings.
- **Research mirrors (IN / US / MF) · News · Earnings · Tasks · Decisions** —
  the analysis and journal surfaces.

Everything in demo mode reads from `./sample-data/`; edit those JSON / markdown
files and refresh to see the dashboard react.

## Use your own data

LENS ships **empty** — there is no real portfolio in the repo. To run it on your
own book:

```bash
npm run setup     # creates the local data directory + empty starter files
npm run dev       # http://localhost:3002  (reads your real data dir)
```

`npm run setup` runs `scripts/init-data.mjs`, which creates the data directory
(`<home>/.claude/projects/<home-as-slug>/memory` by default, or wherever
`PORTFOLIO_MEMORY_DIR` points) and seeds the empty files the app reads:
`latest_snapshot.json`, `us_stocks.json`, `bonds.json`, `tasks.json`,
`decisions.json`, `portfolio_history.json`, `profile.json`, and the rest. Until
those are filled, each tab shows its empty state.

**Filling the data is an agent job, not a manual one.** LENS is the *display*;
an agent is the *fill*. Point a coding agent (e.g. Claude Code) at the repo and
run the `/portfolio-check` flow: it pulls live holdings from your broker, diffs
against the last snapshot, and writes the JSON / markdown files in the data
directory. The dashboard renders whatever is there. See the README's "Keeping it
current" section for the loop.

### Optional `.env.local`

Copy `.env.example` to `.env.local` and fill in only what you use — it's
gitignored, so never commit real keys:

| Variable | Purpose |
|---|---|
| `KITE_API_KEY` / `KITE_API_SECRET` | Zerodha Kite Connect — live Indian holdings + LTP |
| `ANTHROPIC_API_KEY` | Optional — LLM news tagging; falls back to keyword tagging if absent |
| `PORTFOLIO_MEMORY_DIR` | Optional — override the data directory |

The demo needs none of these. The corporate CA bundle is auto-detected if
present and skipped if absent — you never have to set `NODE_EXTRA_CA_CERTS`.

## Troubleshooting

- **Port 3002 already in use** — stop the other process, or run on another port:
  `npm run dev -- -p 3010` (then open that port instead).
- **`npm run build` fails offline** — `next/font/google` fetches fonts at build
  time, so a production build needs network access. For an offline correctness
  check use `npx tsc --noEmit` instead; `npm run demo` / `npm run dev` run fine
  offline once `npm install` has completed.
- **A tab is empty in your own (non-demo) run** — that file hasn't been written
  yet. Run `npm run setup` if you skipped it, then have your agent run the sync
  flow to populate it.
- **Numbers look fake** — you're in demo mode (DEMO DATA pill, bottom-left). Use
  `npm run dev` for your real data dir; `npm run demo` is always sample data.
