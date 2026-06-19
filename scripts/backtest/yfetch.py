"""
Zero-dependency price-history fetchers for the decisions backtest, with a
SOURCE ROUTER (architecture-plan A1) so the harness stops dying on Yahoo 429s.

Source order per instrument class (each step falls through cleanly on failure):

  IN instruments  (.NS / .BO suffix, and ^NSEI):
    1. Kite Connect historical  (day candles, 1 request covers 5y)
    2. stooq CSV                (EMPIRICALLY unusable from this network as of
                                 2026-06-10 — see notes below; kept so it auto-
                                 recovers if stooq ever serves this egress IP)
    3. Yahoo Finance chart      (existing path, with its 429/403 backoff)

  US instruments  (^GSPC and bare tickers):
    1. stooq CSV                (same empirical caveat as above)
    2. Yahoo Finance chart

  Indian mutual funds:
    mfapi.in NAV history (unchanged — no equivalent on Kite/stooq).

Kite auth (verified pattern from memory/scripts/kite_holdings.sh):
  - api key   : `KITE_API_KEY=` line in the dashboard repo .env.local
  - access tok: "access_token" in memory/kite-session.json
  - header    : "Authorization: token <KEY>:<TOKEN>" + "X-Kite-Version: 3"
  The daily session expires ~6AM IST. When expired, Kite returns
  {"status":"error","error_type":"TokenException"} (HTTP 403) — the router
  detects this, marks Kite unavailable for the rest of the run, and falls
  through to stooq / Yahoo. The morning-login rerun (see README) refreshes the
  session.

  EMPIRICAL Kite note (verified 2026-06-10): with a *valid* session this app's
  /user/profile and /portfolio/holdings return HTTP 200, but
  /instruments/historical/{token}/day returns HTTP 403
  {"error_type":"PermissionException","message":"Insufficient permission for
  that call."}. That is the paid **Historical Data API add-on** not being
  enabled on the Kite Connect app — a token refresh does NOT fix it; the add-on
  has to be subscribed. The probe distinguishes TokenException (login fixes it)
  from PermissionException (add-on needed) so the report is honest, and the IN
  leg falls through cleanly to stooq/Yahoo either way. If the add-on is enabled
  later, the Kite leg starts serving with no code change.

EMPIRICAL stooq note (verified with curl on 2026-06-10 from the slice corp
egress 163.116.214.40): the stooq /q/d/l/ CSV download endpoint returns a
generic HTTP 404 "page does not exist" HTML for EVERY symbol tested
(^spx, ^nsei, aapl.us, rivn.us, reliance.ns), on both stooq.com and the
stooq.pl mirror, while the stooq.com home page returns 200. This is stooq's
known over-quota / datacenter-IP block on the bulk-CSV endpoint, not a
symbol-coverage problem. So stooq carries NOTHING from this network today; it
is wired in (US primary, IN secondary) purely so it self-heals when run from a
residential IP / under quota. The router records the real source used per
symbol in the source log either way.

HARD RULES honoured here:
  - never fabricate prices (every path parses a real response or raises).
  - never print/log the api key or token (masked in all error text).
  - the cached instruments CSV + any session-derived data live in the memory
    dir OUTSIDE the repo.

Everything uses only the Python standard library (urllib, json, csv, ssl, os).
"""

from __future__ import annotations

import csv
import io
import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# --------------------------------------------------------------------------- #
# Paths / constants
# --------------------------------------------------------------------------- #

_HOME = os.path.expanduser("~")
# Claude's memory folder mirrors the home path with "/" -> "-" (e.g. /Users/jane
# -> -Users-jane). Derive it so no username is hardcoded; set PORTFOLIO_MEMORY_DIR
# to override for a different machine or layout.
MEMORY_DIR = os.environ.get(
    "PORTFOLIO_MEMORY_DIR",
    os.path.join(_HOME, ".claude", "projects", _HOME.replace("/", "-"), "memory"),
)
# Auth material + cached instrument dump live OUTSIDE the repo, in the memory dir.
KITE_SESSION_PATH = os.path.join(MEMORY_DIR, "kite-session.json")
KITE_INSTRUMENTS_PATH = os.path.join(MEMORY_DIR, "kite_instruments_nse.csv")
# .env.local lives in the dashboard repo (KITE_API_KEY=... line).
ENV_LOCAL_PATH = os.path.expanduser(
    "~/claude/personal/projects/portfolio-dashboard/.env.local"
)
# Corporate CA bundle (slice Netskope TLS intercept), if present.
CA_BUNDLE_PATH = os.path.expanduser(
    "~/claude/personal/projects/portfolio-dashboard/corp-ca-bundle.pem"
)

YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval=1d"
MFAPI = "https://api.mfapi.in/mf/{code}"
STOOQ_CSV = "https://stooq.com/q/d/l/?s={sym}&i=d"
KITE_HISTORICAL = "https://api.kite.trade/instruments/historical/{token}/day?from={frm}&to={to}"
KITE_INSTRUMENTS_NSE = "https://api.kite.trade/instruments/NSE"

# NIFTY 50 index. Verified 256265 against the live, no-auth Kite NSE instrument
# dump on 2026-06-10 (row: 256265,1001,NIFTY 50,"NIFTY 50",...,INDICES,NSE).
NSEI_INSTRUMENT_TOKEN = 256265

INSTRUMENTS_MAX_AGE_DAYS = 7

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_DEFAULT_UA = "python-urllib/backtest"

# How far back day-candle / CSV pulls reach (Kite allows ~2000 day candles per
# request, so 5y fits in one). Independent of the Yahoo `rng` string.
_HISTORY_DAYS = 5 * 366


class FetchBlocked(Exception):
    """Raised when a source stays blocked (429/403) even after the UA retry."""


class FetchEmpty(Exception):
    """Raised when a source responds but carries no usable price series."""


# --------------------------------------------------------------------------- #
# Source log — which source actually served each symbol this run.
# run_all.py folds this into backtest_results.json under decisions.sources /
# the "decisions" key so the run is auditable.
# --------------------------------------------------------------------------- #

_SOURCE_LOG: list[dict] = []


def _log_source(symbol: str, source: str, note: str = "") -> None:
    _SOURCE_LOG.append({"symbol": symbol, "source": source, "note": note})


def get_source_log() -> list[dict]:
    """Per-symbol record of which source served it (and fall-through notes)."""
    return list(_SOURCE_LOG)


def source_summary() -> dict:
    """Counts of which source served the symbols this run, e.g. {'yahoo':9}."""
    out: dict[str, int] = {}
    for rec in _SOURCE_LOG:
        out[rec["source"]] = out.get(rec["source"], 0) + 1
    return out


def reset_source_log() -> None:
    _SOURCE_LOG.clear()


def _mask(text: str) -> str:
    """Strip any api_key / access_token material from error text before it is
    surfaced or logged. Belt-and-braces: we never put secrets in messages, but
    if an upstream body echoes one we redact it."""
    masked = text
    try:
        key = _kite_api_key()
        if key:
            masked = masked.replace(key, "***API_KEY***")
    except Exception:
        pass
    try:
        tok = _kite_access_token()
        if tok:
            masked = masked.replace(tok, "***TOKEN***")
    except Exception:
        pass
    return masked


# --------------------------------------------------------------------------- #
# SSL context (honour the corporate CA bundle if present).
# --------------------------------------------------------------------------- #

def _ssl_context() -> ssl.SSLContext | None:
    if os.path.isfile(CA_BUNDLE_PATH):
        try:
            return ssl.create_default_context(cafile=CA_BUNDLE_PATH)
        except Exception:
            return None
    return None


_SSL_CTX = _ssl_context()


# --------------------------------------------------------------------------- #
# Generic HTTP GET (browser-UA backoff on 429/403). Used by Yahoo + stooq +
# mfapi. Kite calls use a dedicated authed helper below.
# --------------------------------------------------------------------------- #

