import { NextResponse } from "next/server";
import { generateSession } from "@/lib/kite";

function describeError(err: unknown): { msg: string; raw: unknown } {
  if (err instanceof Error) return { msg: err.message, raw: { name: err.name, stack: err.stack?.split("\n").slice(0, 5) } };
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    const msg = String(obj.message ?? obj.error_type ?? obj.error ?? JSON.stringify(err));
    return { msg, raw: obj };
  }
  return { msg: String(err), raw: err };
}

/** Kite redirects here after the user authenticates with their PIN/TOTP.
 *  Query params: ?request_token=...&action=login&status=success
 *  We exchange request_token + api_secret for the long-form access_token,
 *  persist it to the session file, and redirect to the dashboard root.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestToken = url.searchParams.get("request_token");
  const status = url.searchParams.get("status");

  if (status !== "success" || !requestToken) {
    return NextResponse.json(
      { error: `Kite login failed: status=${status}, request_token present=${!!requestToken}` },
      { status: 400 }
    );
  }

  try {
    const session = await generateSession(requestToken);
    return NextResponse.redirect(
      new URL(`/?kite=connected&user=${encodeURIComponent(session.user_name ?? "")}`, req.url)
    );
  } catch (err: unknown) {
    const { msg, raw } = describeError(err);
    console.error("[kite callback]", msg, raw);
    return NextResponse.json({ error: msg, debug: raw, requestToken: requestToken.slice(0, 8) + "..." }, { status: 500 });
  }
}
