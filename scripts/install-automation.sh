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
# Installs: @reboot + every-5-min server keepalive, and 4×/day price refresh +
# alert pass (09:20 / 15:20 pre-close Mon-Fri / 16:30 / 22:00 local IST). Alerts
# = watch_levels.json price cuts + alerts.json dated items + decisions due ->
# macOS notification + Overview banner. No launchd, no Claude.
set -u
S="$(cd "$(dirname "$0")" && pwd)"
MARK="# LENS-automation"

( crontab -l 2>/dev/null | grep -v "$S/ensure-server.sh" | grep -v "$S/auto-refresh.py" | grep -v "^${MARK}"
  echo "${MARK} (restore: bash scripts/install-automation.sh)"
  echo "@reboot ${S}/ensure-server.sh"
  echo "*/5 * * * * ${S}/ensure-server.sh"
  echo "20 9 * * * /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
  echo "20 15 * * 1-5 /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
  echo "30 16 * * * /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
  echo "0 22 * * * /usr/bin/python3 ${S}/auto-refresh.py >> /tmp/lens-auto-refresh.log 2>&1"
) | crontab -

if crontab -l 2>/dev/null | grep -q "$S/ensure-server.sh"; then
  echo "crontab: installed (keepalive every 5m + 4x daily refresh/alerts)"
else
  echo "crontab: FAILED — check 'crontab -l' / Full-Disk-Access for cron"
fi
"$S/ensure-server.sh" && echo "server: ensured up on :3002"
