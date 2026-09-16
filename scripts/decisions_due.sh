#!/usr/bin/env bash
# decisions_due.sh [YYYY-MM-DD]
# Pending-verdict decisions whose reviewAt is on or before the date (default today),
# one compact JSON object per line. Phase 3.2 of /portfolio-check uses this instead
# of reading decisions.json in full.
set -euo pipefail
MEM="${PORTFOLIO_MEMORY_DIR:-$HOME/.claude/projects/$(echo "$HOME" | tr '/' '-')/memory}"
D="${1:-$(date +%F)}"
jq -c --arg d "$D" '
  .decisions[]
  | select(.verdict == "pending" and ((.reviewAt // "9999-12-31") <= $d))
  | {id, date, ticker, action, qty, price, asset, reviewAt, rationale: ((.rationale // "") | .[0:80])}
' "$MEM/decisions.json"