# Process-wide Yahoo circuit-breaker. When Yahoo starts rate-limiting by IP,
# EVERY subsequent symbol 429s too — stacking the per-symbol 30s+60s backoff
# across ~20 symbols would blow the run's time budget (and was killing the
# harness). So once a Yahoo request exhausts its retries with a 429, we record
# a short cooldown; further Yahoo calls during that window fail fast (one shared
# wait, not N independent long ones), letting the router move on quickly.
_YAHOO_BLOCKED_UNTIL: float = 0.0
_YAHOO_COOLDOWN_SECS = 75.0


def _http_get(url: str, timeout: int = 30, headers: dict | None = None,
              host_kind: str = "generic") -> bytes:
    """GET with a plain UA, then browser-UA retries with growing backoff on
    429/403. Yahoo rate-limits by IP in bursts; a 30-60s backoff usually clears
    it, so we try up to 4 times before raising FetchBlocked.

    host_kind="yahoo" enables the shared circuit-breaker described above so a
    rate-limited Yahoo doesn't make the whole run stack per-symbol backoffs."""
    global _YAHOO_BLOCKED_UNTIL
    is_yahoo = host_kind == "yahoo"

    if is_yahoo and time.monotonic() < _YAHOO_BLOCKED_UNTIL:
        # Yahoo is in its shared cooldown; fail fast so the caller (already past
        # Kite+stooq) records a skip instead of waiting another 90s per symbol.
        raise FetchBlocked(f"{url} skipped: Yahoo in shared cooldown")

    last_exc: Exception | None = None
    plans = ((_DEFAULT_UA, 0), (_BROWSER_UA, 1.5), (_BROWSER_UA, 30), (_BROWSER_UA, 60))
    for attempt, (ua, backoff) in enumerate(plans):
        if backoff:
            time.sleep(backoff)
        hdrs = {"User-Agent": ua, "Accept": "application/json"}
        if headers:
            hdrs.update(headers)
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                time.sleep(1.2)  # pace successive requests below the rate limit
                if is_yahoo:
                    _YAHOO_BLOCKED_UNTIL = 0.0  # success clears the breaker
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code in (429, 403) and attempt < len(plans) - 1:
                continue
            if exc.code in (429, 403):
                if is_yahoo and exc.code == 429:
                    # trip the breaker so the rest of this run fails fast on Yahoo
                    _YAHOO_BLOCKED_UNTIL = time.monotonic() + _YAHOO_COOLDOWN_SECS
                raise FetchBlocked(f"{url} blocked with HTTP {exc.code}") from exc
            raise
        except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as exc:
            # Transient network error (DNS/connection reset, or — importantly —
            # a bare socket.timeout / TimeoutError, which is NOT a URLError and
            # would otherwise escape uncaught and kill the whole run, defeating
            # the A1 "stop dying" goal). One short retry, then surface it as a
            # typed FetchEmpty so the source router falls through cleanly to the
            # next source instead of crashing.
            last_exc = exc
            if attempt == 0:
                time.sleep(1.5)
                continue
            raise FetchEmpty(_mask(f"{url}: network error: {exc}")) from exc
    if last_exc:
        raise FetchEmpty(_mask(f"{url}: network error: {last_exc}")) from last_exc
    raise FetchEmpty(url)


# --------------------------------------------------------------------------- #
# Symbol classification + helpers
# --------------------------------------------------------------------------- #

def _is_in_symbol(symbol: str) -> bool:
    """True for Indian instruments routed via Kite first: NSE/BSE-suffixed
    equities and the NIFTY index."""
    s = symbol.strip().upper()
    return s == "^NSEI" or s.endswith(".NS") or s.endswith(".BO")


def _strip_in_suffix(symbol: str) -> str:
    """RELIANCE.NS -> RELIANCE (the Kite tradingsymbol form)."""
    s = symbol.strip().upper()
    for suf in (".NS", ".BO"):
        if s.endswith(suf):
            return s[: -len(suf)]
    return s


def _stooq_symbol(symbol: str) -> str | None:
    """Map our symbol convention onto stooq's. Returns None if there is no
    sensible stooq form. (Coverage is verified-unusable from this network as of
    2026-06-10 — see module docstring — but the mapping is correct.)"""
    s = symbol.strip().upper()
    if s == "^GSPC":
        return "^spx"
    if s == "^NSEI":
        return "^nsei"
    if s.endswith(".NS") or s.endswith(".BO"):
        return f"{_strip_in_suffix(s).lower()}.ns"
    # bare US ticker
    if s.startswith("^"):
        return s.lower()
    return f"{s.lower()}.us"


