/**
 * Zod schemas — runtime validation at API route boundaries.
 *
 * Pattern: each /api/<x> route parses its file (JSON or markdown via parsers.ts)
 * and runs the result through `Schema.safeParse(data)`. On failure, log the
 * issue path and return a 500 with `{ error: "schema", issues: [...] }`.
 * This stops the UI from silently rendering with malformed data.
 *
 * Coverage: snapshot, holdings, tasks, decisions, US stocks, MF summary.
 * Watchlist & multibaggers stay markdown-parsed (parsers.ts owns shape).
 */
import { z } from "zod";

// ───────────────────────────────────────────────────────────────────────────
// Shared primitives
// ───────────────────────────────────────────────────────────────────────────
const NumberString = z.union([z.number(), z.string()]).transform((v) =>
  typeof v === "number" ? v : Number(v)
);

// ───────────────────────────────────────────────────────────────────────────
// Holdings + snapshot
// ───────────────────────────────────────────────────────────────────────────
export const HoldingSchema = z.object({
  ticker: z.string().min(1),
  qty: z.number().nonnegative(),
  avgPrice: z.number().nonnegative().optional(),
  ltp: z.number().nonnegative().optional(),
  value: z.number(),
  // `weight` = share of the WHOLE portfolio (all silos); `weightInBook` = share
  // of just the IN book (snapshot holdings incl. bonds). See /api/snapshot.
  weight: z.number().optional(),
  weightInBook: z.number().optional(),
  pnlPct: z.number().optional(),
  dayChangePct: z.number().nullable().optional(),
  market: z.enum(["IN", "US"]).optional(),
  // Free-form fields; we accept anything string-shaped.
  role: z.string().optional(),
  thesisHealth: z.enum(["green", "amber", "red"]).optional(),
  thesisNote: z.string().optional(),
  scores: z.record(z.unknown()).optional(),
});

export const UrgentItemSchema = z.object({
  level: z.enum(["info", "warn", "crit", "critical"]).transform((l) =>
    l === "critical" ? "crit" : l
  ),
  ticker: z.string().optional(),
  headline: z.string(),
  action: z.string().optional(),
});

export const BookedGainSchema = z.object({
  date: z.string(),
  asset: z.string(),
  ticker: z.string(),
  action: z.string(),
  amount: z.number(),
  note: z.string().optional(),
});

