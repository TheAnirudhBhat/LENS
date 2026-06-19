import { NextResponse } from "next/server";
import { readFile, writeFile, stat } from "node:fs/promises";
import { EARNINGS_DATA_FILE, SNAPSHOT_FILE, US_STOCKS_FILE } from "@/lib/paths";
import {
  fetchYahooBatch,
  type EarningsCache,
  type EarningsRecord,
} from "@/lib/earnings";
import { TICKER_META } from "@/lib/tickerMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function readDisk(): Promise<EarningsCache | null> {
  try {
    const raw = await readFile(EARNINGS_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<EarningsCache>;
    if (!parsed.updatedAt || !Array.isArray(parsed.records)) return null;
    return { updatedAt: parsed.updatedAt, records: parsed.records };
  } catch {
    return null;
  }
}

async function writeDisk(c: EarningsCache): Promise<void> {
  try {
    await writeFile(EARNINGS_DATA_FILE, JSON.stringify(c, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}

type SnapshotHolding = { ticker?: string; exchange?: string };

async function readInHoldings(): Promise<
  Array<{ ticker: string; exchange?: string }>
> {
  try {
    const j = JSON.parse(await readFile(SNAPSHOT_FILE, "utf8"));
    if (!Array.isArray(j.holdings)) return [];
    return (j.holdings as SnapshotHolding[])
      .filter(
        (h) =>
          typeof h.ticker === "string" &&
          /^[A-Z][A-Z0-9&]{1,14}$/.test(h.ticker as string),
      )
      .map((h) => ({ ticker: h.ticker as string, exchange: h.exchange }));
  } catch {
    return [];
  }
}

async function readUsHoldings(): Promise<string[]> {
  try {
    const j = JSON.parse(await readFile(US_STOCKS_FILE, "utf8"));
    if (!Array.isArray(j.positions)) return [];
    return (j.positions as { ticker?: string; kind?: string }[])
      .filter((p) => typeof p.ticker === "string" && p.kind === "stock")
      .map((p) => p.ticker as string);
  } catch {
    return [];
  }
}

// Equity-only filter — bonds, ETFs, metals all skipped per the rebuild brief.
function isEquity(ticker: string): boolean {
  const meta = TICKER_META[ticker];
  if (!meta) return /^[A-Z]{1,10}$/.test(ticker); // unknown tickers assumed equity
  return meta.asset === "equity";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  const cache = await readDisk();
  const now = Date.now();
  const fresh =
    cache && now - +new Date(cache.updatedAt) < TTL_MS && !force;

  if (fresh && cache) {
    return NextResponse.json({
      updatedAt: cache.updatedAt,
      records: cache.records,
      cacheStatus: "cached" as const,
    });
  }

  // Build target list. Skip bonds, ETFs, metals.
  const [inHoldings, usTickers] = await Promise.all([
    readInHoldings(),
    readUsHoldings(),
  ]);
  const targets: Array<{
    ticker: string;
    market: "IN" | "US";
    exchange?: string;
  }> = [];
  for (const h of inHoldings) {
    if (isEquity(h.ticker))
      targets.push({ ticker: h.ticker, market: "IN", exchange: h.exchange });
  }
  for (const t of usTickers) {
    if (isEquity(t)) targets.push({ ticker: t, market: "US" });
  }

  let records: EarningsRecord[] = [];
  try {
    records = await fetchYahooBatch(targets);
  } catch {
    records = [];
  }

  // If live fetch failed (Yahoo down / rate-limited), serve the most recent
  // disk cache to keep the UI populated rather than going empty.
  if (records.length === 0 && cache) {
    return NextResponse.json({
      updatedAt: cache.updatedAt,
      records: cache.records,
      cacheStatus: "stale" as const,
    });
  }

  // Merge: live records replace same-ticker disk entries, but disk entries
  // for tickers Yahoo couldn't satisfy (manual seeds) are preserved.
  const merged = new Map<string, EarningsRecord>();
  if (cache) {
    for (const r of cache.records) merged.set(r.ticker.toUpperCase(), r);
  }
  for (const r of records) merged.set(r.ticker.toUpperCase(), r);
  const out: EarningsCache = {
    updatedAt: new Date(now).toISOString(),
    records: Array.from(merged.values()).sort((a, b) =>
      (b.reportedAt || "").localeCompare(a.reportedAt || ""),
    ),
  };
  if (records.length > 0) await writeDisk(out);

  return NextResponse.json({
    updatedAt: out.updatedAt,
    records: out.records,
    cacheStatus: records.length > 0 ? ("fresh" as const) : ("seed" as const),
  });
}
