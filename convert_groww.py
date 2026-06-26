#!/usr/bin/env python3
"""
convert_groww.py — turn the two Groww .xlsx exports into holdings_latest.json.

Reads from ./initial_stage/:
  * Holdings_Statement_*.xlsx            (mutual funds)
  * Stocks_Holdings_Statement_*.xlsx     (stocks & ETFs)

and writes ./holdings_latest.json in the exact schema the dashboard/engine use.

Privacy: personal details (Name, PAN, Mobile, Client Code) are NEVER read into
the output — only the holdings tables are parsed. See PII_BLOCK below.

Standard library only. No installs, no network. Run:
    python3 convert_groww.py [--force]

Behaviour:
  * Classifies stocks/ETFs via instruments.json (ISIN map); unknown ISINs are
    derived from the ISIN prefix (INE=stock, INF=ETF) and flagged with a warning.
  * If the resulting portfolio differs from the current holdings_latest.json, the
    current file is rotated into ./backups/ (last 3 kept) before overwriting.
  * --force writes even if nothing changed.
"""

import os
import re
import sys
import glob
import json
import datetime as _dt

import portfolio_lib as P

HERE = P.HERE
STAGE = os.path.join(HERE, "initial_stage")

# Hardcoded: these labels mark the personal-details block we must never export.
PII_BLOCK = {"name", "mobile number", "mobile", "pan", "unique client code",
             "client code", "personal details", "email", "address"}


# --------------------------------------------------------------------------- #
# small parsers
# --------------------------------------------------------------------------- #
def fnum(x):
    try:
        return float(str(x).replace(",", "").strip())
    except (ValueError, AttributeError):
        return 0.0


def fpct(x):
    s = str(x).replace("%", "").replace(",", "").strip()
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def r2(x):
    return round(float(x), 2)


def find_header(rows, first_cell):
    for i, r in enumerate(rows):
        if r and str(r[0]).strip().lower() == first_cell.lower():
            return i
    return -1


def date_in(text):
    """Extract a date as YYYY-MM-DD, accepting YYYY-MM-DD or DD-MM-YYYY input."""
    s = str(text or "")
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"(\d{2})-(\d{2})-(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def newest(pattern):
    files = glob.glob(os.path.join(STAGE, pattern))
    if not files:
        return None
    # Pick the most recently written file. This makes the pipeline robust whether
    # you dropped a file in manually or uploaded it via the dashboard (the freshly
    # written upload always has the newest mtime), without relying on being able to
    # delete the older files.
    return max(files, key=os.path.getmtime)


# --------------------------------------------------------------------------- #
# parse mutual-funds export
# --------------------------------------------------------------------------- #
def parse_mfs(path):
    rows = P.read_xlsx(path)
    hdr = find_header(rows, "Scheme Name")
    if hdr < 0:
        raise SystemExit(f"Could not find MF holdings header in {path}")
    stmt_date = None
    for r in rows[:hdr]:
        for cell in r:
            if "holdings as on" in str(cell).lower():
                stmt_date = date_in(cell)
    funds = []
    for r in rows[hdr + 1:]:
        scheme = (r[0] if len(r) > 0 else "").strip()
        if not scheme or scheme.lower() in PII_BLOCK:
            continue
        units = fnum(r[6]) if len(r) > 6 else 0.0
        invested = fnum(r[7]) if len(r) > 7 else 0.0
        current = fnum(r[8]) if len(r) > 8 else 0.0
        returns = fnum(r[9]) if len(r) > 9 else 0.0
        xirr = fpct(r[10]) if len(r) > 10 else None
        amc = (r[1] if len(r) > 1 else "").strip()
        amc = re.sub(r"\s+Mutual Fund$", "", amc, flags=re.I)
        funds.append({
            "scheme": scheme,
            "amc": amc,
            "folio": (str(r[4]).strip() if len(r) > 4 else ""),
            "units": round(units, 3),
            "nav": (round(current / units, 4) if units else None),
            "invested": r2(invested),
            "current": r2(current),
            "pnl": r2(returns),
            "pnlPct": (r2(returns / invested * 100) if invested else 0.0),
            "xirr": xirr,
            "growwCategory": (str(r[2]).strip() if len(r) > 2 else None),
            "growwSubCategory": (str(r[3]).strip() if len(r) > 3 else None),
        })
    return funds, stmt_date, (fpct(rows[6][4]) if len(rows) > 6 and len(rows[6]) > 4 else None)


# --------------------------------------------------------------------------- #
# parse stocks / ETF export
# --------------------------------------------------------------------------- #
def prettify(name):
    n = re.sub(r"\s+", " ", str(name)).strip()
    if " - " in n:                       # e.g. "GROWWAMC - GROWWGOLD"
        n = n.split(" - ", 1)[1]
    n = n.title()
    n = re.sub(r"\bLtd\.?\b", "Ltd", n).replace(" Limited", " Ltd")
    return n


