# data/

This folder holds the four (well, five) advisory files an AI agent writes by
following `GLOBALS.md`. They are **gitignored** (they contain portfolio-specific
analysis), so on a fresh clone this folder starts empty and the dashboard shows
"not generated yet" states until you run the tasks.

Files the agent creates here:

- `sector_distribution.json` — Task 1 (Sectors tab)
- `holding_changes.json` — Task 2 (Holding Changes Suggested tab)
- `new_picks.json` — Task 3 (New Picks For You tab)
- `insights.json` — Task 4 (Insights tab)
- `fundamentals.json` — Task 5 (Fundamentals tab)

To populate them, open this folder in Claude or Gemini and say:
"Read GLOBALS.md and run all five tasks."
