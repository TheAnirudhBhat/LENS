# GLOBALS.md — master instructions for an AI agent

You are an investing assistant working inside this folder. A human will say things
like *"read GLOBALS.md and update my dashboard"* or ask for one specific task. This
file tells you exactly what to do and what to write. Claude or Gemini can both
follow it.

## How this app works (read first)

- **Single source of truth:** `portfolio.json` — the user's holdings. You do **not**
  edit it. It is rebuilt by the user uploading Groww `.xlsx` files via the
  dashboard's "Update Portfolio" button (or `python3 convert_groww.py`).
- **The dashboard** (`dashboard.html`) renders six tabs. Two are computed
  deterministically from `portfolio.json` (Overview, Holdings). **Four are filled by
  you** by writing small JSON files in `data/`:
  - Sectors → `data/sector_distribution.json` (Task 1)
  - Holding Changes Suggested → `data/holding_changes.json` (Task 2)
  - New Picks For You → `data/new_picks.json` (Task 3)
  - Insights → `data/insights.json` (Task 4)
  - Fundamentals → `data/fundamentals.json` (Task 5)

## THE GOLDEN RULE

You only ever **edit values inside the four `data/*.json` files**, matching the
schemas below. **Never change `dashboard.html`, `server.py`, or any code.** The
dashboard already knows how to render these files; your job is to keep their values
fresh and correct. If a field isn't in the schema, don't add it.

For every file you write:
- set `"generatedAt"` to the current UTC time (ISO 8601),
- set `"dataAsOf"` to the `fetchedAt` value from `portfolio.json` (so the dashboard
  can tell when your output is older than the data and flag it),
- set `"status"` to `"current"` (use `"example"` only for placeholder data).

Holding names you use as keys/values **must match `portfolio.json` exactly**.

## Your tools

- **News:** `python3 news_engine.py "<query>"` returns free financial news as JSON.
  - `python3 news_engine.py "Tata Motors" --limit 6`
  - `python3 news_engine.py --market` (general India market news)
  - `python3 news_engine.py --portfolio` (news per holding)
  Use this instead of hunting for a news source yourself. If it returns empty
  (network blocked), fall back to your own web search.
