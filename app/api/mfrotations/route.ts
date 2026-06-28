import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";
import { MFRotationsFileSchema, parseOrThrow } from "@/lib/schemas";

const FILE = path.join(MEMORY_DIR, "project_mf_rotations.json");

export async function GET() {
  try {
    const raw = JSON.parse(await readFile(FILE, "utf8"));
    const data = parseOrThrow(MFRotationsFileSchema, raw, "mfrotations");
    return NextResponse.json({ rotations: data.rotations });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSchema = msg.startsWith("[mfrotations]");
    if (isSchema) console.error(msg);
    return NextResponse.json(
      { rotations: [], error: msg },
      { status: isSchema ? 500 : 404 }
    );
  }
}
