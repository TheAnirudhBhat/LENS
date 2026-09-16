#!/usr/bin/env python3
"""
auto_refresh.py — LENS no-Claude refresh (launchd: com.lens.refresh).

Everything here is deterministic plumbing an LLM shouldn't be needed for:
  1. Warm the running LENS server's enrichment (Kite / Yahoo→Stooq / mfapi /
     FX all live in the route code — this script deliberately reuses it
     instead of reimplementing quote fetching).
  2. Persist enriched LTPs/values back into the memory files so cold
     fallbacks stay fresh and the per-tab STALE pills tell the truth.
     Stamps are HONEST: a bucket's fetchedAt/asOf only bumps when its live
     source actually worked (Kite session valid for IN; quotes moved for US).
  3. Merge today's portfolio_history point (totalValue from the /api/qa
     gate, prices only). Fields owned by /portfolio-check on that row —
     cashInjection, quarterly/annual audit flags — are left untouched.
  4. Price-trigger engine: watch_levels.json → triggers.json → the
     Overview banner. No LLM parsing — levels are explicit config.
  5. Write auto_refresh_status.json for the dashboard's refresh popover.

Claude (/portfolio-check) still owns: trade detection + decisions log, news
tagging, earnings outlooks, verdict re-evals, and anything judgment-shaped.

stdlib-only; external HTTPS via `curl` (proven TLS path on this machine).
"""

import json
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Memory dir is NOT derived from this file's location (the canonical copy lives in
# the repo, so parent.parent would be the repo, not the data dir). Resolve from the
# PORTFOLIO_MEMORY_DIR env (set by the launchd plist), else derive the same slug
# lib/paths.ts uses (HOME with slashes→dashes) — no hardcoded username, publish-safe.
import os as _os
_mem_env = _os.environ.get("PORTFOLIO_MEMORY_DIR")
MEM = Path(_mem_env) if _mem_env else (
    Path.home() / ".claude" / "projects" / str(Path.home()).replace("/", "-") / "memory"
)
BASE = _os.environ.get("LENS_BASE_URL", "http://localhost:3002")
IST = timezone(timedelta(hours=5, minutes=30))
NOW = datetime.now(IST)
TODAY = NOW.strftime("%Y-%m-%d")


def log(msg: str) -> None:
    print(f"[{NOW.strftime('%F %T')}] {msg}", flush=True)


def get_json(url: str, timeout: int = 20):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def curl_json(url, headers=None, timeout=15):  # py3.9-safe (system python)
    cmd = ["curl", "-s", "--max-time", str(timeout)]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(url)
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    return json.loads(out) if out else None


def read_file(name: str):
    p = MEM / name
    return json.loads(p.read_text()) if p.exists() else None


def write_file(name: str, data) -> None:
    (MEM / name).write_text(json.dumps(data, indent=2, ensure_ascii=False))


# ── quote sources for watch-level tickers (may not be holdings) ──────────────

