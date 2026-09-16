import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XRAY_FILE = path.join(MEMORY_DIR, "mf_xray.json");

export async function GET() {
  try {
    const raw = await readFile(XRAY_FILE, "utf8");
    const xray = JSON.parse(raw) as unknown;
    return NextResponse.json({ xray });
  } catch (err: unknown) {
    // Missing file is the normal "no x-ray yet" state — return null cleanly.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return NextResponse.json({ xray: null });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ xray: null, error: msg }, { status: 500 });
  }
}
