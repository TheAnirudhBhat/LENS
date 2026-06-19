import { NextResponse } from "next/server";
import { getHoldings } from "@/lib/kite";

function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    return String(obj.message ?? obj.error_type ?? JSON.stringify(err));
  }
  return String(err);
}

export async function GET() {
  try {
    const holdings = await getHoldings();
    return NextResponse.json({ data: holdings, fetchedAt: new Date().toISOString() });
  } catch (err: unknown) {
    return NextResponse.json({ data: null, error: errToString(err) }, { status: 500 });
  }
}
