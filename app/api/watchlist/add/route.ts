import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { WATCHLIST_FILE } from "@/lib/paths";

export const runtime = "nodejs";

type AddBody = {
  ticker: string;
  company?: string;
  entryPrice?: number;
  thesis?: string;
  entryTrigger?: string;
  exitTrigger?: string;
  framework?: string;
  confidence?: string;
  sectorTailwind?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AddBody;
  if (!body?.ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const t = body.ticker.toUpperCase().trim();
  const today = new Date().toISOString().slice(0, 10);

  const block = [
    `### ${t} — ${body.company || t}`,
    `- **Added:** ${today}${body.entryPrice ? ` at ₹${body.entryPrice}` : ""}`,
    `- **Thesis:** ${body.thesis || "—"}`,
    `- **Entry trigger:** ${body.entryTrigger || "—"}`,
    `- **Exit trigger:** ${body.exitTrigger || "—"}`,
    `- **Framework fit:** ${body.framework || "—"}`,
    `- **Confidence:** ${body.confidence || "MEDIUM"}`,
    `- **Sector tailwind:** ${body.sectorTailwind || "—"}`,
    `- **Last news check:** ${today}`,
    "",
  ].join("\n");

  try {
    const current = await readFile(WATCHLIST_FILE, "utf8");
    const marker = "## Active Watchlist";
    const idx = current.indexOf(marker);
    if (idx === -1) {
      return NextResponse.json(
        { error: "could not locate '## Active Watchlist' section" },
        { status: 500 }
      );
    }
    // insert a blank line + block AFTER the marker line + its blank line
    const afterMarker = current.indexOf("\n", idx) + 1;
    const next = current.slice(0, afterMarker) + "\n" + block + current.slice(afterMarker);
    await writeFile(WATCHLIST_FILE, next, "utf8");
    return NextResponse.json({ ok: true, ticker: t });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
