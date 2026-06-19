"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { MFEntry } from "@/lib/parsers";

const AMC_COLORS: Record<string, string> = {
  PPFAS: "#f59e0b",
  HDFC: "#d23a35",
  Mirae: "#1f5db8",
  Axis: "#97144d",
  "Nippon India": "#de2828",
  "ICICI Pru": "#b02a33",
  UTI: "#0066b3",
  Quant: "#4338ca",
  SBI: "#1f4e9c",
  Kotak: "#ed1c24",
  Tata: "#486aae",
  "Aditya Birla": "#d62828",
  Birla: "#d62828",
  ABSL: "#d62828",
  DSP: "#002663",
  Edelweiss: "#c81b1b",
};

const AMC_INITIALS: Record<string, string> = {
  PPFAS: "PPF",
  HDFC: "HDFC",
  Mirae: "MIR",
  Axis: "AXIS",
  "Nippon India": "NIP",
  "ICICI Pru": "ICI",
  UTI: "UTI",
  Quant: "QNT",
  SBI: "SBI",
  Kotak: "KOT",
  Tata: "TAT",
  "Aditya Birla": "ABSL",
  Birla: "ABSL",
  ABSL: "ABSL",
  DSP: "DSP",
  Edelweiss: "EDW",
};

function amcKey(amc: string): string | null {
  const keys = Object.keys(AMC_COLORS);
  const hit = keys.find((k) => amc.toLowerCase().includes(k.toLowerCase()));
  return hit ?? null;
}

function amcColor(amc: string): string | null {
  const k = amcKey(amc);
  return k ? AMC_COLORS[k] : null;
}

function amcInitials(amc: string): string {
  const k = amcKey(amc);
  if (k) return AMC_INITIALS[k];
  return amc.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "MF";
}

function thesisColor(h?: MFEntry["thesisHealth"]) {
  if (h === "green") return "var(--pos)";
  if (h === "amber") return "var(--warn)";
  if (h === "red") return "var(--neg)";
  return "var(--border)";
}
function thesisLabel(h?: MFEntry["thesisHealth"]) {
  if (h === "green") return "thesis intact";
  if (h === "amber") return "thesis on watch";
  if (h === "red") return "thesis broken";
  return "no thesis flag";
}

