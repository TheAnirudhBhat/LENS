import { NextResponse } from "next/server";
import { loadAllocation } from "@/lib/allocation";
import { loadProfile, defaultProfile, resolveRoleTargets } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { profile } = await loadProfile();
    const data = await loadAllocation(resolveRoleTargets(profile ?? defaultProfile()));
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
