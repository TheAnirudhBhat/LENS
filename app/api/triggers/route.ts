import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { TRIGGERS_FILE } from "@/lib/paths";

type TriggerItem = {
  taskId: string;
  ticker?: string;
  severity?: "low" | "med" | "high";
  mechanism: string;
};

type TriggersFile = {
  firedAt: string;
  items: TriggerItem[];
};

const EMPTY: TriggersFile = { firedAt: "", items: [] };

export async function GET() {
  try {
    const raw = await readFile(TRIGGERS_FILE, "utf8");
    const json = JSON.parse(raw) as Partial<TriggersFile>;
    const items = Array.isArray(json.items) ? json.items : [];
    return NextResponse.json({
      firedAt: typeof json.firedAt === "string" ? json.firedAt : "",
      items,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Missing file is the normal "no triggers" state — return empty cleanly.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return NextResponse.json(EMPTY);
    return NextResponse.json({ ...EMPTY, error: msg }, { status: 500 });
  }
}
