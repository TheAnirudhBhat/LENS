/**
 * POST /api/sync — deterministic refresh pipeline.
 *
 * Replaces the 80% of /portfolio-check that doesn't need LLM:
 *   Phase 1: Kite holdings pull
 *   Phase 2: LTP writeback to latest_snapshot.json
 *   Phase 2.8: Pass A (price triggers), C (auto-completion), E (lifetime audit), F (cap check)
 *   Phase 2.85: role drift via lib/allocation
 *   Phase 3: decisions append + history upsert (on qty deltas)
 *
 * Streams progress as NDJSON. Each line is one JSON event.
 * Final event: `{stage: "summary", data: {...}}`.
 *
 * What this does NOT do (still needs chat-based /portfolio-check):
 *   - INDmoney US + MF pulls (Playwright session lives in MCP)
 *   - Phase 2.6 news tagging (LLM)
 *   - Phase 2.7 earnings outlook (LLM)
 *   - Phase 3.5 manual task sweep (user prompt)
 */

import { readFile, writeFile } from "node:fs/promises";
import { getHoldings } from "@/lib/kite";
import { loadAllocation, ROLE_TARGET } from "@/lib/allocation";
import { parseMutualFunds } from "@/lib/parsers";
import {
  SNAPSHOT_FILE,
  TASKS_FILE,
  DECISIONS_FILE,
  PORTFOLIO_HISTORY_FILE,
  TRIGGERS_FILE,
  US_STOCKS_FILE,
  MUTUAL_FUNDS_FILE,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KiteHolding = {
  tradingsymbol: string;
  exchange: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
};

type SnapshotHolding = {
  ticker: string;
  qty: number;
  avgPrice?: number;
  ltp: number;
  value: number;
  weight?: number;
  pnlPct?: number;
  [key: string]: unknown;
};

type Snapshot = {
  asOf: string;
  // totalValue = IN book only (snapshot holdings sum, incl. bonds).
  // totalPortfolioValue = whole portfolio across silos (IN book + US + MF).
  totalValue: number;
  totalPortfolioValue?: number;
  equityValue?: number;
  bondsValue?: number;
  cash?: number;
  nifty?: { value: number | null; dayChangePct?: number | null };
  holdings: SnapshotHolding[];
  [key: string]: unknown;
};

type Task = {
  id: string;
  heading: string;
  subheading: string;
  priority: "urgent" | "high" | "med" | "low";
  ticker?: string;
  asset?: string;
  actionType?: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
  [key: string]: unknown;
};

type Decision = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  qty: number;
  price: number;
  asset: string;
  rationale: string;
  verdict: string;
  reviewAt?: string;
};

type Event =
  | { stage: string; status: "running" }
  | { stage: string; status: "done"; ms: number; [k: string]: unknown }
  | { stage: string; status: "error"; ms: number; error: string }
  | { stage: "summary"; data: Record<string, unknown> };

// ────────────────────────────────────────────────────────────────────────────
// Pass A — Price-trigger detection
// Walks task subheadings for currency thresholds, compares against fresh LTPs.

const PRICE_REGEX = /(?:₹|\$|Rs\.?\s*)([\d,]+(?:\.\d+)?)/g;
const TICKER_SUFFIX_REGEX = /-(NA|BE|EQ|BL|N1|N2|N3|N4)$/i;
const stripSuffix = (s: string) => s.replace(TICKER_SUFFIX_REGEX, "");

// Anchored threshold detection: extract (direction, number) PAIRS by walking
// the subheading and pairing each currency-tagged number with the nearest
// preceding direction keyword (within ~25 chars). This avoids the false
// positive of "below ₹372" being read as a downside stop when "₹372" is
// actually an upside exit target named just after the word "Pop ≥".

const DOWN_KEYWORDS = /\b(break|hard\s+cut|below|stop|drop|<)\b/i;
const UP_KEYWORDS = /\b(pop|rebound|above|target|breakout|exit\s+at|>)\b/i;
const NEAR_NUM_RE = /(?:(\bbreak\b|\bhard\s+cut\b|\bbelow\b|\bstop\b|\bdrop\b|<|\bpop\b|\brebound\b|\babove\b|\btarget\b|\bbreakout\b|\bexit\s+at\b|>|≥|≤)\s*[₹$]?\s*([\d,]+(?:\.\d+)?))|(?:[₹$]\s*([\d,]+(?:\.\d+)?))/gi;

