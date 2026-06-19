import { NextResponse } from "next/server";
import { getStatus } from "@/lib/indmoney";

/** Returns INDmoney connection status. UI polls this after kicking off login. */
export async function GET() {
  const s = await getStatus();
  return NextResponse.json(s);
}
