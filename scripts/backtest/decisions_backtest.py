#!/usr/bin/env python3
"""
W3 - decisions backtest.

For every decision in the journal that has a real ticker, price and date,
compute its outcome as of the LATEST available close versus two counterfactuals:

  BUY / ADD
    actionReturnPct          = return of the bought position (latest vs entry).
    indexReturnPct           = same cash into the benchmark index on the same
                               date (^NSEI for IN/metals/MF, ^GSPC for US).
    counterfactualReturnPct  = indexReturnPct (the "index-instead" alternative).
    verdict: action beat index by >2%  -> good
             action trailed index by >2% -> bad
             else                         -> neutral

  SELL / TRIM
    actionReturnPct          = 0.0  (capital is realised / out of the asset).
    counterfactualReturnPct  = "had you held" return of the sold/trimmed qty
                               (latest vs the action price).
    indexReturnPct           = benchmark return over the same window (context).
    verdict: you avoided a drop (hold would be < -2%)  -> good
             you missed upside (hold would be  > +2%)  -> bad
             else                                       -> neutral

  SWITCH (e.g. Regular -> Direct plan)
    Not a directional bet; recorded as neutral with the hold-vs-now delta as
    context. The economic win (tax/TER) is qualitative, noted in the row.

Skipped:
  - DEPLOY_INTENT rows (no trade yet).
  - MF rows whose ticker has no NAV source (none today: all MF tickers map to
    mfapi.in scheme codes, so MF rows ARE backtested on real NAV history).
  - Any row where the price source stays blocked (HTTP 429/403) -> never faked.

Run:
    python3 scripts/backtest/decisions_backtest.py            # prints JSON
    python3 scripts/backtest/decisions_backtest.py --quiet    # silent, importable

Data is read from the local memory dir; nothing is fabricated.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yfetch  # noqa: E402
import seriesutil as su  # noqa: E402

_HOME = os.path.expanduser("~")
# Claude's memory folder mirrors the home path with "/" -> "-" (e.g. /Users/jane
# -> -Users-jane). Derive it so no username is hardcoded; set PORTFOLIO_MEMORY_DIR
# to override for a different machine or layout.
MEMORY_DIR = os.environ.get(
    "PORTFOLIO_MEMORY_DIR",
    os.path.join(_HOME, ".claude", "projects", _HOME.replace("/", "-"), "memory"),
)
DECISIONS_PATH = os.path.join(MEMORY_DIR, "decisions.json")
MF_CODES_PATH = os.path.join(MEMORY_DIR, "mf_scheme_codes.json")

GOOD_THRESHOLD = 2.0  # percent
BAD_THRESHOLD = -2.0  # percent

US_INDEX = "^GSPC"
IN_INDEX = "^NSEI"


def _parse_date(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def load_decisions() -> list[dict]:
    with open(DECISIONS_PATH, encoding="utf-8") as f:
        return json.load(f)["decisions"]


def load_mf_codes() -> dict:
    try:
        with open(MF_CODES_PATH, encoding="utf-8") as f:
            return json.load(f).get("schemes", {})
    except FileNotFoundError:
        return {}


def categorize(action: str, rationale: str) -> str:
    """Bucket a decision into a rule-category by action + rationale keywords."""
    a = (action or "").upper()
    r = (rationale or "").lower()
    if a == "SWITCH":
        return "switches"
    if a in ("SELL",):
        return "exits/harvests"
    if a in ("TRIM",):
        return "trims"
    if a in ("BUY", "ADD", "DEPLOY"):
        # a sell-labelled harvest sometimes lands as SELL above; buys are buys
        return "buys"
    # fallback by keyword
    if any(k in r for k in ("harvest", "exit", "broken", "zombie", "redeem")):
        return "exits/harvests"
    if "trim" in r:
        return "trims"
    return "buys"


def _index_series_cache() -> dict:
    return {}


def get_index_series(asset: str, cache: dict):
    """Benchmark series for the asset's geography. Cached per-run."""
    sym = US_INDEX if asset == "us-equity" else IN_INDEX
    if sym in cache:
        return cache[sym]
    # 5y range comfortably covers any 2026 decision date.
    series = yfetch.yahoo_series(sym, rng="5y")
    cache[sym] = series
    return series


