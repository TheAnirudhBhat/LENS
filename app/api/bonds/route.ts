import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { BONDS_FILE, SNAPSHOT_FILE } from "@/lib/paths";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";

type BondPos = {
  isin?: string;
  status?: string;
  kiteTicker?: string;
  currentINR?: number;
  units?: number;
  [k: string]: unknown;
};

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(BONDS_FILE, "utf8"),
      stat(BONDS_FILE),
    ]);
    const data = JSON.parse(content) as { positions?: BondPos[] };

    // Bonds transferred to the Kite demat keep their descriptive fields here
    // (issuer, coupon, maturity) but are VALUED in the IN snapshot. Join the
    // live snapshot value/qty onto those rows by kiteTicker so the Bonds tab
    // can show the whole bond book — Stable Money actives + Kite demat — while
    // the Indian-equity tab excludes them (role debt-equiv).
    try {
      const snap = JSON.parse(await readFile(SNAPSHOT_FILE, "utf8")) as {
        holdings?: { ticker: string; qty?: number; value?: number; ltp?: number }[];
      };
      const byTicker = new Map(
        (snap.holdings ?? []).map((h) => [h.ticker.toUpperCase(), h])
      );
      for (const p of data.positions ?? []) {
        if (p.status === "transferred" && p.kiteTicker) {
          const live = byTicker.get(p.kiteTicker.toUpperCase());
          if (live) {
            p.currentINR = live.value;
            p.units = live.qty ?? p.units;
          }
        }
      }
    } catch {
      // snapshot missing — serve the bonds file as-is
    }

    return NextResponse.json({ data, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { data: null, error: msg },
      { status: 404 }
    );
  }
}
