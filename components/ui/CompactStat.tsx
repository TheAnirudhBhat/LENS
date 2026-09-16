"use client";

import { InfoTip } from "./InfoTip";

export function CompactStat({
  label,
  value,
  sub,
  accent,
  info,
  valueInfo,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "pos" | "neg";
  /** Tooltip on the label — explains what this stat is in general. */
  info?: string;
  /** Tooltip on the value — explains the current reading specifically. */
  valueInfo?: string;
}) {
  const accentCls =
    accent === "pos"
      ? "text-pos"
      : accent === "neg"
      ? "text-neg"
      : "text-primary";
  return (
    <div
      className="px-6 py-6 md:px-7 md:py-7"
      style={{ borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}
    >
      <div className="eyebrow flex items-center">
        {label}
        {info && <InfoTip text={info} size="sm" />}
      </div>
      <div className={`mono-true font-semibold mt-3 text-[22px] md:text-[26px] tracking-tight leading-none flex items-center ${accentCls}`}>
        <span>{value}</span>
        {valueInfo && <InfoTip text={valueInfo} size="xs" />}
      </div>
      {sub && (
        <div className="text-[11px] text-tertiary mt-2.5 mono-true">{sub}</div>
      )}
    </div>
  );
}

export default CompactStat;