def index_return_since(asset: str, action_date: date, cache: dict):
    """
    Benchmark return from the first close on/after action_date to the latest
    close. Returns (pct, index_symbol) or (None, sym) if not resolvable.
    """
    sym = US_INDEX if asset == "us-equity" else IN_INDEX
    try:
        series = get_index_series(asset, cache)
    except (yfetch.FetchBlocked, yfetch.FetchEmpty):
        return None, sym
    start = su.close_on_or_after(series, action_date)
    if not start:
        return None, sym
    return su.pct(start[1], series["latest_close"]), sym


def fetch_asset_series(d: dict, mf_codes: dict):
    """
    Resolve and fetch the price/NAV series for a decision.
    Returns (series, source_label) or raises FetchBlocked / FetchEmpty / KeyError.
    """
    asset = d.get("asset", "")
    ticker = (d.get("ticker") or "").strip()
    if asset == "mf":
        meta = mf_codes.get(ticker)
        if not meta:
            raise KeyError(f"no MF scheme code for {ticker}")
        return yfetch.mfapi_series(meta["code"]), f"mfapi:{meta['code']}"
    series = yfetch.fetch_equity(ticker, asset, rng="2y")
    return series, f"yahoo:{series['symbol']}"


def verdict_for(action: str, action_ret: float, counterfactual_ret: float) -> str:
    """
    good/bad/neutral. Convention: positive delta = the action created value
    relative to the counterfactual.

      BUY  : delta = actionRet - counterfactualRet (beat the index)
      SELL/TRIM: action realises (0%); counterfactual is the hold path.
                 delta = 0 - holdReturn  (avoiding a fall is a win)
    """
    a = (action or "").upper()
    if a in ("SELL", "TRIM"):
        delta = 0.0 - counterfactual_ret
    else:
        delta = action_ret - counterfactual_ret
    if delta > GOOD_THRESHOLD:
        return "good"
    if delta < BAD_THRESHOLD:
        return "bad"
    return "neutral"


def evaluate_decision(d: dict, mf_codes: dict, idx_cache: dict) -> dict:
    """Produce one result row (scored) or a skipped marker dict."""
    did = d.get("id")
    action = (d.get("action") or "").upper()
    ticker = (d.get("ticker") or "").strip()
    asset = d.get("asset", "")
    rationale = d.get("rationale", "")

    base = {
        "id": did,
        "ticker": ticker,
        "action": action,
        "asset": asset,
        "category": categorize(action, rationale),
    }

    # ---- skip rules -------------------------------------------------------
    if action == "DEPLOY_INTENT" or not ticker:
        return {**base, "skipped": True, "note": "no trade / no ticker (DEPLOY_INTENT)"}

    try:
        action_date = _parse_date(d["date"])
    except Exception:
        return {**base, "skipped": True, "note": "unparseable date"}

    action_price = d.get("price")
    if action_price in (None, 0):
        return {**base, "skipped": True, "note": "no action price"}
    action_price = float(action_price)

    # ---- price/NAV series -------------------------------------------------
    try:
        series, source = fetch_asset_series(d, mf_codes)
    except yfetch.FetchBlocked as exc:
        return {**base, "skipped": True, "note": f"price source blocked: {exc}"}
    except (yfetch.FetchEmpty, KeyError) as exc:
        return {**base, "skipped": True, "note": f"no price source: {exc}"}

    latest_close = series["latest_close"]
    latest_date = series["latest_date"]

    # Hold/position return: latest vs the action price (the price actually paid
    # or received per the journal), not a re-derived series close. Using the
    # journalled price keeps action & counterfactual on the same basis.
    raw_ret = su.pct(action_price, latest_close)

    idx_ret, idx_sym = index_return_since(asset, action_date, idx_cache)

    row = {
        "id": did,
        "ticker": ticker,
        "action": action,
        "asset": asset,
        "category": base["category"],
        "date": d["date"][:10],
        "actionPrice": round(action_price, 4),
        "latestClose": round(latest_close, 4),
        "latestDate": latest_date.isoformat(),
        "source": source,
        "indexSymbol": idx_sym,
    }

    if action in ("SELL", "TRIM"):
        hold_ret = round(raw_ret, 2)
        action_ret = 0.0  # out of the asset
        verdict = verdict_for(action, action_ret, hold_ret)
        row.update(
            {
                "actionReturnPct": action_ret,
                "counterfactualReturnPct": hold_ret,  # "had you held"
                "indexReturnPct": round(idx_ret, 2) if idx_ret is not None else None,
                "verdictComputed": verdict,
                "note": (
                    f"{'sold' if action == 'SELL' else 'trimmed'} @ {action_price:g}; "
                    f"latest {latest_close:g}. Had you held, "
                    f"{'gain' if hold_ret >= 0 else 'loss'} of {hold_ret:+.2f}% "
                    f"-> exit { 'avoided a fall' if hold_ret < 0 else 'missed upside' }."
                ),
            }
        )
    elif action == "SWITCH":
        # Plan switch (Regular->Direct etc.): not directional. Neutral by design.
        row.update(
            {
                "actionReturnPct": round(raw_ret, 2),
                "counterfactualReturnPct": round(raw_ret, 2),
                "indexReturnPct": round(idx_ret, 2) if idx_ret is not None else None,
                "verdictComputed": "neutral",
                "note": (
                    f"plan switch (not a directional bet); fund {raw_ret:+.2f}% since. "
                    "Economic win is tax/TER, not price - see journal note."
                ),
            }
        )
    else:  # BUY / ADD / DEPLOY
        action_ret = round(raw_ret, 2)
        cf = round(idx_ret, 2) if idx_ret is not None else None
        verdict = verdict_for(action, action_ret, cf) if cf is not None else "neutral"
        row.update(
            {
                "actionReturnPct": action_ret,
                "counterfactualReturnPct": cf,  # index-instead
                "indexReturnPct": cf,
                "verdictComputed": verdict,
                "note": (
                    f"bought @ {action_price:g}; latest {latest_close:g} "
                    f"({action_ret:+.2f}%). Same cash in {idx_sym} would be "
                    f"{cf:+.2f}%." if cf is not None
                    else f"bought @ {action_price:g}; latest {latest_close:g} "
                         f"({action_ret:+.2f}%). Index benchmark unavailable."
                ),
            }
        )

    return row


