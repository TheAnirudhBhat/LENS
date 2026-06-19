import { NextResponse } from "next/server";
import { readSession } from "@/lib/kite";

/** Returns whether a Kite session is currently valid (access_token present
 *  and not past expected expiry). Used by the UI to decide whether to show
 *  a "Connect Kite" button or live data.
 */
export async function GET() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ connected: false });
  }
  const expired = session.expires_at
    ? new Date(session.expires_at) < new Date()
    : false;
  return NextResponse.json({
    connected: !expired,
    user_name: session.user_name,
    user_id: session.user_id,
    expires_at: session.expires_at,
    expired,
  });
}
