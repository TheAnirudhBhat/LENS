import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MEMORY_DIR } from "@/lib/paths";

const FILE = path.join(MEMORY_DIR, "portfolio_history.json");

type HistoryRow = {
  date: string;
  totalValue: number;
  cashInjection?: number;
  withdrawals?: number;
  nifty: number;
  note?: string;
};

type Window = {
  label: string;
  fromDate: string;
  days: number;
  portfolioReturnPct: number;
  niftyReturnPct: number;
  alphaPct: number;
};

// Time-weighted return that nets out cash flows. Treats cashInjection as
// neutral (you can't claim a return on money you just added). Computed as
// the geometric chain of single-period returns where each period's return
// uses the prior end value as the base, after subtracting the *current*
// period's injection from the *current* period's end value.
function chainTWR(rows: HistoryRow[]): number {
  if (rows.length < 2) return 0;
  let chain = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const inj = cur.cashInjection ?? 0;
    const wd = cur.withdrawals ?? 0;
    // Adjust end value: remove fresh capital, add back any withdrawals
    const adjustedEnd = cur.totalValue - inj + wd;
    const periodReturn = adjustedEnd / prev.totalValue;
    if (Number.isFinite(periodReturn) && periodReturn > 0) {
      chain *= periodReturn;
    }
  }
  return (chain - 1) * 100;
}

function niftyReturn(rows: HistoryRow[]): number {
  if (rows.length < 2) return 0;
  return ((rows[rows.length - 1].nifty - rows[0].nifty) / rows[0].nifty) * 100;
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function buildWindow(
  rows: HistoryRow[],
  label: string,
  filter: (rows: HistoryRow[]) => HistoryRow[]
): Window | null {
  const slice = filter(rows);
  if (slice.length < 2) return null;
  const portfolioReturnPct = chainTWR(slice);
  const niftyReturnPct = niftyReturn(slice);
  return {
    label,
    fromDate: slice[0].date,
    days: daysBetween(slice[0].date, slice[slice.length - 1].date),
    portfolioReturnPct,
    niftyReturnPct,
    alphaPct: portfolioReturnPct - niftyReturnPct,
  };
}

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(FILE, "utf8"),
      stat(FILE),
    ]);
    const data = JSON.parse(content) as { history: HistoryRow[] };
    const rows = [...data.history].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (rows.length === 0) {
      return NextResponse.json({
        data: { hasData: false },
        mtime: st.mtime.toISOString(),
      });
    }

    const last = rows[rows.length - 1];
    const lastDate = new Date(last.date);

    // Today (1d): need at least 2 rows; last vs prior
    const oneDay = rows.length >= 2 ? buildWindow(rows, "today", (r) => r.slice(-2)) : null;

    // 1 week
    const oneWeek = buildWindow(rows, "1 week", (r) => {
      const cutoff = new Date(lastDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      return r.filter((x) => new Date(x.date) >= cutoff);
    });

    // 1 month
    const oneMonth = buildWindow(rows, "1 month", (r) => {
      const cutoff = new Date(lastDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      return r.filter((x) => new Date(x.date) >= cutoff);
    });

    // since first row (full history)
    const all = buildWindow(rows, "since start", (r) => r);

    const windows: Window[] = [oneDay, oneWeek, oneMonth, all].filter(
      (w): w is Window => w !== null
    );

    return NextResponse.json({
      data: {
        hasData: true,
        rowCount: rows.length,
        firstDate: rows[0].date,
        lastDate: last.date,
        windows,
      },
      mtime: st.mtime.toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ data: null, error: msg }, { status: 404 });
  }
}
