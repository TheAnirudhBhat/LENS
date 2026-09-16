import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { PORTFOLIO_HISTORY_FILE } from "@/lib/paths";

type HistoryEntry = {
  date: string;
  totalValue?: number;
  cashInjection?: number;
  withdrawals?: number;
  nifty?: number;
  note?: string;
};

type HistoryFile = {
  note: string;
  history: HistoryEntry[];
};

const DEFAULT_NOTE =
  "Daily portfolio + Nifty 50 history. Each portfolio check appends one entry. cashInjection = fresh capital added that day (not a market gain); withdrawals = capital pulled out.";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { amount?: unknown; note?: unknown };
    const amount = typeof body.amount === "number" ? body.amount : NaN;
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json(
        { ok: false, error: "amount must be a finite non-negative number" },
        { status: 400 }
      );
    }
    const providedNote =
      typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    let data: HistoryFile;
    try {
      const raw = await readFile(PORTFOLIO_HISTORY_FILE, "utf8");
      data = raw.trim()
        ? (JSON.parse(raw) as HistoryFile)
        : { note: DEFAULT_NOTE, history: [] };
    } catch {
      data = { note: DEFAULT_NOTE, history: [] };
    }
    if (!data.note) data.note = DEFAULT_NOTE;
    if (!Array.isArray(data.history)) data.history = [];

    const date = new Date().toISOString().slice(0, 10);
    const fallbackNote = providedNote || "Capital logged via daily brief";
    const idx = data.history.findIndex((e) => e.date === date);
    let entry: HistoryEntry;
    if (idx >= 0) {
      const existing = data.history[idx];
      const prevInjection = typeof existing.cashInjection === "number" ? existing.cashInjection : 0;
      const prevNote = existing.note ? existing.note + "; " : "";
      // Cap concatenated note to keep portfolio_history.json compact even on
      // many same-day re-submits.
      const combinedNote = (prevNote + fallbackNote).slice(0, 240);
      entry = {
        ...existing,
        cashInjection: prevInjection + amount,
        note: combinedNote,
      };
      data.history[idx] = entry;
    } else {
      entry = { date, cashInjection: amount, withdrawals: 0, note: fallbackNote };
      data.history.push(entry);
    }

    await writeFile(PORTFOLIO_HISTORY_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
    return NextResponse.json({ ok: true, entry });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
