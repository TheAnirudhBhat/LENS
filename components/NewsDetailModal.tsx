"use client";

/**
 * NewsDetailModal. Centered modal opened by clicking a news row on the News
 * tab. Carries the heavy tertiary detail that used to crowd the card's right
 * panel: direction hero + magnitude bars, confidence meter, full ticker list,
 * full mechanism prose, horizon + sector footer, and the source link.
 *
 * Mirrors the modal-backdrop + modal-card pattern from TaskExplainerModal
 * (Esc-to-close, backdrop click closes, click inside doesn't, portal-rendered).
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

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

export type NewsDetailArticle = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet: string;
  region: "IN" | "US" | "GLOBAL";
  tagging: Tagging;
};

type Props = {
  article: NewsDetailArticle | null;
  onClose: () => void;
};

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

function horizonLabel(h: Horizon): string {
  if (h === "days") return "Next few days";
  if (h === "weeks") return "1-4 weeks";
  return "Next quarter+";
}

function magCount(m: Magnitude): number {
  return m === "high" ? 3 : m === "med" ? 2 : 1;
}

function confCount(c: Confidence): number {
  return c === "high" ? 3 : c === "med" ? 2 : 1;
}

export default function NewsDetailModal({ article, onClose }: Props) {
  // Esc-to-close.
  useEffect(() => {
    if (!article) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [article, onClose]);

  if (typeof document === "undefined") return null;
  if (!article) return null;

  const t = article.tagging;
  const dir = dirToken(t.direction);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-detail-title"
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg max-w-xl w-full max-h-[88vh] overflow-y-auto no-scrollbar"
      >
        {/* Header. Meta strip + headline + close. */}
        <div
          className="flex items-start justify-between gap-5 px-7 pt-7 pb-5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="eyebrow flex items-center gap-1.5 mb-2">
              <span>{article.source}</span>
              <Dot />
              <span>{article.region}</span>
              <Dot />
              <span>{fmtDate(article.publishedAt)}</span>
            </div>
            <h2
              id="news-detail-title"
              className="text-[17px] md:text-[18px] leading-snug font-semibold text-primary tracking-[-0.01em]"
            >
              {article.title}
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
        <div className="px-7 py-6 space-y-6">
          {/* Direction hero */}
          <section>
            <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2.5">
              Predicted direction
            </div>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-2 min-w-0">
                <div className="flex items-baseline gap-2.5">
                  <span
                    aria-hidden
                    className="text-[18px] leading-none"
                    style={{ color: dir.color }}
                  >
                    {dirGlyph(t.direction)}
                  </span>
                  <span
                    className="text-[20px] md:text-[22px] font-semibold tracking-[-0.01em] uppercase"
                    style={{ color: dir.color }}
                  >
                    {dirLabel(t.direction)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <MagBars n={magCount(t.magnitude)} color={dir.color} />
                  <span
                    className="font-medium tracking-[0.02em] uppercase"
                    style={{ color: dir.color }}
                  >
                    {t.magnitude} impact
                  </span>
                </div>
              </div>
              <ConfidenceMeter level={t.confidence} />
            </div>
          </section>

          {/* Affects */}
          <section>
            <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2">
              Affects
            </div>
            {t.tickers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {t.tickers.map((tk) => (
                  <TickerChip key={tk} ticker={tk} />
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-secondary leading-snug">
                {t.sector ? `Broad ${t.sector}, no direct holdings` : "Broad market context"}
              </p>
            )}
          </section>

          {/* Mechanism */}
          {t.mechanism && (
            <section>
              <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2">
                Mechanism
              </div>
              <p className="text-[12.5px] text-secondary leading-relaxed">
                {t.mechanism}
              </p>
            </section>
          )}

          {/* Snippet. Only render if it's different from the title/mechanism. */}
          {article.snippet && (
            <section>
              <div className="text-[10.5px] uppercase tracking-wide text-tertiary font-medium mb-2">
                Summary
              </div>
              <p className="text-[12.5px] text-secondary leading-relaxed">
                {article.snippet}
              </p>
            </section>
          )}
        </div>

        {/* Tertiary footer. Horizon · sector · confidence. */}
        <div
          className="px-7 py-3 flex items-center gap-1.5 eyebrow flex-wrap"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <span>{horizonLabel(t.horizon)}</span>
          {t.sector && (
            <>
              <Dot />
              <span>{t.sector}</span>
            </>
          )}
          <Dot />
          <span>
            {t.confidence} confidence ({confCount(t.confidence)}/3)
          </span>
        </div>

        {/* Footer actions */}
        <div
          className="px-7 py-4 flex items-center justify-between gap-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-secondary hover:text-primary rounded-md transition-colors"
          >
            Close
          </button>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-[12px] font-medium rounded-md transition-opacity hover:opacity-90 inline-flex items-center gap-1.5"
            style={{
              background: "var(--text-primary)",
              color: "var(--bg-card)",
            }}
          >
            Open source
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

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

function TickerChip({ ticker }: { ticker: string }) {
  return (
    <span
      className="mono-true text-[11px] tracking-[0.01em] px-2 py-[3px] rounded text-primary"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      {ticker}
    </span>
  );
}

function ConfidenceMeter({ level }: { level: Confidence }) {
  const n = confCount(level);
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <span className="eyebrow">Confidence</span>
      <div className="flex items-center gap-[3px]" aria-label={`confidence ${level}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block"
            style={{
              width: 10,
              height: 7,
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
