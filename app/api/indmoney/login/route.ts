import { NextResponse } from "next/server";
import { startLogin } from "@/lib/indmoney";

/** Opens a headed Playwright Chrome via the indian-broker MCP server.
 *  The user logs into INDmoney manually; session is captured by the MCP.
 *  UI polls /api/indmoney/status to detect completion.
 */
export async function POST() {
  try {
    const r = await startLogin();
    return NextResponse.json({ ok: true, message: r.message });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