export const SnapshotSchema = z.object({
  asOf: z.string(),
  // `totalValue` = IN book only (snapshot holdings sum, incl. bonds) — kept for
  // existing consumers. `totalPortfolioValue` = whole portfolio across silos
  // (IN book + US stocks + MF). Concentration weights are measured against the
  // latter. See app/api/sync writeback + app/api/snapshot enrich.
  totalValue: z.number(),
  totalPortfolioValue: z.number().optional(),
  cash: z.number().optional(),
  equityValue: z.number().optional(),
  bondsValue: z.number().optional(),
  equityInvested: z.number().optional(),
  equityPnl: z.number().optional(),
  equityPnlPct: z.number().optional(),
  holdings: z.array(HoldingSchema),
  regime: z.string().optional(),
  regimeDetail: z.string().optional(),
  nifty: z
    .object({
      // Null when the sync ran with no fresh Nifty close (e.g. an off-hours
      // run notes "refresh in Pass H"). Consumers must guard before formatting.
      value: z.number().nullable(),
      dayChangePct: z.number().nullable().optional(),
    })
    .passthrough()
    .optional(),
  // Like nifty.value, null when the sync had no fresh reading.
  vix: z.number().nullable().optional(),
  urgent: z.array(UrgentItemSchema).optional(),
  peakValue: z.number().optional(),
  peakDate: z.string().optional(),
  bookedGains: z.array(BookedGainSchema).optional(),
  // Live aggregates injected by /api/snapshot enrichWithKite. Mirror Kite's
  // authoritative `pnl` field summed over non-bond non-metals IN equity.
  liveInEquityPnL: z.number().optional(),
  liveInEquityValue: z.number().optional(),
  liveInEquityCost: z.number().optional(),
  liveInEquityPnLPct: z.number().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// Tasks
// ───────────────────────────────────────────────────────────────────────────
const TaskFlowEndpointSchema = z.object({
  ticker: z.string(),
  subtitle: z.string().optional(),
});

const TaskFlowSchema = z.object({
  from: TaskFlowEndpointSchema,
  to: TaskFlowEndpointSchema,
  trigger: z.string(),
  gap: z.string().optional(),
  status: z.enum(["armed", "near", "fired", "blocked"]).optional(),
  secondary: z.string().optional(),
});

const TaskAnchorSchema = z.object({
  label: z.string(),
  summary: z.string(),
});

export const TaskSchema = z.object({
  id: z.string(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  text: z.string().optional(),
  priority: z.enum(["urgent", "high", "med", "low"]).optional(),
  ticker: z.string().optional(),
  amc: z.string().optional(),
  asset: z.string().optional(),
  actionType: z.string().optional(),
  source: z.string().optional(),
  done: z.boolean(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
  parkedAt: z.string().optional(),
  flow: TaskFlowSchema.optional(),
  anchor: TaskAnchorSchema.optional(),
});

export const TasksFileSchema = z.object({
  _meta: z.unknown().optional(),
  tasks: z.array(TaskSchema),
});

// ───────────────────────────────────────────────────────────────────────────
// Decisions
// ───────────────────────────────────────────────────────────────────────────
export const DecisionSchema = z.object({
  id: z.string(),
  date: z.string(),
  action: z.string(),
  ticker: z.string(),
  qty: z.number().optional(),
  price: z.number().optional(),
  rationale: z.string().optional(),
  asset: z.string().optional(),
  amountINR: z.number().optional(),
  createdAt: z.string().optional(),
  verdict: z.enum(["good", "bad", "pending"]).optional(),
  reviewAt: z.string().optional(),
  trackedAt: z.string().optional(),
  trackingDelta: z.string().optional(),
  trackingNote: z.string().optional(),
  note: z.string().optional(),
});

export const DecisionsFileSchema = z.object({
  decisions: z.array(DecisionSchema),
});

// ───────────────────────────────────────────────────────────────────────────
// US stocks
// ───────────────────────────────────────────────────────────────────────────
export const USPositionSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  kind: z.enum(["stock", "etf"]).optional(),
  action: z.string().optional(),
  confidence: z.number().optional(),
  quantity: z.number().nonnegative(),
  avgPriceUSD: z.number(),
  currentPriceUSD: z.number(),
  investedINR: z.number(),
  currentINR: z.number(),
  pnlINR: z.number(),
  pnlPct: z.number(),
  thesisHealth: z.enum(["green", "amber", "red"]).optional(),
  thesisNote: z.string().optional(),
  cagrProspect: z.string().optional(),
});

export const USStocksDataSchema = z.object({
  fetchedAt: z.string().optional(),
  source: z.string().optional(),
  broker: z.string().optional(),
  fx: z.record(z.unknown()).optional(),
  strategy: z.string().optional(),
  totals: z
    .object({
      investedINR: z.number(),
      currentINR: z.number(),
      pnlINR: z.number(),
      pnlPct: z.number(),
      positionCount: z.number().optional(),
      targetPositions: z.number().optional(),
      note: z.string().optional(),
    })
    .passthrough(),
  positions: z.array(USPositionSchema),
  exited: z.array(z.unknown()).optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// MF rotations
// ───────────────────────────────────────────────────────────────────────────
export const MFRotationActionSchema = z.enum([
  "Switch",
  "Kill",
  "Consolidate",
  "Exit",
  "Promote",
  "Cap",
  "Watch",
]);

export const MFRotationItemSchema = z.object({
  scheme: z.string(),
  amc: z.string(),
  action: MFRotationActionSchema,
  reason: z.string(),
  impact: z.string().optional(),
});

export const MFRotationsFileSchema = z.object({
  _meta: z.unknown().optional(),
  rotations: z.array(MFRotationItemSchema),
});

// ───────────────────────────────────────────────────────────────────────────
// Profile (per-user strategy config) — see lib/profile.ts for loading/merging.
// ───────────────────────────────────────────────────────────────────────────
const GoalRungSchema = z.object({
  label: z.string(),
  value: z.number(),
  impliedCagrPct: z.number().optional(),
  likelihood: z.enum(["high", "med", "low"]).optional(),
});

const AllocationBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  targetPct: z.number(),
  bandPct: z.number().optional(),
  floorPct: z.number().optional(),
  ceilingPct: z.number().optional(),
});

const RoleTargetSchema = z.object({ role: z.string(), targetPct: z.number() });

const SectorViewSchema = z.object({
  sector: z.string(),
  stance: z.enum(["bullish", "neutral", "bearish"]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["user", "agent"]).optional(),
});

export const ProfileSchema = z.object({
  version: z.literal(1),
  goals: z.object({
    horizonYears: z.number().optional(),
    currentBaseline: z.number().optional(),
    ladder: z.array(GoalRungSchema),
    notes: z.string().optional(),
  }),
  allocation: z.object({
    buckets: z.array(AllocationBucketSchema),
    roleTargets: z.array(RoleTargetSchema).optional(),
  }),
  limits: z
    .object({
      singleNameCapPct: z.number().optional(),
      usSingleNameCapPct: z.number().optional(),
      reassessDrawdownPct: z.number().optional(),
      trimGainPct: z.number().optional(),
      idleCashThreshold: z.number().optional(),
    })
    .optional(),
  strategy: z
    .object({
      convictionLevel: z.enum(["high", "medium", "low", "unsure"]).optional(),
      formedBy: z.enum(["user", "agent", "hybrid"]).optional(),
      sectorViews: z.array(SectorViewSchema).optional(),
      lastReviewed: z.string().optional(),
    })
    .default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;

// ───────────────────────────────────────────────────────────────────────────
// Research candidates (US equities + mutual funds)
// ───────────────────────────────────────────────────────────────────────────
const CouncilSeatSchema = z.object({
  score: z.number(),
  confidence: z.number(),
  reason: z.string().optional(),
  source: z.string().optional(),
});

const CouncilBreakdownSchema = z.object({
  fundamental: CouncilSeatSchema,
  macro: CouncilSeatSchema,
  risk: CouncilSeatSchema,
  technical: CouncilSeatSchema,
  sentiment: CouncilSeatSchema,
});

const ResearchConfidenceSchema = z.enum(["HIGH", "MEDIUM-HIGH", "MEDIUM", "LOW"]);

export const USCandidateSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  sector: z.string(),
  thesis: z.string(),
  whyNow: z.string(),
  score: z.number(),
  confidence: ResearchConfidenceSchema,
  verdict: z.enum(["Buy", "Watch", "Avoid"]),
  tags: z.array(z.enum(["Hype Risk", "Early Opportunity", "Value Trap", "Late Entry Risk"])),
  council: CouncilBreakdownSchema.optional(),
});

export const MFCandidateSchema = z.object({
  scheme: z.string(),
  amc: z.string(),
  category: z.string(),
  fiveYCagr: z.string(),
  thesis: z.string(),
  score: z.number(),
  confidence: ResearchConfidenceSchema,
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Validate `data` against `schema`. On success returns `data` (typed as the
 * schema's OUTPUT — i.e. after any `.transform()` runs).
 * On failure throws an Error containing the first issue path + message so
 * the /api route can 500 with a clear log instead of returning malformed data.
 *
 * Uses `z.output<S>` explicitly so transforms (e.g. "critical" → "crit") are
 * reflected in the returned type, not just the input shape.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  context: string
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "(root)";
    throw new Error(
      `[${context}] schema mismatch at ${path}: ${first?.message ?? "unknown"}`
    );
  }
  return result.data;
}
