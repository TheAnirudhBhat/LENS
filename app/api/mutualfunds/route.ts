import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { MUTUAL_FUNDS_FILE } from "@/lib/paths";
import { parseMutualFunds } from "@/lib/parsers";
import { fetchAllNAVs } from "@/lib/mfapi";

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(MUTUAL_FUNDS_FILE, "utf8"),
      stat(MUTUAL_FUNDS_FILE),
    ]);
    const summary = parseMutualFunds(content);

    // Enrich with live NAVs from mfapi.in. Best-effort — if the call fails or
    // a ticker isn't mapped, keep the stored NAV from the markdown.
    try {
      const navs = await fetchAllNAVs();
      const byTicker = new Map(navs.map((n) => [n.ticker, n]));
      let totalLiveValue = 0;
      summary.entries = summary.entries.map((e) => {
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
      summary.totalValue = Number(totalLiveValue.toFixed(2));
      if (summary.totalInvested && summary.totalInvested > 0) {
        summary.totalPnLPct = Number(
          (((totalLiveValue - summary.totalInvested) / summary.totalInvested) * 100).toFixed(2)
        );
      }
    } catch (navErr) {
      // mfapi unreachable — fall through with stored NAVs.
      console.warn(
        "[mutualfunds] mfapi enrichment failed:",
        navErr instanceof Error ? navErr.message : String(navErr)
      );
    }

    return NextResponse.json({ summary, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { summary: { entries: [] }, error: msg },
      { status: 404 }
    );
  }
}
