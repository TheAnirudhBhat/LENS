# Portfolio Dashboard

A simple, local web dashboard built on **one source of truth** (`portfolio.json`).
You update your holdings from the app; an AI agent (Claude or Gemini) fills four
advisory sections by following `GLOBALS.md`. Everything runs locally on Python's
standard library — nothing is installed, no system packages are touched.

## Launch

Double-click **`start_dashboard.command`**. It starts a tiny local server and opens
the dashboard. (The server is what lets the in-app upload write files.)

## The two things you do

**1. Update your portfolio.** Click **Update Portfolio** in the app. Export your two
statements from Groww and upload them one by one — Stocks/ETFs, then Mutual Funds.
The app rebuilds `portfolio.json` (backing up the previous version) and the numbers
refresh. Personal details (name, PAN, mobile) are never written into the data.

**2. Ask an agent to update the advisory tabs.** With this folder open in Claude or
Gemini, say:

> "Read GLOBALS.md and update my dashboard."

The agent does four jobs and writes the results into `data/` — you'll see them on
these tabs:

- **Sectors** — which business sector each holding is in (found via web search).
- **Holding Changes Suggested** — buy/sell/adjust ideas based on `goals.md`.
- **New Picks For You** — fresh higher-conviction ideas from market news.
- **Insights** — where you stand, risks, and good calls (no buy/sell here).

You can also ask for just one: *"follow GLOBALS.md task 2 and suggest holding
changes."* Each tab shows when it was last updated and flags itself if your
portfolio changed since.

## Files

| File | What it is |
| --- | --- |
| `portfolio.json` | **Single source of truth** — your holdings. |
| `dashboard.html` | The dashboard (6 tabs + Update Portfolio overlay). |
| `server.py` | Tiny local server: serves the app + handles uploads. |
| `start_dashboard.command` | Double-click to launch. |
| `goals.md` | Your risk appetite, horizon, monthly budget. Edit freely. |
| `GLOBALS.md` | The instructions an AI agent follows to fill the advisory tabs. |
| `news_engine.py` | Free financial-news CLI the agent uses. |
| `convert_groww.py` / `portfolio_lib.py` | Build `portfolio.json` from Groww xlsx. |
| `instruments.json` | ISIN → clean name/type/sector map (edit when you buy new). |
| `data/*.json` | The four advisory files the agent writes. |
| `backups/` | Last 3 versions of `portfolio.json` (`python3 revert.py --list`). |
| `legacy/` | The previous goal-tracking engine, kept for reference. |

## Notes

- **No internet needed for the dashboard.** Only `news_engine.py` and the agent's web
  searches reach out, and they run on your machine.
- **Edit `goals.md` anytime** — it's plain English; the agent adapts.
- _Not financial advice. Suggestions and insights are for your own decision-making._
