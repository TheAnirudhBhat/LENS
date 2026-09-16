import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { PORTFOLIO_HISTORY_FILE } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAIL = 35;

type HistoryPoint = {
  date: string;
  inEquity: number | null;
  bonds: number | null;
  mf: number | null;
  us: number | null;
  total: number | null;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Entries vary across time:
// - oldest:  { date, cashInjection, withdrawals, note } (no values)
// - mid:     { date, totalValue, cashInjection, withdrawals, nifty, note }
// - recent:  { date, totalValue, inValue, usValue, mfValue, nifty, fullMode, note }
// Recent snapshots carry bonds inside inValue with no split recorded, so
// bonds stays null unless the entry has an explicit bonds field.
function normalize(raw: Record<string, unknown>): HistoryPoint {
  return {
    date: String(raw.date),
    inEquity: num(raw.inValue),
    bonds: num(raw.bondsValue) ?? num(raw.bonds),
    mf: num(raw.mfValue),
    us: num(raw.usValue),
    total: num(raw.totalValue),
  };
}

export async function GET() {
  try {
    const content = await readFile(PORTFOLIO_HISTORY_FILE, "utf8");
    const parsed: unknown = JSON.parse(content);
    const entries =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { history?: unknown }).history)
        ? ((parsed as { history: unknown[] }).history.filter(
            (e): e is Record<string, unknown> =>
              !!e && typeof e === "object" && typeof (e as Record<string, unknown>).date === "string"
          ))
        : [];

    // File order is not chronological; ISO dates sort lexically.
    const history = entries
      .map(normalize)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-TAIL);

    const asOf = history.length > 0 ? history[history.length - 1].date : null;
    return NextResponse.json({ history, asOf });
  } catch (err: unknown) {
    if (err && typeof err === "object" && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ history: [], asOf: null });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "history", message: msg }, { status: 500 });
  }
}
