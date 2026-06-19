"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui";

// ---------- Score JSON contract ----------
// Mirrors what GET /api/score returns (built by lib/portfolioScore.ts as a
// pure function of the assembled book + SAA targets). Kept inline so this
// card stays self-contained and ships PUBLIC — no personal tickers/amounts
// are ever hardcoded; every value is read from the API at runtime.

type DimensionKey =
  | "allocation"
  | "concentration"
  | "cost"
  | "capital"
  | "liquidity"
  | "deploy";

type DimStatus = "good" | "warn" | "bad";

type Grade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D";

type ScoreDimension = {
  key: DimensionKey;
  label: string;
  score: number; // 0-100
  weight: number; // sums to 1.0 across dimensions
  detail: string; // one plain-English line with the live numbers
  status: DimStatus;
};

type ScoreLever = {
  id: string;
  action: string; // imperative, verb-first, with the ₹/level
  scoreGain: number; // estimated composite points if done
  why: string; // one line
  ticker: string | null;
};

export type ScoreResult = {
  asOf: string; // ISO string
  composite: number | null; // 0-100 integer; null => not yet computed
  grade: Grade | null;
  dimensions: ScoreDimension[];
  levers: ScoreLever[];
  note: string | null;
};

// ---------- band → tone ----------
// >=72 positive, 56-71 warn, <56 negative. Drives the hero gauge tint and
// the one-line summary. Derived from grade/composite, never hardcoded copy.

const POS_BAND = 72;
const WARN_BAND = 56;

function bandTone(composite: number): { fg: string; tint: string } {
  if (composite >= POS_BAND) return { fg: "var(--pos)", tint: "var(--pos-tint)" };
  if (composite >= WARN_BAND) return { fg: "var(--warn)", tint: "var(--warn-tint)" };
  return { fg: "var(--neg)", tint: "var(--neg-tint)" };
}

function statusTone(status: DimStatus): string {
  if (status === "good") return "var(--pos)";
  if (status === "warn") return "var(--warn)";
  return "var(--neg)";
}

// Plain-English hero summary, synthesised from the band. No personal text —
// the shape is generic and the same for any book in a given band.
function bandSummary(composite: number): string {
  if (composite >= 85) return "a disciplined book tracking your doctrine closely";
  if (composite >= POS_BAND) return "a good book carrying fixable structural drag";
  if (composite >= WARN_BAND) return "a workable book with drift worth tightening";
  return "the book has pulled away from your doctrine on several fronts";
}

// ---------- session cache ----------
// Module-level cache persists across mount/remount cycles (tab nav) so the
// skeleton only shows on the very first load of the session, matching the
// OverviewTab pattern. After first load we refresh in the background.
const scoreCache: { score: ScoreResult | null; loaded: boolean } = {
  score: null,
  loaded: false,
};

