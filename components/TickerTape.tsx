"use client";

import { useEffect, useState } from "react";

type Idx = { value: number; dayChangePct: number };
type Indices = Record<string, Idx>;

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function cls(pct: number) {
  if (pct > 0) return "text-pos";
  if (pct < 0) return "text-neg";
  return "text-tertiary";
}

export default function TickerTape() {
  const [data, setData] = useState<Indices | null>(null);

  useEffect(() => {
    fetch("/api/indices")
      .then((r) => r.json())
      .then((r) => setData(r.data));
  }, []);

  if (!data) return null;
  const items = Object.entries(data);
  const all = [...items, ...items];

  return (
    <div
      className="relative overflow-hidden border-y border-subtle py-2.5 -mx-8"
      style={{ background: "var(--bg-subtle)" }}
    >
      <div
        className="flex gap-10 whitespace-nowrap hover:[animation-play-state:paused]"
        style={{ animation: "ticker-scroll 45s linear infinite" }}
      >
        {all.map(([name, v], i) => (
          <div
            key={`${name}-${i}`}
            className="flex items-center gap-2.5 text-[11px] mono"
          >
            <span className="text-tertiary">{name}</span>
            <span className="text-primary font-medium">{fmt(v.value)}</span>
            <span className={cls(v.dayChangePct)}>
              {v.dayChangePct > 0 ? "▲" : v.dayChangePct < 0 ? "▼" : "•"}{" "}
              {v.dayChangePct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
