import { NextResponse } from "next/server";
import { fetchAllNAVs } from "@/lib/mfapi";

/** Returns latest NAVs for all schemes in the held book. Used by the MF tab
 *  and the snapshot enrichment path. ~5-13 parallel requests to mfapi.in,
 *  typical latency 500ms-1.5s. No auth required.
 */
export async function GET() {
  try {
    const navs = await fetchAllNAVs();
    return NextResponse.json({ navs, fetchedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ navs: [], error: msg }, { status: 500 });
  }
}
