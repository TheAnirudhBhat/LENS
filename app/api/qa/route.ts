import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { buildBook } from "@/lib/valuation";
import { lastCompletedNavDay } from "@/lib/enrich";
import { parseMutualFunds } from "@/lib/parsers";
import { DECISIONS_FILE, MUTUAL_FUNDS_FILE, SNAPSHOT_FILE } from "@/lib/paths";

// Standing QA over the valuation chain. lib/valuation.ts buildBook() is the
// single source of truth; anything that disagrees with it is drift. The sync
// skill calls this as its final gate — a sync that leaves issues here is not
// done. Born 2026-08-05 after the MF table was refreshed in its summary line
// but not its data rows, silently understating net worth by ~₹39K.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Full budget: QA wants the true live book, not the 350ms paint fallback.
    const book = await buildBook({ budgetMs: 5000 });
    const issues: string[] = [];

    // 1. Buckets must sum to net worth (catches double-count / omission).
    const sum = Object.values(book.byAssetClass).reduce((s, b) => s + b.value, 0);
    if (Math.abs(sum - book.totals.netWorth) > 1) {
      issues.push(
        `Net worth ${Math.round(book.totals.netWorth)} != bucket sum ${Math.round(sum)}`
      );
    }

    // 2. Snapshot's own header vs the sum of its holdings (stale-summary drift).
    try {
      const snap = JSON.parse(await readFile(SNAPSHOT_FILE, "utf8"));
      const snapSum = (snap.holdings ?? []).reduce(
        (s: number, h: { value?: number }) => s + (h.value ?? 0),
        0
      );
      if (snap.totalValue != null && Math.abs(snap.totalValue - snapSum) > 1) {
        issues.push(
          `snapshot.totalValue ${Math.round(snap.totalValue)} disagrees with its holdings sum ${Math.round(snapSum)}`
        );
      }
    } catch {
      issues.push("latest_snapshot.json unreadable");
    }

    // 2b. MF served from stored NAVs = the number that flapped ₹39K on
    // 2026-08-05. Usually mfapi cold-cache after a server restart; the caller
    // should re-curl once (cache warms) before treating this as real.
    // "Stored" is only a problem when the store actually lags: NAVs publish on
    // business days only, so on a weekend or Monday morning the stored Friday
    // NAV is the latest official NAV — raw provenance, but not stale. Compare
    // the file's own date against the last completed NAV business day and
    // stay quiet when they match (unparseable date = flag, conservatively).
    if (book.provenance.MF === "raw") {
      const mfMd = await readFile(MUTUAL_FUNDS_FILE, "utf8").catch(() => "");
      const storedNavDate = parseMutualFunds(mfMd).asOf?.match(
        /\d{4}-\d{2}-\d{2}/
      )?.[0];
      const lastNavDay = lastCompletedNavDay();
      if (!storedNavDate || storedNavDate < lastNavDay) {
        issues.push(
          `MF NAVs are STORED, not live, and lag the last NAV business day (stored ${storedNavDate ?? "unknown"} < latest ${lastNavDay}; mfapi slow/cold) — retry /api/qa once`
        );
      }
    }

    // 3. No silently-empty silos.
    for (const k of ["in-equity", "us-equity", "mf"] as const) {
      if (book.byAssetClass[k].value <= 0)
        issues.push(`${k} bucket is zero — source file parse likely broken`);
    }

    // 4. Unclassified roles (drift math silently excludes their targets).
    const uncls = book.byRole.find((r) => r.key === "unclassified");
    if (uncls && uncls.holdings.length) {
      issues.push(
        `Unclassified roles: ${uncls.holdings.map((h) => h.ticker).join(", ")}`
      );
    }

    // 5. Sanity: no bucket at >5x its cost basis (units/currency error tell).
    for (const [k, b] of Object.entries(book.byAssetClass)) {
      if (b.invested > 0 && b.value / b.invested > 5)
        issues.push(`${k} value >5x cost — suspect units or currency error`);
    }

    // Rule warnings — portfolio work, not data integrity. Never flip `ok`
    // (ok is the sync's done-gate). Rule 10: every decision since the v2
    // rulebook cites a rule; rule 5: BUY/ADD carry an exit condition.
    const warnings: string[] = [];
    try {
      const dec = JSON.parse(await readFile(DECISIONS_FILE, "utf8")) as {
        decisions?: Array<{ id?: string; date?: string; action?: string; rule?: string; exitIf?: string }>;
      };
      const since = "2026-09-15";
      const missing = (dec.decisions ?? [])
        .filter((d) => String(d.date ?? "") >= since)
        .filter((d) => !d.rule || (/^(BUY|ADD)$/i.test(String(d.action ?? "")) && !d.exitIf))
        .map((d) => String(d.id));
      if (missing.length > 0) {
        warnings.push(`Rule 10: decisions since ${since} missing a rule slug or (for BUY/ADD) an exitIf — ${missing.join(", ")}`);
      }
    } catch {
      // decisions.json is optional on a fresh install
    }

    return NextResponse.json({
      ok: issues.length === 0,
      issues,
      warnings,
      totals: book.totals,
      byAssetClass: Object.fromEntries(
        Object.entries(book.byAssetClass).map(([k, b]) => [k, b.value])
      ),
      live: book.live,
      provenance: book.provenance,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, issues: [err instanceof Error ? err.message : String(err)] },
      { status: 500 }
    );
  }
}
