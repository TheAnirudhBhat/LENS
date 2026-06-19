import { NextResponse } from "next/server";
import { getLoginURL } from "@/lib/kite";

/** Redirects the browser to Kite's OAuth page. After login, Kite redirects
 *  back to /api/kite/callback?request_token=...&action=login.
 */
export async function GET() {
  try {
    const url = await getLoginURL();
    return NextResponse.redirect(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
