# Decisions backtest + regime-gate harness (W3)

Two zero-dependency Python scripts that grade the decisions journal against
counterfactuals and stress-test a regime-gated deploy policy. Stdlib only
(`urllib`, `json`) — no `pip install` required.

## What it does

**`decisions_backtest.py`** — for every journal decision with a real ticker +
price + date, computes, as of the latest available close:

- **BUY/ADD** — the bought position's return vs *buying the index instead*
  (`^NSEI` for IN/metals/MF, `^GSPC` for US) with the same cash on the same date.
- **SELL/TRIM** — the *had-you-held* return of the sold/trimmed quantity
  (action realises 0% on that capital; a fall avoided is a win).
- **SWITCH** — recorded neutral (plan switch is a tax/TER win, not directional).

Each row gets `verdictComputed` = `good` (action beat the counterfactual by
>2%), `bad` (trailed by >2%), or `neutral`. Rows are aggregated by rule-category
(`exits/harvests`, `trims`, `switches`, `buys`).

Skipped: `DEPLOY_INTENT` rows, anything missing a ticker/price, and any row
whose price source stays blocked (HTTP 429/403). **Prices are never fabricated.**
Indian MF rows *are* backtested — their tickers map to `mfapi.in` scheme codes
via `mf_scheme_codes.json` in the memory dir, giving real NAV history.

**`regime_gate_sim.py`** — `^NSEI` 5y daily, ₹50K deployed the first trading day
of each month, under three policies:

- **DCA** — always deploy.
- **static gate** — halt when close <23,000 for 2 consecutive sessions; resume
  when close >24,200. Cash queued during a halt deploys as a lump on resume.
- **dynamic gate** — halt when close < 200DMA×0.97; resume when close > 200DMA.
  Same queue-and-deploy mechanic.

Reports ending value, units, invested, ending return %, and max drawdown per
policy. The static absolute levels only bind in recent data — see the `note`
in the output; the dynamic 200DMA gate is the regime-robust comparison.

**`run_all.py`** — runs both, derives a 4–7 line **scorecard**
(`keep`/`amend`/`kill` with one line of evidence each, computed from the numbers)
and writes the combined result.

## Files

| File | Role |
|------|------|
| `yfetch.py` | source router (Kite → stooq → Yahoo) + mfapi.in; per-symbol source log; 429/403 → browser-UA retry + shared Yahoo cooldown → `FetchBlocked` |
| `seriesutil.py` | close-on/before/after, pct, max-drawdown helpers |
| `decisions_backtest.py` | per-decision scoring + category aggregation |
| `regime_gate_sim.py` | DCA / static / dynamic gate simulation |
| `run_all.py` | orchestrator + scorecard + writes `backtest_results.json` |

## Run

```bash
# combined (writes backtest_results.json to the memory dir):
python3 scripts/backtest/run_all.py

# individually (print JSON to stdout):
python3 scripts/backtest/decisions_backtest.py
python3 scripts/backtest/regime_gate_sim.py
```

Output is written to
`$PORTFOLIO_MEMORY_DIR/backtest_results.json`
(default `~/.claude/projects/<your-project-slug>/memory/backtest_results.json`).
**This file lives outside the repo and must not be committed.**

Override the memory location with `PORTFOLIO_MEMORY_DIR` (same env var the
dashboard's `lib/paths.ts` uses).

## Network — source router (A1)

`yfetch.py` routes each instrument through a fall-through chain so the harness
stops dying on Yahoo 429s. **Source order:** Indian instruments (`.NS`/`.BO` and
`^NSEI`) try **Kite Connect historical** day candles first (`KITE_API_KEY` from
the dashboard `.env.local` + the `access_token` from `kite-session.json` in the
memory dir; header `Authorization: token <key>:<token>`), then **stooq** CSV,
then **Yahoo**. US instruments (`^GSPC` + bare tickers) try **stooq** first, then
**Yahoo**. Indian MFs use **mfapi.in** NAV history (unchanged — no Kite/stooq
equivalent). The actual source used per symbol is recorded in
`backtest_results.json` under `decisions.sources` (a `summary` roll-up plus a
`perSymbol` log). The NSE instrument dump is cached to
`<memory-dir>/kite_instruments_nse.csv` (refreshed if >7 days old); the api key
and access token are never printed or logged. **Morning-login rerun:** the Kite
session expires daily (~6 AM IST), so before a fresh run trigger the Kite login
(dashboard `/api/kite/login` or the `kite-login` skill) to repopulate
`kite-session.json`, then `python3 scripts/backtest/run_all.py`. If every source
for the regime-gate index is blocked, the run no longer crashes: it writes an
`{"available": false, "note": ...}` regimeGate block and still emits the
decisions scorecard.

> **Kite historical add-on caveat (verified 2026-06-10):** with a *valid*
> session this app's `/user/profile` and `/portfolio/holdings` return HTTP 200,
> but `/instruments/historical/...` returns HTTP 403
> `PermissionException` ("Insufficient permission for that call") — the paid
> **Historical Data API add-on is not enabled** on the Kite Connect app. A
> morning login refreshes the session but does **not** fix this; the add-on has
> to be subscribed before the IN leg resolves via Kite. Until then the IN legs
> fall through (stooq → Yahoo) and the probe reports `PermissionException`
> (distinct from `TokenException`) so the run output is honest about why. If the
> add-on is enabled later, the Kite leg starts serving with no code change.

> **stooq caveat (verified 2026-06-10):** from the slice corporate egress the
> stooq `/q/d/l/` CSV endpoint returns HTTP 404 for every symbol tested
> (`^spx`, `^nsei`, `aapl.us`, `rivn.us`, `reliance.ns`) on both stooq.com and
> stooq.pl — its over-quota / datacenter-IP block, not a coverage gap. So stooq
> currently carries nothing from this network; it is wired in so it self-heals
> when the harness runs from an unblocked IP. Today the US + index legs fall
> through to Yahoo.

Yahoo/stooq/mfapi are public (no key). On 429/403 the fetcher retries with a
desktop-browser User-Agent and growing backoff; a process-wide Yahoo cooldown
circuit-breaker prevents a rate-limited Yahoo from stacking per-symbol backoffs
across the whole run. Anything still blocked is marked `skipped` (never faked)
and the run continues. The index series are fetched once and cached per run.

## Cadence

Re-run **quarterly** (aligned with the journal's ~90-day `reviewAt` windows) and
after any decision resolves from `pending`. The scorecard is recomputed each
run, so verdicts track the latest prices rather than going stale. Compare the
new `byCategory` and `scorecard` against the prior `backtest_results.json` to
see which rules are holding up.
