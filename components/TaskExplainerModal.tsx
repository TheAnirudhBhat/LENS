"use client";

/**
 * TaskExplainerModal — centered modal opened by clicking a task card on the
 * Tasks tab. Shows WHY this task exists, the threshold/trigger state, related
 * decisions, days-open vs tier-lifetime, a suggested next move, and footer
 * actions (mark done / snooze / close).
 *
 * Data: fetches /api/snapshot, /api/usstocks, /api/mutualfunds, /api/decisions
 * lazily on open. Falls back to "—" when a value isn't available.
 * Writes: PATCH /api/tasks/[id] for done + priority demotion.
 *
 * Visual language: surface / surface-subtle, low chrome, compact typography,
 * tabular figures. Mirrors the existing modal-backdrop + modal-card pattern.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { TIER_LIFETIME_DAYS, daysBetween } from "@/lib/taskAge";

// ─────────────────────────────────────────────────────────────────────────────
// Types — narrow, local copies. We deliberately don't import app/page.tsx
// because that file is being concurrently edited by another agent.
// ─────────────────────────────────────────────────────────────────────────────

type ExplainerFlowEndpoint = {
  ticker: string;
  subtitle?: string;
};

type ExplainerFlow = {
  from: ExplainerFlowEndpoint;
  to: ExplainerFlowEndpoint;
  trigger: string;
  gap?: string;
  status?: "armed" | "near" | "fired" | "blocked";
  secondary?: string;
};

type ExplainerAnchor = {
  label: string;
  summary: string;
};

export type ExplainerTask = {
  id: string;
  heading?: string;
  subheading?: string;
  text?: string;
  priority?: "urgent" | "high" | "med" | "low";
  ticker?: string;
  amc?: string;
  asset?: string;
  actionType?: string;
  source?: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
  flow?: ExplainerFlow;
  anchor?: ExplainerAnchor;
};

type Decision = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  qty?: number;
  price?: number;
  verdict?: "good" | "bad" | "pending";
  rationale?: string;
  outcome?: string;
  currentPrice?: number;
};

type SnapshotHolding = {
  ticker: string;
  ltp?: number;
  pnlPct?: number;
};

type SnapshotData = {
  asOf?: string;
  holdings: SnapshotHolding[];
};

type USPosition = {
  ticker: string;
  name?: string;
  currentPriceUSD?: number;
  pnlPct?: number;
};

type USData = {
  positions: USPosition[];
};

type MFEntry = {
  ticker?: string;
  scheme: string;
  nav?: number;
  pnlPct?: number;
};

type MFSummary = {
  entries: MFEntry[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Threshold parser
//
// Looks for "₹230", "₹1,200.50", "$84.36", "23,000" etc. and qualifies them
// with a leading verb so we can label the threshold (stop, exit, add, break,
// pop, hard cut, breach). Returns up to 3 thresholds — enough for tasks like
// "Pop ≥₹372 → exit. Break ₹325 → hard cut."
// ─────────────────────────────────────────────────────────────────────────────

type Threshold = {
  raw: string;
  value: number;
  currency: "INR" | "USD" | "unitless";
  direction: "above" | "below" | "unknown";
  label: string; // verb-ish: "pop", "break", "hard cut", "add at", "stop"
};

const PRICE_RE = /(₹|\$)?\s?([\d][\d,]*(?:\.\d+)?)/g;

function parseThresholds(text: string): Threshold[] {
  if (!text) return [];
  const out: Threshold[] = [];
  for (const match of text.matchAll(PRICE_RE)) {
    const symbol = match[1];
    const numStr = match[2].replace(/,/g, "");
    const value = Number(numStr);
    if (!isFinite(value)) continue;
    // Skip naked small integers (e.g. "2 sessions") — require ₹/$ OR ≥3 digits OR a decimal point.
    if (!symbol && !/\d{3,}/.test(numStr) && !/\./.test(numStr)) continue;

    const idx = match.index ?? 0;
    const start = Math.max(0, idx - 28);
    const context = text.slice(start, idx).toLowerCase();
    let label = "threshold";
    let direction: Threshold["direction"] = "unknown";
    if (/\bhard cut\b/.test(context)) {
      label = "hard cut";
      direction = "below";
    } else if (/\bbreak\b|\bbreaks\b|\bbelow\b|<\s?$/.test(context)) {
      label = "break";
      direction = "below";
    } else if (/\bpop( to)?\b|\babove\b|≥|>=|>\s?$/.test(context)) {
      label = "pop";
      direction = "above";
    } else if (/\badd at\b|\badd\b/.test(context)) {
      label = "add at";
      direction = "below";
    } else if (/\bstop\b/.test(context)) {
      label = "stop";
      direction = "below";
    } else if (/\bbreach(ed)?\b/.test(context)) {
      label = "breach";
    } else if (/\bexit\b/.test(context)) {
      label = "exit";
    } else if (!symbol) {
      // Naked number with no directional verb — skip.
      continue;
    }

    out.push({
      raw: (symbol ?? "") + match[2],
      value,
      currency: symbol === "$" ? "USD" : symbol === "₹" ? "INR" : "unitless",
      direction,
      label,
    });
    if (out.length >= 3) break;
  }
  return out;
}

function classifyTriggerState(
  t: Threshold,
  ltp: number | undefined
): { state: "fired" | "near" | "armed" | "far" | "unknown"; distancePct: number | null } {
  if (ltp === undefined || ltp === null || !isFinite(ltp))
    return { state: "unknown", distancePct: null };
  const distancePct = ((ltp - t.value) / t.value) * 100;
  if (t.direction === "below") {
    if (ltp <= t.value) return { state: "fired", distancePct };
    if (distancePct < 3) return { state: "near", distancePct };
    if (distancePct < 8) return { state: "armed", distancePct };
    return { state: "far", distancePct };
  }
  if (t.direction === "above") {
    if (ltp >= t.value) return { state: "fired", distancePct };
    if (-distancePct < 3) return { state: "near", distancePct };
    if (-distancePct < 8) return { state: "armed", distancePct };
    return { state: "far", distancePct };
  }
  return { state: "armed", distancePct };
}

// Tier lifetime + days-open math now live in lib/taskAge.ts (shared with the
// Tasks tab so the overdue rules stay in one place).

function fmtMoney(value: number, currency: "INR" | "USD" | "unitless"): string {
  if (currency === "USD") return `$${value.toFixed(2)}`;
  if (currency === "INR")
    return `₹${new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: value < 100 ? 2 : 0,
    }).format(value)}`;
  return value.toLocaleString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  task: ExplainerTask | null;
  onClose: () => void;
  onTaskUpdated?: () => void;
};

export default function TaskExplainerModal({ task, onClose, onTaskUpdated }: Props) {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [usData, setUsData] = useState<USData | null>(null);
  const [mf, setMf] = useState<MFSummary | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"done" | "snooze" | null>(null);

  // Lazy-load context data only when the modal is open.
  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/snapshot").then((r) => r.json()).catch(() => ({})),
      fetch("/api/usstocks").then((r) => r.json()).catch(() => ({})),
      fetch("/api/mutualfunds").then((r) => r.json()).catch(() => ({})),
      fetch("/api/decisions").then((r) => r.json()).catch(() => ({})),
    ])
      .then(([snap, us, mfRes, dec]) => {
        if (cancelled) return;
        setSnapshot(snap?.data ?? null);
        setUsData(us?.data ?? null);
        setMf(mfRes?.summary ?? null);
        setDecisions(dec?.decisions ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [task]);

  // Esc to close.
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onClose]);

  const subText = task?.subheading ?? task?.text ?? "";

  const thresholds = useMemo(() => parseThresholds(subText), [subText]);

  const ltp = useMemo<{ value: number | undefined; currency: "INR" | "USD" | "unitless"; source: string }>(() => {
    if (!task?.ticker) return { value: undefined, currency: "unitless", source: "—" };
    const t = task.ticker.toUpperCase();
    if (task.asset === "us-equity" || usData?.positions?.some((p) => p.ticker.toUpperCase() === t)) {
      const p = usData?.positions?.find((p) => p.ticker.toUpperCase() === t);
      return { value: p?.currentPriceUSD, currency: "USD", source: "INDmoney" };
    }
    if (task.asset === "mf" || mf?.entries?.some((e) => (e.ticker ?? "").toUpperCase() === t)) {
      const e = mf?.entries?.find((e) => (e.ticker ?? "").toUpperCase() === t);
      return { value: e?.nav, currency: "INR", source: "mfapi" };
    }
    const h = snapshot?.holdings?.find((h) => h.ticker.toUpperCase() === t);
    return { value: h?.ltp, currency: "INR", source: "Kite / snapshot" };
  }, [task, snapshot, usData, mf]);

  // Find decisions related to this task. Match by:
  //   1. d-id mentioned in subheading (e.g. "d19"), OR
  //   2. ticker match.
  const relatedDecisions = useMemo<Decision[]>(() => {
    if (!task) return [];
    const idRe = /\bd\d+\b/gi;
    const ids = new Set<string>();
    const text = `${task.heading ?? ""} ${subText}`;
    for (const m of text.matchAll(idRe)) ids.add(m[0].toLowerCase());

    const byId = decisions.filter((d) => ids.has(d.id.toLowerCase()));
    if (byId.length) return byId.slice(0, 5);

    if (task.ticker) {
      return decisions
        .filter((d) => d.ticker?.toUpperCase() === task.ticker?.toUpperCase())
        .slice(0, 5);
    }
    return [];
  }, [task, decisions, subText]);

  const daysOpen = task ? daysBetween(task.createdAt) : null;
  const tierMax = task?.priority ? TIER_LIFETIME_DAYS[task.priority] : null;
  const stale = daysOpen !== null && tierMax !== null && daysOpen > tierMax;

  // Compute first fired/near threshold for suggested action.
  const firstTrigger = useMemo(() => {
    if (!thresholds.length || ltp.value === undefined) return null;
    const states = thresholds.map((t) => ({ t, ...classifyTriggerState(t, ltp.value) }));
    return (
      states.find((s) => s.state === "fired") ??
      states.find((s) => s.state === "near") ??
      states[0]
    );
  }, [thresholds, ltp.value]);

  const suggestion = useMemo(() => {
    if (!task) return "—";
    if (firstTrigger?.state === "fired")
      return `Execute now — ${firstTrigger.t.label} at ${firstTrigger.t.raw} hit.`;
    if (firstTrigger?.state === "near")
      return `Watch closely — within 3% of ${firstTrigger.t.label} (${firstTrigger.t.raw}).`;
    if (task.ticker && ltp.value === undefined)
      return "Refresh broker session and re-evaluate — no live price.";
    if (stale)
      return `Review or close — open ${daysOpen}d vs ${tierMax}d tier limit.`;
    if (task.actionType === "monitor") return "Keep monitoring — no trigger fired yet.";
    return "Hold position; revisit on next portfolio check.";
  }, [task, firstTrigger, ltp.value, stale, daysOpen, tierMax]);

  // Mutations.
  async function patchTask(body: object) {
    if (!task) return;
    const r = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      console.error("[TaskExplainer] patch failed:", j);
    }
    onTaskUpdated?.();
  }

  async function markDone() {
    setBusy("done");
    try {
      await patchTask({ done: true });
      onClose();
    } finally {
      setBusy(null);
    }
  }

  async function snooze() {
    if (!task) return;
    const next: Record<string, string> = { urgent: "high", high: "med", med: "low", low: "low" };
    const target = next[task.priority ?? "med"];
    setBusy("snooze");
    try {
      await patchTask({ priority: target });
      onClose();
    } finally {
      setBusy(null);
    }
  }

  if (typeof document === "undefined") return null;
  if (!task) return null;

  const priorityTone = priorityToTone(task.priority);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg max-w-xl w-full max-h-[88vh] overflow-y-auto no-scrollbar"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-5 px-7 pt-7 pb-5 border-b border-subtle">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <PriorityBadge priority={task.priority} tone={priorityTone} />
              {task.actionType && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-subtle text-tertiary font-medium">
                  {task.actionType}
                </span>
              )}
              {task.ticker && (
                <span className="font-semibold mono-true text-primary text-[12.5px]">
                  {task.ticker}
                </span>
              )}
            </div>
            <h2 className="text-[16px] md:text-[17px] leading-snug font-semibold text-primary">
              {task.heading ?? task.text ?? "(untitled)"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none accent-ring rounded-md"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-5 space-y-5">
          {/* Money flow — the from→trigger→to visual relocated off the row. */}
          {task.flow && (
            <Section title="Money flow">
              <div className="surface-subtle rounded-md p-3 flex items-center gap-3">
                <FlowEnd e={task.flow.from} />
                <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <FlowStatusChip status={task.flow.status ?? "armed"} />
                  <span className="text-[11px] text-secondary text-center leading-tight">
                    {task.flow.trigger}
                  </span>
                  {task.flow.gap && (
                    <span className="mono-true text-[10px] text-tertiary">{task.flow.gap}</span>
                  )}
                </div>
                <FlowEnd e={task.flow.to} align="right" />
              </div>
            </Section>
          )}

          {/* Anchor summary — for monitors / gates / decision-pending tasks. */}
          {task.anchor && (
            <Section title={task.anchor.label}>
              <p className="text-[12.5px] text-secondary leading-relaxed">
                {task.anchor.summary}
              </p>
            </Section>
          )}

          {/* Why this task exists */}
          <Section title="Why this task exists">
            <p className="text-[12.5px] text-secondary leading-relaxed">
              {subText || <span className="text-tertiary">No additional context recorded.</span>}
            </p>
          </Section>

          {/* Trigger state */}
          <Section title="Trigger state">
            {thresholds.length === 0 ? (
              <p className="text-[12px] text-tertiary">
                No numeric threshold parsed from the subheading.
              </p>
            ) : (
              <div className="space-y-3">
                {thresholds.map((th, i) => {
                  const cls = classifyTriggerState(th, ltp.value);
                  return (
                    <ThresholdRow
                      key={i}
                      threshold={th}
                      ltp={ltp.value}
                      ltpCurrency={ltp.currency}
                      state={cls.state}
                      distancePct={cls.distancePct}
                    />
                  );
                })}
              </div>
            )}
            {task.ticker && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-tertiary">
                <span>LTP</span>
                <span className="mono-true text-primary">
                  {ltp.value !== undefined ? fmtMoney(ltp.value, ltp.currency) : "—"}
                </span>
                <span>·</span>
                <span>{ltp.source}</span>
              </div>
            )}
          </Section>

          {/* Days open */}
          <Section title="Age">
            <div className="flex items-center gap-3 text-[12px] flex-wrap">
              <Stat label="Created" value={task.createdAt && task.createdAt !== "—" ? task.createdAt : "—"} mono />
              <Stat
                label="Days open"
                value={daysOpen !== null ? `${daysOpen}d` : "—"}
                mono
                accent={stale ? "neg" : undefined}
              />
              <Stat
                label="Tier limit"
                value={tierMax !== null ? `${tierMax}d` : "—"}
                mono
              />
              {stale && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-neg-tint text-neg font-medium">
                  Past tier limit
                </span>
              )}
            </div>
          </Section>

          {/* Related decisions */}
          <Section title="Related decisions">
            {loading ? (
              <p className="text-[11px] text-tertiary">Loading…</p>
            ) : relatedDecisions.length === 0 ? (
              <p className="text-[11px] text-tertiary">No matching decisions in the log.</p>
            ) : (
              <ul className="divide-y divide-subtle surface-subtle rounded-md overflow-hidden">
                {relatedDecisions.map((d) => (
                  <li key={d.id} className="px-3 py-2 text-[11.5px] flex items-baseline gap-3">
                    <span className="mono-true text-tertiary shrink-0">{d.id}</span>
                    <span className="mono-true text-tertiary shrink-0">{d.date}</span>
                    <span className="text-primary flex-1 min-w-0 truncate">
                      {d.action}
                      {d.qty ? ` ${d.qty}` : ""}
                      {d.price ? ` @ ${d.price}` : ""}
                    </span>
                    {d.verdict && (
                      <span
                        className={`text-[10px] uppercase tracking-wide font-medium ${
                          d.verdict === "good"
                            ? "text-pos"
                            : d.verdict === "bad"
                            ? "text-neg"
                            : "text-tertiary"
                        }`}
                      >
                        {d.verdict}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Suggested action */}
          <Section title="Suggested next move">
            <p className="text-[12.5px] text-primary leading-relaxed">{suggestion}</p>
          </Section>
        </div>

        {/* Footer actions */}
        <div className="px-7 py-4 border-t border-subtle flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-secondary hover:text-primary rounded-md transition-colors"
          >
            Close
          </button>
          <button
            onClick={snooze}
            disabled={busy !== null || task.done}
            className="px-3 py-1.5 text-[12px] text-secondary hover:text-primary border border-subtle rounded-md transition-colors disabled:opacity-50"
            title="Demote priority one notch"
          >
            {busy === "snooze" ? "Snoozing…" : "Snooze"}
          </button>
          <button
            onClick={markDone}
            disabled={busy !== null || task.done}
            className="px-3 py-1.5 text-[12px] font-medium bg-pos-tint text-pos rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy === "done" ? "Saving…" : "Mark done"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2">
        {title}
      </div>
      {children}
    </section>
  );
}

/** Flow-status chip — mirrors the Tasks-tab row chip (tokens only). */
function FlowStatusChip({ status }: { status: "armed" | "near" | "fired" | "blocked" }) {
  const s = {
    fired: { color: "var(--neg)", background: "var(--neg-tint)" },
    near: { color: "var(--warn)", background: "var(--warn-tint)" },
    armed: { color: "var(--text-secondary)", background: "var(--bg-subtle)" },
    blocked: { color: "var(--text-tertiary)", background: "var(--bg-subtle)" },
  }[status];
  return (
    <span
      className="mono-true text-[10px] font-semibold uppercase tracking-[0.06em] px-1.5 py-[3px] rounded"
      style={s}
    >
      {status}
    </span>
  );
}

/** One end of a money flow — ticker + subtitle, no logo lookup (kept compact). */
function FlowEnd({
  e,
  align = "left",
}: {
  e: ExplainerFlowEndpoint;
  align?: "left" | "right";
}) {
  return (
    <div className={`min-w-0 shrink-0 ${align === "right" ? "text-right" : ""}`}>
      <div className="mono-true font-semibold text-primary text-[12.5px] truncate">
        {e.ticker}
      </div>
      {e.subtitle && (
        <div className="text-[10.5px] text-tertiary truncate">{e.subtitle}</div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "pos" | "neg";
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10.5px] uppercase tracking-wide text-tertiary">{label}</span>
      <span
        className={`${mono ? "mono-true" : ""} ${
          accent === "pos" ? "text-pos" : accent === "neg" ? "text-neg" : "text-primary"
        } text-[12px] font-medium`}
      >
        {value}
      </span>
    </div>
  );
}

function priorityToTone(p?: ExplainerTask["priority"]): "neg" | "warn" | "info" | "neutral" {
  if (p === "urgent" || p === "high") return "neg";
  if (p === "med") return "warn";
  if (p === "low") return "neutral";
  return "neutral";
}

function PriorityBadge({
  priority,
  tone,
}: {
  priority?: ExplainerTask["priority"];
  tone: "neg" | "warn" | "info" | "neutral";
}) {
  const cls =
    tone === "neg"
      ? "bg-neg-tint text-neg"
      : tone === "warn"
      ? "bg-amber-500/15 text-amber-500"
      : tone === "info"
      ? "bg-blue-500/15 text-blue-500"
      : "surface-subtle text-tertiary";
  const label = (priority ?? "—").toString().toUpperCase();
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-md tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function ThresholdRow({
  threshold,
  ltp,
  ltpCurrency,
  state,
  distancePct,
}: {
  threshold: Threshold;
  ltp: number | undefined;
  ltpCurrency: "INR" | "USD" | "unitless";
  state: "fired" | "near" | "armed" | "far" | "unknown";
  distancePct: number | null;
}) {
  const stateColor =
    state === "fired"
      ? "var(--neg)"
      : state === "near"
      ? "var(--warn, #f59e0b)"
      : state === "armed"
      ? "var(--text-tertiary)"
      : state === "far"
      ? "var(--text-tertiary)"
      : "var(--text-tertiary)";

  // Fill width visualizes distance to threshold. Capped at 100 for "far".
  const fillPct =
    state === "fired"
      ? 100
      : state === "near"
      ? 80
      : state === "armed"
      ? 50
      : state === "far"
      ? 20
      : 10;

  const stateLabel =
    state === "fired"
      ? "Fired"
      : state === "near"
      ? "Near (<3%)"
      : state === "armed"
      ? "Armed"
      : state === "far"
      ? "Far"
      : "—";

  return (
    <div className="surface-subtle rounded-md p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10.5px] uppercase tracking-wide text-tertiary">
            {threshold.label}
          </span>
          <span className="mono-true text-[13px] text-primary font-medium">
            {threshold.raw}
          </span>
        </div>
        <span
          className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded"
          style={{ color: stateColor, background: "rgba(255,255,255,0.04)" }}
        >
          {stateLabel}
        </span>
      </div>
      <div className="h-1 rounded-full" style={{ background: "var(--bg-subtle)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${fillPct}%`, background: stateColor }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-[10.5px] text-tertiary">
        <span>
          LTP{" "}
          <span className="mono-true text-secondary">
            {ltp !== undefined ? fmtMoney(ltp, ltpCurrency) : "—"}
          </span>
        </span>
        <span>
          Distance{" "}
          <span className="mono-true text-secondary">
            {distancePct !== null ? `${distancePct >= 0 ? "+" : ""}${distancePct.toFixed(1)}%` : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}
