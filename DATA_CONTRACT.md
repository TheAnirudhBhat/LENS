# LENS Data Contract — the AI-harness rules

Binding for ANY agent (or human) that writes portfolio state or dashboard code.
Every rule below exists because its violation caused a real bug; the incident is
cited so the rule survives skepticism. `/portfolio-check` enforces the gates.

## The one-sentence version

**One calculator, one enrichment pass, one writer per file, canonical keys only,
and every write is verified through the API route it feeds — a sync isn't done
until `/api/qa` returns `ok: true`.**

## 1. One calculator

- `lib/valuation.ts` `buildBook()` is THE source of every money figure
  (net worth, per-class values, role drift, P&L). Surfaces project it; they
  never re-derive.
- `lib/book/builder.ts` is a file-mtime provenance stub for the refresh icon.
  It is NOT a valuation builder. *(2026-08-05: it was rewritten into a second
  "buildBook" that disagreed with the first; Overview, strip, and score all
  showed different totals.)*
- Adding any new "total" to the UI? It must come from `/api/valuation` or a
  field computed inside `lib/valuation.ts`. A new parallel calculation is a
  contract violation even if it's correct today.

## 2. One enrichment pass

- Live overlays (Kite LTPs, mfapi NAVs, US quotes) happen in `lib/enrich.ts`
  ONLY. *(2026-08-05: three copies of MF NAV enrichment existed — lib/enrich,
  a stale copy in the mutualfunds route, and a fresh extraction — so values
  depended on which route you asked.)*
- Anything needing live values calls `enrichSilos()` / the exported per-silo
  enrichers. Never re-implement, never fetch mfapi/Kite directly from a route.

## 3. One writer per file

| File | Writer | Everything else |
|---|---|---|
| `latest_snapshot.json` | /portfolio-check Phase 2 (+ dashboard /api/sync LTP refresh) | read-only |
| `us_stocks.json` | /portfolio-check Phase 2 | read-only |
| `project_mutual_funds.md` | /portfolio-check Phase 2 | read-only |
| `bonds.json` | statement ingestion + coupon confirms (`scripts/coupons.py --confirm`) | read-only |
| `tasks.json` | /portfolio-check sweeps + explicit user asks | read-only |
| `decisions.json` | Phase 3 append; enrich-in-place only | never delete rows |
| `portfolio_history.json` | Phase 3 upsert (today's row only) | read-only |
| `signal_history.json` | `scripts/signals.py` | read-only |
| `coupon_ledger.json` | `scripts/coupons.py` | read-only |

## 4. Canonical keys only — never fork a field

- Update the key the UI reads; never add a sibling key with a qualifier.
  *(2026-08-05: interest totals were "updated" as `interestEarnedGrossFY2627INR`
  while the tab rendered `interestEarnedGrossINR` — stale numbers on screen
  with fresh data in the file.)*
- New field needed? Add it to the Zod schema and the TS type in the same
  change. Zod strips unknown keys silently. *(2026-08-05: `scoreImpact` was
  written to tasks.json and silently dropped by `/api/tasks` until
  `TaskSchema` learned it.)*

## 5. Whole-record writebacks

- A writeback updates the DATA and the summary that describes it, atomically.
  *(2026-08-05: the MF table's description line said "refreshed 2026-08-05"
  while the rows still held Aug-2 values — net worth silently ~₹39K low. This
  incident is why `/api/qa` exists.)*
- For markdown state (project_mutual_funds.md): regenerate the table, don't
  patch prose around it.

## 6. Verify through the route, not the file

- After writing a state file, `curl` the API route that serves it and check
  the number that changed. A clean `python3 -m json.tool` proves nothing —
  schema rejection can blank an entire tab while the file parses fine.
- The final gate of every sync: **`curl -s localhost:3002/api/qa` → `ok: true`**.
  Issues listed there are the sync's remaining work, not warnings.

## 7. Valuation conventions (do not "fix" these)

- Listed instruments → live market value.
- Private SDI bonds → **cost + accrued interest** (no market quote exists).
  Coupons already credited to the bank are income (`interestEarned*`), never
  position value. Stable Money's app adds them back — that is why its headline
  reads ~₹7K higher than LENS. Both are internally consistent; matching one to
  the other double-counts.
- `redeeming` bonds (units extinguished pre-maturity, principal owed) are
  carried at the receivable until the payout lands. *(Indel Aug'26: dropping
  it understated net worth by ₹10K for two weeks.)*
- Two demats exist: Kite (1208…) and Stable Bonds (1210…9218). Kite CANNOT see
  the second one — bonds.json is its only mirror, refreshed from uploaded
  statements. `transferred` rows in bonds.json are provenance, already valued
  in the snapshot; never count them twice.

## 8. Fresh capital vs reshuffle

- `portfolio_history.json[].cashInjection` is the ONLY input to the deploy-floor
  score dimension. Log fresh external money there on the day it deploys; a
  reshuffle (buy funded by a same-window sell/redemption) is NOT fresh capital.
- US amounts convert at `us_stocks.json.fx.usdInr` before entering the ₹ ledger.

## 9. No new state files without wiring

A new `*.json` in MEMORY_DIR must arrive in the same change as: its writer
listed in §3, its consumer route, its `/api/qa` coverage if it carries money,
and a line in the /portfolio-check file table. Otherwise it will be exactly as
trustworthy as the June "₹40K parked in KOTAKARB" that never existed.

## 10. Known non-goals

- TSM + PFE prices never refresh (Tickertape holdings, outside INDmoney's
  feed) — their momentum reads "unknown", not "flat".
- Kite Historical API is a paid add-on and not enabled: `signal_history.json`
  builds forward from 2026-08-02 only; no backfill exists.
