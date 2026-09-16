"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CompactStat } from "@/components/ui";

// Shape of ~/.claude .../memory/mf_xray.json (built by /portfolio-check).
type XrayScheme = {
  scheme: string;
  ter: string; // e.g. "0.66"
  aumCr: number;
  category: string;
  valueINR: number;
  holdingsCount: number;
};

type Xray = {
  asOf?: string;
  totalMFValueAnalyzed?: number;
  schemes?: Record<string, XrayScheme>;
  overlapPairs?: Record<string, { pct: number; commonCount: number }>;
  directBookOverlap?: Record<string, { stock: string; schemePct: number }[]>;
  lookThroughTop15?: {
    name: string;
    rupees: number;
    direct?: number;
    viaFunds?: number;
    fundOnly?: boolean;
  }[];
};

const OVERLAP_SHOW = 15; // show pairs at or above this
const OVERLAP_HOT = 35; // red-tint pairs at or above this
const TER_AMBER = 1;
const TER_RED = 1.5;

function fmtINR(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function terTone(ter: number) {
  if (ter >= TER_RED) return { fg: "var(--neg)", bg: "var(--neg-tint)" };
  if (ter >= TER_AMBER) return { fg: "var(--warn)", bg: "var(--warn-tint)" };
  return null;
}

export default function MFXrayCard() {
  const [xray, setXray] = useState<Xray | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mf/xray")
      .then((r) => r.json())
      .then((d: { xray?: Xray | null }) => {
        if (!cancelled) setXray(d?.xray ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  const schemes = xray?.schemes ?? {};
  const schemeKeys = Object.keys(schemes);

  if (!xray || schemeKeys.length === 0) {
    return (
      <Card>
        <CardHeader title="MF X-ray" divider={false} />
        <div className="px-6 pb-6 text-[13px] text-tertiary leading-relaxed">
          No MF X-ray yet. Your agent builds it during /portfolio-check.
        </div>
      </Card>
    );
  }

  const totalValue =
    xray.totalMFValueAnalyzed ??
    schemeKeys.reduce((s, k) => s + (schemes[k]?.valueINR ?? 0), 0);

  const pairs = Object.entries(xray.overlapPairs ?? {}).sort(
    (a, b) => b[1].pct - a[1].pct
  );
  const worst = pairs[0] ?? null;
  const shownPairs = pairs.filter(([, p]) => p.pct >= OVERLAP_SHOW);

  const topExposures = (xray.lookThroughTop15 ?? []).slice(0, 8);

  const schemeRows = schemeKeys
    .map((k) => ({ key: k, ...schemes[k] }))
    .sort((a, b) => (b.valueINR ?? 0) - (a.valueINR ?? 0));

  return (
    <Card>
      <CardHeader
        title="MF X-ray"
        subtitle={`Look-through holdings, overlap, and cost${
          xray.asOf ? ` · as of ${xray.asOf}` : ""
        }`}
        divider={false}
      />

      {/* Headline strip */}
      {/* -mx-px hides the leftmost CompactStat border inside the card;
          the stats' own borderTop doubles as the header divider. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 -mx-px">
        <CompactStat
          label="Schemes analyzed"
          value={String(schemeKeys.length)}
          info="Equity schemes with full holdings data. Arbitrage and vestigial ELSS positions are skipped."
        />
        <CompactStat
          label="Value analyzed"
          value={`₹${fmtINR(totalValue)}`}
        />
        <CompactStat
          label="Worst overlap"
          value={worst ? `${worst[1].pct.toFixed(1)}%` : "—"}
          sub={worst ? worst[0].replace("~", " × ") : undefined}
          accent={worst && worst[1].pct >= OVERLAP_HOT ? "neg" : undefined}
          info="Highest pairwise portfolio overlap between two schemes, weighted by holding percentages."
        />
      </div>

      {/* Overlap pairs */}
      <Block title={`Overlap pairs · ${OVERLAP_SHOW}%+`}>
        {shownPairs.length === 0 ? (
          <div className="text-[12px] text-tertiary">
            No pair above {OVERLAP_SHOW}%. The book is well separated.
          </div>
        ) : (
          <ul className="space-y-1">
            {shownPairs.map(([key, p]) => {
              const hot = p.pct >= OVERLAP_HOT;
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded px-2 -mx-2 py-1.5"
                  style={hot ? { background: "var(--neg-tint)" } : undefined}
                >
                  <span className="mono-true text-[11.5px] text-primary truncate min-w-0 flex-1">
                    {key.replace("~", " × ")}
                  </span>
                  <span className="text-[11px] text-tertiary tabular-nums shrink-0 hidden sm:inline">
                    {p.commonCount} common
                  </span>
                  <span
                    className={`mono-true text-[12px] font-semibold tabular-nums shrink-0 ${
                      hot ? "text-neg" : "text-secondary"
                    }`}
                  >
                    {p.pct.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      {/* True top exposures (look-through): direct stock book + the slices
          hidden inside funds, combined per company. The fund-only names are
          the X-ray's point: exposure you never bought directly. */}
      {topExposures.length > 0 && (
        <Block title="True top exposures · look-through">
          <p className="text-[11.5px] text-tertiary leading-snug mb-2.5">
            Your direct stocks plus what your funds hold, combined per company.
            Via funds marks exposure you never bought directly.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
            {topExposures.map((e, i) => (
              <li key={e.name} className="flex items-center gap-3 py-0.5">
                <span className="mono-true text-[10.5px] text-tertiary tabular-nums w-4 shrink-0">
                  {i + 1}
                </span>
                <span className="text-[12.5px] text-primary truncate min-w-0 flex-1">
                  {e.name}
                </span>
                {e.fundOnly && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: "var(--brand-tint)", color: "var(--brand)" }}
                    title="Held only inside your mutual funds, not directly"
                  >
                    via funds
                  </span>
                )}
                <span
                  className="mono-true text-[12px] text-secondary tabular-nums shrink-0"
                  title={
                    e.direct != null && e.viaFunds != null
                      ? `direct ₹${fmtINR(e.direct)} + funds ₹${fmtINR(e.viaFunds)}`
                      : undefined
                  }
                >
                  ₹{fmtINR(e.rupees)}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Per-scheme cost + size */}
      <Block title="Schemes · cost and size">
        <ul>
          {schemeRows.map((s, i) => {
            const ter = parseFloat(s.ter);
            const tone = Number.isFinite(ter) ? terTone(ter) : null;
            return (
              <li
                key={s.key}
                className="flex items-center gap-3 py-2.5"
                style={
                  i > 0 ? { borderTop: "1px solid var(--border)" } : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-primary truncate leading-tight">
                    {s.scheme}
                  </div>
                  <div className="text-[11px] text-tertiary truncate leading-tight mt-0.5">
                    {s.category} · {s.holdingsCount} holdings
                  </div>
                </div>
                <span className="mono-true text-[11px] text-tertiary tabular-nums shrink-0 hidden md:inline">
                  ₹{fmtINR(s.aumCr)} Cr AUM
                </span>
                <span className="mono-true text-[11.5px] text-secondary tabular-nums shrink-0 hidden sm:inline">
                  ₹{fmtINR(s.valueINR)}
                </span>
                <span
                  className="mono-true text-[10px] px-2 py-0.5 rounded-full shrink-0 tabular-nums"
                  style={{
                    background: tone?.bg ?? "var(--bg-subtle)",
                    color: tone?.fg ?? "var(--text-tertiary)",
                  }}
                >
                  TER {s.ter}%
                </span>
              </li>
            );
          })}
        </ul>
      </Block>
    </Card>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="px-6 py-5"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div className="text-[11px] font-medium text-tertiary mb-3">{title}</div>
      {children}
    </section>
  );
}
