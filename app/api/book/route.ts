import { NextResponse } from "next/server";
import { buildBook } from "@/lib/book/builder";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await buildBook();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
