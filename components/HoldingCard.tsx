"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getMeta, tickerColor } from "@/lib/tickerMeta";
import LogoImg from "./LogoImg";
import { DataPoint } from "@/components/ui";

type Score = { value: number | null; reason?: string };
type Scores = {
  fundamentals?: Score;
  technicals?: Score;
  sentiment?: Score;
};
type Holding = {
  ticker: string;
  qty: number;
  avgPrice?: number;
  ltp: number;
  value: number;
  weight: number;
  pnlPct?: number;
  dayChangePct?: number;
  role?: string;
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
  scores?: Scores;
};

function scoreColor(v: number | null | undefined) {
  if (v === null || v === undefined) return "var(--border)";
  if (v >= 7) return "var(--pos)";
  if (v >= 4) return "var(--warn)";
  return "var(--neg)";
}
// Soft tint for chip backgrounds. Falls back to neutral surface when score is null.
function scoreTint(v: number | null | undefined) {
  if (v === null || v === undefined) return "var(--bg-subtle)";
  if (v >= 7) return "var(--pos-tint, rgba(34,197,94,0.12))";
  if (v >= 4) return "rgba(244, 180, 0, 0.12)";
  return "var(--neg-tint, rgba(220,38,38,0.12))";
}

function thesisColor(h?: Holding["thesisHealth"]) {
  if (h === "green") return "var(--pos)";
  if (h === "amber") return "var(--warn)";
  if (h === "red") return "var(--neg)";
  return "var(--border)";
}
function thesisLabel(h?: Holding["thesisHealth"]) {
  if (h === "green") return "thesis intact";
  if (h === "amber") return "thesis on watch";
  if (h === "red") return "thesis broken";
  return "no thesis flag";
}