def parse_stocks(path, instruments):
    rows = P.read_xlsx(path)
    hdr = find_header(rows, "Stock Name")
    if hdr < 0:
        raise SystemExit(f"Could not find stock holdings header in {path}")
    # the statement date lives inside the file ("...as on 19-06-2026"); fall back to filename
    stmt_date = None
    for r in rows[:hdr]:
        for cell in r:
            d = date_in(cell)
            if d:
                stmt_date = d
                break
        if stmt_date:
            break
    if not stmt_date:
        stmt_date = date_in(os.path.basename(path))
    warnings = []
    out = []
    for r in rows[hdr + 1:]:
        name_raw = (r[0] if len(r) > 0 else "").strip()
        if not name_raw or name_raw.lower() in PII_BLOCK:
            continue
        isin = (r[1] if len(r) > 1 else "").strip()
        qty = fnum(r[2]) if len(r) > 2 else 0.0
        avg = fnum(r[3]) if len(r) > 3 else 0.0
        buyval = fnum(r[4]) if len(r) > 4 else 0.0
        close_price = fnum(r[5]) if len(r) > 5 else 0.0
        close_val = fnum(r[6]) if len(r) > 6 else 0.0
        pnl = fnum(r[7]) if len(r) > 7 else (close_val - buyval)

        inst = instruments.get(isin)
        if inst:
            name = inst.get("name", prettify(name_raw))
            symbol = inst.get("symbol")
            asset_type = inst.get("assetType")
            exchange = inst.get("exchange")
            category = inst.get("category")
        else:
            asset_type = "ETF" if isin.upper().startswith("INF") else "EQUITY"
            name = prettify(name_raw)
            symbol = (name_raw.split(" - ")[-1].strip().upper().replace(" ", "")
                      if " - " in name_raw else re.sub(r"[^A-Z0-9]", "", name_raw.upper())[:12])
            exchange = None
            category = None  # let the engine classify by name / EQUITY-rule
            warnings.append(f"  ! ISIN {isin} ({name_raw}) not in instruments.json — "
                            f"derived assetType={asset_type}; add it for best accuracy.")

        out.append({
            "symbol": symbol,
            "isin": isin,
            "name": name,
            "exchange": exchange,
            "assetType": asset_type,
            "quantity": qty,
            "avgPrice": r2(avg),
            "currentPrice": r2(close_price),
            "invested": r2(buyval),
            "current": r2(close_val),
            "pnl": r2(pnl),
            "pnlPct": (r2(pnl / buyval * 100) if buyval else 0.0),
            "category": category,
        })
    return out, stmt_date, warnings


# --------------------------------------------------------------------------- #
# build + write
# --------------------------------------------------------------------------- #
def build(mf_path, stk_path):
    instruments = P.load_json(os.path.join(HERE, "instruments.json")).get("byIsin", {})
    funds, mf_date, mf_xirr = parse_mfs(mf_path)
    stocks, stk_date, warnings = parse_stocks(stk_path, instruments)

    eq_val = r2(sum(s["current"] for s in stocks))
    mf_val = r2(sum(f["current"] for f in funds))
    invested = r2(sum(s["invested"] for s in stocks) + sum(f["invested"] for f in funds))
    current = r2(eq_val + mf_val)
    pnl = r2(current - invested)

    doc = {
        "source": "Groww (xlsx export -> convert_groww.py)",
        "generatedBy": "convert_groww.py",
        "fetchedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "statementDates": {"mutualFunds": mf_date, "stocks": stk_date},
        "currency": "INR",
        "summary": {
            "totalInvested": invested,
            "totalCurrent": current,
            "totalPnl": pnl,
            "totalPnlPct": (r2(pnl / invested * 100) if invested else 0.0),
            "equityAndEtfValue": eq_val,
            "mutualFundValue": mf_val,
            "usStocksValue": 0,
            "goldValue": 0,
        },
        "mutualFundsXirr": mf_xirr,
        "equityAndEtf": stocks,
        "mutualFunds": funds,
        "usStocks": [],
        "gold": [],
        "notes": ("Built from Groww .xlsx exports by convert_groww.py. Personal "
                  "details (name/PAN/mobile/client code) are intentionally excluded. "
                  "Stock/ETF classification uses instruments.json (by ISIN); mutual "
                  "funds are classified by scheme name."),
    }
    return doc, warnings


def _comparable(doc):
    """Strip volatile fields so we can tell if the portfolio really changed."""
    d = json.loads(json.dumps(doc))
    d.pop("fetchedAt", None)
    d.pop("generatedBy", None)
    return json.dumps(d, sort_keys=True)


def main(argv):
    force = "--force" in argv
    mf_path = newest("Holdings_Statement_*.xlsx")
    stk_path = newest("Stocks_Holdings_Statement_*.xlsx")
    if not mf_path or not stk_path:
        raise SystemExit(f"Need both exports in {STAGE}\n"
                         f"  MF file:    {mf_path}\n  Stocks file:{stk_path}")
    print(f"MF export:    {os.path.basename(mf_path)}")
    print(f"Stock export: {os.path.basename(stk_path)}")

    doc, warnings = build(mf_path, stk_path)
    for w in warnings:
        print(w)

    changed = True
    if os.path.exists(P.LATEST):
        try:
            changed = _comparable(doc) != _comparable(P.load_json(P.LATEST))
        except Exception:
            changed = True

    if not changed and not force:
        print("No change vs current portfolio.json — nothing written "
              "(use --force to write anyway).")
        return doc

    bid = P.rotate_backup(reason="convert_groww") if os.path.exists(P.LATEST) else None
    P.save_json(P.LATEST, doc)
    s = doc["summary"]
    print("-" * 56)
    if bid:
        print(f"Backed up previous state -> backups/{bid}.json")
    print(f"Wrote portfolio.json")
    print(f"  Invested Rs {s['totalInvested']:,.2f}  Current Rs {s['totalCurrent']:,.2f}  "
          f"P&L Rs {s['totalPnl']:,.2f} ({s['totalPnlPct']:+.2f}%)")
    print(f"  {len(doc['equityAndEtf'])} stocks/ETFs + {len(doc['mutualFunds'])} funds")
    return doc


if __name__ == "__main__":
    main(sys.argv[1:])