def kite_session_valid() -> bool:
    s = read_file("kite-session.json") or {}
    exp = s.get("expires_at")
    if not (s.get("access_token") and exp):
        return False
    try:
        return datetime.fromisoformat(exp.replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except ValueError:
        return False


def kite_auth():
    s = read_file("kite-session.json") or {}
    env = Path.home() / "claude/personal/projects/portfolio-dashboard/.env.local"
    key = ""
    if env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("KITE_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    tok = s.get("access_token", "")
    return f"token {key}:{tok}" if key and tok else None


def kite_ltp(instrument):
    """instrument e.g. 'NSE:EMAMILTD' or 'NSE:NIFTY 50'."""
    auth = kite_auth()
    if not (auth and kite_session_valid()):
        return None
    url = "https://api.kite.trade/quote/ltp?i=" + urllib.request.quote(instrument)
    j = curl_json(url, {"Authorization": auth, "X-Kite-Version": "3"})
    try:
        return float(j["data"][instrument]["last_price"])
    except (KeyError, TypeError, ValueError):
        return None


def us_quote(ticker):
    """Yahoo chart first, Stooq CSV fallback — same order as lib/usquote.ts."""
    j = curl_json(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d",
        {"User-Agent": "Mozilla/5.0"},
    )
    try:
        p = j["chart"]["result"][0]["meta"]["regularMarketPrice"]
        if p:
            return float(p)
    except (KeyError, TypeError, IndexError):
        pass
    out = subprocess.run(
        ["curl", "-s", "--max-time", "10", f"https://stooq.com/q/l/?s={ticker.lower()}.us&f=sd2t2ohlcv&h&e=csv"],
        capture_output=True, text=True,
    ).stdout
    try:
        close = out.strip().splitlines()[1].split(",")[6]
        return float(close)
    except (IndexError, ValueError):
        return None


# ── 1+2. warm the server, persist enriched values ────────────────────────────

def refresh_snapshot() -> dict:
    """Patch fresh IN LTPs into latest_snapshot.json. Honest stamp: only when
    the Kite session is valid (else the route serves stored values back)."""
    snap = read_file("latest_snapshot.json")
    if not snap:
        return {"in": "missing"}
    if not kite_session_valid():
        log("IN: kite session expired — leaving snapshot untouched (stamp stays honest)")
        return {"in": "stale-kite-expired", "inTotal": snap.get("totalValue")}

    get_json(f"{BASE}/api/snapshot")           # warm (kicks live enrichment)
    import time; time.sleep(3)
    data = get_json(f"{BASE}/api/snapshot").get("data") or {}
    live = {h["ticker"]: h for h in data.get("holdings", [])}

    total = 0.0
    bonds = 0.0
    pnl = 0.0
    invested = 0.0
    for h in snap.get("holdings", []):
        lv = live.get(h["ticker"])
        if lv and lv.get("ltp"):
            h["ltp"] = lv["ltp"]
            h["value"] = round(lv["ltp"] * h["qty"], 2)
            if h.get("avgPrice"):
                cost = h["avgPrice"] * h["qty"]
                h["pnlPct"] = round((h["value"] - cost) / cost * 100, 2)
        total += h.get("value", 0)
        if h.get("role") == "debt-equiv":
            bonds += h.get("value", 0)
        elif h.get("avgPrice"):
            invested += h["avgPrice"] * h["qty"]
            pnl += h.get("value", 0) - h["avgPrice"] * h["qty"]
    # weights vs whole portfolio recomputed by the route on read; keep in-book weight
    for h in snap.get("holdings", []):
        if total > 0 and h.get("value") is not None:
            h["weight"] = round(h["value"] / total * 100, 2)
    snap["totalValue"] = round(total, 2)
    snap["bondsValue"] = round(bonds, 2)
    snap["equityValue"] = round(total - bonds, 2)
    if invested > 0:
        snap["equityPnl"] = round(pnl, 2)
        snap["equityPnlPct"] = round(pnl / invested * 100, 2)
    snap["asOf"] = NOW.isoformat()
    write_file("latest_snapshot.json", snap)
    log(f"IN: snapshot refreshed, totalValue {snap['totalValue']:.0f}")
    return {"in": "fresh", "inTotal": snap["totalValue"], "snap": snap}


def refresh_us() -> dict:
    """Patch fresh USD quotes + FX into us_stocks.json. Stamp bumps only when
    at least one live quote actually differed from the stored one."""
    us = read_file("us_stocks.json")
    if not us:
        return {"us": "missing"}
    get_json(f"{BASE}/api/usstocks")           # warm
    import time; time.sleep(3)
    data = get_json(f"{BASE}/api/usstocks").get("data") or {}
    live = {p["ticker"]: p for p in data.get("positions", [])}

    moved = False
    inv_t = cur_t = 0.0
    for p in us.get("positions", []):
        lv = live.get(p["ticker"])
        if lv and lv.get("currentPriceUSD") and lv["currentPriceUSD"] != p.get("currentPriceUSD"):
            moved = True
        if lv and lv.get("currentPriceUSD"):
            p["currentPriceUSD"] = lv["currentPriceUSD"]
            p["currentINR"] = lv.get("currentINR", p.get("currentINR"))
            p["pnlINR"] = lv.get("pnlINR", p.get("pnlINR"))
            p["pnlPct"] = lv.get("pnlPct", p.get("pnlPct"))
        inv_t += p.get("investedINR", 0)
        cur_t += p.get("currentINR", 0)
    us["totals"]["investedINR"] = round(inv_t)
    us["totals"]["currentINR"] = round(cur_t)
    us["totals"]["pnlINR"] = round(cur_t - inv_t)
    if inv_t > 0:
        us["totals"]["pnlPct"] = round((cur_t - inv_t) / inv_t * 100, 2)
    if data.get("fx", {}).get("usdInr"):
        us["fx"]["usdInr"] = data["fx"]["usdInr"]
        us["fx"]["asOf"] = TODAY
    if moved:
        us["fetchedAt"] = NOW.isoformat()
    write_file("us_stocks.json", us)
    log(f"US: {'refreshed' if moved else 'quotes unchanged (market closed?)'}, currentINR {us['totals']['currentINR']}")
    return {"us": "fresh" if moved else "unchanged", "usTotal": us["totals"]["currentINR"]}


def mf_total():
    try:
        s = get_json(f"{BASE}/api/mutualfunds").get("summary") or {}
        return s.get("totalValue")
    except Exception:
        return None


# ── 2b. net-worth gate (/api/qa) ─────────────────────────────────────────────

def qa_net_worth():
    """Net worth from lib/valuation.ts buildBook() via /api/qa — the single
    calculator (DATA_CONTRACT §1, §6). NEVER hand-sum the silos: the old
    snapshot+US+MF sum omitted the Stable-demat bond book entirely
    (bonds.json totals.stableSideValueINR, ~Rs90K), because latest_snapshot's
    totalValue only carries the three bonds that sit in the Kite demat. Every
    row written that way from 2026-06-26 on is understated by roughly that much.

    A red or unreachable gate means there is no trustworthy total, so we write
    nothing rather than persist a number we know is wrong."""
    import time
    q = None
    for attempt in (1, 2):
        try:
            q = get_json(f"{BASE}/api/qa", timeout=45)  # buildBook runs a 5s budget
        except Exception as exc:
            log(f"qa: gate unreachable ({exc}) — history + peak left untouched")
            return None
        if q.get("ok"):
            break
        # The route asks callers to re-curl once: warming /api/snapshot and
        # /api/usstocks above can leave mfapi's NAV cache cold, which trips the
        # "MF NAVs are STORED" issue on an otherwise healthy book. One retry.
        if attempt == 1:
            log(f"qa: gate RED {q.get('issues')} — retrying once (cache warm)")
            time.sleep(5)
    if not q.get("ok"):
        log(f"qa: gate RED {q.get('issues')} — history + peak left untouched")
        return None
    nw = (q.get("totals") or {}).get("netWorth")
    if not nw:
        log("qa: gate ok but totals.netWorth missing — history + peak left untouched")
        return None
    return float(nw)


# ── 3. history upsert ────────────────────────────────────────────────────────

# Fields this job is allowed to write on a history row. Everything else on the
# row belongs to /portfolio-check (cashInjection, quarterlyAudit/quarterlyNote,
# annualBaseline/annualNote, withdrawals, ...) and must survive untouched.
OWNED_HISTORY_KEYS = ("totalValue", "nifty", "vix", "note")

NOTE_MARKER = "auto_refresh (launchd, prices only)"


def upsert_history(total_portfolio, snap):
    """MERGE into today's row — never rebuild it. /portfolio-check writes its
    own fields into the same row, so replacing the row wholesale destroys them.
    (2026-09-04: a full quarterly-audit record — cashInjection, quarterlyAudit,
    quarterlyNote — was wiped by this function and had to be restored by hand.)
    cashInjection in particular is the ONLY input to the deploy-floor score, so
    zeroing it silently understates fresh capital."""
    hist = read_file("portfolio_history.json") or {"note": "", "history": []}
    rows = hist.get("history") or []
    entry = next((e for e in rows if e.get("date") == TODAY), None)
    if entry is None:
        entry = {"date": TODAY}
        rows.append(entry)

    entry["totalValue"] = round(total_portfolio)
    nifty = ((snap or {}).get("nifty") or {}).get("value")
    if nifty is not None:                      # never null out a stored reading
        entry["nifty"] = nifty
    vix = (snap or {}).get("vix")
    if vix is not None:
        entry["vix"] = vix
    # The job stamps its provenance marker but does NOT erase a note another
    # writer put on the row (same " | " convention as the 2026-07-03 row).
    # Idempotent: re-running the job does not grow the string.
    prev = (entry.get("note") or "").strip()
    carried = prev.split(" | ", 1)[1] if prev.startswith(NOTE_MARKER + " | ") else (
        "" if prev == NOTE_MARKER else prev)
    entry["note"] = f"{NOTE_MARKER} | {carried}" if carried else NOTE_MARKER

    # Not owned: seeded only when the row is new, never reset on an existing one.
    entry.setdefault("cashInjection", 0)
    entry.setdefault("fullMode", False)

    hist["history"] = rows
    write_file("portfolio_history.json", hist)
    kept = sorted(k for k in entry if k not in OWNED_HISTORY_KEYS and k != "date")
    log(f"history: merged {TODAY} total {entry['totalValue']} (preserved: {', '.join(kept) or 'none'})")


# ── 4. price-trigger engine (watch_levels.json → triggers.json) ─────────────

def check_triggers(snap_holdings: dict, us_positions: dict) -> None:
    cfg = read_file("watch_levels.json") or {"levels": []}
    fired = []
    for lv in cfg.get("levels", []):
        tkr, op, level = lv["ticker"], lv["op"], float(lv["level"])
        price = None
        src = lv.get("source", "auto")
        if src == "kite" or (src == "auto" and lv.get("market") == "IN"):
            price = kite_ltp(lv.get("instrument", f"NSE:{tkr}"))
        elif src == "yahoo" or (src == "auto" and lv.get("market") == "US"):
            price = us_quote(tkr)
        if price is None:  # holdings fallback
            h = snap_holdings.get(tkr) or us_positions.get(tkr)
            price = (h or {}).get("ltp") or (h or {}).get("currentPriceUSD")
        if price is None:
            log(f"triggers: {tkr} no price (skipped)")
            continue
        hit = price <= level if op == "<=" else price >= level
        if hit:
            fired.append({
                "taskId": lv.get("taskId", ""),
                "ticker": tkr,
                "severity": lv.get("severity", "med"),
                "mechanism": f"{tkr} {price:g} crossed {op}{level:g} — {lv.get('label', 'watch level')}",
            })
            log(f"TRIGGER: {tkr} {price:g} {op} {level:g} ({lv.get('label','')})")
    write_file("triggers.json", {"firedAt": NOW.isoformat() if fired else "", "items": fired})
    log(f"triggers: {len(fired)} fired")


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    try:
        get_json(f"{BASE}/api/kite/status", timeout=5)
    except Exception:
        log("server :3002 down — nothing to do (com.lens.server should keep it up)")
        return 1

    r_in = refresh_snapshot()
    r_us = refresh_us()
    mf = mf_total()

    snap = r_in.get("snap") or read_file("latest_snapshot.json") or {}
    total = qa_net_worth()
    if total:
        snap2 = read_file("latest_snapshot.json")
        if snap2:
            snap2["totalPortfolioValue"] = round(total)
            if total > snap2.get("peakValue", 0):
                snap2["peakValue"] = round(total)
                snap2["peakDate"] = TODAY
            peak = snap2.get("peakValue") or total
            snap2["totalDrawdownPct"] = round(max(0.0, (peak - total) / peak * 100), 2)
            write_file("latest_snapshot.json", snap2)
        upsert_history(total, snap)

    check_triggers(
        {h["ticker"]: h for h in snap.get("holdings", [])},
        {p["ticker"]: p for p in (read_file("us_stocks.json") or {}).get("positions", [])},
    )

    write_file("auto_refresh_status.json", {
        "lastRun": NOW.isoformat(),
        "sources": {"in": r_in.get("in"), "us": r_us.get("us"), "mf": "route-live" if mf else "unavailable"},
        "networth": round(total) if total else None,
    })
    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
