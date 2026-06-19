"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { InfoTip } from "@/components/ui";

type SmartMoneyHolding = {
  issuerId: number | null;
  signal: string;
  detail: string;
  read: string;
};

type SmartMoneyData = {
  asOf: string;
  source: string;
  method: string;
  holdings: Record<string, SmartMoneyHolding>;
};

/** Cluster signals get a semantic tint; everything else stays neutral. */
function signalStyle(signal: string): CSSProperties {
  const s = (signal ?? "").toUpperCase();
  if (s === "CLUSTER SELL")
    return { background: "var(--neg-tint)", color: "var(--neg)" };
  if (s === "CLUSTER BUY")
    return { background: "var(--pos-tint)", color: "var(--pos)" };
  return {
    background: "var(--bg-subtle)",
    color: "var(--text-tertiary)",
    border: "1px solid var(--border)",
  };
}

/** Actionable clusters first, then quiet, stats-only, none. */
const SIGNAL_RANK: Record<string, number> = {
  "CLUSTER SELL": 0,
  "CLUSTER BUY": 0,
  QUIET: 1,
  "STATS-ONLY": 2,
  NONE: 3,
};

export default function SmartMoneyPanel() {
  const [data, setData] = useState<SmartMoneyData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/smartmoney")
      .then((r) => r.json())
      .then((d: { smartMoney?: SmartMoneyData | null }) => {
        if (!cancelled && d?.smartMoney?.holdings) setData(d.smartMoney);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Avoid an empty-state flash while the fetch is in flight.
  if (!loaded) return null;

  const rows = data
    ? Object.entries(data.holdings).sort(([ta, a], [tb, b]) => {
        const ra = SIGNAL_RANK[(a.signal ?? "").toUpperCase()] ?? 4;
        const rb = SIGNAL_RANK[(b.signal ?? "").toUpperCase()] ?? 4;
        return ra !== rb ? ra - rb : ta.localeCompare(tb);
      })
    : [];

  if (!data || rows.length === 0) {
    return (
      <div className="surface rounded-lg p-10 text-sm text-tertiary text-center">
        No smart money data yet. Run /portfolio-check to populate.
      </div>
    );
  }

  return (
    <section
      className="surface rounded-lg overflow-hidden"
      aria-label="US smart money"
    >
      <header
        className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center min-w-0">
          <h2 className="text-[14px] font-semibold tracking-[-0.005em] text-primary">
            US smart money
          </h2>
          <InfoTip
            text={`${data.method}. Source: ${data.source}.`}
            size="sm"
          />
        </div>
        <span
          className="text-[11px] text-tertiary mono-true tabular-nums shrink-0"
          title={data.method}
        >
          as of {data.asOf}
        </span>
      </header>

      <ul className="flex flex-col">
        {rows.map(([ticker, h], i) => (
          <li
            key={ticker}
            className="px-5 py-3"
            style={
              i < rows.length - 1
                ? { borderBottom: "1px solid var(--border)" }
                : undefined
            }
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="mono-true text-[11.5px] font-semibold tracking-[0.01em] text-primary shrink-0 w-[46px]">
                {ticker}
              </span>
              <span
                className="mono-true text-[10px] font-semibold tracking-[0.04em] px-1.5 py-[2px] rounded shrink-0 cursor-default"
                style={signalStyle(h.signal)}
                title={h.detail}
              >
                {h.signal}
              </span>
            </div>
            <p className="text-[12px] text-secondary leading-snug mt-1.5">
              {h.read}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
