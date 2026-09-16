"use client";

/**
 * AllocationPie — upgraded asset-allocation card for the Overview.
 *
 * Left: donut of the 4 asset classes (IN equity, MF, US equity, bonds)
 * with legend rows. Right: "Top 3 moves", derived insights ranked by
 * severity from /api/triggers, /api/allocation drift, and the MF x-ray.
 *
 * IN equity + bonds come from /api/snapshot; MF + US values are passed
 * as props by OverviewTab (same stats.mfValue / stats.usValue that feed
 * AssetSplitStrip). All sources may be null or empty; degrades to a calm
 * empty state.
 */

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, CardHeader } from "@/components/ui";

type Snapshot = {
  equityValue?: number;
  bondsValue?: number;
  totalPortfolioValue?: number;
} | null;

type RoleBucket = {
  role: string;
  valueINR: number;
  weightPct: number;
  targetPct: number;
  band: [number, number];
  drift: number;
  driftStatus: "ok" | "soft" | "hard";
};

type Allocation = { total: number; roles: RoleBucket[] } | null;

type Xray = {
  overlapPairs?: Record<string, { pct: number; commonCount: number }>;
  schemes?: Record<string, { scheme: string; ter: string }>;
} | null;

type TriggerItem = {
  taskId: string;
  ticker?: string;
  severity?: "low" | "med" | "high";
  mechanism: string;
};

type Insight = { text: string; tone: "neg" | "warn" | "brand" };

// Same series mapping as AssetSplitStrip in app/page.tsx — theme-safe
// mid-tones that hold up in both light and dark.
const CLASS_COLOR = {
  in: "var(--brand)",
  mf: "#0ea5e9",
  us: "#6366f1",
  bonds: "#14b8a6",
} as const;

const ROLE_LABEL: Record<string, string> = {
  compounders: "Compounders",
  growth: "Growth",
  cyclicals: "Cyclicals",
  defensives: "Defensives",
  hedges: "Hedges",
  "debt-equiv": "Debt-equiv",
  cash: "Cash",
};

const OVERLAP_HOT = 35;
const TER_RED = 1.5;
const SEV_RANK = { high: 0, med: 1, low: 2 } as const;
const SEV_TONE = { high: "neg", med: "warn", low: "brand" } as const;

