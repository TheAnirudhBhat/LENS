"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "./ui";

type HistoryPoint = {
  date: string;
  inEquity: number | null;
  bonds: number | null;
  mf: number | null;
  us: number | null;
  total: number | null;
};

type HistoryResponse = { history: HistoryPoint[]; asOf: string | null };

const SERIES = [
  { key: "inEquity", name: "IN equity", color: "var(--brand)" },
  { key: "mf", name: "Mutual funds", color: "var(--pos)" },
  { key: "us", name: "US equity", color: "var(--warn)" },
  { key: "bonds", name: "Bonds", color: "var(--text-tertiary)" },
] as const;

function fmtINR(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function fmtCompactINR(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(abs / 1e3).toFixed(0)}K`;
  return `₹${Math.round(abs)}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

type TooltipEntry = { name?: string; value?: number; color?: string };

function FlowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div
      className="rounded-md px-3 py-2.5 text-[11.5px]"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      }}
    >
      <div className="text-tertiary mb-1.5">{label ? fmtDate(label) : ""}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-5">
          <span className="inline-flex items-center gap-1.5 text-secondary">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: p.color }}
            />
            {p.name}
          </span>
          <span className="mono-true text-primary">
            ₹{fmtINR(p.value ?? 0)}
          </span>
        </div>
      ))}
      <div
        className="flex items-center justify-between gap-5 mt-1.5 pt-1.5"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <span className="text-tertiary">Total</span>
        <span className="mono-true font-medium text-primary">
          ₹{fmtINR(total)}
        </span>
      </div>
    </div>
  );
}

export default function PortfolioFlowChart() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((r: HistoryResponse) => {
        if (r && Array.isArray(r.history)) setData(r);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Keep only points that carry at least one series value; omit null keys
  // so recharts renders the available series per point without faking zeros.
  const points = useMemo(() => {
    if (!data) return [];
    return data.history
      .filter((p) => SERIES.some((s) => p[s.key] !== null))
      .map((p) => {
        const row: Record<string, number | string> = { date: p.date };
        for (const s of SERIES) {
          const v = p[s.key];
          if (v !== null) row[s.key] = v;
        }
        if (p.total !== null) row.total = p.total;
        return row;
      });
  }, [data]);

  // 20d delta: last non-null total vs the latest total at least 20 days back.
  const delta = useMemo(() => {
    if (!data) return null;
    const withTotal = data.history.filter((p) => p.total !== null);
    if (withTotal.length < 2) return null;
    const last = withTotal[withTotal.length - 1];
    const cutoff = new Date(last.date).getTime() - 20 * 86400000;
    const base =
      [...withTotal]
        .reverse()
        .find((p) => new Date(p.date).getTime() <= cutoff) ?? withTotal[0];
    if (base.date === last.date) return null;
    return (last.total as number) - (base.total as number);
  }, [data]);

  const asOf = data?.asOf ?? null;
  const empty = loaded && points.length === 0;

  return (
    <Card>
      <CardHeader
        title="Portfolio flow"
        actions={
          <div className="flex items-center gap-2.5 text-[11.5px] text-tertiary">
            {asOf && <span>as of {fmtDate(asOf)}</span>}
            {delta !== null && (
              <span
                className={`mono-true font-medium ${delta >= 0 ? "text-pos" : "text-neg"}`}
              >
                {delta >= 0 ? "+" : "−"}
                {fmtCompactINR(delta)} 20d
              </span>
            )}
          </div>
        }
      />
      <div className="px-3 pt-4 pb-3" style={{ height: 220 }}>
        {empty ? (
          <div className="h-full flex items-center justify-center text-[12px] text-tertiary">
            No history yet. Syncs build this chart.
          </div>
        ) : points.length === 0 ? null : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 10.5, fill: "var(--text-tertiary)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={fmtCompactINR}
                tick={{ fontSize: 10.5, fill: "var(--text-tertiary)" }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip content={<FlowTooltip />} />
              {SERIES.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stackId="1"
                  stroke={s.color}
                  strokeWidth={1.2}
                  fill={s.color}
                  fillOpacity={0.5}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
