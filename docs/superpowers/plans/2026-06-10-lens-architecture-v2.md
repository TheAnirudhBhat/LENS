# LENS Architecture v2 — flow, data layer, and sources (researched plan)

> Status: PROPOSED. Research verified 2026-06-10 (see agent citations in plan history). Companion to `2026-06-10-research-stack-mf-us-backtest.md` (W0-W4) — this plan is the TECH substrate under it.

## Eagle-eye diagnosis (what's actually wrong)

| Pain | Root cause | Fix (researched) |
|---|---|---|
| `/portfolio-check` is slow + manual | Pulls run sequentially; agent-driven only | Parallel `Promise.all` pulls + launchd scheduled refresh |
| Yahoo 429s break backtests/earnings | yfinance/Yahoo on the hot path | Kite Connect historical (already licensed, now bundled ₹500/mo) for NSE; stooq CSV (keyless) + Finnhub (60/min) for US |
| No history/queryability (drift over time, XIRR, backtests all ad-hoc) | Flat JSON files, latest-state-only | **DuckDB** as time-series store; JSON files become generated views (agent workflow unchanged) |
| MF holdings scrape is fragile | Groww `__NEXT_DATA__` undocumented | **AMFI monthly portfolio disclosures** (statutory, machine-readable .xlsx) as the spine; Groww demoted to fallback; mfapi.in stays for NAV |
| 10.6k-line page.tsx | All-client SPA monolith | Split into per-tab App-Router route segments, RSC by default, 'use client' pushed to leaves |
| Refresh dies when laptop sleeps | cron drops missed runs | **launchd timers** (re-fire on wake) |
| US smart-money is scrape-only | CapitolTrades bff /trades is broken | **SEC EDGAR Form 4 RSS + 13F diffs** (free, official); CapitolTrades stays for congress; QuiverQuant $30/mo only if parser time > $ |
| "Will a memory layer help?" | — | **No.** Mem0/Letta/Zep are chat-memory products (multi-user, cloud-leaning, token-heavy). Files+grep works; the real gap is time-series → DuckDB. Revisit sqlite-vec ONLY if semantic news/thesis recall becomes a felt pain |

## Phases

### A1 — Hot-path fixes (1 session, highest value/effort)
- [ ] Parallelize Phase-1 pulls: Kite REST + INDmoney Playwright + MF NAV via `Promise.all` in `/api/sync` (and the portfolio-check flow)
- [ ] NSE EOD + history through Kite Connect `/instruments/historical` (creds exist in .env.local); helper `lib/prices.ts` with per-source routing: IN→Kite, US→stooq (`https://stooq.com/q/d/l/?s=<sym>.us&i=d`), fallback Finnhub
- [ ] Repoint `scripts/backtest/yfetch.py` + `lib/earnings.ts` price paths at the new router (Yahoo demoted to last fallback)

### A2 — DuckDB time-series spine (1-2 sessions)
- [ ] `MEMORY_DIR/lens.duckdb` with tables: `snapshots(date, silo, ticker, qty, ltp, value, role)`, `prices(date, symbol, close)`, `decisions(...)`, `mf_holdings(asOf, scheme, isin, name, weight)`
- [ ] Sync writes to DuckDB FIRST, then exports today's JSON views (latest_snapshot.json etc.) — zero agent-workflow change, full history gained
- [ ] Backfill from portfolio_history.json + existing JSONs
- [ ] XIRR/alpha/drift-over-time become one-line SQL; /api/performance reads DuckDB

### A3 — Scheduled away-refresh (0.5 session)
- [ ] launchd plist (`~/Library/LaunchAgents/in.lens.refresh.plist`): weekday 09:20 + 15:50 IST → `scripts/refresh.sh` (Kite LTP pull + snapshot write + triggers.json check; NO LLM in the loop — deterministic script, per the earlier privacy decision)
- [ ] triggers.json breaches → macOS notification (`osascript`) + dashboard banner (already wired)

### A4 — MF holdings spine (1 session)
- [ ] `scripts/mf_xray/amfi_fetch.py`: AMFI scheme-wise disclosure index → per-AMC .xlsx → parse holdings (ISIN, name, weight) for the 8 material schemes → `mf_xray.json` (same schema as today)
- [ ] Sector derivation via ISIN→industry map (Kite instruments dump carries industry; else tickerMeta-style map)
- [ ] Groww scraper kept as fallback path in the same script

### A5 — page.tsx decomposition (1-2 sessions, do AFTER W4 panels land to avoid double-churn)
- [ ] Route segments: `app/(tabs)/overview|allocation|in|us|bonds|mf|research|news|earnings|tasks|decisions/page.tsx`
- [ ] Shared layout keeps sidebar; per-tab RSC shells; client islands only for interactive pieces
- [ ] Dev compile per-tab becomes seconds; prod unchanged

### A6 — EDGAR smart-money (1 session, replaces scrape fragility)
- [ ] Form 4 RSS poll (`getcurrent&type=4` filtered to held tickers) → insider cluster detection → smart_money.json merge
- [ ] Quarterly 13F-HR diff for 5-8 followed superinvestors

## Explicitly skipped (researched, rejected)
- Mem0 / Letta / Zep / Cognee agent-memory daemons — wrong tool for single-user finance
- BullMQ/Redis — no broker needed on one machine; node-cron + runs.log suffices
- Kite WebSocket as default — opt-in "live mode" toggle only; EOD covers the strategy
- Tijori — confirmed no public API/MCP exists; don't build on it
- ChromaDB — sqlite-vec is the lighter option IF vector recall is ever needed

## Sequencing vs W0-W4
W0 (audit fixes) → A1 (hot path) → W4 panels → A2 (DuckDB) → A3 (launchd) → A4 (AMFI) → A5 (page split) → A6 (EDGAR). A1+A3 are the immediate quality-of-life wins; A2 is the compounding one.
