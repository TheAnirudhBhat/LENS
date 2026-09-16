#!/usr/bin/env bash
# cadence.sh [override] — level=daily|weekly|monthly|quarterly|annual + context lines.
set -u
MEM="${PORTFOLIO_MEMORY_DIR:-$HOME/.claude/projects/$(echo "$HOME" | tr '/' '-')/memory}"
python3 - "$MEM" "${1:-}" <<'PY'
import json, sys
from datetime import date
M, override = sys.argv[1], sys.argv[2]
today = date.today(); hist = []
try: hist = json.load(open(f"{M}/portfolio_history.json"))["history"][-35:]
except Exception: pass
def dparse(s):
    try: return date.fromisoformat(s)
    except Exception: return None
last = max((dparse(e["date"]) for e in hist if dparse(e["date"])), default=None)
lastfull = max((dparse(e["date"]) for e in hist if e.get("fullMode") and dparse(e["date"])), default=None)
lastq = max((dparse(e["date"]) for e in hist if e.get("quarterlyAudit") and dparse(e["date"])), default=None)
lasta = max((dparse(e["date"]) for e in hist if e.get("annualBaseline") and dparse(e["date"])), default=None)
days = (today - last).days if last else 999
if override:
    level, reason = override, "explicit override"
elif today.month == 4 and today.day <= 7 and not (lasta and (lasta.year == today.year or (lasta.year == today.year - 1 and lasta.month >= 4))):
    level, reason = "annual", "Apr 1-7, no baseline this FY"
elif today.month in (3, 6, 9, 12) and today.day <= 3 and (not lastq or (today - lastq).days > 85):
    level, reason = "quarterly", ">85d since last audit, quarter start"
elif today.day <= 3 and not (lastfull and lastfull.year == today.year and lastfull.month == today.month):
    level, reason = "monthly", "day-1-of-month, last full sync before current month"
elif (today.isoweekday() == 1 and days >= 5) or days >= 7:
    level, reason = "weekly", "Monday/7d-gap trigger"
else:
    level, reason = "daily", "no higher-level trigger"
print(f"level={level}")
print(f"lastSyncDate={last or 'never'}")
print(f"daysSinceLastSync={days}")
print(f"lastFullSyncDate={lastfull or 'never'}")
print(f"reason={reason}")
PY
