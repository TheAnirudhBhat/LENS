# Research Stack v2: MF X-Ray, US Smart-Money, Strategy Backtest — into LENS

> Status: PROPOSED (user review pending). Execution will be subagent-driven per workstream once approved.

**Goal:** Upgrade the investing system on four fronts — (1) know what the mutual funds actually own and optimize the MF book, (2) master CapitolTrades + a fuller US research stack, (3) rethink/backtest the base strategy rules, (4) build all of it into LENS as data-driven panels — without violating the LENS public-repo privacy model (all personal data stays in MEMORY_DIR).

**Context:** 12 MF schemes ₹6.88L (5 are ELSS; two large laggards are SBI funds), US book ₹4.34L/7 names, IN book ₹6.91L/10 names + 4 bonds. LENS logic audit (2026-06-10) found 4 criticals (silo totals, FX fallback=1, bond P&L=0, untagged-role drops) + missing variables (XIRR, tax lots, benchmarks, FX-at-cost) that block honest backtesting. Research methodology now codified as Theme → Screen → Judgment (memory: strategy_research_stack).

---

## W0 — Audit-critical fixes (prerequisite, ~1 session)

Backtests and MF optimization are meaningless on wrong denominators. Fix first, in LENS code:

- [ ] C3 FX fallback `?? 1` → fail-loud + last-known-rate file (`lib/allocation.ts:162`)
- [ ] Arbitrage MF reclass → `debt-equiv` by scheme category (audit improvement #6; KOTAKARB currently inflates equity drift — the exact number driving deploy calls)
- [ ] C1/C2 totals semantics: rename `totalValue` → `inBookValue`, add explicit `portfolioValue`; decide concentration denominator (RECOMMEND: caps vs whole portfolio, not per-silo — surface both in UI)
- [ ] I3 `nifty: null` in history upserts → write Nifty close each sync (benchmark prerequisite)
- [ ] C4 bond fields: `couponRate`, `maturityDate`, `investedINR` backfill from Console (user supplies cost basis; `m-bonds-cost-basis` parked item)
- [ ] I2 untagged holdings → `unclassified` bucket counted in totals + UI badge

## W1 — MF X-Ray + optimization (~2 sessions)

**Data (new `MEMORY_DIR/mf_xray.json`):**
- [ ] Scrape per-scheme portfolio disclosures for all 12 schemes via Playwright (ValueResearch fund pages primary; Moneycontrol fallback): top-25 holdings, sector weights, mcap split, cash %, TER, turnover, manager tenure, AUM
- [ ] Normalize to schema: `{scheme, asOf, ter, aum, topHoldings[{name,ticker?,weightPct}], sectors[{name,pct}], mcapSplit, cashPct}`

**Analyses (the judgments):**
- [ ] **Overlap matrix**: scheme↔scheme overlap % (5 ELSS likely near-duplicates) + scheme↔direct-IN-book overlap (true single-stock exposure: e.g., if PPFCAP + MIRAEELSS both hold RELIANCE/HDFCBANK, my real concentration ≠ what the IN tab shows)
- [ ] **True-exposure rollup**: effective sector + single-stock exposure across MF + direct combined → feeds concentration caps
- [ ] **Performance audit**: XIRR (INDmoney) vs category benchmark per scheme; flag laggards (initial suspects: SBILARGECAP ₹1.3L at 0.44% XIRR, SBIELSS ₹1.05L at 0.18% XIRR — together ₹2.35L of dead money vs MIRAEELSS 11.25%)
- [ ] **Consolidation plan**: keep/merge/exit per scheme with tax-aware sequencing (ELSS lock expiries, LTCG ₹1.25L exemption budget/yr, exit-load windows). Target: 12 → ~6-7 schemes aligned to roles (flexi-cap core, midcap, small-cap, healthcare thematic, arbitrage/debt, US FoF per c-mf-motilal-nasdaq)
- [ ] Encode the result as tasks/parked triggers (e.g., "switch SBILARGECAP → PPFCAP tranche-wise within exemption")

**LENS:** MF tab gets an **X-Ray card**: overlap heatmap, true-exposure top-10, laggard flags. Route `/api/mf/xray` reads the json; empty-state if file absent (public-repo safe).

## W2 — US smart-money stack: CapitolTrades + complements (~1-2 sessions)

- [ ] **Map CapitolTrades fully** (capitoltrades.com): enumerate filters (politician, issuer, party, chamber, committee, state, tx type, size buckets, traded/published date ranges), URL params for scripted pulls, issuer pages (`/issuers/<id>`), politician pages (portfolio, sectors, performance), pagination. Document in the stock-screener skill as `references/capitoltrades.md`
- [ ] **Signal rules**: cluster detection (≥3 politicians same direction/30d on a ticker), size-weighted (>50K lots), committee-relevance boost, options-activity flag. Single-politician batches = noise (validated 6/10: page-1 was one member's batch)
- [ ] **Complementary sources** (evaluate, pick 2): QuiverQuant (congress+insider+lobbying aggregate), OpenInsider (SEC Form 4 insider cluster-buys — free, scriptable), Dataroma/WhaleWisdom (13F superinvestor moves, quarterly), FinViz (US screener = Screener.in analogue for the US side)
- [ ] **Cache** `MEMORY_DIR/smart_money.json`: per held/watchlist US ticker — recent congressional + insider activity, cluster score
- [ ] **Wire into /portfolio-check**: US block of `full` mode runs the sweep; Pass A can NEWS-FIRE on a cluster hit
- [ ] **LENS:** US tab **Smart Money panel** (per-holding congressional/insider activity timeline + cluster badges) via `/api/smartmoney`

## W3 — Strategy rethink + backtest (~2-3 sessions, after W0)

**Re-exam the base fundamentals (answer "are they doing us well?"):**
- [ ] SAA 80/15/5: stress against goals (₹50Cr glide), age, income trajectory; compare vs 75/20/5 and 85/10/5 outcomes
- [ ] Role taxonomy: do the 7 buckets + bands match how the book actually behaves (correlation clusters)? ACUTAAS+NETWEB = 24% "growth pair" risk noted 6/10
- [ ] Regime gate: static 23,000/24,200 vs dynamic (Nifty 200DMA ± band, VIX percentile). Backtest both on 5yr Nifty history
- [ ] Concentration caps: per-silo vs whole-portfolio (W0 decision) + MF-overlap-adjusted (W1 data)

**Backtest harness (`scripts/backtest/` in LENS, results to `backtest_results.json`):**
- [ ] Ingest `decisions.json` (d1→d25) + Yahoo daily history → score every closed decision vs counterfactual (hold / index): NKE harvest, BOTZ exit, RIVN trims, GOLDCASE/SILVERCASE trims, HDFCDY exit, SBILARGECAP switch
- [ ] Rule-level scorecards: stops (did ₹300-style hard cuts save money?), green-day execution triggers (vs immediate), regime-gated deploys (vs DCA-now), kill rules
- [ ] Benchmark alpha per silo: IN vs Nifty 500, US vs S&P 500 (INR), MF vs category index; portfolio TWR → annualized CAGR
- [ ] XIRR per holding/silo (backfill purchase dates from decisions + Kite tradebook export + INDmoney)
- [ ] Output: **Strategy Scorecard** — keep/amend/kill per rule, written back into `strategy.md` (the ?-panel renders it) + quarterly re-run hooked into /portfolio-check Phase 6

**LENS:** new **Strategy Lab** view: scorecard table, decision-outcome chart, alpha-vs-benchmark strips, rule amendments log.

## W4 — LENS build + privacy hold (continuous, finishes last)

- [ ] All new data = external files in MEMORY_DIR (mf_xray, smart_money, backtest_results, strategy_scorecard); LENS code stays generic + empty-state-safe → public-release model intact (R6-R8 scrub plan unaffected, still pending)
- [ ] Routes: `/api/mf/xray`, `/api/smartmoney`, extend `/api/backtest`
- [ ] UI: MF X-Ray card, Smart Money panel, Strategy Lab tab, Research Pipeline view (theme → screen hits → watchlist triggers, reading parked_ideas)
- [ ] Each workstream lands as its own reviewed branch (subagent-driven, spec+quality review per task — same machinery as the data-layer build)

---

## Sequencing + effort

| Order | Workstream | Sessions | Unblocks |
|---|---|---|---|
| 1 | W0 audit fixes | 1 | honest numbers for everything below |
| 2 | W1 MF X-ray | 2 | ₹2.35L laggard decision, consolidation, true concentration |
| 3 | W2 US smart-money | 1-2 | US entries (AMZN leg, ABT question) with signal |
| 4 | W3 backtest + rethink | 2-3 | rule amendments, regime-gate v2 |
| 5 | W4 UI (rolling) | 1-2 | everything visible in LENS |

**Quick wins available before any build:** (a) SBI laggards review (₹2.35L at ~0% XIRR) can start from existing XIRR data; (b) arbitrage reclass is a 1-file fix that corrects the drift number behind the ₹60K plan; (c) CapitolTrades filter mapping is one browsing session.

## Open questions for the user
1. Concentration caps: whole-portfolio or per-silo denominators?
2. MF consolidation appetite: OK targeting 12 → ~6-7 schemes (tax-sequenced), or prefer minimal churn?
3. Backtest depth: decisions-only (fast) or also rule-simulations on 5yr history (slower, more compute)?
4. US complement: prefer free/scriptable (OpenInsider + Dataroma) or include paid-ish aggregators (QuiverQuant)?
