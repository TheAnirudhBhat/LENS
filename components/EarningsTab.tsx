"use client";

import { useEffect, useMemo, useState } from "react";
import { getMeta } from "@/lib/tickerMeta";
import {
  Segmented,
  Toolbar,
  FilterDropdown,
  type FilterOption,
} from "./ui";

// ---------- shared types ----------

type Direction = "+" | "-" | "neutral";
type Magnitude = "low" | "med" | "high";
type Confidence = "low" | "med" | "high";

type EarningsMetrics = {
  revenue?: number;
  revenueLabel?: string;
  revenueYoYPct?: number;
  eps?: number;
  epsYoYPct?: number;
  epsEstimate?: number;
  surprisePct?: number;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  profitMarginPct?: number;
};

type EarningsRecord = {
  ticker: string;
  company: string;
  market: "IN" | "US";
  period: string;
  reportedAt: string;
  metrics: EarningsMetrics;
  brief: string;
  sourceUrl: string;
  sourceName: string;
  nextEarningsDate?: string;
  sector?: string;
};

type OutlookEntry = {
  ticker: string;
  period?: string;
  direction: Direction;
  magnitude: Magnitude;
  confidence: Confidence;
  meaningForUser: string;
  watchFor: string[];
};

type DataResp = {
  updatedAt: string | null;
  records: EarningsRecord[];
  cacheStatus?: "cached" | "fresh" | "stale" | "seed";
};

type OutlookResp = {
  updatedAt: string | null;
  items: OutlookEntry[];
};

type Joined = EarningsRecord & {
  outlook?: OutlookEntry;
  position?: PositionContext;
};

type PositionContext = {
  qty?: number;
  avgPrice?: number;
  currentPrice?: number;
  pnlPct?: number;
  currency: "INR" | "USD";
};

type SnapshotHolding = {
  ticker?: string;
  qty?: number;
  avgPrice?: number;
  ltp?: number;
  pnlPct?: number;
};

type UsPosition = {
  ticker?: string;
  quantity?: number;
  avgPriceUSD?: number;
  currentPriceUSD?: number;
  pnlPct?: number;
};

type SurpriseFilter = "all" | "beat" | "miss" | "inline";
type MarketFilter = "all" | "IN" | "US";

// ---------- formatters ----------

function ageHoursFromISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${mon} ${day}`;
}

function dirLabel(d: Direction): string {
  if (d === "+") return "Bullish";
  if (d === "-") return "Bearish";
  return "Neutral";
}

function dirColor(d: Direction): string {
  if (d === "+") return "var(--pos)";
  if (d === "-") return "var(--neg)";
  return "var(--text-tertiary)";
}

function dirGlyph(d: Direction): string {
  if (d === "+") return "▲";
  if (d === "-") return "▼";
  return "•";
}

function magCount(m: Magnitude): number {
  return m === "high" ? 3 : m === "med" ? 2 : 1;
}

function pctText(v: number | undefined, digits = 0): string | null {
  if (v === undefined || isNaN(v)) return null;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtPrice(v: number | undefined, ccy: "INR" | "USD"): string | null {
  if (v === undefined || isNaN(v)) return null;
  const sym = ccy === "USD" ? "$" : "₹";
  if (v >= 10000) return `${sym}${Math.round(v).toLocaleString("en-IN")}`;
  return `${sym}${v.toFixed(2)}`;
}

function fmtQty(v: number | undefined, ccy: "INR" | "USD"): string | null {
  if (v === undefined || isNaN(v)) return null;
  if (ccy === "USD") return Math.abs(v - Math.round(v)) < 1e-6 ? `${v}` : v.toFixed(2);
  return v.toLocaleString("en-IN");
}

function classifySurprise(s: number | undefined): SurpriseFilter | null {
  if (s === undefined) return null;
  if (s > 1) return "beat";
  if (s < -1) return "miss";
  return "inline";
}

// ---------- main ----------

export default function EarningsTab() {
  const [data, setData] = useState<DataResp | null>(null);
  const [outlooks, setOutlooks] = useState<OutlookEntry[]>([]);
  const [snapshotHoldings, setSnapshotHoldings] = useState<SnapshotHolding[]>([]);
  const [usPositions, setUsPositions] = useState<UsPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [surprise, setSurprise] = useState<SurpriseFilter>("all");
  const [market, setMarket] = useState<MarketFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    Promise.all([
      fetch("/api/earnings/data", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/earnings/outlook", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/snapshot", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/usstocks", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([d, o, snap, us]) => {
        if (cancelled) return;
        setData(d as DataResp);
        const items = ((o as OutlookResp).items ?? []) as OutlookEntry[];
        setOutlooks(items);
        const snapHoldings = snap?.data?.holdings;
        if (Array.isArray(snapHoldings)) setSnapshotHoldings(snapHoldings);
        const usPos = us?.data?.positions;
        if (Array.isArray(usPos)) setUsPositions(usPos);
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

  const joined: Joined[] = useMemo(() => {
    if (!data) return [];
    return data.records.map((r) => {
      const outlook = findOutlook(r.ticker, r.period, outlooks);
      const position =
        r.market === "IN"
          ? buildInPos(r.ticker, snapshotHoldings)
          : buildUsPos(r.ticker, usPositions);
      return { ...r, outlook, position };
    });
  }, [data, outlooks, snapshotHoldings, usPositions]);

  const counts = useMemo(() => {
    let beat = 0;
    let miss = 0;
    let inline = 0;
    for (const r of joined) {
      const c = classifySurprise(r.metrics.surprisePct);
      if (c === "beat") beat++;
      else if (c === "miss") miss++;
      else if (c === "inline") inline++;
    }
    return { beat, miss, inline };
  }, [joined]);

  const filtered = useMemo(() => {
    return joined
      .filter((r) => market === "all" || r.market === market)
      .filter((r) => {
        if (surprise === "all") return true;
        const c = classifySurprise(r.metrics.surprisePct);
        // If we don't have a numeric estimate but we have an outlook direction,
        // map "+" / "-" / "neutral" → beat / miss / inline so the filter feels
        // useful even on seed data without surprisePct.
        if (c) return c === surprise;
        const d = r.outlook?.direction;
        if (d === "+" && surprise === "beat") return true;
        if (d === "-" && surprise === "miss") return true;
        if (d === "neutral" && surprise === "inline") return true;
        return false;
      })
      .sort((a, b) => (b.reportedAt || "").localeCompare(a.reportedAt || ""));
  }, [joined, market, surprise]);

  const marketOptions: FilterOption<MarketFilter>[] = [
    { value: "all", label: "All markets" },
    { value: "IN", label: "India" },
    { value: "US", label: "US" },
  ];

  // Earnings is "stale" only when a holding's nextEarningsDate has passed AND
  // we don't have a record for that period. File age is not a freshness signal —
  // earnings reports drop on specific dates, not on a schedule.
  const overdueCount = useMemo(() => {
    if (!data?.records) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const byTicker = new Map<string, typeof data.records>();
    for (const r of data.records) {
      const list = byTicker.get(r.ticker) ?? [];
      list.push(r);
      byTicker.set(r.ticker, list);
    }
    let n = 0;
    for (const rows of byTicker.values()) {
      const latest = rows.reduce((a, b) => ((b.reportedAt ?? "") > (a.reportedAt ?? "") ? b : a));
      const next = latest.nextEarningsDate?.slice(0, 10);
      if (next && next <= today) n++;
    }
    return n;
  }, [data?.records]);
  const showStale = overdueCount > 0;

  return (
    <section className="space-y-8">
      <header className="flex items-center justify-between gap-5 flex-wrap px-1.5">
        <h1
          className="text-[20px] md:text-[24px] leading-[1.05] font-black tracking-[-0.02em] text-primary inline-flex items-center gap-2 uppercase"
          style={{
            fontFamily: "var(--font-display-wide), system-ui, sans-serif",
            fontStretch: "120%",
          }}
        >
          Earnings
          {showStale && (
            <span
              className="mono-true normal-case tracking-normal font-medium text-[10.5px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{
                background: "var(--warn-tint)",
                color: "var(--warn)",
                border: "1px solid var(--warn-tint)",
              }}
              title={`${overdueCount} holding${overdueCount === 1 ? "" : "s"} reported but the latest period isn't in the cache yet. Run /portfolio-check to refresh.`}
            >
              {overdueCount} OVERDUE
            </span>
          )}
        </h1>
      </header>

      <Toolbar>
        <Segmented<SurpriseFilter>
          value={surprise}
          onChange={setSurprise}
          options={[
            { value: "all", label: "All" },
            { value: "beat", label: `Beat${counts.beat ? ` · ${counts.beat}` : ""}` },
            { value: "miss", label: `Miss${counts.miss ? ` · ${counts.miss}` : ""}` },
            { value: "inline", label: `In-line${counts.inline ? ` · ${counts.inline}` : ""}` },
          ]}
          ariaLabel="earnings result filter"
        />
        <div className="flex-1" />
        <FilterDropdown<MarketFilter>
          label="Market"
          value={market}
          options={marketOptions}
          onChange={setMarket}
          defaultValue="all"
        />
      </Toolbar>

      {loading && !data && <EarningsSkeleton />}

      {err && (
        <div
          className="rounded-lg p-4 text-[12.5px] text-neg"
          style={{ background: "var(--neg-tint)", border: "1px solid var(--border)" }}
        >
          Couldn’t load earnings: {err}
        </div>
      )}

      {data && filtered.length === 0 && !loading && !err && (
        <EmptyState
          title={
            data.records.length === 0
              ? "No earnings cached yet"
              : "Nothing matches your filters"
          }
          hint={
            data.records.length === 0
              ? "Run /portfolio-check to refresh the earnings cache."
              : "Try a wider result or market filter."
          }
        />
      )}

      {data && filtered.length > 0 && (
        <ul className="list-stagger flex flex-col gap-3.5">
          {filtered.map((r, i) => (
            <li key={r.ticker} style={{ ["--idx" as string]: i }}>
              <EarningsRow r={r} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- row ----------

function EarningsRow({ r }: { r: Joined }) {
  const o = r.outlook;
  const dir: Direction = o?.direction ?? defaultDirection(r);
  const mag: Magnitude = o?.magnitude ?? defaultMagnitude(r);
  const conf: Confidence = o?.confidence ?? "med";
  const dColor = dirColor(dir);
  const meta = getMeta(r.ticker);

  const revYoY = pctText(r.metrics.revenueYoYPct);
  // metrics.epsYoYPct is net-income (profit) YoY, not per-share EPS — label it
  // "Profit" so the figure is honest.
  const profitYoY = pctText(r.metrics.epsYoYPct);
  const surp = pctText(r.metrics.surprisePct, 1);
  const opM = r.metrics.operatingMarginPct;

  return (
    <article
      className="surface rounded-lg overflow-hidden"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* LEFT: company + period + key metrics + brief */}
        <a
          href={r.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block p-5 transition-colors hover:bg-[var(--bg-subtle)]"
        >
          <div className="eyebrow flex items-center gap-1.5">
            <span>{r.sourceName}</span>
            <Dot />
            <span>{r.market}</span>
            <Dot />
            <span>{fmtDate(r.reportedAt)}</span>
          </div>
          <h3 className="mt-2 text-[14px] md:text-[14.5px] font-semibold text-primary leading-snug tracking-[-0.005em] flex items-baseline gap-2 flex-wrap">
            <span>{r.company}</span>
            <TickerChip ticker={r.ticker} />
          </h3>
          <div className="mt-1 text-[12px] text-tertiary leading-snug uppercase tracking-[0.04em]">
            {r.period}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {revYoY && (
              <MetricChip label="Rev" value={`${revYoY} YoY`} tone={toneFromPct(r.metrics.revenueYoYPct)} />
            )}
            {profitYoY && (
              <MetricChip label="Profit" value={`${profitYoY} YoY`} tone={toneFromPct(r.metrics.epsYoYPct)} />
            )}
            {opM !== undefined && (
              <MetricChip label="Op M" value={`${opM.toFixed(1)}%`} tone="mute" />
            )}
            {surp && (
              <MetricChip
                label="Surprise"
                value={surp}
                tone={toneFromPct(r.metrics.surprisePct)}
              />
            )}
          </div>
          {r.brief && (
            <p className="mt-2.5 text-[12px] text-secondary leading-snug line-clamp-2">
              {r.brief}
            </p>
          )}
        </a>

        {/* RIGHT: direction hero + impact + meaningForUser + next watch */}
        <div
          className="p-5 flex flex-col gap-3 min-w-0"
          style={{ borderLeft: "1px solid var(--border)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className="text-[15px] leading-none"
                  style={{ color: dColor }}
                >
                  {dirGlyph(dir)}
                </span>
                <span
                  className="text-[16px] md:text-[17px] font-semibold tracking-[-0.01em] uppercase"
                  style={{ color: dColor }}
                >
                  {dirLabel(dir)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <MagBars n={magCount(mag)} color={dColor} />
                <span
                  className="font-medium tracking-[0.02em] uppercase"
                  style={{ color: dColor }}
                >
                  {mag} impact
                </span>
              </div>
            </div>
            <ConfidenceMeter level={conf} />
          </div>

          <div className="flex flex-col gap-1 min-w-0">
            <span className="eyebrow">What this means for you</span>
            <p
              className="text-[12.5px] leading-snug"
              style={{ color: o?.meaningForUser ? "var(--text-primary)" : "var(--text-tertiary)" }}
            >
              {o?.meaningForUser ?? "Outlook pending. Refresh via /portfolio-check."}
            </p>
          </div>

          {o?.watchFor && o.watchFor[0] && (
            <div className="flex flex-col gap-1 min-w-0">
              <span className="eyebrow">Next watch</span>
              <p className="text-[12px] text-tertiary leading-snug line-clamp-2">
                {o.watchFor[0]}
              </p>
            </div>
          )}

          {(meta.sector || r.nextEarningsDate) && (
            <div
              className="eyebrow flex items-center gap-1.5 flex-wrap mt-auto pt-2"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {meta.sector && <span>{meta.sector}</span>}
              {meta.sector && r.nextEarningsDate && <Dot />}
              {r.nextEarningsDate && (
                <span>Reports on {fmtDate(r.nextEarningsDate)}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Position context, clearly separate from earnings move. */}
      {r.position && (
        <div
          className="px-5 py-2.5 flex items-center gap-2 flex-wrap"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg-subtle)" }}
        >
          <span className="eyebrow shrink-0">Your position</span>
          <PositionLine p={r.position} />
        </div>
      )}
    </article>
  );
}

function PositionLine({ p }: { p: PositionContext }) {
  const ccy = p.currency;
  const qty = fmtQty(p.qty, ccy);
  const avg = fmtPrice(p.avgPrice, ccy);
  const ltp = fmtPrice(p.currentPrice, ccy);
  const pnl = pctText(p.pnlPct, 2);
  return (
    <div className="flex items-center gap-1.5 flex-wrap mono-true text-[11.5px] text-secondary">
      {qty && (
        <>
          <span>{qty}u</span>
          {(avg || ltp || pnl) && <Dot />}
        </>
      )}
      {avg && (
        <>
          <span>avg {avg}</span>
          {(ltp || pnl) && <Dot />}
        </>
      )}
      {ltp && (
        <>
          <span>LTP {ltp}</span>
          {pnl && <Dot />}
        </>
      )}
      {pnl && (
        <span
          className="font-semibold"
          style={{ color: toneToColor(toneFromPct(p.pnlPct)) }}
        >
          P&L {pnl}
        </span>
      )}
    </div>
  );
}

// ---------- bits ----------

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "pos" | "neg" | "mute";
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[11.5px]">
      <span className="text-tertiary uppercase tracking-[0.04em]">{label}</span>
      <span
        className="mono-true font-semibold"
        style={{ color: toneToColor(tone) }}
      >
        {value}
      </span>
    </span>
  );
}

function toneFromPct(v: number | undefined): "pos" | "neg" | "mute" {
  if (v === undefined || isNaN(v)) return "mute";
  if (v > 0) return "pos";
  if (v < 0) return "neg";
  return "mute";
}

function toneToColor(t: "pos" | "neg" | "mute"): string {
  if (t === "pos") return "var(--pos)";
  if (t === "neg") return "var(--neg)";
  return "var(--text-tertiary)";
}

function TickerChip({ ticker }: { ticker: string }) {
  return (
    <span
      className="mono-true text-[10.5px] tracking-[0.01em] px-1.5 py-[2px] rounded text-primary"
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

function MagBars({ n, color }: { n: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block"
          style={{
            width: 2,
            height: i < n ? 7 : 5,
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
  const n = level === "high" ? 3 : level === "med" ? 2 : 1;
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <span className="eyebrow">Confidence</span>
      <div className="flex items-center gap-[3px]" aria-label={`confidence ${level}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block"
            style={{
              width: 8,
              height: 6,
              background: i < n ? "var(--text-primary)" : "var(--text-tertiary)",
              opacity: i < n ? 0.9 : 0.25,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className="rounded-lg px-6 py-10 text-center"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      <div className="text-[13px] font-semibold text-primary">{title}</div>
      <div className="mt-1 text-[12px] text-tertiary">{hint}</div>
    </div>
  );
}

function EarningsSkeleton() {
  return (
    <ul className="flex flex-col gap-3.5">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rounded-lg h-[170px] animate-pulse"
          style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
        />
      ))}
    </ul>
  );
}

// ---------- helpers ----------

function findOutlook(
  ticker: string,
  period: string | undefined,
  outlooks: OutlookEntry[],
): OutlookEntry | undefined {
  const tk = ticker.toUpperCase();
  if (period) {
    const exact = outlooks.find(
      (o) =>
        o.ticker.toUpperCase() === tk &&
        (o.period ?? "").replace(/\s+/g, "").toUpperCase() ===
          period.replace(/\s+/g, "").toUpperCase(),
    );
    if (exact) return exact;
  }
  return outlooks.find((o) => o.ticker.toUpperCase() === tk);
}

function defaultDirection(r: EarningsRecord): Direction {
  const s = r.metrics.surprisePct;
  if (s !== undefined) {
    if (s > 1) return "+";
    if (s < -1) return "-";
  }
  const rev = r.metrics.revenueYoYPct;
  if (rev !== undefined) {
    if (rev > 10) return "+";
    if (rev < 0) return "-";
  }
  return "neutral";
}

function defaultMagnitude(r: EarningsRecord): Magnitude {
  const s = r.metrics.surprisePct;
  if (s !== undefined) {
    const a = Math.abs(s);
    if (a > 10) return "high";
    if (a > 2) return "med";
  }
  const rev = r.metrics.revenueYoYPct;
  if (rev !== undefined) {
    const a = Math.abs(rev);
    if (a > 40) return "high";
    if (a > 15) return "med";
  }
  return "low";
}

function buildInPos(
  ticker: string,
  holdings: SnapshotHolding[],
): PositionContext | undefined {
  const h = holdings.find(
    (x) => (x.ticker ?? "").toUpperCase() === ticker.toUpperCase(),
  );
  if (!h) return undefined;
  return {
    qty: h.qty,
    avgPrice: h.avgPrice,
    currentPrice: h.ltp,
    pnlPct: h.pnlPct,
    currency: "INR",
  };
}

function buildUsPos(
  ticker: string,
  positions: UsPosition[],
): PositionContext | undefined {
  const p = positions.find(
    (x) => (x.ticker ?? "").toUpperCase() === ticker.toUpperCase(),
  );
  if (!p) return undefined;
  return {
    qty: p.quantity,
    avgPrice: p.avgPriceUSD,
    currentPrice: p.currentPriceUSD,
    pnlPct: p.pnlPct,
    currency: "USD",
  };
}
