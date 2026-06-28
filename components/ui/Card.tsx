"use client";

import React from "react";

export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      className={`surface rounded-lg overflow-hidden ${className}`}
      style={style}
    >
      {children}
    </section>
  );
}

// Standard section header used inside cards: "Asset allocation",
// "Today's actions", etc. 15/16px font-semibold with optional actions
// on the right and a hairline divider below.
export function CardHeader({
  title,
  subtitle,
  actions,
  divider = true,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <header
      className="px-6 py-5 flex items-center justify-between flex-wrap gap-3"
      style={divider ? { borderBottom: "1px solid var(--border)" } : undefined}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] md:text-[16px] font-semibold tracking-[-0.005em] text-primary inline-flex items-center">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[12px] text-tertiary mt-1 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

export default Card;
