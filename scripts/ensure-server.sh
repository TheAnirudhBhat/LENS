#!/usr/bin/env bash
# ensure-server.sh — keepalive for the LENS prod server on :3002.
#
# Idempotent: exits immediately if the port is already served, else (re)starts
# `next start`. Designed to be run every few minutes from cron so a crash or
# machine sleep self-heals WITHOUT Claude. This replaces the launchd approach —
# this machine's MDM/Login-Items policy rejects launchd bootstrap (IO-error 5)
# and periodically wipes ~/Library/LaunchAgents, so a cron keepalive that lives
# in the git repo (restorable, wipe-survivable) is the robust path.
set -u
PORT=3002
REPO="${LENS_REPO:-$HOME/claude/personal/projects/portfolio-dashboard}"
LOG=/tmp/lens-server.log

# Newest nvm node (version-agnostic), else whatever's on PATH.
NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
[ -x "$NODE" ] || { echo "[$(date '+%F %T')] ensure-server: no node found" >> "$LOG"; exit 1; }

# Put node's dir on PATH so `next` (shebang #!/usr/bin/env node) and any child
# processes it spawns resolve node when launched from cron's minimal PATH.
export PATH="$(dirname "$NODE"):$PATH"

# Already serving? done.
if curl -s -o /dev/null --max-time 4 "http://localhost:$PORT/api/kite/status" 2>/dev/null; then
  exit 0
fi

cd "$REPO" || { echo "[$(date '+%F %T')] ensure-server: repo missing $REPO" >> "$LOG"; exit 1; }
# Reap any half-dead listener, then relaunch detached.
kill "$(lsof -ti:$PORT 2>/dev/null)" 2>/dev/null || true
sleep 1
nohup "$NODE" scripts/run-next.mjs start -p "$PORT" >> "$LOG" 2>&1 &
echo "[$(date '+%F %T')] ensure-server: started (was down), node=$NODE" >> "$LOG"
