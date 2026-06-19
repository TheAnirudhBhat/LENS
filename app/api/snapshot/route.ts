import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { SNAPSHOT_FILE } from "@/lib/paths";
import { SnapshotSchema, parseOrThrow } from "@/lib/schemas";
import { getHoldings, readSession } from "@/lib/kite";
import type { z } from "zod";

type Snapshot = z.output<typeof SnapshotSchema>;
type KiteHolding = {
  tradingsymbol: string;
  exchange: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  day_change?: number;
  day_change_percentage?: number;
};

/** Fetch Kite live holdings and merge with the snapshot's IN-equity entries.
 *  For any ticker that matches (case-insensitive), overwrite ltp, value, pnlPct,
 *  and dayChangePct with Kite live values. Snapshot values stay for tickers
 *  Kite doesn't cover (US, MF — those have their own enrichment paths).
 */
async function enrichWithKite(snapshot: Snapshot): Promise<Snapshot> {
  // Skip the round-trip if there's no Kite session — most days first sync of
  // the morning, session is expired and we keep using the static snapshot.
  const session = await readSession();
  if (!session?.access_token) return snapshot;

  let kiteHoldings: KiteHolding[];
  try {
    const raw = await getHoldings();
    kiteHoldings = raw as KiteHolding[];
  } catch (err) {
    // TLS / network / token expired — silently fall back to static snapshot.
    console.warn(
      "[snapshot] Kite enrichment skipped:",
      err instanceof Error ? err.message : String(err)
    );
    return snapshot;
  }

  const byTicker = new Map<string, KiteHolding>();
  for (const h of kiteHoldings) {
    byTicker.set(h.tradingsymbol.toUpperCase(), h);
  }

  let totalEquity = 0;
  const updatedHoldings = snapshot.holdings.map((h) => {
    const live = byTicker.get(h.ticker.toUpperCase());
    if (!live) return h;
    const ltp = live.last_price;
    const value = ltp * h.qty;
    const cost = (h.avgPrice ?? live.average_price) * h.qty;
    const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : h.pnlPct;
    totalEquity += value;
    return {
      ...h,
      ltp,
      value,
      pnlPct,
      dayChangePct:
        live.day_change_percentage !== undefined
          ? live.day_change_percentage
          : h.dayChangePct,
    };
  });

  // Recompute concentration weights. Two denominators (audit fix — user-approved
  // that concentration is measured vs the WHOLE portfolio, not just the IN book):
  //   • weightInBook — share of the IN book (all snapshot holdings incl. bonds).
  //   • weight       — share of the whole portfolio (totalPortfolioValue when it
  //                    is present and larger than the in-book total; else falls
  //                    back to the in-book total so single-silo setups still work).
  const inBookTotal =
    updatedHoldings.reduce((s, h) => s + (h.value ?? 0), 0) ||
    snapshot.totalValue ||
    totalEquity;
  const portfolioTotal =
    snapshot.totalPortfolioValue && snapshot.totalPortfolioValue > inBookTotal
      ? snapshot.totalPortfolioValue
      : inBookTotal;
  const recomputed = updatedHoldings.map((h) => {
    if (h.value === undefined) return h;
    const weightInBook = inBookTotal > 0 ? (h.value / inBookTotal) * 100 : 0;
    const weight = portfolioTotal > 0 ? (h.value / portfolioTotal) * 100 : 0;
    return {
      ...h,
      weight: Number(weight.toFixed(2)),
      weightInBook: Number(weightInBook.toFixed(2)),
    };
  });

  // Aggregate IN P&L — sum Kite's per-holding `pnl` over EVERY holding it
  // returns so the dashboard number matches Kite's app exactly. Includes
  // equity + bonds + metals (everything Kite tracks under the user's demat).
  // Skips zero-avg-price rows (transferred bonds with phantom pnl).
  let liveInEquityPnL = 0;
  let liveInEquityValue = 0;
  let liveInEquityCost = 0;
  for (const h of kiteHoldings) {
    if (!h.average_price || h.average_price === 0) continue;
    liveInEquityPnL += h.pnl;
    liveInEquityValue += h.last_price * h.quantity;
    liveInEquityCost += h.average_price * h.quantity;
  }
  const liveInEquityPnLPct =
    liveInEquityCost > 0 ? (liveInEquityPnL / liveInEquityCost) * 100 : undefined;

  return {
    ...snapshot,
    holdings: recomputed,
    liveInEquityPnL,
    liveInEquityValue,
    liveInEquityCost,
    liveInEquityPnLPct,
  };
}

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(SNAPSHOT_FILE, "utf8"),
      stat(SNAPSHOT_FILE),
    ]);
    const raw = JSON.parse(content);
    const data = parseOrThrow(SnapshotSchema, raw, "snapshot");
    const enriched = await enrichWithKite(data);
    return NextResponse.json({ data: enriched, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSchema = msg.startsWith("[snapshot]");
    if (isSchema) console.error(msg);
    return NextResponse.json(
      { data: null, error: msg },
      { status: isSchema ? 500 : 404 }
    );
  }
}
