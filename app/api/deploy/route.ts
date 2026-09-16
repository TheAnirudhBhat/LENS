import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";

const FILE = path.join(MEMORY_DIR, "deploy_recommendation.json");

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(FILE, "utf8"),
      stat(FILE),
    ]);
    return NextResponse.json({
      data: JSON.parse(content),
      mtime: st.mtime.toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ data: null, error: msg }, { status: 404 });
  }
}
