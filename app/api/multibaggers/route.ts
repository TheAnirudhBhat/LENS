import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";
import { parseMultibaggers } from "@/lib/parsers";

const MB_DIR = path.join(MEMORY_DIR, "multibagger_scans");

export async function GET() {
  try {
    const files = await readdir(MB_DIR);
    const latest = files.filter((f) => f.endsWith(".md")).sort().pop();
    if (!latest) {
      return NextResponse.json({ regime: null, entries: [], mtime: null });
    }
    const filePath = path.join(MB_DIR, latest);
    const [content, st] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath),
    ]);
    const parsed = parseMultibaggers(content);
    return NextResponse.json({
      ...parsed,
      mtime: st.mtime.toISOString(),
      date: latest.replace(".md", ""),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ regime: null, entries: [], error: msg }, { status: 200 });
  }
}
