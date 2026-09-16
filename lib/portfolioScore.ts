/**
 * Portfolio health score — a single pure, deterministic function of an
 * already-assembled book. No I/O lives here: the API route (app/api/score)
 * reads the data files, normalizes them into a `ScoreInput`, and calls
 * `computePortfolioScore`. Keeping the maths pure makes it unit-testable and
 * means LENS can ship public — nothing here references a personal ticker,
 * scheme name, or amount. Every number is derived from the input at runtime.
 *
 * Doctrine grounding: the user's rulebook — `strategy.md` (prose) + `rules.json`
 * (numbers) in the data dir, loaded server-side by lib/rules.ts and passed in as
 * `input.rules` (DEFAULT_RULES when absent). Nothing numeric is hardcoded here.
 *   - rule 2  SAA equity / debt / gold with bands; only arbitrage/liquid = ballast
 *   - rule 3  single stock ≤ singleStockPct of TOTAL book; named clusters ≤ clusterPct
 *   - rule 4  ≤ names.max direct stocks; <1% positions flagged (warnings)
 *   - rule 5  every direct stock carries an exitIf (warnings)
 *   - rule 7  ≤ loserCheck.drawdownPct with no exitIf stamp → re-underwrite (warnings)
 *   - rule 9  ≤ mf.maxEquitySchemes equity schemes (warnings)
 *   - rule 1  monthly fresh-deploy floor
 */

import { DEFAULT_RULES, type Rules } from "@/lib/rulesSchema";

// ─────────────────────────────────────────────────────────────────────────────
// Public types — the exact /api/score contract.
// ─────────────────────────────────────────────────────────────────────────────

export type DimensionKey =
  | "allocation"
  | "concentration"
  | "cost"
  | "capital"
  | "liquidity"
  | "deploy";

export type ScoreStatus = "good" | "warn" | "bad";

export type Grade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D";

export type ScoreDimension = {
  key: DimensionKey;
  label: string;
  score: number; // 0-100 integer
  weight: number; // fraction, all weights sum to 1.0
  detail: string; // one plain-English line with the live numbers driving it
  status: ScoreStatus;
};

export type ScoreLever = {
  id: string;
  action: string; // imperative, verb-first, with the ₹/level
  scoreGain: number; // estimated composite points if done
  why: string; // one line
  ticker: string | null;
};

