"use client";

import { useEffect, useState } from "react";
import { CompactStat } from "./ui";

/* ---- types: mirror scripts/backtest/run_all.py output ------------------- */

type Verdict = "keep" | "amend" | "kill";

type ScoreRow = { rule: string; verdict: Verdict; evidence: string };

type DecisionRow = {
  id: string;
  ticker: string;
  action: string;
  category?: string;
  verdictComputed?: "good" | "bad" | "neutral";
  actionReturnPct?: number | null;
  counterfactualReturnPct?: number | null;
};

type GatePolicy = {
  endingValueINR: number;
  endingReturnPct: number;
  maxDrawdownPct: number;
};

/** Skip entries are plain ids in partial runs, objects once reasons land. */
type SkipEntry = string | { id?: string; reason?: string };

type Backtest = {
  asOf: string;
  decisions: {
    rows: DecisionRow[];
    skipped: SkipEntry[];
    thresholds?: { goodPct: number; badPct: number };
    sources?: { summary?: Record<string, number> };
  };
  /** Gates are absent until the regime sim runs; note explains why. */
  regimeGate: {
    dca?: GatePolicy;
    staticGate?: GatePolicy;
    dynamicGate?: GatePolicy;
    available?: boolean;
    note?: string;
  };
  scorecard: ScoreRow[];
};

/**
 * A result is renderable as soon as the always-present parts exist:
 * a scorecard and scored decision rows. The regime gates are optional;
 * a partial run ships without them, and we render a note instead.
 */
function isBacktest(j: unknown): j is Backtest {
  if (!j || typeof j !== "object") return false;
  const o = j as Record<string, unknown>;
  const d = o.decisions as Record<string, unknown> | undefined;
  return Array.isArray(o.scorecard) && Array.isArray(d?.rows);
}

/** Reason text for a skip entry, when the richer object shape is present. */
const skipReason = (s: SkipEntry): string | undefined =>
  typeof s === "string" ? undefined : s.reason;

/** Top skip reasons by frequency, "reason ×n", for the audit caption. */
function topSkipReasons(skipped: SkipEntry[], limit = 2): string[] {
  const counts = new Map<string, number>();
  for (const s of skipped) {
    const r = skipReason(s);
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([r, n]) => (n > 1 ? `${r} ×${n}` : r));
}

/* ---- formatters ---------------------------------------------------------- */

const fmtINR = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Value added by the decision vs its counterfactual, in pct points. */
const edge = (r: DecisionRow) =>
  (r.actionReturnPct ?? 0) - (r.counterfactualReturnPct ?? 0);

const VERDICT_STYLE: Record<Verdict, { color: string; bg: string }> = {
  keep: { color: "var(--pos)", bg: "var(--pos-tint)" },
  amend: { color: "var(--warn)", bg: "var(--warn-tint)" },
  kill: { color: "var(--neg)", bg: "var(--neg-tint)" },
};

function VerdictChip({ v }: { v: Verdict }) {
  const s = VERDICT_STYLE[v] ?? VERDICT_STYLE.amend;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold mono-true"
      style={{ color: s.color, background: s.bg }}
    >
      {v}
    </span>
  );
}

/* ---- panel ---------------------------------------------------------------- */