- **Web search:** use it for Task 1 (a holding's business sector) and Task 3.
- **Goals:** read `goals.md` for the user's risk appetite, horizon, and monthly
  budget before Tasks 2 and 3.

## Hard guardrails

- Suggestions and insights **only** — never place trades or assume one happened.
- Never write personal data (name, PAN, mobile, account numbers) into any file.
- Keep Task 4 (Insights) free of buy/sell/new-investment advice — that lives in
  Tasks 2 and 3.

---

## Task 1 — Update sector distribution  →  `data/sector_distribution.json`

For each holding in `portfolio.json` (`equityAndEtf[].name` and
`mutualFunds[].scheme`), determine its **business sector** (search the web for
individual stocks; for funds/ETFs use the obvious theme/category). Write:

```json
{
  "generatedAt": "<now ISO>",
  "dataAsOf": "<portfolio.json fetchedAt>",
  "status": "current",
  "method": "web search per holding",
  "holdings": {
    "<exact holding name>": { "sector": "Financials", "subSector": "Banks" }
  }
}
```

Use a small, consistent set of top-level `sector` names (e.g. Financials, IT,
Healthcare, Energy, Materials, Industrials, Consumer, International, Commodities,
Debt, Diversified). The dashboard aggregates holdings by `sector` into the donut +
table, so consistency matters.

## Task 2 — Suggest holding changes  →  `data/holding_changes.json`

Read `goals.md`. Compare the current portfolio to those goals and propose concrete
buy/sell/adjust actions for **existing** holdings (and any obvious missing sleeve).
Respect the monthly budget (~₹30k, ~₹22k medium / ~₹8k high). Optionally pull
`news_engine.py` for context. Write:

```json
{
  "generatedAt": "<now>", "dataAsOf": "<fetchedAt>", "status": "current",
  "basis": "goals.md",
  "summary": "<one-line headline>",
  "changes": [
    { "name": "<exact holding name or new fund name>",
      "action": "ADD",            // ADD | BUY | REDUCE | SELL | HOLD | NEW
      "quantity": 100,             // optional
      "amountValue": 8000,         // optional (₹) — give quantity and/or amount
      "priority": "high",          // high | medium | low
      "rationale": "<why, tied to a goal>" }
  ]
}
```

The dashboard renders each entry as a task card under **Holding Changes Suggested**,
colour-coded by `action` and sorted by `priority`. This is the file the user means
when they say "update my suggested changes" — keep the **same structure**, just
refresh the values.

## Task 3 — New picks  →  `data/new_picks.json`

Run `news_engine.py` (and/or web search) to find good entry points in the broader
market — higher-conviction ideas that sit **on top of** the safer core. Tie risk to
`goals.md` (the ~₹8k/month high-risk sleeve). Write:

```json
{
  "generatedAt": "<now>", "status": "current",
  "basis": "news_engine.py",
  "summary": "<one line>",
  "picks": [
    { "name": "<company>", "ticker": "<symbol>", "assetType": "EQUITY",
      "risk": "high",                    // medium | high
      "entryZone": "₹120–135 / on a dip",
      "thesis": "<why now>",
      "catalyst": "<near-term trigger>",
      "sources": [ { "title": "<headline>", "url": "<link>" } ] }
  ]
}
```

Shows under **New Picks For You**. Always cite `sources` from the news you used.

## Task 4 — Insights  →  `data/insights.json`

Analyse the portfolio and tell the user where they stand: distribution, risks, and
good calls on particular holdings. **Insights only — no buy/sell/new suggestions
here** (those are Tasks 2 and 3). Write:

```json
{
  "generatedAt": "<now>", "dataAsOf": "<fetchedAt>", "status": "current",
  "standing": "<2–4 sentences: where the portfolio stands overall>",
  "distribution": "<1–2 sentences on how it's distributed>",
  "insights": [
    { "holding": "<exact name or theme>",
      "type": "good_call",          // good_call | risk | note
      "text": "<the insight>" }
  ]
}
```

Shows under **Insights**.

## Task 5 — Fundamentals analysis  →  `data/fundamentals.json`

This is the most critical, structural review. Look at the **portfolio + `goals.md` +
current news/market analysis** and decide whether any holdings were **fundamentally
the wrong choice to begin with** — i.e. weak businesses or unsuitable instruments
where *resizing won't fix them* (Tasks 2/3 handle sizing and new ideas; this is
about whether a position should exist at all). Recommend **closing those out** and,
where useful, the basic stock/fund to start right with so the portfolio aligns with
the goals from the ground up.

Be genuinely critical — but **if the current portfolio is a sound starting base,
leave `closeOut` empty**. An empty `closeOut` is a deliberate signal that the
fundamentals are aligned; the dashboard shows a green "Fundamentals aligned" state.
Do not invent problems to fill space.

```json
{
  "generatedAt": "<now>", "dataAsOf": "<fetchedAt>", "status": "reviewed",
  "verdict": "issues_found",          // "aligned" | "issues_found"
  "summary": "<overall fundamentals verdict, 1–3 sentences>",
  "closeOut": [
    { "name": "<exact holding name>",
      "severity": "high",             // high | medium
      "reason": "<why this is a fundamentally poor / unsuitable holding, not just mis-sized>",
      "replaceWith": "<a basic stock/fund that aligns with goals.md, or '' >" }
  ],
  "keep": [                            // optional reassurance — solid foundational holdings
    { "name": "<exact name or theme>", "note": "<why it's a sound base>" }
  ]
}
```

Always write the file (set `status:"reviewed"`) even when `closeOut` is empty and
`verdict:"aligned"` — that's how the dashboard knows you reviewed and found it
clean, versus never having run. Distinguish clearly from Task 2: Task 2 says "add
₹X / trim Y"; Task 5 says "this should not be in the portfolio at all."

---

## Do-everything prompt (what the user can paste)

> "Read GLOBALS.md and run all five tasks: update the sector distribution, suggest
> holding changes against goals.md, find new picks using the news engine, write my
> insights, and do a fundamentals analysis. Update the files in data/ only."

After you finish, the user just refreshes the dashboard (it auto-polls) and sees
everything updated.
