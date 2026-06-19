import { NextResponse } from "next/server";
import { loadPerTicker, type Market } from "@/lib/correlate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: Market[] = ["IN", "US", "MF", "BONDS"];

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("market");
  const market: Market | undefined = VALID.includes(raw as Market)
    ? (raw as Market)
    : undefined;

  try {
    const data = await loadPerTicker(decodeURIComponent(ticker), market);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
