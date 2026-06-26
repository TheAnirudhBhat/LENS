#!/usr/bin/env python3
"""
revert.py — restore a previous portfolio snapshot as the live data.

The dashboard's History tab lets you PREVIEW an earlier backup. To make that
revert permanent (so holdings_latest.json and the analysis actually change), run
the command it shows you:

    python3 revert.py <backup-id>          # e.g. python3 revert.py holdings_20260619_200707
    python3 revert.py --list               # show the last 3 backups
    python3 revert.py --latest             # revert to the most recent backup

What it does:
  1. Backs up the CURRENT holdings_latest.json (so a revert is itself undoable).
  2. Copies the chosen backup over holdings_latest.json.
  3. Re-runs analyze.py so report.json / report.md match the reverted data.

Standard library only. No installs, no network.

NOTE: this changes your data. Any AI-written narrative analysis is now stale and
should be regenerated (the deterministic report.json is refreshed automatically).
"""

import os
import sys
import shutil
import subprocess

import portfolio_lib as P


def show_list():
    states = P.list_backups()
    if not states:
        print("No backups yet. Run convert_groww.py first.")
        return
    print("Available backups (newest first):")
    for s in states:
        sm = s.get("summary", {})
        print(f"  {s['id']}   {sm.get('current')}  ({sm.get('pnlPct')}%)  "
              f"as of {sm.get('fetchedAt')}  [{s.get('reason')}]")
    print("\nRevert with:  python3 revert.py <backup-id>")


def resolve(arg):
    states = P.list_backups()
    if arg == "--latest":
        return states[0] if states else None
    for s in states:
        if arg == s["id"] or arg == s.get("file") or arg == s["id"] + ".json":
            return s
    return None


def main(argv):
    if not argv or argv[0] in ("--list", "-l"):
        show_list()
        return
    target = resolve(argv[0])
    if not target:
        print(f"Backup '{argv[0]}' not found.\n")
        show_list()
        raise SystemExit(1)

    src = os.path.join(P.BACKUP_DIR, target["file"])
    if not os.path.exists(src):
        raise SystemExit(f"Backup file missing on disk: {src}")

    # 1) back up current so this revert is undoable
    if os.path.exists(P.LATEST):
        bid = P.rotate_backup(reason="pre_revert")
        if bid:
            print(f"Saved current state -> backups/{bid}.json (so you can undo this revert)")

    # 2) restore chosen snapshot
    shutil.copy2(src, P.LATEST)
    print(f"Reverted holdings_latest.json <- {target['id']}")

    # 3) refresh deterministic analysis
    analyze = os.path.join(P.HERE, "analyze.py")
    if os.path.exists(analyze):
        subprocess.run([sys.executable, analyze, P.LATEST, "--quiet"], cwd=P.HERE)
        print("Re-ran analyze.py -> report.json / report.md refreshed.")

    print("\nDone. The dashboard will show the reverted numbers on its next refresh.")
    print("Reminder: any AI-written narrative analysis is now out of date — "
          "re-run it if you use one (see AGENT.md).")


if __name__ == "__main__":
    main(sys.argv[1:])