export type ScoreResult = {
  asOf: string; // ISO string
  composite: number | null; // 0-100 integer, null on empty/missing data
  grade: Grade | null;
  dimensions: ScoreDimension[];
  levers: ScoreLever[];
  note: string | null;
  /** Rule breaches (rules 4/5/7/9) — surfaced, not scored. */
  warnings: string[];
  rulesVersion: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Input — a normalized book. The route builds this; the lib never reads disk.
// ─────────────────────────────────────────────────────────────────────────────

/** A single position, flattened across silos into one shape. */
export type ScorePosition = {
  ticker: string;
  name?: string;
  market: "IN" | "US" | "MF" | "BONDS" | "CASH";
  /** Strategic role tag (compounders/growth/cyclicals/...) when present. */
  role?: string;
  /** Sector text when present (used to detect the AI-infra cluster). */
  sector?: string;
  valueINR: number;
  /** P&L percent for the position when known. */
  pnlPct?: number;
  /** Weight of this position within its own silo (US book / IN book). */
  weightPctOfBucket?: number;
  /** Flagged as a "building"/"core" position — exempt from dead-money. */
  building?: boolean;
  /** Internal-rate-of-return when known; ~0 over a long hold = dead money. */
  xirr?: number;
  /** Months held when known — used by the dead-money "held >6mo" test. */
  monthsHeld?: number;
  /** Rule 5: written sell condition + the date it was written / re-underwritten. */
  exitIf?: string;
  exitIfAt?: string;
};

/** A mutual-fund scheme — cost + liquidity inputs read its category/TER. */
export type ScoreMFScheme = {
  ticker: string;
  scheme?: string;
  category: string;
  valueINR: number;
  /** Total expense ratio as a percent (e.g. 0.66). */
  ter?: number;
};

export type ScoreBuckets = {
  inEquity: number;
  usEquity: number;
  mf: number; // equity MF value (debt-equiv MF excluded — see liquidity)
  bonds: number;
  metals: number;
  cash: number;
};

export type ScoreInput = {
  asOf: string;
  total: number;
  buckets: ScoreBuckets;
  positions: ScorePosition[];
  mfSchemes: ScoreMFScheme[];
  /** Worst MF overlap pair percent (max over mf_xray.overlapPairs). */
  worstOverlapPct: number;
  /** Sum of cashInjection over the trailing 30 days (>0 only). */
  freshDeployed30d: number;
  /** Live rulebook numbers (server loads rules.json); DEFAULT_RULES when absent. */
  rules?: Rules;
};

// ─────────────────────────────────────────────────────────────────────────────
// Doctrine constants.
// ─────────────────────────────────────────────────────────────────────────────

// Doctrine numbers come from `input.rules` (rules.json) — see computePortfolioScore.

const DIM_WEIGHTS: Record<DimensionKey, number> = {
  allocation: 0.2,
  concentration: 0.2,
  cost: 0.15,
  capital: 0.15,
  liquidity: 0.15,
  deploy: 0.15,
};

// Cash-equivalent / true-ballast MF categories (R2). SDI/NCD bonds are NOT here.
// Exported so the API route routes the same ballast MF into the debt bucket
// (single source of truth — the two copies must never drift).
export const BALLAST_RE = /arbitrage|liquid|overnight|money\s*market/i;

// Cluster membership is an explicit ticker list in rules.json (rule 3), not a regex.

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers.
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function inr(n: number): string {
  // Compact ₹ formatting (₹1.2L / ₹3.4Cr) for lever/detail copy.
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${Math.round(n / 1e3)}K`;
  return `₹${Math.round(n)}`;
}

function pct(n: number, dp = 1): string {
  return `${n.toFixed(dp)}%`;
}

function allocBandPenalty(driftpp: number): number {
  const d = Math.abs(driftpp);
  if (d <= 3) return 0;
  if (d <= 5) return 10;
  if (d <= 7) return 22;
  if (d <= 10) return 38;
  return 55;
}

function overlapPenalty(p: number): number {
  if (p <= 20) return 0;
  if (p <= 35) return 10;
  if (p <= 50) return 22;
  return 35;
}

function terPenalty(weightedTer: number): number {
  if (weightedTer <= 0.6) return 0;
  if (weightedTer <= 1.0) return 8;
  return 18;
}

function gradeFor(composite: number): Grade {
  if (composite >= 85) return "A+";
  if (composite >= 80) return "A";
  if (composite >= 72) return "B+";
  if (composite >= 64) return "B";
  if (composite >= 56) return "C+";
  if (composite >= 48) return "C";
  return "D";
}


// ─────────────────────────────────────────────────────────────────────────────
// The pure scorer.
// ─────────────────────────────────────────────────────────────────────────────

export function computePortfolioScore(input: ScoreInput): ScoreResult {
  const { asOf, total } = input;
  const rules = input.rules ?? DEFAULT_RULES;
  const SAA = { equity: rules.saa.equity[0], debt: rules.saa.debt[0], gold: rules.saa.gold[0] };
  const CAP_SINGLE = rules.size.singleStockPct; // rule 3, % of TOTAL book
  const CAP_CLUSTER = rules.size.clusterPct; // rule 3, % of TOTAL book
  const DEPLOY_FLOOR = rules.deploy.floorINR; // rule 1

  // Graceful empty state — no book, no score. The card renders an empty state.
  if (!total || total <= 0) {
    return {
      asOf: asOf || new Date().toISOString(),
      composite: null,
      grade: null,
      dimensions: [],
      levers: [],
      note: "No portfolio data available yet.",
      warnings: [],
      rulesVersion: rules.version,
    };
  }

  const b = input.buckets;
  const equityValue = b.inEquity + b.usEquity + b.mf;
  const equityPct = (equityValue / total) * 100;
  const debtPct = (b.bonds / total) * 100;
  const goldPct = (b.metals / total) * 100;

  // ── 1. allocation (0.20) ───────────────────────────────────────────────────
  const allocDrift = {
    equity: equityPct - SAA.equity,
    debt: debtPct - SAA.debt,
    gold: goldPct - SAA.gold,
  };
  const allocPenalties = [
    allocBandPenalty(allocDrift.equity),
    allocBandPenalty(allocDrift.debt),
    allocBandPenalty(allocDrift.gold),
  ];
  const allocScore = Math.round(
    100 - allocPenalties.reduce((s, p) => s + p, 0) / allocPenalties.length,
  );
  const maxAllocDrift = Math.max(
    Math.abs(allocDrift.equity),
    Math.abs(allocDrift.debt),
    Math.abs(allocDrift.gold),
  );
  const allocStatus: ScoreStatus =
    maxAllocDrift > 7 ? "bad" : maxAllocDrift > 3 ? "warn" : "good";
  const allocation: ScoreDimension = {
    key: "allocation",
    label: "Allocation drift",
    score: clamp(allocScore),
    weight: DIM_WEIGHTS.allocation,
    detail: `Equity ${pct(equityPct)} vs ${SAA.equity}, debt ${pct(debtPct)} vs ${SAA.debt}, gold ${pct(
      goldPct,
    )} vs ${SAA.gold}. Worst drift ${pct(maxAllocDrift)}pp.`,
    status: allocStatus,
  };

  // ── 2. concentration (0.20) ─────────────────────────────────────────────────
  // Rule 3: every direct stock (IN + US, not hedges) is measured against the
  // TOTAL book; the named clusters (explicit ticker lists) against total too.
  const directStocks = input.positions.filter(
    (p) => (p.market === "IN" || p.market === "US") && p.role !== "hedges",
  );
  type Breach = { pp: number; ticker: string; cap: number; label: string };
  const breaches: Breach[] = [];
  let nearCap = false;
  let topStock: ScorePosition | null = null;
  for (const p of directStocks) {
    const w = (p.valueINR / total) * 100;
    if (!topStock || p.valueINR > topStock.valueINR) topStock = p;
    if (w >= CAP_SINGLE) {
      breaches.push({ pp: w - CAP_SINGLE, ticker: p.ticker, cap: CAP_SINGLE, label: `${p.ticker} ${pct(w)} of book` });
    } else if (w >= CAP_SINGLE - 1) nearCap = true;
  }
  const clusterTickers = new Set(
    Object.values(rules.size.clusters).flat().map((t) => t.toUpperCase()),
  );
  const clusterValue = directStocks
    .filter((p) => clusterTickers.has(p.ticker.toUpperCase()))
    .reduce((s, p) => s + p.valueINR, 0);
  const clusterPct = (clusterValue / total) * 100;
  if (clusterPct >= CAP_CLUSTER) {
    breaches.push({ pp: clusterPct - CAP_CLUSTER, ticker: "", cap: CAP_CLUSTER, label: `AI-infra cluster ${pct(clusterPct)} of book` });
  } else if (clusterPct >= CAP_CLUSTER - 2) nearCap = true;

  // Total-book percentage points are ~3x smaller than the old silo points,
  // so the per-breach slope is steeper (10/pp, capped at 40 per breach).
  const concPenalty = Math.min(
    100,
    breaches.reduce((s, br) => s + Math.min(40, br.pp * 10), 0),
  );
  const concStatus: ScoreStatus =
    breaches.length > 0 ? "bad" : nearCap ? "warn" : "good";
  const concDetail =
    breaches.length > 0
      ? `Over cap: ${breaches.map((br) => br.label).join("; ")}.`
      : `Top stock ${topStock ? pct((topStock.valueINR / total) * 100) : "—"} of book (<${CAP_SINGLE}), cluster ${pct(clusterPct)} (<${CAP_CLUSTER}).`;
  const concentration: ScoreDimension = {
    key: "concentration",
    label: "Concentration",
    score: clamp(Math.round(100 - concPenalty)),
    weight: DIM_WEIGHTS.concentration,
    detail: concDetail,
    status: concStatus,
  };

  // ── 3. cost (0.15) ───────────────────────────────────────────────────────────
  const mfValueForTer = input.mfSchemes.reduce((s, m) => s + (m.valueINR || 0), 0);
  const weightedTer =
    mfValueForTer > 0
      ? input.mfSchemes.reduce(
          (s, m) => s + (m.ter ?? 0) * (m.valueINR || 0),
          0,
        ) / mfValueForTer
      : 0;
  const costPenalty = overlapPenalty(input.worstOverlapPct) + terPenalty(weightedTer);
  const costStatus: ScoreStatus =
    input.worstOverlapPct > 50 || weightedTer > 1.0
      ? "bad"
      : input.worstOverlapPct > 35 || weightedTer > 0.6
        ? "warn"
        : "good";
  const cost: ScoreDimension = {
    key: "cost",
    label: "Cost & overlap",
    score: clamp(Math.round(100 - costPenalty)),
    weight: DIM_WEIGHTS.cost,
    detail: `Value-weighted TER ${weightedTer.toFixed(2)}%, worst MF overlap ${pct(
      input.worstOverlapPct,
    )}.`,
    status: costStatus,
  };

  // ── 4. capital efficiency (0.15) ─────────────────────────────────────────────
  // Dead money: tiny positions (<0.5% of book) that aren't building/core, PLUS
  // long-held positions going nowhere (|pnlPct|<2% held >6mo, or XIRR≈0).
  const halfPct = total * 0.005;
  let deadValue = 0;
  const deadTickers: string[] = [];
  for (const p of input.positions) {
    if (p.market === "CASH") continue;
    const tiny =
      p.valueINR < halfPct && !p.building && !isCoreRole(p.role) && p.valueINR > 0;
    const stalledByPnl =
      p.pnlPct !== undefined &&
      Math.abs(p.pnlPct) < 2 &&
      (p.monthsHeld ?? 0) > 6;
    const stalledByXirr = p.xirr !== undefined && Math.abs(p.xirr) < 1;
    if (tiny || stalledByPnl || stalledByXirr) {
      deadValue += p.valueINR;
      deadTickers.push(p.ticker);
    }
  }
  const deadMoneyPct = (deadValue / total) * 100;
  const capitalScore = Math.round(100 - Math.min(60, deadMoneyPct * 12));
  const capitalStatus: ScoreStatus = deadMoneyPct > 8 ? "bad" : deadMoneyPct > 4 ? "warn" : "good";
  const capital: ScoreDimension = {
    key: "capital",
    label: "Capital efficiency",
    score: clamp(capitalScore),
    weight: DIM_WEIGHTS.capital,
    detail:
      deadTickers.length > 0
        ? `${pct(deadMoneyPct)} in ${deadTickers.length} low-contribution positions (${inr(deadValue)}).`
        : "No material dead money. Capital is working.",
    status: capitalStatus,
  };

  // ── 5. liquidity / true ballast (0.15) ───────────────────────────────────────
  // Only arbitrage/liquid/overnight/money-market funds count (R2). SDI/NCD
  // bonds are correlated NBFC credit and are explicitly excluded.
  const ballastValue = input.mfSchemes
    .filter((m) => BALLAST_RE.test(`${m.scheme ?? ""} ${m.category}`))
    .reduce((s, m) => s + (m.valueINR || 0), 0);
  const trueBallastPct = (ballastValue / total) * 100;
  const liquidityScore = Math.round(clamp((trueBallastPct / SAA.debt) * 100));
  const liquidityStatus: ScoreStatus = trueBallastPct < 5 ? "bad" : trueBallastPct < 8 ? "warn" : "good";
  const liquidity: ScoreDimension = {
    key: "liquidity",
    label: "Liquid ballast",
    score: clamp(liquidityScore),
    weight: DIM_WEIGHTS.liquidity,
    detail: `True ballast (arbitrage + liquid) ${pct(trueBallastPct)} vs ${SAA.debt} target. SDI bonds excluded.`,
    status: liquidityStatus,
  };

  // ── 6. deploy cadence (0.15) ──────────────────────────────────────────────────
  const fresh = Math.max(0, input.freshDeployed30d);
  const deployScore = Math.round(clamp((fresh / DEPLOY_FLOOR) * 100));
  const deployStatus: ScoreStatus = fresh === 0 ? "bad" : fresh < DEPLOY_FLOOR ? "warn" : "good";
  const deploy: ScoreDimension = {
    key: "deploy",
    label: "Deploy cadence",
    score: clamp(deployScore),
    weight: DIM_WEIGHTS.deploy,
    detail: `${inr(fresh)} fresh capital deployed in last 30d vs ${inr(DEPLOY_FLOOR)} floor.`,
    status: deployStatus,
  };

  const dimensions: ScoreDimension[] = [
    allocation,
    concentration,
    cost,
    capital,
    liquidity,
    deploy,
  ];

  const composite = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0),
  );

  // ── Levers — top 3 by estimated composite gain from the weakest dims ──────────
  const candidates: ScoreLever[] = [];

  // Liquidity: deploy the gap into a ballast fund (arbitrage/liquid).
  if (trueBallastPct < SAA.debt) {
    const gapPp = SAA.debt - trueBallastPct;
    const gapRupees = (gapPp / 100) * total;
    const ballastTicker =
      input.mfSchemes.find((m) => BALLAST_RE.test(`${m.scheme ?? ""} ${m.category}`))?.ticker ?? null;
    const projected = liquidity.score === 100 ? 100 : Math.round(clamp(((trueBallastPct + Math.min(gapPp, 5)) / SAA.debt) * 100));
    candidates.push({
      id: "lift-ballast",
      action: `Deploy ${inr(gapRupees)} into ${ballastTicker ?? "an arbitrage/liquid fund"} to reach the ${SAA.debt}% ballast target`,
      scoreGain: dimGain(liquidity, projected),
      why: `True ballast is ${pct(trueBallastPct)} vs the ${SAA.debt}% debt target; SDI bonds don't count.`,
      ticker: ballastTicker,
    });
  }

  // Concentration: trim the worst over-cap breach.
  if (breaches.length > 0) {
    const worst = breaches.slice().sort((a, b) => b.pp - a.pp)[0];
    const trimRupees = (worst.pp / 100) * total; // rule 3 caps are % of TOTAL book
    const remainingAfter = breaches.filter((x) => x !== worst);
    const projPenalty = Math.min(100, remainingAfter.reduce((s, br) => s + Math.min(40, br.pp * 4), 0));
    candidates.push({
      id: "trim-concentration",
      action: `Trim ${inr(trimRupees)} of ${worst.ticker || "the AI-infra cluster"} to get back under the ${worst.cap}% cap`,
      scoreGain: dimGain(concentration, clamp(Math.round(100 - projPenalty))),
      why: worst.label + " breaches the doctrine cap.",
      ticker: worst.ticker || null,
    });
  }

  // Capital: consolidate dead positions.
  if (deadMoneyPct > 2 && deadTickers.length > 0) {
    candidates.push({
      id: "consolidate-dead",
      action: `Consolidate ${deadTickers.length} low-contribution positions (${inr(deadValue)}) into conviction names`,
      scoreGain: dimGain(capital, clamp(Math.round(100 - Math.min(60, Math.max(0, deadMoneyPct - 4) * 12)))),
      why: `${pct(deadMoneyPct)} of the book is parked in positions that aren't moving the needle.`,
      ticker: deadTickers[0] ?? null,
    });
  }

  // Deploy: meet the monthly floor.
  if (fresh < DEPLOY_FLOOR) {
    const shortfall = DEPLOY_FLOOR - fresh;
    candidates.push({
      id: "meet-deploy-floor",
      action: `Deploy ${inr(shortfall)} more this month to hit the ${inr(DEPLOY_FLOOR)} fresh-capital floor`,
      scoreGain: dimGain(deploy, 100),
      why: `Only ${inr(fresh)} of fresh capital went in over the last 30 days.`,
      ticker: null,
    });
  }

  // Cost: cut overlap / high TER. Reference the ₹ at stake (smaller of the two
  // funds for an overlap pair, or the priciest fund for a TER drag).
  if (input.worstOverlapPct > 35 || weightedTer > 0.6) {
    const projPenalty = overlapPenalty(Math.min(input.worstOverlapPct, 35)) + terPenalty(Math.min(weightedTer, 0.6));
    const overlapHeavy = input.worstOverlapPct > 50;
    const sortedByValue = input.mfSchemes.slice().sort((a, b) => b.valueINR - a.valueINR);
    const priciest = input.mfSchemes
      .slice()
      .sort((a, b) => (b.ter ?? 0) - (a.ter ?? 0))[0];
    // For an overlap pair, the smaller leg is the redundant ₹ to redeploy.
    const overlapRupees = sortedByValue.length >= 2 ? sortedByValue[1].valueINR : sortedByValue[0]?.valueINR ?? 0;
    candidates.push({
      id: "cut-cost",
      action: overlapHeavy
        ? `Consolidate the ${pct(input.worstOverlapPct)}-overlap MF pair, redeploying ${inr(overlapRupees)} into a distinct sleeve`
        : `Switch the highest-TER fund ${priciest ? `(${priciest.ticker}, ${(priciest.ter ?? 0).toFixed(2)}% TER, ${inr(priciest.valueINR)})` : ""} toward a sub-0.6% blend`,
      scoreGain: dimGain(cost, clamp(Math.round(100 - projPenalty))),
      why: overlapHeavy
        ? `Worst MF overlap is ${pct(input.worstOverlapPct)}; you're paying twice for the same names.`
        : `Value-weighted TER is ${weightedTer.toFixed(2)}%, above the 0.6% efficiency line.`,
      ticker: overlapHeavy ? sortedByValue[1]?.ticker ?? null : priciest?.ticker ?? null,
    });
  }

  // Allocation: redirect flows to the most-underweight bucket.
  if (maxAllocDrift > 3) {
    const drifts: Array<{ name: string; d: number }> = [
      { name: "equity", d: allocDrift.equity },
      { name: "debt-equivalent", d: allocDrift.debt },
      { name: "gold", d: allocDrift.gold },
    ];
    const under = drifts.slice().sort((a, b) => a.d - b.d)[0];
    if (under.d < 0) {
      const fillRupees = (Math.min(Math.abs(under.d), 5) / 100) * total;
      candidates.push({
        id: "rebalance-flows",
        action: `Redirect ${inr(fillRupees)} of new capital into ${under.name} (underweight ${pct(Math.abs(under.d))}pp)`,
        scoreGain: dimGain(allocation, clamp(allocation.score + 8)),
        why: `${under.name} sits ${pct(Math.abs(under.d))}pp under its SAA target.`,
        ticker: null,
      });
    }
  }

  const levers = candidates
    .filter((l) => l.scoreGain > 0)
    .sort((a, b) => b.scoreGain - a.scoreGain)
    .slice(0, 3);

  // ── Rule warnings — surfaced for the score card and Phase 3.2, never scored ──
  const warnings: string[] = [];
  if (directStocks.length > rules.names.max) {
    warnings.push(`Rule 4: ${directStocks.length} direct stocks vs cap ${rules.names.max}. No new name until under the cap.`);
  }
  const bookmarks = directStocks.filter((p) => (p.valueINR / total) * 100 < 1).map((p) => p.ticker);
  if (bookmarks.length > 0) {
    warnings.push(`Rule 4: below 1% of book — ${bookmarks.join(", ")}. Reach ${rules.names.starterTargetPct}% within ${rules.names.starterPrints} prints or close.`);
  }
  const losers = directStocks
    .filter((p) => (p.pnlPct ?? 0) <= rules.loserCheck.drawdownPct && !p.exitIfAt)
    .map((p) => `${p.ticker} (${(p.pnlPct ?? 0).toFixed(1)}%)`);
  if (losers.length > 0) {
    warnings.push(`Rule 7: re-underwrite due within ${rules.loserCheck.sessions} sessions — ${losers.join(", ")}.`);
  }
  const noExit = directStocks.filter((p) => !p.exitIf).map((p) => p.ticker);
  if (noExit.length > 0) warnings.push(`Rule 5: no written exit condition — ${noExit.join(", ")}.`);
  const drafts = directStocks.filter((p) => p.exitIf && /^DRAFT/i.test(p.exitIf)).map((p) => p.ticker);
  if (drafts.length > 0) warnings.push(`Rule 5: exit conditions still DRAFT (confirm) — ${drafts.join(", ")}.`);
  const equitySchemes = input.mfSchemes.filter(
    (m) => (m.valueINR || 0) > 0 && !BALLAST_RE.test(`${m.scheme ?? ""} ${m.category}`),
  ).length;
  if (equitySchemes > rules.mf.maxEquitySchemes) {
    warnings.push(`Rule 9: ${equitySchemes} equity MF schemes vs cap ${rules.mf.maxEquitySchemes}.`);
  }

  return {
    asOf: asOf || new Date().toISOString(),
    composite,
    grade: gradeFor(composite),
    dimensions,
    levers,
    note: null,
    warnings,
    rulesVersion: rules.version,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers used by the scorer.
// ─────────────────────────────────────────────────────────────────────────────

function maxBy<T>(arr: T[], fn: (t: T) => number): T | null {
  if (arr.length === 0) return null;
  return arr.reduce((best, cur) => (fn(cur) > fn(best) ? cur : best));
}

function isCoreRole(role?: string): boolean {
  if (!role) return false;
  return /core|compounder|building/i.test(role);
}

/**
 * Estimated composite-point gain from moving one dimension to a projected
 * score. Honest single-digit deltas: dimScoreDelta × dimWeight, rounded, min 0.
 */
function dimGain(dim: ScoreDimension, projectedScore: number): number {
  const delta = (projectedScore - dim.score) * dim.weight;
  return Math.max(0, Math.round(delta));
}
