/**
 * Per-ticker correlation loader.
 *
 * Joins every silo (snapshot, US stocks, mutual funds, bonds, news cache,
 * earnings data, earnings outlook, tasks, decisions) into one payload for the
 * per-ticker drawer. Server-side only; read straight from the local memory
 * directory via paths in lib/paths.ts.
 *
 * Read order is cheap-first:
 *   1. Market routing (IN | US | MF | BONDS) locks the position file we
 *      need so we don't read everything for every click.
 *   2. Position file → holding + company.
 *   3. News cache → filter by ticker token.
 *   4. Earnings data + outlook → match by ticker (case-insensitive).
 *   5. Tasks → filter by `ticker` field.
 *   6. Decisions → filter by `ticker`, take 5 most recent.
 *
 * Every read is best-effort; a missing file leaves its slot empty, never
 * fails the whole payload.
 */
import { readFile } from "node:fs/promises";
import {
  SNAPSHOT_FILE,
  US_STOCKS_FILE,
  MUTUAL_FUNDS_FILE,
  BONDS_FILE,
  NEWS_CACHE_FILE,
  EARNINGS_DATA_FILE,
  EARNINGS_OUTLOOK_FILE,
  TASKS_FILE,
  DECISIONS_FILE,
} from "./paths";
import { parseMutualFunds } from "./parsers";
import { getMeta } from "./tickerMeta";
import { readLastKnownFx } from "./fx";

export type Market = "IN" | "US" | "MF" | "BONDS";

type Direction = "+" | "-" | "neutral";
type Magnitude = "low" | "med" | "high";
type Horizon = "days" | "weeks" | "quarters";
type Confidence = "low" | "med" | "high";

type Tagging = {
  tickers: string[];
  direction: Direction;
  magnitude: Magnitude;
  mechanism: string;
  horizon: Horizon;
  confidence: Confidence;
  sector?: string;
};

export type TaggedArticle = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet: string;
  region: "IN" | "US" | "GLOBAL";
  tagging: Tagging;
  priceDelta?: Record<string, number>;
};

