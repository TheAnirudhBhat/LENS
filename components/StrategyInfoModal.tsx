"use client";

import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal, ModalSection } from "./ui/Modal";
import { Segmented } from "./ui/Segmented";

export function StrategyInfoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"how" | "strategy">("how");
  return (
    <Modal open={open} onClose={onClose} title="Lens" maxWidth="max-w-3xl">
      <div className="-mt-1 mb-5">
        <Segmented
          value={tab}
          onChange={setTab}
          ariaLabel="Lens guide"
          options={[
            { value: "how", label: "How it works" },
            { value: "strategy", label: "Strategy" },
          ]}
        />
      </div>
      {tab === "how" ? <HowItWorks /> : <StrategyTab />}
    </Modal>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <>
      <p className="text-[13.5px] text-secondary leading-relaxed">
        LENS brings your whole investing picture into one place: every account,
        plus a record of why you made each move. It&apos;s built to keep you
        disciplined and help you make better calls. It doesn&apos;t place trades.
      </p>

      <Block title="The one command that matters">
        <p className="text-[13px] text-secondary leading-relaxed">
          You drive LENS by talking to your AI assistant: Claude, Codex, or
          Gemini. The one command that matters is <Cmd>/portfolio-check</Cmd>: it
          pulls in every account, checks your whole portfolio, and refreshes LENS.
        </p>
      </Block>

      <Block title="How refreshing works">
        <p className="text-[13px] text-secondary leading-relaxed mb-3">
          Your first <Cmd>/portfolio-check</Cmd> loads everything, so the
          dashboard is already populated the first time you see it. After that,
          run it whenever you want to refresh. LENS tracks what&apos;s already
          current and does only the work that&apos;s needed:
        </p>
        <ul className="space-y-1.5 text-[13px] text-secondary leading-relaxed">
          <li>
            <strong className="text-primary font-medium">Any run</strong> is a
            quick sync: live prices, holdings, and your latest decisions.
          </li>
          <li>
            <strong className="text-primary font-medium">Weekly</strong>, a full
            re-check: every account re-pulled, your idea lists re-evaluated.
          </li>
          <li>
            <strong className="text-primary font-medium">Monthly</strong>, a
            strategy and allocation checkpoint, with a deeper re-rank each quarter.
          </li>
          <li>
            It also refreshes on its own when something big lands, like an
            earnings print or a market regime shift.
          </li>
        </ul>
        <p className="text-[13px] text-secondary leading-relaxed mt-3">
          You don&apos;t have to track any of this. Run it when you like; it does
          the right amount.
        </p>
      </Block>

      <Block title="Everything else is just asking">
        <p className="text-[13px] text-secondary leading-relaxed mb-3">
          Apart from <Cmd>/portfolio-check</Cmd>, you just ask your assistant in
          plain English. It has your live data and the right tools, so the answers
          are tailored to you. For example:
        </p>
        <ul className="space-y-1.5 text-[13px] text-secondary leading-relaxed">
          <li>&ldquo;<em>rate my asset allocation</em>&rdquo;</li>
          <li>&ldquo;<em>what&apos;s working for me, and what isn&apos;t?</em>&rdquo;</li>
          <li>&ldquo;<em>what needs my attention right now?</em>&rdquo;</li>
          <li>&ldquo;<em>find new ideas in a sector I like</em>&rdquo;</li>
          <li>&ldquo;<em>connect my Zerodha, Groww, or INDmoney</em>&rdquo;</li>
        </ul>
      </Block>

      <Block title="The weekly habit">
        <ol className="text-[13px] text-secondary leading-relaxed space-y-1.5 list-decimal pl-5">
          <li>Run <Cmd>/portfolio-check</Cmd> (weekly is enough).</li>
          <li>Before any buy or sell, jot the decision and a one-line exit rule.</li>
          <li>Clear whatever LENS flags for your attention.</li>
          <li>Review your hit-rate over time. That&apos;s what makes you better.</li>
        </ol>
      </Block>

      <Block title="Keeping LENS updated">
        <p className="text-[13px] text-secondary leading-relaxed">
          Update from git with <Cmd>git pull</Cmd> in your LENS folder. A
          one-click &ldquo;update available&rdquo; check is coming.
        </p>
      </Block>
    </>
  );
}

// ── Strategy (per-user, data-driven) ─────────────────────────────────────────
// Renders the user's own strategy.md when present; otherwise a generic,
// non-personal template. No personal figures, holdings, names, or dates here.