def aggregate(rows: list[dict]) -> dict:
    """Aggregate scored rows by rule-category."""
    cats: dict[str, dict] = {}
    for r in rows:
        cat = r.get("category", "buys")
        c = cats.setdefault(
            cat,
            {"n": 0, "good": 0, "bad": 0, "neutral": 0,
             "avgActionReturnPct": 0.0, "avgCounterfactualReturnPct": 0.0,
             "_sa": 0.0, "_sc": 0.0, "_nc": 0},
        )
        c["n"] += 1
        v = r.get("verdictComputed", "neutral")
        c[v] = c.get(v, 0) + 1
        if isinstance(r.get("actionReturnPct"), (int, float)):
            c["_sa"] += r["actionReturnPct"]
        cf = r.get("counterfactualReturnPct")
        if isinstance(cf, (int, float)):
            c["_sc"] += cf
            c["_nc"] += 1
    for c in cats.values():
        c["avgActionReturnPct"] = round(c["_sa"] / c["n"], 2) if c["n"] else 0.0
        c["avgCounterfactualReturnPct"] = round(c["_sc"] / c["_nc"], 2) if c["_nc"] else 0.0
        for k in ("_sa", "_sc", "_nc"):
            c.pop(k, None)
    return cats


def run() -> dict:
    decisions = load_decisions()
    mf_codes = load_mf_codes()
    idx_cache = _index_series_cache()
    # NOTE: do NOT reset the source log here. run_all.py resets it once so the
    # routing record spans both the regime and decisions legs. When this module
    # is run standalone, reset explicitly in main() instead.

    rows: list[dict] = []
    skipped: list[str] = []
    for d in decisions:
        res = evaluate_decision(d, mf_codes, idx_cache)
        if res.get("skipped"):
            skipped.append(res["id"])
            # keep a slim skipped record too (id + reason) for transparency
            rows_skipped_note = res.get("note", "")
            res["_skipNote"] = rows_skipped_note
            continue
        rows.append(res)

    by_category = aggregate(rows)
    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
        "byCategory": by_category,
        "skipped": skipped,
        "thresholds": {"goodPct": GOOD_THRESHOLD, "badPct": BAD_THRESHOLD},
        "indices": {"in": IN_INDEX, "us": US_INDEX},
        # Which source served each symbol this run (Kite / stooq / yahoo / mfapi)
        # plus a roll-up. Makes the routing auditable per A1.
        "sources": {
            "summary": yfetch.source_summary(),
            "perSymbol": yfetch.get_source_log(),
        },
    }


def main(argv: list[str]) -> int:
    quiet = "--quiet" in argv
    yfetch.reset_source_log()  # standalone run: fresh per-symbol routing record
    result = run()
    if not quiet:
        print(json.dumps(result, indent=2))
        sys.stderr.write(
            f"\n[decisions_backtest] {len(result['rows'])} scored, "
            f"{len(result['skipped'])} skipped: {result['skipped']}\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
