"use client";

type SegOption<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const cell =
    size === "sm" ? "px-2.5 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12px]";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 flex-wrap"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`${cell} font-medium rounded-full transition-colors accent-ring ${
              active
                ? "text-primary"
                : "text-tertiary hover:text-secondary"
            }`}
            style={
              active
                ? { background: "var(--bg-subtle)" }
                : undefined
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
