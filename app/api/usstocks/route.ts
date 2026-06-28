import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { US_STOCKS_FILE } from "@/lib/paths";
import { USStocksDataSchema, parseOrThrow } from "@/lib/schemas";
import { fetchUSQuotes, fetchUsdInr } from "@/lib/usquote";
import { resolveFx } from "@/lib/fx";
import { withinMs } from "@/lib/timeoutRace";
import type { z } from "zod";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";

type USData = z.output<typeof USStocksDataSchema>;

/** Overlay keyless live USD prices (Yahoo/Stooq) + live FX onto the stored
 *  positions. Units come from the file (only change on a trade). Any ticker
 *  the quote source misses keeps its stored price. Best-effort — on total
 *  failure the stored data is returned unchanged. */
async function enrichWithLiveQuotes(data: USData): Promise<USData> {
  const positions = data.positions ?? [];
  if (positions.length === 0) return data;
  let quotes: Map<string, number>;
  try {
    quotes = await fetchUSQuotes(positions.map((p) => p.ticker));
  } catch {
    return data;
  }
  if (quotes.size === 0) return data;
  // One FX source of truth (shared with the score route): resolveFx prefers the
  // live rate, persists it to fx_last_known.json, and falls back to that stored
  // rate. It throws only when neither exists — then fall back to the file's own
  // inline fx block so nothing regresses; fx<=0 below keeps stored prices.
  const liveFx = await fetchUsdInr().catch(() => null);
  let fx: number;
  try {
    fx = resolveFx(liveFx, "live");
  } catch {
    fx = Number(data.fx?.usdInr ?? 0);
  }
  let invTot = 0;
  let curTot = 0;
  const newPositions = positions.map((p) => {
    const live = quotes.get(p.ticker.toUpperCase());
    const invested = p.investedINR ?? 0;
    invTot += invested;
    if (!live || fx <= 0) {
      curTot += p.currentINR ?? 0;
      return p;
    }
    const currentINR = Math.round(live * p.quantity * fx);
    curTot += currentINR;
    return {
      ...p,
      currentPriceUSD: Number(live.toFixed(2)),
      currentINR,
      pnlINR: Math.round(currentINR - invested),
      pnlPct:
        invested > 0
          ? Number((((currentINR - invested) / invested) * 100).toFixed(2))
          : p.pnlPct,
    };
  });
  return {
    ...data,
    fx: liveFx ? { ...data.fx, usdInr: Number(liveFx.toFixed(2)), asOf: "live" } : data.fx,
    positions: newPositions,
    totals: {
      ...data.totals,
      investedINR: Math.round(invTot),
      currentINR: Math.round(curTot),
      pnlINR: Math.round(curTot - invTot),
      pnlPct: invTot > 0 ? Number((((curTot - invTot) / invTot) * 100).toFixed(2)) : data.totals?.pnlPct,
    },
  };
}

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(US_STOCKS_FILE, "utf8"),
      stat(US_STOCKS_FILE),
    ]);
    const raw = JSON.parse(content);
    const data = parseOrThrow(USStocksDataSchema, raw, "usstocks");
    // Cap the paint: live Yahoo/FX enrichment if it lands in 700ms, else stored
    // data (the fetch keeps warming the cache for the next request).
    const enriched = await withinMs(enrichWithLiveQuotes(data), 700, data);
    return NextResponse.json({ data: enriched, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSchema = msg.startsWith("[usstocks]");
    if (isSchema) console.error(msg);
    return NextResponse.json(
      { data: null, error: msg },
      { status: isSchema ? 500 : 404 }
    );
  }
}
