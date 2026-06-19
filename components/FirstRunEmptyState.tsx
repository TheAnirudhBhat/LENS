import type { ReactNode } from "react";

/** Inline code chip — matches the Cmd style in StrategyInfoModal and Onboarding. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <code
      className="mono-true inline-flex items-center rounded-md px-2 py-0.5 text-[12.5px] text-primary"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      {children}
    </code>
  );
}

interface FirstRunEmptyStateProps {
  title: string;
  message?: ReactNode;
}

/**
 * First-run / no-data placeholder for the Overview hero. The /portfolio-check
 * call-to-action is built in; `message` is an optional contextual line shown
 * above it. Presentational only — no fetching, no state. Distinct from the
 * inline per-section EmptyState used within other tabs.
 */
export default function FirstRunEmptyState({ title, message }: FirstRunEmptyStateProps) {
  return (
    <div className="surface rounded-lg flex flex-col items-center justify-center gap-4 py-16 px-8 text-center">
      <p className="text-[15px] font-semibold text-primary">{title}</p>
      {message && (
        <p className="text-[13px] text-secondary leading-relaxed max-w-sm">{message}</p>
      )}
      <p className="text-[13px] text-tertiary">
        Run <Chip>/portfolio-check</Chip> and your agent fills it in.
      </p>
    </div>
  );
}
