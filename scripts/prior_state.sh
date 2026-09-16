#!/usr/bin/env bash
# prior_state.sh [in|us|mf|all] — bucket\tticker\tqty\tltp fingerprints from state files.
set -u
MEM="${PORTFOLIO_MEMORY_DIR:-$HOME/.claude/projects/$(echo "$HOME" | tr '/' '-')/memory}"
W="${1:-all}"
python3 - "$MEM" "$W" <<'PY'
import json, sys, re
M, w = sys.argv[1], sys.argv[2]
if w in ("in", "all"):
    try:
        for h in json.load(open(f"{M}/latest_snapshot.json"))["holdings"]:
            print(f"in\t{h['ticker']}\t{h['qty']}\t{h.get('ltp','-')}")
    except Exception: pass
if w in ("us", "all"):
    try:
        for p in json.load(open(f"{M}/us_stocks.json"))["positions"]:
            print(f"us\t{p['ticker']}\t{p['quantity']}\t{p.get('currentPriceUSD','-')}")
    except Exception: pass
if w in ("mf", "all"):
    try:
        txt = open(f"{M}/project_mutual_funds.md").read()
        for m in re.finditer(r'^\|\s*([A-Z][A-Z0-9 ()./&-]+?)\s*\|\s*([\d,]+\.?\d*)\s*\|', txt, re.M):
            name = m.group(1).strip()
            if name.upper() in ("FUND", "TOTAL", "**TOTAL**"): continue
            print(f"mf\t{name}\t{m.group(2).replace(',','')}\t-")
    except Exception: pass
PY
