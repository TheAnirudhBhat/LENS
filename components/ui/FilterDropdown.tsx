"use client";

import React, { useEffect, useRef, useState } from "react";

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  count?: number;
};

export function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  defaultValue,
  ariaLabel,
}: {
  label: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (v: T) => void;
  defaultValue: T;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const isFiltered = value !== defaultValue;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-colors accent-ring inline-flex items-center gap-1.5 ${
          isFiltered ? "text-primary" : "text-secondary hover:text-primary"
        }`}
        style={{
          background: isFiltered ? "var(--brand-tint)" : "var(--bg-subtle)",
          boxShadow: isFiltered ? "inset 0 0 0 1px var(--brand)" : undefined,
        }}
      >
        {isFiltered ? (
          <>
            <span className="text-tertiary">{label}:</span>
            <span className="truncate max-w-[160px]">{selected?.label ?? "—"}</span>
          </>
        ) : (
          <span>{label}</span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel ?? label}
          className="absolute left-0 top-full mt-1.5 z-30 surface rounded-lg p-1 w-[420px] max-w-[80vw] max-h-[520px] overflow-y-auto no-scrollbar"
          style={{ boxShadow: "0 8px 24px -8px rgba(0,0,0,0.16)" }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-md flex items-start gap-2 transition-colors ${
                  active ? "text-primary" : "text-secondary hover:text-primary"
                }`}
                style={active ? { background: "var(--bg-subtle)" } : undefined}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] flex-1 truncate">
                      {o.label}
                    </span>
                    {typeof o.count === "number" && (
                      <span className="text-tertiary mono text-[10.5px]">
                        {o.count}
                      </span>
                    )}
                  </div>
                  {o.hint && (
                    <p className="text-[11px] text-tertiary leading-snug mt-0.5 line-clamp-2">
                      {o.hint}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FilterDropdown;
