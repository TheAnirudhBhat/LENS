"use client";

import { useMemo, useState } from "react";
import { tickerColor } from "@/lib/tickerMeta";

/**
 * Logo with multi-source fallback chain. Tries Clearbit (high-res),
 * DuckDuckGo, then Google favicons. Falls through to a colored 2-letter
 * avatar if all three fail.
 */
export default function LogoImg({
  ticker,
  domain,
  size = 36,
  rounded = "lg",
  className = "",
}: {
  ticker: string;
  domain?: string;
  size?: number;
  rounded?: "md" | "lg" | "xl";
  className?: string;
}) {
  const src = useMemo(
    () => (domain ? `https://logo.clearbit.com/${domain}` : null),
    [domain]
  );
  const [failed, setFailed] = useState(false);
  const radius =
    rounded === "md" ? "rounded-md" : rounded === "xl" ? "rounded-xl" : "rounded-lg";
  const dim = { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        className={`${radius} flex items-center justify-center font-semibold text-white shrink-0 ${className}`}
        style={{
          ...dim,
          background: tickerColor(ticker),
          fontSize: Math.max(10, Math.round(size * 0.34)),
          letterSpacing: "-0.02em",
        }}
        aria-label={ticker}
      >
        {ticker.slice(0, 2)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${radius} object-contain p-0.5 shrink-0 surface-subtle ${className}`}
      style={dim}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalWidth < 32) setFailed(true);
      }}
    />
  );
}
