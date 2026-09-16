"use client";

/**
 * PerTickerDrawer. Centered modal-card opened by clicking any holding row on
 * the IN / US / MF / Bonds tabs. Joins position state, tagged news, last
 * earnings print, forward outlook, open tasks, and recent decisions for one
 * ticker.
 *
 * Mirrors the modal-backdrop + modal-card pattern from NewsDetailModal and
 * TaskExplainerModal: portal, Esc + backdrop close, click inside doesn't
 * close. No focus trap (matches existing convention).
 *
 * Lazy-loads /api/per-ticker/[ticker]?market=... when `ticker` becomes
 * non-null. Each section gracefully empties when its silo has no data.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Direction = "+" | "-" | "neutral";
type Magnitude = "low" | "med" | "high";
type Confidence = "low" | "med" | "high";
export type Market = "IN" | "US" | "MF" | "BONDS";

type Tagging = {
  tickers: string[];
  direction: Direction;
  magnitude: Magnitude;
  mechanism?: string;
  sector?: string;
};

type TaggedArticle = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet?: string;
  region: "IN" | "US" | "GLOBAL";
  tagging: Tagging;
};

type PerTicker = {
  ticker: string;
  company?: string;
  market: Market;
  holding?: {
    qty: number;
    avgPrice: number;
    currentPrice: number;
    valueINR: number;
    pnlPct: number;
    weight?: number;
    role?: string;
    thesisHealth?: "green" | "amber" | "red";
    thesisNote?: string;
  };
  news: TaggedArticle[];
  earnings?: {
    period: string;
    reportedAt: string;
    revenueYoYPct?: number;
    epsYoYPct?: number;
    brief: string;
  };
  outlook?: {
    direction: Direction;
    magnitude: Magnitude;
    confidence: Confidence;
    meaningForUser: string;
    watchFor: string[];
  };
  openTasks: {
    id: string;
    heading: string;
    priority: string;
    subheading: string;
  }[];
  recentDecisions: {
    id: string;
    date: string;
    action: string;
    qty: number;
    price: number;
    verdict: string;
  }[];
};

type Props = {
  ticker: string | null;
  market: Market | null;
  onClose: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatters + tokens
// ─────────────────────────────────────────────────────────────────────────────

function fmtINR(n: number | undefined): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n: number | undefined, digits = 2): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtPrice(n: number | undefined, market: Market): string {
  if (n === undefined || n === null || !isFinite(n)) return "—";
  const sym = market === "US" ? "$" : "₹";
  if (n >= 10000) return `${sym}${Math.round(n).toLocaleString("en-IN")}`;
  return `${sym}${n.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${mon} ${day}`;
}

function fmtDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day} · ${hh}:${mm}`;
}

function dirLabel(d: Direction): string {
  if (d === "+") return "Bullish";
  if (d === "-") return "Bearish";
  return "Neutral";
}

function dirGlyph(d: Direction): string {
  if (d === "+") return "▲";
  if (d === "-") return "▼";
  return "•";
}

function dirToken(d: Direction): { color: string; bg: string } {
  if (d === "+") return { color: "var(--pos)", bg: "var(--pos-tint)" };
  if (d === "-") return { color: "var(--neg)", bg: "var(--neg-tint)" };
  return { color: "var(--text-tertiary)", bg: "var(--bg-subtle)" };
}

function magCount(m: Magnitude): number {
  return m === "high" ? 3 : m === "med" ? 2 : 1;
}

function confCount(c: Confidence): number {
  return c === "high" ? 3 : c === "med" ? 2 : 1;
}

function pctToneColor(n: number | undefined): string {
  if (n === undefined || !isFinite(n)) return "var(--text-tertiary)";
  if (n > 0) return "var(--pos)";
  if (n < 0) return "var(--neg)";
  return "var(--text-secondary)";
}

function thesisColor(h?: "green" | "amber" | "red"): string {
  if (h === "green") return "var(--pos)";
  if (h === "amber") return "var(--warn)";
  if (h === "red") return "var(--neg)";
  return "var(--border)";
}

function thesisLabel(h?: "green" | "amber" | "red"): string {
  if (h === "green") return "thesis intact";
  if (h === "amber") return "thesis on watch";
  if (h === "red") return "thesis broken";
  return "no thesis flag";
}

function verdictColor(v: string): string {
  if (v === "good") return "var(--pos)";
  if (v === "bad") return "var(--neg)";
  return "var(--text-tertiary)";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function PerTickerDrawer({ ticker, market, onClose }: Props) {
  const [data, setData] = useState<PerTicker | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lazy-load when ticker becomes non-null.
  useEffect(() => {
    if (!ticker) {
      setData(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const qs = market ? `?market=${market}` : "";
    fetch(`/api/per-ticker/${encodeURIComponent(ticker)}${qs}`)
      .then((r) => r.json())
      .then((d: PerTicker | { error: string }) => {
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
  }, [ticker, market]);

  // Esc-to-close.
  useEffect(() => {
    if (!ticker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ticker, onClose]);

  if (typeof document === "undefined") return null;
  if (!ticker) return null;

  const mkt: Market = market ?? data?.market ?? "IN";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="per-ticker-title"
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg max-w-xl w-full max-h-[88vh] overflow-y-auto no-scrollbar"
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-5 px-7 pt-7 pb-5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-2">{mkt} · per-ticker</div>
            <h2
              id="per-ticker-title"
              className="text-[17px] md:text-[18px] leading-snug font-semibold text-primary tracking-[-0.01em] flex items-baseline gap-2 flex-wrap"
            >
              <span className="min-w-0 truncate">
                {data?.company ?? ticker}
              </span>
              <TickerChip ticker={ticker} />
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none accent-ring rounded-md shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-6 space-y-7">
          {loading && !data && <Skeleton />}

          {err && (
            <div
              className="rounded-lg p-3 text-[12.5px]"
              style={{
                background: "var(--neg-tint)",
                color: "var(--neg)",
                border: "1px solid var(--border)",
              }}
            >
              Couldn’t load: {err}
            </div>
          )}

          {data && (
            <>
              <PositionSection holding={data.holding} market={mkt} />
              <NewsSection items={data.news} />
              <EarningsSection earnings={data.earnings} />
              <OutlookSection outlook={data.outlook} />
              <TasksDecisionsSection
                tasks={data.openTasks}
                decisions={data.recentDecisions}
                market={mkt}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────

function PositionSection({
  holding,
  market,
}: {
  holding: PerTicker["holding"];
  market: Market;
}) {
  if (!holding) {
    return (
      <Section title="Position">
        <p className="text-[12px] text-tertiary">No active position recorded.</p>
      </Section>
    );
  }
  const ccy: Market = market;
  const cells: { label: string; value: string; tone?: string }[] = [];
  if (holding.qty) cells.push({ label: "Qty", value: fmtNum(holding.qty, 2) });
  if (holding.avgPrice)
    cells.push({ label: "Avg", value: fmtPrice(holding.avgPrice, ccy) });
  if (holding.currentPrice)
    cells.push({ label: "LTP", value: fmtPrice(holding.currentPrice, ccy) });
  if (holding.valueINR)
    cells.push({ label: "Value", value: `₹${fmtINR(holding.valueINR)}` });
  if (holding.pnlPct !== undefined && isFinite(holding.pnlPct))
    cells.push({
      label: "P&L",
      value: fmtPct(holding.pnlPct, 2),
      tone: pctToneColor(holding.pnlPct),
    });
  if (holding.weight !== undefined)
    cells.push({ label: "Weight", value: fmtPct(holding.weight, 1) });

  return (
    <Section title="Position">
      {cells.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-5 gap-y-4">
          {cells.map((c) => (
            <Stat key={c.label} label={c.label} value={c.value} tone={c.tone} />
          ))}
        </div>
      )}
      {(holding.role || holding.thesisHealth || holding.thesisNote) && (
        <div className="mt-5 flex flex-col gap-2">
          {holding.role && (
            <p className="text-[12.5px] text-primary leading-relaxed">
              {holding.role}
            </p>
          )}
          {holding.thesisHealth && (
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: thesisColor(holding.thesisHealth) }}
              />
              <span
                className="text-[11px] uppercase tracking-[0.02em] font-medium"
                style={{ color: thesisColor(holding.thesisHealth) }}
              >
                {thesisLabel(holding.thesisHealth)}
              </span>
            </div>
          )}
          {holding.thesisNote && (
            <p className="text-[12px] text-secondary leading-relaxed">
              {holding.thesisNote}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function NewsSection({ items }: { items: TaggedArticle[] }) {
  return (
    <Section title="News">
      {items.length === 0 ? (
        <p className="text-[12px] text-tertiary">No recent news.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((a, i) => {
            const dir = dirToken(a.tagging.direction);
            return (
              <li
                key={a.id}
                className={
                  i > 0
                    ? "pt-3 mt-3"
                    : ""
                }
                style={
                  i > 0
                    ? { borderTop: "1px solid var(--border)" }
                    : undefined
                }
              >
                <a
                  href={a.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block accent-ring rounded-md"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.02em] shrink-0 mt-0.5"
                      style={{ color: dir.color, background: dir.bg }}
                    >
                      <span aria-hidden style={{ fontSize: 9 }}>
                        {dirGlyph(a.tagging.direction)}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[13px] font-medium text-primary leading-snug">
                        {a.title}
                      </h4>
                      <div className="eyebrow flex items-center gap-1.5 mt-1">
                        <span>{a.source}</span>
                        <Dot />
                        <span>{fmtDateTime(a.publishedAt)}</span>
                      </div>
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function EarningsSection({
  earnings,
}: {
  earnings: PerTicker["earnings"];
}) {
  if (!earnings) {
    return (
      <Section title="Earnings">
        <p className="text-[12px] text-tertiary">No earnings data on file.</p>
      </Section>
    );
  }
  return (
    <Section title="Earnings">
      <div className="eyebrow flex items-center gap-1.5">
        <span>{earnings.period}</span>
        {earnings.reportedAt && (
          <>
            <Dot />
            <span>Reported {fmtDate(earnings.reportedAt)}</span>
          </>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {earnings.revenueYoYPct !== undefined && (
          <MetricChip
            label="Rev"
            value={`${fmtPct(earnings.revenueYoYPct, 0)} YoY`}
            tone={pctToneColor(earnings.revenueYoYPct)}
          />
        )}
        {earnings.epsYoYPct !== undefined && (
          // epsYoYPct carries net-income (profit) YoY, not per-share EPS.
          <MetricChip
            label="Profit"
            value={`${fmtPct(earnings.epsYoYPct, 0)} YoY`}
            tone={pctToneColor(earnings.epsYoYPct)}
          />
        )}
      </div>
      {earnings.brief && (
        <p className="mt-2.5 text-[12.5px] text-secondary leading-relaxed">
          {earnings.brief}
        </p>
      )}
    </Section>
  );
}

function OutlookSection({
  outlook,
}: {
  outlook: PerTicker["outlook"];
}) {
  if (!outlook) {
    return (
      <Section title="Outlook">
        <p className="text-[12px] text-tertiary">No outlook recorded.</p>
      </Section>
    );
  }
  const dir = dirToken(outlook.direction);
  return (
    <Section title="Outlook">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-baseline gap-2.5">
            <span
              aria-hidden
              className="text-[18px] leading-none"
              style={{ color: dir.color }}
            >
              {dirGlyph(outlook.direction)}
            </span>
            <span
              className="text-[20px] md:text-[22px] font-semibold tracking-[-0.01em] uppercase"
              style={{ color: dir.color }}
            >
              {dirLabel(outlook.direction)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <MagBars n={magCount(outlook.magnitude)} color={dir.color} />
            <span
              className="font-medium tracking-[0.02em] uppercase"
              style={{ color: dir.color }}
            >
              {outlook.magnitude} impact
            </span>
          </div>
        </div>
        <ConfidenceMeter level={outlook.confidence} />
      </div>

      {outlook.meaningForUser && (
        <div className="mt-5 flex flex-col gap-1.5">
          <span className="eyebrow">What this means for you</span>
          <p className="text-[12.5px] text-primary leading-relaxed">
            {outlook.meaningForUser}
          </p>
        </div>
      )}

      {outlook.watchFor.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          <span className="eyebrow">Watch for</span>
          <ul className="flex flex-col gap-1">
            {outlook.watchFor.map((w, i) => (
              <li
                key={i}
                className="text-[12px] text-secondary leading-snug flex items-start gap-2"
              >
                <span
                  aria-hidden
                  className="inline-block w-[3px] h-[3px] rounded-full mt-[7px] shrink-0"
                  style={{ background: "var(--text-tertiary)" }}
                />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function TasksDecisionsSection({
  tasks,
  decisions,
  market,
}: {
  tasks: PerTicker["openTasks"];
  decisions: PerTicker["recentDecisions"];
  market: Market;
}) {
  return (
    <Section title="Tasks & decisions">
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2">
            Open tasks
          </div>
          {tasks.length === 0 ? (
            <p className="text-[12px] text-tertiary">No open tasks.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline gap-2.5 text-[12.5px]"
                >
                  <span
                    className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-[2px] rounded shrink-0"
                    style={{
                      background: "var(--bg-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {t.priority}
                  </span>
                  <span className="text-primary flex-1 min-w-0">
                    {t.heading}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2">
            Recent decisions
          </div>
          {decisions.length === 0 ? (
            <p className="text-[12px] text-tertiary">No decisions logged.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {decisions.map((d) => (
                <li
                  key={d.id}
                  className="flex items-baseline gap-2.5 text-[12px] flex-wrap"
                >
                  <span className="mono-true text-tertiary shrink-0">
                    {d.id}
                  </span>
                  <span className="mono-true text-tertiary shrink-0">
                    {d.date}
                  </span>
                  <span className="text-primary min-w-0 flex-1 mono-true">
                    {d.action}
                    {d.qty ? ` ${fmtNum(d.qty, 2)}` : ""}
                    {d.price
                      ? ` @ ${fmtPrice(d.price, market)}`
                      : ""}
                  </span>
                  <span
                    className="text-[10px] uppercase tracking-wide font-medium shrink-0"
                    style={{ color: verdictColor(d.verdict) }}
                  >
                    {d.verdict}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="eyebrow uppercase tracking-wide font-medium mb-3">
        {title}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div
        className="mono-true text-[14px] font-semibold leading-none tabular-nums"
        style={{ color: tone ?? "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[11.5px]">
      <span className="text-tertiary uppercase tracking-[0.04em]">{label}</span>
      <span className="mono-true font-semibold" style={{ color: tone }}>
        {value}
      </span>
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

function TickerChip({ ticker }: { ticker: string }) {
  return (
    <span
      className="mono-true text-[11px] tracking-[0.01em] px-2 py-[3px] rounded text-primary shrink-0"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      {ticker}
    </span>
  );
}

function MagBars({ n, color }: { n: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block"
          style={{
            width: 3,
            height: i < n ? 10 : 7,
            background: i < n ? color : "currentColor",
            opacity: i < n ? 1 : 0.25,
            borderRadius: 0.5,
          }}
        />
      ))}
    </span>
  );
}

function ConfidenceMeter({ level }: { level: Confidence }) {
  const n = confCount(level);
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <span className="eyebrow">Confidence</span>
      <div
        className="flex items-center gap-[3px]"
        aria-label={`confidence ${level}`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block"
            style={{
              width: 10,
              height: 7,
              background:
                i < n ? "var(--text-primary)" : "var(--text-tertiary)",
              opacity: i < n ? 0.9 : 0.25,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg h-[72px] animate-pulse"
          style={{
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
          }}
        />
      ))}
    </div>
  );
}
