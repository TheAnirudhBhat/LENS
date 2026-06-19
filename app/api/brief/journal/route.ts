import { NextResponse } from "next/server";
import { readFile, writeFile, stat } from "node:fs/promises";
import { BRIEF_JOURNAL_FILE } from "@/lib/paths";

type JournalEntry = {
  at: string;
  date: string;
  capital?: { amount?: number; note?: string };
  urgentReviewed?: number;
  totalValue?: number;
  todayMovePct?: number;
  regime?: string;
  userNote?: string;
};

type JournalFile = {
  note: string;
  entries: JournalEntry[];
};

const DEFAULT_NOTE =
  "Daily brief journal. Each entry captures the state at the time the brief was completed.";

// Defensive parse — returns entries array even if file is empty or malformed.
// Mirrors the POST handler's tolerance so a truncated file doesn't 404 the GET.
function safeParseEntries(raw: string): JournalEntry[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return (parsed as { entries: JournalEntry[] }).entries;
    }
    return [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(BRIEF_JOURNAL_FILE, "utf8"),
      stat(BRIEF_JOURNAL_FILE),
    ]);
    const entries = safeParseEntries(content);
    const sorted = [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return NextResponse.json({
      data: { entries: sorted.slice(0, 30) },
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
      capital?: { amount?: number; note?: string };
      urgentReviewed?: number;
      totalValue?: number;
      todayMovePct?: number;
      regime?: string;
      userNote?: string;
    };

    let data: JournalFile;
    try {
      const raw = await readFile(BRIEF_JOURNAL_FILE, "utf8");
      data = raw.trim()
        ? (JSON.parse(raw) as JournalFile)
        : { note: DEFAULT_NOTE, entries: [] };
    } catch {
      data = { note: DEFAULT_NOTE, entries: [] };
    }
    if (!data.note) data.note = DEFAULT_NOTE;
    if (!Array.isArray(data.entries)) data.entries = [];

    const now = new Date();
    const entry: JournalEntry = {
      at: now.toISOString(),
      date: now.toISOString().slice(0, 10),
    };
    if (body.capital !== undefined) entry.capital = body.capital;
    if (typeof body.urgentReviewed === "number") entry.urgentReviewed = body.urgentReviewed;
    if (typeof body.totalValue === "number") entry.totalValue = body.totalValue;
    if (typeof body.todayMovePct === "number") entry.todayMovePct = body.todayMovePct;
    if (typeof body.regime === "string") entry.regime = body.regime;
    if (typeof body.userNote === "string") entry.userNote = body.userNote;

    data.entries.push(entry);

    await writeFile(BRIEF_JOURNAL_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
    return NextResponse.json({ ok: true, entry });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