export default function PortfolioScoreCard() {
  const [score, setScore] = useState<ScoreResult | null>(scoreCache.score);
  // Skeleton only on a true first load; cached sessions render instantly.
  const [dataReady, setDataReady] = useState(scoreCache.loaded);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/score")
      .then((r) => r.json())
      .then((d: ScoreResult | { score?: ScoreResult }) => {
        if (cancelled) return;
        // Tolerate both a bare ScoreResult and a { score } envelope.
        const next =
          d && "composite" in d ? (d as ScoreResult) : (d as { score?: ScoreResult })?.score ?? null;
        if (next) {
          scoreCache.score = next;
          setScore(next);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        scoreCache.loaded = true;
        setDataReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!dataReady && !score) return <ScoreSkeleton />;

  // Empty state — agent hasn't computed a composite yet.
  if (!score || score.composite == null) {
    return (
      <Card>
        <CardHeader
          title="Portfolio score"
          subtitle="how disciplined the book is vs your doctrine"
          divider={false}
        />
        <div className="px-6 pb-6 text-[13px] text-tertiary leading-relaxed">
          Score builds once your agent runs /portfolio-check.
        </div>
      </Card>
    );
  }

  const composite = score.composite;
  const tone = bandTone(composite);
  const dims = score.dimensions ?? [];
  const levers = (score.levers ?? []).slice(0, 3);

  return (
    <Card>
      <CardHeader
        title="Portfolio score"
        subtitle="how disciplined the book is vs your doctrine"
        divider={false}
      />

      {/* Hero: big composite numeral + grade chip + band-tinted gauge */}
      <div className="px-6 pb-5">
        <div className="flex items-end gap-3">
          <span
            className="mono-true text-[52px] leading-none font-semibold tracking-[-0.02em] text-primary tabular-nums"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {composite}
          </span>
          <span className="text-[13px] text-tertiary mb-2">/ 100</span>
          {score.grade && (
            <span
              className="mono-true text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-full mb-1.5"
              style={{ background: tone.tint, color: tone.fg }}
            >
              {score.grade}
            </span>
          )}
        </div>

        {/* Thin gauge bar, tinted by band */}
        <div
          className="mt-3 h-1.5 w-full rounded-full overflow-hidden"
          style={{ background: "var(--bg-subtle)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.max(0, Math.min(100, composite))}%`,
              background: tone.fg,
            }}
          />
        </div>

        <p className="mt-3 text-[12.5px] text-secondary leading-snug">
          {bandSummary(composite)}
        </p>
      </div>

      {/* Dimensions — single-line rows */}
      {dims.length > 0 && (
        <section className="px-6 py-5" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="text-[11px] font-medium text-tertiary mb-3">
            The six dimensions
          </div>
          <ul>
            {dims.map((d, i) => {
              const accent = statusTone(d.status);
              const clamped = Math.max(0, Math.min(100, d.score));
              return (
                <li
                  key={d.key}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-3 py-2.5"
                  style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}
                >
                  <span className="text-[12.5px] text-primary truncate">
                    {d.label}
                  </span>
                  <span className="text-[11.5px] text-tertiary truncate leading-snug min-w-0">
                    {d.detail}
                  </span>
                  <span className="flex items-center gap-2 shrink-0 justify-self-end">
                    <span
                      className="h-1.5 w-12 rounded-full overflow-hidden hidden sm:inline-block"
                      style={{ background: "var(--bg-subtle)" }}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${clamped}%`, background: accent }}
                      />
                    </span>
                    <span
                      className="mono-true text-[12px] font-semibold tabular-nums w-7 text-right"
                      style={{ color: accent }}
                    >
                      {d.score}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Levers — top 3 fixes */}
      {levers.length > 0 && (
        <section className="px-6 py-5" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="text-[11px] font-medium text-tertiary mb-3">
            Raise your score
          </div>
          <ul className="space-y-3">
            {levers.map((lev) => (
              <LeverRow key={lev.id} lever={lev} />
            ))}
          </ul>
        </section>
      )}

      {score.note && (
        <div
          className="px-6 py-4 text-[11.5px] text-tertiary leading-snug"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {score.note}
        </div>
      )}
    </Card>
  );
}

// ---------- Lever row ----------
// `lever.ticker` is carried through so a brand avatar can lead the row once a
// shared avatar primitive lands. None exists today, so we render text-only and
// keep the column out rather than statically importing a phantom module.
function LeverRow({ lever }: { lever: ScoreLever }) {
  return (
    <li className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-primary leading-snug truncate">
          {lever.action}
        </span>
        <span className="block text-[11.5px] text-tertiary leading-snug truncate mt-0.5">
          {lever.why}
        </span>
      </span>
      <span
        className="mono-true text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full shrink-0"
        style={{ background: "var(--brand-tint)", color: "var(--brand)" }}
      >
        +{lever.scoreGain}
      </span>
    </li>
  );
}

// ---------- Skeleton ----------
// Shown only on the true first load of the session. Mirrors the card layout
// so there's no jump when content arrives.
function ScoreSkeleton() {
  return (
    <Card>
      <CardHeader
        title="Portfolio score"
        subtitle="how disciplined the book is vs your doctrine"
        divider={false}
      />
      <div className="px-6 pb-5">
        <div className="flex items-end gap-3">
          <div
            className="h-12 w-24 rounded animate-pulse"
            style={{ background: "var(--bg-subtle)" }}
          />
          <div
            className="h-5 w-10 rounded-full animate-pulse mb-1.5"
            style={{ background: "var(--bg-subtle)" }}
          />
        </div>
        <div
          className="mt-4 h-1.5 w-full rounded-full animate-pulse"
          style={{ background: "var(--bg-subtle)" }}
        />
        <div
          className="mt-3 h-3 w-2/3 rounded animate-pulse"
          style={{ background: "var(--bg-subtle)" }}
        />
      </div>
      <section className="px-6 py-5" style={{ borderTop: "1px solid var(--border)" }}>
        <ul>
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 py-2.5"
              style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}
            >
              <div
                className="h-3 w-24 rounded animate-pulse"
                style={{ background: "var(--bg-subtle)" }}
              />
              <div
                className="h-3 w-10 rounded animate-pulse"
                style={{ background: "var(--bg-subtle)" }}
              />
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
