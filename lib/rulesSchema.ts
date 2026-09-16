/**
 * lib/rulesSchema.ts — the shape of `rules.json`, the numbers behind the
 * user's rulebook (`strategy.md` in the data dir). Isomorphic on purpose: no
 * fs here, so client code (lib/policy.ts → app/page.tsx) can import the
 * defaults. The server loads the live file through lib/rules.ts.
 *
 * One home for every cap, band, floor and gate. If a number appears anywhere
 * else in the codebase it is a bug, not a second opinion.
 */
import { z } from "zod";

/** [target, low, high] in percentage points of total book. */
const Band = z.tuple([z.number(), z.number(), z.number()]);

export const RulesSchema = z.object({
  version: z.string(),
  note: z.string().optional(),
  goal: z.object({
    baseCr: z.number(),
    stretchCr: z.number(),
    returnCeilingPct: z.number(),
  }),
  deploy: z.object({ floorINR: z.number(), stretchINR: z.number() }),
  saa: z.object({
    equity: Band,
    debt: Band,
    gold: Band,
    cashMaxPct: z.number(),
    driftDays: z.number(),
  }),
  size: z.object({
    entryPct: z.tuple([z.number(), z.number()]),
    addsPer90d: z.number(),
    singleStockPct: z.number(),
    clusterPct: z.number(),
    /** Named correlation clusters → explicit ticker lists (rule 3). */
    clusters: z.record(z.string(), z.array(z.string())),
  }),
  names: z.object({
    max: z.number(),
    starterPrints: z.number(),
    starterTargetPct: z.number(),
  }),
  entry: z.object({ zoneBelowMarketPct: z.tuple([z.number(), z.number()]) }),
  loserCheck: z.object({ drawdownPct: z.number(), sessions: z.number() }),
  regimeGate: z.object({
    niftyHalt: z.number(),
    haltSessions: z.number(),
    vixHalt: z.number(),
    niftyResume: z.number(),
  }),
  mf: z.object({
    maxEquitySchemes: z.number(),
    sectoralPct: z.number(),
    freshVehicles: z.array(z.string()),
    frozen: z.array(z.string()),
  }),
  process: z.object({ maxRules: z.number() }),
});

export type Rules = z.infer<typeof RulesSchema>;

/**
 * Fresh-install defaults — what a public clone runs on before the user writes
 * their own rules.json. Generic on purpose: no personal tickers or scheme
 * names here (this repo is public). Clusters, fresh vehicles and frozen
 * schemes are declared in the user's data-dir rules.json.
 */
export const DEFAULT_RULES: Rules = {
  version: "2026-09-16",
  goal: { baseCr: 15, stretchCr: 25, returnCeilingPct: 15 },
  deploy: { floorINR: 50000, stretchINR: 90000 },
  saa: {
    equity: [85, 80, 90],
    debt: [10, 7, 13],
    gold: [5, 3, 8],
    cashMaxPct: 3,
    driftDays: 30,
  },
  size: {
    entryPct: [1, 2],
    addsPer90d: 2,
    singleStockPct: 6,
    clusterPct: 12,
    clusters: {}, // e.g. { "ai-infra": ["TICKER", ...] } — set in rules.json
  },
  names: { max: 12, starterPrints: 2, starterTargetPct: 2 },
  entry: { zoneBelowMarketPct: [8, 12] },
  loserCheck: { drawdownPct: -15, sessions: 5 },
  regimeGate: { niftyHalt: 23000, haltSessions: 2, vixHalt: 22, niftyResume: 24200 },
  mf: {
    maxEquitySchemes: 8,
    sectoralPct: 10,
    freshVehicles: [], // scheme tickers the monthly MF deploy may go to — set in rules.json
    frozen: [], // schemes never to be restructured — set in rules.json
  },
  process: { maxRules: 10 },
};
