#!/usr/bin/env bash
# kite_status.sh — OK <user_id> <expires_at> | EXPIRED <expires_at> | NOT_LOGGED_IN
set -u
MEM="${PORTFOLIO_MEMORY_DIR:-$HOME/.claude/projects/$(echo "$HOME" | tr '/' '-')/memory}"
python3 - "$MEM/kite-session.json" <<'PY'
import json, sys
from datetime import datetime, timezone
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("NOT_LOGGED_IN"); raise SystemExit
tok, exp = d.get("access_token"), d.get("expires_at")
if not tok:
    print("NOT_LOGGED_IN"); raise SystemExit
try:
    ok = datetime.fromisoformat(exp.replace("Z", "+00:00")) > datetime.now(timezone.utc)
except Exception:
    ok = False
print(f"OK {d.get('user_id','?')} {exp}" if ok else f"EXPIRED {exp}")
PY
