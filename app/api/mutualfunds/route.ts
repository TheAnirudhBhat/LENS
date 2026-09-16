import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { MUTUAL_FUNDS_FILE } from "@/lib/paths";
import { parseMutualFunds } from "@/lib/parsers";
import { enrichMF } from "@/lib/enrich";
import { withinMs, PAINT_BUDGET_MS } from "@/lib/timeoutRace";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(MUTUAL_FUNDS_FILE, "utf8"),
      stat(MUTUAL_FUNDS_FILE),
    ]);
    const summary = parseMutualFunds(content);
    // Cap the paint: live NAV enrichment if it lands in PAINT_BUDGET_MS, else
    // stored summary (the fetch keeps warming the 60s NAV cache for next time).
    const enriched = await withinMs(enrichMF(summary), PAINT_BUDGET_MS, summary);

    return NextResponse.json({ summary: enriched, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { summary: { entries: [] }, error: msg },
      { status: 404 }
    );
  }
}
