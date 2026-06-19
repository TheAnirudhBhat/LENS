import { NextResponse } from "next/server";
import { loadProfile } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { profile, isDemo } = await loadProfile();
    return NextResponse.json({ profile, isDemo });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "profile", message: msg },
      { status: 500 }
    );
  }
}
