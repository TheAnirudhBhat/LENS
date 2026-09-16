#!/usr/bin/env bash
# install-automation.sh — (re)install LENS's no-Claude automation. Idempotent.
# Run this once, and again any time the environment wipes the crontab (this
# machine's MDM periodically clears ~/Library/LaunchAgents and the memory
# scripts dir; the crontab has been more durable). Everything it installs
# points back at scripts in THIS git repo, so `git checkout` + this script
# fully restores automation after any wipe.
#
#   bash scripts/install-automation.sh
#
# Installs: @reboot + every-5-min server keepalive, and 3×/day price refresh
# (09:20 / 16:30 / 22:00 local IST). No launchd, no Claude.
set -u
S="$(cd "$(dirname "$0")" && pwd)"
MARK="# LENS-automation"

( crontab -l 2>/dev/null | grep -v "$S/ensure-server.sh" | grep -v "$S/auto-refresh.py" | grep -v "^${MARK}"
  echo "${MARK} (restore: bash scripts/install-automation.sh)"
  echo "@reboot ${S}/ensure-server.sh"
  echo "*/5 * * * * ${S}/ensure-server.sh"
  echo "20 9 * * * /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
  echo "30 16 * * * /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
  echo "0 22 * * * /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
) | crontab -

if crontab -l 2>/dev/null | grep -q "$S/ensure-server.sh"; then
  echo "crontab: installed (keepalive every 5m + 3x daily refresh)"
else
  echo "crontab: FAILED — check 'crontab -l' / Full-Disk-Access for cron"
fi
"$S/ensure-server.sh" && echo "server: ensured up on :3002"
