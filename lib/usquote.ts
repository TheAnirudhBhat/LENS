/**
 * US equity live-quote client — keyless, no API key required.
 *
 * Primary: Yahoo Finance chart endpoint (query1.finance.yahoo.com).
 * Fallback: Stooq CSV (may be blocked on some corporate networks).
 * FX: Yahoo USDINR=X, falling back to a caller-supplied last-known rate.
 *
 * Mirrors lib/mfapi.ts: 60s TTL dedupe cache, parallel fetch, best-effort
 * (any ticker that fails just keeps its stored price upstream).
 */

export type USQuote = { ticker: string; priceUSD: number };

const TTL_MS = 60_000;

async function yahooPrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        ticker
      )}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
    };
    const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

async function stooqPrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://stooq.com/q/l/?s=${ticker.toLowerCase()}.us&f=sd2t2ohlcv&h&e=csv`
    );
    if (!res.ok) return null;
    const text = await res.text();
    const line = text.trim().split("\n")[1]; // skip header
    const close = parseFloat(line?.split(",")[6] ?? "");
    return Number.isFinite(close) ? close : null;
  } catch {
    return null;
  }
}

async function onePrice(ticker: string): Promise<number | null> {
  return (await yahooPrice(ticker)) ?? (await stooqPrice(ticker));
}

let quoteCache: {
  key: string;
  at: number;
  promise: Promise<Map<string, number>>;
} | null = null;

/** Live USD prices for the given tickers, keyed by uppercase ticker. Deduped
 *  60s per ticker set — a different set inside the window re-fetches rather than
 *  returning the prior set's (stale/missing-ticker) map. */
export async function fetchUSQuotes(
  tickers: string[]
): Promise<Map<string, number>> {
  const now = Date.now();
  const key = tickers.map((t) => t.toUpperCase()).sort().join(",");
  if (quoteCache && quoteCache.key === key && now - quoteCache.at < TTL_MS) {
    return quoteCache.promise;
  }
  const promise = (async () => {
    const out = new Map<string, number>();
    await Promise.all(
      tickers.map(async (t) => {
        const p = await onePrice(t);
        if (p !== null) out.set(t.toUpperCase(), p);
      })
    );
    return out;
  })().catch((err) => {
    quoteCache = null;
    throw err;
  });
  quoteCache = { key, at: now, promise };
  return promise;
}

let fxCache: { at: number; value: number | null } | null = null;

/** Live USD->INR. Returns null on failure (caller keeps last-known FX). */
export async function fetchUsdInr(): Promise<number | null> {
  const now = Date.now();
  if (fxCache && now - fxCache.at < TTL_MS) return fxCache.value;
  const v = await yahooPrice("USDINR=X");
  fxCache = { at: now, value: v };
  return v;
}
