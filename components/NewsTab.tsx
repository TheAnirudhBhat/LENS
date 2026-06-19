"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Segmented,
  Toolbar,
  FilterDropdown,
  type FilterOption,
} from "./ui";
import NewsDetailModal, { type NewsDetailArticle } from "./NewsDetailModal";

type Direction = "+" | "-" | "neutral";
type Magnitude = "low" | "med" | "high";
type Horizon = "days" | "weeks" | "quarters";
type Confidence = "low" | "med" | "high";

type Tagging = {
  tickers: string[];
  direction: Direction;
  magnitude: Magnitude;
  mechanism: string;
  horizon: Horizon;
  confidence: Confidence;
  sector?: string;
};

type Article = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet: string;
  imageUrl?: string;
  region: "IN" | "US" | "GLOBAL";
  tagging: Tagging;
  priceDelta?: Record<string, number>;
};

type ApiResp = {
  articles: Article[];
  llmEnabled: boolean;
  holdingsCount: number;
  cached: boolean;
  fetchedAt: string;
};

type View = "forecast" | "playedout";
type SentimentFilter = "all" | "+" | "-" | "neutral";

const PLAYED_OUT_MS = 24 * 60 * 60 * 1000;

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
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day} · ${hh}:${mm}`;
}

function dirLabel(d: Direction): string {
  if (d === "+") return "Bullish";
  if (d === "-") return "Bearish";
  return "Neutral";
}

function magCount(m: Magnitude): number {
  return m === "high" ? 3 : m === "med" ? 2 : 1;
}

function dirToken(d: Direction): { color: string; bg: string } {
  if (d === "+") return { color: "var(--pos)", bg: "var(--pos-tint)" };
  if (d === "-") return { color: "var(--neg)", bg: "var(--neg-tint)" };
  return { color: "var(--text-tertiary)", bg: "var(--bg-subtle)" };
}

function dirGlyph(d: Direction): string {
  if (d === "+") return "▲";
  if (d === "-") return "▼";
  return "•";
}

export default function NewsTab() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("forecast");
  const [excludeHoldings, setExcludeHoldings] = useState(false);
  const [sentiment, setSentiment] = useState<SentimentFilter>("all");
  const [sector, setSector] = useState<string>("all");
  const [openArticle, setOpenArticle] = useState<NewsDetailArticle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch("/api/news")
      .then((r) => r.json())
      .then((d: ApiResp) => {
        if (!cancelled) setData(d);
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

  const sectors = useMemo(() => {
    if (!data) return [] as string[];
    const s = new Set<string>();
    for (const a of data.articles) {
      if (a.tagging.sector) s.add(a.tagging.sector);
    }
    return Array.from(s).sort();
  }, [data]);

  const counts = useMemo(() => {
    if (!data) return { forecast: 0, playedout: 0 };
    const now = Date.now();
    let forecast = 0;
    let playedout = 0;
    for (const a of data.articles) {
      const age = now - +new Date(a.publishedAt);
      if (age > PLAYED_OUT_MS) playedout++;
      else forecast++;
    }
    return { forecast, playedout };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [] as Article[];
    const now = Date.now();
    return data.articles.filter((a) => {
      const age = now - +new Date(a.publishedAt);
      const isPlayed = age > PLAYED_OUT_MS;
      if (view === "forecast" && isPlayed) return false;
      if (view === "playedout" && !isPlayed) return false;
      if (excludeHoldings && a.tagging.tickers.length > 0) return false;
      if (sentiment !== "all" && a.tagging.direction !== sentiment) return false;
      if (sector !== "all" && a.tagging.sector !== sector) return false;
      return true;
    });
  }, [data, view, excludeHoldings, sentiment, sector]);

  const sentimentOptions: FilterOption<SentimentFilter>[] = [
    { value: "all", label: "All sentiment" },
    { value: "+", label: "Bullish", dot: "var(--pos)" },
    { value: "-", label: "Bearish", dot: "var(--neg)" },
    { value: "neutral", label: "Neutral", dot: "var(--text-tertiary)" },
  ];
  const sectorOptions: FilterOption<string>[] = [
    { value: "all", label: "All sectors" },
    ...sectors.map((s) => ({ value: s, label: s })),
  ];

  const staleAgeHours = ageHoursFromISO(data?.fetchedAt);
  const showStale = staleAgeHours !== null && staleAgeHours > 24;

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
          News
          {showStale && staleAgeHours !== null && (
            <span
              className="mono-true normal-case tracking-normal font-medium text-[10.5px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{
                background: "var(--warn-tint)",
                color: "var(--warn)",
                border: "1px solid var(--warn-tint)",
              }}
              title={`Last updated ${Math.round(staleAgeHours)}h ago from news. Run /portfolio-check to refresh.`}
            >
              STALE
              <span aria-hidden="true">·</span>
              <span>news</span>
              <span>{Math.round(staleAgeHours)}h</span>
            </span>
          )}
        </h1>
      </header>

      <Toolbar>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "forecast", label: `Forecast${counts.forecast ? ` · ${counts.forecast}` : ""}` },
            { value: "playedout", label: `Played out${counts.playedout ? ` · ${counts.playedout}` : ""}` },
          ]}
          ariaLabel="news view"
        />
        <div className="flex-1" />
        <ExcludeHoldingsToggle
          active={excludeHoldings}
          onClick={() => setExcludeHoldings((v) => !v)}
        />
        <FilterDropdown<SentimentFilter>
          label="Sentiment"
          value={sentiment}
          options={sentimentOptions}
          onChange={setSentiment}
          defaultValue="all"
        />
        {sectors.length > 0 && (
          <FilterDropdown<string>
            label="Sector"
            value={sector}
            options={sectorOptions}
            onChange={setSector}
            defaultValue="all"
          />
        )}
      </Toolbar>

      {loading && !data && <NewsSkeleton />}

      {err && (
        <div
          className="rounded-lg p-4 text-[12.5px] text-neg"
          style={{ background: "var(--neg-tint)", border: "1px solid var(--border)" }}
        >
          Couldn’t load news: {err}
        </div>
      )}

      {data && filtered.length === 0 && !loading && !err && (
        <EmptyState
          title={data.articles.length === 0 ? "No headlines available" : "Nothing matches your filters"}
          hint={
            data.articles.length === 0
              ? "Run /portfolio-check to refresh the news cache."
              : excludeHoldings
              ? "Turn off ‘Exclude my holdings’ to see news on your positions."
              : "Try a wider sentiment or sector."
          }
        />
      )}

      {data && filtered.length > 0 && (
        <ul className="list-stagger flex flex-col gap-3.5">
          {filtered.map((a, i) => (
            <li key={a.id} style={{ ["--idx" as string]: i }}>
              <NewsRow
                a={a}
                view={view}
                onOpen={view === "forecast" ? () => setOpenArticle(a) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      <NewsDetailModal article={openArticle} onClose={() => setOpenArticle(null)} />
    </section>
  );
}

function ExcludeHoldingsToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-colors accent-ring inline-flex items-center gap-1.5"
      style={{
        background: active ? "var(--brand-tint)" : "var(--bg-subtle)",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        boxShadow: active ? "inset 0 0 0 1px var(--brand)" : undefined,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: active ? "var(--brand)" : "var(--text-tertiary)" }}
      />
      Exclude my holdings
    </button>
  );
}

function NewsRow({
  a,
  view,
  onOpen,
}: {
  a: Article;
  view: View;
  onOpen?: () => void;
}) {
  const isForecast = view === "forecast" && !!onOpen;
  const t = a.tagging;
  const dir = dirToken(t.direction);

  const inner = (
    <div className="p-5">
      {/* CHUNK 1 — subject row: tickers/sector on left, direction on right */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {t.tickers.length > 0 ? (
            <>
              {t.tickers.slice(0, 6).map((tk) => (
                <TickerChipPrimary key={tk} ticker={tk} />
              ))}
              {t.tickers.length > 6 && (
                <span className="text-[11px] text-tertiary mono-true">
                  +{t.tickers.length - 6}
                </span>
              )}
            </>
          ) : (
            <span className="text-[13px] font-medium text-secondary italic">
              {t.sector ? `Broad ${t.sector}` : "Broad market"}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span aria-hidden className="text-[11px] leading-none" style={{ color: dir.color }}>
            {dirGlyph(t.direction)}
          </span>
          <span
            className="text-[11px] font-semibold tracking-[0.04em] uppercase"
            style={{ color: dir.color }}
          >
            {dirLabel(t.direction)}
          </span>
        </div>
      </div>

      {/* CHUNK 2 — story (headline + snippet, tight together) */}
      <h3 className="mt-3 text-[14px] font-medium text-primary leading-snug tracking-[-0.005em]">
        {a.title}
      </h3>
      {view === "forecast" ? (
        a.snippet && (
          <p className="mt-1 text-[12px] text-tertiary leading-relaxed line-clamp-2">
            {a.snippet}
          </p>
        )
      ) : (
        <div className="mt-2.5">
          <PlayedOutImpact a={a} />
        </div>
      )}

      {/* CHUNK 3 — meta footer (extra space before to separate the chunk) */}
      <div className="eyebrow flex items-center gap-1.5 min-w-0 mt-4">
        <span className="truncate">{a.source}</span>
        <Dot />
        <span>{a.region}</span>
        <Dot />
        <span>{fmtDate(a.publishedAt)}</span>
      </div>
    </div>
  );

  const wrapperClass =
    "block w-full text-left transition-colors hover:bg-[var(--bg-subtle)] accent-ring";

  return (
    <article
      className="surface rounded-lg overflow-hidden"
      style={{ borderColor: "var(--border)" }}
    >
      {isForecast ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open details for ${a.title}`}
          className={wrapperClass}
        >
          {inner}
        </button>
      ) : (
        <a
          href={a.link}
          target="_blank"
          rel="noopener noreferrer"
          className={wrapperClass}
        >
          {inner}
        </a>
      )}
    </article>
  );
}

