// buildBook() — merges every existing data source into the canonical Book.
// Per IMPLEMENTATION_PLAN P0a. Server-side only (uses node:fs).

import { readFile, stat } from "node:fs/promises";
import {
  MUTUAL_FUNDS_FILE,
  SNAPSHOT_FILE,
  US_STOCKS_FILE,
} from "@/lib/paths";
import { getMeta } from "@/lib/tickerMeta";
import { parseMutualFunds, type MFEntry } from "@/lib/parsers";
import { readLastKnownFx, writeLastKnownFx } from "@/lib/fx";
import type {
  Book,
  BookBuildResult,
  BookSourceProvenance,
  Cash,
  Position,
} from "./types";

type SnapshotHolding = {
  ticker: string;
  qty: number;
  avgPrice?: number;
  ltp: number;
  value: number;
  weight: number;
  pnlPct?: number;
  dayChangePct?: number;
  market?: "IN" | "US";
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
  role?: string;
  sector?: string;
  marketCapCr?: number;
};

type Snapshot = {
  asOf: string;
  totalValue: number;
  cash?: number;
  regime?: string;
  nifty?: { value: number | null; dayChangePct: number | null };
  holdings: SnapshotHolding[];
};

type UsStocksFile = {
  fetchedAt: string;
  fx?: { usdInr: number | null; asOf: string };
  totals: {
    investedINR: number;
    currentINR: number;
    pnlINR: number;
    pnlPct: number;
    positionCount: number;
  };
  positions: Array<{
    ticker: string;
    name: string;
    kind: "stock" | "etf";
    quantity: number;
    avgPriceUSD: number;
    currentPriceUSD: number;
    investedINR: number;
    currentINR: number;
    pnlINR: number;
    pnlPct: number;
    thesisHealth?: "green" | "amber" | "red";
    thesisNote?: string;
    sector?: string;
  }>;
};

