"use client";

/**
 * AllocationTab — strategic role-bucket view of the portfolio.
 *
 * Collapses the IN equity / US equity / MF / Bonds silos into ONE lens
 * organized by role bucket (compounders / growth / cyclicals / defensives /
 * hedges / debt-equiv / cash). Each section shows current % vs target band,
 * drift indicator, mini progress bar, and the holdings in that bucket.
 *
 * Holdings are clickable — they open the existing PerTickerDrawer via the
 * PerTickerCtx provider wired in app/page.tsx.
 *
 * Source of truth: /api/allocation → lib/allocation.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { CompactStat } from "./ui";

type PerTickerMarket = "IN" | "US" | "MF" | "BONDS";
type PerTickerOpen = { ticker: string; market: PerTickerMarket } | null;
type OpenTickerFn = (t: PerTickerOpen) => void;

type Role =
  | "compounders"
  | "growth"
  | "cyclicals"
  | "defensives"
  | "hedges"
  | "debt-equiv"
  | "cash"
  | "unclassified";

type Holding = {
  ticker: string;
  company: string;
  market: "IN" | "US" | "MF" | "BONDS" | "CASH";
  valueINR: number;
  weightPct: number;
  pnlPct: number;
  thesisHealth?: "green" | "amber" | "red";
  role: Role;
};

type RoleBucket = {
  role: Role;
  valueINR: number;
  weightPct: number;
  targetPct: number;
  band: [number, number];
  drift: number;
  driftStatus: "ok" | "soft" | "hard";
  holdings: Holding[];
};

type Payload = {
  total: number;
  roles: RoleBucket[];
};

const ROLE_LABEL: Record<Role, string> = {
  compounders: "Compounders",
  growth: "Growth",
  cyclicals: "Cyclicals",
  defensives: "Defensives",
  hedges: "Hedges",
  "debt-equiv": "Debt-equiv",
  cash: "Cash",
  unclassified: "Unclassified",
};

const ROLE_BLURB: Record<Role, string> = {
  compounders: "Slow, durable, buy-and-hold core",
  growth: "High-conviction thematic, higher beta",
  cyclicals: "Regime-dependent, trim and add",
  defensives: "Lower beta, capital preservation",
  hedges: "Gold + silver tail-risk insurance",
  "debt-equiv": "Bonds + arbitrage; yield + preservation",
  cash: "Wallet float — not invested",
  unclassified: "Untagged — assign a role in your holdings notes",
};

function fmtINR(n: number | undefined): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtSignedPct(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}pp`;
}

function fmtSignedReturn(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function pctToneColor(n: number | undefined): string {
  if (n === undefined || !isFinite(n)) return "var(--text-tertiary)";
  if (n > 0) return "var(--pos)";
  if (n < 0) return "var(--neg)";
  return "var(--text-secondary)";
}

function driftColor(status: "ok" | "soft" | "hard"): string {
  if (status === "ok") return "var(--text-tertiary)";
  if (status === "soft") return "var(--warn)";
  return "var(--neg)";
}

function driftLabel(drift: number, status: "ok" | "soft" | "hard"): string {
  if (status === "ok") return "within band";
  if (drift > 0) return "overweight";
  return "underweight";
}

function marketTag(m: Holding["market"]): string {
  if (m === "IN") return "IN";
  if (m === "US") return "US";
  if (m === "MF") return "MF";
  if (m === "BONDS") return "BND";
  return "—";
}

function marketForDrawer(m: Holding["market"]): PerTickerMarket | null {
  if (m === "CASH") return null;
  return m as PerTickerMarket;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────

export default function AllocationTab({
  onOpenTicker,
}: {
  onOpenTicker?: OpenTickerFn;
}) {
  const openTicker: OpenTickerFn = onOpenTicker ?? (() => {});
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch("/api/allocation")
      .then((r) => r.json())
      .then((d: Payload | { error: string }) => {
        if (cancelled) return;
        if ("error" in d) setErr(d.error);
        else setData(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    if (!data) return null;
    const byRole = new Map<Role, number>();
    for (const r of data.roles) byRole.set(r.role, r.weightPct);
    const equityPct =
      (byRole.get("compounders") ?? 0) +
      (byRole.get("growth") ?? 0) +
      (byRole.get("cyclicals") ?? 0) +
      (byRole.get("defensives") ?? 0);
    const debtPct = byRole.get("debt-equiv") ?? 0;
    const hedgesPct = byRole.get("hedges") ?? 0;
    // Equity target: compounders 30 + growth 25 + cyclicals 15 + defensives 10 = 80
    return {
      total: data.total,
      equityPct,
      equityTarget: 80,
      debtPct,
      debtTarget: 15,
      hedgesPct,
      hedgesTarget: 5,
    };
  }, [data]);

  return (
    <section className="space-y-8">
      <header className="flex items-center justify-between gap-5 flex-wrap px-1.5">
        <h1
          className="text-[20px] md:text-[24px] leading-[1.05] font-black tracking-[-0.02em] text-primary uppercase"
          style={{
            fontFamily: "var(--font-display-wide), system-ui, sans-serif",
            fontStretch: "120%",
          }}
        >
          Allocation
        </h1>
      </header>

      {loading && !data && <SkeletonStrip />}

      {err && (
        <div
          className="rounded-lg p-4 text-[12.5px] text-neg"
          style={{
            background: "var(--neg-tint)",
            border: "1px solid var(--border)",
          }}
        >
          Couldn’t load allocation: {err}
        </div>
      )}

      {!loading && !err && data && data.total === 0 && (
        <div className="surface rounded-lg p-10 text-sm text-center text-tertiary">
          No portfolio data yet. Run /portfolio-check to populate.
        </div>
      )}

      {summary && data && data.total > 0 && (
        <div
          className="grid grid-cols-2 md:grid-cols-4 rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <CompactStat
            label="Total invested"
            value={`₹${fmtINR(summary.total)}`}
            sub="all silos combined"
          />
          <CompactStat
            label="Equity"
            value={fmtPct(summary.equityPct, 1)}
            sub={`target ${summary.equityTarget}%`}
            accent={
              Math.abs(summary.equityPct - summary.equityTarget) > 5
                ? "neg"
                : undefined
            }
          />
          <CompactStat
            label="Debt-equiv"
            value={fmtPct(summary.debtPct, 1)}
            sub={`target ${summary.debtTarget}%`}
            accent={
              Math.abs(summary.debtPct - summary.debtTarget) > 5
                ? "neg"
                : undefined
            }
          />
          <CompactStat
            label="Hedges"
            value={fmtPct(summary.hedgesPct, 1)}
            sub={`target ${summary.hedgesTarget}%`}
            accent={
              Math.abs(summary.hedgesPct - summary.hedgesTarget) > 3
                ? "neg"
                : undefined
            }
          />
        </div>
      )}

      {data && data.total > 0 && (
        <ul className="list-stagger flex flex-col gap-4">
          {data.roles.map((bucket, i) => (
            <li key={bucket.role} style={{ ["--idx" as string]: i }}>
              <RoleSection bucket={bucket} openTicker={openTicker} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Role section
// ─────────────────────────────────────────────────────────────────────────────

function RoleSection({
  bucket,
  openTicker,
}: {
  bucket: RoleBucket;
  openTicker: OpenTickerFn;
}) {
  // Hide the cash bucket entirely when there's no float to talk about.
  if (bucket.role === "cash" && bucket.holdings.length === 0) return null;
  return (
    <article
      className="surface rounded-lg overflow-hidden"
      style={{ border: "1px solid var(--border)" }}
    >
      <RoleHeader bucket={bucket} />
      {bucket.holdings.length > 0 ? (
        <ul className="flex flex-col px-3 md:px-5 pb-1">
          {bucket.holdings.map((h, i) => (
            <li
              key={`${h.market}-${h.ticker}-${i}`}
              className="relative py-3.5 px-1"
              style={{
                borderTop:
                  i > 0 ? "1px solid var(--border)" : undefined,
              }}
            >
              <HoldingRow h={h} openTicker={openTicker} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-6 py-7 text-[12px] text-tertiary">
          No holdings in this bucket.
        </div>
      )}
    </article>
  );
}

function RoleHeader({ bucket }: { bucket: RoleBucket }) {
  // The catch-all bucket has no SAA target — show value + weight only, and skip
  // the drift readout / band meter (which would misleadingly read "within band").
  const isUnclassified = bucket.role === "unclassified";
  const dColor = driftColor(bucket.driftStatus);
  const directionArrow =
    bucket.driftStatus === "ok"
      ? null
      : bucket.drift > 0
      ? "▼" // overweight → trim direction
      : "▲"; // underweight → add direction
  return (
    <div
      className="px-6 py-5 flex flex-col gap-4"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] md:text-[16px] font-semibold tracking-[-0.005em] text-primary flex items-baseline gap-2 flex-wrap">
            <span>{ROLE_LABEL[bucket.role]}</span>
            <span className="text-[11.5px] text-tertiary font-normal">
              {ROLE_BLURB[bucket.role]}
            </span>
          </h2>
          <div className="eyebrow flex items-center gap-1.5 mt-1.5">
            <span>₹{fmtINR(bucket.valueINR)}</span>
            <Dot />
            <span className="mono-true">{fmtPct(bucket.weightPct, 1)}</span>
            {!isUnclassified && (
              <>
                <Dot />
                <span>
                  target {bucket.targetPct}% (band {bucket.band[0]}-{bucket.band[1]}%)
                </span>
              </>
            )}
          </div>
        </div>
        {!isUnclassified && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            <div
              className="flex items-baseline gap-1.5 mono-true text-[14px] font-semibold tabular-nums"
              style={{ color: dColor }}
            >
              {directionArrow && (
                <span aria-hidden style={{ fontSize: 10 }}>
                  {directionArrow}
                </span>
              )}
              <span>{fmtSignedPct(bucket.drift, 1)}</span>
            </div>
            <span
              className="eyebrow font-medium uppercase tracking-[0.04em]"
              style={{ color: dColor }}
            >
              {driftLabel(bucket.drift, bucket.driftStatus)}
            </span>
          </div>
        )}
      </div>
      {!isUnclassified && (
        <BandMeter
          weight={bucket.weightPct}
          target={bucket.targetPct}
          band={bucket.band}
          status={bucket.driftStatus}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Band meter — horizontal track with band shading + target tick + needle.
// ─────────────────────────────────────────────────────────────────────────────

function BandMeter({
  weight,
  target,
  band,
  status,
}: {
  weight: number;
  target: number;
  band: [number, number];
  status: "ok" | "soft" | "hard";
}) {
  // Track spans 0..max-of(weight, band[1]+5, target+5) to keep marker visible.
  const trackMax = Math.max(weight, band[1] + 5, target + 5);
  const pct = (v: number) => `${Math.min((v / trackMax) * 100, 100)}%`;
  const bandLeft = pct(band[0]);
  const bandWidth = pct(band[1] - band[0]).replace("%", "") + "%";
  const bandPx = `calc(${pct(band[1])} - ${pct(band[0])})`;
  const needle = pct(weight);
  const needleColor = driftColor(status);
  return (
    <div
      className="relative h-2 rounded-full"
      style={{ background: "var(--bg-subtle)" }}
    >
      {/* band shaded region */}
      <div
        className="absolute top-0 bottom-0 rounded-full"
        style={{
          left: bandLeft,
          width: bandPx,
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
        }}
      />
      {/* target tick */}
      <div
        className="absolute top-[-3px] bottom-[-3px] w-px"
        style={{
          left: pct(target),
          background: "var(--text-tertiary)",
          opacity: 0.7,
        }}
        aria-label={`target ${target}%`}
      />
      {/* needle */}
      <div
        className="absolute top-[-2px] w-[3px] rounded-sm"
        style={{
          left: needle,
          height: 12,
          background: needleColor,
          transform: "translateX(-1.5px)",
        }}
        aria-label={`current ${weight.toFixed(1)}%`}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Holding row
