#!/usr/bin/env bash
# tail_log.sh decisions|history [N] — last N entries as compact JSON array.
set -u
MEM="${PORTFOLIO_MEMORY_DIR:-$HOME/.claude/projects/$(echo "$HOME" | tr '/' '-')/memory}"
python3 - "$MEM" "${1:-decisions}" "${2:-5}" <<'PY'
import json, sys
M, which, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
if which == "decisions":
    arr = json.load(open(f"{M}/decisions.json"))["decisions"][:n]   # newest-first file
else:
    arr = json.load(open(f"{M}/portfolio_history.json"))["history"][-n:]
print(json.dumps(arr, ensure_ascii=False))
PY