function DirectionPill({ direction, magnitude }: { direction: Direction; magnitude: Magnitude }) {
  const dir = dirToken(direction);
  const mag = magCount(magnitude);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.02em] shrink-0"
      style={{
        color: dir.color,
        background: dir.bg,
      }}
    >
      <span aria-hidden style={{ fontSize: 9 }}>
        {dirGlyph(direction)}
      </span>
      <span aria-hidden className="inline-flex items-center gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block rounded-full"
            style={{
              width: 3,
              height: 3,
              background: "currentColor",
              opacity: i < mag ? 1 : 0.25,
            }}
          />
        ))}
      </span>
    </span>
  );
}

function TickerChipPrimary({ ticker }: { ticker: string }) {
  return (
    <span
      className="mono-true text-[12.5px] font-semibold tracking-[0.01em] px-2 py-[3px] rounded text-primary"
      style={{
        background: "var(--bg-subtle)",
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

function PlayedOutImpact({ a }: { a: Article }) {
  const t = a.tagging;
  const deltas = a.priceDelta || {};
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {t.tickers.map((tk) => {
        const d = deltas[tk];
        const known = d !== undefined;
        const positive = known && d > 0;
        const negative = known && d < 0;
        const sign = positive ? "+" : "";
        return (
          <div key={tk} className="flex items-center gap-2.5 min-w-0">
            <TickerChip ticker={tk} />
            <DeltaSpark delta={d ?? 0} muted={!known} />
            <span
              className={`ml-auto mono-true text-[12px] font-semibold tabular-nums ${
                !known ? "text-tertiary" : positive ? "text-pos" : negative ? "text-neg" : "text-tertiary"
              }`}
            >
              {known ? `${sign}${d.toFixed(2)}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DeltaSpark({ delta, muted }: { delta: number; muted: boolean }) {
  const w = 64;
  const h = 14;
  const steps = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const x = (i / (steps - 1)) * w;
    const t = i / (steps - 1);
    const wobble = Math.sin(i * 1.2 + delta) * 0.35;
    const drift = delta * t;
    pts.push([x, drift + wobble]);
  }
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys, 0);
  const max = Math.max(...ys, 0);
  const span = Math.max(max - min, 0.001);
  const path = pts
    .map(([x, y], i) => {
      const ny = h - ((y - min) / span) * (h - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ny.toFixed(1)}`;
    })
    .join(" ");
  const color = muted
    ? "var(--text-tertiary)"
    : delta >= 0
    ? "var(--pos)"
    : "var(--neg)";
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0 opacity-90">
      <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    </svg>
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

function NewsSkeleton() {
  return (
    <ul className="flex flex-col gap-3.5">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rounded-lg h-[148px] animate-pulse"
          style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
        />
      ))}
    </ul>
  );
}
