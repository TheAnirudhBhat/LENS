import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { ANALYSIS_FILE } from "@/lib/paths";

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(ANALYSIS_FILE, "utf8"),
      stat(ANALYSIS_FILE),
    ]);
    const data = JSON.parse(content);
    return NextResponse.json({ data, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ data: null, error: msg }, { status: 404 });
  }
}
