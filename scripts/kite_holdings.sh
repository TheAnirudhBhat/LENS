#!/usr/bin/env bash
# kite_holdings.sh — tradingsymbol|exchange|qty|avg_price|last_price|pnl per line.
# Key from $LENS_REPO/.env.local, token from memory/kite-session.json. Portable CA.
set -euo pipefail
MEM="${PORTFOLIO_MEMORY_DIR:-$HOME/.claude/projects/$(echo "$HOME" | tr '/' '-')/memory}"
REPO="${LENS_REPO:-$HOME/claude/personal/projects/portfolio-dashboard}"
read -r API_KEY ACCESS < <(python3 - "$REPO/.env.local" "$MEM/kite-session.json" <<'PY'
import sys, json, re
key = tok = ""
try:
    for line in open(sys.argv[1]):
        m = re.match(r'\s*KITE_API_KEY=(.*)', line)
        if m: key = m.group(1).strip().strip('"').strip("'")
except Exception: pass
try: tok = json.load(open(sys.argv[2])).get("access_token", "")
except Exception: pass
print(key or "_", tok or "_")
PY
)
[ "$API_KEY" = "_" ] && { echo "ERR no KITE_API_KEY in $REPO/.env.local" >&2; exit 1; }
[ "$ACCESS" = "_" ] && { echo "ERR no access_token (kite-session.json missing — login via dashboard)" >&2; exit 1; }
CA=""; [ -f "$HOME/.ssl/netskope-ca.pem" ] && CA="--cacert $HOME/.ssl/netskope-ca.pem"
curl -s $CA -H "Authorization: token $API_KEY:$ACCESS" -H "X-Kite-Version: 3" \
  https://api.kite.trade/portfolio/holdings | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("status") != "success":
    print("ERR", d.get("message", d), file=sys.stderr); sys.exit(1)
for h in d["data"]:
    q = h["quantity"] + h.get("t1_quantity", 0)
    print("%s|%s|%s|%s|%s|%s" % (h["tradingsymbol"], h["exchange"], q, h["average_price"], h["last_price"], h["pnl"]))'
