import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { WATCHLIST_FILE } from "@/lib/paths";

export const runtime = "nodejs";

type DeleteBody = { ticker: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as DeleteBody;
  if (!body?.ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const target = body.ticker.toUpperCase().trim();

  try {
    const current = await readFile(WATCHLIST_FILE, "utf8");
    const activeMarker = "## Active Watchlist";
    const passedMarker = "## Passed";

    const aIdx = current.indexOf(activeMarker);
    if (aIdx === -1) {
      return NextResponse.json(
        { error: "could not locate Active Watchlist section" },
        { status: 500 }
      );
    }
    const pIdx = current.indexOf(passedMarker);
    const sectionEnd = pIdx !== -1 ? pIdx : current.length;
    const before = current.slice(0, aIdx);
    const section = current.slice(aIdx, sectionEnd);
    const after = current.slice(sectionEnd);

    // Split by H3 ### blocks and drop the one whose ticker matches
    const blocks = section.split(/^(### .*)$/m);
    // Pattern: [intro, '### TICKER — ...', body, '### TICKER2 — ...', body, ...]
    const out: string[] = [blocks[0]];
    for (let i = 1; i < blocks.length; i += 2) {
      const heading = blocks[i] || "";
      const body = blocks[i + 1] ?? "";
      const m = heading.match(/^###\s+([A-Z0-9_]+)/);
      if (m && m[1].toUpperCase() === target) continue; // skip this block
      out.push(heading, body);
    }
    const newSection = out.join("");
    if (newSection === section) {
      return NextResponse.json(
        { error: `${target} not found in active watchlist` },
        { status: 404 }
      );
    }

    await writeFile(WATCHLIST_FILE, before + newSection + after, "utf8");
    return NextResponse.json({ ok: true, ticker: target });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
