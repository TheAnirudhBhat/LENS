#!/usr/bin/env python3
"""
W3 - run both backtests, build the scorecard, write combined results.

Output -> $PORTFOLIO_MEMORY_DIR/backtest_results.json (default
~/.claude/projects/<your-project-slug>/memory/backtest_results.json).
This file lives OUTSIDE the repo and must NOT be committed.

Shape:
  {
    asOf,
    decisions: { rows:[...], byCategory:{...}, skipped:[ids] },
    regimeGate: { dca:{...}, staticGate:{...}, dynamicGate:{...}, note },
    scorecard: [ { rule, verdict:"keep|amend|kill", evidence } ]
  }

The scorecard is derived from the computed numbers (not hand-typed), so a
quarterly re-run keeps it honest.

Run:
    python3 scripts/backtest/run_all.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import decisions_backtest as db  # noqa: E402
import regime_gate_sim as rg  # noqa: E402
import yfetch  # noqa: E402

OUT_PATH = os.path.join(db.MEMORY_DIR, "backtest_results.json")
INDEX_SYM = rg.INDEX  # ^NSEI


def _row(rows, did):
    for r in rows:
        if r.get("id") == did:
            return r
    return None


def _cat(by_cat, name):
    return by_cat.get(name, {"n": 0, "good": 0, "bad": 0, "neutral": 0,
                             "avgActionReturnPct": 0.0,
                             "avgCounterfactualReturnPct": 0.0})


def build_scorecard(decisions: dict, regime: dict | None) -> list[dict]:
    """Translate the numbers into keep/amend/kill rules with one-line evidence.

    `regime` may be None when the regime-gate index series was unavailable; in
    that case the two regime-derived rules are simply omitted (the decisions
    rules still stand)."""
    rows = decisions["rows"]
    by_cat = decisions["byCategory"]
    card: list[dict] = []

    # 1) Harvest losses (NKE exit, d8) ------------------------------------
    nke = _row(rows, "d8")
    if nke and nke.get("counterfactualReturnPct") is not None:
        hold = nke["counterfactualReturnPct"]
        verdict = "keep" if hold < db.BAD_THRESHOLD else ("kill" if hold > db.GOOD_THRESHOLD else "amend")
        card.append({
            "rule": "harvest a broken-thesis loser decisively (NKE)",
            "verdict": verdict,
            "evidence": (
                f"NKE since exit @ {nke['actionPrice']:g}: holding would be "
                f"{hold:+.2f}%. {'Exit avoided further loss - keep.' if verdict == 'keep' else 'Stock recovered post-exit - reconsider.' if verdict == 'kill' else 'Roughly flat since - marginal.'}"
            ),
        })

    # 2) Exits/harvests as a category -------------------------------------
    ex = _cat(by_cat, "exits/harvests")
    if ex["n"]:
        good_share = ex["good"] / ex["n"]
        verdict = "keep" if good_share >= 0.5 else ("amend" if good_share >= 0.34 else "kill")
        card.append({
            "rule": "exit broken theses / redeem stale MF (SELL bucket)",
            "verdict": verdict,
            "evidence": (
                f"{ex['n']} exits: {ex['good']} good / {ex['bad']} bad / {ex['neutral']} neutral; "
                f"avg had-you-held {ex['avgCounterfactualReturnPct']:+.2f}% "
                f"(negative = exits dodged losses)."
            ),
        })

    # 3) Trims (RIVN / GOLDCASE / SILVERCASE) -----------------------------
    tr = _cat(by_cat, "trims")
    if tr["n"]:
        # trims are "good" when the trimmed asset went sideways/down (hold<+2%)
        good_share = tr["good"] / tr["n"]
        verdict = "keep" if good_share >= 0.5 else ("amend" if tr["bad"] <= tr["good"] else "kill")
        names = ", ".join(sorted({r["ticker"] for r in rows if r.get("category") == "trims"}))
        card.append({
            "rule": f"trim winners / de-risk overweights ({names})",
            "verdict": verdict,
            "evidence": (
                f"{tr['n']} trims: {tr['good']} good / {tr['bad']} bad; "
                f"avg had-you-held {tr['avgCounterfactualReturnPct']:+.2f}%. "
                f"{'Trims preserved capital with little forgone upside.' if verdict == 'keep' else 'Trimmed into strength that kept running - size trims smaller or stagger.'}"
            ),
        })

    # 4) Buys vs index-instead --------------------------------------------
    bu = _cat(by_cat, "buys")
    if bu["n"]:
        beat = bu["good"]
        verdict = "keep" if beat >= bu["bad"] and bu["avgActionReturnPct"] >= bu["avgCounterfactualReturnPct"] else "amend"
        card.append({
            "rule": "stock-pick buys must beat buying the index",
            "verdict": verdict,
            "evidence": (
                f"{bu['n']} buys: {bu['good']} beat index / {bu['bad']} trailed; "
                f"avg buy {bu['avgActionReturnPct']:+.2f}% vs index "
                f"{bu['avgCounterfactualReturnPct']:+.2f}%."
            ),
        })

    # 5) MF plan switch (d11) ---------------------------------------------
    sw = _row(rows, "d11")
    if sw:
        card.append({
            "rule": "switch Regular -> Direct plans when under LTCG threshold",
            "verdict": "keep",
            "evidence": (
                "Structural TER/tax win independent of price "
                f"(fund {sw.get('actionReturnPct', 0):+.2f}% since is incidental); "
                "near-zero downside, compounding fee savings."
            ),
        })

    # 6) Regime gate: which policy won ------------------------------------
    if regime is None:
        # Index series was unavailable this run — omit the two regime rules.
        return card[:7]
    dca = regime["dca"]
    static = regime["staticGate"]
    dyn = regime["dynamicGate"]
    # Compare on ending return % (per-rupee), since invested differs across policies.
    ranked = sorted(
        [("DCA", dca), ("static gate", static), ("dynamic 200DMA gate", dyn)],
        key=lambda kv: kv[1]["endingReturnPct"],
        reverse=True,
    )
    winner = ranked[0][0]
    if winner == "DCA":
        gate_verdict = "kill"  # gating didn't beat just buying every month
    elif winner == "dynamic 200DMA gate":
        gate_verdict = "keep"
    else:
        gate_verdict = "amend"  # static won but on fragile absolute levels
    card.append({
        "rule": "regime-gate monthly deploys vs plain DCA",
        "verdict": gate_verdict,
        "evidence": (
            f"per-rupee return - DCA {dca['endingReturnPct']:+.2f}% "
            f"(maxDD {dca['maxDrawdownPct']}%), static {static['endingReturnPct']:+.2f}% "
            f"(maxDD {static['maxDrawdownPct']}%), dynamic {dyn['endingReturnPct']:+.2f}% "
            f"(maxDD {dyn['maxDrawdownPct']}%). Winner: {winner}. "
            "Static absolute levels are regime-fragile (see regimeGate.note)."
        ),
    })

    # 7) Drawdown protection of the dynamic gate --------------------------
    if dyn["maxDrawdownPct"] > dca["maxDrawdownPct"]:  # less negative = shallower
        card.append({
            "rule": "use the 200DMA gate for drawdown protection, not alpha",
            "verdict": "keep",
            "evidence": (
                f"dynamic-gate maxDD {dyn['maxDrawdownPct']}% is shallower than "
                f"DCA {dca['maxDrawdownPct']}%; value of the gate is lower path pain."
            ),
        })

    return card[:7]


def run() -> dict:
    # Run the regime sim FIRST: it needs only ONE index fetch (^NSEI), so doing
    # it before the ~19-symbol decisions leg lets it hit a fresh source quota
    # (the decisions leg can exhaust Yahoo's burst limit). If every source for
    # the index is blocked (Kite expired + stooq blocked + Yahoo rate-limited),
    # don't let the whole harness die — degrade to an "unavailable" regime block
    # and still write the decisions scorecard. This is the A1 goal: stop dying
    # on 429s.
    yfetch.reset_source_log()  # one routing record spanning both legs

    regime: dict | None = None
    regime_error: str | None = None
    try:
        regime = rg.run()
    except (yfetch.FetchBlocked, yfetch.FetchEmpty) as exc:
        regime_error = str(exc)

    decisions = db.run()

    combined: dict = {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "decisions": {
            "rows": decisions["rows"],
            "byCategory": decisions["byCategory"],
            "skipped": decisions["skipped"],
            "thresholds": decisions["thresholds"],
            "indices": decisions["indices"],
            "sources": decisions.get("sources", {}),
        },
    }

    if regime is not None:
        combined["regimeGate"] = {
            "dca": regime["dca"],
            "staticGate": regime["staticGate"],
            "dynamicGate": regime["dynamicGate"],
            "window": {"start": regime["windowStart"], "end": regime["windowEnd"],
                       "sessions": regime["sessions"]},
            "params": regime["params"],
            "note": regime["note"],
        }
    else:
        combined["regimeGate"] = {
            "available": False,
            "note": (
                f"regime-gate sim skipped: {INDEX_SYM} index series unavailable "
                f"from every source ({regime_error}). Re-run after the morning "
                "Kite login (see README) or once Yahoo's rate limit clears."
            ),
        }

    combined["scorecard"] = build_scorecard(decisions, regime)
    return combined


def main(argv: list[str]) -> int:
    combined = run()
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2)
    n_rows = len(combined["decisions"]["rows"])
    n_skip = len(combined["decisions"]["skipped"])
    rgt = combined["regimeGate"]
    src_summary = combined["decisions"].get("sources", {}).get("summary", {})
    if rgt.get("available") is False:
        regime_line = f"  regime: UNAVAILABLE - {rgt.get('note', '')}\n"
    else:
        regime_line = (
            f"  regime ending INR: dca={rgt['dca']['endingValueINR']:,.0f} "
            f"static={rgt['staticGate']['endingValueINR']:,.0f} "
            f"dynamic={rgt['dynamicGate']['endingValueINR']:,.0f}\n"
        )
    sys.stderr.write(
        f"[run_all] wrote {OUT_PATH}\n"
        f"  decisions: {n_rows} scored, {n_skip} skipped {combined['decisions']['skipped']}\n"
        f"  sources used: {src_summary or '(none recorded)'}\n"
        + regime_line
        + f"  scorecard: {len(combined['scorecard'])} rules\n"
    )
    # also echo the scorecard verdicts for a quick read
    for s in combined["scorecard"]:
        sys.stderr.write(f"    [{s['verdict']:>5}] {s['rule']}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
