import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { MUTUAL_FUNDS_FILE } from "@/lib/paths";
import { parseMutualFunds } from "@/lib/parsers";
import { fetchAllNAVs } from "@/lib/mfapi";
import { withinMs, PAINT_BUDGET_MS } from "@/lib/timeoutRace";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";

type MFSummary = ReturnType<typeof parseMutualFunds>;

/** Overlay live mfapi.in NAVs onto the stored summary (new object, no mutation).
 *  Best-effort — on failure or unmapped ticker, the stored NAV is kept. */
async function enrichMfNavs(summary: MFSummary): Promise<MFSummary> {
  try {
    const navs = await fetchAllNAVs();
    const byTicker = new Map(navs.map((n) => [n.ticker, n]));
    let totalLiveValue = 0;
    const entries = summary.entries.map((e) => {
      const live = e.ticker ? byTicker.get(e.ticker) : undefined;
      if (!live) {
        totalLiveValue += e.value || 0;
        return e;
      }
      const value = Number((live.nav * e.units).toFixed(2));
      const pnlPct =
        e.invested && e.invested > 0
          ? Number((((value - e.invested) / e.invested) * 100).toFixed(2))
          : e.pnlPct;
      totalLiveValue += value;
      return { ...e, nav: live.nav, value, pnlPct };
    });
    const totalPnLPct =
      summary.totalInvested && summary.totalInvested > 0
        ? Number((((totalLiveValue - summary.totalInvested) / summary.totalInvested) * 100).toFixed(2))
        : summary.totalPnLPct;
    return { ...summary, entries, totalValue: Number(totalLiveValue.toFixed(2)), totalPnLPct };
  } catch (navErr) {
    console.warn(
      "[mutualfunds] mfapi enrichment failed:",
      navErr instanceof Error ? navErr.message : String(navErr)
    );
    return summary;
  }
}

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(MUTUAL_FUNDS_FILE, "utf8"),
      stat(MUTUAL_FUNDS_FILE),
    ]);
    const summary = parseMutualFunds(content);
    // Cap the paint: live NAV enrichment if it lands in PAINT_BUDGET_MS, else
    // stored summary (the fetch keeps warming the 60s NAV cache for next time).
    const enriched = await withinMs(enrichMfNavs(summary), PAINT_BUDGET_MS, summary);

    return NextResponse.json({ summary: enriched, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { summary: { entries: [] }, error: msg },
      { status: 404 }
    );
  }
}
