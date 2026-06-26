#!/bin/bash
# Double-click this file (macOS) to launch the portfolio dashboard.
# It starts a tiny local server (Python standard library only — installs nothing,
# touches no system packages) and opens the dashboard. Use the "Update Portfolio"
# button in the app to upload new Groww .xlsx exports; the server rebuilds
# portfolio.json for you.
#
# To stop it: close this Terminal window, or press Ctrl+C.

cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:${PORT}/dashboard.html"

# Pick a Python (stdlib only is used; nothing is installed).
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

echo "Starting portfolio server on ${URL}"
echo "Use the in-app 'Update Portfolio' button to upload new .xlsx exports."
echo "Press Ctrl+C to stop."

# Open the browser shortly after the server starts.
( sleep 1; (command -v open >/dev/null && open "${URL}") || (command -v xdg-open >/dev/null && xdg-open "${URL}") ) &

"$PY" server.py "${PORT}"
