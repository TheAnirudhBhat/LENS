import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { WATCHLIST_FILE } from "@/lib/paths";
import { parseWatchlist } from "@/lib/parsers";

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(WATCHLIST_FILE, "utf8"),
      stat(WATCHLIST_FILE),
    ]);
    const entries = parseWatchlist(content);
    return NextResponse.json({ entries, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ entries: [], error: msg }, { status: 404 });
  }
}
