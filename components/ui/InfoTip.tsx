"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function InfoTip({ text, size = "md" }: { text: string; size?: "xs" | "sm" | "md" }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const tipW = 256;
    const margin = 8;
    let left = r.left;
    if (left + tipW + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - tipW - margin);
    }
    setCoords({ top: r.bottom + 6, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <span className="inline-flex align-middle">
      <span
        ref={triggerRef}
        aria-label={text}
        tabIndex={0}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`${size === "xs" ? "ml-[0.25em]" : "ml-[0.4em]"} inline-flex items-center justify-center cursor-help select-none shrink-0 text-tertiary hover:text-primary transition-colors`}
        style={{
          width: size === "sm" ? "1em" : size === "xs" ? "0.8em" : "0.7em",
          height: size === "sm" ? "1em" : size === "xs" ? "0.8em" : "0.7em",
          verticalAlign: "middle",
          position: "relative",
          top: "-0.05em",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      </span>
      {mounted && open && coords &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 w-64 rounded-lg p-3 type-caption text-secondary shadow-lg"
            style={{
              top: coords.top,
              left: coords.left,
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              lineHeight: "1.5",
              textTransform: "none",
              letterSpacing: "normal",
              fontWeight: 400,
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}

export default InfoTip;
