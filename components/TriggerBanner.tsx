"use client";

import { useEffect, useState } from "react";

type TriggerItem = {
  taskId: string;
  ticker?: string;
  severity?: "low" | "med" | "high";
  mechanism: string;
};

type TriggersResp = {
  firedAt: string;
  items: TriggerItem[];
};

export default function TriggerBanner({
  onOpenTask,
}: {
  onOpenTask?: (taskId: string) => void;
}) {
  const [items, setItems] = useState<TriggerItem[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/triggers")
      .then((r) => r.json())
      .then((d: TriggersResp) => {
        if (!cancelled && Array.isArray(d.items)) setItems(d.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || items.length === 0) return null;

  return (
    <section
      className="surface rounded-lg overflow-hidden"
      aria-label="Triggers fired"
    >
      <header
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex items-center justify-center rounded shrink-0"
            style={{
              width: 18,
              height: 18,
              background: "var(--warn-tint)",
              color: "var(--warn)",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            !
          </span>
          <span
            className="text-[12px] font-semibold text-primary"
            style={{ letterSpacing: "-0.005em" }}
          >
            Triggers fired
          </span>
          <span className="text-[11px] text-tertiary mono-true">·</span>
          <span className="text-[11px] text-tertiary mono-true tabular-nums">
            {items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss triggers"
          className="text-tertiary hover:text-primary transition-colors text-[15px] leading-none accent-ring rounded shrink-0 px-1"
        >
          ×
        </button>
      </header>

      <ul className="flex flex-col">
        {items.map((it, i) => (
          <li
            key={it.taskId}
            className="relative"
          >
            <button
              type="button"
              onClick={() => onOpenTask?.(it.taskId)}
              className="w-full text-left flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--bg-subtle)] accent-ring group"
              style={
                i < items.length - 1
                  ? { borderBottom: "1px solid var(--border)" }
                  : undefined
              }
            >
              {it.ticker ? (
                <TickerChip ticker={it.ticker} />
              ) : (
                <span
                  className="inline-block rounded shrink-0"
                  style={{
                    width: 38,
                    height: 18,
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border)",
                  }}
                  aria-hidden
                />
              )}
              <span className="text-[12.5px] text-primary leading-snug min-w-0 flex-1 truncate">
                {it.mechanism}
              </span>
              <span className="mono-true text-[10.5px] text-tertiary tabular-nums shrink-0 hidden sm:inline">
                {it.taskId}
              </span>
              <span
                aria-hidden
                className="text-tertiary group-hover:text-primary transition-colors shrink-0 text-[12px]"
              >
                ↗
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
