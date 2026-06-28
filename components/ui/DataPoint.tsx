/** A labelled metric: caption label over a mono value, optional sub-line.
 *  `emphasis` enlarges the value (hero stat), `small` shrinks it; `accent` is a
 *  text-color class. Shared by HoldingCard and MFCard. */
export function DataPoint({
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

export default DataPoint;
