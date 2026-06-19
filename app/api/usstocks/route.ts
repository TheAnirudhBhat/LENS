import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { US_STOCKS_FILE } from "@/lib/paths";
import { USStocksDataSchema, parseOrThrow } from "@/lib/schemas";

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(US_STOCKS_FILE, "utf8"),
      stat(US_STOCKS_FILE),
    ]);
    const raw = JSON.parse(content);
    const data = parseOrThrow(USStocksDataSchema, raw, "usstocks");
    return NextResponse.json({ data, mtime: st.mtime.toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSchema = msg.startsWith("[usstocks]");
    if (isSchema) console.error(msg);
    return NextResponse.json(
      { data: null, error: msg },
      { status: isSchema ? 500 : 404 }
    );
  }
}