function fmtINR(n: number | undefined) {
  if (n === undefined || n === null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | undefined, digits = 1) {
  if (n === undefined || n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
function pctCls(n: number | undefined) {
  if (n === undefined) return "text-tertiary";
  if (n > 0) return "text-pos";
  if (n < 0) return "text-neg";
  return "text-secondary";
}
function pnlAmount(h: Holding) {
  if (h.pnlPct === undefined || h.avgPrice === undefined) return undefined;
  return (h.pnlPct / 100) * h.avgPrice * h.qty;
}

export default function HoldingCard({
  h,
  onOpen,
}: {
  h: Holding;
  onOpen?: (ticker: string) => void;
}) {
  const meta = getMeta(h.ticker);
  const [open, setOpen] = useState(false);
  const handleClick = onOpen ? () => onOpen(h.ticker) : () => setOpen(true);

  return (
    <>
      <button
        onClick={handleClick}
        role="button"
        tabIndex={0}
        className="relative w-[calc(100%+3rem)] md:w-[calc(100%+5rem)] text-left grid grid-cols-[40px_1fr_70px_70px] md:grid-cols-[40px_1fr_100px_100px_70px] -mx-6 md:-mx-10 gap-x-3 items-center py-5 px-10 md:px-16 transition-colors hover:bg-[var(--bg-subtle)] cursor-pointer after:content-[''] after:absolute after:bottom-0 after:left-[92px] md:after:left-[116px] after:right-10 md:after:right-16 after:h-px after:bg-[var(--border)]"
      >
        <LogoImg ticker={h.ticker} domain={meta.domain} size={36} />

        <div className="min-w-0">
          <div className="font-semibold mono leading-tight text-primary text-[13px]">
            {h.ticker}
          </div>
          <div className="text-[11px] text-tertiary truncate leading-tight mt-0.5">
            {meta.sector || meta.name}
          </div>
        </div>

        {/* Value column (md+) */}
        <div className="hidden md:block text-right mono text-[14px] font-semibold text-primary">
          ₹{fmtINR(h.value)}
        </div>

        {/* Today */}
        <div className={`text-right text-[13px] mono font-medium ${pctCls(h.dayChangePct)}`}>
          {fmtPct(h.dayChangePct, 2)}
        </div>

        {/* PnL */}
        <div className={`text-right text-[13px] mono font-medium ${pctCls(h.pnlPct)}`}>
          {fmtPct(h.pnlPct, 1)}
        </div>
      </button>

      {open && <DetailsModal h={h} onClose={() => setOpen(false)} />}
    </>
  );
}

function DetailsModal({ h, onClose }: { h: Holding; onClose: () => void }) {
  const meta = getMeta(h.ticker);
  const pnl = pnlAmount(h);
  const [fundamentals, setFundamentals] = useState<Record<
    string,
    number | undefined
  > | null>(null);
  const [fundLoading, setFundLoading] = useState(false);

  useEffect(() => {
    if (meta.asset !== "equity") return;
    setFundLoading(true);
    fetch(`/api/fundamentals/${h.ticker}`)
      .then((r) => r.json())
      .then((r) => setFundamentals(r.data || null))
      .catch(() => setFundamentals(null))
      .finally(() => setFundLoading(false));
  }, [h.ticker, meta.asset]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start gap-4 pb-5">
          <LogoImg ticker={h.ticker} domain={meta.domain} size={56} rounded="xl" />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold mono text-primary">
              {h.ticker}
            </div>
            <div className="text-sm text-secondary">{meta.name}</div>
            {meta.sector && (
              <div className="text-[11px] text-tertiary mt-0.5">
                {meta.sector}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Position — data points on top, grouped */}
        <Section title="Position">
          <div className="grid grid-cols-3 gap-x-5 gap-y-4">
            <DataPoint label="Market value" value={`₹${fmtINR(h.value)}`} emphasis />
            <DataPoint label="Weight" value={fmtPct(h.weight, 1)} />
            <DataPoint
              label="Today"
              value={fmtPct(h.dayChangePct, 2)}
              accent={pctCls(h.dayChangePct)}
            />
            <DataPoint label="Qty" value={String(h.qty)} />
            <DataPoint label="LTP" value={`₹${h.ltp.toFixed(2)}`} />
            {h.avgPrice !== undefined && (
              <DataPoint label="Avg cost" value={`₹${h.avgPrice.toFixed(2)}`} />
            )}
          </div>
        </Section>

        {/* P&L — emphasized */}
        <Section title="Performance">
          <DataPoint
            label="Total P&L"
            value={fmtPct(h.pnlPct, 1)}
            sub={
              pnl !== undefined
                ? `${pnl >= 0 ? "+" : ""}₹${fmtINR(Math.round(pnl))}`
                : undefined
            }
            accent={pctCls(h.pnlPct)}
            emphasis
          />
        </Section>

        {/* Thesis — narrative */}
        {(h.role || h.thesisHealth) && (
          <Section title="Thesis">
            <div className="space-y-3">
              {h.role && (
                <div className="text-[13px] text-primary leading-relaxed">
                  {h.role}
                </div>
              )}
              {h.thesisHealth && (
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ background: thesisColor(h.thesisHealth) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-tertiary mb-0.5 font-medium">
                      {thesisLabel(h.thesisHealth)}
                    </div>
                    {h.thesisNote && (
                      <div className="text-secondary text-[13px] leading-relaxed">
                        {h.thesisNote}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Scores */}
        {h.scores && (
          <Section title="Scores · 0–10">
            <div className="space-y-2">
              <ScoreRow name="Fundamentals" score={h.scores.fundamentals} hint="Quality + growth + balance sheet + moat. Higher = stronger underlying business." />
              <ScoreRow name="Technicals" score={h.scores.technicals} hint="Price vs 50/200-DMA, RSI, relative strength vs Nifty. Higher = trend works for you." />
              <ScoreRow name="Sentiment" score={h.scores.sentiment} hint="Net of last 7 days news flow + analyst tone. Higher = market mood is positive." />
              <p className="text-[10px] text-tertiary leading-relaxed pt-1">
                Subjective scores set by Claude during portfolio checks. Treat as
                directional, not authoritative — they go stale fast.
              </p>
            </div>
          </Section>
        )}

        {/* Fundamentals from screener */}
        {meta.asset === "equity" && (
          <Section title="Fundamentals · screener.in">
            {fundLoading && (
              <div className="text-xs text-tertiary">Loading…</div>
            )}
            {!fundLoading && !fundamentals && (
              <div className="text-xs text-tertiary">Not available.</div>
            )}
            {fundamentals && (
              <div className="grid grid-cols-3 gap-x-5 gap-y-4">
                <DataPoint label="P/E" value={fundamentals.pe?.toString() || "—"} small />
                <DataPoint
                  label="ROCE"
                  value={fundamentals.roce ? `${fundamentals.roce}%` : "—"}
                  small
                />
                <DataPoint
                  label="ROE"
                  value={fundamentals.roe ? `${fundamentals.roe}%` : "—"}
                  small
                />
                <DataPoint label="D/E" value={fundamentals.debtToEquity?.toString() || "—"} small />
                <DataPoint
                  label="Sales 3Y"
                  value={
                    fundamentals.salesGrowth3Y !== undefined
                      ? `${fundamentals.salesGrowth3Y}%`
                      : "—"
                  }
                  small
                />
                <DataPoint
                  label="Profit 3Y"
                  value={
                    fundamentals.profitGrowth3Y !== undefined
                      ? `${fundamentals.profitGrowth3Y}%`
                      : "—"
                  }
                  small
                />
                <DataPoint label="P/B" value={fundamentals.priceToBook?.toString() || "—"} small />
                <DataPoint
                  label="Div Yld"
                  value={
                    fundamentals.dividendYield !== undefined
                      ? `${fundamentals.dividendYield}%`
                      : "—"
                  }
                  small
                />
                <DataPoint
                  label="Promoter"
                  value={
                    fundamentals.promoterHolding !== undefined
                      ? `${fundamentals.promoterHolding}%`
                      : "—"
                  }
                  small
                />
              </div>
            )}
            {meta.domain && (
              <a
                href={`https://www.screener.in/company/${h.ticker}/consolidated/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[var(--brand)] hover:underline mt-4 inline-block"
              >
                View full profile on screener.in →
              </a>
            )}
          </Section>
        )}
      </div>
    </div>,
    document.body
  );
}

function Section({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`pt-5 mt-5 ${className}`}
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div className="text-[11px] font-medium text-tertiary mb-4">{title}</div>
      {children}
    </section>
  );
}

function ScoreChip({
  label,
  score,
  tooltip,
}: {
  label: string;
  score?: Score;
  tooltip: string;
}) {
  const v = score?.value;
  const display = v === null || v === undefined ? "—" : `${v}`;
  const fullTip = score?.reason ? `${tooltip} — ${score.reason}` : tooltip;
  return (
    <div
      title={fullTip}
      className="flex-1 flex items-center justify-between rounded-lg px-2.5 py-1.5"
      style={{ background: scoreTint(v) }}
    >
      <span
        className="text-[11px] font-medium"
        style={{ color: scoreColor(v), opacity: 0.9 }}
      >
        {label}
      </span>
      <span
        className="mono font-bold text-base tabular-nums"
        style={{ color: scoreColor(v) }}
      >
        {display}
      </span>
    </div>
  );
}

function ScoreRow({
  name,
  score,
  hint,
}: {
  name: string;
  score?: Score;
  hint: string;
}) {
  const v = score?.value;
  const display = v === null || v === undefined ? "—" : `${v}`;
  const color = scoreColor(v);
  return (
    <div className="surface-subtle rounded-xl p-3.5 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-semibold text-primary w-28 shrink-0">
          {name}
        </span>
        <div
          className="flex-1 h-2 rounded-full overflow-hidden"
          style={{ background: "rgba(0,0,0,0.08)" }}
        >
          <div
            style={{
              width:
                v === null || v === undefined ? "0%" : `${(v / 10) * 100}%`,
              background: color,
              height: "100%",
              transition: "width 200ms ease",
            }}
          />
        </div>
        <span className="text-[14px] mono font-bold tabular-nums w-12 text-right text-primary">
          {display}
          <span className="text-[10px] opacity-50 font-normal">/10</span>
        </span>
      </div>
      {score?.reason && (
        <p className="text-[12px] text-secondary leading-relaxed">
          {score.reason}
        </p>
      )}
      <p className="text-[11px] text-tertiary opacity-80 italic leading-snug">
        {hint}
      </p>
    </div>
  );
}