export function StrategyLab() {
  const [bt, setBt] = useState<Backtest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/backtest/results")
      .then((r) => r.json())
      .then((j) => {
        if (isBacktest(j?.backtest)) setBt(j.backtest);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return <div className="rounded-lg h-40 animate-pulse" style={{ background: "var(--bg-subtle)" }} />;
  }

  if (!bt) {
    return (
      <div className="surface rounded-lg p-10 text-sm text-tertiary text-center">
        No backtest yet. Run scripts/backtest/run_all.py.
      </div>
    );
  }

  const rows = bt.decisions.rows;
  const counts = { good: 0, bad: 0, neutral: 0 };
  for (const r of rows) {
    const v = r.verdictComputed;
    if (v === "good" || v === "bad" || v === "neutral") counts[v] += 1;
  }
  const skippedList = bt.decisions.skipped ?? [];
  const skipped = skippedList.length;
  const skipReasons = topSkipReasons(skippedList);
  const band = bt.decisions.thresholds?.goodPct;

  const sourceSummary = bt.decisions.sources?.summary;
  const provenance = sourceSummary
    ? Object.entries(sourceSummary)
        .map(([src, n]) => `${src}: ${n}`)
        .join(" · ")
    : null;

  const ranked = rows
    .filter((r) => typeof r.counterfactualReturnPct === "number")
    .sort((a, b) => edge(b) - edge(a));
  const best = ranked.slice(0, 3);
  const bestIds = new Set(best.map((r) => r.id));
  const worst = ranked.slice(-3).reverse().filter((r) => !bestIds.has(r.id));

  const { dca, staticGate, dynamicGate } = bt.regimeGate;
  const gates: { label: string; p: GatePolicy }[] | null =
    dca && staticGate && dynamicGate
      ? [
          { label: "DCA", p: dca },
          { label: "Static gate", p: staticGate },
          { label: "200DMA gate", p: dynamicGate },
        ]
      : null;
  const winner = gates
    ? gates.reduce((w, g) => (g.p.endingReturnPct > w.p.endingReturnPct ? g : w))
    : null;

  const asOf = new Date(bt.asOf).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div className="space-y-8">
      <p className="text-[11px] text-tertiary mono-true">
        as of {asOf} · {rows.length} decisions scored, {skipped} skipped
        {provenance && ` · prices ${provenance}`}
      </p>

      {/* (a) Rule scorecard */}
      <section className="space-y-3">
        <div className="eyebrow">Rule scorecard</div>
        <div className="surface rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] text-tertiary">
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium">Verdict</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {bt.scorecard.map((s, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3.5 align-top text-[12.5px] font-medium text-primary leading-snug md:w-[30%]">
                    {s.rule}
                    <span className="block md:hidden text-[11.5px] font-normal text-secondary leading-relaxed mt-1.5">
                      {s.evidence}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <VerdictChip v={s.verdict} />
                  </td>
                  <td className="px-4 py-3.5 align-top text-[12px] text-secondary leading-relaxed hidden md:table-cell">
                    {s.evidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* (b) Regime-gate strip */}
      <section className="space-y-3">
        <div className="eyebrow">Regime gate · monthly deploys vs gating</div>
        {gates && winner ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {gates.map((g) => {
                const won = g.label === winner.label;
                return (
                  <div
                    key={g.label}
                    className="rounded-lg p-4 md:p-5"
                    style={{
                      background: "var(--bg-card)",
                      border: `1px solid ${won ? "var(--pos)" : "var(--border)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="eyebrow">{g.label}</span>
                      {won && (
                        <span className="text-[10px] font-semibold mono-true text-pos">winner</span>
                      )}
                    </div>
                    <div className="mono-true font-semibold mt-2.5 text-[20px] md:text-[22px] tracking-tight text-primary">
                      {fmtINR(g.p.endingValueINR)}
                    </div>
                    <div className="text-[11px] text-tertiary mt-2 mono-true">
                      {fmtPct(g.p.endingReturnPct)} per ₹ · maxDD {fmtPct(g.p.maxDrawdownPct)}
                    </div>
                  </div>
                );
              })}
            </div>
            {bt.regimeGate.note && (
              <p className="text-[11px] text-tertiary leading-relaxed max-w-[80ch]">{bt.regimeGate.note}</p>
            )}
          </>
        ) : (
          <div className="surface rounded-lg p-4 md:p-5">
            <p className="text-[12px] text-secondary leading-relaxed max-w-[80ch]">
              Regime sim pending
              {bt.regimeGate.note ? `: ${bt.regimeGate.note}` : "."}
            </p>
          </div>
        )}
      </section>

      {/* (c) Decisions summary */}
      <section className="space-y-3">
        <div className="eyebrow">Decision audit</div>
        <div className="surface rounded-lg overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4 -m-px">
            <CompactStat
              label="Good"
              value={String(counts.good)}
              sub={band !== undefined ? `beat alternative by >${band}%` : "beat the alternative"}
              accent={counts.good > 0 ? "pos" : undefined}
            />
            <CompactStat
              label="Bad"
              value={String(counts.bad)}
              sub="trailed the alternative"
              accent={counts.bad > 0 ? "neg" : undefined}
            />
            <CompactStat
              label="Neutral"
              value={String(counts.neutral)}
              sub={band !== undefined ? `within ±${band}%` : "roughly a wash"}
            />
            <CompactStat
              label="Skipped"
              value={String(skipped)}
              sub={skipReasons.length ? skipReasons[0] : "no price or no trade"}
            />
          </div>
        </div>
        {skipReasons.length > 0 && (
          <p className="text-[11px] text-tertiary leading-relaxed max-w-[80ch]">
            Top skip reasons: {skipReasons.join(" · ")}
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <DecisionList title="Best 3 calls" rows={best} />
          <DecisionList title="Worst 3 calls" rows={worst} />
        </div>
      </section>
    </div>
  );
}

function DecisionList({ title, rows }: { title: string; rows: DecisionRow[] }) {
  return (
    <div className="surface rounded-lg p-4 md:p-5">
      <div className="eyebrow mb-3">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[11.5px] text-tertiary">Not enough scored rows.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const e = edge(r);
            return (
              <div key={r.id} className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex items-baseline gap-2">
                  <span className="mono-true text-[12.5px] font-semibold text-primary truncate">
                    {r.ticker}
                  </span>
                  <span className="text-[10.5px] text-tertiary lowercase">{r.action}</span>
                </div>
                <div className="shrink-0 mono-true text-[11.5px] text-secondary">
                  {fmtPct(r.actionReturnPct ?? 0)} vs {fmtPct(r.counterfactualReturnPct ?? 0)}
                  <span className={`ml-2 font-semibold ${e >= 0 ? "text-pos" : "text-neg"}`}>
                    {fmtPct(e)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StrategyLab;