export type PerTicker = {
  ticker: string;
  company?: string;
  market: Market;
  holding?: {
    qty: number;
    avgPrice: number;
    currentPrice: number;
    valueINR: number;
    pnlPct: number;
    weight?: number;
    role?: string;
    thesisHealth?: "green" | "amber" | "red";
    thesisNote?: string;
  };
  news: TaggedArticle[];
  earnings?: {
    period: string;
    reportedAt: string;
    revenueYoYPct?: number;
    epsYoYPct?: number;
    brief: string;
  };
  outlook?: {
    direction: Direction;
    magnitude: Magnitude;
    confidence: Confidence;
    meaningForUser: string;
    watchFor: string[];
  };
  openTasks: {
    id: string;
    heading: string;
    priority: string;
    subheading: string;
  }[];
  recentDecisions: {
    id: string;
    date: string;
    action: string;
    qty: number;
    price: number;
    verdict: string;
  }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function readJSON<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sameTicker(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a.toUpperCase() === b.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Position loaders, one per market.
// ─────────────────────────────────────────────────────────────────────────────

type SnapshotHolding = {
  ticker: string;
  qty: number;
  avgPrice?: number;
  ltp?: number;
  value?: number;
  weight?: number;
  pnlPct?: number;
  role?: string;
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
  market?: "IN" | "US";
};
type SnapshotFile = { holdings?: SnapshotHolding[] };

async function loadInPosition(
  ticker: string,
): Promise<{ company?: string; holding: PerTicker["holding"] } | null> {
  const snap = await readJSON<SnapshotFile>(SNAPSHOT_FILE);
  const h = snap?.holdings?.find((x) => sameTicker(x.ticker, ticker));
  if (!h) return null;
  const meta = getMeta(h.ticker);
  return {
    company: meta.name,
    holding: {
      qty: h.qty ?? 0,
      avgPrice: h.avgPrice ?? 0,
      currentPrice: h.ltp ?? 0,
      valueINR: h.value ?? 0,
      pnlPct: h.pnlPct ?? 0,
      weight: h.weight,
      role: h.role,
      thesisHealth: h.thesisHealth,
      thesisNote: h.thesisNote,
    },
  };
}

type USPosition = {
  ticker: string;
  name?: string;
  quantity?: number;
  avgPriceUSD?: number;
  currentPriceUSD?: number;
  currentINR?: number;
  pnlPct?: number;
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
};
type USFile = { positions?: USPosition[]; fx?: { usdInr?: number | null } };

async function loadUSPosition(
  ticker: string,
): Promise<{ company?: string; holding: PerTicker["holding"] } | null> {
  const us = await readJSON<USFile>(US_STOCKS_FILE);
  const p = us?.positions?.find((x) => sameTicker(x.ticker, ticker));
  if (!p) return null;
  // Use the precomputed currentINR when present. Otherwise derive from FX:
  // prefer the live rate, fall back to last-known stored rate, and only as a
  // last resort 0 (this best-effort drawer loader must never throw — a missing
  // value renders as "—", which is honest, unlike a 1:1 conversion).
  const liveFx = us?.fx?.usdInr;
  const fx =
    liveFx != null && Number.isFinite(liveFx) && liveFx > 0
      ? liveFx
      : readLastKnownFx()?.usdInr ?? 0;
  const valueINR =
    p.currentINR ?? (p.currentPriceUSD ?? 0) * (p.quantity ?? 0) * fx;
  return {
    company: p.name,
    holding: {
      qty: p.quantity ?? 0,
      avgPrice: p.avgPriceUSD ?? 0,
      currentPrice: p.currentPriceUSD ?? 0,
      valueINR,
      pnlPct: p.pnlPct ?? 0,
      thesisHealth: p.thesisHealth,
      thesisNote: p.thesisNote,
    },
  };
}

async function loadMFPosition(
  ticker: string,
): Promise<{ company?: string; holding: PerTicker["holding"] } | null> {
  const md = await readFile(MUTUAL_FUNDS_FILE, "utf8").catch(() => "");
  if (!md) return null;
  const summary = parseMutualFunds(md);
  const e = summary.entries.find(
    (x) =>
      sameTicker(x.ticker, ticker) ||
      x.scheme.toUpperCase().replace(/\s+/g, "") === ticker.toUpperCase(),
  );
  if (!e) return null;
  return {
    company: e.scheme,
    holding: {
      qty: e.units,
      avgPrice: e.avgNav ?? 0,
      currentPrice: e.nav,
      valueINR: e.value,
      pnlPct: e.pnlPct ?? 0,
      role: e.benchmark,
      thesisHealth: e.thesisHealth,
      thesisNote: e.thesisNote,
    },
  };
}

type BondPosition = {
  isin: string;
  name: string;
  issuer: string;
  units?: number;
  avgPricePerUnit?: number;
  investedINR?: number;
  faceValueINR?: number;
  interestNetINR?: number;
  approxYieldPct?: number | null;
  status?: "active" | "matured";
};
type BondsFile = { positions?: BondPosition[] };

async function loadBondPosition(
  ticker: string,
): Promise<{ company?: string; holding: PerTicker["holding"] } | null> {
  const bonds = await readJSON<BondsFile>(BONDS_FILE);
  // Bonds are addressed by ISIN; allow either ISIN or issuer-name match.
  const p = bonds?.positions?.find(
    (b) =>
      b.isin.toUpperCase() === ticker.toUpperCase() ||
      b.name.toUpperCase().replace(/\s+/g, "") === ticker.toUpperCase(),
  );
  if (!p) return null;
  return {
    company: p.name,
    holding: {
      qty: p.units ?? 0,
      avgPrice: p.avgPricePerUnit ?? 0,
      currentPrice: p.avgPricePerUnit ?? 0,
      valueINR: p.investedINR ?? 0,
      pnlPct: 0,
      role: p.issuer,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// News + earnings + tasks + decisions
// ─────────────────────────────────────────────────────────────────────────────

type NewsCache = { articles?: TaggedArticle[] };

async function loadNews(ticker: string): Promise<TaggedArticle[]> {
  const cache = await readJSON<NewsCache>(NEWS_CACHE_FILE);
  if (!cache?.articles) return [];
  const tk = ticker.toUpperCase();
  const matches = cache.articles.filter((a) =>
    (a.tagging?.tickers ?? []).some((t) => t.toUpperCase() === tk),
  );
  return matches
    .sort(
      (a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt),
    )
    .slice(0, 5);
}

type EarningsRecord = {
  ticker: string;
  company?: string;
  period: string;
  reportedAt: string;
  metrics?: { revenueYoYPct?: number; epsYoYPct?: number };
  brief?: string;
};
type EarningsFile = { records?: EarningsRecord[] };

async function loadEarnings(
  ticker: string,
): Promise<PerTicker["earnings"] | undefined> {
  const data = await readJSON<EarningsFile>(EARNINGS_DATA_FILE);
  const r = data?.records?.find((x) => sameTicker(x.ticker, ticker));
  if (!r) return undefined;
  return {
    period: r.period ?? "",
    reportedAt: r.reportedAt ?? "",
    revenueYoYPct: r.metrics?.revenueYoYPct,
    epsYoYPct: r.metrics?.epsYoYPct,
    brief: r.brief ?? "",
  };
}

type OutlookEntry = {
  ticker: string;
  direction: Direction;
  magnitude: Magnitude;
  confidence: Confidence;
  meaningForUser: string;
  watchFor?: string[];
};
type OutlookFile = { items?: OutlookEntry[] };

async function loadOutlook(
  ticker: string,
): Promise<PerTicker["outlook"] | undefined> {
  const o = await readJSON<OutlookFile>(EARNINGS_OUTLOOK_FILE);
  const e = o?.items?.find((x) => sameTicker(x.ticker, ticker));
  if (!e) return undefined;
  return {
    direction: e.direction,
    magnitude: e.magnitude,
    confidence: e.confidence,
    meaningForUser: e.meaningForUser ?? "",
    watchFor: Array.isArray(e.watchFor) ? e.watchFor : [],
  };
}

type Task = {
  id: string;
  ticker?: string;
  heading?: string;
  subheading?: string;
  text?: string;
  priority?: string;
  done?: boolean;
};
type TasksFile = { tasks?: Task[] };

async function loadOpenTasks(
  ticker: string,
): Promise<PerTicker["openTasks"]> {
  const t = await readJSON<TasksFile>(TASKS_FILE);
  if (!t?.tasks) return [];
  return t.tasks
    .filter((x) => !x.done && sameTicker(x.ticker, ticker))
    .map((x) => ({
      id: x.id,
      heading: x.heading ?? x.text ?? "(untitled)",
      priority: x.priority ?? "med",
      subheading: x.subheading ?? "",
    }));
}

type Decision = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  qty?: number;
  price?: number;
  verdict?: string;
};
type DecisionsFile = { decisions?: Decision[] };

async function loadRecentDecisions(
  ticker: string,
): Promise<PerTicker["recentDecisions"]> {
  const d = await readJSON<DecisionsFile>(DECISIONS_FILE);
  if (!d?.decisions) return [];
  return d.decisions
    .filter((x) => sameTicker(x.ticker, ticker))
    .slice(0, 5)
    .map((x) => ({
      id: x.id,
      date: x.date,
      action: x.action,
      qty: x.qty ?? 0,
      price: x.price ?? 0,
      verdict: x.verdict ?? "pending",
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: single entry point.
// ─────────────────────────────────────────────────────────────────────────────

export async function loadPerTicker(
  ticker: string,
  market?: Market,
): Promise<PerTicker> {
  const m: Market = market ?? "IN";

  // 1. Position file (locked by market hint).
  let pos: { company?: string; holding: PerTicker["holding"] } | null = null;
  if (m === "IN") pos = await loadInPosition(ticker);
  else if (m === "US") pos = await loadUSPosition(ticker);
  else if (m === "MF") pos = await loadMFPosition(ticker);
  else if (m === "BONDS") pos = await loadBondPosition(ticker);

  // 2-6. Cross-cutting silos, fan out in parallel.
  const [news, earnings, outlook, openTasks, recentDecisions] =
    await Promise.all([
      loadNews(ticker),
      loadEarnings(ticker),
      loadOutlook(ticker),
      loadOpenTasks(ticker),
      loadRecentDecisions(ticker),
    ]);

  return {
    ticker: ticker.toUpperCase(),
    company: pos?.company,
    market: m,
    holding: pos?.holding,
    news,
    earnings,
    outlook,
    openTasks,
    recentDecisions,
  };
}