def _to_series(symbol: str, currency: str, pairs: list[tuple]) -> dict:
    """pairs = [(date, close), ...] oldest-first -> the canonical series dict."""
    pairs = [(d, float(c)) for d, c in pairs if c is not None]
    if not pairs:
        raise FetchEmpty(f"{symbol}: empty series")
    pairs.sort(key=lambda x: x[0])
    dates = [p[0] for p in pairs]
    closes = [p[1] for p in pairs]
    return {
        "symbol": symbol,
        "currency": currency,
        "dates": dates,
        "closes": closes,
        "latest_date": dates[-1],
        "latest_close": closes[-1],
    }


# --------------------------------------------------------------------------- #
# Kite Connect (IN primary) — auth, instrument map, historical candles.
# --------------------------------------------------------------------------- #

_KITE_AVAILABLE: bool | None = None  # None = untested; False = expired/no-creds
_KITE_UNAVAILABLE_REASON: str = ""   # human-readable, secret-free, set by probe
_KITE_API_KEY_CACHE: str | None = None
_KITE_TOKEN_CACHE: str | None = None
_INSTRUMENT_MAP: dict[str, int] | None = None


def _kite_api_key() -> str:
    global _KITE_API_KEY_CACHE
    if _KITE_API_KEY_CACHE is not None:
        return _KITE_API_KEY_CACHE
    key = ""
    try:
        with open(ENV_LOCAL_PATH, encoding="utf-8") as f:
            for line in f:
                if line.startswith("KITE_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except FileNotFoundError:
        key = ""
    _KITE_API_KEY_CACHE = key
    return key


def _kite_access_token() -> str:
    global _KITE_TOKEN_CACHE
    if _KITE_TOKEN_CACHE is not None:
        return _KITE_TOKEN_CACHE
    tok = ""
    try:
        with open(KITE_SESSION_PATH, encoding="utf-8") as f:
            tok = (json.load(f).get("access_token") or "").strip()
    except (FileNotFoundError, json.JSONDecodeError):
        tok = ""
    _KITE_TOKEN_CACHE = tok
    return tok


def _kite_auth_header() -> dict:
    return {
        "X-Kite-Version": "3",
        "Authorization": f"token {_kite_api_key()}:{_kite_access_token()}",
    }


def _kite_get(url: str, timeout: int = 40, authed: bool = True) -> bytes:
    """Authed Kite GET. Raises FetchBlocked on TokenException / 403 / 429 (all
    masked), FetchEmpty on other non-200s. Never leaks key/token."""
    headers = {"User-Agent": _DEFAULT_UA}
    if authed:
        headers.update(_kite_auth_header())
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        # Kite signals distinct 403 failure modes via error_type:
        #   TokenException      -> session expired/invalid (fixed by morning login)
        #   PermissionException -> the app lacks the paid Historical Data add-on
        #                          (a morning login will NOT fix this — the
        #                          subscription has to be enabled on the Kite
        #                          Connect app). Verified empirically 2026-06-10:
        #                          /user/profile + /portfolio/holdings return 200
        #                          while /instruments/historical/... returns this.
        # Either way it is a clean, typed fall-through to stooq/Yahoo.
        if "TokenException" in body:
            raise FetchBlocked("Kite session expired/invalid (TokenException) — run the morning Kite login") from None
        if "PermissionException" in body:
            raise FetchBlocked("Kite historical-data API not authorised for this app (PermissionException) — Historical Data add-on not enabled") from None
        if exc.code in (401, 403):
            raise FetchBlocked(_mask(f"Kite auth rejected (HTTP {exc.code})")) from None
        if exc.code in (429,):
            raise FetchBlocked(f"Kite rate-limited (HTTP {exc.code})") from None
        raise FetchEmpty(_mask(f"Kite HTTP {exc.code}: {body[:200]}")) from None
    except urllib.error.URLError as exc:
        raise FetchEmpty(_mask(f"Kite network error: {exc}")) from None


def _kite_creds_present() -> bool:
    return bool(_kite_api_key()) and bool(_kite_access_token())


def _kite_probe() -> bool:
    """Decide once per run whether Kite historical is usable, recording WHY it
    isn't (secret-free) in _KITE_UNAVAILABLE_REASON. Cheap probe: load/refresh
    the NSE instrument map, then make one tiny authed historical call on the
    NIFTY token. Distinguishes the failure modes that matter for the report:
    no creds, expired session (TokenException), or missing Historical Data
    add-on (PermissionException). Any failure -> Kite unavailable, fall through
    quietly to stooq/Yahoo for the rest of the run."""
    global _KITE_AVAILABLE, _KITE_UNAVAILABLE_REASON
    if _KITE_AVAILABLE is not None:
        return _KITE_AVAILABLE
    if not _kite_creds_present():
        _KITE_AVAILABLE = False
        _KITE_UNAVAILABLE_REASON = "no Kite creds (KITE_API_KEY / access_token absent)"
        return False
    try:
        _ensure_instrument_map()
        # Confirm the historical API itself with one tiny authed call on the
        # NIFTY token. A 403 here is TokenException (expired) or
        # PermissionException (add-on not enabled) — both raise FetchBlocked.
        _kite_candles(NSEI_INSTRUMENT_TOKEN, days=3)
        _KITE_AVAILABLE = True
        _KITE_UNAVAILABLE_REASON = ""
    except FetchBlocked as exc:
        _KITE_AVAILABLE = False  # expired / no add-on / rate-limited — fall through
        _KITE_UNAVAILABLE_REASON = _mask(str(exc))
    except Exception as exc:
        _KITE_AVAILABLE = False
        _KITE_UNAVAILABLE_REASON = _mask(f"Kite probe failed: {exc}")
    return _KITE_AVAILABLE


def _instruments_fresh() -> bool:
    try:
        age = time.time() - os.path.getmtime(KITE_INSTRUMENTS_PATH)
        return age < INSTRUMENTS_MAX_AGE_DAYS * 86400
    except OSError:
        return False


def _parse_instruments(raw_text: str) -> dict[str, int]:
    """Parse the NSE instrument dump CSV into tradingsymbol->token. Returns an
    empty mapping for non-CSV bodies (HTML interstitial / captcha / over-quota
    pages arrive as 200 OK and must not be trusted)."""
    mapping: dict[str, int] = {}
    reader = csv.DictReader(io.StringIO(raw_text))
    for row in reader:
        sym = (row.get("tradingsymbol") or "").strip().upper()
        tok = (row.get("instrument_token") or "").strip()
        if sym and tok.isdigit():
            mapping[sym] = int(tok)
    return mapping


def _ensure_instrument_map() -> dict[str, int]:
    """Load tradingsymbol->instrument_token for NSE. Downloads the dump once and
    caches it to the memory dir (refresh if >7d old). The dump endpoint is
    public (no auth needed), but we send the auth header anyway for parity with
    the documented API. Cache lives OUTSIDE the repo."""
    global _INSTRUMENT_MAP
    if _INSTRUMENT_MAP is not None:
        return _INSTRUMENT_MAP

    mapping: dict[str, int] = {}
    if _instruments_fresh():
        try:
            with open(KITE_INSTRUMENTS_PATH, encoding="utf-8") as f:
                mapping = _parse_instruments(f.read())
        except OSError:
            mapping = {}
        # A cached body that doesn't parse (e.g. a previously cached HTML
        # interstitial) is a cache MISS, not an error — fall through to a
        # fresh download instead of replaying the poison for 7 days.

    if not mapping:
        # Download fresh. The dump endpoint serves CSV without auth, but include
        # the header for parity; if creds are missing it still returns the dump.
        try:
            data = _kite_get(KITE_INSTRUMENTS_NSE, timeout=60,
                             authed=_kite_creds_present())
        except FetchBlocked:
            data = _kite_get(KITE_INSTRUMENTS_NSE, timeout=60, authed=False)
        raw_text = data.decode("utf-8", "replace")
        mapping = _parse_instruments(raw_text)
        if not mapping:
            # Validate BEFORE caching: a 200-OK HTML/over-quota body must never
            # reach the cache file, or _instruments_fresh() would replay it on
            # every run for up to INSTRUMENTS_MAX_AGE_DAYS. Fail loud instead.
            raise FetchEmpty("Kite NSE instrument dump unparseable / empty")
        os.makedirs(MEMORY_DIR, exist_ok=True)
        try:
            with open(KITE_INSTRUMENTS_PATH, "w", encoding="utf-8") as f:
                f.write(raw_text)
        except OSError:
            pass  # cache write is best-effort

    _INSTRUMENT_MAP = mapping
    return mapping


def _kite_token_for(symbol: str) -> int | None:
    """Resolve our symbol to a Kite NSE instrument_token, or None if unknown."""
    if symbol.strip().upper() == "^NSEI":
        return NSEI_INSTRUMENT_TOKEN
    base = _strip_in_suffix(symbol)
    try:
        return _ensure_instrument_map().get(base)
    except (FetchBlocked, FetchEmpty):
        return None


def _kite_candles(token: int, days: int = _HISTORY_DAYS) -> list[tuple]:
    """Day candles for an instrument_token over the last `days`. Returns
    [(date, close), ...] oldest-first. Raises FetchBlocked (expired session) /
    FetchEmpty. 5y of day candles fits in one request."""
    to = datetime.now(timezone.utc).date()
    frm = to - timedelta(days=days)
    url = KITE_HISTORICAL.format(token=token, frm=frm.isoformat(), to=to.isoformat())
    raw = _kite_get(url)
    doc = json.loads(raw)
    if doc.get("status") == "error":
        msg = doc.get("error_type") or doc.get("message") or "error"
        if "TokenException" in str(msg):
            raise FetchBlocked("Kite session expired (TokenException)")
        raise FetchEmpty(_mask(f"Kite candles error: {msg}"))
    candles = ((doc.get("data") or {}).get("candles")) or []
    pairs: list[tuple] = []
    for row in candles:
        # candle = [ts, open, high, low, close, volume]
        if not row or len(row) < 5:
            continue
        try:
            d = datetime.fromisoformat(str(row[0])).date()
            close = float(row[4])
        except (ValueError, TypeError):
            continue
        pairs.append((d, close))
    if not pairs:
        raise FetchEmpty(f"Kite token {token}: no candles")
    return pairs


def kite_series(symbol: str) -> dict:
    """IN price series via Kite historical candles. Currency INR.
    Raises FetchBlocked (session expired/no creds) or FetchEmpty (unknown symbol
    / no candles)."""
    if not _kite_probe():
        raise FetchBlocked(f"Kite unavailable ({_KITE_UNAVAILABLE_REASON})")
    token = _kite_token_for(symbol)
    if token is None:
        raise FetchEmpty(f"{symbol}: no Kite NSE instrument_token")
    pairs = _kite_candles(token)
    return _to_series(symbol, "INR", pairs)


# --------------------------------------------------------------------------- #
# stooq (US primary, IN secondary). Verified unusable from this network as of
# 2026-06-10 (see module docstring); kept so it self-heals elsewhere.
# --------------------------------------------------------------------------- #

def stooq_series(symbol: str) -> dict:
    """Daily series from stooq CSV. Raises FetchEmpty when stooq serves its
    generic 404 HTML (its over-quota / blocked-IP response) or has no rows."""
    ssym = _stooq_symbol(symbol)
    if not ssym:
        raise FetchEmpty(f"{symbol}: no stooq symbol mapping")
    url = STOOQ_CSV.format(sym=urllib.parse.quote(ssym, safe=""))
    try:
        raw = _http_get(url, headers={"Accept": "text/csv"})
    except urllib.error.HTTPError as exc:
        # stooq serves HTTP 404 for its over-quota / blocked-IP response (the
        # generic "page does not exist" page) — treat as "no data here" and let
        # the router fall through, rather than crashing the run.
        raise FetchEmpty(f"{symbol}: stooq HTTP {exc.code} (blocked/404)") from None
    except (FetchBlocked, FetchEmpty):
        raise
    text = raw.decode("utf-8", "replace")
    # stooq returns an HTML page (not CSV) when the symbol/endpoint is blocked.
    head = text.lstrip()[:64].lower()
    if head.startswith("<") or "the page you requested" in text.lower():
        raise FetchEmpty(f"{symbol}: stooq returned no CSV (blocked/404)")
    pairs: list[tuple] = []
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "Close" not in reader.fieldnames:
        raise FetchEmpty(f"{symbol}: stooq CSV has no Close column")
    for row in reader:
        try:
            d = datetime.strptime(row["Date"], "%Y-%m-%d").date()
            close = float(row["Close"])
        except (KeyError, ValueError, TypeError):
            continue
        pairs.append((d, close))
    if not pairs:
        raise FetchEmpty(f"{symbol}: stooq CSV empty")
    cur = "INR" if _is_in_symbol(symbol) else ("" if symbol.startswith("^") else "USD")
    return _to_series(symbol, cur, pairs)


# --------------------------------------------------------------------------- #
# Yahoo (last resort for IN, fallback for US). Unchanged parsing.
# --------------------------------------------------------------------------- #

def _yahoo_series_raw(symbol: str, rng: str = "2y") -> dict:
    raw = _http_get(YF_CHART.format(sym=urllib.parse.quote(symbol, safe="^"), rng=rng),
                    host_kind="yahoo")
    doc = json.loads(raw)
    chart = doc.get("chart") or {}
    if chart.get("error"):
        raise FetchEmpty(f"{symbol}: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise FetchEmpty(f"{symbol}: no result")
    res = results[0]
    meta = res.get("meta") or {}
    timestamps = res.get("timestamp") or []
    indicators = res.get("indicators") or {}

    # Prefer adjusted close; fall back to raw close.
    adj = (indicators.get("adjclose") or [{}])[0].get("adjclose")
    quote = (indicators.get("quote") or [{}])[0]
    raw_close = quote.get("close")
    closes_src = adj if adj else raw_close
    if not timestamps or not closes_src:
        raise FetchEmpty(f"{symbol}: empty series")

    dates, closes = [], []
    for ts, c in zip(timestamps, closes_src):
        if c is None:
            continue
        d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        dates.append(d)
        closes.append(float(c))
    if not closes:
        raise FetchEmpty(f"{symbol}: all-null series")

    return {
        "symbol": meta.get("symbol", symbol),
        "currency": meta.get("currency", ""),
        "dates": dates,
        "closes": closes,
        "latest_date": dates[-1],
        "latest_close": closes[-1],
    }


# --------------------------------------------------------------------------- #
# SOURCE ROUTER — the public `yahoo_series` entry point keeps its name and
# signature so callers (decisions_backtest, regime_gate_sim) need no change.
# It now routes by instrument class and only reaches Yahoo as a fallback.
# --------------------------------------------------------------------------- #

def yahoo_series(symbol: str, rng: str = "2y") -> dict:
    """
    Routed price-history fetch (name kept for backward compatibility).

      IN (.NS/.BO, ^NSEI): Kite historical  -> stooq -> Yahoo
      US (^GSPC, bare):     stooq            -> Yahoo

    Returns the canonical series dict
      {"symbol","currency","dates","closes","latest_date","latest_close"}.
    Records the source actually used in the source log. Raises FetchBlocked /
    FetchEmpty only when EVERY source for the class failed.
    """
    errors: list[str] = []

    if _is_in_symbol(symbol):
        # 1) Kite primary
        try:
            series = kite_series(symbol)
            _log_source(symbol, "kite", "IN primary")
            return series
        except FetchBlocked as exc:
            errors.append(f"kite: {_mask(str(exc))}")
        except FetchEmpty as exc:
            errors.append(f"kite: {_mask(str(exc))}")
        # 2) stooq secondary
        try:
            series = stooq_series(symbol)
            _log_source(symbol, "stooq", "IN fallback (Kite unavailable)")
            return series
        except (FetchBlocked, FetchEmpty) as exc:
            errors.append(f"stooq: {exc}")
        # 3) Yahoo last resort
        try:
            series = _yahoo_series_raw(symbol, rng=rng)
            _log_source(symbol, "yahoo", "IN last resort (Kite+stooq down)")
            return series
        except FetchBlocked as exc:
            errors.append(f"yahoo: {exc}")
            raise FetchBlocked(f"{symbol}: all IN sources failed [{'; '.join(errors)}]") from exc
        except FetchEmpty as exc:
            errors.append(f"yahoo: {exc}")
            raise FetchEmpty(f"{symbol}: all IN sources failed [{'; '.join(errors)}]") from exc

    # US (^GSPC and bare tickers)
    # 1) stooq primary
    try:
        series = stooq_series(symbol)
        _log_source(symbol, "stooq", "US primary")
        return series
    except (FetchBlocked, FetchEmpty) as exc:
        errors.append(f"stooq: {exc}")
    # 2) Yahoo fallback
    try:
        series = _yahoo_series_raw(symbol, rng=rng)
        _log_source(symbol, "yahoo", "US fallback (stooq down)")
        return series
    except FetchBlocked as exc:
        errors.append(f"yahoo: {exc}")
        raise FetchBlocked(f"{symbol}: all US sources failed [{'; '.join(errors)}]") from exc
    except FetchEmpty as exc:
        errors.append(f"yahoo: {exc}")
        raise FetchEmpty(f"{symbol}: all US sources failed [{'; '.join(errors)}]") from exc


def resolve_equity(ticker: str, asset: str) -> list[str]:
    """
    Candidate symbols for a decision ticker, in try-order.
      - us-equity: bare symbol
      - in-equity / metals (NSE-listed ETFs): try .NS then .BO
    """
    t = ticker.strip().upper()
    if asset == "us-equity":
        return [t]
    # in-equity, metals (GOLDCASE/SILVERCASE are NSE), and anything else equity-like
    return [f"{t}.NS", f"{t}.BO"]


def fetch_equity(ticker: str, asset: str, rng: str = "2y") -> dict:
    """
    Try each candidate symbol through the source router; return the first that
    yields a series. Raises FetchBlocked if every candidate was blocked,
    FetchEmpty if none had data.
    """
    blocked = False
    last_empty: Exception | None = None
    for sym in resolve_equity(ticker, asset):
        try:
            return yahoo_series(sym, rng=rng)
        except FetchBlocked as exc:
            blocked = True
            last_empty = exc
            continue
        except FetchEmpty as exc:
            last_empty = exc
            continue
    if blocked:
        raise FetchBlocked(f"{ticker}: all candidate symbols blocked")
    raise FetchEmpty(f"{ticker}: no candidate symbol returned data ({last_empty})")


def mfapi_series(scheme_code: int) -> dict:
    """
    Indian MF NAV history from mfapi.in.
    Returns the same shape as yahoo_series (currency INR).
    """
    raw = _http_get(MFAPI.format(code=scheme_code))
    doc = json.loads(raw)
    data = doc.get("data") or []
    if not data:
        raise FetchEmpty(f"mf {scheme_code}: no data")
    # mfapi returns newest-first, dates as dd-mm-yyyy
    pairs = []
    for row in data:
        try:
            d = datetime.strptime(row["date"], "%d-%m-%Y").date()
            nav = float(row["nav"])
        except (KeyError, ValueError):
            continue
        if nav <= 0:
            continue
        pairs.append((d, nav))
    if not pairs:
        raise FetchEmpty(f"mf {scheme_code}: unparseable")
    pairs.sort(key=lambda x: x[0])  # oldest-first
    dates = [p[0] for p in pairs]
    closes = [p[1] for p in pairs]
    name = (doc.get("meta") or {}).get("scheme_name", str(scheme_code))
    _log_source(name, "mfapi", f"scheme {scheme_code}")
    return {
        "symbol": name,
        "currency": "INR",
        "dates": dates,
        "closes": closes,
        "latest_date": dates[-1],
        "latest_close": closes[-1],
    }
