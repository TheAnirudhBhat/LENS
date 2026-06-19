// Canonical book schema — the single source of truth that every UI surface reads.
// Per IMPLEMENTATION_PLAN P0a. Plain TypeScript types for now (zod can wrap later).

export type AssetClass =
  | "equity"
  | "etf"
  | "bond"
  | "mutualFund"
  | "usEquity"
  | "gold"
  | "commodity";

export type Market = "IN" | "US";
export type Broker = "kite" | "indmoney" | "groww" | "indstocks";

export type ConvictionTier =
  | "Core"
  | "Compounder"
  | "Multibagger-bet"
  | "Tactical"
  | "Exit-queue";

export type Position = {
  ticker: string;
  isin?: string;
  name: string;
  assetClass: AssetClass;
  market: Market;
  broker: Broker;
  qty: number;
  avgPrice?: number;
  currentPrice: number;
  value: number; // INR (FX-converted for US)
  pnl?: number;
  pnlPct?: number;
  weightAtCost?: number;
  weightCurrent: number;
  dayChangePct?: number;
  marketCapCr?: number;
  sector?: string;
  themes?: string[];

  // conviction layer (P1) — nullable in P0
  convictionTier?: ConvictionTier;
  thesis?: string;
  thesisTouchedAt?: string;
  exitRule?: string;

  // bond-specific
  couponPct?: number;
  maturityDate?: string;
  nextCouponDate?: string;
  creditRating?: string;
  issuer?: string;
  faceValue?: number;

  // MF-specific
  schemeCode?: string;
  planType?: "Direct" | "Regular";
  sipActive?: boolean;
  category?: string;
  xirr?: number;

  // US-specific
  avgPriceUsd?: number;
  livePriceUsd?: number;

  // provenance
  dataSource: string;
  sourceMtime?: string;
};

export type Cash = {
  broker: string;
  amount: number;
  arrivedAt?: string;
};

export type Benchmarks = {
  // pct1d is null when the snapshot carried a close but no day-change figure.
  nifty50?: { value: number; pct1d: number | null };
  nifty500?: { value: number; pct1d: number | null };
};

export type Book = {
  version: 1;
  bookValue: number; // total in INR (positions + cash)
  fetchedAt: string; // ISO timestamp
  positions: Position[];
  cash: Cash[];
  fx: { usdInr: number; asOf: string };
  benchmarks: Benchmarks;
  regime?: string;
  history?: { date: string; bookValue: number }[];
};

export type BookSourceProvenance = {
  source: string;
  mtime: string | null;
  ok: boolean;
  note?: string;
};

export type BookBuildResult = {
  book: Book;
  sources: BookSourceProvenance[];
};
