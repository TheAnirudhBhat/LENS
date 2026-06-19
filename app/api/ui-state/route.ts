import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { UI_STATE_FILE } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await readFile(UI_STATE_FILE, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({}); // no file yet → empty state
  }
}

export async function POST(req: Request) {
  try {
    const patch = await req.json();
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await readFile(UI_STATE_FILE, "utf8"));
    } catch {
      /* no file yet */
    }
    const next = { ...current, ...patch };
    await mkdir(dirname(UI_STATE_FILE), { recursive: true });
    await writeFile(UI_STATE_FILE, JSON.stringify(next, null, 2));
    return NextResponse.json(next);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "ui-state", message: msg }, { status: 500 });
  }
}