type Threshold = { value: number; direction: "up" | "down" | null };

function extractThresholds(sub: string): Threshold[] {
  const out: Threshold[] = [];
  const matches: Array<{ idx: number; keyword: string | null; value: number }> = [];
  let m: RegExpExecArray | null;
  NEAR_NUM_RE.lastIndex = 0;
  while ((m = NEAR_NUM_RE.exec(sub)) !== null) {
    const keyword = m[1] ?? null;
    const value = Number((m[2] ?? m[3] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    matches.push({ idx: m.index, keyword, value });
  }
  // For matches without a keyword, look backwards up to 25 chars for one.
  for (const mm of matches) {
    let direction: "up" | "down" | null = null;
    if (mm.keyword) {
      direction = UP_KEYWORDS.test(mm.keyword) ? "up" : DOWN_KEYWORDS.test(mm.keyword) ? "down" : null;
    } else {
      const window = sub.slice(Math.max(0, mm.idx - 25), mm.idx).toLowerCase();
      if (UP_KEYWORDS.test(window)) direction = "up";
      else if (DOWN_KEYWORDS.test(window)) direction = "down";
    }
    if (direction) out.push({ value: mm.value, direction });
  }
  return out;
}

function detectPriceTriggers(
  tasks: Task[],
  ltps: Map<string, number>
): Array<{ taskId: string; ticker: string; mechanism: string }> {
  const fired: Array<{ taskId: string; ticker: string; mechanism: string }> = [];
  for (const t of tasks) {
    if (t.done || !t.ticker) continue;
    const ltp = ltps.get(stripSuffix(t.ticker));
    if (ltp === undefined) continue;
    const thresholds = extractThresholds(t.subheading);
    if (thresholds.length === 0) continue;

    for (const thr of thresholds) {
      if (thr.direction === "down" && ltp < thr.value) {
        fired.push({
          taskId: t.id,
          ticker: t.ticker,
          mechanism: `${t.ticker} LTP ${formatPrice(ltp, t.ticker)} broke down through ${formatPrice(thr.value, t.ticker)}`,
        });
        break;
      }
      if (thr.direction === "up" && ltp > thr.value) {
        fired.push({
          taskId: t.id,
          ticker: t.ticker,
          mechanism: `${t.ticker} LTP ${formatPrice(ltp, t.ticker)} broke up through ${formatPrice(thr.value, t.ticker)}`,
        });
        break;
      }
    }
  }
  return fired;
}

function formatPrice(n: number, ticker?: string): string {
  // Heuristic — US tickers use $, IN tickers use ₹.
  const usLike = ticker && /^[A-Z]{1,5}$/.test(ticker) && !/27$|26$/.test(ticker);
  return usLike ? `$${n.toFixed(2)}` : `₹${n.toFixed(2)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Pass E — Lifetime audit
// urgent 2d, high 7d, med 30d, low indefinite.

const LIFETIME_DAYS: Record<Task["priority"], number | null> = {
  urgent: 2,
  high: 7,
  med: 30,
  low: null,
};

function detectOverdue(tasks: Task[], today: Date): Array<{ taskId: string; daysOpen: number; priority: string }> {
  const overdue: Array<{ taskId: string; daysOpen: number; priority: string }> = [];
  for (const t of tasks) {
    if (t.done) continue;
    const lifetime = LIFETIME_DAYS[t.priority];
    if (lifetime === null) continue;
    const created = new Date(t.createdAt);
    const daysOpen = Math.floor((today.getTime() - created.getTime()) / 86400000);
    if (daysOpen > lifetime) {
      overdue.push({ taskId: t.id, daysOpen, priority: t.priority });
    }
  }
  return overdue;
}

// ────────────────────────────────────────────────────────────────────────────
// Pass C — Completion detection (qty delta vs actionType)

function detectCompletions(
  tasks: Task[],
  priorQty: Map<string, number>,
  freshQty: Map<string, number>
): Array<{ taskId: string; ticker: string; delta: number }> {
  const completions: Array<{ taskId: string; ticker: string; delta: number }> = [];
  for (const t of tasks) {
    if (t.done || !t.ticker) continue;
    if (!t.actionType || !["buy", "sell", "trim", "add", "switch"].includes(t.actionType)) continue;
    const tk = stripSuffix(t.ticker);
    const prev = priorQty.get(tk) ?? 0;
    const curr = freshQty.get(tk) ?? 0;
    const delta = curr - prev;
    if (Math.abs(delta) < 0.0001) continue;

    const matches =
      (t.actionType === "buy" && delta > 0) ||
      (t.actionType === "add" && delta > 0) ||
      (t.actionType === "sell" && delta < 0) ||
      (t.actionType === "trim" && delta < 0) ||
      (t.actionType === "switch" && delta !== 0);

    if (matches) {
      completions.push({ taskId: t.id, ticker: t.ticker, delta });
    }
  }
  return completions;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: produce ndjson stream

function ndjsonStream(events: AsyncIterable<Event>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of events) {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        }
      } finally {
        controller.close();
      }
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Cross-silo total — sum the US (us_stocks.json) and MF (markdown) silos so
// snapshot.totalPortfolioValue stays current alongside the IN-only totalValue.
// Best-effort: a missing/garbled silo contributes 0 rather than failing sync.

async function readCrossSiloValue(): Promise<{ usINR: number; mfINR: number }> {
  let usINR = 0;
  let mfINR = 0;
  try {
    const raw = await readFile(US_STOCKS_FILE, "utf8");
    const parsed = JSON.parse(raw) as { totals?: { currentINR?: number } };
    if (typeof parsed?.totals?.currentINR === "number") {
      usINR = parsed.totals.currentINR;
    }
  } catch {
    // no US silo / unreadable — contributes 0
  }
  try {
    const md = await readFile(MUTUAL_FUNDS_FILE, "utf8");
    const summary = parseMutualFunds(md);
    mfINR =
      summary.totalValue ??
      summary.entries.reduce((s, e) => s + (e.value || 0), 0);
  } catch {
    // no MF silo / unparseable — contributes 0
  }
  return { usINR, mfINR };
}

// ────────────────────────────────────────────────────────────────────────────
// Main orchestrator

async function* runSync(): AsyncGenerator<Event> {
  const t0 = Date.now();

  // Phase 1 — Kite holdings pull
  yield { stage: "kite", status: "running" };
  let kiteHoldings: KiteHolding[] = [];
  try {
    const start = Date.now();
    const raw = (await getHoldings()) as KiteHolding[];
    kiteHoldings = raw;
    yield {
      stage: "kite",
      status: "done",
      ms: Date.now() - start,
      count: raw.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { stage: "kite", status: "error", ms: Date.now() - t0, error: msg };
    return;
  }

  // Phase 2 — Snapshot writeback
  yield { stage: "snapshot", status: "running" };
  const snapStart = Date.now();
  const snapshotRaw = await readFile(SNAPSHOT_FILE, "utf8");
  const snapshot: Snapshot = JSON.parse(snapshotRaw);

  // Normalize tickers: strip exchange-series suffixes like "-NA", "-BE", "-EQ"
  // so snapshot's legacy "AEL17725-NA" matches Kite's "AEL17725".
  const normTicker = (t: string): string => t.replace(/-(NA|BE|EQ|BL|N1|N2|N3|N4)$/i, "");

  // Build a snapshot lookup so we can preserve role + asset classification
  // when generating decisions from Kite-detected qty deltas.
  const snapshotByTicker = new Map<string, SnapshotHolding>();
  for (const h of snapshot.holdings) {
    snapshotByTicker.set(normTicker(h.ticker), h);
  }

  const freshLtps = new Map<string, number>();
  const freshQty = new Map<string, number>();
  for (const h of kiteHoldings) {
    const t = normTicker(h.tradingsymbol);
    freshLtps.set(t, h.last_price);
    freshQty.set(t, h.quantity);
  }

  const priorQty = new Map<string, number>();
  for (const h of snapshot.holdings) {
    priorQty.set(normTicker(h.ticker), h.qty);
  }

  let equityValue = 0;
  let bondsValue = 0;
  for (const h of snapshot.holdings) {
    const ltp = freshLtps.get(normTicker(h.ticker));
    if (ltp !== undefined) {
      h.ltp = ltp;
      h.value = h.qty * ltp;
      if (h.avgPrice && h.avgPrice > 0) {
        h.pnlPct = ((ltp - h.avgPrice) / h.avgPrice) * 100;
      }
    }
    const role = (h.role as string) || "";
    if (role === "debt-equiv") {
      bondsValue += h.value;
    } else if (role !== "cash") {
      equityValue += h.value;
    }
  }
  const totalValue = snapshot.holdings.reduce((s, h) => s + h.value, 0);
  // Pull the other silos so the whole-portfolio total stays fresh. totalValue
  // keeps its existing IN-only meaning; totalPortfolioValue = IN + US + MF.
  const { usINR, mfINR } = await readCrossSiloValue();
  const totalPortfolioValue = totalValue + usINR + mfINR;
  snapshot.asOf = new Date().toISOString();
  snapshot.totalValue = totalValue;
  snapshot.totalPortfolioValue = totalPortfolioValue;
  snapshot.equityValue = equityValue;
  snapshot.bondsValue = bondsValue;
  await writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  yield {
    stage: "snapshot",
    status: "done",
    ms: Date.now() - snapStart,
    totalValue,
    totalPortfolioValue,
    equityValue,
    bondsValue,
  };

  // Phase 2.8 — Task sweep
  yield { stage: "tasks", status: "running" };
  const tasksStart = Date.now();
  const tasksRaw = await readFile(TASKS_FILE, "utf8");
  const tasksFile: { _meta?: { cap?: number }; tasks: Task[] } = JSON.parse(tasksRaw);
  const tasks = tasksFile.tasks;

  const today = new Date();
  const triggers = detectPriceTriggers(tasks, freshLtps);
  const overdue = detectOverdue(tasks, today);
  const completions = detectCompletions(tasks, priorQty, freshQty);
  const activeCount = tasks.filter((t) => !t.done).length;
  const cap = tasksFile._meta?.cap ?? 10;

  // Apply Pass C: mark completed
  for (const c of completions) {
    const t = tasks.find((x) => x.id === c.taskId);
    if (t) {
      t.done = true;
      t.completedAt = today.toISOString().slice(0, 10);
      const sign = c.delta > 0 ? "+" : "";
      t.subheading = `${t.subheading} DONE ${t.completedAt}: ${sign}${c.delta} units.`;
    }
  }

  if (completions.length > 0) {
    await writeFile(TASKS_FILE, JSON.stringify(tasksFile, null, 2), "utf8");
  }

  // Write triggers.json
  if (triggers.length > 0) {
    const trigData = {
      firedAt: today.toISOString(),
      items: triggers.map((t) => ({
        taskId: t.taskId,
        ticker: t.ticker,
        severity: "med" as const,
        mechanism: t.mechanism,
      })),
    };
    await writeFile(TRIGGERS_FILE, JSON.stringify(trigData, null, 2), "utf8");
  } else {
    // Clear stale triggers
    await writeFile(TRIGGERS_FILE, JSON.stringify({ firedAt: today.toISOString(), items: [] }, null, 2), "utf8");
  }

  yield {
    stage: "tasks",
    status: "done",
    ms: Date.now() - tasksStart,
    triggers: triggers.length,
    overdue: overdue.length,
    completions: completions.length,
    cap: `${activeCount - completions.length}/${cap}`,
  };

  // Phase 2.85 — Role drift
  yield { stage: "drift", status: "running" };
  const driftStart = Date.now();
  const allocation = await loadAllocation();
  const driftFlags: Array<{ role: string; weightPct: number; targetPct: number; status: string }> = [];
  for (const bucket of allocation.roles) {
    // cash + unclassified carry no SAA target — skip drift math for them.
    if (bucket.role === "cash" || bucket.role === "unclassified") continue;
    const target = ROLE_TARGET[bucket.role].target;
    const drift = bucket.weightPct - target;
    if (Math.abs(drift) > 2) {
      driftFlags.push({
        role: bucket.role,
        weightPct: Number(bucket.weightPct.toFixed(2)),
        targetPct: target,
        status: bucket.driftStatus,
      });
    }
  }
  yield {
    stage: "drift",
    status: "done",
    ms: Date.now() - driftStart,
    flagged: driftFlags.length,
    items: driftFlags,
  };

  // Phase 3 — Decisions + history (only on qty deltas)
  yield { stage: "history", status: "running" };
  const histStart = Date.now();
  const deltas: Array<{ ticker: string; delta: number; price: number }> = [];
  for (const [ticker, curr] of freshQty.entries()) {
    const prev = priorQty.get(ticker) ?? 0;
    const delta = curr - prev;
    if (Math.abs(delta) > 0.0001) {
      deltas.push({ ticker, delta, price: freshLtps.get(ticker) ?? 0 });
    }
  }

  // Also detect zeroed-out positions: priors with qty>0 not in freshQty
  for (const [ticker, prev] of priorQty.entries()) {
    if (prev > 0 && !freshQty.has(ticker)) {
      // Only treat as a SELL if the snapshot says this was an IN equity / bond
      // we'd expect Kite to surface. Skip US (INDmoney) and MF tickers.
      const snapHolding = snapshotByTicker.get(ticker);
      const role = (snapHolding?.role as string) || "";
      const knownKiteRoles = ["compounders", "growth", "cyclicals", "defensives", "hedges", "debt-equiv"];
      if (knownKiteRoles.includes(role) && snapHolding?.avgPrice !== undefined) {
        deltas.push({ ticker, delta: -prev, price: snapHolding.ltp ?? 0 });
      }
    }
  }

  let newDecisions = 0;
  if (deltas.length > 0) {
    const decRaw = await readFile(DECISIONS_FILE, "utf8");
    const decFile: { decisions: Decision[] } = JSON.parse(decRaw);
    const lastId = decFile.decisions[0]?.id ?? "d0";
    let nextN = parseInt(lastId.replace(/^d/, ""), 10) + 1;
    const newEntries: Decision[] = [];
    const todayStr = today.toISOString().slice(0, 10);
    const reviewAt = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
    for (const d of deltas) {
      // Classify asset from snapshot role: debt-equiv → bonds, else in-equity
      const snapHolding = snapshotByTicker.get(d.ticker);
      const role = (snapHolding?.role as string) || "";
      const asset = role === "debt-equiv" ? "bonds" : role === "hedges" ? "metals" : "in-equity";
      newEntries.unshift({
        id: `d${nextN++}`,
        date: todayStr,
        action: d.delta > 0 ? "BUY" : "SELL",
        ticker: d.ticker,
        qty: Math.abs(d.delta),
        price: d.price,
        asset,
        rationale: "Auto-detected from broker diff via dashboard /api/sync. Manual rationale pending.",
        verdict: "pending",
        reviewAt,
      });
    }
    decFile.decisions = [...newEntries, ...decFile.decisions];
    await writeFile(DECISIONS_FILE, JSON.stringify(decFile, null, 2), "utf8");
    newDecisions = newEntries.length;
  }

  // Upsert history
  const histRaw = await readFile(PORTFOLIO_HISTORY_FILE, "utf8");
  const histFile: { history: Array<{ date: string; totalValue: number; cashInjection?: number; withdrawals?: number; nifty?: number | null; note?: string }> } = JSON.parse(histRaw);
  const todayStr = today.toISOString().slice(0, 10);
  // The snapshot usually carries an approximate Nifty close; thread it into
  // history so benchmark math has data when available (instead of always null).
  const niftyValue = snapshot.nifty?.value ?? null;
  const existing = histFile.history.find((h) => h.date === todayStr);
  if (existing) {
    existing.totalValue = Math.round(totalValue);
    // Backfill Nifty only if today's row doesn't already have one.
    if ((existing.nifty == null) && niftyValue != null) {
      existing.nifty = niftyValue;
    }
  } else {
    histFile.history.push({
      date: todayStr,
      totalValue: Math.round(totalValue),
      cashInjection: 0,
      withdrawals: 0,
      nifty: niftyValue,
      note: `Auto-sync via dashboard. ${deltas.length} qty delta${deltas.length === 1 ? "" : "s"}. ${triggers.length} trigger${triggers.length === 1 ? "" : "s"} fired.`,
    });
  }
  await writeFile(PORTFOLIO_HISTORY_FILE, JSON.stringify(histFile, null, 2), "utf8");

  yield {
    stage: "history",
    status: "done",
    ms: Date.now() - histStart,
    decisions: newDecisions,
    deltas: deltas.length,
  };

  // Final summary
  yield {
    stage: "summary",
    data: {
      totalMs: Date.now() - t0,
      totalValue: Math.round(totalValue),
      equityValue: Math.round(equityValue),
      bondsValue: Math.round(bondsValue),
      kiteHoldings: kiteHoldings.length,
      qtyDeltas: deltas.length,
      newDecisions,
      triggersFired: triggers.length,
      overdueTasks: overdue.length,
      taskCompletions: completions.length,
      driftFlags: driftFlags.length,
      asOf: snapshot.asOf,
    },
  };
}

export async function POST() {
  const stream = ndjsonStream(runSync());
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