function fmtINR(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function condense(s: string, max = 110) {
  const t = s.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function deriveInsights(
  triggers: TriggerItem[],
  allocation: Allocation,
  xray: Xray
): Insight[] {
  const out: Insight[] = [];

  // 1. Live triggers, most severe first.
  [...triggers]
    .sort((a, b) => SEV_RANK[a.severity ?? "low"] - SEV_RANK[b.severity ?? "low"])
    .forEach((t) =>
      out.push({ text: condense(t.mechanism), tone: SEV_TONE[t.severity ?? "low"] })
    );

  // 2. Largest |drift| role outside its band.
  const drifted = (allocation?.roles ?? [])
    .filter((r) => r.driftStatus !== "ok" && ROLE_LABEL[r.role])
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0];
  if (drifted) {
    const verb = drifted.drift > 0 ? "Trim" : "Redirect flows to";
    out.push({
      text: `${verb} ${ROLE_LABEL[drifted.role]}: ${drifted.weightPct.toFixed(1)}% vs ${drifted.targetPct}% target`,
      tone: drifted.driftStatus === "hard" ? "neg" : "warn",
    });
  }

  // 3. Worst MF overlap pair at or above 35%.
  const pair = Object.entries(xray?.overlapPairs ?? {})
    .sort((a, b) => b[1].pct - a[1].pct)
    .find(([, p]) => p.pct >= OVERLAP_HOT);
  if (pair) {
    out.push({
      text: `Consolidate ${pair[0].replace("~", " × ")}: ${pair[1].pct.toFixed(0)}% overlap, near-duplicate books`,
      tone: "warn",
    });
  }

  // 4. Priciest scheme with TER at or above 1.5%.
  const costly = Object.values(xray?.schemes ?? {})
    .map((s) => ({ scheme: s.scheme, ter: parseFloat(s.ter) }))
    .filter((s) => Number.isFinite(s.ter) && s.ter >= TER_RED)
    .sort((a, b) => b.ter - a.ter)[0];
  if (costly) {
    out.push({
      text: `Review ${costly.scheme}: ${costly.ter.toFixed(2)}% TER vs 0.6% peers`,
      tone: "warn",
    });
  }

  // 5. Nothing fired.
  if (out.length === 0) {
    out.push({
      text: "All roles inside bands. Next: monthly deploy on schedule.",
      tone: "brand",
    });
  }
  return out.slice(0, 3);
}

export default function AllocationPie({
  mfValue,
  usValue,
}: {
  /** MF book value, same source OverviewTab feeds AssetSplitStrip. */
  mfValue?: number | null;
  /** US book value in INR, same source OverviewTab feeds AssetSplitStrip. */
  usValue?: number | null;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [allocation, setAllocation] = useState<Allocation>(null);
  const [xray, setXray] = useState<Xray>(null);
  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const grab = (url: string) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([
      grab("/api/snapshot"),
      grab("/api/allocation"),
      grab("/api/mf/xray"),
      grab("/api/triggers"),
    ]).then(([snap, alloc, xr, trig]) => {
      if (cancelled) return;
      setSnapshot(snap ?? null);
      setAllocation(alloc && Array.isArray(alloc.roles) ? alloc : null);
      setXray(xr?.xray ?? null);
      setTriggers(Array.isArray(trig?.items) ? trig.items : []);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  const classes = [
    { key: "in", label: "Indian equity", color: CLASS_COLOR.in, value: snapshot?.equityValue ?? 0 },
    { key: "mf", label: "Mutual funds", color: CLASS_COLOR.mf, value: mfValue ?? 0 },
    { key: "us", label: "US equity", color: CLASS_COLOR.us, value: usValue ?? 0 },
    { key: "bonds", label: "Bonds", color: CLASS_COLOR.bonds, value: snapshot?.bondsValue ?? 0 },
  ].filter((c) => c.value > 0);
  const total = classes.reduce((s, c) => s + c.value, 0);

  if (classes.length === 0 || total <= 0) {
    return (
      <Card>
        <CardHeader title="Asset allocation" divider={false} />
        <div className="px-6 pb-6 text-[13px] text-tertiary leading-relaxed">
          No allocation data yet. Your agent fills this during /portfolio-check.
        </div>
      </Card>
    );
  }

  const insights = deriveInsights(triggers, allocation, xray);
  const toneColor = { neg: "var(--neg)", warn: "var(--warn)", brand: "var(--brand)" };

  return (
    <Card>
      <CardHeader title="Asset allocation" />
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr]">
        {/* Donut + legend */}
        <div className="flex items-center gap-2 px-4 py-6 md:px-6 flex-wrap sm:flex-nowrap">
          <div className="relative shrink-0 mx-auto sm:mx-0" style={{ width: 176, height: 176 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={classes}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={80}
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={-270}
                  cornerRadius={4}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {classes.map((c) => (
                    <Cell key={c.key} fill={c.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="mono-true font-semibold text-primary text-[15px] tracking-tight leading-none">
                ₹{fmtINR(total)}
              </span>
              <span className="mono-true text-[10px] text-tertiary mt-1.5 leading-none">
                {classes.length} {classes.length === 1 ? "class" : "classes"}
              </span>
            </div>
          </div>
          <ul className="flex-1 min-w-[200px]">
            {classes.map((c, i) => (
              <li
                key={c.key}
                className="flex items-center gap-2.5 py-2.5 px-2"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-[12.5px] text-primary font-medium flex-1 truncate">{c.label}</span>
                <span className="mono-true text-[12.5px] font-semibold text-primary shrink-0">
                  ₹{fmtINR(c.value)}
                </span>
                <span className="mono-true text-[11.5px] text-tertiary shrink-0 w-11 text-right">
                  {((c.value / total) * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* Top 3 moves */}
        <div
          className="px-6 py-5 border-t lg:border-t-0 lg:border-l"
          style={{ borderColor: "var(--border)" }}
        >
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-tertiary font-medium">
            Top 3 moves
          </h3>
          <ul className="mt-1">
            {insights.map((ins, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 py-3"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0 mt-[5px]"
                  style={{ background: toneColor[ins.tone] }}
                />
                <span className="text-[12.5px] text-secondary leading-snug">{ins.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
