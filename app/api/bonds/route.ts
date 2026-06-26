import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { BONDS_FILE } from "@/lib/paths";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(BONDS_FILE, "utf8"),
      stat(BONDS_FILE),
    ]);
    const data = JSON.parse(content);
    return NextResponse.json({ data, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { data: null, error: msg },
      { status: 404 }
    );
  }
}