function StrategyTab() {
  const [strategy, setStrategy] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/strategy");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { strategy: string | null } = await res.json();
        if (!alive) return;
        setStrategy(typeof data.strategy === "string" ? data.strategy : null);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <p className="text-[13px] text-tertiary leading-relaxed">Loading your strategy…</p>
    );
  }

  if (state === "error") {
    return (
      <p className="text-[13px] text-tertiary leading-relaxed">
        Couldn&apos;t load your strategy right now. Your strategy lives in{" "}
        <code className="mono-true">strategy.md</code>; try reopening this in a moment.
      </p>
    );
  }

  const hasStrategy = strategy != null && strategy.trim().length > 0;

  return (
    <>
      <p className="text-[12.5px] text-tertiary leading-snug mb-5">
        This is consulted, not read. Source of truth:{" "}
        <code className="mono-true">strategy.md</code>.
        {!hasStrategy && " The illustrative template below shows the shape; your agent drafts the real thing during setup."}
      </p>

      {hasStrategy ? <StrategyMarkdown source={strategy!} /> : <StrategyTemplate />}
    </>
  );
}

// Renders the user's strategy markdown, styled for the dark modal.
function StrategyMarkdown({ source }: { source: string }) {
  return (
    <div className="strategy-md text-[13px] text-secondary leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="text-[15px] font-semibold text-primary mt-5 mb-2 first:mt-0">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-[14px] font-semibold text-primary mt-5 mb-2 first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-[13px] font-semibold text-primary mt-4 mb-2">{children}</h4>
          ),
          p: ({ children }) => <p className="text-secondary leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1.5 text-secondary leading-relaxed">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1.5 text-secondary leading-relaxed">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
          em: ({ children }) => <em className="text-secondary">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          hr: () => <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} className="my-4" />,
          blockquote: ({ children }) => (
            <blockquote
              className="pl-3 text-secondary italic"
              style={{ borderLeft: "2px solid var(--border)" }}
            >
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code
              className="mono-true rounded px-1.5 py-0.5 text-[12px] text-primary"
              style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
            >
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full text-[12.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="text-left px-3 py-2 font-semibold text-secondary">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-secondary align-top leading-snug">{children}</td>
          ),
          tr: ({ children }) => (
            <tr style={{ borderTop: "1px solid var(--border)" }}>{children}</tr>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// Generic, non-personal scaffold shown on a fresh install (no strategy.md yet).
// Same section shape as a real plan, but with neutral placeholder guidance and
// no figures, holdings, names, or dates.
function StrategyTemplate() {
  const sections: { n: string; title: string; body: string }[] = [
    {
      n: "1",
      title: "The two levers",
      body: "The two things you actually control — your return rate and how much you deploy. Your agent fills in your sustainable ceiling and what each lever is worth to you.",
    },
    {
      n: "2",
      title: "Goal ladder",
      body: "Your base, stretch, and moonshot targets, with the return each one implies. Drafted from your timeline and savings rate during setup.",
    },
    {
      n: "3",
      title: "Asset allocation",
      body: "Your target split across equity, debt-equivalent, hedges, and cash, plus the drift bands that trigger a rebalance. Your agent sets these to your conviction.",
    },
    {
      n: "4",
      title: "Role buckets",
      body: "How your equity breaks down by role — compounders, growth, cyclicals, defensives, hedges — with a target weight and an exit trigger for each.",
    },
    {
      n: "5",
      title: "Decision rules",
      body: "Your rules for entries, adds, trims, and exits — minimum position size, single-name caps, and when a thesis is broken. Written once so you don't decide in the heat of the moment.",
    },
    {
      n: "6",
      title: "Refresh cadence",
      body: "How often you check in by default, and the events (earnings, regime shifts, price triggers) that pull a refresh forward.",
    },
    {
      n: "7",
      title: "How we find new ideas",
      body: "The filter every new idea must pass before it becomes a position — your bar for edge, runway, capital allocation, sizing, and a pre-declared exit.",
    },
    {
      n: "8",
      title: "What we won't do",
      body: "The short list of moves you've ruled out in advance — the behavioral guardrails that keep one bad day from undoing the plan.",
    },
  ];
  return (
    <>
      {sections.map((s) => (
        <Section key={s.n} n={s.n} title={s.title}>
          <p className="text-[13px] text-secondary leading-relaxed">{s.body}</p>
        </Section>
      ))}
      <p className="mt-6 text-[11px] text-tertiary leading-snug">
        This is an illustrative template. Ask your assistant to draft your strategy and it
        will write your own <code className="mono-true">strategy.md</code>, which appears here.
      </p>
    </>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ModalSection>
      <h3 className="text-[14px] font-semibold text-primary mb-3">{title}</h3>
      {children}
    </ModalSection>
  );
}

function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="mono-true inline-flex items-center rounded-md px-2 py-0.5 text-[12.5px] text-primary"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      {children}
    </code>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <ModalSection>
      <h3 className="text-[14px] font-semibold text-primary mb-3 flex items-baseline gap-2">
        <span className="mono-true text-tertiary text-[12px]">§{n}</span>
        <span>{title}</span>
      </h3>
      {children}
    </ModalSection>
  );
}

export default StrategyInfoModal;
