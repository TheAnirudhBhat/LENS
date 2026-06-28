import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR, SNAPSHOT_FILE, US_STOCKS_FILE } from "@/lib/paths";
import { DecisionsFileSchema, parseOrThrow } from "@/lib/schemas";
import { getHoldings, readSession } from "@/lib/kite";
import { fetchAllNAVs } from "@/lib/mfapi";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";
const FILE = path.join(MEMORY_DIR, "decisions.json");

type Decision = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  qty?: number;
  price?: number;
  rationale?: string;
  verdict?: "good" | "bad" | "pending";
  reviewAt?: string;
  note?: string;
  // Enriched at read-time
  currentPrice?: number;
  sinceDecisionPct?: number;
  outcome?: "saved" | "missed" | "winning" | "losing" | "flat" | "exited";
};

async function read(): Promise<{ decisions: Decision[] }> {
  try {
    const raw = await readFile(FILE, "utf8");
    const json = JSON.parse(raw);
    return parseOrThrow(DecisionsFileSchema, json, "decisions") as { decisions: Decision[] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("[decisions]")) {
      console.error(msg);
      throw err;
    }
    return { decisions: [] };
  }
}

const EXTERNAL_PRICES_FILE = path.join(MEMORY_DIR, "external_prices.json");

async function readLivePrices(): Promise<Record<string, number>> {
  const map: Record<string, number> = {};

  // 1. Static snapshot — baseline that always has SOMETHING for owned IN tickers.
  try {
    const raw = await readFile(SNAPSHOT_FILE, "utf8");
    const snap = JSON.parse(raw) as { holdings: { ticker: string; ltp: number }[] };
    for (const h of snap.holdings) map[h.ticker.toUpperCase()] = h.ltp;
  } catch {}

  // 2. US stock current prices in USD (matching how decisions log records
  //    US trade prices). Skip if missing currentPriceUSD.
  try {
    const raw = await readFile(US_STOCKS_FILE, "utf8");
    const us = JSON.parse(raw) as {
      positions?: { ticker: string; currentPriceUSD?: number }[];
    };
    for (const p of us.positions ?? []) {
      if (p.currentPriceUSD && p.currentPriceUSD > 0) {
        map[p.ticker.toUpperCase()] = p.currentPriceUSD;
      }
    }
  } catch {}

  // 3. Layer in external prices for tickers no longer in book (e.g. NKE/BOTZ post-exit).
  try {
    const raw = await readFile(EXTERNAL_PRICES_FILE, "utf8");
    const ext = JSON.parse(raw) as { prices?: Record<string, number> };
    for (const [k, v] of Object.entries(ext.prices ?? {})) {
      map[k.toUpperCase()] = v;
    }
  } catch {}

  // 4. Live overrides — Kite for IN, mfapi for MF. Run in parallel; failures
  //    silently fall back to snapshot/external prices.
  const [kiteRes, mfRes] = await Promise.allSettled([
    (async () => {
      const session = await readSession();
      if (!session?.access_token) return null;
      return (await getHoldings()) as {
        tradingsymbol: string;
        last_price: number;
      }[];
    })(),
    fetchAllNAVs().catch(() => []),
  ]);

  if (kiteRes.status === "fulfilled" && kiteRes.value) {
    for (const h of kiteRes.value) {
      if (h.last_price > 0) map[h.tradingsymbol.toUpperCase()] = h.last_price;
    }
  }
  if (mfRes.status === "fulfilled" && Array.isArray(mfRes.value)) {
    for (const n of mfRes.value) {
      if (n.nav > 0) map[n.ticker.toUpperCase()] = n.nav;
    }
  }

  return map;
}

function classify(action: string, decisionPrice: number, currentPrice: number): {
  pct: number;
  outcome: Decision["outcome"];
} {
  const pct = ((currentPrice - decisionPrice) / decisionPrice) * 100;
  const a = action.toUpperCase();
  if (a === "SELL" || a === "TRIM") {
    // Selling decision: lower price now = saved, higher = missed
    if (Math.abs(pct) < 1) return { pct, outcome: "flat" };
    return { pct, outcome: pct < 0 ? "saved" : "missed" };
  }
  // BUY-like
  if (Math.abs(pct) < 1) return { pct, outcome: "flat" };
  return { pct, outcome: pct > 0 ? "winning" : "losing" };
}

async function enrich(decisions: Decision[]): Promise<Decision[]> {
  const prices = await readLivePrices();
  return decisions.map((d) => {
    const cur = prices[d.ticker.toUpperCase()];
    if (cur === undefined || d.price === undefined) {
      return { ...d, outcome: cur === undefined ? "exited" : undefined };
    }
    const { pct, outcome } = classify(d.action, d.price, cur);
    return { ...d, currentPrice: cur, sinceDecisionPct: pct, outcome };
  });
}

async function write(data: { decisions: Decision[] }) {
  await writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  try {
    const data = await read();
    return NextResponse.json({ decisions: await enrich(data.decisions) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ decisions: [], error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body?.ticker || !body?.action) {
    return NextResponse.json({ error: "ticker + action required" }, { status: 400 });
  }
  const data = await read();
  data.decisions.unshift({
    id: `d${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    action: String(body.action).toUpperCase(),
    ticker: String(body.ticker).toUpperCase(),
    qty: body.qty ? Number(body.qty) : undefined,
    price: body.price ? Number(body.price) : undefined,
    rationale: String(body.rationale || ""),
    verdict: "pending",
    reviewAt: body.reviewAt || undefined,
    note: "",
  });
  await write(data);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const data = await read();
  const d = data.decisions.find((x) => x.id === id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (body.verdict) d.verdict = body.verdict;
  if (body.note !== undefined) d.note = String(body.note);
  await write(data);
  return NextResponse.json({ ok: true });
}
