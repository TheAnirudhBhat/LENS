import { NextResponse } from "next/server";
import { readFile, writeFile, stat } from "node:fs/promises";
import { BRIEF_ACTIONS_FILE } from "@/lib/paths";

type Status = "acted" | "snoozed";

type Action = {
  itemId: string;
  status: Status;
  at: string;
  until?: string;
  note?: string;
};

type ActionsFile = {
  note: string;
  actions: Action[];
};

const DEFAULT_NOTE =
  "Per-item action state for items shown in the daily brief. itemId = stable identifier per urgent flag. status: 'acted' | 'snoozed'. until: ISO date if snoozed.";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function readFileSafe(): Promise<ActionsFile> {
  try {
    const raw = await readFile(BRIEF_ACTIONS_FILE, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as ActionsFile) : null;
    if (!parsed) return { note: DEFAULT_NOTE, actions: [] };
    if (!parsed.note) parsed.note = DEFAULT_NOTE;
    if (!Array.isArray(parsed.actions)) parsed.actions = [];
    return parsed;
  } catch {
    return { note: DEFAULT_NOTE, actions: [] };
  }
}

function isLiveAction(a: Action, nowMs: number): boolean {
  if (a.status === "acted") return true;
  if (a.status === "snoozed" && a.until) {
    return new Date(a.until).getTime() > nowMs;
  }
  return false;
}

export async function GET() {
  try {
    const [raw, st] = await Promise.all([
      readFile(BRIEF_ACTIONS_FILE, "utf8"),
      stat(BRIEF_ACTIONS_FILE),
    ]);
    const parsed = raw.trim()
      ? (JSON.parse(raw) as ActionsFile)
      : { note: DEFAULT_NOTE, actions: [] };
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const nowMs = Date.now();
    const live = actions.filter((a) => isLiveAction(a, nowMs));
    return NextResponse.json({
      data: { actions: live },
      mtime: st.mtime.toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ data: null, error: msg }, { status: 404 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      itemId?: unknown;
      status?: unknown;
      note?: unknown;
    };
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const status = body.status;
    const note = typeof body.note === "string" ? body.note : undefined;

    if (!itemId) {
      return NextResponse.json(
        { ok: false, error: "itemId must be a non-empty string" },
        { status: 400 }
      );
    }
    if (status !== "acted" && status !== "snoozed" && status !== "clear") {
      return NextResponse.json(
        { ok: false, error: "status must be 'acted' | 'snoozed' | 'clear'" },
        { status: 400 }
      );
    }

    const data = await readFileSafe();
    const nowIso = new Date().toISOString();
    let action: Action | null = null;

    if (status === "clear") {
      data.actions = data.actions.filter((a) => a.itemId !== itemId);
    } else {
      action =
        status === "acted"
          ? { itemId, status: "acted", at: nowIso, note }
          : {
              itemId,
              status: "snoozed",
              at: nowIso,
              until: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
              note,
            };
      const idx = data.actions.findIndex((a) => a.itemId === itemId);
      if (idx >= 0) data.actions[idx] = action;
      else data.actions.push(action);
    }

    await writeFile(
      BRIEF_ACTIONS_FILE,
      JSON.stringify(data, null, 2) + "\n",
      "utf8"
    );
    return NextResponse.json({ ok: true, action });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
