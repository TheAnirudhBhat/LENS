"""Small series helpers shared by both backtest scripts. Stdlib only."""

from __future__ import annotations

from datetime import date


def close_on_or_after(series: dict, target: date):
    """
    First close on or after `target` (the first tradable close once the
    decision is known). Returns (date, close) or None if target is past the
    end of the series.
    """
    dates = series["dates"]
    closes = series["closes"]
    for d, c in zip(dates, closes):
        if d >= target:
            return d, c
    return None


def close_on_or_before(series: dict, target: date):
    """Last close on or before `target`. Returns (date, close) or None."""
    dates = series["dates"]
    closes = series["closes"]
    found = None
    for d, c in zip(dates, closes):
        if d <= target:
            found = (d, c)
        else:
            break
    return found


def pct(frm: float, to: float) -> float:
    """Percent change from `frm` to `to`."""
    if frm == 0:
        return 0.0
    return (to / frm - 1.0) * 100.0


def max_drawdown(values: list[float]) -> float:
    """
    Max peak-to-trough drawdown of a value series, as a negative percent
    (e.g. -18.4 means a 18.4% drawdown). Returns 0.0 for monotone/empty series.
    """
    peak = float("-inf")
    worst = 0.0
    for v in values:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (v / peak - 1.0) * 100.0
            if dd < worst:
                worst = dd
    return round(worst, 2)
