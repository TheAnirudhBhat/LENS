import { NextResponse } from "next/server";
import { buildBook } from "@/lib/valuation";
import { loadProfile, defaultProfile, resolveRoleTargets } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The canonical portfolio Book — the single source of truth for every money
 * figure. Overview, Allocation, the silo tabs, score, sync and the drawer all
 * project this. See lib/valuation.ts.
 */
export async function GET() {
  try {
    const { profile } = await loadProfile();
    const roleTargets = resolveRoleTargets(profile ?? defaultProfile());
    const book = await buildBook({ roleTargets });
    return NextResponse.json(book);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
