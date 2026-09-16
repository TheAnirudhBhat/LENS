import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { STRATEGY_FILE } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the user's strategy as markdown text.
 * - strategy.md present → { strategy: "<markdown>" }
 * - absent (fresh install) → { strategy: null }  (UI renders a generic template)
 * - other read errors → 500 (fail loudly, don't swallow).
 */
export async function GET() {
  try {
    let strategy: string | null = null;
    try {
      strategy = await readFile(STRATEGY_FILE, "utf8");
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") throw err;
    }
    return NextResponse.json({ strategy });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "strategy", message: msg },
      { status: 500 }
    );
  }
}
