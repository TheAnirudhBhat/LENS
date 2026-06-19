"use client";

import React from "react";

export function SectionTitle({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap pb-2">
      <div className="min-w-0">
        <h2 className="text-[15px] md:text-[16px] font-semibold text-primary tracking-[-0.005em]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[12px] text-tertiary mt-1 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export default SectionTitle;