// ─────────────────────────────────────────────────────────────────────────────

function HoldingRow({
  h,
  openTicker,
}: {
  h: Holding;
  openTicker: OpenTickerFn;
}) {
  const market = marketForDrawer(h.market);
  const interactive = !!market;
  const handleClick = () => {
    if (!market) return;
    openTicker({ ticker: h.ticker, market });
  };
  const inner = (
    <div className="flex items-center gap-3.5">
      <TickerChip ticker={h.ticker} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-primary font-medium leading-snug truncate">
          {h.company}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-5">
        <span className="text-[10.5px] text-tertiary uppercase tracking-[0.04em] mono-true">
          {marketTag(h.market)}
        </span>
        <span className="mono-true text-[12.5px] text-secondary tabular-nums w-[88px] text-right">
          ₹{fmtINR(h.valueINR)}
        </span>
        <span className="mono-true text-[12px] text-tertiary tabular-nums w-[52px] text-right">
          {fmtPct(h.weightPct, 1)}
        </span>
        <span
          className="mono-true text-[12px] tabular-nums w-[64px] text-right"
          style={{ color: pctToneColor(h.pnlPct) }}
        >
          {fmtSignedReturn(h.pnlPct, 1)}
        </span>
      </div>
    </div>
  );
  if (!interactive) {
    return <div className="px-0">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="block w-full text-left accent-ring rounded-md hover:bg-[var(--bg-subtle)] transition-colors px-1"
    >
      {inner}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function TickerChip({ ticker }: { ticker: string }) {
  return (
    <span
      className="mono-true text-[10.5px] tracking-[0.01em] px-1.5 py-[2px] rounded text-primary shrink-0"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      {ticker}
    </span>
  );
}

function Dot() {
  return (
    <span
      className="inline-block w-[3px] h-[3px] rounded-full opacity-60"
      style={{ background: "currentColor" }}
      aria-hidden
    />
  );
}

function SkeletonStrip() {
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 rounded-lg overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[110px] animate-pulse"
          style={{
            borderTop: "1px solid var(--border)",
            borderLeft: i > 0 ? "1px solid var(--border)" : undefined,
            background: "var(--bg-subtle)",
          }}
        />
      ))}
    </div>
  );
}
