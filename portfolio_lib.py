#!/usr/bin/env python3
"""
portfolio_lib.py — shared helpers for the Groww pipeline.

Standard library only (zipfile + xml). Nothing is installed; your system
packages are never touched. Provides:

  * read_xlsx(path)      -> list of rows (each a list of cell strings)
  * load_json / save_json
  * rotate_backup(...)   -> keep the last N snapshots of holdings_latest.json
  * backup_index(...)    -> manifest the dashboard reads to offer "revert"
  * portfolio_summary(holdings) -> small dict of headline metrics
"""

import os
import re
import json
import shutil
import datetime as _dt
import zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(HERE, "backups")
LATEST = os.path.join(HERE, "portfolio.json")   # single source of truth
KEEP_BACKUPS = 3

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# --------------------------------------------------------------------------- #
# Minimal .xlsx reader (no third-party deps)
# --------------------------------------------------------------------------- #
def _col_to_idx(ref):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    col = 0
    for ch in m.group(1):
        col = col * 26 + (ord(ch) - 64)
    return col - 1


def read_xlsx(path, sheet="xl/worksheets/sheet1.xml"):
    """Return the first worksheet as a list of rows (list[str])."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{_NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{_NS}t")))
    root = ET.fromstring(z.read(sheet))
    rows = []
    for row in root.iter(f"{_NS}row"):
        cells = {}
        maxc = -1
        for c in row.findall(f"{_NS}c"):
            ci = _col_to_idx(c.get("r"))
            maxc = max(maxc, ci)
            t = c.get("t")
            v = c.find(f"{_NS}v")
            isv = c.find(f"{_NS}is")
            val = ""
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr" and isv is not None:
                val = "".join(x.text or "" for x in isv.iter(f"{_NS}t"))
            elif v is not None:
                val = v.text
            cells[ci] = val
        rows.append([cells.get(i, "") for i in range(maxc + 1)])
    return rows


# --------------------------------------------------------------------------- #
# JSON helpers
# --------------------------------------------------------------------------- #
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)


def portfolio_summary(h):
    s = h.get("summary", {}) or {}
    n = len(h.get("equityAndEtf", []) or []) + len(h.get("mutualFunds", []) or []) \
        + len(h.get("usStocks", []) or []) + len(h.get("gold", []) or [])
    return {
        "invested": s.get("totalInvested"),
        "current": s.get("totalCurrent"),
        "pnl": s.get("totalPnl"),
        "pnlPct": s.get("totalPnlPct"),
        "holdings": n,
        "fetchedAt": h.get("fetchedAt"),
    }


# --------------------------------------------------------------------------- #
# Backups (keep last N states of holdings_latest.json)
# --------------------------------------------------------------------------- #
def _read_index():
    idx = os.path.join(BACKUP_DIR, "index.json")
    if os.path.exists(idx):
        try:
            return load_json(idx)
        except Exception:
            pass
    return {"states": []}


def _write_index(index):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    save_json(os.path.join(BACKUP_DIR, "index.json"), index)


def rotate_backup(reason="update", keep=KEEP_BACKUPS):
    """Copy the CURRENT holdings_latest.json into backups/ before it is
    overwritten, update the manifest, and prune to the newest `keep`.
    Returns the backup id created, or None if there was nothing to back up."""
    if not os.path.exists(LATEST):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    try:
        current = load_json(LATEST)
    except Exception:
        return None

    ts = _dt.datetime.now(_dt.timezone.utc)
    bid = "holdings_" + ts.strftime("%Y%m%d_%H%M%S")
    fname = bid + ".json"
    shutil.copy2(LATEST, os.path.join(BACKUP_DIR, fname))

    index = _read_index()
    index["states"] = [s for s in index.get("states", []) if s.get("id") != bid]
    index["states"].insert(0, {
        "id": bid,
        "file": fname,
        "createdAt": ts.isoformat(),
        "reason": reason,
        "source": current.get("source"),
        "asOf": current.get("fetchedAt"),
        "summary": portfolio_summary(current),
    })

    # prune
    keep_states = index["states"][:keep]
    for old in index["states"][keep:]:
        p = os.path.join(BACKUP_DIR, old.get("file", ""))
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass
    index["states"] = keep_states
    index["updatedAt"] = ts.isoformat()
    _write_index(index)
    return bid


def list_backups():
    return _read_index().get("states", [])