async function readJson<T>(
  path: string,
  label: string
): Promise<{ data: T | null; provenance: BookSourceProvenance }> {
  try {
    const [raw, st] = await Promise.all([
      readFile(path, "utf8"),
      stat(path),
    ]);
    return {
      data: JSON.parse(raw) as T,
      provenance: {
        source: label,
        mtime: st.mtime.toISOString(),
        ok: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      provenance: { source: label, mtime: null, ok: false, note: msg },
    };
  }
}

async function readText(
  path: string,
  label: string
): Promise<{ text: string | null; provenance: BookSourceProvenance }> {
  try {
    const [raw, st] = await Promise.all([
      readFile(path, "utf8"),
      stat(path),
    ]);
    return {
      text: raw,
      provenance: { source: label, mtime: st.mtime.toISOString(), ok: true },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: null,
      provenance: { source: label, mtime: null, ok: false, note: msg },
    };
  }
}

function classifyAsset(
  ticker: string,
  market: "IN" | "US" | undefined
): Position["assetClass"] {
  if (market === "US") return "usEquity";
  const meta = getMeta(ticker).asset;
  if (meta === "bond") return "bond";
  if (meta === "etf") {
    // GOLDCASE / SILVERCASE-style precious metal trackers
    if (/gold|silver|metal/i.test(ticker)) return "gold";
    return "etf";
  }
  return "equity";
}

function snapshotHoldingsToPositions(
  holdings: SnapshotHolding[],
  bookTotal: number,
  snapshotMtime: string | null
): Position[] {
  return holdings.map((h) => {
    const market: "IN" | "US" = (h.market || "IN") as "IN" | "US";
    const assetClass = classifyAsset(h.ticker, market);
    const cost = h.avgPrice !== undefined ? h.avgPrice * h.qty : undefined;
    const pnl = cost !== undefined ? h.value - cost : undefined;
    const meta = getMeta(h.ticker);
    return {
      ticker: h.ticker,
      name: meta.name ?? h.ticker,
      assetClass,
      market,
      broker: market === "US" ? "indmoney" : "kite",
      qty: h.qty,
      avgPrice: h.avgPrice,
      currentPrice: h.ltp,
      value: h.value,
      pnl,
      pnlPct: h.pnlPct,
      weightAtCost:
        cost !== undefined && bookTotal > 0
          ? (cost / bookTotal) * 100
          : undefined,
      weightCurrent: bookTotal > 0 ? (h.value / bookTotal) * 100 : 0,
      dayChangePct: h.dayChangePct,
      marketCapCr: h.marketCapCr,
      sector: h.sector,
      thesis: h.thesisNote,
      dataSource: "kite-snapshot",
      sourceMtime: snapshotMtime ?? undefined,
    };
  });
}

function mfEntriesToPositions(
  entries: MFEntry[],
  bookTotal: number,
  mfMtime: string | null
): Position[] {
  // NOTE: assetClass stays "mutualFund" here — that's accurate as an instrument
  // type. SAA equity-vs-debt bucketing (where arbitrage/liquid/overnight funds
  // must count as debt-equiv, not equity) lives in lib/allocation.ts via
  // isCashEquivalentMF(). Don't roll "mutualFund" wholesale into equity from a
  // book consumer; route through the allocation rule instead.
  return entries.map((m) => {
    const cost = m.invested;
    const pnl =
      cost !== undefined && cost > 0 ? m.value - cost : undefined;
    const pnlPct =
      cost !== undefined && cost > 0 ? (((m.value - cost) / cost) * 100) : undefined;
    return {
      ticker: m.scheme,
      name: m.scheme,
      assetClass: "mutualFund",
      market: "IN",
      broker: "indmoney", // approximate; CAS-sourced funds may be elsewhere
      qty: m.units,
      avgPrice: m.avgNav,
      currentPrice: m.nav,
      value: m.value,
      pnl,
      pnlPct,
      weightAtCost:
        cost !== undefined && bookTotal > 0
          ? (cost / bookTotal) * 100
          : undefined,
      weightCurrent: bookTotal > 0 ? (m.value / bookTotal) * 100 : 0,
      dayChangePct: m.dayChangePct,
      sector: undefined,
      planType:
        m.scheme.toLowerCase().includes("regular") ||
        /regular plan/i.test(m.scheme)
          ? "Regular"
          : "Direct",
      sipActive: m.sipActive,
      category: m.category,
      xirr: m.xirr,
      thesis: m.thesisNote,
      dataSource: "mutual-funds-md",
      sourceMtime: mfMtime ?? undefined,
    };
  });
}

function usPositionsFromFile(
  us: UsStocksFile | null,
  bookTotal: number,
  usMtime: string | null
): Position[] {
  if (!us) return [];
  return us.positions.map((p) => ({
    ticker: p.ticker,
    name: p.name,
    assetClass: p.kind === "etf" ? "etf" : "usEquity",
    market: "US",
    broker: "indmoney",
    qty: p.quantity,
    avgPrice: undefined,
    currentPrice: p.currentPriceUSD,
    avgPriceUsd: p.avgPriceUSD,
    livePriceUsd: p.currentPriceUSD,
    value: p.currentINR,
    pnl: p.pnlINR,
    pnlPct: p.pnlPct,
    weightAtCost:
      bookTotal > 0 ? (p.investedINR / bookTotal) * 100 : undefined,
    weightCurrent: bookTotal > 0 ? (p.currentINR / bookTotal) * 100 : 0,
    sector: p.sector,
    thesis: p.thesisNote,
    dataSource: "us_stocks.json",
    sourceMtime: usMtime ?? undefined,
  }));
}

export async function buildBook(): Promise<BookBuildResult> {
  const [snap, mfText, us] = await Promise.all([
    readJson<Snapshot>(SNAPSHOT_FILE, "snapshot"),
    readText(MUTUAL_FUNDS_FILE, "mutualFunds"),
    readJson<UsStocksFile>(US_STOCKS_FILE, "usStocks"),
  ]);

  const sources: BookSourceProvenance[] = [
    snap.provenance,
    mfText.provenance,
    us.provenance,
  ];

  // First pass: compute book total to derive proper weights.
  const snapshot = snap.data;
  const usFile = us.data;
  const mfSummary = mfText.text ? parseMutualFunds(mfText.text) : null;

  const inHoldingsValue = snapshot
    ? snapshot.holdings.reduce((s, h) => s + (h.value || 0), 0)
    : 0;
  const mfValue =
    mfSummary?.totalValue ??
    mfSummary?.entries.reduce((s, m) => s + (m.value || 0), 0) ??
    0;
  const usValue = usFile?.totals.currentINR ?? 0;
  const cashAmount = snapshot?.cash ?? 0;
  const bookValue = inHoldingsValue + mfValue + usValue + cashAmount;

  const positions: Position[] = [];
  if (snapshot) {
    positions.push(
      ...snapshotHoldingsToPositions(
        snapshot.holdings,
        bookValue,
        snap.provenance.mtime
      )
    );
  }
  if (mfSummary) {
    positions.push(
      ...mfEntriesToPositions(
        mfSummary.entries,
        bookValue,
        mfText.provenance.mtime
      )
    );
  }
  if (usFile) {
    positions.push(
      ...usPositionsFromFile(usFile, bookValue, us.provenance.mtime)
    );
  }

  const cash: Cash[] =
    cashAmount > 0
      ? [{ broker: "kite", amount: cashAmount }]
      : [];

  let fxUsd: number;
  const liveFx = usFile?.fx?.usdInr;
  if (liveFx != null && Number.isFinite(liveFx) && liveFx > 0) {
    // Live rate present — persist it through so future loads have a real
    // fallback instead of silently degrading to 1:1.
    writeLastKnownFx(liveFx, usFile?.fx?.asOf ?? undefined);
    fxUsd = liveFx;
  } else {
    // No live rate. Prefer the last-known stored rate (a real observed value),
    // then reverse-engineer from a single position, then 0 (never 1:1).
    fxUsd =
      readLastKnownFx()?.usdInr ??
      (() => {
        const sample = usFile?.positions.find(
          (p) => p.quantity > 0 && p.currentPriceUSD > 0 && p.currentINR > 0
        );
        if (!sample) return 0;
        return sample.currentINR / (sample.currentPriceUSD * sample.quantity);
      })();
  }

  const book: Book = {
    version: 1,
    bookValue,
    fetchedAt: new Date().toISOString(),
    positions,
    cash,
    fx: { usdInr: fxUsd || 0, asOf: usFile?.fx?.asOf ?? "" },
    benchmarks: snapshot?.nifty?.value != null
      ? {
          nifty50: {
            value: snapshot.nifty.value,
            pct1d: snapshot.nifty.dayChangePct,
          },
        }
      : {},
    regime: snapshot?.regime,
  };

  return { book, sources };
}
