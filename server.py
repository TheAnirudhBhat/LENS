#!/usr/bin/env python3
"""
server.py — tiny local server for the portfolio dashboard.

Serves the dashboard and data files (like `python3 -m http.server`) AND adds a few
write endpoints so the "Update Portfolio" overlay can rebuild portfolio.json from
uploaded Groww .xlsx files. Standard library only — nothing installed, binds to
localhost only.

    python3 server.py [port]            # default 8765

Endpoints
  GET  /api/status                      -> { server, summary, asOf }
  POST /api/upload?kind=stocks|mf       -> body = raw .xlsx bytes; saves into initial_stage/
  POST /api/convert                     -> runs the converter -> portfolio.json (+ backup)

Everything else is static file serving from this folder.
"""

import os
import io
import sys
import glob
import json
import contextlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
STAGE = os.path.join(HERE, "initial_stage")

import portfolio_lib as P          # noqa: E402
import convert_groww               # noqa: E402

# kind -> (canonical saved filename, glob to clear first)
KINDS = {
    "mf":     ("Holdings_Statement_upload.xlsx",        "Holdings_Statement_*.xlsx"),
    "stocks": ("Stocks_Holdings_Statement_upload.xlsx", "Stocks_Holdings_Statement_*.xlsx"),
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, fmt, *args):
        sys.stderr.write("  [server] " + (fmt % args) + "\n")

    # ---- helpers ----
    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _summary(self):
        if os.path.exists(P.LATEST):
            try:
                return P.portfolio_summary(P.load_json(P.LATEST))
            except Exception:
                return None
        return None

    # ---- GET ----
    def do_GET(self):
        if urlparse(self.path).path == "/api/status":
            return self._json(200, {"server": "portfolio", "ok": True,
                                    "summary": self._summary(),
                                    "asOf": (P.load_json(P.LATEST).get("fetchedAt")
                                             if os.path.exists(P.LATEST) else None)})
        return super().do_GET()

    # ---- POST ----
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/upload":
                return self._upload(parse_qs(parsed.query))
            if path == "/api/convert":
                return self._convert()
            return self._json(404, {"ok": False, "error": "unknown endpoint"})
        except Exception as e:
            return self._json(500, {"ok": False, "error": f"{e.__class__.__name__}: {e}"})

    def _upload(self, qs):
        kind = (qs.get("kind", [""])[0]).lower()
        if kind not in KINDS:
            return self._json(400, {"ok": False, "error": "kind must be 'stocks' or 'mf'"})
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return self._json(400, {"ok": False, "error": "empty upload"})
        data = self.rfile.read(length)
        if data[:2] != b"PK":     # .xlsx is a zip; must start with PK
            return self._json(400, {"ok": False, "error": "not a valid .xlsx file"})

        os.makedirs(STAGE, exist_ok=True)
        canonical, pattern = KINDS[kind]
        # clear previous files of this kind so the converter picks exactly this one
        for old in glob.glob(os.path.join(STAGE, pattern)):
            try:
                os.remove(old)
            except OSError:
                pass
        dest = os.path.join(STAGE, canonical)
        with open(dest, "wb") as f:
            f.write(data)
        return self._json(200, {"ok": True, "kind": kind, "saved": canonical,
                                "bytes": len(data)})

    def _convert(self):
        # need both a stocks file and an MF file present
        have_mf = glob.glob(os.path.join(STAGE, "Holdings_Statement_*.xlsx"))
        have_stk = glob.glob(os.path.join(STAGE, "Stocks_Holdings_Statement_*.xlsx"))
        if not have_mf or not have_stk:
            missing = []
            if not have_stk:
                missing.append("stocks/ETF .xlsx")
            if not have_mf:
                missing.append("mutual funds .xlsx")
            return self._json(400, {"ok": False, "error": "missing upload(s): " + ", ".join(missing)})

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            convert_groww.main([])     # reads initial_stage -> writes portfolio.json (+backup if changed)
        log = buf.getvalue()
        return self._json(200, {"ok": True, "summary": self._summary(),
                                "asOf": (P.load_json(P.LATEST).get("fetchedAt")
                                         if os.path.exists(P.LATEST) else None),
                                "log": log.strip().splitlines()[-3:]})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Portfolio server on http://localhost:{port}/dashboard.html")
    print("  (localhost only · Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
