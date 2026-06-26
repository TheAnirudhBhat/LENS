#!/usr/bin/env python3
"""
news_engine.py — pull free financial news on command.

A small CLI an AI agent can call to fetch relevant market news WITHOUT having to
figure out a source each time. Uses free, key-less RSS feeds (primarily Google
News, which aggregates Economic Times, Moneycontrol, Mint, Reuters, etc.).

Standard library only (urllib + xml). No API keys, no third-party packages.

USAGE
  python3 news_engine.py "Tata Motors"              # news for a query
  python3 news_engine.py "Nifty 50" --limit 8       # more items
  python3 news_engine.py --market                   # general India market news
  python3 news_engine.py --portfolio                # news for each holding in portfolio.json
  python3 news_engine.py --portfolio --out data/_news.json   # write JSON to a file
  python3 news_engine.py --selftest                 # offline parser test (no network)

OUTPUT (JSON to stdout, or --out FILE)
  query mode    -> { "query": "...", "items": [ {title, source, published, link, summary} ] }
  --portfolio   -> { "byHolding": { "<name>": [items...] }, "market": [items...] }

NETWORK NOTE: this fetches from news.google.com when run on your machine. If your
network blocks it, items come back empty and the agent should fall back to its own
web search. Nothing here ever fails loudly.
"""

import os
import sys
import json
import html
import datetime as _dt
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 news_engine"
TIMEOUT = 12


def _feed_url(query, region="IN", lang="en", days=7):
    q = query if not days else f"{query} when:{days}d"
    params = urllib.parse.urlencode({
        "q": q, "hl": f"{lang}-{region}", "gl": region, "ceid": f"{region}:{lang}"
    })
    return "https://news.google.com/rss/search?" + params


def _parse_rss(xml_text, limit):
    """Parse a Google-News-style RSS 2.0 document into a list of dicts."""
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items
    for it in root.iter("item"):
        def t(tag):
            e = it.find(tag)
            return (e.text or "").strip() if e is not None and e.text else ""
        title = html.unescape(t("title"))
        link = t("link")
        pub = t("pubDate")
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None and src_el.text else ""
        desc = html.unescape(t("description"))
        # Google News stuffs HTML into description; strip tags crudely.
        desc = _strip_tags(desc)
        items.append({"title": title, "source": source, "published": pub,
                      "link": link, "summary": desc[:240]})
        if len(items) >= limit:
            break
    return items


def _strip_tags(s):
    out, depth = [], 0
    for ch in s:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return " ".join("".join(out).split())


def fetch(query, limit=6, region="IN", days=7):
    url = _feed_url(query, region=region, days=days)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = r.read().decode("utf-8", "replace")
        return _parse_rss(data, limit)
    except Exception:                            # network blocked / offline / etc.
        return []                                # never fail loudly


def holding_names(portfolio_path):
    try:
        p = json.load(open(portfolio_path, encoding="utf-8"))
    except Exception:
        return []
    names = []
    for h in p.get("equityAndEtf", []):
        names.append(h.get("name"))
    for m in p.get("mutualFunds", []):
        names.append(m.get("scheme"))
    return [n for n in names if n]


# --------------------------------------------------------------------------- #
# selftest (offline) — proves the parser works without any network
# --------------------------------------------------------------------------- #
_SAMPLE = """<?xml version="1.0"?><rss version="2.0"><channel>
<title>Sample</title>
<item><title>Reliance hits record high on retail growth</title>
<link>https://example.com/a</link><guid>1</guid>
<pubDate>Mon, 23 Jun 2026 09:00:00 GMT</pubDate>
<description>&lt;a href="x"&gt;Reliance&lt;/a&gt; gains 3% as analysts upgrade.</description>
<source url="https://economictimes.com">Economic Times</source></item>
<item><title>Nifty 50 closes above 26,000</title>
<link>https://example.com/b</link><guid>2</guid>
<pubDate>Mon, 23 Jun 2026 11:00:00 GMT</pubDate>
<description>Broad rally led by financials.</description>
<source url="https://moneycontrol.com">Moneycontrol</source></item>
</channel></rss>"""


def selftest():
    items = _parse_rss(_SAMPLE, 10)
    assert len(items) == 2, items
    assert items[0]["title"].startswith("Reliance"), items[0]
    assert items[0]["source"] == "Economic Times", items[0]
    assert "<" not in items[0]["summary"], items[0]
    assert items[1]["source"] == "Moneycontrol"
    print("selftest OK — parsed", len(items), "items")
    print(json.dumps(items, indent=2))
    return 0


# --------------------------------------------------------------------------- #
def main(argv):
    flags = [a for a in argv if a.startswith("--")]
    terms = [a for a in argv if not a.startswith("--")]
    limit = 6
    out = None
    for f in flags:
        if f.startswith("--limit="):
            limit = int(f.split("=", 1)[1])
        if f.startswith("--out="):
            out = f.split("=", 1)[1]
    # support spaced forms: "--limit N" and "--out FILE"
    for i, a in enumerate(argv):
        if a == "--limit" and i + 1 < len(argv):
            limit = int(argv[i + 1]); terms = [t for t in terms if t != argv[i + 1]]
        if a == "--out" and i + 1 < len(argv):
            out = argv[i + 1]; terms = [t for t in terms if t != argv[i + 1]]

    if "--selftest" in flags:
        return selftest()

    now = _dt.datetime.now(_dt.timezone.utc).isoformat()

    if "--portfolio" in flags:
        names = holding_names(os.path.join(HERE, "portfolio.json"))
        result = {"generatedAt": now, "byHolding": {}, "market": fetch("Indian stock market Nifty Sensex", limit)}
        for n in names:
            result["byHolding"][n] = fetch(n, max(3, limit // 2))
        _emit(result, out)
        return 0

    if "--market" in flags:
        result = {"generatedAt": now, "query": "Indian stock market",
                  "items": fetch("Indian stock market Nifty Sensex SEBI", limit)}
        _emit(result, out)
        return 0

    if not terms:
        print(__doc__)
        return 1

    query = " ".join(terms)
    result = {"generatedAt": now, "query": query, "items": fetch(query, limit)}
    _emit(result, out)
    return 0


def _emit(obj, out):
    text = json.dumps(obj, indent=2, ensure_ascii=False)
    if out:
        path = out if os.path.isabs(out) else os.path.join(HERE, out)
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        open(path, "w", encoding="utf-8").write(text)
        print(f"Wrote {out}")
    else:
        print(text)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
