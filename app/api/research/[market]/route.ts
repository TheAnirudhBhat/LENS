import { NextResponse } from "next/server";
import { loadResearch } from "@/lib/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ market: string }> }
) {
  const { market } = await ctx.params;
  if (market !== "us" && market !== "mf") {
    return NextResponse.json({ error: "bad market" }, { status: 400 });
  }
  try {
    const { entries, isDemo } = await loadResearch(market);
    return NextResponse.json({ entries, isDemo });
  } catch (e) {
    return NextResponse.json(
      {
        error: "research",
        message: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 }
    );
  }
}
