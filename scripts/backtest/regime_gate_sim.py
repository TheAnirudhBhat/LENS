#!/usr/bin/env python3
"""
W3 - regime-gate simulation on ^NSEI (Nifty 50), 5y daily.

Deploy a fixed amount (default Rs 50,000) on the first trading day of each
month into the index, under three policies:

  (a) DCA / always-deploy
        Buy every month, no matter what.

  (b) static gate
        Halt new deploys once the index closes < 23,000 on 2 consecutive
        sessions; resume once it closes > 24,200. Cash due during a halt is
        QUEUED and deployed in full on the first session after resume.

  (c) dynamic gate
        Halt once close < 200DMA * 0.97; resume once close > 200DMA.
        Same queue-and-deploy-on-resume mechanic.

For each policy we report ending value, units accumulated, total invested,
ending return %, and the max drawdown of the portfolio value path.

NOTE / limitation: the absolute static levels (23,000 / 24,200) only make
sense for the recent Nifty range. Earlier in a 5y window the index traded far
below 23,000, so the static gate would (correctly, per its own rule) stay
halted for long stretches and deploy a big queued lump on the first cross.
This is surfaced in the output `note`. The dynamic 200DMA gate is the
regime-robust comparison.

Run:
    python3 scripts/backtest/regime_gate_sim.py            # prints JSON
    python3 scripts/backtest/regime_gate_sim.py --quiet
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yfetch  # noqa: E402
import seriesutil as su  # noqa: E402

INDEX = "^NSEI"
MONTHLY_DEPLOY = 50_000.0
STATIC_HALT_BELOW = 23_000.0
STATIC_RESUME_ABOVE = 24_200.0
STATIC_HALT_CONSEC = 2
DYNAMIC_DMA = 200
DYNAMIC_HALT_FACTOR = 0.97


def first_trading_days(dates: list) -> set:
    """Indices of the first trading day in each (year, month)."""
    seen = set()
    first_idx = set()
    for i, d in enumerate(dates):
        key = (d.year, d.month)
        if key not in seen:
            seen.add(key)
            first_idx.add(i)
    return first_idx


def sma(closes: list, window: int) -> list:
    """Simple moving average; None until `window` points exist."""
    out = [None] * len(closes)
    run = 0.0
    for i, c in enumerate(closes):
        run += c
        if i >= window:
            run -= closes[i - window]
        if i >= window - 1:
            out[i] = run / window
    return out


def _portfolio_path(dates, closes, deploy_idx_amounts):
    """
    Given {dayIndex: cashDeployedThatDay}, walk the series accumulating units,
    and return (units, invested, value_series, ending_value).
    value_series is mark-to-market portfolio value at each session (for drawdown).
    """
    units = 0.0
    invested = 0.0
    values = []
    for i, c in enumerate(closes):
        amt = deploy_idx_amounts.get(i, 0.0)
        if amt:
            units += amt / c
            invested += amt
        values.append(units * c)
    ending_value = values[-1] if values else 0.0
    return units, invested, values, ending_value


def sim_dca(dates, closes, first_idx):
    deploys = {i: MONTHLY_DEPLOY for i in first_idx}
    units, invested, values, ending = _portfolio_path(dates, closes, deploys)
    return _result("dca", units, invested, values, ending, closes, deploys)


def sim_static_gate(dates, closes, first_idx):
    """
    Queue monthly cash; gate on absolute levels. On a resume session, deploy
    the queue PLUS that month's deploy if it's also a first-trading-day.
    """
    halted = False
    consec_below = 0
    queue = 0.0
    deploys = {}
    for i, c in enumerate(closes):
        # update gate state from today's close
        if c < STATIC_HALT_BELOW:
            consec_below += 1
        else:
            consec_below = 0
        if not halted and consec_below >= STATIC_HALT_CONSEC:
            halted = True
        resumed_today = False
        if halted and c > STATIC_RESUME_ABOVE:
            halted = False
            resumed_today = True

        # this month's scheduled cash
        due = MONTHLY_DEPLOY if i in first_idx else 0.0

        if halted:
            # accumulate everything due while halted
            queue += due
        else:
            # not halted: deploy due + (if we just resumed) the queued backlog
            to_deploy = due
            if resumed_today and queue > 0:
                to_deploy += queue
                queue = 0.0
            if to_deploy:
                deploys[i] = deploys.get(i, 0.0) + to_deploy

    # any cash still queued at series end stays uninvested (gate never reopened)
    units, invested, values, ending = _portfolio_path(dates, closes, deploys)
    res = _result("staticGate", units, invested, values, ending, closes, deploys)
    res["uninvestedQueuedINR"] = round(queue, 2)
    return res


def sim_dynamic_gate(dates, closes, first_idx):
    dma = sma(closes, DYNAMIC_DMA)
    halted = False
    queue = 0.0
    deploys = {}
    for i, c in enumerate(closes):
        ma = dma[i]
        if ma is not None:
            if not halted and c < ma * DYNAMIC_HALT_FACTOR:
                halted = True
            resumed_today = False
            if halted and c > ma:
                halted = False
                resumed_today = True
        else:
            # before 200DMA exists, behave like DCA (can't evaluate the gate)
            resumed_today = False

        due = MONTHLY_DEPLOY if i in first_idx else 0.0
        if halted:
            queue += due
        else:
            to_deploy = due
            if resumed_today and queue > 0:
                to_deploy += queue
                queue = 0.0
            if to_deploy:
                deploys[i] = deploys.get(i, 0.0) + to_deploy

    units, invested, values, ending = _portfolio_path(dates, closes, deploys)
    res = _result("dynamicGate", units, invested, values, ending, closes, deploys)
    res["uninvestedQueuedINR"] = round(queue, 2)
    return res


def _result(name, units, invested, values, ending, closes, deploys):
    ret_pct = ((ending / invested - 1.0) * 100.0) if invested else 0.0
    return {
        "policy": name,
        "endingValueINR": round(ending, 2),
        "investedINR": round(invested, 2),
        "endingReturnPct": round(ret_pct, 2),
        "units": round(units, 4),
        "deploys": len(deploys),
        "maxDrawdownPct": su.max_drawdown(values),
        "latestClose": round(closes[-1], 2),
    }


def run() -> dict:
    series = yfetch.yahoo_series(INDEX, rng="5y")
    dates = series["dates"]
    closes = series["closes"]
    first_idx = first_trading_days(dates)

    dca = sim_dca(dates, closes, first_idx)
    static = sim_static_gate(dates, closes, first_idx)
    dynamic = sim_dynamic_gate(dates, closes, first_idx)

    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "index": INDEX,
        "windowStart": dates[0].isoformat(),
        "windowEnd": dates[-1].isoformat(),
        "sessions": len(dates),
        "monthlyDeployINR": MONTHLY_DEPLOY,
        "dca": dca,
        "staticGate": static,
        "dynamicGate": dynamic,
        "params": {
            "staticHaltBelow": STATIC_HALT_BELOW,
            "staticResumeAbove": STATIC_RESUME_ABOVE,
            "staticHaltConsecutiveSessions": STATIC_HALT_CONSEC,
            "dynamicDMA": DYNAMIC_DMA,
            "dynamicHaltFactor": DYNAMIC_HALT_FACTOR,
        },
        "note": (
            "Absolute static levels (23,000 / 24,200) only bind in recent data; "
            "earlier in the 5y window the index traded below 23,000, so the static "
            "gate stays halted and deploys queued cash as a lump on the first cross "
            "above 24,200 (any cash still queued at window-end is reported as "
            "uninvestedQueuedINR and excluded from value). The dynamic 200DMA gate "
            "is the regime-robust comparison."
        ),
    }


def main(argv: list[str]) -> int:
    quiet = "--quiet" in argv
    result = run()
    if not quiet:
        print(json.dumps(result, indent=2))
        sys.stderr.write(
            "\n[regime_gate_sim] ending values INR  "
            f"dca={result['dca']['endingValueINR']:,.0f}  "
            f"static={result['staticGate']['endingValueINR']:,.0f}  "
            f"dynamic={result['dynamicGate']['endingValueINR']:,.0f}\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
