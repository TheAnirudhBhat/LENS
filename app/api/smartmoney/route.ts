import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { MEMORY_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SMART_MONEY_FILE = join(MEMORY_DIR, "smart_money.json");

export async function GET() {
  try {
    const raw = await readFile(SMART_MONEY_FILE, "utf8");
    return NextResponse.json({ smartMoney: JSON.parse(raw) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "ENOENT") {
      return NextResponse.json({ smartMoney: null });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "smartmoney", message: msg },
      { status: 500 }
    );
  }
}
