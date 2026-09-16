"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`modal-card surface rounded-lg p-7 ${maxWidth} w-full max-h-[90vh] overflow-y-auto no-scrollbar`}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-6 mb-5">
            <div className="min-w-0">
              {title && (
                <h2
                  className="text-[18px] md:text-[20px] leading-[1.05] font-black tracking-[-0.02em] text-primary uppercase"
                  style={{
                    fontFamily:
                      "var(--font-display-wide), system-ui, sans-serif",
                    fontStretch: "120%",
                  }}
                >
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-[12px] text-tertiary mt-2 leading-snug">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-tertiary hover:text-primary text-2xl leading-none accent-ring rounded-md shrink-0"
              aria-label="Close"
            >
              ×
            </button>
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

// Section block inside a modal — separated by a hairline rule above
// with consistent pt-5/mt-5 spacing.
export function ModalSection({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pt-5 mt-5 ${className}`}
      style={{ borderTop: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}

// Footer with a divider above and right-aligned CTA stack.
export function ModalFooter({
  children,
  align = "between",
}: {
  children: React.ReactNode;
  align?: "between" | "end";
}) {
  const justify = align === "between" ? "justify-between" : "justify-end";
  return (
    <div
      className={`pt-5 mt-5 flex items-center ${justify} gap-3 flex-wrap`}
      style={{ borderTop: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}

export default Modal;
