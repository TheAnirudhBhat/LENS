import { NextResponse } from "next/server";
import { getLTP } from "@/lib/kite";

/** GET /api/kite/ltp?i=NSE:RELIANCE&i=NSE:TCS
 *  Returns the current LTPs for the requested instruments.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const instruments = url.searchParams.getAll("i");
  if (instruments.length === 0) {
    return NextResponse.json(
      { error: "pass instruments as ?i=NSE:TICKER&i=..." },
      { status: 400 }
    );
  }
  try {
    const ltps = await getLTP(instruments);
    return NextResponse.json({ data: ltps, fetchedAt: new Date().toISOString() });
  } catch (err: unknown) {
    let msg: string;
    if (err instanceof Error) msg = err.message;
    else if (typeof err === "object" && err !== null) {
      const obj = err as Record<string, unknown>;
      msg = String(obj.message ?? obj.error_type ?? JSON.stringify(err));
    } else msg = String(err);
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
