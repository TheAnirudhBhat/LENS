import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { BACKTEST_FILE } from "@/lib/paths";

/**
 * Serves the combined W3 backtest artifact written by
 * scripts/backtest/run_all.py as { backtest: <json>, mtime }.
 *
 * Lives beside /api/backtest, which keeps its legacy { data, mtime }
 * response (consumed by AnalysisTab's BacktestCard in app/page.tsx).
 * If the external file is missing, or still holds the older v1
 * "logical_backtest" artifact, this returns { backtest: null } so the
 * Strategy Lab panel renders its empty state.
 */

function isRunAllShape(j: unknown): boolean {
  if (!j || typeof j !== "object") return false;
  const o = j as Record<string, unknown>;
  return Array.isArray(o.scorecard) && !!o.regimeGate && !!o.decisions;
}

export async function GET() {
  try {
    const [content, st] = await Promise.all([
      readFile(BACKTEST_FILE, "utf8"),
      stat(BACKTEST_FILE),
    ]);
    const json: unknown = JSON.parse(content);
    if (!isRunAllShape(json)) {
      return NextResponse.json({
        backtest: null,
        note: "backtest_results.json predates scripts/backtest/run_all.py; re-run it",
      });
    }
    return NextResponse.json({ backtest: json, mtime: st.mtime.toISOString() });
  } catch {
    return NextResponse.json(
      { backtest: null, error: "backtest results unavailable" },
      { status: 404 },
    );
  }
}