function fmtINR(n: number | undefined) {
  if (n === undefined || n === null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | undefined, digits = 1) {
  if (n === undefined || n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
function pctCls(n: number | undefined) {
  if (n === undefined) return "text-tertiary";
  if (n > 0) return "text-pos";
  if (n < 0) return "text-neg";
  return "text-secondary";
}

export function AMCChip({
  amc,
  size = 36,
  rounded = "lg",
}: {
  amc: string;
  size?: number;
  rounded?: "md" | "lg" | "xl";
}) {
  const color = amcColor(amc);
  const radius =
    rounded === "md" ? "rounded-md" : rounded === "xl" ? "rounded-xl" : "rounded-lg";
  const useTokenBg = !color;
  return (
    <div
      className={`${radius} flex items-center justify-center mono-true shrink-0 ${
        useTokenBg ? "text-tertiary" : "text-white"
      }`}
      style={{
        width: size,
        height: size,
        background: color ?? "var(--bg-subtle)",
        fontSize: Math.max(10, Math.round(size * 0.32)),
        fontWeight: 600,
        letterSpacing: "-0.02em",
      }}
      aria-label={amc}
    >
      {amcInitials(amc)}
    </div>
  );
}

function riskTone(r?: MFEntry["riskLabel"]) {
  if (!r) return null;
  if (r === "Low" || r === "Low to Moderate" || r === "Moderate") {
    return { bg: "var(--pos-tint)", fg: "var(--pos)" };
  }
  if (r === "Moderately High") {
    return { bg: "rgba(244, 180, 0, 0.12)", fg: "var(--warn)" };
  }
  return { bg: "var(--neg-tint)", fg: "var(--neg)" };
}

function RiskChip({ risk }: { risk?: MFEntry["riskLabel"] }) {
  const tone = riskTone(risk);
  if (!tone || !risk) return null;
  return (
    <span
      className="inline-block text-[10px] mono-true uppercase px-2 py-0.5 rounded-full"
      style={{ background: tone.bg, color: tone.fg, letterSpacing: "0.02em" }}
    >
      {risk}
    </span>
  );
}

export default function MFCard({
  m,
  onOpen,
}: {
  m: MFEntry;
  onOpen?: (ticker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const handleClick = onOpen
    ? () => onOpen(m.ticker ?? m.scheme.replace(/\s+/g, "").toUpperCase())
    : () => setOpen(true);

  return (
    <>
      <button
        onClick={handleClick}
        role="button"
        tabIndex={0}
        className="relative w-[calc(100%+3rem)] md:w-[calc(100%+5rem)] text-left grid grid-cols-[40px_1fr_70px_70px] md:grid-cols-[40px_1fr_100px_100px_70px] -mx-6 md:-mx-10 gap-x-3 items-center py-5 px-10 md:px-16 transition-colors hover:bg-[var(--bg-subtle)] cursor-pointer after:content-[''] after:absolute after:bottom-0 after:left-[92px] md:after:left-[116px] after:right-10 md:after:right-16 after:h-px after:bg-[var(--border)]"
      >
        <AMCChip amc={m.amc} size={36} />

        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-tight text-primary truncate">
            {m.scheme}
          </div>
          <div className="text-[11px] text-tertiary truncate leading-tight mt-0.5">
            {m.category}
            {m.riskLabel ? ` · ${m.riskLabel}` : ""}
          </div>
        </div>

        {/* Value */}
        <div className="hidden md:block text-right mono text-[14px] font-semibold text-primary">
          ₹{fmtINR(m.value)}
        </div>

        {/* Today */}
        <div className={`text-right text-[13px] mono font-medium ${pctCls(m.dayChangePct)}`}>
          {fmtPct(m.dayChangePct, 2)}
        </div>

        {/* Total P&L (always rightmost) */}
        <div className={`text-right text-[13px] mono font-medium ${pctCls(m.pnlPct)}`}>
          {fmtPct(m.pnlPct, 1)}
        </div>
      </button>

      {open && <DetailsModal m={m} onClose={() => setOpen(false)} />}
    </>
  );
}

function DetailsModal({ m, onClose }: { m: MFEntry; onClose: () => void }) {
  const pnl =
    m.invested !== undefined && m.pnlPct !== undefined
      ? (m.pnlPct / 100) * m.invested
      : undefined;
  const hasReturns =
    m.return1y !== undefined || m.return3y !== undefined || m.return5y !== undefined;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start gap-4 pb-5">
          <AMCChip amc={m.amc} size={56} rounded="xl" />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-primary leading-tight">
              {m.scheme}
            </div>
            <div className="text-sm text-secondary mt-0.5">{m.amc}</div>
            <div className="text-[11px] text-tertiary mt-0.5">{m.category}</div>
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <Section title="Position">
          <div className="grid grid-cols-3 gap-x-5 gap-y-4">
            <DataPoint label="Market value" value={`₹${fmtINR(m.value)}`} emphasis />
            <DataPoint label="Units" value={m.units.toFixed(3)} />
            <DataPoint label="NAV" value={`₹${m.nav.toFixed(2)}`} />
            {m.avgNav !== undefined && (
              <DataPoint label="Avg NAV" value={`₹${m.avgNav.toFixed(2)}`} />
            )}
            {m.invested !== undefined && (
              <DataPoint label="Invested" value={`₹${fmtINR(m.invested)}`} />
            )}
            {m.folio && <DataPoint label="Folio" value={m.folio} small />}
          </div>
        </Section>

        <Section title="Performance">
          <DataPoint
            label="Total P&L"
            value={fmtPct(m.pnlPct, 1)}
            sub={
              pnl !== undefined
                ? `${pnl >= 0 ? "+" : ""}₹${fmtINR(Math.round(pnl))}`
                : undefined
            }
            accent={pctCls(m.pnlPct)}
            emphasis
          />
          {m.xirr !== undefined && (
            <div className="mt-4">
              <DataPoint
                label="XIRR"
                value={fmtPct(m.xirr, 1)}
                accent={pctCls(m.xirr)}
              />
            </div>
          )}
          {hasReturns && (
            <div className="grid grid-cols-3 gap-x-5 gap-y-4 mt-4">
              <DataPoint
                label="1Y"
                value={fmtPct(m.return1y, 1)}
                accent={pctCls(m.return1y)}
                small
              />
              <DataPoint
                label="3Y"
                value={fmtPct(m.return3y, 1)}
                accent={pctCls(m.return3y)}
                small
              />
              <DataPoint
                label="5Y"
                value={fmtPct(m.return5y, 1)}
                accent={pctCls(m.return5y)}
                small
              />
            </div>
          )}
        </Section>

        {m.sipAmount !== undefined && (
          <Section title="SIP">
            <div className="grid grid-cols-3 gap-x-5 gap-y-4">
              <DataPoint label="Amount" value={`₹${fmtINR(m.sipAmount)}/mo`} />
              <DataPoint
                label="Status"
                value={m.sipActive ? "active" : "paused"}
                accent={m.sipActive ? "text-pos" : "text-tertiary"}
              />
            </div>
          </Section>
        )}

        {(m.thesisHealth || m.thesisNote) && (
          <Section title="Thesis">
            <div className="space-y-3">
              {m.thesisHealth && (
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ background: thesisColor(m.thesisHealth) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-tertiary mb-0.5 font-medium">
                      {thesisLabel(m.thesisHealth)}
                    </div>
                    {m.thesisNote && (
                      <div className="text-secondary text-[13px] leading-relaxed">
                        {m.thesisNote}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!m.thesisHealth && m.thesisNote && (
                <div className="text-[13px] text-primary leading-relaxed">
                  {m.thesisNote}
                </div>
              )}
            </div>
          </Section>
        )}

        {m.riskLabel && (
          <Section title="Risk">
            <RiskChip risk={m.riskLabel} />
          </Section>
        )}
      </div>
    </div>,
    document.body
  );
}

function Section({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`pt-5 mt-5 ${className}`}
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div className="text-[11px] font-medium text-tertiary mb-4">{title}</div>
      {children}
    </section>
  );
}

function DataPoint({
  label,
  value,
  sub,
  accent,
  emphasis,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  emphasis?: boolean;
  small?: boolean;
}) {
  const sizeCls = emphasis
    ? "text-[22px]"
    : small
    ? "text-[13px]"
    : "text-[15px]";
  return (
    <div>
      <div className="text-[11px] text-tertiary mb-1">{label}</div>
      <div className={`mono font-semibold leading-none tabular-nums ${sizeCls} ${accent || "text-primary"}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-tertiary mt-1.5 mono">{sub}</div>}
    </div>
  );
}
