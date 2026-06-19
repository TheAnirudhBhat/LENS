import { NextResponse } from "next/server";
import { generateSession } from "@/lib/kite";

function describeError(err: unknown) {
  if (err instanceof Error) {
    return { msg: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5) };
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    return {
      msg: String(obj.message ?? obj.error_type ?? obj.error ?? "(no message)"),
      raw: obj,
    };
  }
  return { msg: String(err) };
}

async function doExchange(token: string) {
  try {
    const session = await generateSession(token);
    return NextResponse.json({ ok: true, user_name: session.user_name, expires_at: session.expires_at });
  } catch (err: unknown) {
    const info = describeError(err);
    console.error("[kite exchange]", info);
    return NextResponse.json({ ok: false, ...info }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "pass ?token=<request_token>" }, { status: 400 });
  }
  return doExchange(token);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  return doExchange(token);
}
