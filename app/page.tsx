"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type {
  WatchlistEntry,
  MultibaggerEntry,
  MFEntry,
  MFSummary,
} from "@/lib/parsers";
import type {
  Verdict,
  CouncilTag,
  CouncilSeat,
  CouncilBreakdown,
  USCandidate,
  MFCandidate,
} from "@/lib/researchTypes";
import HoldingCard from "@/components/HoldingCard";
import MFCard, { AMCChip } from "@/components/MFCard";
import dynamic from "next/dynamic";

const NewsTab = dynamic(() => import("@/components/NewsTab"), {
  ssr: false,
  loading: () => <div className="text-tertiary text-sm px-6 py-12">Loading news…</div>,
});
const EarningsTabV2 = dynamic(() => import("@/components/EarningsTab"), {
  ssr: false,
  loading: () => <div className="text-tertiary text-sm px-6 py-12">Loading earnings…</div>,
});
import TickerTape from "@/components/TickerTape";
import ThemeToggle from "@/components/ThemeToggle";
import LogoImg from "@/components/LogoImg";
import TaskExplainerModal from "@/components/TaskExplainerModal";
// TriggerBanner removed — triggers are now merged into the Actions section.
import StrategyInfoModal from "@/components/StrategyInfoModal";
import Onboarding from "@/components/Onboarding";
import FirstRunEmptyState from "@/components/FirstRunEmptyState";
import MFXrayCard from "@/components/MFXrayCard";
import PortfolioScoreCard from "@/components/PortfolioScoreCard";
import SmartMoneyPanel from "@/components/SmartMoneyPanel";
import StrategyLab from "@/components/StrategyLab";
import PerTickerDrawer, {
  type Market as PerTickerMarket,
} from "@/components/PerTickerDrawer";
const AllocationTab = dynamic(() => import("@/components/AllocationTab"), {
  ssr: false,
  loading: () => <div className="text-tertiary text-sm px-6 py-12">Loading allocation…</div>,
});
import { TICKER_META, getMeta } from "@/lib/tickerMeta";
import { ageState, overdueDays } from "@/lib/taskAge";
import {
  CONCENTRATION,
  US_RESEARCH,
  SCORE_BANDS,
} from "@/lib/policy";
import {
  computeRisk,
  concentrationLabel,
  type Holding as AnHolding,
} from "@/lib/analytics";
import {
  Button,
  Card,
  CardHeader,
  Modal,
  ModalSection,
  ModalFooter,
  SectionTitle,
  InfoTip,
  CompactStat,
  Toolbar,
  ToolbarGroup,
  Segmented,
  FilterDropdown,
} from "@/components/ui";

type Holding = {
  ticker: string;
  qty: number;
  avgPrice?: number;
  ltp: number;
  value: number;
  weight: number;
  pnlPct?: number;
  dayChangePct?: number;
  role?: string;
  market?: "IN" | "US";
  currency?: "INR" | "USD";
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
};

type UrgentItem = {
  level: "info" | "warn" | "crit";
  ticker?: string;
  headline: string;
  action?: string;
};

type BookedGain = {
  date: string;
  asset: string;
  ticker: string;
  action: string;
  amount: number;
  note?: string;
};

type Snapshot = {
  asOf: string;
  totalValue: number;
  cash?: number;
  // Sum of role="debt-equiv" holdings, written by /api/sync. Source of truth
  // for the bonds slice when per-holding role tags are missing.
  bondsValue?: number;
  holdings: Holding[];
  regime?: string;
  regimeDetail?: string;
  nifty?: { value: number | null; dayChangePct: number | null };
  urgent?: UrgentItem[];
  peakValue?: number;
  peakDate?: string;
  bookedGains?: BookedGain[];
  // Live IN-equity aggregates from Kite (added in snapshot enrichment).
  liveInEquityPnL?: number;
  liveInEquityValue?: number;
  liveInEquityCost?: number;
  liveInEquityPnLPct?: number;
};

type TabId =
  | "overview"
  | "allocation"
  | "holdings"
  | "usstocks"
  | "bonds"
  | "mutualfunds"
  | "stockresearch"
  | "usresearch"
  | "mfresearch"
  | "news"
  | "earnings"
  | "tasks"
  | "decisions"
  | "strategylab";

type NavGroup = { label: string; items: { id: TabId; label: string }[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "portfolio",
    items: [
      { id: "overview", label: "Overview" },
      { id: "allocation", label: "Allocation" },
      { id: "holdings", label: "Indian equity" },
      { id: "usstocks", label: "US equity" },
      { id: "bonds", label: "Bonds" },
      { id: "mutualfunds", label: "Mutual funds" },
    ],
  },
  {
    label: "research",
    items: [
      { id: "stockresearch", label: "Indian equity" },
      { id: "usresearch", label: "US equity" },
      { id: "mfresearch", label: "Mutual funds" },
      { id: "news", label: "News" },
    ],
  },
  {
    label: "log",
    items: [
      { id: "earnings", label: "Earnings" },
      { id: "tasks", label: "Tasks" },
      { id: "decisions", label: "Decision tracker" },
      { id: "strategylab", label: "Strategy lab" },
    ],
  },
];

const CHANGELOG_ITEMS = [
  {
    date: "2026-05-30",
    title: "First-run welcome screen",
    detail: "A full-screen intro for new installs (image on the left, guide on the right): what LENS is, how to use it (you drive it by talking to your assistant: /portfolio-check is the one command that matters; everything else is plain-English questions), and getting set up (keep your LENS folder safe in Documents, not Downloads). Shows once after install; reopen anytime with ?onboarding=1. On dismiss it dissolves from the bottom to reveal the dashboard.",
  },
  {
    date: "2026-05-30",
    title: "Help panel: How it works + Strategy",
    detail: "The ? button in the sidebar now opens two tabs: a plain-English 'How it works' guide (the weekly habit, example questions like 'rate my asset allocation' or 'what's working and what's not', keeping LENS updated) alongside your existing Strategy.",
  },
  {
    date: "2026-05-14",
    title: "Earnings tab (Log → Earnings)",
    detail: "New Earnings tab in the Log group. Pulls last-filed prints for all current IN + US holdings from official sources: NSE corporate announcements (with browser-style cookie prime) for Indian equity, SEC EDGAR full-text search for US equity, filtered to filings actually issued by the holding's CIK. 12h disk cache; STALE label kicks in if a refresh fails and we fall back to old data. Surfaces a Task impact panel that scans tasks.json for tickers/period patterns and flags 'EARNINGS LANDED' suggestions — read-only; no auto-edits.",
  },
  {
    date: "2026-05-14",
    title: "News correlation engine (Research → News)",
    detail: "New News tab under Research. Pulls Moneycontrol + Yahoo Finance RSS, tags each headline against your IN+US holdings via Claude Haiku 4.5 (with prompt caching on the portfolio prefix), and shows predicted direction/magnitude/horizon/confidence on each card. Forecast sub-tab = fresh news; Played-out = older items with a price-delta sparkline (currently stubbed). 2hr server cache. Falls back to keyword tagging if ANTHROPIC_API_KEY is missing.",
  },
  {
    date: "2026-05-14",
    title: "INDmoney login from the dashboard",
    detail: "Refresh modal now exposes an 'INDmoney login' button next to the US equity row. Clicking it spawns the indian-broker MCP server and opens a headed Chrome for OTP login — same pattern as the existing Kite re-login, but for INDmoney. Status polls every 3s while waiting, flips to connected once the session is captured.",
  },
  {
    date: "2026-05-13",
    title: "Live PnL + day change from Kite Connect",
    detail: "Indian equity holdings now show live LTPs, day_change%, and live PnL — sourced from Kite Connect at request time, falling back to the static snapshot if your Kite session has expired. /portfolio-check also switched to Kite for Indian holdings (5× faster than the MCP).",
  },
  {
    date: "2026-05-13",
    title: "Today's Actions stays in sync with Tasks tab",
    detail: "The home-page widget now shows the top 5 active tasks sorted by priority, with text identical to the Tasks page. Snapshot urgent[] is restricted to non-ticker market alerts so wording can never drift between the two views.",
  },
  {
    date: "2026-05-13",
    title: "Owned stocks hidden from Indian equity ideas",
    detail: "Once a ticker is in your book, it no longer appears in the ideas list unless you toggle 'Include holdings'. Earlier overlap rule was lenient and let owned watchlist names leak through.",
  },
  {
    date: "2026-05-13",
    title: "Watchlist cap at 12 + tasks cap at 10",
    detail: "Active stock watchlist is hard-capped at 12 (sorted by conviction). Tasks tab capped at 10. Anything beyond gets demoted to a Parked list. Both caps surface in /portfolio-check.",
  },
  {
    date: "2026-05-13",
    title: "Engineering hygiene — Zod, tests, hardened parsers",
    detail: "API routes validate file shape with Zod (loud failure instead of silent broken renders). 30 vitest tests cover the parser, schemas, and policy constants. Markdown parsers now tolerate format drift (numbering, italic metadata, varied section headers). MF rotations moved out of TSX into memory/project_mf_rotations.json.",
  },
  {
    date: "2026-05-03",
    title: "Tasks tab pulls in US and MF research items",
    detail: "Trim queue from US equity research and rotation queue from MF research now appear as tasks alongside manual ones. New asset filter (IN equity / US equity / Mutual funds / Bonds / Metals) with live counts at the top of the page.",
  },
  {
    date: "2026-05-03",
    title: "List rows now reach the right margin",
    detail: "Indian equity, US equity, mutual funds, earnings, and tasks rows previously stopped 40px short on the right because of a w-full + negative-margin interaction. Replaced with a calc-based width so rows extend symmetrically past the section edges.",
  },
  {
    date: "2026-05-03",
    title: "Sidebar breathing room",
    detail: "Left rail widened slightly with more horizontal padding; nav buttons get extra padding and a larger icon-to-label gap so labels don't hug the edge.",
  },
  {
    date: "2026-05-03",
    title: "P0a — book.json data layer is live",
    detail: "New /api/book route merges Kite snapshot, mutual funds markdown, and INDmoney US holdings into a single canonical Book payload (positions, cash, FX, regime). Foundation for the P0 refactor; existing per-surface routes still work in parallel.",
  },
  {
    date: "2026-05-03",
    title: "Sidebar bottom is now two icons",
    detail: "Theme toggle and changelog collapsed into 28×28 icon buttons next to each other instead of stacked text rows.",
  },
  {
    date: "2026-05-03",
    title: "Page headers breathe properly",
    detail: "Top header inside each page card now uses larger padding and the original heading scale, with looser whitespace around the title and meta line.",
  },
  {
    date: "2026-05-03",
    title: "Asset allocation rebuilt with recharts",
    detail: "Cleaner donut + tight legend. Cash is excluded from the chart (treated as deployable, not allocated). Hover a slice or row to highlight; click to jump to the tab.",
  },
  {
    date: "2026-05-03",
    title: "Overview now reads as a multi-asset cockpit",
    detail: "Allocation separates Indian equity, precious metals, bonds, mutual funds, US equity, and cash.",
  },
  {
    date: "2026-05-03",
    title: "US equity and bonds moved into first-class tabs",
    detail: "The sidebar now gives each asset class its own place instead of burying everything under holdings.",
  },
  {
    date: "2026-05-03",
    title: "Live data path aligned",
    detail: "Dashboard APIs now point at the active Claude memory folder.",
  },
];

// Flat order of tabs as they appear in the sidebar — used by left/right
// arrow key navigation.
const TAB_ORDER: TabId[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

type PerTickerOpen = { ticker: string; market: PerTickerMarket } | null;
const PerTickerCtx = createContext<(t: PerTickerOpen) => void>(() => {});
function useOpenPerTicker() {
  return useContext(PerTickerCtx);
}

export default function Dashboard() {
  const [tab, setTabState] = useState<TabId>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const [briefOpen, setBriefOpen] = useState(false);
  const [openTicker, setOpenTicker] = useState<PerTickerOpen>(null);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const tabRef = useRef<TabId>("overview");
  const setTab = useCallback((t: TabId) => {
    if (t === tabRef.current) return;
    type ViewTransition = {
      finished?: Promise<unknown>;
      ready?: Promise<unknown>;
      updateCallbackDone?: Promise<unknown>;
    };
    type WithVT = Document & {
      startViewTransition?: (cb: () => void | Promise<void>) => ViewTransition;
    };
    const doc =
      typeof document !== "undefined" ? (document as WithVT) : null;
    if (doc?.startViewTransition) {
      // flushSync forces React to commit the new tree synchronously inside
      // the view-transition callback; without it React batches the update
      // and the browser snapshots before the DOM has changed, causing the
      // morph to fall back to a plain crossfade.
      const vt = doc.startViewTransition(() => {
        flushSync(() => setTabState(t));
      });
      // Rapid clicks abort the previous transition; swallow the AbortError
      // rejection so it doesn't surface in the Next.js dev overlay.
      vt?.finished?.catch(() => {});
      vt?.ready?.catch(() => {});
      vt?.updateCallbackDone?.catch(() => {});
    } else {
      setTabState(t);
    }
  }, []);

  // Left/right arrow keys cycle through tabs in sidebar order.
  // Up/down still scroll the page (default browser behaviour).
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      if (document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      const idx = TAB_ORDER.indexOf(tabRef.current);
      if (idx < 0) return;
      const nextIdx =
        e.key === "ArrowRight"
          ? (idx + 1) % TAB_ORDER.length
          : (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      setTab(TAB_ORDER[nextIdx]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  // Actions section trigger rows fire `dashboard:open-task` so the user lands
  // on the Tasks tab; TasksSection listens to the same event to open the modal.
  useEffect(() => {
    const onOpenTask = () => setTab("tasks");
    window.addEventListener("dashboard:open-task", onOpenTask);
    return () => window.removeEventListener("dashboard:open-task", onOpenTask);
  }, [setTab]);

  // Demo-mode badge. `npm run demo` runs with LENS_DEMO=1 and the data dir
  // pointed at ./sample-data; the server reports that through `isDemo` on
  // /api/profile. We surface a small fixed pill so it's obvious the numbers are
  // sample data, not a real portfolio. When LENS_DEMO is unset the route
  // returns isDemo:false and nothing renders — the badge removes itself cleanly.
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setIsDemo(!!d?.isDemo);
      })
      .catch(() => {
        /* route unavailable → treat as not-demo, render nothing */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PerTickerCtx.Provider value={setOpenTicker}>
      <div className="min-h-screen flex">
        <Sidebar tab={tab} setTab={setTab} onRunBrief={() => setBriefOpen(true)} />
        {briefOpen && (
          <BriefModal
            onClose={() => setBriefOpen(false)}
            goToTab={(t) => {
              setBriefOpen(false);
              setTab(t);
            }}
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 max-w-[1080px] w-full mx-auto px-6 md:px-10 pt-12 pb-10 space-y-8">
            <div
              key={`${tab}-${reloadKey}`}
              className="tab-content space-y-8"
              style={{ viewTransitionName: "tab-content" }}
            >
              {tab === "overview" && <OverviewTab goToTab={setTab} />}
              {tab === "allocation" && <AllocationTab onOpenTicker={setOpenTicker} />}
              {tab === "holdings" && <HoldingsTab />}
              {tab === "bonds" && <BondsTab />}
              {tab === "mutualfunds" && <MutualFundsTab />}
              {tab === "usstocks" && <USStocksTab />}
              {tab === "stockresearch" && <StockResearchTab />}
              {tab === "usresearch" && <USResearchTab />}
              {tab === "mfresearch" && <MFResearchTab />}
              {tab === "news" && <NewsTab />}
              {tab === "earnings" && <EarningsTabV2 />}
              {tab === "tasks" && <TasksTab />}
              {tab === "decisions" && <DecisionTrackerTab />}
              {tab === "strategylab" && <StrategyLabTab />}
            </div>
          </main>
        </div>
      </div>
      <PerTickerDrawer
        ticker={openTicker?.ticker ?? null}
        market={openTicker?.market ?? null}
        onClose={() => setOpenTicker(null)}
      />
      <Onboarding />
      {isDemo && (
        <div
          className="fixed bottom-4 left-4 z-50 mono-true text-[10.5px] font-medium px-2.5 py-1 rounded-full pointer-events-none select-none"
          style={{
            background: "var(--warn-tint)",
            color: "var(--warn)",
            border: "1px solid var(--warn)",
          }}
          title="Running on bundled sample data (npm run demo). These are fake holdings — point PORTFOLIO_MEMORY_DIR at your own data dir to see your portfolio."
        >
          DEMO DATA
        </div>
      )}
    </PerTickerCtx.Provider>
  );
}

function Sidebar({
  tab,
  setTab,
  onRunBrief,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  onRunBrief?: () => void;
}) {
  return (
    <aside
      className="w-72 shrink-0 border-r border-subtle px-8 py-8 flex flex-col gap-7 sticky top-0 h-screen"
      style={{ background: "var(--bg-card)" }}
    >
      <div
        className="px-1 pt-2 pb-6"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <LogoMark />
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_GROUPS.map((group, gi) => (
          <div
            key={group.label}
            className={gi > 0 ? "pt-5 mt-4" : ""}
            style={
              gi > 0 ? { borderTop: "1px solid var(--border-subtle)" } : undefined
            }
          >
            <div className="text-[9.5px] text-tertiary mb-3 px-4 font-semibold uppercase tracking-[0.12em] opacity-70">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`tab-btn text-left text-[13.5px] px-4 py-2 rounded-lg flex items-center gap-3.5 ${
                      active ? "tab-active" : "tab-idle"
                    }`}
                  >
                    <SidebarIcon id={t.id} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto pt-3 border-t border-subtle flex items-center gap-1">
        <ThemeToggle />
        <StrategyInfoButton />
        <ChangelogIconButton />
        <RefreshStatusIconButton />
      </div>
    </aside>
  );
}

function StrategyInfoButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-[var(--bg-subtle)] transition-colors accent-ring"
        aria-label="Open strategy"
        title="Strategy: goal, allocation, decision rules"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 17v.01" />
          <path d="M12 14a2 2 0 0 0 2-2 2 2 0 0 0-4 0" />
        </svg>
      </button>
      <StrategyInfoModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LogoMark() {
  return (
    <span
      className="text-[52px] font-black tracking-[-0.03em] text-primary leading-none uppercase"
      style={{
        fontFamily: "var(--font-display-wide), system-ui, sans-serif",
        fontStretch: "125%",
      }}
      aria-label="Lens"
      title="Lens"
    >
      Lens
    </span>
  );
}

type InvestScope = "all" | "in-equity" | "us-equity" | "bonds" | "mf";

const BROKER_URLS: Record<Exclude<InvestScope, "all">, string> = {
  "in-equity": "https://kite.zerodha.com/",
  "us-equity": "https://www.indmoney.com/us-stocks",
  bonds: "https://stablebonds.in/",
  mf: "https://www.indmoney.com/mutual-funds",
};

function InvestButton({
  scope,
  scopeLabel,
}: {
  scope: InvestScope;
  scopeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (scope !== "all") {
    return (
      <Button
        as="a"
        variant="primary"
        href={BROKER_URLS[scope]}
        target="_blank"
        rel="noopener noreferrer"
        leftIcon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        }
      >
        Invest
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        leftIcon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        }
      >
        Invest
      </Button>
      {open && (
        <InvestModal
          initialScope={scope}
          scopeLabel={scopeLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const INVEST_SCOPES: { id: InvestScope; label: string; sub: string; broker: string }[] = [
  { id: "in-equity", label: "Indian equity", sub: "Stocks + ETFs via Kite", broker: "Open Kite" },
  { id: "us-equity", label: "US equity", sub: "INDmoney INDstocks (FX-aware)", broker: "Open INDmoney" },
  { id: "bonds", label: "Bonds", sub: "NCDs / SDIs via your broker", broker: "Open broker" },
  { id: "mf", label: "Mutual funds", sub: "Direct plans, no SIP", broker: "Open INDmoney" },
];

function InvestModal({
  initialScope,
  scopeLabel,
  onClose,
}: {
  initialScope: InvestScope;
  scopeLabel: string;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<InvestScope>(initialScope);
  const [amount, setAmount] = useState<string>("");
  const [thesis, setThesis] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isAllChooser = scope === "all";
  const selected = INVEST_SCOPES.find((s) => s.id === scope);
  const amountNum = Number(amount);
  const canSubmit = !!amount && amountNum > 0 && !submitting;

  // The scope label shown in the modal title and persisted as `asset` in
  // decisions.json. When the user opens directly into a tab (e.g. Indian
  // equity), `scopeLabel` is canonical; from the chooser, we fall back to
  // the INVEST_SCOPES entry.
  const assetLabel = selected?.label ?? scopeLabel;

  async function handleSubmit() {
    if (!canSubmit || scope === "all") return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await fetch("/api/decisions/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: assetLabel,
          amountINR: amountNum,
          rationale: thesis.trim(),
        }),
      });
      // Fire-and-forget; even on a failed POST we still open the broker so
      // the user isn't blocked from acting. The error surfaces inline.
      window.open(BROKER_URLS[scope], "_blank", "noopener,noreferrer");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      window.open(BROKER_URLS[scope], "_blank", "noopener,noreferrer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-md"
      title={isAllChooser ? "Where to deploy" : `Invest in ${scopeLabel}`}
    >
      {isAllChooser ? (
        <ModalSection>
          {INVEST_SCOPES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className="w-full text-left py-4 px-1 flex items-center hover:bg-[var(--bg-subtle)] transition-colors rounded-md"
              style={
                i > 0
                  ? { borderTop: "1px solid var(--border)" }
                  : undefined
              }
            >
              <span className="text-[13.5px] font-medium text-primary">
                {s.label}
              </span>
            </button>
          ))}
        </ModalSection>
      ) : (
        <ModalSection className="space-y-5">
          <div>
            <div className="text-[11px] text-tertiary mb-1.5 font-medium uppercase tracking-wide">
              Amount
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[18px] mono-true text-primary">₹</span>
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="0"
                className="flex-1 bg-transparent border-b border-subtle py-2 text-[18px] mono-true text-primary outline-none focus:border-[var(--brand)] transition-colors"
              />
            </div>
            <div className="flex gap-2 mt-3">
              {[10000, 25000, 50000, 100000].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAmount(String(preset))}
                  className="text-[11px] px-3 py-1 rounded-md border border-subtle hover:bg-[var(--bg-subtle)] text-secondary"
                >
                  ₹
                  {preset >= 100000
                    ? `${preset / 100000}L`
                    : `${preset / 1000}K`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-tertiary mb-1.5 font-medium uppercase tracking-wide">
              Why this deploy
            </div>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder="Quick thesis: which name, what's the trigger, what's the exit?"
              rows={3}
              className="w-full text-[12.5px] text-primary px-3 py-2 rounded-md outline-none resize-none leading-snug focus:border-[var(--brand)] transition-colors"
              style={{
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
              }}
            />
          </div>

          {submitError && (
            <div className="text-[11.5px] text-[var(--neg)]">
              Couldn't log intent: {submitError}. Broker opened anyway.
            </div>
          )}
        </ModalSection>
      )}

      {!isAllChooser && (
        <ModalFooter align="between">
          <Button variant="ghost" onClick={() => setScope("all")}>
            Change asset
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="px-5 py-2 text-[12.5px]"
          >
            {submitting ? "Opening..." : selected?.broker ?? "Open broker"}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}

function ChangelogIconButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-[var(--bg-subtle)] transition-colors accent-ring"
        aria-label="Open changelog"
        title="What's new"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5l3 2" />
        </svg>
      </button>
      {open && <ChangelogModal onClose={() => setOpen(false)} />}
    </>
  );
}

type RefreshSource = {
  source: string;
  mtime: string | null;
  ok: boolean;
  note?: string;
};

const REFRESH_SOURCE_LABELS: Record<string, { label: string; refreshHow: string }> = {
  snapshot: {
    label: "Indian equity (Kite)",
    refreshHow: "Run /portfolio-check after the market closes",
  },
  mutualFunds: {
    label: "Mutual funds",
    refreshHow: "Re-scrape INDmoney via Playwright into project_mutual_funds.md",
  },
  usStocks: {
    label: "US equity (INDmoney)",
    refreshHow: "indian-broker MCP get_us_stocks → us_stocks.json",
  },
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RefreshStatusIconButton() {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<RefreshSource[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/book");
      const j = await r.json();
      setSources(j.sources || []);
    } catch {
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !sources) load();
  }, [open, sources, load]);

  const oldest = useMemo(() => {
    if (!sources?.length) return null;
    const valid = sources.filter((s) => s.mtime).map((s) => s.mtime!);
    if (!valid.length) return null;
    return valid.reduce((a, b) => (new Date(a).getTime() < new Date(b).getTime() ? a : b));
  }, [sources]);

  const stale = oldest
    ? Date.now() - new Date(oldest).getTime() > 24 * 3600 * 1000
    : false;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-[var(--bg-subtle)] transition-colors accent-ring relative"
        aria-label="Open refresh status"
        title="Data freshness"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16M3 12a9 9 0 0 1 15.36-6.36L21 8" />
          <path d="M21 4v4h-4M3 20v-4h4" />
        </svg>
        {stale && (
          <span
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--warn)" }}
            aria-hidden
          />
        )}
      </button>
      {open && (
        <RefreshStatusModal
          sources={sources}
          loading={loading}
          onClose={() => setOpen(false)}
          onRefresh={load}
        />
      )}
    </>
  );
}

type KiteStatus = {
  connected: boolean;
  user_name?: string;
  user_id?: string;
  expires_at?: string;
  expired?: boolean;
};

function useKiteStatus() {
  const [status, setStatus] = useState<KiteStatus | null>(null);
  const load = useCallback(() => {
    fetch("/api/kite/status")
      .then((r) => r.json())
      .then((j) => setStatus(j))
      .catch(() => setStatus({ connected: false }));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);
  return status;
}

type IndmoneyStatus = {
  connected: boolean;
  sessionAgeMinutes?: number;
  connectedAt?: string;
};

// Login is interactive (Playwright headed browser), so this hook also
// exposes a `login` trigger + a `pending` flag the UI uses to switch the
// polling cadence from idle (60s) to active (3s) until connected flips on.
function useIndmoneyStatus() {
  const [status, setStatus] = useState<IndmoneyStatus | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(() => {
    return fetch("/api/indmoney/status")
      .then((r) => r.json())
      .then((j: IndmoneyStatus) => {
        setStatus(j);
        return j;
      })
      .catch(() => {
        const s = { connected: false };
        setStatus(s);
        return s;
      });
  }, []);
  useEffect(() => {
    load();
    const interval = pending ? 3_000 : 60_000;
    const id = setInterval(() => {
      load().then((s) => {
        if (s.connected) setPending(false);
      });
    }, interval);
    return () => clearInterval(id);
  }, [load, pending]);
  const login = useCallback(async () => {
    setPending(true);
    try {
      await fetch("/api/indmoney/login", { method: "POST" });
    } catch {
      // ignore — status polling will eventually reflect reality
    }
  }, []);
  return { status, pending, login };
}

type SyncStage = "kite" | "snapshot" | "tasks" | "drift" | "history";
type SyncStageState = { status: "idle" | "running" | "done" | "error"; detail?: string };
type SyncSummary = {
  totalMs: number;
  totalValue: number;
  kiteHoldings: number;
  qtyDeltas: number;
  newDecisions: number;
  triggersFired: number;
  overdueTasks: number;
  taskCompletions: number;
  driftFlags: number;
};
const SYNC_STAGE_ORDER: SyncStage[] = ["kite", "snapshot", "tasks", "drift", "history"];
const SYNC_STAGE_LABEL: Record<SyncStage, string> = {
  kite: "Kite holdings",
  snapshot: "Snapshot writeback",
  tasks: "Task sweep",
  drift: "Role drift",
  history: "Decisions + history",
};

function syncDetailFor(stage: SyncStage, ev: Record<string, unknown>): string | undefined {
  if (ev.status !== "done") return undefined;
  const ms = typeof ev.ms === "number" ? `${ev.ms}ms` : undefined;
  if (stage === "kite" && typeof ev.count === "number") return `${ev.count}${ms ? ` · ${ms}` : ""}`;
  if (stage === "snapshot" && typeof ev.totalValue === "number")
    return `₹${Math.round(ev.totalValue as number).toLocaleString("en-IN")}`;
  if (stage === "tasks") {
    const tr = (ev.triggers as number) ?? 0;
    const ov = (ev.overdue as number) ?? 0;
    const cp = (ev.completions as number) ?? 0;
    const parts: string[] = [];
    if (tr) parts.push(`${tr} fired`);
    if (cp) parts.push(`${cp} done`);
    if (ov) parts.push(`${ov} overdue`);
    return parts.length ? parts.join(" · ") : "clean";
  }
  if (stage === "drift") {
    const f = (ev.flagged as number) ?? 0;
    return f ? `${f} flag${f === 1 ? "" : "s"}` : "in band";
  }
  if (stage === "history") {
    const d = (ev.decisions as number) ?? 0;
    return d ? `+${d} decision${d === 1 ? "" : "s"}` : "no changes";
  }
  return ms;
}

function RefreshStatusModal({
  sources,
  loading,
  onClose,
  onRefresh,
}: {
  sources: RefreshSource[] | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const kite = useKiteStatus();
  const ind = useIndmoneyStatus();
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStages, setSyncStages] = useState<Record<SyncStage, SyncStageState>>({
    kite: { status: "idle" },
    snapshot: { status: "idle" },
    tasks: { status: "idle" },
    drift: { status: "idle" },
    history: { status: "idle" },
  });

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncSummary(null);
    setSyncError(null);
    setSyncStages({
      kite: { status: "idle" },
      snapshot: { status: "idle" },
      tasks: { status: "idle" },
      drift: { status: "idle" },
      history: { status: "idle" },
    });
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.stage === "summary" && ev.data) {
              setSyncSummary(ev.data);
              continue;
            }
            if (ev.status === "error") {
              setSyncError(`${ev.stage}: ${ev.error ?? "failed"}`);
              continue;
            }
            const stage = ev.stage as SyncStage;
            if (!SYNC_STAGE_ORDER.includes(stage)) continue;
            setSyncStages((s) => ({
              ...s,
              [stage]: {
                status: ev.status === "running" ? "running" : "done",
                detail: syncDetailFor(stage, ev),
              },
            }));
          } catch {
            /* skip malformed line */
          }
        }
      }
      onRefresh();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start justify-between gap-6 px-7 pt-7 pb-5 border-b border-subtle">
          <div>
            <h2
              className="text-[18px] md:text-[20px] leading-[1.05] font-black tracking-[-0.02em] text-primary uppercase"
              style={{
                fontFamily:
                  "var(--font-display-wide), system-ui, sans-serif",
                fontStretch: "120%",
              }}
            >
              Refresh data
            </h2>
            <div className="text-[12px] text-tertiary mt-2 leading-snug">
              Live sources keeping each tab in sync. Indian equity is live from Kite Connect; others reflect last sync to disk.
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none accent-ring rounded-md"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-7 py-2">
          {loading && !sources && (
            <div className="py-6 text-center text-[12px] text-tertiary">
              Loading…
            </div>
          )}
          {sources?.map((s, i) => {
            const meta = REFRESH_SOURCE_LABELS[s.source] ?? {
              label: s.source,
              refreshHow: "",
            };
            const isKiteRow = s.source === "snapshot";
            const isIndRow = s.source === "usStocks";
            const stale =
              s.mtime &&
              Date.now() - new Date(s.mtime).getTime() > 24 * 3600 * 1000;

            // Indian equity row is special: it merges in Kite Connect session
            // state (live LTPs source). When session expired → Re-login button.
            const kiteExpired =
              isKiteRow && kite !== null && (!kite.connected || kite.expired);
            const kiteOk = isKiteRow && kite?.connected && !kite.expired;
            const expiryFmt =
              isKiteRow && kite?.expires_at
                ? new Date(kite.expires_at).toLocaleString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                  })
                : null;

            // US equity row mirrors Kite: surfaces INDmoney connection state
            // and a login button that kicks off the headed-browser flow.
            const indConnected = isIndRow && ind.status?.connected;
            const indDisconnected =
              isIndRow && ind.status !== null && !ind.status.connected;

            const dotColor = isKiteRow
              ? !kite
                ? "var(--text-tertiary)"
                : kiteOk
                ? "var(--pos)"
                : "var(--warn)"
              : isIndRow
              ? !ind.status
                ? "var(--text-tertiary)"
                : indConnected
                ? "var(--pos)"
                : ind.pending
                ? "var(--warn)"
                : "var(--warn)"
              : !s.ok
              ? "var(--neg)"
              : stale
              ? "var(--warn)"
              : "var(--pos)";

            return (
              <div
                key={s.source}
                className="py-4"
                style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: dotColor }}
                    />
                    <span className="text-[13px] font-medium text-primary truncate">
                      {meta.label}
                    </span>
                    {isKiteRow && kiteOk && kite.user_name && (
                      <span className="mono-true text-[11px] text-tertiary truncate">
                        · {kite.user_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isKiteRow && kiteExpired ? (
                      <button
                        onClick={() => window.open("/api/kite/login", "_self")}
                        className="text-[11.5px] font-medium px-2.5 py-1 rounded-md transition-opacity hover:opacity-90 accent-ring whitespace-nowrap"
                        style={{
                          background: "var(--text-primary)",
                          color: "var(--bg-card)",
                        }}
                      >
                        Re-login
                      </button>
                    ) : isIndRow && indDisconnected ? (
                      <button
                        onClick={() => ind.login()}
                        disabled={ind.pending}
                        className="text-[11.5px] font-medium px-2.5 py-1 rounded-md transition-opacity hover:opacity-90 accent-ring whitespace-nowrap disabled:opacity-60"
                        style={{
                          background: "var(--text-primary)",
                          color: "var(--bg-card)",
                        }}
                      >
                        {ind.pending ? "Waiting…" : "INDmoney login"}
                      </button>
                    ) : (
                      <span className="mono-true text-[11.5px] text-tertiary">
                        {formatRelative(s.mtime)}
                      </span>
                    )}
                  </div>
                </div>
                {isKiteRow ? (
                  <div className="text-[11.5px] text-tertiary mt-1.5 leading-snug pl-4">
                    {kite === null
                      ? "Checking session…"
                      : kiteOk
                      ? expiryFmt
                        ? `Live LTPs + day-change from Kite. Session valid until ${expiryFmt}.`
                        : "Live LTPs + day-change from Kite."
                      : "Not connected — Indian equity tab is using the static snapshot until you re-login."}
                  </div>
                ) : isIndRow ? (
                  <div className="text-[11.5px] text-tertiary mt-1.5 leading-snug pl-4">
                    {ind.status === null
                      ? "Checking session…"
                      : indConnected
                      ? `Connected to INDmoney${
                          ind.status.sessionAgeMinutes !== undefined
                            ? ` · session ${ind.status.sessionAgeMinutes}m old`
                            : ""
                        }.`
                      : ind.pending
                      ? "Browser opened — finish OTP login in the Chrome window. Status will update once captured."
                      : "Not connected — click INDmoney login to open a browser and authenticate."}
                  </div>
                ) : (
                  meta.refreshHow && (
                    <div className="text-[11.5px] text-tertiary mt-1.5 leading-snug pl-4">
                      {meta.refreshHow}
                    </div>
                  )
                )}
                {!isKiteRow && !isIndRow && !s.ok && s.note && (
                  <div className="text-[11px] text-neg mt-1 leading-snug pl-4">
                    {s.note}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {(syncing || syncSummary || syncError) && (
          <div className="px-7 py-4 border-t border-subtle">
            <ul className="space-y-1.5 text-[12px]">
              {SYNC_STAGE_ORDER.map((stage) => {
                const st = syncStages[stage];
                const icon =
                  st.status === "done" ? "✓" : st.status === "running" ? "·" : st.status === "error" ? "✗" : "○";
                return (
                  <li key={stage} className="flex items-center gap-2">
                    <span
                      className={`shrink-0 w-3 inline-block ${
                        st.status === "done" ? "text-pos" : "text-tertiary"
                      }`}
                    >
                      {icon}
                    </span>
                    <span className={st.status === "done" ? "text-primary" : "text-tertiary"}>
                      {SYNC_STAGE_LABEL[stage]}
                    </span>
                    {st.detail && (
                      <span className="mono-true text-[11px] text-tertiary ml-auto truncate">
                        {st.detail}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {syncError && (
              <div className="mt-3 text-[12px] text-neg">{syncError}</div>
            )}
            {syncSummary && !syncError && (
              <div className="mt-3 text-[12px] text-secondary leading-relaxed">
                <div className="text-primary font-medium">
                  ₹{syncSummary.totalValue.toLocaleString("en-IN")} · {syncSummary.kiteHoldings} holdings
                </div>
                <div className="text-tertiary text-[11px] mt-0.5">
                  {syncSummary.qtyDeltas} qty delta{syncSummary.qtyDeltas === 1 ? "" : "s"}
                  {syncSummary.newDecisions ? ` · +${syncSummary.newDecisions} decision${syncSummary.newDecisions === 1 ? "" : "s"}` : ""}
                  {syncSummary.triggersFired ? ` · ${syncSummary.triggersFired} trigger${syncSummary.triggersFired === 1 ? "" : "s"} fired` : " · no triggers"}
                  {syncSummary.taskCompletions ? ` · ${syncSummary.taskCompletions} auto-done` : ""}
                  {syncSummary.overdueTasks ? ` · ${syncSummary.overdueTasks} overdue` : ""}
                  {syncSummary.driftFlags ? ` · ${syncSummary.driftFlags} drift flag${syncSummary.driftFlags === 1 ? "" : "s"}` : ""}
                  <span className="ml-2">· {(syncSummary.totalMs / 1000).toFixed(2)}s</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="px-7 pb-6 pt-2 flex justify-between items-center gap-3">
          <div className="text-[11px] text-tertiary leading-snug">
            Pulls Kite holdings, runs deterministic passes, writes snapshot + decisions + history.
          </div>
          <button
            onClick={runSync}
            disabled={loading || syncing}
            className="text-[12px] px-3.5 py-1.5 rounded-md border border-subtle hover:bg-[var(--bg-subtle)] text-secondary disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={syncing ? "spin-sync" : undefined}>
              <path d="M21 12a9 9 0 1 1-3.5-7.1" />
              <path d="M21 4v6h-6" />
            </svg>
            <span>{syncing ? "Refreshing…" : "Refresh data"}</span>
            <style jsx>{`
              .spin-sync {
                animation: spin-sync 1s linear infinite;
              }
              @keyframes spin-sync {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg max-w-lg w-full max-h-[86vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start justify-between gap-6 px-7 pt-7 pb-5 border-b border-subtle">
          <div>
            <h2
              className="text-[18px] md:text-[20px] leading-[1.05] font-black tracking-[-0.02em] text-primary uppercase"
              style={{
                fontFamily:
                  "var(--font-display-wide), system-ui, sans-serif",
                fontStretch: "120%",
              }}
            >
              Changelog
            </h2>
            <div className="text-[12px] text-tertiary mt-2">
              Dashboard updates, kept inside the cockpit.
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none accent-ring rounded-md"
            aria-label="Close changelog"
          >
            ×
          </button>
        </div>
        <div className="px-7 py-2">
          {CHANGELOG_ITEMS.map((item, i) => (
            <div
              key={`${item.date}-${item.title}`}
              className="py-5"
              style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}
            >
              <div className="mono-true text-[10.5px] text-tertiary">
                {item.date}
              </div>
              <div className="text-[14px] text-primary font-medium leading-snug mt-1.5">
                {item.title}
              </div>
              <div className="text-[12.5px] text-secondary leading-relaxed mt-1.5">
                {item.detail}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function SidebarIcon({ id }: { id: TabId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "opacity-80 shrink-0",
  };
  switch (id) {
    case "overview":
      // dashboard grid
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "allocation":
      // pie / role buckets
      return (
        <svg {...common}>
          <path d="M12 3v9l8 4" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "holdings":
      // bar chart
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "mutualfunds":
      // stacked layers / basket
      return (
        <svg {...common}>
          <path d="M3 7l9-4 9 4-9 4-9-4Z" />
          <path d="M3 12l9 4 9-4" />
          <path d="M3 17l9 4 9-4" />
        </svg>
      );
    case "bonds":
      // bond / certificate
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="1.5" />
          <path d="M3 10h18" />
          <path d="M7 14h4M14 14h3" />
        </svg>
      );
    case "usstocks":
      // globe with $ marker (US/global stocks)
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "stockresearch":
      // lightbulb (ideas+analysis combined)
      return (
        <svg {...common}>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.5.5 1 1 1 2V17h6v-1.5c0-1 .5-1.5 1-2A6 6 0 0 0 12 3Z" />
        </svg>
      );
    case "usresearch":
      // magnifier on globe
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6" />
          <path d="M15 15l5 5" />
          <path d="M4 10h12M10 4a8 8 0 0 1 0 12M10 4a8 8 0 0 0 0 12" opacity="0.5" />
        </svg>
      );
    case "mfresearch":
      // magnifier on stack (MF research)
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M16 16l4 4" />
          <path d="M5 17v2M5 13v2" opacity="0.5" />
        </svg>
      );
    case "news":
      // newspaper
      return (
        <svg {...common}>
          <path d="M4 5h13v14H4z" />
          <path d="M17 9h3v8a2 2 0 0 1-2 2h-1" />
          <path d="M7 9h6M7 12h6M7 15h4" />
        </svg>
      );
    case "earnings":
      // bar-chart / report
      return (
        <svg {...common}>
          <path d="M5 21V10M12 21V4M19 21v-7" />
          <path d="M3 21h18" />
        </svg>
      );
    case "tasks":
      // checkbox-list
      return (
        <svg {...common}>
          <path d="M4 6.5l2 2 4-4" />
          <path d="M4 13.5l2 2 4-4" />
          <path d="M14 7h7M14 14h7M14 20h5" />
        </svg>
      );
    case "decisions":
      // scale / balance
      return (
        <svg {...common}>
          <path d="M12 3v18M5 7h14" />
          <path d="M5 7l-3 7a4 4 0 0 0 6 0L5 7Z" />
          <path d="M19 7l-3 7a4 4 0 0 0 6 0l-3-7Z" />
        </svg>
      );
    case "strategylab":
      // flask / experiment
      return (
        <svg {...common}>
          <path d="M9.5 3h5" />
          <path d="M10 3v6L4.7 18.1A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.9-2.9L14 9V3" />
          <path d="M7.2 15h9.6" />
        </svg>
      );
    default:
      return <span className="w-3.5 h-3.5">•</span>;
  }
}

// ---------- Overview ----------

type AssetAllocationItem = {
  key: string;
  label: string;
  color: string;
  value: number;
  pct: number;
  pnlPct?: number;
  countLabel: string;
  extraLabel?: string;
  onClick?: () => void;
};

// Module-level cache — persists across OverviewTab unmount/remount cycles
// (i.e. tab navigations) so the skeleton only shows on the very first load
// of the session, not every time the user returns to Overview.
const overviewCache: {
  snapshot: Snapshot | null;
  mtime: string | null;
  mfSummary: MFSummary | null;
  usStocks: USStocksData | null;
  bondsFetchedAt: string | null;
  loaded: boolean;
} = {
  snapshot: null,
  mtime: null,
  mfSummary: null,
  usStocks: null,
  bondsFetchedAt: null,
  loaded: false,
};

function OverviewTab({ goToTab }: { goToTab: (id: TabId) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(overviewCache.snapshot);
  const [mtime, setMtime] = useState<string | null>(overviewCache.mtime);
  const [mfSummary, setMfSummary] = useState<MFSummary | null>(overviewCache.mfSummary);
  const [usStocks, setUsStocks] = useState<USStocksData | null>(overviewCache.usStocks);
  const [bondsFetchedAt, setBondsFetchedAt] = useState<string | null>(overviewCache.bondsFetchedAt);
  // If we've already loaded this session, skip the skeleton entirely —
  // data is cached, render is instant, no shimmer flash on tab nav.
  const [dataReady, setDataReady] = useState(overviewCache.loaded);

  useEffect(() => {
    const loadSnapshot = () =>
      fetch("/api/snapshot")
        .then((r) => r.json())
        .then((r) => {
          if (r.data) {
            overviewCache.snapshot = r.data;
            overviewCache.mtime = r.mtime;
            setSnapshot(r.data);
            setMtime(r.mtime);
          }
        })
        .catch(() => {});
    const loadMf = () =>
      fetch("/api/mutualfunds")
        .then((r) => r.json())
        .then((r) => {
          if (r.summary) {
            overviewCache.mfSummary = r.summary;
            setMfSummary(r.summary);
          }
        })
        .catch(() => {});
    const loadUs = () =>
      fetch("/api/usstocks")
        .then((r) => r.json())
        .then((r) => {
          if (r.data) {
            overviewCache.usStocks = r.data;
            setUsStocks(r.data);
          }
        })
        .catch(() => {});
    // Auxiliary bonds timestamp for the asset-allocation stale pill. Informational —
    // never gates the paint. News + earnings are owned by their own tabs now.
    const loadBonds = () =>
      fetch("/api/bonds")
        .then((r) => r.json())
        .then((r) => {
          const ts = r?.data?.fetchedAt ?? r?.mtime ?? null;
          if (ts) {
            overviewCache.bondsFetchedAt = ts;
            setBondsFetchedAt(ts);
          }
        })
        .catch(() => {});

    loadBonds();

    // Already loaded once this session — refresh in the background, keep the
    // skeleton hidden.
    if (overviewCache.loaded) {
      loadSnapshot();
      loadMf();
      loadUs();
      return;
    }

    // First mount — the 3 hero sources gate the skeleton; flip dataReady once
    // they settle (allSettled: a slow/failed source still releases the paint).
    Promise.allSettled([loadSnapshot(), loadMf(), loadUs()]).then(() => {
      overviewCache.loaded = true;
      setDataReady(true);
    });
  }, []);

  const stats = useMemo(() => {
    if (!snapshot) return null;
    const holdings = snapshot.holdings;
    // Bonds are tagged role="debt-equiv" in the snapshot (NCD tickers like
    // 1025MBFL27 are unknown to TICKER_META, so getMeta alone misses them
    // and the bonds slice silently folded into Indian equity).
    const bondHoldings = holdings.filter(
      (h) => h.role === "debt-equiv" || getMeta(h.ticker).asset === "bond"
    );
    const preciousHoldings = holdings.filter(
      (h) => getMeta(h.ticker).sector === "Precious Metals"
    );
    const inEquityHoldings = holdings.filter((h) => {
      const meta = getMeta(h.ticker);
      return (
        (h.market || "IN") === "IN" &&
        h.role !== "debt-equiv" &&
        meta.asset !== "bond" &&
        meta.sector !== "Precious Metals"
      );
    });
    const valueOf = (items: Holding[]) =>
      items.reduce((sum, h) => sum + h.value, 0);
    const pnlOf = (items: Holding[]) =>
      items.reduce((sum, h) => {
        if (h.pnlPct === undefined || h.avgPrice === undefined) return sum;
        return sum + (h.pnlPct / 100) * h.avgPrice * h.qty;
      }, 0);
    const costOf = (items: Holding[]) =>
      items.reduce((sum, h) => {
        if (h.avgPrice === undefined || h.avgPrice === 0) return sum;
        return sum + h.avgPrice * h.qty;
      }, 0);

    const directHoldingsValue = valueOf(holdings) || snapshot.totalValue;
    const inEquityValue = valueOf(inEquityHoldings);
    // Live per-holding sum only. No snapshot.bondsValue fallback: in a
    // tag-less snapshot the untagged bond rows are already inside the equity
    // sum, so adding the aggregate would double-count (slices > 100% of net
    // worth). Bonds stay excluded from the stale-nudge rotation (see the
    // /api/bonds comment above) — this slice is display-only.
    const bondValue = valueOf(bondHoldings);
    const preciousValue = valueOf(preciousHoldings);
    const stockPnL = pnlOf(inEquityHoldings);
    const preciousPnL = pnlOf(preciousHoldings);
    const bondPnL = pnlOf(bondHoldings);
    // Prefer Kite's aggregate (sums per-holding `pnl` across equity + bonds +
    // metals) when present so this matches the IN tab card and Kite app
    // exactly. The client-side sum above zeroes-out bonds because their
    // avgPrice is undefined in the snapshot.
    const directPnL =
      snapshot.liveInEquityPnL !== undefined
        ? snapshot.liveInEquityPnL
        : stockPnL + preciousPnL + bondPnL;
    const stockCostBasis = costOf(inEquityHoldings);
    const preciousCostBasis = costOf(preciousHoldings);
    const bondCostBasis = costOf(bondHoldings);
    const directCostBasis = stockCostBasis + preciousCostBasis + bondCostBasis;
    const stockTrackedPnLPct =
      stockCostBasis > 0 ? (stockPnL / stockCostBasis) * 100 : undefined;
    const preciousTrackedPnLPct =
      preciousCostBasis > 0 ? (preciousPnL / preciousCostBasis) * 100 : undefined;
    const bondTrackedPnLPct =
      bondCostBasis > 0 ? (bondPnL / bondCostBasis) * 100 : undefined;
    const directTodayMove = holdings.reduce((sum, h) => {
      if (h.dayChangePct === undefined) return sum;
      return sum + (h.dayChangePct / 100) * h.value;
    }, 0);
    const directTodayBase = directHoldingsValue - directTodayMove;
    const bestToday = [...holdings]
      .filter((h) => h.dayChangePct !== undefined)
      .sort((a, b) => (b.dayChangePct || 0) - (a.dayChangePct || 0))[0];
    const worstToday = [...holdings]
      .filter((h) => h.dayChangePct !== undefined)
      .sort((a, b) => (a.dayChangePct || 0) - (b.dayChangePct || 0))[0];

    const risk = computeRisk(
      holdings as AnHolding[],
      snapshot.totalValue,
      snapshot.peakValue
    );

    // Combined book: IN stocks + MFs + US stocks + cash
    const cash = snapshot.cash ?? 0;
    const mfValue =
      mfSummary?.totalValue ??
      (mfSummary?.entries.reduce((s, m) => s + (m.value || 0), 0) ?? 0);
    // Only count P&L for MF entries with a known cost basis (legacy holdings
    // without `invested` would inflate gain if we used full value vs partial cost).
    const mfTracked = (mfSummary?.entries ?? []).filter(
      (m) => (m.invested ?? 0) > 0
    );
    const mfTrackedValue = mfTracked.reduce((s, m) => s + (m.value || 0), 0);
    const mfInvested = mfTracked.reduce((s, m) => s + (m.invested || 0), 0);
    const mfPnL = mfTrackedValue - mfInvested;
    const mfHasCost = mfInvested > 0 && mfTracked.length > 0;
    const mfTodayMove =
      mfSummary?.entries.reduce(
        (s, m) => s + ((m.dayChangePct ?? 0) / 100) * (m.value || 0),
        0
      ) ?? 0;

    const usValue = usStocks?.totals.currentINR ?? 0;
    const usInvested = usStocks?.totals.investedINR ?? 0;
    const usPnL = usStocks?.totals.pnlINR ?? 0;
    const usHasCost = usInvested > 0;

    const netWorth = directHoldingsValue + cash + mfValue + usValue;
    const netWorthExCash = netWorth - cash;
    const totalPnL = directPnL + (mfHasCost ? mfPnL : 0) + (usHasCost ? usPnL : 0);
    const bookedGainsTotal = (snapshot.bookedGains ?? []).reduce(
      (s, g) => s + (g.amount || 0),
      0
    );
    const lifetimeWealth = totalPnL + bookedGainsTotal;
    const totalCostBasis =
      (snapshot.liveInEquityCost ?? directCostBasis) +
      (mfHasCost ? mfInvested : 0) +
      (usHasCost ? usInvested : 0);
    const todayMove = directTodayMove + mfTodayMove;
    const todayBase = directTodayBase + mfValue - mfTodayMove;

    const stockPct = netWorth > 0 ? (inEquityValue / netWorth) * 100 : 0;
    const mfPct = netWorth > 0 ? (mfValue / netWorth) * 100 : 0;
    const usPct = netWorth > 0 ? (usValue / netWorth) * 100 : 0;
    const cashPct = netWorth > 0 ? (cash / netWorth) * 100 : 0;
    const bondPct = netWorth > 0 ? (bondValue / netWorth) * 100 : 0;
    const preciousPct = netWorth > 0 ? (preciousValue / netWorth) * 100 : 0;
    const equityExCashPct =
      netWorthExCash > 0 ? ((inEquityValue + usValue) / netWorthExCash) * 100 : 0;

    const assetItems: AssetAllocationItem[] = [
      {
        key: "in-equity",
        label: "Indian equity",
        color: "var(--brand)",
        value: inEquityValue,
        pct: stockPct,
        pnlPct: stockTrackedPnLPct,
        countLabel: `${inEquityHoldings.length} ${inEquityHoldings.length === 1 ? "position" : "positions"}`,
        onClick: () => goToTab("holdings"),
      },
      {
        key: "metals",
        label: "Precious metals",
        color: "#f59e0b",
        value: preciousValue,
        pct: preciousPct,
        pnlPct: preciousTrackedPnLPct,
        countLabel: `${preciousHoldings.length} ${preciousHoldings.length === 1 ? "position" : "positions"}`,
        extraLabel: "Gold + silver",
        onClick: () => goToTab("holdings"),
      },
      {
        key: "bonds",
        label: "Bonds",
        color: "#14b8a6",
        value: bondValue,
        pct: bondPct,
        pnlPct: bondTrackedPnLPct,
        countLabel: `${bondHoldings.length} ${bondHoldings.length === 1 ? "bond" : "bonds"}`,
        extraLabel: "NCD / SDI",
        onClick: () => goToTab("bonds"),
      },
      {
        key: "mf",
        label: "Mutual funds",
        color: "#0ea5e9",
        value: mfValue,
        pct: mfPct,
        pnlPct: mfHasCost && mfInvested > 0 ? (mfPnL / mfInvested) * 100 : undefined,
        countLabel: `${mfSummary?.entries.length ?? 0} ${(mfSummary?.entries.length ?? 0) === 1 ? "scheme" : "schemes"}`,
        extraLabel: (mfSummary?.monthlySIP ?? 0) > 0 ? `SIP ₹${fmtINR(mfSummary?.monthlySIP)}/mo` : undefined,
        onClick: () => goToTab("mutualfunds"),
      },
      {
        key: "us-equity",
        label: "US equity",
        color: "#6366f1",
        value: usValue,
        pct: usPct,
        pnlPct: usHasCost && usInvested > 0 ? (usPnL / usInvested) * 100 : undefined,
        countLabel: `${usStocks?.totals.positionCount ?? 0} ${(usStocks?.totals.positionCount ?? 0) === 1 ? "position" : "positions"}`,
        extraLabel: "FX converted",
        onClick: () => goToTab("usstocks"),
      },
      {
        key: "cash",
        label: "Cash",
        color: "#64748b",
        value: cash,
        pct: cashPct,
        countLabel: "broker cash",
        extraLabel: "deployable",
      },
    ].filter((item) => item.value > 0 || item.key === "cash");

    return {
      stockPnL,
      stockCostBasis,
      stockValue: inEquityValue,
      directHoldingsValue,
      inEquityValue,
      inEquityCount: inEquityHoldings.length,
      bondValue,
      bondCount: bondHoldings.length,
      preciousValue,
      preciousCount: preciousHoldings.length,
      mfValue,
      mfInvested,
      mfPnL,
      mfHasCost,
      mfCount: mfSummary?.entries.length ?? 0,
      monthlySIP: mfSummary?.monthlySIP ?? 0,
      usValue,
      usInvested,
      usPnL,
      usHasCost,
      usCount: usStocks?.totals.positionCount ?? 0,
      cash,
      netWorth,
      netWorthExCash,
      totalPnL,
      totalCostBasis,
      todayMove,
      todayBase,
      bestToday,
      worstToday,
      risk,
      stockPct,
      mfPct,
      usPct,
      cashPct,
      bondPct,
      preciousPct,
      equityExCashPct,
      assetItems,
      bookedGainsTotal,
      lifetimeWealth,
    };
  }, [snapshot, mfSummary, usStocks, goToTab]);

  const isEmpty = dataReady && !snapshot;

  if (isEmpty) {
    return (
      <FirstRunEmptyState
        title="LENS is empty."
        message="No portfolio data on disk yet."
      />
    );
  }

  // Skeleton stays mounted while content slides in over it. Content sits at
  // z-20 so the slide-in animation is fully visible from frame 1, while the
  // skeleton fades from full white → transparent behind it (z-10). No BG
  // jump because the wash transitions smoothly instead of cutting.
  return (
    <>
      <Skeleton fadingOut={dataReady} />
      {dataReady && snapshot && (
        <div
          className="space-y-5 relative z-20"
          style={{
            // Match the speed of `::view-transition-new(tab-content)` in
            // globals.css so home reveal feels identical to tab swaps.
            animation: "vt-slide-left-in 320ms cubic-bezier(0.4, 0, 0.2, 1) 80ms both",
          }}
        >
      {/* Compact hero row: net worth | today | net P&L | regime — no page heading on Overview */}
      <section className="surface rounded-lg overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 -m-px">
        <CompactStat
          label="Net worth"
          info="Combined live value of Indian equity, precious metals, bonds, mutual funds, US equity, and broker cash. Kite positions are intraday; MF NAVs are end-of-day; US holdings are INDmoney values converted to INR."
          value={`₹${fmtINR(stats?.netWorth ?? snapshot.totalValue)}`}
        />
        <CompactStat
          label="Booked gains"
          info="Crystallized profit/loss from completed exits and fund switches recorded in latest_snapshot.bookedGains. Survives sells, switches, and trims — independent of mark-to-market noise."
          value={
            stats?.bookedGainsTotal !== undefined
              ? `${stats.bookedGainsTotal >= 0 ? "+" : ""}₹${fmtINR(
                  Math.round(stats.bookedGainsTotal)
                )}`
              : "—"
          }
          sub={
            (snapshot.bookedGains?.length ?? 0) > 0
              ? `${snapshot.bookedGains!.length} ${snapshot.bookedGains!.length === 1 ? "event" : "events"}`
              : "no exits yet"
          }
          accent={
            stats?.bookedGainsTotal !== undefined
              ? stats.bookedGainsTotal >= 0
                ? "pos"
                : "neg"
              : undefined
          }
        />
        <CompactStat
          label="Net P&L"
          info="Total absolute gain/loss across tracked positions: Kite holdings with average cost, MFs with invested amount, and US holdings from INDmoney. Assets without cost basis are excluded from P&L but still counted in net worth."
          value={
            stats
              ? `${stats.totalPnL >= 0 ? "+" : ""}₹${fmtINR(
                  Math.round(stats.totalPnL)
                )}`
              : "—"
          }
          sub={
            stats && stats.totalCostBasis > 0
              ? `${fmtPct(
                  (stats.totalPnL / stats.totalCostBasis) * 100,
                  2
                )} since cost`
              : undefined
          }
          accent={
            stats
              ? stats.totalPnL >= 0
                ? "pos"
                : "neg"
              : undefined
          }
        />
        <CompactStat
          label="XIRR"
          info="Lifetime money-weighted return on the mutual fund book (the only asset class that ships a true XIRR — pulled from INDmoney across all 12 schemes). Use this as the book's compounding rate; treat the absolute P&L on equities as a separate signal."
          value={mfSummary?.xirr !== undefined ? fmtPct(mfSummary.xirr, 2) : "—"}
          sub={
            mfSummary?.xirr !== undefined
              ? "MF book · Nifty 500 ≈ 10.7%"
              : undefined
          }
          accent={
            mfSummary?.xirr !== undefined
              ? mfSummary.xirr >= 11
                ? "pos"
                : mfSummary.xirr < 8
                ? "neg"
                : undefined
              : undefined
          }
        />
        </div>
      </section>

      {/* Asset split — multi-asset book */}
      {stats && stats.netWorth > 0 && (
        <AssetSplitStrip
          total={stats.netWorth}
          items={stats.assetItems}
          stale={(() => {
            const candidates: Array<{ source: string; iso: string | null | undefined }> = [
              { source: "snapshot", iso: snapshot.asOf },
              { source: "US", iso: usStocks?.fetchedAt },
              { source: "MF", iso: mfSummary?.asOf ?? mtime },
            ];
            let oldest: { source: string; ageHours: number } | null = null;
            for (const c of candidates) {
              const h = ageHoursFromISO(c.iso);
              if (h !== null && (oldest === null || h > oldest.ageHours)) {
                oldest = { source: c.source, ageHours: h };
              }
            }
            return oldest && oldest.ageHours > 24 ? oldest : null;
          })()}
        />
      )}

      {/* Portfolio score — book discipline vs doctrine; self-fetches /api/score */}
      <PortfolioScoreCard />

      {/* Footer: lifetime wealth created (unrealized + booked from sells/switches) */}
      {stats && (snapshot.bookedGains?.length ?? 0) > 0 && (
        <LifetimeWealthFooter
          unrealized={stats.totalPnL}
          booked={stats.bookedGainsTotal}
          lifetime={stats.lifetimeWealth}
          gains={snapshot.bookedGains ?? []}
        />
      )}

        </div>
      )}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0)",
        transition: "transform 200ms",
      }}
    >
      <path
        d="M 2 4 L 5 7 L 8 4"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Delta({ amount, className = "" }: { amount: number; className?: string }) {
  const tone = amount > 0 ? "text-pos" : amount < 0 ? "text-neg" : "text-tertiary";
  const sign = amount >= 0 ? "+" : "−";
  return (
    <span className={`mono-true ${tone} ${className}`.trim()}>
      {sign}₹{fmtINR(Math.abs(Math.round(amount)))}
    </span>
  );
}

function LifetimeWealthFooter({
  unrealized,
  booked,
  lifetime,
  gains,
}: {
  unrealized: number;
  booked: number;
  lifetime: number;
  gains: BookedGain[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="surface rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-[var(--bg-subtle)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-tertiary uppercase tracking-wide">
            Lifetime wealth created
          </span>
          <InfoTip text="Unrealized P&L (current value minus current cost basis) PLUS booked gains from sells, trims, and plan switches. The unrealized number drops when a position is sold or switched, but the booked amount captures it so the total picture is preserved." />
        </div>
        <div className="flex items-center gap-4">
          <Delta amount={lifetime} className="text-[16px] font-semibold" />
          <Chevron open={open} />
        </div>
      </button>
      {open && (
        <div className="px-6 pb-5 pt-1 space-y-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="grid grid-cols-2 gap-4 pt-3">
            <div>
              <div className="text-[11px] text-tertiary uppercase tracking-wide">Unrealized P&L</div>
              <Delta amount={unrealized} className="text-[14px] font-semibold block" />
              <div className="text-[10.5px] text-tertiary mt-0.5">From current value vs current cost basis</div>
            </div>
            <div>
              <div className="text-[11px] text-tertiary uppercase tracking-wide">Booked gains</div>
              <Delta amount={booked} className="text-[14px] font-semibold block" />
              <div className="text-[10.5px] text-tertiary mt-0.5">From {gains.length} closed action{gains.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <ul className="space-y-1.5 pt-2">
            {gains
              .slice()
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((g, i) => (
                <li key={`${g.date}-${g.ticker}-${i}`} className="flex items-start gap-3 text-[12px]">
                  <span className="text-tertiary mono-true shrink-0 w-[78px]">{g.date}</span>
                  <span className="text-secondary mono-true font-medium shrink-0 w-[24px]">{g.action}</span>
                  <span className="text-primary font-medium shrink-0 w-[100px] truncate">{g.ticker}</span>
                  <Delta amount={g.amount} className="font-medium shrink-0 w-[80px] text-right" />
                  {g.note && (
                    <span className="text-tertiary text-[11px] flex-1 leading-snug">
                      {g.note}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type BookPerfRow = {
  key: string;
  label: string;
  color: string;
  value: number;
  pnlPct?: number;
  pnlINR?: number;
  xirr?: number;
  tabId?: TabId;
  note?: string;
};

function BookPerformanceCard({
  rows,
  onOpen,
}: {
  rows: BookPerfRow[];
  onOpen?: (id: TabId) => void;
}) {
  return (
    <section className="surface rounded-lg overflow-hidden">
      <header className="px-6 py-5 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-[15px] md:text-[16px] font-semibold tracking-[-0.005em] text-primary inline-flex items-center">
          Book performance
          <InfoTip text="Per-asset return based on the cost basis available for that class. Mutual funds also surface INDmoney's lifetime XIRR. Metals and bonds don't carry cost data so only the value is shown." />
        </h2>
      </header>
      <ul style={{ borderTop: "1px solid var(--border)" }}>
        {rows.map((r, i) => {
          const pnlCls =
            r.pnlPct === undefined
              ? "text-tertiary"
              : r.pnlPct >= 0
              ? "text-pos"
              : "text-neg";
          const onClick = r.tabId && onOpen ? () => onOpen(r.tabId!) : undefined;
          const className = `relative flex items-center gap-4 px-6 py-4 transition-colors ${
            onClick ? "cursor-pointer hover:bg-[var(--bg-subtle)]" : ""
          }`;
          const style: React.CSSProperties =
            i > 0 ? { borderTop: "1px solid var(--border)" } : {};
          const content = (
            <>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: r.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-primary truncate">
                  {r.label}
                </div>
                {r.note && (
                  <div className="text-[10.5px] text-tertiary truncate mt-0.5">
                    {r.note}
                  </div>
                )}
              </div>
              <div className="text-right mono-true shrink-0">
                <div className="text-[13px] font-semibold text-primary">
                  ₹{fmtINR(Math.round(r.value))}
                </div>
                {r.xirr !== undefined && (
                  <div className="text-[10.5px] text-tertiary mt-0.5">
                    XIRR {fmtPct(r.xirr, 2)}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0 w-[120px]">
                {r.pnlPct !== undefined ? (
                  <>
                    <div className={`mono-true text-[13px] font-semibold ${pnlCls}`}>
                      {fmtPct(r.pnlPct, 1)}
                    </div>
                    {r.pnlINR !== undefined && (
                      <div className={`mono-true text-[10.5px] mt-0.5 ${pnlCls}`}>
                        {r.pnlINR >= 0 ? "+" : "−"}₹{fmtINR(Math.abs(Math.round(r.pnlINR)))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mono-true text-[12px] text-tertiary">—</div>
                )}
              </div>
            </>
          );
          if (onClick) {
            return (
              <li
                key={r.key}
                onClick={onClick}
                className={className}
                style={style}
              >
                {content}
              </li>
            );
          }
          return (
            <li key={r.key} className={className} style={style}>
              {content}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TopMoversCard({
  holdings,
  mfEntries,
}: {
  holdings: Holding[];
  mfEntries: MFEntry[];
}) {
  type Mover = {
    ticker: string;
    label: string;
    pct: number;
    valueINR: number;
    asset: "equity" | "mf";
  };
  const items: Mover[] = [];
  for (const h of holdings) {
    if (h.dayChangePct === undefined) continue;
    items.push({
      ticker: h.ticker,
      label: getMeta(h.ticker).sector || getMeta(h.ticker).name || h.ticker,
      pct: h.dayChangePct,
      valueINR: h.value,
      asset: "equity",
    });
  }
  for (const m of mfEntries) {
    if (m.dayChangePct === undefined) continue;
    items.push({
      ticker: m.scheme,
      label: m.category || m.amc || "Mutual fund",
      pct: m.dayChangePct,
      valueINR: m.value,
      asset: "mf",
    });
  }
  if (items.length === 0) return null;

  const positive = [...items].filter((i) => i.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const negative = [...items].filter((i) => i.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 3);

  return (
    <section className="surface rounded-lg overflow-hidden">
      <header className="px-6 py-5 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-[15px] md:text-[16px] font-semibold tracking-[-0.005em] text-primary inline-flex items-center">
          Today's movers
          <InfoTip text="Biggest day-change moves across IN equity and mutual funds. US holdings excluded — INDmoney doesn't ship a daily delta we can read." />
        </h2>
      </header>
      <div
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="px-6 py-4" style={{ borderRight: "1px solid var(--border)" }}>
          <div className="text-[11px] text-tertiary uppercase tracking-wider mb-3">
            Up
          </div>
          {positive.length === 0 ? (
            <div className="text-[12px] text-tertiary">Nothing positive today.</div>
          ) : (
            <ul className="space-y-3">
              {positive.map((m) => (
                <MoverRow key={`up-${m.ticker}`} m={m} />
              ))}
            </ul>
          )}
        </div>
        <div className="px-6 py-4">
          <div className="text-[11px] text-tertiary uppercase tracking-wider mb-3">
            Down
          </div>
          {negative.length === 0 ? (
            <div className="text-[12px] text-tertiary">Nothing red today.</div>
          ) : (
            <ul className="space-y-3">
              {negative.map((m) => (
                <MoverRow key={`down-${m.ticker}`} m={m} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function MoverRow({
  m,
}: {
  m: { ticker: string; label: string; pct: number; valueINR: number; asset: "equity" | "mf" };
}) {
  const accent = m.pct >= 0 ? "text-pos" : "text-neg";
  const valueDelta = (m.pct / 100) * m.valueINR;
  return (
    <li className="flex items-center gap-3 min-w-0">
      <span
        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-subtle text-secondary shrink-0"
      >
        {m.asset === "mf" ? "MF" : "IN"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-primary truncate">{m.ticker}</div>
        <div className="text-[10.5px] text-tertiary truncate">{m.label}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`mono-true text-[12.5px] font-semibold ${accent}`}>
          {fmtPct(m.pct, 2)}
        </div>
        <div className="mono-true text-[10.5px] text-tertiary">
          {valueDelta >= 0 ? "+" : "−"}₹{fmtINR(Math.abs(Math.round(valueDelta)))}
        </div>
      </div>
    </li>
  );
}

function shortenRegime(r?: string): string {
  if (!r) return "—";
  // Hero stat wants ONE word. Map the dense regime string to a single-token
  // label by keyword; the full string still shows in the value tooltip.
  // Order matters: test "risk-off" before "risk-on" is moot (distinct stems),
  // but keep risk-off/risk-on grouped for readability.
  const lower = r.toLowerCase();
  if (/risk-off|\bcut\b|halt/.test(lower)) return "Risk-off";
  if (/risk-on|bull/.test(lower)) return "Risk-on";
  if (/cautious|defensive/.test(lower)) return "Cautious";
  if (/neutral|gate shut|range/.test(lower)) return "Neutral";
  // Fallback: first whitespace-delimited token, stripped of trailing comma.
  return r.trim().split(/\s+/)[0].replace(/[,.]+$/, "") || "—";
}

function RiskStrip({
  risk,
}: {
  risk: ReturnType<typeof computeRisk>;
}) {
  const conc = concentrationLabel(risk.hhi);
  const concCls =
    conc.tone === "good"
      ? "text-pos"
      : conc.tone === "warn"
      ? "text-primary"
      : "text-neg";
  const drawdownCls = risk.drawdownFromPeakPct < 5 ? "text-pos" : risk.drawdownFromPeakPct < 10 ? "text-primary" : "text-neg";
  return (
    <section>
      <h2 className="type-meta text-tertiary mb-3 flex items-center">
        Risk view
        <InfoTip text="Four numbers that tell you how exposed you are. Concentration = how many eggs in one basket. Max loss = ₹ at stake if the −15% cut rule fires. Top sector = sector overweight. Drawdown = how far you are from your portfolio peak." />
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="surface rounded-lg p-5">
          <div className="type-meta text-tertiary flex items-center">
            top-3 weight
            <InfoTip text="Sum of weights of your three largest positions. >50% = concentrated; if any one of them blows up, the portfolio takes a big hit. HHI is a scientific concentration index — under 1500 is diversified, 1500-2500 moderate, above 2500 concentrated." />
          </div>
          <div className="mono font-semibold mt-2 text-2xl tracking-tight text-primary">
            {risk.top3Weight.toFixed(1)}%
          </div>
          <div className={`type-caption mt-1.5 mono ${concCls}`}>
            {conc.label} · HHI {Math.round(risk.hhi)}
          </div>
        </div>
        <div className="surface rounded-lg p-5">
          <div className="type-meta text-tertiary flex items-center">
            open loss to cut-rule
            <InfoTip text="Only counts holdings currently in the red (P&L < 0). For each, the ₹ you'd lose if it kept falling from today's price down to the −15%-from-cost cut threshold. Winners are excluded because the cut-from-cost rule isn't the right risk gate for them (trailing stops are). This is the realistic near-term risk if your losers keep going." />
          </div>
          <div className="mono font-semibold mt-2 text-2xl tracking-tight text-neg">
            ₹{fmtINR(Math.abs(risk.maxLossINRIfCutRule))}
          </div>
          <div className="type-caption text-tertiary mt-1.5 mono">
            losers only · floor at −15% from cost
          </div>
        </div>
        <div className="surface rounded-lg p-5">
          <div className="type-meta text-tertiary flex items-center">
            top sector
            <InfoTip text="Largest sector's share of your portfolio. Above ~25% in any single sector is a flag — a sector-wide event would hit you disproportionately." />
          </div>
          <div className="mono font-semibold mt-2 text-2xl tracking-tight text-primary">
            {risk.sectorMix[0]
              ? risk.sectorMix[0].pct.toFixed(1) + "%"
              : "—"}
          </div>
          <div className="type-caption text-tertiary mt-1.5 truncate">
            {risk.sectorMix[0]?.sector ?? "—"}
          </div>
        </div>
        <div className="surface rounded-lg p-5">
          <div className="type-meta text-tertiary flex items-center">
            drawdown from peak
            <InfoTip text="How far below your all-time-high portfolio value you are now. Under 5% = noise; 5-10% = correction; >10% = bear territory and time to slow down. Tracks your highest snapshot value seen so far." />
          </div>
          <div className={`mono font-semibold mt-2 text-2xl tracking-tight ${drawdownCls}`}>
            {risk.drawdownFromPeakPct === 0
              ? "at peak"
              : `−${risk.drawdownFromPeakPct.toFixed(1)}%`}
          </div>
          <div className="type-caption text-tertiary mt-1.5 mono">
            equity {risk.equityPct.toFixed(0)}% · etf {risk.etfPct.toFixed(0)}% · bond {risk.bondsPct.toFixed(0)}%
          </div>
        </div>
      </div>
    </section>
  );
}

function SectorMixCard({
  sectors,
}: {
  sectors: { sector: string; pct: number }[];
}) {
  const palette = [
    "#d30ad7",
    "#0ea5e9",
    "#f59e0b",
    "#22c55e",
    "#ec4899",
    "#a855f7",
    "#14b8a6",
    "#ef4444",
    "#84cc16",
    "#64748b",
  ];
  const [hover, setHover] = useState<number | null>(null);
  const totalPct = sectors.reduce((s, x) => s + x.pct, 0) || 1;
  const top = sectors[0];
  const focused = hover !== null ? sectors[hover] : top;
  const focusedIdx = hover !== null ? hover : 0;
  const breach = focused && focused.pct > 25;

  // Donut math — circle + stroke-dasharray approach with small inter-wedge gaps.
  const radius = 70;
  const stroke = 20;
  const C = 2 * Math.PI * radius;
  const gap = sectors.length > 1 ? 1.5 : 0; // px gap between wedges
  let offset = 0;
  const slices = sectors.map((s, i) => {
    const raw = (s.pct / totalPct) * C;
    const len = Math.max(0, raw - gap);
    const isHover = hover !== null;
    const dim = isHover && hover !== i;
    const node = (
      <circle
        key={s.sector}
        r={radius}
        cx={0}
        cy={0}
        fill="none"
        stroke={palette[i % palette.length]}
        strokeWidth={stroke}
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-offset}
        style={{
          opacity: dim ? 0.22 : 1,
          transition: "opacity 180ms ease-out",
          cursor: "pointer",
        }}
        onMouseEnter={() => setHover(i)}
        onMouseLeave={() => setHover(null)}
      />
    );
    offset += raw;
    return node;
  });

  return (
    <section className="surface rounded-lg p-6">
      <h3 className="type-h3 text-primary mb-1 flex items-center">
        Sector mix
        <InfoTip text="Each sector's share of total portfolio value. Healthcare, Financials, AI Infra etc. are individual sectors; bonds bucket together as Fixed Income. A sector breaching 25% means a single industry shock would dent the whole portfolio." />
      </h3>
      <p className="type-caption text-tertiary mb-5">
        Concentration above ~25% in any single sector is a flag.
      </p>

      <div className="flex items-center gap-7 flex-wrap">
        <svg
          viewBox="-100 -100 200 200"
          width="200"
          height="200"
          className="shrink-0"
        >
          <g transform="rotate(-90)">{slices}</g>
          <text
            x="0"
            y="-10"
            textAnchor="middle"
            style={{
              fontSize: 10.5,
              fill: "var(--text-tertiary)",
              letterSpacing: 0,
            }}
          >
            {hover !== null ? "Selected" : "Top sector"}
          </text>
          <text
            x="0"
            y="12"
            textAnchor="middle"
            className="mono-true"
            style={{
              fontSize: 22,
              fontWeight: 600,
              fill: breach ? "var(--neg)" : "var(--text-primary)",
            }}
          >
            {focused ? `${focused.pct.toFixed(1)}%` : "—"}
          </text>
          {focused && (
            <text
              x="0"
              y="30"
              textAnchor="middle"
              style={{ fontSize: 10.5, fill: "var(--text-tertiary)" }}
            >
              {focused.sector}
            </text>
          )}
        </svg>

        <ul className="flex-1 min-w-[200px] flex flex-col gap-0.5">
          {sectors.map((s, i) => {
            const isHover = hover === i;
            const dim = hover !== null && !isHover;
            return (
              <li
                key={s.sector}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="flex items-center gap-3 text-[12.5px] py-1 px-1.5 rounded-md cursor-pointer"
                style={{
                  background: isHover ? "var(--bg-subtle)" : "transparent",
                  opacity: dim ? 0.55 : 1,
                  transition: "opacity 180ms, background 180ms",
                }}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: palette[i % palette.length] }}
                />
                <span className="text-primary flex-1 truncate">{s.sector}</span>
                <span className="mono-true text-tertiary tabular-nums">
                  {s.pct.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

type AlphaWindow = {
  label: string;
  fromDate: string;
  days: number;
  portfolioReturnPct: number | null;
  niftyReturnPct: number | null;
  alphaPct: number | null;
};

type AlphaPayload = {
  hasData: boolean;
  rowCount?: number;
  firstDate?: string;
  lastDate?: string;
  windows?: AlphaWindow[];
};

function AlphaCard() {
  const [data, setData] = useState<AlphaPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/performance")
      .then((r) => r.json())
      .then((r) => setData(r.data ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  if (!data?.hasData || !data.windows || data.windows.length === 0) {
    return (
      <section className="surface rounded-lg p-6">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="type-h3 text-primary flex items-center">
            Alpha vs Nifty
            <InfoTip text="The single most important number for a stock-picker: are you beating the index? Computed as time-weighted portfolio return minus Nifty 50 return over the same window. Cash injections/withdrawals are netted out so they don't count as 'returns'. Positive = you're adding value; negative = NIFTYBEES would have done better." />
          </h2>
        </div>
        <p className="type-body-sm text-tertiary leading-relaxed">
          Not enough history yet. Need at least 2 portfolio snapshots —
          tracking starts after the next portfolio check.
        </p>
      </section>
    );
  }

  // Pick the longest window as the headline; show all as a strip.
  const headline = data.windows[data.windows.length - 1];
  const headlineAlpha =
    typeof headline.alphaPct === "number" && Number.isFinite(headline.alphaPct)
      ? headline.alphaPct
      : null;
  const beating = headlineAlpha !== null && headlineAlpha >= 0;

  return (
    <section className="surface rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h2 className="type-h3 text-primary flex items-center">
          Alpha vs Nifty
          <InfoTip text="The single most important number for a stock-picker: are you beating the index? Computed as time-weighted portfolio return minus Nifty 50 return over the same window. Cash injections/withdrawals are netted out so they don't count as 'returns'. Positive = adding value; negative = NIFTYBEES would have done better." />
        </h2>
        <span className="type-caption text-tertiary mono">
          {data.firstDate} → {data.lastDate} · {data.rowCount} snapshots
        </span>
      </div>
      <p
        className={`type-body-sm leading-snug mb-5 ${
          headlineAlpha === null
            ? "text-tertiary"
            : beating
            ? "text-pos"
            : "text-neg"
        }`}
      >
        {headlineAlpha === null
          ? `Not enough data yet for a clean alpha read since ${headline.fromDate}.`
          : beating
          ? `You're beating the index by ${fmtPct(headlineAlpha, 1)} since ${headline.fromDate}.`
          : `You're trailing the index by ${fmtPct(Math.abs(headlineAlpha), 1)} since ${headline.fromDate}. NIFTYBEES would've done better.`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {data.windows.map((w) => (
          <AlphaCell key={w.label} w={w} />
        ))}
      </div>
      <p className="type-caption text-tertiary mt-4 leading-relaxed">
        Time-weighted return — fresh capital is netted out. With only{" "}
        {data.rowCount} data points, treat short-window numbers (today, 1
        week) as noise; the 'since start' window is the most meaningful.
      </p>
    </section>
  );
}

function AlphaCell({ w }: { w: AlphaWindow }) {
  const hasAlpha =
    typeof w.alphaPct === "number" && Number.isFinite(w.alphaPct);
  const positive = hasAlpha && (w.alphaPct as number) >= 0;
  const alphaCls = !hasAlpha
    ? "text-tertiary"
    : positive
    ? "text-pos"
    : "text-neg";
  return (
    <div className="surface-subtle rounded-xl p-4">
      <div className="type-meta text-tertiary mb-1.5">{w.label}</div>
      <div className={`mono font-bold text-2xl tracking-tight ${alphaCls}`}>
        {hasAlpha
          ? `${positive ? "+" : ""}${(w.alphaPct as number).toFixed(2)}%`
          : "—"}
      </div>
      <div className="type-caption text-tertiary mt-1.5 leading-relaxed">
        port {fmtPct(w.portfolioReturnPct ?? undefined, 2)} · nifty{" "}
        {fmtPct(w.niftyReturnPct ?? undefined, 2)}
      </div>
    </div>
  );
}


function MoverBox({
  label,
  ticker,
  pct,
  accent,
}: {
  label: string;
  ticker?: string;
  pct?: number;
  accent: "pos" | "neg";
}) {
  if (!ticker) return null;
  const meta = getMeta(ticker);
  return (
    <div className="surface rounded-lg p-5 flex items-center gap-3">
      <LogoImg ticker={ticker} domain={meta.domain} size={44} rounded="xl" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-tertiary">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold mono text-primary">{ticker}</span>
        </div>
        <div className="text-[11px] text-tertiary truncate">{meta.name}</div>
      </div>
      <div
        className={`text-xl mono font-semibold ${
          accent === "pos" ? "text-pos" : "text-neg"
        }`}
      >
        {fmtPct(pct, 2)}
      </div>
    </div>
  );
}


// ---------- Holdings ----------

type SortKey = "weight" | "today" | "pnl" | "value";
type Filter = "all" | "equity" | "etf" | "bond" | "gainers" | "losers";
type MarketFilter = "all" | "IN" | "US";

function HoldingsTab() {
  const openPerTicker = useOpenPerTicker();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [mtime, setMtime] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sort, setSort] = useState<SortKey>("weight");
  const [filter, setFilter] = useState<Filter>("all");
  const [market, setMarket] = useState<MarketFilter>("all");

  useEffect(() => {
    fetch("/api/snapshot")
      .then((r) => r.json())
      .then((r) => {
        if (r.data) {
          setSnapshot(r.data);
          setMtime(r.mtime);
        }
        setLoaded(true);
      });
  }, []);

  const hasUS = useMemo(
    () => snapshot?.holdings.some((h) => h.market === "US") ?? false,
    [snapshot]
  );

  // This tab is "Indian equity" — exclude bonds (own tab), US (own tab), and zero-value/sold positions (tracked in decision tracker).
  const inEquityHoldings = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.holdings.filter(
      (h) =>
        (h.market || "IN") === "IN" &&
        getMeta(h.ticker).asset !== "bond" &&
        (h.value ?? 0) > 0 &&
        (h.qty ?? 0) > 0
    );
  }, [snapshot]);

  const stats = useMemo(() => {
    if (!inEquityHoldings.length || !snapshot) return null;
    const value = inEquityHoldings.reduce((s, h) => s + h.value, 0);
    const todayMove = inEquityHoldings.reduce(
      (s, h) => s + ((h.dayChangePct ?? 0) / 100) * h.value,
      0
    );
    const todayPct = value > 0 ? (todayMove / (value - todayMove)) * 100 : 0;
    const gainers = inEquityHoldings.filter((h) => (h.dayChangePct ?? 0) > 0).length;
    const losers = inEquityHoldings.filter((h) => (h.dayChangePct ?? 0) < 0).length;
    const top = [...inEquityHoldings].sort((a, b) => b.value - a.value)[0];
    const concentration = top ? (top.value / value) * 100 : 0;
    // Prefer the live Kite-sourced aggregate over client-side recomputation
    // so the stat exactly matches what Kite shows. Fall back to per-holding
    // math when the snapshot wasn't Kite-enriched (no session / API down).
    let totalPnL: number;
    let totalCostBasis: number;
    if (snapshot.liveInEquityPnL !== undefined && snapshot.liveInEquityCost !== undefined) {
      totalPnL = snapshot.liveInEquityPnL;
      totalCostBasis = snapshot.liveInEquityCost;
    } else {
      totalPnL = 0;
      totalCostBasis = 0;
      for (const h of inEquityHoldings) {
        if (h.avgPrice === undefined || h.avgPrice === 0) continue;
        const cost = h.avgPrice * h.qty;
        totalCostBasis += cost;
        totalPnL += h.value - cost;
      }
    }
    const totalPnLPct =
      snapshot.liveInEquityPnLPct ??
      (totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : undefined);
    return {
      value,
      todayMove,
      todayPct,
      gainers,
      losers,
      top,
      concentration,
      totalPnL,
      totalPnLPct,
    };
  }, [inEquityHoldings, snapshot]);

  const holdingMatches = (h: Holding, f: Filter) => {
    if (f === "all") return true;
    if (f === "equity") return getMeta(h.ticker).asset === "equity";
    if (f === "etf") return getMeta(h.ticker).asset === "etf";
    if (f === "gainers") return (h.dayChangePct ?? 0) > 0;
    if (f === "losers") return (h.dayChangePct ?? 0) < 0;
    return true;
  };

  const holdingFilterCounts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: inEquityHoldings.length,
      equity: 0,
      etf: 0,
      bond: 0,
      gainers: 0,
      losers: 0,
    };
    for (const h of inEquityHoldings) {
      (Object.keys(c) as Filter[]).forEach((k) => {
        if (k !== "all" && holdingMatches(h, k)) c[k] += 1;
      });
    }
    return c;
  }, [inEquityHoldings]);

  const filtered = useMemo(() => {
    const items = inEquityHoldings.filter((h) => holdingMatches(h, filter));

    const cmp = (a: Holding, b: Holding) => {
      if (sort === "weight") return b.weight - a.weight;
      if (sort === "today") return (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0);
      if (sort === "pnl") return (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity);
      return b.value - a.value;
    };
    return items.sort(cmp);
  }, [inEquityHoldings, sort, filter]);

  void hasUS;
  void market;
  void setMarket;

  return (
    <div className="space-y-7">
      <PageHero
        title="Indian equity"
        info="Indian-listed stocks and ETFs from your Kite holdings. Bonds and US stocks are in their own tabs."
        actions={<InvestButton scope="in-equity" scopeLabel="Indian equity" />}
        stale={(() => { const h = ageHoursFromISO(snapshot?.asOf); return h !== null ? { source: "snapshot", ageHours: h } : null; })()}
      >
        {stats && (
          <>
            <CompactStat
              label="Equity value"
              info="Total Indian equity + ETF holdings, mark-to-market via Kite."
              value={`₹${fmtINR(stats.value)}`}
              sub={`${inEquityHoldings.length} positions`}
            />
            <CompactStat
              label="Today"
              info="Estimated ₹ move today across IN equity, weighted by position value × day change %."
              value={
                stats.todayMove !== undefined
                  ? `${stats.todayMove >= 0 ? "+" : "−"}₹${fmtINR(
                      Math.abs(Math.round(stats.todayMove))
                    )}`
                  : "—"
              }
              sub={fmtPct(stats.todayPct, 2)}
              accent={stats.todayMove >= 0 ? "pos" : "neg"}
            />
            <CompactStat
              label="Total P&L"
              info="Aggregate gain/loss across IN equity positions where cost basis is known. Excludes ETFs / metals if avg price is missing."
              value={
                stats.totalPnLPct !== undefined
                  ? `${stats.totalPnL >= 0 ? "+" : "−"}₹${fmtINR(
                      Math.abs(Math.round(stats.totalPnL))
                    )}`
                  : "—"
              }
              sub={
                stats.totalPnLPct !== undefined
                  ? `${fmtPct(stats.totalPnLPct, 1)} since cost`
                  : undefined
              }
              accent={
                stats.totalPnLPct !== undefined
                  ? stats.totalPnLPct >= 0
                    ? "pos"
                    : "neg"
                  : undefined
              }
            />
            <CompactStat
              label="Regime"
              value={shortenRegime(snapshot?.regime)}
              valueInfo={
                snapshot?.regimeDetail ||
                "Why this label fired — based on Nifty vs 50/200-DMA, India VIX, FII/DII flows, and breadth. Updated each portfolio check."
              }
              sub={
                snapshot?.nifty?.value != null
                  ? `Nifty ${fmtINR(snapshot.nifty.value)} · ${fmtPct(
                      snapshot.nifty.dayChangePct,
                      2
                    )}`
                  : undefined
              }
            />
          </>
        )}
      </PageHero>

      <Toolbar className="px-3 md:px-5">
        <ToolbarGroup>
          <Segmented<Filter>
            ariaLabel="Filter holdings"
            value={filter}
            onChange={setFilter}
            options={(
              [
                { value: "all", label: "All" },
                { value: "equity", label: "Equity" },
                { value: "etf", label: "ETF" },
                { value: "gainers", label: "Gainers" },
                { value: "losers", label: "Losers" },
              ] as { value: Filter; label: string }[]
            ).filter(
              (o) => o.value === "all" || holdingFilterCounts[o.value] > 0
            )}
          />
        </ToolbarGroup>
        <div className="ml-auto">
          <ToolbarGroup>
            <Segmented<SortKey>
              ariaLabel="Sort holdings"
              value={sort}
              onChange={setSort}
              options={[
                { value: "weight", label: "Weight" },
                { value: "today", label: "Today" },
                { value: "pnl", label: "P&L" },
              ]}
            />
          </ToolbarGroup>
        </div>
      </Toolbar>

      {filtered.length ? (
        <section>
          <ul key={`${filter}-${sort}`} className="list-stagger">
            {filtered.map((h, i) => (
              <li key={h.ticker} style={{ ["--idx" as string]: i }}>
                <HoldingCard
                  h={h}
                  onOpen={(t) => openPerTicker({ ticker: t, market: "IN" })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : loaded ? (
        <EmptyState
          message={
            snapshot?.holdings.length
              ? "No holdings match that filter."
              : "No snapshot. Ask Claude to refresh."
          }
        />
      ) : (
        <Skeleton />
      )}
    </div>
  );
}

// ---------- Bonds ----------

type BondPosition = {
  isin: string;
  name: string;
  issuer: string;
  maturityDate: string;
  status: "active" | "matured";
  units: number;
  facePerUnit: number;
  avgPricePerUnit: number;
  investedINR: number;
  faceValueINR: number;
  interestNetINR: number;
  couponFreq: string;
  approxYieldPct: number | null;
  lastPayoutDate: string | null;
};

type BondsData = {
  fetchedAt: string;
  source: string;
  platform: string;
  totals: {
    investedINR: number;
    activeInvestedINR: number;
    maturedInvestedINR: number;
    interestEarnedGrossINR: number;
    interestEarnedNetINR: number;
    tdsDeductedINR: number;
    activeCount: number;
    maturedCount: number;
    totalCount: number;
  };
  positions: BondPosition[];
};

function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  return Math.round((t - Date.now()) / (24 * 3600 * 1000));
}

function formatRelativeMaturity(iso: string): string {
  const days = daysUntil(iso);
  if (days < 0) return `matured ${Math.abs(days)}d ago`;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function BondsTab() {
  const openPerTicker = useOpenPerTicker();
  const [data, setData] = useState<BondsData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showMatured, setShowMatured] = useState(false);

  useEffect(() => {
    fetch("/api/bonds")
      .then((r) => r.json())
      .then((r) => {
        if (r.data) setData(r.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const active = useMemo(
    () => (data?.positions ?? []).filter((p) => p.status === "active"),
    [data]
  );
  const matured = useMemo(
    () => (data?.positions ?? []).filter((p) => p.status === "matured"),
    [data]
  );

  const stats = useMemo(() => {
    if (!data) return null;
    const totals = data.totals;
    const weightedYield = (() => {
      let weight = 0;
      let sum = 0;
      for (const p of active) {
        if (p.approxYieldPct == null) continue;
        weight += p.investedINR;
        sum += p.investedINR * p.approxYieldPct;
      }
      return weight > 0 ? sum / weight : undefined;
    })();
    const next = [...active]
      .filter((p) => p.maturityDate)
      .sort(
        (a, b) =>
          new Date(a.maturityDate).getTime() -
          new Date(b.maturityDate).getTime()
      )[0];
    return { totals, weightedYield, next };
  }, [data, active]);

  return (
    <div className="space-y-7">
      <PageHero
        title="Bonds"
        info="NCDs, SDIs, and government bonds held via Stable Bonds. Coupon income is monthly/semi-annual depending on the issue. YTM shown is approximate, computed from the coupon stream — verify against issuer prospectus for exact numbers."
        actions={<InvestButton scope="bonds" scopeLabel="bonds" />}
        stale={(() => { const h = ageHoursFromISO(data?.fetchedAt); return h !== null ? { source: "bonds", ageHours: h } : null; })()}
      >
        {stats && (
          <>
            <CompactStat
              label="Active value"
              info="Invested capital across active (un-matured) bond positions on Stable Bonds."
              value={`₹${fmtINR(Math.round(stats.totals.activeInvestedINR))}`}
              sub={`${stats.totals.activeCount} active`}
            />
            <CompactStat
              label="Interest earned"
              info="Net coupon income received across all bonds (gross minus TDS), lifetime to date."
              value={`₹${fmtINR(Math.round(stats.totals.interestEarnedNetINR))}`}
              sub={`TDS ₹${fmtINR(Math.round(stats.totals.tdsDeductedINR))} · gross ₹${fmtINR(Math.round(stats.totals.interestEarnedGrossINR))}`}
              accent="pos"
            />
            <CompactStat
              label="Weighted yield"
              info="Investment-weighted average of approximate yields across active bonds. Excludes positions where yield isn't yet computable (no payouts received yet)."
              value={
                stats.weightedYield !== undefined
                  ? fmtPct(stats.weightedYield, 1)
                  : "—"
              }
              sub={
                stats.weightedYield !== undefined
                  ? "vs G-Sec ~7.0%"
                  : "awaiting first coupon"
              }
              accent={
                stats.weightedYield !== undefined && stats.weightedYield >= 9
                  ? "pos"
                  : undefined
              }
            />
            <CompactStat
              label="Next maturity"
              info="Closest upcoming maturity in the active book. Plan rollover roughly 30 days ahead."
              value={
                stats.next ? formatRelativeMaturity(stats.next.maturityDate) : "—"
              }
              sub={stats.next ? stats.next.name : undefined}
            />
          </>
        )}
      </PageHero>

      {active.length > 0 ? (
        <section>
          <ul key={`active-${active.length}`} className="list-stagger">
            {active.map((p, i) => (
              <li key={p.isin} style={{ ["--idx" as string]: i }}>
                <BondRow
                  p={p}
                  onOpen={() =>
                    openPerTicker({ ticker: p.isin, market: "BONDS" })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : loaded ? (
        <EmptyState message="No active bonds. Refresh after pulling the latest Stable Bonds report." />
      ) : (
        <Skeleton />
      )}

      {matured.length > 0 && (
        <section>
          <button
            onClick={() => setShowMatured((v) => !v)}
            className="text-[11.5px] text-tertiary hover:text-primary transition-colors mb-2 inline-flex items-center gap-1.5"
          >
            {showMatured ? "Hide" : "Show"} matured ({matured.length})
          </button>
          {showMatured && (
            <ul className="list-stagger">
              {matured.map((p, i) => (
                <li key={p.isin} style={{ ["--idx" as string]: i }}>
                  <BondRow
                    p={p}
                    dim
                    onOpen={() =>
                      openPerTicker({ ticker: p.isin, market: "BONDS" })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function BondRow({
  p,
  dim = false,
  onOpen,
}: {
  p: BondPosition;
  dim?: boolean;
  onOpen?: () => void;
}) {
  const couponInitials = p.issuer
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      className={`relative w-[calc(100%+3rem)] md:w-[calc(100%+5rem)] grid grid-cols-[40px_1fr_auto_auto_auto] md:grid-cols-[40px_1fr_64px_88px_84px_64px] -mx-6 md:-mx-10 gap-x-3 items-center py-5 px-10 md:px-16 transition-colors hover:bg-[var(--bg-subtle)] cursor-pointer accent-ring after:content-[''] after:absolute after:bottom-0 after:left-[92px] md:after:left-[116px] after:right-10 md:after:right-16 after:h-px after:bg-[var(--border)] ${
        dim ? "opacity-60" : ""
      }`}
    >
      <div
        className="rounded-lg flex items-center justify-center mono-true text-white shrink-0"
        style={{
          width: 36,
          height: 36,
          background: "#14b8a6",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
        aria-label={p.issuer}
      >
        {couponInitials}
      </div>
      <div className="min-w-0 text-[13px] font-medium text-primary truncate">
        {p.name}
      </div>
      <div className="hidden md:block text-right mono-true text-[12.5px] text-secondary shrink-0">
        {p.approxYieldPct != null ? `${p.approxYieldPct.toFixed(1)}%` : "—"}
      </div>
      <div className="text-right mono-true text-[13px] font-semibold text-primary shrink-0">
        ₹{fmtINR(Math.round(p.investedINR))}
      </div>
      <div className="text-right mono-true text-[12.5px] text-pos shrink-0">
        ₹{fmtINR(Math.round(p.interestNetINR))}
      </div>
      <div className="text-right mono-true text-[12px] text-tertiary shrink-0">
        {formatRelativeMaturity(p.maturityDate)}
      </div>
    </div>
  );
}

// ---------- Mutual Funds ----------

type MFSortKey = "value" | "today" | "pnl" | "xirr";
type MFFilter = "all" | "equity" | "debt" | "hybrid" | "elss" | "index" | "sip" | "lumpsum";

function MutualFundsTab() {
  const openPerTicker = useOpenPerTicker();
  const [summary, setSummary] = useState<MFSummary | null>(null);
  const [mtime, setMtime] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sort, setSort] = useState<MFSortKey>("value");
  const [filter, setFilter] = useState<MFFilter>("all");

  useEffect(() => {
    fetch("/api/mutualfunds")
      .then((r) => r.json())
      .then((r) => {
        if (r.summary) {
          setSummary(r.summary);
          setMtime(r.mtime ?? null);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const entries = summary?.entries ?? [];

  const stats = useMemo(() => {
    if (!entries.length) return null;
    const totalValue =
      summary?.totalValue ?? entries.reduce((s, m) => s + (m.value || 0), 0);

    // P&L is only meaningful where cost basis is known. Used as a sub-stat
    // when relevant; never as the headline.
    const tracked = entries.filter((m) => (m.invested ?? 0) > 0);
    const trackedValue = tracked.reduce((s, m) => s + (m.value || 0), 0);
    const trackedInvested = tracked.reduce(
      (s, m) => s + (m.invested || 0),
      0
    );
    const trackedPnL = trackedValue - trackedInvested;
    const trackedPnLPct =
      trackedInvested > 0 ? (trackedPnL / trackedInvested) * 100 : undefined;

    // Headline performance: prefer the portfolio-level XIRR from the snapshot
    // (INDmoney computes the true money-weighted XIRR over full cash flows).
    // Fall back to a value-weighted average of per-fund XIRRs if absent.
    const xirrEntries = entries.filter(
      (m) => m.xirr !== undefined && (m.value ?? 0) > 0
    );
    const xirrValueSum = xirrEntries.reduce((s, m) => s + (m.value || 0), 0);
    const weightedXIRR =
      summary?.xirr ??
      (xirrValueSum > 0
        ? xirrEntries.reduce(
            (s, m) => s + (m.xirr || 0) * (m.value || 0),
            0
          ) / xirrValueSum
        : undefined);

    // Same trick for 1Y return — answers "how is this doing recently?"
    const r1yEntries = entries.filter(
      (m) => m.return1y !== undefined && (m.value ?? 0) > 0
    );
    const r1yValueSum = r1yEntries.reduce((s, m) => s + (m.value || 0), 0);
    const weighted1Y =
      r1yValueSum > 0
        ? r1yEntries.reduce(
            (s, m) => s + (m.return1y || 0) * (m.value || 0),
            0
          ) / r1yValueSum
        : undefined;

    const todayMove = entries.reduce(
      (s, m) =>
        s + ((m.dayChangePct ?? 0) / 100) * (m.value || 0),
      0
    );
    const sipMonthly =
      summary?.monthlySIP ??
      entries
        .filter((m) => m.sipActive)
        .reduce((s, m) => s + (m.sipAmount || 0), 0);
    return {
      totalValue,
      trackedValue,
      trackedInvested,
      trackedPnL,
      trackedPnLPct,
      trackedCount: tracked.length,
      untrackedCount: entries.length - tracked.length,
      weightedXIRR,
      weighted1Y,
      todayMove,
      sipMonthly,
    };
  }, [entries, summary]);

  const categoryMix = useMemo(() => {
    if (!entries.length)
      return [] as { label: string; pct: number; value: number; count: number }[];
    const total = entries.reduce((s, m) => s + (m.value || 0), 0) || 1;
    const buckets = new Map<string, { value: number; count: number }>();
    for (const m of entries) {
      const cat = bucketCategory(m.category);
      const cur = buckets.get(cat) ?? { value: 0, count: 0 };
      cur.value += m.value || 0;
      cur.count += 1;
      buckets.set(cat, cur);
    }
    return [...buckets.entries()]
      .map(([label, b]) => ({
        label,
        value: b.value,
        count: b.count,
        pct: (b.value / total) * 100,
      }))
      .sort((a, b) => b.value - a.value);
  }, [entries]);

  const mfMatches = (m: MFEntry, f: MFFilter) => {
    if (f === "all") return true;
    if (f === "equity")
      return (
        /large|mid|small|flexi|multi|focus|sectoral|thematic|equity/i.test(
          m.category
        ) && !/elss|index/i.test(m.category)
      );
    if (f === "debt") return /debt|liquid|gilt|bond/i.test(m.category);
    if (f === "hybrid")
      return /hybrid|balanced|arbitrage|asset alloc/i.test(m.category);
    if (f === "elss") return /elss|tax/i.test(m.category);
    if (f === "index") return /index|nifty|sensex|etf/i.test(m.category);
    if (f === "sip") return !!m.sipActive;
    if (f === "lumpsum") return !m.sipActive;
    return true;
  };

  const mfFilterCounts = useMemo(() => {
    const c: Record<MFFilter, number> = {
      all: entries.length,
      equity: 0,
      hybrid: 0,
      debt: 0,
      elss: 0,
      index: 0,
      sip: 0,
      lumpsum: 0,
    };
    for (const m of entries) {
      (Object.keys(c) as MFFilter[]).forEach((k) => {
        if (k !== "all" && mfMatches(m, k)) c[k] += 1;
      });
    }
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    // Hide sold / zero-value / bookmark-residual entries.
    // ₹500 cutoff catches bookmark-residual positions (a few units ≈ ₹200).
    // Decision tracker has the full trade history.
    const list = entries
      .filter((m) => (m.value ?? 0) >= 500)
      .filter((m) => mfMatches(m, filter));

    const cmp = (a: MFEntry, b: MFEntry) => {
      if (sort === "value") return (b.value || 0) - (a.value || 0);
      if (sort === "today") return (b.dayChangePct ?? -Infinity) - (a.dayChangePct ?? -Infinity);
      if (sort === "pnl") return (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity);
      if (sort === "xirr") return (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity);
      return 0;
    };
    return list.sort(cmp);
  }, [entries, sort, filter]);

  return (
    <div className="space-y-7">
      <PageHero
        title="Mutual funds"
        info="Direct-growth mutual fund holdings. NAVs sourced from AMFI; lifetime cost basis + XIRR from INDmoney."
        actions={<InvestButton scope="mf" scopeLabel="mutual funds" />}
        stale={(() => { const h = ageHoursFromISO(summary?.asOf ?? mtime); return h !== null ? { source: "MF", ageHours: h } : null; })()}
      >
        {entries.length > 0 && stats && (
          <>
              <CompactStat
                label="MF value"
                info="Total live value of all mutual fund holdings: units × current NAV. Updated when AMFI publishes the daily NAV file (~9pm IST on weekdays)."
                value={`₹${fmtINR(stats.totalValue)}`}
                sub={`${entries.length} schemes`}
              />
              <CompactStat
                label="Today"
                info="Estimated ₹ move today across all MFs based on each scheme's NAV day change. NAVs only update once a day, so this is end-of-day."
                value={
                  stats.todayMove !== undefined
                    ? `${stats.todayMove >= 0 ? "+" : ""}₹${fmtINR(
                        Math.round(stats.todayMove)
                      )}`
                    : "—"
                }
                sub={
                  stats.todayMove !== undefined && stats.totalValue > 0
                    ? fmtPct(
                        (stats.todayMove /
                          (stats.totalValue - stats.todayMove)) *
                          100,
                        2
                      )
                    : undefined
                }
                accent={
                  stats.todayMove !== undefined
                    ? stats.todayMove >= 0
                      ? "pos"
                      : "neg"
                    : undefined
                }
              />
              <CompactStat
                label="XIRR"
                info="Value-weighted scheme XIRR — how fast this MF book is compounding. Calculated as Σ(value × scheme XIRR) ÷ total value, using each fund's 3-yr CAGR as the XIRR proxy. Doesn't depend on personal cost basis, so it works across all 12 funds. Compare to Nifty 50 ~12% to see if active selection is paying off. Sub shows trailing 1-yr return on the same weighted basis."
                value={
                  stats.weightedXIRR !== undefined
                    ? fmtPct(stats.weightedXIRR, 1)
                    : "—"
                }
                sub={
                  stats.weighted1Y !== undefined
                    ? `1Y ${fmtPct(stats.weighted1Y, 1)}`
                    : undefined
                }
                accent={
                  stats.weightedXIRR !== undefined
                    ? stats.weightedXIRR >= 12
                      ? "pos"
                      : stats.weightedXIRR < 8
                      ? "neg"
                      : undefined
                    : undefined
                }
              />
              <CompactStat
                label="Tracked P&L"
                info="Aggregate P&L on schemes where INDmoney has a lifetime cost basis. All 12 funds carry one — so this matches the headline."
                value={
                  stats.trackedPnLPct !== undefined
                    ? fmtPct(stats.trackedPnLPct, 1)
                    : "—"
                }
                sub={
                  stats.trackedCount > 0
                    ? `${stats.trackedCount} of ${entries.length} tracked`
                    : undefined
                }
                accent={
                  stats.trackedPnLPct !== undefined
                    ? stats.trackedPnLPct >= 0 ? "pos" : "neg"
                    : undefined
                }
              />
          </>
        )}
      </PageHero>

      <Toolbar className="px-3 md:px-5">
        <ToolbarGroup>
          <Segmented<MFFilter>
            ariaLabel="Filter mutual funds"
            value={filter}
            onChange={setFilter}
            options={(
              [
                { value: "all", label: "All" },
                { value: "equity", label: "Equity" },
                { value: "hybrid", label: "Hybrid" },
                { value: "debt", label: "Debt" },
                { value: "elss", label: "ELSS" },
                { value: "index", label: "Index" },
                { value: "lumpsum", label: "Lumpsum" },
              ] as { value: MFFilter; label: string }[]
            ).filter((o) => o.value === "all" || mfFilterCounts[o.value] > 0)}
          />
        </ToolbarGroup>
        <div className="ml-auto">
          <ToolbarGroup>
            <Segmented<MFSortKey>
              ariaLabel="Sort mutual funds"
              value={sort}
              onChange={setSort}
              options={[
                { value: "value", label: "Value" },
                { value: "today", label: "Today" },
                { value: "pnl", label: "P&L" },
                { value: "xirr", label: "XIRR" },
              ]}
            />
          </ToolbarGroup>
        </div>
      </Toolbar>

      {filtered.length ? (
        <section>
          <ul key={`${filter}-${sort}`} className="list-stagger">
            {filtered.map((m, i) => (
              <li
                key={`${m.scheme}-${i}`}
                style={{ ["--idx" as string]: i }}
              >
                <MFCard
                  m={m}
                  onOpen={(t) => openPerTicker({ ticker: t, market: "MF" })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : loaded ? (
        <EmptyState
          message={
            entries.length
              ? "No funds match that filter."
              : "No mutual fund data yet. Drop a CAMS/Karvy CAS PDF and ask Claude to parse it into project_mutual_funds.md."
          }
        />
      ) : (
        <Skeleton />
      )}
      <MFXrayCard />
    </div>
  );
}

function bucketCategory(cat: string): string {
  const c = cat.toLowerCase();
  if (/elss|tax/.test(c)) return "ELSS";
  if (/index|nifty|sensex|etf/.test(c)) return "Index";
  if (/hybrid|balanced|arbitrage|asset alloc/.test(c)) return "Hybrid";
  if (/debt|liquid|gilt|bond|short duration|ultra short|overnight/.test(c)) return "Debt";
  if (/large.*mid/.test(c)) return "Large & Mid";
  if (/large/.test(c)) return "Large Cap";
  if (/mid/.test(c)) return "Mid Cap";
  if (/small/.test(c)) return "Small Cap";
  if (/flexi/.test(c)) return "Flexi Cap";
  if (/multi/.test(c)) return "Multi Cap";
  if (/sectoral|thematic/.test(c)) return "Thematic";
  return cat;
}

function AssetSplitStrip({
  total,
  items,
  stale,
}: {
  total: number;
  items: AssetAllocationItem[];
  stale?: { source: string; ageHours: number } | null;
}) {
  // Cash is excluded from allocation — it's deployable, not allocated.
  const allocItems = useMemo(
    () => items.filter((it) => it.key !== "cash" && it.value > 0),
    [items]
  );
  const allocTotal = useMemo(
    () => allocItems.reduce((s, it) => s + it.value, 0),
    [allocItems]
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = allocItems.find((it) => it.key === activeKey) ?? null;

  if (total <= 0 || allocItems.length === 0) return null;

  // recharts wants a flat data array
  const data = allocItems.map((it) => ({
    key: it.key,
    name: it.label,
    value: it.value,
    color: it.color,
    pct: (it.value / allocTotal) * 100,
    onClick: it.onClick,
  }));

  return (
    <section className="surface rounded-lg overflow-hidden">
      <header className="px-6 py-5 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-[15px] md:text-[16px] font-semibold tracking-[-0.005em] text-primary inline-flex items-center gap-2">
          Asset allocation
          <InfoTip text="How your invested book is split across asset classes. Cash is treated as deployable and shown separately. Hover or click a slice to jump to the tab." />
          {stale && stale.ageHours > 24 && (
            <span
              className="mono-true normal-case tracking-normal font-medium text-[10.5px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
              style={{
                background: "var(--warn-tint)",
                color: "var(--warn)",
                border: "1px solid var(--warn-tint)",
              }}
              title={`Oldest data source: ${stale.source}, ${Math.round(stale.ageHours)}h old. Run /portfolio-check to refresh.`}
            >
              STALE
              <span aria-hidden="true">·</span>
              <span>{stale.source}</span>
              <span>{Math.round(stale.ageHours)}h</span>
            </span>
          )}
        </h2>
      </header>
      <div
        className="grid grid-cols-1 md:grid-cols-[1fr_2.3fr]"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div
          className="relative flex items-center justify-center py-6 md:py-8 px-4"
          style={{ borderRight: "1px solid var(--border)" }}
        >
          <div className="relative" style={{ width: 200, height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={88}
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={-270}
                  cornerRadius={4}
                  stroke="none"
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setActiveKey(data[i]?.key ?? null)}
                  onMouseLeave={() => setActiveKey(null)}
                  onClick={(d) => {
                    const item = allocItems.find((it) => it.key === d.key);
                    item?.onClick?.();
                  }}
                  style={{ cursor: "pointer", outline: "none" }}
                >
                  {data.map((d) => {
                    const isActive = activeKey === d.key;
                    return (
                      <Cell
                        key={d.key}
                        fill={d.color}
                        opacity={
                          activeKey === null ? 1 : isActive ? 1 : 0.32
                        }
                        style={{ transition: "opacity 200ms ease" }}
                      />
                    );
                  })}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-[9.5px] uppercase tracking-[0.08em] text-tertiary leading-none">
                {active ? active.label : "Allocated"}
              </span>
              <span className="mono-true font-semibold text-primary text-[15px] tracking-tight leading-none mt-1.5">
                ₹{fmtINR(active ? active.value : allocTotal)}
              </span>
              <span className="mono-true text-[10px] text-tertiary mt-1.5 leading-none">
                {active
                  ? `${((active.value / allocTotal) * 100).toFixed(1)}%`
                  : `${allocItems.length} ${
                      allocItems.length === 1 ? "asset class" : "classes"
                    }`}
              </span>
            </div>
          </div>
        </div>
        <ul className="flex flex-col pt-2">
          {allocItems.map((item, i) => {
            const pct = (item.value / allocTotal) * 100;
            const isActive = activeKey === item.key;
            return (
              <li
                key={item.key}
                onMouseEnter={() => setActiveKey(item.key)}
                onMouseLeave={() =>
                  setActiveKey((k) => (k === item.key ? null : k))
                }
                onClick={item.onClick}
                className={`px-5 md:px-6 py-3.5 flex items-center gap-3 transition-colors ${
                  item.onClick ? "cursor-pointer hover:bg-[var(--bg-subtle)]" : ""
                }`}
                style={{
                  borderTop:
                    i > 0 ? "1px solid var(--border)" : undefined,
                  background: isActive ? "var(--bg-subtle)" : undefined,
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: item.color }}
                />
                <span className="text-[13px] text-primary font-medium flex-1 truncate">
                  {item.label}
                </span>
                <span className="mono-true text-[13px] font-semibold text-primary shrink-0">
                  ₹{fmtINR(item.value)}
                </span>
                <span className="mono-true text-[12px] text-tertiary shrink-0 w-12 text-right">
                  {pct.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}


function AssetCard({
  label,
  color,
  value,
  pct,
  pnlPct,
  countLabel,
  extraLabel,
  onClick,
  showLeftDivider,
}: {
  label: string;
  color: string;
  value: number;
  pct: number;
  pnlPct?: number;
  countLabel: string;
  extraLabel?: string;
  onClick?: () => void;
  showLeftDivider?: boolean;
}) {
  const pnlCls =
    pnlPct === undefined
      ? "text-tertiary"
      : pnlPct >= 0
      ? "text-pos"
      : "text-neg";
  const content = (
    <>
      <div className="flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
        <span className="eyebrow">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-3 flex-wrap">
        <span className="mono-true font-semibold text-primary text-[24px] tracking-tight leading-none">
          ₹{fmtINR(value)}
        </span>
        <span className="mono-true text-[12px] text-tertiary">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-3 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] mono-true">
        <span className="text-tertiary">{countLabel}</span>
        {extraLabel && (
          <>
            <span className="text-tertiary">·</span>
            <span className="text-secondary">{extraLabel}</span>
          </>
        )}
        {pnlPct !== undefined && (
          <>
            <span className="text-tertiary">·</span>
            <span className={pnlCls}>
              {fmtPct(pnlPct, 1)} since cost
            </span>
          </>
        )}
      </div>
      {onClick && (
        <span
          className="absolute bottom-3 right-6 text-tertiary text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        >
          →
        </span>
      )}
    </>
  );

  const className =
    "group text-left px-6 py-5 transition-colors accent-ring relative";
  const style = {
    borderTop: "1px solid var(--border)",
    borderLeft: showLeftDivider ? "1px solid var(--border)" : undefined,
  };

  if (!onClick) {
    return (
      <div className={className} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`${className} hover:bg-[var(--bg-subtle)]`}
      style={style}
    >
      {content}
    </button>
  );
}

function MFCategoryStrip({
  mix,
}: {
  mix: { label: string; pct: number; value: number; count: number }[];
}) {
  const palette = [
    "#d30ad7",
    "#0ea5e9",
    "#f59e0b",
    "#22c55e",
    "#a855f7",
    "#14b8a6",
    "#ec4899",
    "#84cc16",
    "#ef4444",
    "#64748b",
  ];
  const max = mix[0]?.pct || 1;
  return (
    <section className="surface rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
        <h3 className="type-meta text-tertiary flex items-center">
          Category mix
          <InfoTip text="Each category's share of total MF value. >25% in any single category is a flag — a category-wide drawdown would dent the whole book disproportionately. Bar widths show category size relative to your largest, not absolute %." />
        </h3>
        <span className="mono-true text-[10.5px] text-tertiary">
          {mix.length} {mix.length === 1 ? "category" : "categories"}
        </span>
      </div>
      <ul className="space-y-2.5">
        {mix.map((m, i) => {
          const color = palette[i % palette.length];
          const barWidth = (m.pct / max) * 100;
          const flag = m.pct > 25;
          return (
            <li
              key={m.label}
              className="grid grid-cols-[1fr_auto] gap-x-4 items-center"
            >
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-[12.5px] text-primary font-medium inline-flex items-center gap-2 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    <span className="truncate">{m.label}</span>
                    <span className="text-[10.5px] text-tertiary mono-true shrink-0">
                      {m.count}
                    </span>
                  </span>
                  <span
                    className={`mono-true text-[11.5px] shrink-0 ${
                      flag ? "text-neg font-medium" : "text-tertiary"
                    }`}
                  >
                    {m.pct.toFixed(1)}%
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--bg-subtle)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${barWidth}%`, background: color }}
                  />
                </div>
              </div>
              <span className="mono-true text-[11.5px] text-secondary tabular-nums whitespace-nowrap">
                ₹{fmtINR(m.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- US stocks ----------

type USStock = {
  ticker: string;
  name: string;
  kind: "stock" | "etf";
  quantity: number;
  avgPriceUSD: number;
  currentPriceUSD: number;
  investedINR: number;
  currentINR: number;
  pnlINR: number;
  pnlPct: number;
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
};

type USStocksData = {
  fetchedAt: string;
  source: string;
  broker: string;
  totals: {
    investedINR: number;
    currentINR: number;
    pnlINR: number;
    pnlPct: number;
    positionCount: number;
  };
  positions: USStock[];
};

type USSortKey = "value" | "pnlPct" | "pnlAbs" | "name";

function USStocksTab() {
  const openPerTicker = useOpenPerTicker();
  const [data, setData] = useState<USStocksData | null>(null);
  const [mtime, setMtime] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sort, setSort] = useState<USSortKey>("value");
  const [showUSD, setShowUSD] = useState(false);

  useEffect(() => {
    fetch("/api/usstocks")
      .then((r) => r.json())
      .then((r) => {
        if (r.data) {
          setData(r.data);
          setMtime(r.mtime ?? null);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Hide sold/zero-value positions — they live in the Decision tracker.
  const positions = (data?.positions ?? []).filter(
    (p) => (p.currentINR ?? 0) > 0 && (p.quantity ?? 0) > 0
  );
  const totals = data?.totals;

  const sorted = useMemo(() => {
    const list = positions.slice();
    list.sort((a, b) => {
      if (sort === "value") return b.currentINR - a.currentINR;
      if (sort === "pnlPct") return b.pnlPct - a.pnlPct;
      if (sort === "pnlAbs") return b.pnlINR - a.pnlINR;
      if (sort === "name") return a.ticker.localeCompare(b.ticker);
      return 0;
    });
    return list;
  }, [positions, sort]);

  const winners = positions.filter((p) => p.pnlINR > 0);
  const losers = positions.filter((p) => p.pnlINR < 0);
  const winnersTotal = winners.reduce((s, p) => s + p.pnlINR, 0);
  const losersTotal = losers.reduce((s, p) => s + p.pnlINR, 0);

  return (
    <div className="space-y-7">
      <PageHero
        title="US equity"
        info="US equity holdings via INDmoney INDstocks. INR values are FX-converted; USD prices and P&L are also available via the toggle."
        actions={<InvestButton scope="us-equity" scopeLabel="US equity" />}
        stale={(() => { const h = ageHoursFromISO(data?.fetchedAt); return h !== null ? { source: "INDmoney", ageHours: h } : null; })()}
      >
        {totals && (
          <>
            <CompactStat
              label="Current value"
              info="Sum of FX-converted current value across all US holdings."
              value={`₹${fmtINR(totals.currentINR)}`}
              sub={`${totals.positionCount} positions`}
            />
            <CompactStat
              label="Invested"
              info="Lifetime invested capital (INR), as INDmoney records it."
              value={`₹${fmtINR(totals.investedINR)}`}
            />
            <CompactStat
              label="Net P&L"
              info="Total realised + unrealised gain/loss in INR. Includes FX movement against USD entry rates."
              value={`${totals.pnlINR >= 0 ? "+" : "−"}₹${fmtINR(Math.abs(Math.round(totals.pnlINR)))}`}
              sub={fmtPct(totals.pnlPct, 2)}
              accent={totals.pnlINR >= 0 ? "pos" : "neg"}
            />
            <CompactStat
              label="Winners vs losers"
              info="Aggregate ₹ gain from positive positions vs aggregate ₹ loss from red positions. Two big drag positions can mask an otherwise strong book."
              value={`${winners.length} / ${losers.length}`}
              sub={`+₹${fmtINR(Math.round(winnersTotal))} · −₹${fmtINR(Math.abs(Math.round(losersTotal)))}`}
            />
          </>
        )}
      </PageHero>

      <Toolbar className="px-3 md:px-5">
        <ToolbarGroup>
          <Segmented<USSortKey>
            ariaLabel="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "value", label: "Value" },
              { value: "pnlPct", label: "P&L %" },
              { value: "pnlAbs", label: "P&L ₹" },
              { value: "name", label: "Ticker" },
            ]}
          />
        </ToolbarGroup>
        <div className="ml-auto">
          <ToolbarGroup>
            <button
              onClick={() => setShowUSD((v) => !v)}
              className="text-[12px] px-3.5 py-1.5 rounded-md border border-subtle hover:bg-subtle text-secondary"
            >
              {showUSD ? "Show INR" : "Show USD"}
            </button>
          </ToolbarGroup>
        </div>
      </Toolbar>

      {loaded && positions.length === 0 && (
        <div className="surface rounded-lg p-6 text-center text-tertiary text-sm">
          No US stocks data found. Run <code className="mono-true">/portfolio-check</code> after connecting INDmoney to refresh.
        </div>
      )}

      {sorted.length > 0 && (
        <section>
          <ul key={`${sort}-${showUSD}`} className="list-stagger">
            {sorted.map((p, i) => (
              <li key={p.ticker} style={{ ["--idx" as string]: i }}>
                <USStockRow
                  p={p}
                  showUSD={showUSD}
                  onOpen={() =>
                    openPerTicker({ ticker: p.ticker, market: "US" })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <SmartMoneyPanel />
    </div>
  );
}

function pctCls(n: number | undefined) {
  if (n === undefined) return "text-tertiary";
  if (n > 0) return "text-pos";
  if (n < 0) return "text-neg";
  return "text-secondary";
}

function USStockRow({
  p,
  showUSD,
  onOpen,
}: {
  p: USStock;
  showUSD: boolean;
  onOpen?: () => void;
}) {
  const meta = getMeta(p.ticker);
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      className="relative w-[calc(100%+3rem)] md:w-[calc(100%+5rem)] grid grid-cols-[40px_1fr_70px_70px] md:grid-cols-[40px_1fr_100px_100px_70px] -mx-6 md:-mx-10 gap-x-3 items-center py-5 px-10 md:px-16 transition-colors hover:bg-[var(--bg-subtle)] cursor-pointer accent-ring after:content-[''] after:absolute after:bottom-0 after:left-[92px] md:after:left-[116px] after:right-10 md:after:right-16 after:h-px after:bg-[var(--border)]"
    >
      <LogoImg ticker={p.ticker} domain={meta.domain} size={36} />

      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-tight text-primary truncate">
          {p.ticker}
        </div>
        <div className="text-[11px] text-tertiary truncate leading-tight mt-0.5">
          {p.kind === "etf" ? "ETF · " : ""}
          {p.name}
        </div>
      </div>

      {/* Value */}
      <div className="hidden md:block text-right mono text-[14px] font-semibold text-primary">
        {showUSD
          ? `$${(p.currentPriceUSD * p.quantity).toFixed(0)}`
          : `₹${fmtINR(Math.round(p.currentINR))}`}
      </div>

      {/* Today (US doesn't ship a daily delta — leave em-dash so columns line up) */}
      <div className="text-right text-[13px] mono font-medium text-tertiary">
        —
      </div>

      {/* Total P&L (always rightmost) */}
      <div className={`text-right text-[13px] mono font-medium ${pctCls(p.pnlPct)}`}>
        {fmtPct(p.pnlPct, 1)}
      </div>
    </div>
  );
}

// ---------- Stock research (Ideas + Analysis combined) ----------

type StockResearchView = "ideas" | "analysis";

function StockResearchTab() {
  return <IndianResearchUnified />;
}

type UnifiedCandidate = {
  ticker: string;
  name: string;
  sources: ("watchlist" | "scan" | "megatrend" | "holding")[];
  score: number; // 0-10
  confidence?: string;
  sector?: string;
  megatrend?: string;
  thesis?: string;
  decision?: string;
  status?: string;
  lastSeen?: string;
  // raw refs for the detail modal — union of all available data
  watch?: WatchlistEntry;
  scan?: MultibaggerEntry;
  analysis?: AnalysisCandidate;
  holding?: Holding;
};

const CONFIDENCE_TO_SCORE: Record<string, number> = {
  HIGH: 8.5,
  "HIGH-MEDIUM": 7.5,
  "MEDIUM-HIGH": 7,
  MEDIUM: 5,
  "MEDIUM-LOW": 3.5,
  "LOW-MEDIUM": 3.5,
  LOW: 2,
};

function shortConfidence(s?: string): string {
  if (!s) return "";
  return s
    .replace(/\s*[—–]\s.*$/u, "")
    .replace(/\s*\(.*$/u, "")
    .trim();
}

function confidenceToScore(c?: string): number | undefined {
  if (!c) return undefined;
  const k = c.toUpperCase().trim();
  for (const key of Object.keys(CONFIDENCE_TO_SCORE)) {
    if (k.startsWith(key)) return CONFIDENCE_TO_SCORE[key];
  }
  return undefined;
}

// Plain-English overrides for analysis megatrend ids/labels and for the
// raw sectorTailwind values that can come from holdings/watchlist. Anything
// not in the map falls through to its original label.
const TREND_LABEL: Record<string, string> = {
  ai_dc_power: "AI infrastructure",
  "AI / DC power": "AI infrastructure",
  defense: "Defense",
  "Defense indigenization": "Defense",
  grid: "Power & grid",
  "Power T&D / grid": "Power & grid",
  ev_battery: "EVs & batteries",
  "EV / Li-ion ecosystem": "EVs & batteries",
  specialty_chem: "Specialty chemicals",
  "Specialty chem / CDMO": "Specialty chemicals",
  industrial_capex: "Industrial capex",
  "Industrial capex": "Industrial capex",
  premium_consumption: "Premium consumption",
  "Premium / financialization": "Premium consumption",
};

function prettyTrend(label?: string): string {
  if (!label) return "Other";
  return TREND_LABEL[label] ?? label;
}

// Decisions that should not pollute the candidate list / distribution.
const TRASH_DECISIONS = new Set(["PASS", "PRUNE", "DEMOTE"]);

function bucketLabel(u: { megatrend?: string; sector?: string }): string {
  if (u.megatrend) return prettyTrend(u.megatrend);
  if (u.sector) return prettyTrend(u.sector);
  return "Other";
}

const TREND_FALLBACK_PALETTE = [
  "#0ea5e9",
  "#14b8a6",
  "#a855f7",
  "#f97316",
  "#84cc16",
  "#eab308",
  "#22c55e",
  "#ef4444",
];
function colorForTrend(label: string, megatrends: Megatrend[]): string {
  for (const m of megatrends) {
    if (prettyTrend(m.label) === label) return m.color;
  }
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return TREND_FALLBACK_PALETTE[Math.abs(h) % TREND_FALLBACK_PALETTE.length];
}

function IndianResearchUnified() {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [multibaggers, setMultibaggers] = useState<MultibaggerEntry[]>([]);
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [analysisMtime, setAnalysisMtime] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [activeTrend, setActiveTrend] = useState<string | null>(null);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "holding" | "watchlist" | "scan" | "megatrend"
  >("all");
  const [sort, setSort] = useState<"score" | "ticker" | "sector" | "lastSeen" | "source">(
    "score"
  );
  const [scoreFilter, setScoreFilter] = useState<"all" | "buy" | "watch" | "low">(
    "all"
  );
  const [includeHoldings, setIncludeHoldings] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [openTicker, setOpenTicker] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/watchlist").then((r) => r.json()).catch(() => ({})),
      fetch("/api/multibaggers").then((r) => r.json()).catch(() => ({})),
      fetch("/api/analysis").then((r) => r.json()).catch(() => ({})),
      fetch("/api/snapshot").then((r) => r.json()).catch(() => ({})),
    ]).then(([w, m, a, s]) => {
      setWatchlist((w.entries ?? []).filter((e: WatchlistEntry) => e.status === "active"));
      setMultibaggers(m.entries ?? []);
      setScanDate(m.date ?? null);
      setAnalysis(a.data ?? null);
      setAnalysisMtime(a.mtime ?? null);
      const snapHoldings: Holding[] = (s?.data?.holdings ?? []).filter(
        (h: Holding) =>
          (h.market || "IN") === "IN" && getMeta(h.ticker).asset !== "bond"
      );
      setHoldings(snapHoldings);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unified = useMemo<UnifiedCandidate[]>(() => {
    const map = new Map<string, UnifiedCandidate>();
    const upsert = (
      ticker: string,
      patch: Partial<UnifiedCandidate> & { source: UnifiedCandidate["sources"][number] }
    ) => {
      const meta = getMeta(ticker);
      const existing = map.get(ticker);
      if (!existing) {
        map.set(ticker, {
          ticker,
          name: patch.name ?? meta.name ?? ticker,
          sources: [patch.source],
          score: patch.score ?? 0,
          confidence: patch.confidence,
          sector: patch.sector ?? meta.sector,
          megatrend: patch.megatrend,
          thesis: patch.thesis,
          decision: patch.decision,
          status: patch.status,
          lastSeen: patch.lastSeen,
          watch: patch.watch,
          scan: patch.scan,
          analysis: patch.analysis,
        });
      } else {
        if (!existing.sources.includes(patch.source)) existing.sources.push(patch.source);
        if ((patch.score ?? 0) > existing.score) existing.score = patch.score!;
        existing.megatrend ??= patch.megatrend;
        existing.confidence ??= patch.confidence;
        existing.sector ??= patch.sector ?? meta.sector;
        existing.decision ??= patch.decision;
        existing.status ??= patch.status;
        const newThesis = patch.thesis ?? "";
        const oldThesis = existing.thesis ?? "";
        if (newThesis.length > oldThesis.length) existing.thesis = newThesis;
        if (patch.lastSeen && patch.lastSeen > (existing.lastSeen ?? "")) {
          existing.lastSeen = patch.lastSeen;
        }
        existing.watch ??= patch.watch;
        existing.scan ??= patch.scan;
        existing.analysis ??= patch.analysis;
      }
    };

    for (const w of watchlist) {
      upsert(w.ticker, {
        source: "watchlist",
        name: w.company,
        score: confidenceToScore(w.confidence) ?? 5,
        confidence: w.confidence,
        sector: w.sectorTailwind,
        thesis: w.thesis,
        lastSeen: w.added,
        watch: w,
      });
    }
    for (const m of multibaggers) {
      upsert(m.ticker, {
        source: "scan",
        name: m.company,
        score: confidenceToScore(m.confidence) ?? 5,
        confidence: m.confidence,
        thesis: m.bullCase,
        lastSeen: scanDate ?? undefined,
        scan: m,
      });
    }
    if (analysis) {
      for (const c of analysis.candidates) {
        if (TRASH_DECISIONS.has(c.decision)) continue;
        const trend = analysis.megatrends.find((t) => t.id === c.megatrend);
        upsert(c.ticker, {
          source: "megatrend",
          name: c.name,
          score: c.patternScore,
          megatrend: prettyTrend(trend?.label ?? c.megatrend),
          thesis: c.moat,
          decision: c.decision,
          status: c.status,
          lastSeen: analysisMtime ? analysisMtime.slice(0, 10) : undefined,
          analysis: c,
        });
      }
    }
    for (const h of holdings) {
      const meta = getMeta(h.ticker);
      // Held position score: confident green = 8, amber = 6, red = 4, no flag = 6.5
      const score =
        h.thesisHealth === "green"
          ? 8
          : h.thesisHealth === "amber"
          ? 6
          : h.thesisHealth === "red"
          ? 4
          : 6.5;
      upsert(h.ticker, {
        source: "holding",
        name: meta.name ?? h.ticker,
        score,
        sector: meta.sector,
        thesis: h.thesisNote,
        decision: h.role,
        holding: h,
      });
    }
    return [...map.values()];
  }, [watchlist, multibaggers, scanDate, analysis, analysisMtime, holdings]);

  const filtered = useMemo(() => {
    let list = unified;
    if (!includeHoldings) {
      // Once bought, a name leaves the ideas list — regardless of whether
      // it also shows up in watchlist/scan/megatrend. Surface only via
      // the "Include holdings" toggle.
      list = list.filter((u) => !u.sources.includes("holding"));
    }
    if (sourceFilter !== "all") {
      list = list.filter((u) => u.sources.includes(sourceFilter));
    }
    if (activeTrend) {
      list = list.filter((u) => bucketLabel(u) === activeTrend);
    }
    if (scoreFilter === "buy") list = list.filter((u) => u.score >= SCORE_BANDS.buyMin);
    else if (scoreFilter === "watch")
      list = list.filter((u) => u.score >= SCORE_BANDS.watchMin && u.score < SCORE_BANDS.watchMax);
    else if (scoreFilter === "low") list = list.filter((u) => u.score < SCORE_BANDS.lowMax);
    list = [...list].sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "sector")
        return (a.sector || "").localeCompare(b.sector || "");
      if (sort === "lastSeen")
        return (b.lastSeen || "").localeCompare(a.lastSeen || "");
      if (sort === "source") {
        const order = (u: UnifiedCandidate) =>
          u.sources.includes("watchlist") ? 0 : u.sources.includes("scan") ? 1 : 2;
        return order(a) - order(b);
      }
      return 0;
    });
    return list;
  }, [unified, sourceFilter, activeTrend, sort, scoreFilter, includeHoldings, analysis]);

  return (
    <div className="space-y-8">
      <PageHero
        title="Indian equity research"
        info="Sector / trend mix across every idea below — holdings, watchlist, weekly scan, and megatrend candidates combined. Click a row to filter the list."      />

      <section className="space-y-4">
        <Toolbar className="px-3 md:px-5">
          <ToolbarGroup>
            <div className="flex items-center gap-3 flex-wrap">
            {(() => {
              const anyActive =
                activeTrend !== null ||
                scoreFilter !== "all" ||
                sourceFilter !== "all" ||
                includeHoldings;
              return (
                <div
                  aria-hidden={!anyActive}
                  className="overflow-hidden flex items-center"
                  style={{
                    maxWidth: anyActive ? 30 : 0,
                    opacity: anyActive ? 1 : 0,
                    transform: anyActive ? "scale(1)" : "scale(0.7)",
                    marginRight: anyActive ? 0 : -12,
                    transition:
                      "max-width 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), margin-right 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                    pointerEvents: anyActive ? "auto" : "none",
                  }}
                >
                  <button
                    type="button"
                    aria-label="Clear filters"
                    onClick={() => {
                      setActiveTrend(null);
                      setScoreFilter("all");
                      setSourceFilter("all");
                      setIncludeHoldings(false);
                    }}
                    className="w-[26px] h-[26px] rounded-full transition-colors accent-ring inline-flex items-center justify-center text-secondary hover:text-primary shrink-0"
                    style={{ background: "var(--bg-subtle)" }}
                    title="Clear filters"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })()}
            <FilterDropdown
              label="Trend"
              ariaLabel="Filter by trend"
              value={activeTrend ?? "__all__"}
              onChange={(v) => setActiveTrend(v === "__all__" ? null : v)}
              defaultValue="__all__"
              options={(() => {
                const buckets = new Map<string, number>();
                for (const u of unified) {
                  const k = bucketLabel(u);
                  buckets.set(k, (buckets.get(k) ?? 0) + 1);
                }
                const sortedTrends = [...buckets.entries()]
                  .map(([label, count]) => ({ label, count }))
                  .sort((a, b) => b.count - a.count);
                return [
                  { value: "__all__", label: "All trends" },
                  ...sortedTrends.map((t) => ({
                    value: t.label,
                    label: t.label,
                    count: t.count,
                    hint: trendExplainer(t.label, analysis?.megatrends ?? []),
                  })),
                ];
              })()}
            />
            <FilterDropdown
              label="Score"
              ariaLabel="Filter by score"
              value={scoreFilter}
              onChange={setScoreFilter}
              defaultValue="all"
              options={[
                { value: "all", label: "All" },
                { value: "buy", label: "Buy zone (>=6)" },
                { value: "watch", label: "Watch (4.5 - 6)" },
                { value: "low", label: "Low (<4.5)" },
              ]}
            />
            <FilterDropdown
              label="Source"
              ariaLabel="Filter by source"
              value={sourceFilter}
              onChange={setSourceFilter}
              defaultValue="all"
              options={[
                { value: "all", label: "All sources" },
                { value: "watchlist", label: "Watchlist" },
                { value: "scan", label: "Scan" },
                { value: "megatrend", label: "Megatrend" },
              ]}
            />
            <TogglePill
              label="Include holdings"
              active={includeHoldings}
              onToggle={() => setIncludeHoldings((v) => !v)}
            />
            </div>
          </ToolbarGroup>
          <div className="ml-auto">
            <ToolbarGroup>
              <Segmented
                ariaLabel="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "score", label: "Score" },
                  { value: "lastSeen", label: "Last seen" },
                ]}
              />
            </ToolbarGroup>
          </div>
        </Toolbar>

        {loaded && filtered.length === 0 && (
          <EmptyState
            message={
              unified.length === 0
                ? "No research data yet. Run /portfolio-check to populate."
                : "No candidates match the current filter."
            }
          />
        )}

        <section>
          <ul
            key={`${sourceFilter}-${sort}-${activeTrend ?? "all"}`}
            className="list-stagger"
          >
            {filtered.map((c, i) => (
              <li key={c.ticker} style={{ ["--idx" as string]: i }}>
                <UnifiedCandidateRow
                  c={c}
                  onOpen={() => setOpenTicker(c.ticker)}
                />
              </li>
            ))}
          </ul>
        </section>
      </section>

      <ScoringLegend kind="in" />

      {openTicker && (() => {
        const c = unified.find((u) => u.ticker === openTicker);
        if (!c) return null;
        return (
          <UnifiedCandidateModal
            candidate={c}
            megatrends={analysis?.megatrends ?? []}
            onClose={() => setOpenTicker(null)}
          />
        );
      })()}
    </div>
  );
}

function UnifiedCandidateRow({
  c,
  onOpen,
}: {
  c: UnifiedCandidate;
  onOpen: () => void;
}) {
  const meta = getMeta(c.ticker);
  const scoreCls =
    c.score >= 7
      ? "text-pos"
      : c.score >= 4
      ? "text-warn"
      : "text-tertiary";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left relative w-[calc(100%+3rem)] md:w-[calc(100%+5rem)] grid grid-cols-[40px_1fr_90px_60px] md:grid-cols-[40px_1fr_110px_60px] -mx-6 md:-mx-10 gap-x-3 items-center py-5 px-10 md:px-16 transition-colors hover:bg-[var(--bg-subtle)] accent-ring after:content-[''] after:absolute after:bottom-0 after:left-[92px] md:after:left-[116px] after:right-10 md:after:right-16 after:h-px after:bg-[var(--border)]"
    >
      <LogoImg ticker={c.ticker} domain={meta.domain} size={36} />

      <div className="min-w-0">
        <div className="font-semibold mono leading-tight text-primary text-[13px] truncate">
          {c.ticker}
        </div>
        <div className="text-[11px] text-tertiary truncate leading-tight mt-0.5">
          {c.sector || meta.sector || c.megatrend || meta.name}
        </div>
      </div>

      <div className="text-right text-[11.5px] mono text-tertiary truncate min-w-0">
        {shortConfidence(c.confidence) || shortConfidence(c.decision) || "—"}
      </div>

      <div className={`text-right text-[14px] mono font-semibold ${scoreCls}`}>
        {c.score.toFixed(1)}
      </div>
    </button>
  );
}

function UnifiedCandidateModal({
  candidate,
  megatrends,
  onClose,
}: {
  candidate: UnifiedCandidate;
  megatrends: Megatrend[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const meta = getMeta(candidate.ticker);
  const company = candidate.name || meta.name;
  const mt = candidate.analysis?.megatrend
    ? megatrends.find((m) => m.id === candidate.analysis!.megatrend)
    : undefined;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start gap-4 pb-5">
          <LogoImg ticker={candidate.ticker} domain={meta.domain} size={56} rounded="xl" />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold mono-true text-primary">
              {candidate.ticker}
            </div>
            <div className="text-sm text-secondary">{company}</div>
            {candidate.sector && (
              <div className="text-[11px] text-tertiary mt-0.5">{candidate.sector}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <section
          className="pt-5 mt-1"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="text-[11px] font-medium text-tertiary mb-4">At a glance</div>
          <div className="grid grid-cols-3 gap-x-5 gap-y-4">
            <div>
              <div className="text-[11px] text-tertiary mb-1">Score</div>
              <div className="mono-true text-[13px] font-medium text-primary">
                {candidate.score > 0 ? `${candidate.score.toFixed(1)} / 10` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-tertiary mb-1">Sources</div>
              <div className="flex items-center gap-1 flex-wrap">
                {candidate.sources.map((s) => (
                  <Tag
                    key={s}
                    label={
                      s === "watchlist" ? "Watchlist" : s === "scan" ? "Scan" : "Megatrend"
                    }
                    tone={s === "watchlist" ? "info" : s === "scan" ? "warn" : "pos"}
                  />
                ))}
              </div>
            </div>
            {candidate.confidence && (
              <IdeaStat label="Confidence" value={candidate.confidence} />
            )}
            {(mt?.label || candidate.megatrend) && (
              <IdeaStat label="Megatrend" value={mt?.label || candidate.megatrend!} />
            )}
            {candidate.lastSeen && (
              <IdeaStat label="Last seen" value={candidate.lastSeen} mono />
            )}
            {candidate.scan?.cmp && (
              <IdeaStat label="CMP" value={candidate.scan.cmp} mono />
            )}
            {candidate.scan?.marketCap && (
              <IdeaStat label="Mcap" value={candidate.scan.marketCap} mono />
            )}
            {candidate.scan?.horizon && (
              <IdeaStat label="Horizon" value={candidate.scan.horizon} />
            )}
          </div>
        </section>

        {candidate.watch?.thesis && (
          <section
            className="pt-5 mt-5"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="text-[11px] font-medium text-tertiary mb-3">
              Watchlist thesis
            </div>
            <p className="text-[13px] text-secondary leading-relaxed">
              {candidate.watch.thesis}
            </p>
            {candidate.watch.entryTrigger && (
              <p className="text-[12px] text-tertiary mt-2 leading-relaxed">
                <span className="text-tertiary">Entry trigger: </span>
                {candidate.watch.entryTrigger}
              </p>
            )}
          </section>
        )}

        {candidate.scan?.bullCase && (
          <section
            className="pt-5 mt-5"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="text-[11px] font-medium text-tertiary mb-3">
              Scan bull case
            </div>
            <p className="text-[13px] text-secondary leading-relaxed">
              {candidate.scan.bullCase}
            </p>
            {candidate.scan.risk && (
              <p className="text-[12px] text-tertiary mt-2 leading-relaxed">
                <span className="text-tertiary">Risk: </span>
                {candidate.scan.risk}
              </p>
            )}
            {candidate.scan.entryZone && (
              <p className="text-[12px] text-tertiary mt-1 leading-relaxed">
                <span className="text-tertiary">Entry zone: </span>
                {candidate.scan.entryZone}
              </p>
            )}
          </section>
        )}

        {candidate.analysis && (
          <section
            className="pt-5 mt-5"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="text-[11px] font-medium text-tertiary mb-3">
              7-check framework
            </div>
            <div className="space-y-2 text-[12.5px] text-secondary leading-relaxed">
              {candidate.analysis.moat && (
                <div>
                  <span className="text-tertiary">Moat: </span>
                  {candidate.analysis.moat}
                </div>
              )}
              {candidate.analysis.orderBook && (
                <div>
                  <span className="text-tertiary">Order book: </span>
                  {candidate.analysis.orderBook}
                </div>
              )}
              {candidate.analysis.earnings && (
                <div>
                  <span className="text-tertiary">Earnings: </span>
                  {candidate.analysis.earnings}
                </div>
              )}
              {candidate.analysis.valuation && (
                <div>
                  <span className="text-tertiary">Valuation: </span>
                  {candidate.analysis.valuation}
                </div>
              )}
              {candidate.analysis.riskFlag && (
                <div>
                  <span className="text-tertiary">Risk flag: </span>
                  {candidate.analysis.riskFlag}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[11px] text-tertiary">Decision:</span>
              {decisionBadge(candidate.analysis.decision)}
            </div>
          </section>
        )}

        <a
          href={`https://www.screener.in/company/${candidate.ticker}/consolidated/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[var(--brand)] hover:underline mt-6 inline-block"
        >
          View full profile on screener.in →
        </a>
      </div>
    </div>,
    document.body
  );
}

// ---------- US research ----------

const US_SECTOR_MAP: Record<string, string> = {
  NKE: "Consumer",
  AMZN: "Consumer Internet",
  RIVN: "EV / Auto",
  ABT: "Healthcare",
  AAPL: "Mega-cap Tech",
  BOTZ: "Thematic AI/Robotics",
  BA: "Industrials",
  NVDA: "Semis",
  PLTR: "AI Infrastructure",
  GOOGL: "Mega-cap Tech",
  SHOP: "Consumer Internet",
  MELI: "LATAM E-commerce",
  LLY: "Healthcare",
  TSM: "Semis",
  PANW: "Cybersecurity",
  ASML: "Semi Equipment",
};

type USTrimRow = {
  ticker: string;
  name: string;
  reason: "Reassess" | "Trim" | "Concentration";
  weightPct?: number;
  pnlPct?: number;
  suggestion: string;
};


function classifyVerdict(s: number): Verdict {
  if (s >= 7) return "Buy";
  if (s >= 5) return "Watch";
  return "Avoid";
}

function verdictTone(v: Verdict): TagTone {
  if (v === "Buy") return "pos";
  if (v === "Watch") return "warn";
  return "neg";
}

function tagTone(_t: CouncilTag): TagTone {
  return "neutral";
}
function USResearchTab() {
  const [data, setData] = useState<USStocksData | null>(null);
  const [, setLoaded] = useState(false);
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [includeHoldings, setIncludeHoldings] = useState(false);
  const [sort, setSort] = useState<"score" | "ticker">("score");
  const [usCandidates, setUsCandidates] = useState<USCandidate[]>([]);
  useEffect(() => {
    fetch("/api/research/us")
      .then((r) => r.json())
      .then((d) => setUsCandidates(d.entries ?? []))
      .catch(() => setUsCandidates([]));
  }, []);

  useEffect(() => {
    fetch("/api/usstocks")
      .then((r) => r.json())
      .then((r) => {
        if (r.data) setData(r.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const positions = data?.positions ?? [];
  const totalValue = data?.totals?.currentINR ?? 0;

  const sectorBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const p of positions) {
      const sector = US_SECTOR_MAP[p.ticker] ?? "Other";
      buckets[sector] = (buckets[sector] ?? 0) + p.currentINR;
    }
    return Object.entries(buckets)
      .map(([sector, value]) => ({
        sector,
        value,
        pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [positions, totalValue]);

  const heldTickers = new Set(positions.map((p) => p.ticker));
  const heldAsCandidates: USCandidate[] = useMemo(
    () =>
      positions.map((p) => {
        const existing = usCandidates.find((c) => c.ticker === p.ticker);
        if (existing) return existing;
        return {
          ticker: p.ticker,
          name: p.name,
          sector: US_SECTOR_MAP[p.ticker] ?? "Other",
          thesis: "Currently held in your US book.",
          whyNow: "—",
          score: 5,
          confidence: "MEDIUM" as const,
          verdict: "Watch" as Verdict,
          tags: [] as CouncilTag[],
        };
      }),
    [positions, usCandidates]
  );
  const baseCandidates: USCandidate[] = includeHoldings
    ? [
        ...heldAsCandidates,
        ...usCandidates.filter((c) => !heldTickers.has(c.ticker)),
      ]
    : usCandidates.filter((c) => !heldTickers.has(c.ticker));
  const filteredRaw =
    sectorFilter === "all"
      ? baseCandidates
      : baseCandidates.filter((c) => c.sector === sectorFilter);
  const filtered = useMemo(() => {
    return [...filteredRaw].sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      return a.ticker.localeCompare(b.ticker);
    });
  }, [filteredRaw, sort]);
  const candidates = baseCandidates;

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates) m.set(c.sector, (m.get(c.sector) ?? 0) + 1);
    return [...m.entries()]
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count);
  }, [candidates]);

  return (
    <div className="space-y-8">
      <PageHero
        title="US equity research"
        info="Sector concentration view of your US book and a curated add-candidate list. Review before deploying USD cash."      />

      <section className="space-y-4">
        <Toolbar className="px-3 md:px-5">
          <ToolbarGroup>
            <div className="flex items-center gap-3 flex-wrap">
              {(() => {
                const anyActive = sectorFilter !== "all" || includeHoldings;
                return (
                  <div
                    aria-hidden={!anyActive}
                    className="overflow-hidden flex items-center"
                    style={{
                      maxWidth: anyActive ? 30 : 0,
                      opacity: anyActive ? 1 : 0,
                      transform: anyActive ? "scale(1)" : "scale(0.7)",
                      marginRight: anyActive ? 0 : -12,
                      transition:
                        "max-width 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), margin-right 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                      pointerEvents: anyActive ? "auto" : "none",
                    }}
                  >
                    <button
                      type="button"
                      aria-label="Clear filters"
                      onClick={() => {
                        setSectorFilter("all");
                        setIncludeHoldings(false);
                      }}
                      className="w-[26px] h-[26px] rounded-full transition-colors accent-ring inline-flex items-center justify-center text-secondary hover:text-primary shrink-0"
                      style={{ background: "var(--bg-subtle)" }}
                      title="Clear filters"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })()}
              <FilterDropdown
                label="Sector"
                ariaLabel="Filter by sector"
                value={sectorFilter}
                onChange={setSectorFilter}
                defaultValue="all"
                options={[
                  { value: "all", label: "All sectors" },
                  ...sectorCounts.map((s) => ({
                    value: s.sector,
                    label: s.sector,
                    count: s.count,
                  })),
                ]}
              />
              <TogglePill
                label="Include holdings"
                active={includeHoldings}
                onToggle={() => setIncludeHoldings((v) => !v)}
              />
            </div>
          </ToolbarGroup>
          <div className="ml-auto">
            <ToolbarGroup>
              <Segmented
                ariaLabel="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "score", label: "Score" },
                  { value: "ticker", label: "A - Z" },
                ]}
              />
            </ToolbarGroup>
          </div>
        </Toolbar>

        {filtered.length === 0 ? (
          <EmptyState
            message={
              usCandidates.length === 0 && positions.length === 0
                ? "No US research data yet. Run /portfolio-check to populate."
                : "No candidates match the current filter."
            }
          />
        ) : (
          <ul
            key={`${sectorFilter}-${sort}`}
            className="list-stagger px-3 md:px-5"
          >
            {filtered.map((c, i) => (
              <li key={c.ticker} style={{ ["--idx" as string]: i }}>
                <USCandidateRow c={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ScoringLegend kind="us" />
    </div>
  );
}

function USTrimQueueRow({ r }: { r: USTrimRow }) {
  const tone: TagTone =
    r.reason === "Reassess" ? "neg" : r.reason === "Trim" ? "warn" : "info";
  const label =
    r.reason === "Reassess" ? "Reassess" : r.reason === "Trim" ? "Trim" : "Concentration";
  return (
    <div className="relative grid grid-cols-[40px_1fr_auto] gap-x-3 items-center py-5 px-1 after:content-[''] after:absolute after:bottom-0 after:left-[52px] after:right-1 after:h-px after:bg-[var(--border)]">
      <LogoImg ticker={r.ticker} domain={getMeta(r.ticker).domain} size={36} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="mono-true text-[12.5px] font-semibold text-primary">
            {r.ticker}
          </span>
          <span className="text-[11.5px] text-tertiary truncate">{r.name}</span>
          <Tag label={label} tone={tone} />
        </div>
        <div className="text-[12px] text-secondary leading-snug">{r.suggestion}</div>
      </div>
      <div className="text-right shrink-0">
        {r.pnlPct !== undefined && (
          <div className={`mono-true text-[12.5px] tabular-nums ${pctCls(r.pnlPct)}`}>
            {r.pnlPct >= 0 ? "+" : ""}
            {r.pnlPct.toFixed(1)}%
          </div>
        )}
        {r.weightPct !== undefined && (
          <div className="text-[10.5px] text-tertiary mono-true tabular-nums mt-0.5">
            {r.weightPct.toFixed(1)}% of book
          </div>
        )}
      </div>
    </div>
  );
}

function TogglePill({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-colors accent-ring inline-flex items-center ${
        active ? "text-primary" : "text-secondary hover:text-primary"
      }`}
      style={{
        background: active ? "var(--brand-tint)" : "var(--bg-subtle)",
        boxShadow: active ? "inset 0 0 0 1px var(--brand)" : undefined,
      }}
    >
      {label}
    </button>
  );
}

type ScoringKind = "in" | "us" | "mf";

const SCORING_CRITERIA: Record<
  ScoringKind,
  { label: string; hint: string }[]
> = {
  in: [
    {
      label: "Business quality",
      hint: "Moat, pricing power, return on capital across cycles.",
    },
    {
      label: "Earnings visibility",
      hint: "Order book, capacity utilisation, guide-able next 4 quarters.",
    },
    {
      label: "Management track record",
      hint: "Promoter quality, capital allocation, governance flags.",
    },
    {
      label: "Balance sheet",
      hint: "Net debt, working-capital cycle, free cash flow conversion.",
    },
    {
      label: "Valuation",
      hint: "P/E, EV/EBITDA, PEG vs Indian peers and own history.",
    },
    {
      label: "Catalyst",
      hint: "Earnings event, capex commissioning, or order win in 1 - 4 quarters.",
    },
    {
      label: "Megatrend tailwind",
      hint: "Defense, AI infra, EMS, power capex - structural multi-year theme.",
    },
    {
      label: "Risk flags",
      hint: "Regulatory, single-customer, related-party, or cycle exposure.",
    },
    {
      label: "Portfolio fit",
      hint: "Fills a sector / cap gap rather than duplicating existing exposure.",
    },
    {
      label: "Liquidity",
      hint: "Float and ADV - can you build / exit a position cleanly.",
    },
  ],
  us: [
    {
      label: "Fundamental (30%)",
      hint: "Business moat, recent earnings trajectory, balance sheet, FCF, capital allocation, valuation vs sector and history.",
    },
    {
      label: "Macro (25%)",
      hint: "Sector cycle position, secular megatrend exposure (AI capex, GLP-1, foundry, cybersecurity), regulatory / capex tailwinds.",
    },
    {
      label: "Risk (20%)",
      hint: "Drawdown potential, customer concentration, geopolitical / FX, antitrust, valuation air-pocket. Higher score = lower risk.",
    },
    {
      label: "Technical (15%)",
      hint: "Trend, distance from 52-week high, 50/200-DMA position, RSI band, breakout / breakdown.",
    },
    {
      label: "Sentiment (10%)",
      hint: "Analyst revisions, retail crowdedness, narrative momentum, contrarian-vs-consensus read.",
    },
  ],
  mf: [
    {
      label: "Long-term performance",
      hint: "5 - 7Y CAGR vs category benchmark, not just trailing 1Y.",
    },
    {
      label: "Rolling-return consistency",
      hint: "How often the fund beats benchmark across rolling windows.",
    },
    {
      label: "Downside capture",
      hint: "Drawdown behaviour and recovery vs category in down markets.",
    },
    {
      label: "Expense ratio (TER)",
      hint: "Direct-plan TER drag compounded over the holding period.",
    },
    {
      label: "Manager & process",
      hint: "Manager tenure, process discipline, style drift risk.",
    },
    {
      label: "AUM vs strategy",
      hint: "Capacity fit - small-cap funds get punished by bloated AUM.",
    },
    {
      label: "Portfolio overlap",
      hint: "Top-10 overlap with funds you already hold - avoid paying twice.",
    },
    {
      label: "Category fit",
      hint: "Fills a gap (small-cap / international / debt) the book is missing.",
    },
    {
      label: "Tax efficiency",
      hint: "Equity vs debt taxation, ELSS lock-in, indexation eligibility.",
    },
    {
      label: "Exit mechanics",
      hint: "Exit load window, redemption timing, lock-in - real liquidity cost.",
    },
  ],
};

const VERDICT_BANDS: { label: Verdict; range: string; tone: TagTone }[] = [
  { label: "Buy", range: ">= 7.0", tone: "pos" },
  { label: "Watch", range: "5.0 - 6.9", tone: "warn" },
  { label: "Avoid", range: "< 5.0", tone: "neg" },
];

const CONFLICT_TAGS_DOC: { label: CouncilTag; hint: string }[] = [
  {
    label: "Hype Risk",
    hint: "Sentiment running hot while fundamentals lag - crowded narrative without earnings support.",
  },
  {
    label: "Early Opportunity",
    hint: "Fundamentals + macro strong but sentiment / coverage quiet - potential ahead of consensus.",
  },
  {
    label: "Value Trap",
    hint: "Fundamentals look healthy but technicals are weak - business is fine, market disagrees.",
  },
  {
    label: "Late Entry Risk",
    hint: "Technicals + sentiment euphoric while fundamentals don't justify - chasing the move.",
  },
];

function ScoringLegend({ kind }: { kind: ScoringKind }) {
  const [open, setOpen] = useState(false);
  const criteria = SCORING_CRITERIA[kind];
  const isCouncil = kind === "us";
  const title =
    kind === "in"
      ? "How Indian equity scoring works"
      : kind === "us"
      ? "How US equity scoring works"
      : "How mutual fund scoring works";
  const subtitle = isCouncil
    ? "A 5-seat council scores each idea 0-10. Each seat returns a score and a confidence (0-1). Final = sum of weight x score x confidence."
    : "Each idea is scored out of 10. One point each across these dimensions - higher total means higher conviction.";
  return (
    <>
      <section className="px-4 md:px-6 pt-2 pb-1 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11.5px] text-tertiary hover:text-primary transition-colors inline-flex items-center gap-1.5 accent-ring rounded-md"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          How scoring works
        </button>
      </section>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        maxWidth="max-w-xl"
      >
        <ol className="flex flex-col gap-3 text-[12.5px] text-secondary leading-snug list-none">
          {criteria.map((c, i) => (
            <li key={c.label} className="flex items-baseline gap-3">
              <span className="text-tertiary mono font-medium w-5 shrink-0 tabular-nums">
                {i + 1}.
              </span>
              <div className="min-w-0">
                <div className="text-primary font-medium">{c.label}</div>
                <div className="text-tertiary mt-0.5">{c.hint}</div>
              </div>
            </li>
          ))}
        </ol>
        {isCouncil && (
          <>
            <div className="mt-6 pt-5 border-t border-subtle">
              <div className="text-[12px] font-medium text-primary mb-3">
                Classification
              </div>
              <ul className="flex flex-col gap-2 text-[12px] text-secondary">
                {VERDICT_BANDS.map((b) => (
                  <li key={b.label} className="flex items-center gap-2">
                    <Tag label={b.label} tone={b.tone} />
                    <span className="text-tertiary mono">{b.range}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-6 pt-5 border-t border-subtle">
              <div className="text-[12px] font-medium text-primary mb-3">
                Conflict tags
              </div>
              <ul className="flex flex-col gap-3 text-[12px] text-secondary leading-snug">
                {CONFLICT_TAGS_DOC.map((t) => (
                  <li key={t.label} className="flex items-baseline gap-3">
                    <span className="shrink-0">
                      <Tag label={t.label} />
                    </span>
                    <span className="text-tertiary">{t.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <p className="text-[11px] text-tertiary mt-5 leading-snug">
          Score is a personal conviction read, not a quant ranking. It's a
          starting point for sizing, not a buy signal on its own.
        </p>
      </Modal>
    </>
  );
}

function USCandidateRow({ c }: { c: USCandidate }) {
  const scoreCls =
    c.score >= 7 ? "text-pos" : c.score >= 5 ? "text-warn" : "text-neg";
  const confCls = confidenceTone(c.confidence);
  return (
    <a
      href={`https://www.google.com/finance/quote/${c.ticker}:NASDAQ`}
      target="_blank"
      rel="noopener noreferrer"
      title={c.thesis}
      className="text-left relative w-[calc(100%+1.5rem)] md:w-[calc(100%+2.5rem)] grid grid-cols-[40px_1fr_100px_70px] md:grid-cols-[40px_1fr_120px_80px] -mx-3 md:-mx-5 gap-x-3 items-center py-5 px-4 md:px-6 transition-colors hover:bg-[var(--bg-subtle)] accent-ring after:content-[''] after:absolute after:bottom-0 after:left-[60px] md:after:left-[68px] after:right-4 md:after:right-6 after:h-px after:bg-[var(--border)]"
    >
      <LogoImg ticker={c.ticker} domain={getMeta(c.ticker).domain} size={36} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold mono-true text-primary text-[13px]">
            {c.ticker}
          </span>
          <span className="text-[12px] text-secondary truncate">{c.name}</span>
        </div>
        <div
          className="text-[11px] text-tertiary mt-1.5 leading-snug"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {c.sector} · {c.thesis}
        </div>
      </div>
      <div className={`text-right text-[12.5px] mono font-medium tabular-nums whitespace-nowrap ${confCls}`}>
        {c.confidence}
      </div>
      <div className={`text-right text-[14px] mono font-semibold tabular-nums ${scoreCls}`}>
        {c.score.toFixed(1)}
      </div>
    </a>
  );
}

// ---------- MF research ----------

type MFRotationItem = {
  scheme: string;
  amc: string;
  action: "Switch" | "Kill" | "Consolidate" | "Exit" | "Promote" | "Cap" | "Watch";
  reason: string;
  impact?: string;
};

// MF_ROTATIONS moved to memory/project_mf_rotations.json + served via /api/mfrotations.
// See useMFRotations() hook below for client-side fetch.

function useMFRotations(): MFRotationItem[] {
  const [rotations, setRotations] = useState<MFRotationItem[]>([]);
  useEffect(() => {
    fetch("/api/mfrotations")
      .then((r) => r.json())
      .then((r) => setRotations(r.rotations || []))
      .catch(() => {});
  }, []);
  return rotations;
}

function MFResearchTab() {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [includeHoldings, setIncludeHoldings] = useState(false);
  const [sort, setSort] = useState<"score" | "scheme">("score");
  const [mfCandidates, setMfCandidates] = useState<MFCandidate[]>([]);
  useEffect(() => {
    fetch("/api/research/mf")
      .then((r) => r.json())
      .then((d) => setMfCandidates(d.entries ?? []))
      .catch(() => setMfCandidates([]));
  }, []);
  const mfRotations = useMFRotations();

  const heldSchemes = useMemo<MFCandidate[]>(
    () =>
      mfRotations.map((r) => ({
        scheme: r.scheme,
        amc: r.amc,
        category: "Currently held",
        fiveYCagr: "—",
        thesis: r.reason,
        score: 5,
        confidence: "MEDIUM" as const,
      })),
    [mfRotations]
  );

  const baseCandidates = useMemo<MFCandidate[]>(
    () => (includeHoldings ? [...heldSchemes, ...mfCandidates] : mfCandidates),
    [includeHoldings, heldSchemes, mfCandidates]
  );

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of baseCandidates)
      m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return [...m.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [baseCandidates]);

  const filteredRaw =
    categoryFilter === "all"
      ? baseCandidates
      : baseCandidates.filter((c) => c.category === categoryFilter);
  const filtered = useMemo(() => {
    return [...filteredRaw].sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      return a.scheme.localeCompare(b.scheme);
    });
  }, [filteredRaw, sort]);

  return (
    <div className="space-y-8">
      <PageHero
        title="Mutual fund research"
        info="Curated funds to research by category, score, and conviction."      />

      <section className="space-y-4">
        <Toolbar className="px-3 md:px-5">
          <ToolbarGroup>
            <div className="flex items-center gap-3 flex-wrap">
              {(() => {
                const anyActive = categoryFilter !== "all" || includeHoldings;
                return (
                  <div
                    aria-hidden={!anyActive}
                    className="overflow-hidden flex items-center"
                    style={{
                      maxWidth: anyActive ? 30 : 0,
                      opacity: anyActive ? 1 : 0,
                      transform: anyActive ? "scale(1)" : "scale(0.7)",
                      marginRight: anyActive ? 0 : -12,
                      transition:
                        "max-width 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), margin-right 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                      pointerEvents: anyActive ? "auto" : "none",
                    }}
                  >
                    <button
                      type="button"
                      aria-label="Clear filters"
                      onClick={() => {
                        setCategoryFilter("all");
                        setIncludeHoldings(false);
                      }}
                      className="w-[26px] h-[26px] rounded-full transition-colors accent-ring inline-flex items-center justify-center text-secondary hover:text-primary shrink-0"
                      style={{ background: "var(--bg-subtle)" }}
                      title="Clear filters"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })()}
              <FilterDropdown
                label="Category"
                ariaLabel="Filter by category"
                value={categoryFilter}
                onChange={setCategoryFilter}
                defaultValue="all"
                options={[
                  { value: "all", label: "All categories" },
                  ...categoryCounts.map((c) => ({
                    value: c.category,
                    label: c.category,
                    count: c.count,
                  })),
                ]}
              />
              <TogglePill
                label="Include holdings"
                active={includeHoldings}
                onToggle={() => setIncludeHoldings((v) => !v)}
              />
            </div>
          </ToolbarGroup>
          <div className="ml-auto">
            <ToolbarGroup>
              <Segmented
                ariaLabel="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "score", label: "Score" },
                  { value: "scheme", label: "A - Z" },
                ]}
              />
            </ToolbarGroup>
          </div>
        </Toolbar>

        {filtered.length === 0 ? (
          <EmptyState
            message={
              mfCandidates.length === 0
                ? "No MF research data yet. Run /portfolio-check to populate."
                : "No candidates match the current filter."
            }
          />
        ) : (
          <ul key={`${categoryFilter}-${sort}`} className="list-stagger px-3 md:px-5">
            {filtered.map((c, i) => (
              <li key={c.scheme} style={{ ["--idx" as string]: i }}>
                <MFCandidateRow c={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ScoringLegend kind="mf" />
    </div>
  );
}

const MF_ACTION_TONES: Record<MFRotationItem["action"], TagTone> = {
  Switch: "info",
  Kill: "neg",
  Exit: "neg",
  Promote: "pos",
  Cap: "neutral",
  Watch: "neutral",
  Consolidate: "warn",
};

function MFActionChip({ action }: { action: MFRotationItem["action"] }) {
  return <Tag label={action} tone={MF_ACTION_TONES[action]} />;
}

function MFRotationRow({ r }: { r: MFRotationItem }) {
  return (
    <div className="relative grid grid-cols-[40px_1fr_auto] gap-x-3 items-start py-5 px-1 after:content-[''] after:absolute after:bottom-0 after:left-[52px] after:right-1 after:h-px after:bg-[var(--border)]">
      <AMCChip amc={r.amc} size={36} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[13px] font-semibold text-primary leading-tight">
            {r.scheme}
          </span>
          <MFActionChip action={r.action} />
        </div>
        <p className="text-[12.5px] text-secondary leading-snug">{r.reason}</p>
      </div>
      {r.impact && (
        <div className="text-right shrink-0">
          <div className="text-[10.5px] text-tertiary uppercase tracking-wide">Impact</div>
          <div className="mono-true text-[12px] text-secondary tabular-nums mt-0.5">
            {r.impact}
          </div>
        </div>
      )}
    </div>
  );
}

function MFCandidateRow({ c }: { c: MFCandidate }) {
  const scoreCls =
    c.score >= 7 ? "text-pos" : c.score >= 5 ? "text-warn" : "text-neg";
  const confCls = confidenceTone(c.confidence);
  return (
    <div
      title={c.thesis}
      className="relative w-[calc(100%+1.5rem)] md:w-[calc(100%+2.5rem)] grid grid-cols-[40px_1fr_90px_70px] md:grid-cols-[40px_1fr_110px_80px] -mx-3 md:-mx-5 gap-x-3 items-center py-5 px-4 md:px-6 transition-colors hover:bg-[var(--bg-subtle)] after:content-[''] after:absolute after:bottom-0 after:left-[60px] md:after:left-[68px] after:right-4 md:after:right-6 after:h-px after:bg-[var(--border)]"
    >
      <AMCChip amc={c.amc} size={36} />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-primary leading-tight truncate">
          {c.scheme}
        </div>
        <div className="text-[11px] text-tertiary truncate leading-tight mt-0.5">
          {c.category}
        </div>
      </div>
      <div className={`text-right text-[12.5px] mono font-medium tabular-nums whitespace-nowrap ${confCls}`}>
        {c.confidence}
      </div>
      <div className={`text-right text-[14px] mono font-semibold tabular-nums ${scoreCls}`}>
        {c.score.toFixed(1)}
      </div>
    </div>
  );
}

// ---------- Ideas (merged Watchlist + Multibaggers) ----------

type IdeaItem =
  | ({ source: "watchlist" } & WatchlistEntry)
  | ({ source: "scan"; scanDate?: string } & MultibaggerEntry);

type IdeaSort = "confidence" | "sector" | "date";
type IdeaSource = "all" | "mine" | "claude";

function IdeasTab({ embedded = false }: { embedded?: boolean } = {}) {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [watchMtime, setWatchMtime] = useState<string | null>(null);
  const [multibaggers, setMultibaggers] = useState<MultibaggerEntry[]>([]);
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sort, setSort] = useState<IdeaSort>("confidence");
  const [source, setSource] = useState<IdeaSource>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const [w, m] = await Promise.all([
      fetch("/api/watchlist").then((r) => r.json()),
      fetch("/api/multibaggers").then((r) => r.json()),
    ]);
    setWatchlist(w.entries || []);
    setWatchMtime(w.mtime || null);
    setMultibaggers(m.entries || []);
    setScanDate(m.date || null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = useCallback((ticker: string) => {
    setDeleteError(null);
    setPendingDelete(ticker);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await fetch("/api/watchlist/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: pendingDelete }),
      });
      if (r.ok) {
        setPendingDelete(null);
        load();
      } else {
        const j = await r.json().catch(() => ({}));
        setDeleteError(j.error || r.statusText || "Could not delete");
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, load]);

  const active = watchlist.filter((e) => e.status === "active");
  const passed = watchlist.filter((e) => e.status === "passed");

  const sortItems = useCallback(
    (list: IdeaItem[]): IdeaItem[] => {
      const confRank = (c?: string) => {
        if (!c) return 0;
        const u = c.toUpperCase();
        if (u.startsWith("HIGH")) return 3;
        if (u.includes("MEDIUM-HIGH")) return 2.5;
        if (u.startsWith("MEDIUM") && !u.includes("LOW")) return 2;
        if (u.includes("LOW-MEDIUM")) return 1.5;
        return 1;
      };
      const dateOf = (it: IdeaItem) =>
        it.source === "watchlist"
          ? (it as WatchlistEntry).added || ""
          : (it as { scanDate?: string }).scanDate || "";
      const sorted = [...list];
      sorted.sort((a, b) => {
        if (sort === "confidence")
          return confRank(b.confidence) - confRank(a.confidence);
        if (sort === "sector")
          return (getMeta(a.ticker).sector || "").localeCompare(
            getMeta(b.ticker).sector || ""
          );
        if (sort === "date")
          return (dateOf(b) || "").localeCompare(dateOf(a) || "");
        return 0;
      });
      return sorted;
    },
    [sort]
  );

  const myIdeas = useMemo<IdeaItem[]>(
    () => sortItems(active.map((e) => ({ ...e, source: "watchlist" as const }))),
    [active, sortItems]
  );

  const claudeIdeas = useMemo<IdeaItem[]>(() => {
    const owned = new Set(active.map((a) => a.ticker));
    const list: IdeaItem[] = multibaggers
      .filter((m) => !owned.has(m.ticker))
      .map((m) => ({
        ...m,
        source: "scan" as const,
        scanDate: scanDate || undefined,
      }));
    return sortItems(list);
  }, [active, multibaggers, scanDate, sortItems]);

  const visibleItems = useMemo<IdeaItem[]>(() => {
    if (source === "mine") return myIdeas;
    if (source === "claude") return claudeIdeas;
    return [...myIdeas, ...claudeIdeas].sort((a, b) => {
      // re-apply sort across the merged list
      const confRank = (c?: string) => {
        if (!c) return 0;
        const u = c.toUpperCase();
        if (u.startsWith("HIGH")) return 3;
        if (u.includes("MEDIUM-HIGH")) return 2.5;
        if (u.startsWith("MEDIUM") && !u.includes("LOW")) return 2;
        if (u.includes("LOW-MEDIUM")) return 1.5;
        return 1;
      };
      if (sort === "confidence")
        return confRank(b.confidence) - confRank(a.confidence);
      if (sort === "sector")
        return (getMeta(a.ticker).sector || "").localeCompare(
          getMeta(b.ticker).sector || ""
        );
      return 0;
    });
  }, [source, myIdeas, claudeIdeas, sort]);

  const totalCount = myIdeas.length + claudeIdeas.length;

  return (
    <div className="space-y-4">
      {embedded ? (
        <SectionTitle
          title="Ideas"
          subtitle={`${totalCount} total · ${myIdeas.length} mine · ${claudeIdeas.length} from Claude`}
          actions={
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-primary accent-ring transition-colors"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
            >
              <span className="text-[14px] leading-none" aria-hidden>
                +
              </span>
              Add idea
            </button>
          }
        />
      ) : (
        <PageHeader
          title="Ideas"
          subtitle={`${totalCount} total · ${myIdeas.length} mine · ${claudeIdeas.length} from Claude`}
          mtime={watchMtime}
          actions={
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-primary accent-ring transition-colors"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
            >
              <span className="text-[14px] leading-none" aria-hidden>
                +
              </span>
              Add idea
            </button>
          }
        />
      )}

      <DeployCard />

      <Toolbar>
        <ToolbarGroup>
          <Segmented<IdeaSource>
            ariaLabel="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: "All" },
              { value: "mine", label: "Mine" },
              { value: "claude", label: "Claude" },
            ]}
          />
        </ToolbarGroup>
        <div className="ml-auto">
          <ToolbarGroup>
            <Segmented<IdeaSort>
              ariaLabel="Sort ideas"
              value={sort}
              onChange={setSort}
              options={[
                { value: "confidence", label: "Confidence" },
                { value: "sector", label: "Sector" },
                { value: "date", label: "Date" },
              ]}
            />
          </ToolbarGroup>
        </div>
      </Toolbar>

      {!loaded ? (
        <Skeleton />
      ) : visibleItems.length === 0 ? (
        <p className="text-[12px] text-tertiary py-8 text-center">
          {source === "mine"
            ? "You haven't added any ideas yet. Hit Add idea above."
            : source === "claude"
            ? "No fresh scan results."
            : "No ideas yet."}
        </p>
      ) : (
        <ul key={`${source}-${sort}`} className="list-stagger">
          {visibleItems.map((e, i) => (
            <IdeaRow
              key={`${e.source}-${e.ticker}`}
              item={e}
              sort={sort}
              idx={i}
              onDelete={
                e.source === "watchlist" ? () => handleDelete(e.ticker) : undefined
              }
            />
          ))}
        </ul>
      )}

      {passed.length > 0 && (
        <details className="surface-subtle rounded-lg">
          <summary className="px-5 py-3 type-body-sm text-secondary cursor-pointer hover:text-primary">
            Passed · {passed.length}
          </summary>
          <div className="px-5 pb-4 space-y-2">
            {passed.map((e) => (
              <div
                key={e.ticker}
                className="flex items-start gap-3 type-caption py-2 border-t border-subtle"
              >
                <span className="mono text-secondary w-28 shrink-0">
                  {e.ticker}
                </span>
                <span className="text-tertiary">{e.passedReason || "—"}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {addOpen && (
        <AddIdeaModal
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete idea"
          message={
            <>
              Remove{" "}
              <span className="mono-true font-semibold text-primary">
                {pendingDelete}
              </span>{" "}
              from your watchlist? This rewrites the underlying memory file.
            </>
          }
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onCancel]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
    >
      <div
        className="modal-card surface rounded-lg w-full max-w-sm p-6 space-y-4 diffuse"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-serif text-[18px] font-semibold text-primary">
            {title}
          </h3>
          <p className="text-[13px] text-secondary mt-1.5 leading-relaxed">
            {message}
          </p>
        </div>
        {error && (
          <div className="text-[12px] text-neg bg-neg-tint rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-md text-[12px] text-secondary hover:text-primary accent-ring"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-md text-[12px] font-medium text-white accent-ring disabled:opacity-50"
            style={{
              background: danger ? "var(--neg)" : "var(--brand)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

type DeployLeg = {
  ticker: string;
  shares: number;
  ltp: number;
  deployINR: number;
  note?: string;
};

type DeployRec = {
  asOf: string;
  budgetMin: number;
  budgetMax: number;
  regime?: string;
  headline: string;
  primary: {
    ticker: string;
    name?: string;
    action: string;
    ltp: number;
    shares: number;
    deployINR: number;
    framework?: string;
    confidence?: string;
    thesis?: string;
    trigger?: string;
  };
  alternatives?: { label: string; legs: DeployLeg[] }[];
  avoid?: { ticker: string; reason: string }[];
  rule?: string;
};

function DeployCard() {
  const [rec, setRec] = useState<DeployRec | null>(null);
  const [mtime, setMtime] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    fetch("/api/deploy")
      .then((r) => r.json())
      .then((r) => {
        if (r.data) {
          setRec(r.data);
          setMtime(r.mtime);
        }
      })
      .catch(() => {});
  }, []);

  if (!rec) return null;
  // Hide the card when there's nothing to deploy right now. The "next deploy
  // is funded by X rotation" planning lives in Tasks instead.
  if ((rec.budgetMax ?? 0) <= 0) return null;

  const meta = getMeta(rec.primary.ticker);

  return (
    <section
      className="surface rounded-lg p-6 space-y-5"
      style={{ background: "var(--brand-tint)" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex items-start gap-3 flex-wrap w-full text-left cursor-pointer hover:opacity-90 transition-opacity"
      >
        <div className="flex-1 min-w-0">
          <div className="type-meta text-tertiary">cash to deploy</div>
          <h3 className="type-h2 text-primary mt-1">
            ₹{fmtINR(rec.budgetMin)}–{fmtINR(rec.budgetMax)}
          </h3>
          {rec.regime && (
            <div className="type-caption text-secondary mt-1">
              regime: <span className="text-primary">{rec.regime}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {mtime && (
            <span className="type-caption text-tertiary mono">
              updated {formatShort(mtime)}
            </span>
          )}
          <span
            aria-hidden
            className={`text-tertiary transition-transform duration-200 ${
              collapsed ? "" : "rotate-180"
            }`}
          >
            ▾
          </span>
        </div>
      </button>

      {!collapsed && (
        <p className="type-body-sm text-primary leading-relaxed">
          {rec.headline}
        </p>
      )}

      {!collapsed && (
        <>
      <div
        className="surface rounded-lg p-5 flex items-start gap-4"
        style={{ background: "var(--bg-card)" }}
      >
        <LogoImg ticker={rec.primary.ticker} domain={meta.domain} size={48} rounded="xl" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="type-meta px-2 py-0.5 rounded-md bg-pos-tint text-pos">
              recommended
            </span>
            <span className="font-semibold mono text-primary text-base">
              {rec.primary.ticker}
            </span>
            {rec.primary.name && (
              <span className="type-body-sm text-secondary">
                {rec.primary.name}
              </span>
            )}
            <ConfidenceBadge value={rec.primary.confidence} />
            {rec.primary.framework && (
              <span className="type-caption text-tertiary">
                · {rec.primary.framework}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap mono">
            <span className="text-primary text-lg font-semibold">
              {rec.primary.shares} shares
            </span>
            <span className="text-tertiary">
              @ ₹{fmtINR(rec.primary.ltp)}
            </span>
            <span className="text-tertiary">=</span>
            <span className="text-primary font-semibold">
              ₹{fmtINR(rec.primary.deployINR)}
            </span>
          </div>
          {rec.primary.thesis && (
            <p className="type-body-sm text-secondary leading-relaxed">
              {rec.primary.thesis}
            </p>
          )}
          {rec.primary.trigger && (
            <p className="type-caption text-tertiary leading-relaxed">
              <span className="text-[10.5px] mr-1.5 font-medium">Trigger</span>
              {rec.primary.trigger}
            </p>
          )}
        </div>
      </div>

      {rec.alternatives && rec.alternatives.length > 0 && (
        <details className="surface-subtle rounded-lg">
          <summary className="px-5 py-3 type-body-sm text-secondary cursor-pointer hover:text-primary">
            Alternatives · {rec.alternatives.length}
          </summary>
          <div className="px-5 pb-5 space-y-4">
            {rec.alternatives.map((alt, i) => (
              <div key={i} className="space-y-2">
                <div className="type-meta text-tertiary">{alt.label}</div>
                <ul className="space-y-2">
                  {alt.legs.map((leg) => (
                    <li
                      key={leg.ticker}
                      className="flex items-baseline gap-3 flex-wrap text-sm"
                    >
                      <span className="font-semibold mono text-primary w-24 shrink-0">
                        {leg.ticker}
                      </span>
                      <span className="mono text-secondary">
                        {leg.shares} @ ₹{fmtINR(leg.ltp)}
                      </span>
                      <span className="mono text-tertiary">
                        = ₹{fmtINR(leg.deployINR)}
                      </span>
                      {leg.note && (
                        <span className="type-caption text-tertiary flex-1 min-w-[200px]">
                          {leg.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {rec.avoid && rec.avoid.length > 0 && (
        <div className="space-y-2">
          <div className="type-meta text-tertiary">do not deploy into</div>
          <ul className="space-y-1.5">
            {rec.avoid.map((a) => (
              <li
                key={a.ticker}
                className="flex items-baseline gap-3 type-caption"
              >
                <span className="font-semibold mono text-neg w-24 shrink-0">
                  {a.ticker}
                </span>
                <span className="text-tertiary">{a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rec.rule && (
        <p className="type-caption text-tertiary italic border-t border-subtle pt-3">
          {rec.rule}
        </p>
      )}
        </>
      )}
    </section>
  );
}

function RegimeChip({
  regime,
  scanDate,
}: {
  regime: string;
  scanDate: string | null;
}) {
  // Map dense Claude-generated regime strings to a plain-English vibe.
  const lower = regime.toLowerCase();
  let label = "Mixed";
  let plain = "Market is mixed — winners are concentrated in a few names.";
  let dot = "var(--warn)";
  let tint = "rgba(244, 180, 0, 0.07)";
  if (/correction|sell\s*off|bear/.test(lower)) {
    label = "Correction";
    plain =
      "Market is in a correction. Stay defensive — don't chase new buys until things stabilize.";
    dot = "var(--neg)";
    tint = "var(--neg-tint)";
  } else if (/recovery/.test(lower)) {
    label = "Recovering";
    plain =
      "Market is bouncing back from a correction. Quality names usually lead these phases.";
    dot = "var(--warn)";
    tint = "rgba(244, 180, 0, 0.07)";
  } else if (/early\s*bull/.test(lower)) {
    label = "Risk-on";
    plain =
      "Bull market is fresh — broader rally, breakouts work, momentum names lead.";
    dot = "var(--pos)";
    tint = "var(--pos-tint)";
  } else if (/late|narrow|distribution|top/.test(lower)) {
    label = "Cautious bull";
    plain =
      "Index is up, but only a few stocks are doing the heavy lifting. Be picky — broad bets won't work.";
    dot = "var(--warn)";
    tint = "rgba(244, 180, 0, 0.07)";
  } else if (/bull/.test(lower)) {
    label = "Bull";
    plain = "Market is healthy — broad participation across sectors.";
    dot = "var(--pos)";
    tint = "var(--pos-tint)";
  }

  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-30 max-w-[320px]">
      {open ? (
        <div
          className="rounded-lg p-4 diffuse"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${dot}`,
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[11px] text-tertiary mb-1">Market mood</div>
              <div className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: dot }}
                />
                <span className="text-[14px] font-semibold text-primary">
                  {label}
                </span>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-tertiary hover:text-primary text-[14px] leading-none accent-ring -m-1 p-1"
              aria-label="Hide market mood"
            >
              ×
            </button>
          </div>
          <p className="text-[12px] text-secondary leading-relaxed">{plain}</p>
          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-subtle">
            <span
              className="text-[10px] text-tertiary mono-true truncate"
              title={regime}
            >
              {regime}
            </span>
            {scanDate && (
              <span className="text-[10px] text-tertiary mono-true shrink-0">
                {scanDate}
              </span>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md pl-2.5 pr-3.5 py-2 diffuse accent-ring transition-colors"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
          aria-label={`Market mood: ${label}. Tap for detail.`}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: dot }}
          />
          <span className="text-[11px] text-tertiary">Mood</span>
          <span className="text-[12px] font-medium text-primary">{label}</span>
        </button>
      )}
    </div>
  );
}

function IdeaRow({
  item,
  sort,
  onDelete,
  idx,
}: {
  item: IdeaItem;
  sort: IdeaSort;
  onDelete?: () => void;
  idx?: number;
}) {
  const meta = getMeta(item.ticker);

  // Unified body text: watchlist has thesis + entryTrigger; scan has bullCase + risk + entryZone
  const thesis =
    item.source === "watchlist" ? item.thesis : (item as MultibaggerEntry).bullCase;
  const riskOrTrigger =
    item.source === "watchlist"
      ? (item as WatchlistEntry).entryTrigger
      : (item as MultibaggerEntry).risk;
  const riskLabel = item.source === "watchlist" ? "trigger" : "risk";
  const entry =
    item.source === "watchlist"
      ? (item as WatchlistEntry).entryPrice
        ? `₹${fmtINR((item as WatchlistEntry).entryPrice as number)}`
        : undefined
      : (item as MultibaggerEntry).entryZone;

  return (
    <IdeaRowExpandable
      item={item}
      meta={meta}
      thesis={thesis}
      riskOrTrigger={riskOrTrigger}
      riskLabel={riskLabel}
      entry={entry}
      sort={sort}
      onDelete={onDelete}
      idx={idx}
    />
  );
}

function IdeaRowExpandable({
  item,
  meta,
  thesis,
  riskOrTrigger,
  riskLabel,
  entry,
  sort,
  onDelete,
  idx,
}: {
  item: IdeaItem;
  meta: ReturnType<typeof getMeta>;
  thesis?: string;
  riskOrTrigger?: string;
  riskLabel: string;
  entry?: string;
  sort: IdeaSort;
  onDelete?: () => void;
  idx?: number;
}) {
  const [open, setOpen] = useState(false);
  const company =
    item.source === "scan"
      ? (item as MultibaggerEntry).company || meta.name
      : (item as WatchlistEntry).company || meta.name;
  const dateStr =
    item.source === "watchlist"
      ? (item as WatchlistEntry).added
      : (item as { scanDate?: string }).scanDate;

  return (
    <li
      className="group relative transition-colors hover:bg-[var(--bg-subtle)]"
      style={{
        borderBottom: "1px solid var(--border)",
        ...(idx !== undefined ? { ["--idx" as string]: idx } : {}),
      }}
    >
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-1 py-4 flex items-start gap-4 accent-ring"
      >
        <LogoImg ticker={item.ticker} domain={meta.domain} size={36} />
        <div className="flex-1 min-w-0 max-w-[60%]">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold mono-true text-primary text-[13px]">
              {item.ticker}
            </span>
            <span className="text-[12px] text-secondary truncate">
              {company}
            </span>
          </div>
          {(item.framework || thesis) && (
            <div
              className="text-[11px] text-tertiary mt-1.5 leading-snug"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.framework
                ? `${item.framework}${thesis ? " · " : ""}`
                : ""}
              {thesis && <span>{thesis}</span>}
            </div>
          )}
        </div>

        <div className="ml-auto shrink-0 flex items-center gap-3 self-stretch pl-6">
          {(() => {
            const confLabel = shortConfidenceLabel(item.confidence);
            const confCls = confidenceTone(item.confidence);
            const score = confidenceToScore(item.confidence);
            const hasScore = typeof score === "number";
            const scoreCls = !hasScore
              ? "text-tertiary"
              : score >= 7
              ? "text-pos"
              : score >= 5
              ? "text-warn"
              : "text-neg";
            return (
              <>
                <span
                  className={`text-right text-[12.5px] mono font-medium tabular-nums whitespace-nowrap w-[100px] md:w-[120px] ${confCls}`}
                >
                  {confLabel}
                </span>
                <span
                  className={`text-right text-[14px] mono font-semibold tabular-nums w-[60px] md:w-[80px] ${scoreCls}`}
                >
                  {hasScore ? score.toFixed(1) : "—"}
                </span>
              </>
            );
          })()}
        </div>
      </button>
      {onDelete && (
        <button
          aria-label={`Delete ${item.ticker}`}
          title={`Delete ${item.ticker}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1/2 -translate-y-1/2 -right-9 w-7 h-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-tertiary hover:text-neg accent-ring"
        >
          <TrashIcon />
        </button>
      )}
      {open && (
        <IdeaDetailsModal
          item={item}
          meta={meta}
          company={company}
          thesis={thesis}
          riskOrTrigger={riskOrTrigger}
          riskLabel={riskLabel}
          entry={entry}
          dateStr={dateStr}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}

function IdeaDetailsModal({
  item,
  meta,
  company,
  thesis,
  riskOrTrigger,
  riskLabel,
  entry,
  dateStr,
  onClose,
}: {
  item: IdeaItem;
  meta: ReturnType<typeof getMeta>;
  company: string;
  thesis?: string;
  riskOrTrigger?: string;
  riskLabel: string;
  entry?: string;
  dateStr?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const sector = meta.sector;
  const horizon = (item as MultibaggerEntry).horizon;
  const cmp = item.source === "scan" ? (item as MultibaggerEntry).cmp : undefined;
  const marketCap =
    item.source === "scan" ? (item as MultibaggerEntry).marketCap : undefined;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card surface rounded-lg p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-start gap-4 pb-5">
          <LogoImg ticker={item.ticker} domain={meta.domain} size={56} rounded="xl" />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold mono-true text-primary">
              {item.ticker}
            </div>
            <div className="text-sm text-secondary">{company}</div>
            {sector && (
              <div className="text-[11px] text-tertiary mt-0.5">{sector}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-primary text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {(item.confidence ||
          item.framework ||
          entry ||
          cmp ||
          marketCap ||
          horizon ||
          dateStr) && (
          <section
            className="pt-5 mt-1"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="text-[11px] font-medium text-tertiary mb-4">
              At a glance
            </div>
            <div className="grid grid-cols-3 gap-x-5 gap-y-4">
              {item.confidence && (
                <IdeaStat label="Confidence" value={item.confidence} />
              )}
              {item.framework && (
                <IdeaStat label="Framework" value={item.framework} />
              )}
              {entry && <IdeaStat label="Entry" value={entry} mono />}
              {cmp && <IdeaStat label="CMP" value={cmp} mono />}
              {marketCap && <IdeaStat label="Mcap" value={marketCap} mono />}
              {horizon && <IdeaStat label="Horizon" value={horizon} />}
              {item.source === "watchlist" && dateStr && (
                <IdeaStat label="Added" value={dateStr} mono />
              )}
              {item.source === "scan" && dateStr && (
                <IdeaStat label="Scanned" value={dateStr} mono />
              )}
            </div>
          </section>
        )}

        {thesis && (
          <section
            className="pt-5 mt-5"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="text-[11px] font-medium text-tertiary mb-3">Thesis</div>
            <p className="text-[13px] text-secondary leading-relaxed">{thesis}</p>
          </section>
        )}

        {riskOrTrigger && (
          <section
            className="pt-5 mt-5"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="text-[11px] font-medium text-tertiary mb-3 capitalize">
              {riskLabel}
            </div>
            <p className="text-[13px] text-secondary leading-relaxed">
              {riskOrTrigger}
            </p>
          </section>
        )}

        {meta.domain && (
          <a
            href={`https://www.screener.in/company/${item.ticker}/consolidated/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[var(--brand)] hover:underline mt-6 inline-block"
          >
            View full profile on screener.in →
          </a>
        )}
      </div>
    </div>,
    document.body
  );
}

function IdeaStat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-tertiary mb-1">{label}</div>
      <div
        className={`${mono ? "mono-true" : ""} text-[13px] font-medium text-primary leading-tight`}
      >
        {value}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

function confidenceTone(value?: string): "text-pos" | "text-warn" | "text-neg" | "text-tertiary" {
  if (!value) return "text-tertiary";
  const label = shortConfidenceLabel(value);
  if (label === "HIGH") return "text-pos";
  if (label === "LOW") return "text-neg";
  return "text-warn";
}

function shortConfidenceLabel(value?: string): string {
  if (!value) return "—";
  const u = value.toUpperCase();
  // longest-first so MEDIUM-HIGH wins over HIGH
  const m = u.match(/MEDIUM-HIGH|LOW-MEDIUM|HIGH|MEDIUM|LOW/);
  return m ? m[0] : u.split(/[\s—\-(]/)[0];
}

type TickerOption = { ticker: string; name: string; sector?: string };

function TickerSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (ticker: string, name?: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pool, setPool] = useState<TickerOption[]>(() =>
    Object.entries(TICKER_META).map(([t, m]) => ({
      ticker: t,
      name: m.name,
      sector: m.sector,
    }))
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/multibaggers")
        .then((r) => r.json())
        .catch(() => ({ entries: [] })),
      fetch("/api/watchlist")
        .then((r) => r.json())
        .catch(() => ({ entries: [] })),
    ]).then(([mb, wl]) => {
      if (cancelled) return;
      setPool((prev) => {
        const seen = new Set(prev.map((s) => s.ticker));
        const next = [...prev];
        for (const e of mb.entries || []) {
          if (e.ticker && !seen.has(e.ticker)) {
            next.push({ ticker: e.ticker, name: e.company || e.ticker });
            seen.add(e.ticker);
          }
        }
        for (const e of wl.entries || []) {
          if (e.ticker && !seen.has(e.ticker)) {
            next.push({ ticker: e.ticker, name: e.company || e.ticker });
            seen.add(e.ticker);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? pool.filter(
          (s) =>
            s.ticker.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q)
        )
      : pool;
    return list.slice(0, 8);
  }, [query, pool]);

  function pick(s: TickerOption) {
    setQuery(s.ticker);
    setOpen(false);
    onChange(s.ticker, s.name);
  }

  function commitFreeText(v: string) {
    const t = v.trim().toUpperCase();
    onChange(t);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          setOpen(true);
          setHighlight(0);
          commitFreeText(v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && filtered[highlight]) {
              e.preventDefault();
              pick(filtered[highlight]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search ticker or company"
        className="w-full mono-true text-[13px] text-primary px-3 py-2 rounded-md outline-none"
        style={{
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
        }}
      />
      {open && filtered.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md max-h-[260px] overflow-auto diffuse"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          {filtered.map((s, i) => (
            <li key={s.ticker}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className="w-full text-left px-3 py-2 flex items-baseline gap-2 transition-colors"
                style={{
                  background:
                    i === highlight ? "var(--bg-subtle)" : "transparent",
                }}
              >
                <span className="mono-true text-[12.5px] font-semibold text-primary shrink-0">
                  {s.ticker}
                </span>
                <span className="text-[12px] text-secondary truncate">
                  {s.name}
                </span>
                {s.sector && (
                  <span className="ml-auto text-[10.5px] text-tertiary shrink-0">
                    {s.sector}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && filtered.length === 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md px-3 py-2 text-[12px] text-tertiary"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          No match — press Save to add{" "}
          <span className="mono-true text-secondary">
            {query.trim().toUpperCase()}
          </span>{" "}
          as-is.
        </div>
      )}
    </div>
  );
}

function AddIdeaModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ticker, setTicker] = useState("");
  const [company, setCompany] = useState("");
  const [thesis, setThesis] = useState("");
  const [entryTrigger, setEntryTrigger] = useState("");
  const [confidence, setConfidence] = useState("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!ticker.trim()) {
      setError("Ticker is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/watchlist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          company: company.trim() || undefined,
          thesis: thesis.trim() || undefined,
          entryTrigger: entryTrigger.trim() || undefined,
          confidence,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Could not save");
        setBusy(false);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-md"
      title="Add idea"
      subtitle="Track a new candidate before it earns a spot in the book."
    >
      <ModalSection className="space-y-3">
        <FormField label="Ticker" required>
          <TickerSearch
            value={ticker}
            onChange={(t, name) => {
              setTicker(t);
              if (name && !company.trim()) setCompany(name);
            }}
          />
        </FormField>
        <FormField label="Company">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Optional — auto-filled from registry"
            className="w-full text-[12.5px] text-primary px-3 py-2 rounded-md outline-none focus:border-[var(--brand)] transition-colors"
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
            }}
          />
        </FormField>
        <FormField label="Thesis">
          <textarea
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="Why is this interesting?"
            rows={3}
            className="w-full text-[12.5px] text-primary px-3 py-2 rounded-md outline-none resize-none leading-snug focus:border-[var(--brand)] transition-colors"
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
            }}
          />
        </FormField>
        <FormField label="Entry trigger">
          <input
            value={entryTrigger}
            onChange={(e) => setEntryTrigger(e.target.value)}
            placeholder="When would you buy?"
            className="w-full text-[12.5px] text-primary px-3 py-2 rounded-md outline-none focus:border-[var(--brand)] transition-colors"
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
            }}
          />
        </FormField>
        <FormField label="Confidence">
          <Segmented<string>
            ariaLabel="Confidence"
            value={confidence}
            onChange={setConfidence}
            options={[
              { value: "LOW", label: "Low" },
              { value: "MEDIUM", label: "Medium" },
              { value: "MEDIUM-HIGH", label: "Med-high" },
              { value: "HIGH", label: "High" },
            ]}
          />
        </FormField>
        {error && (
          <div className="text-[12px] text-neg bg-neg-tint rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </ModalSection>

      <ModalFooter align="end">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={busy || !ticker.trim()}
          className="px-4 py-2 text-[12px]"
        >
          {busy ? "Saving…" : "Save idea"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11.5px] text-tertiary mb-1.5 font-medium">
        {label}
        {required && <span className="text-neg ml-1">*</span>}
      </div>
      {children}
    </label>
  );
}

// ---------- Analysis ----------

type Megatrend = {
  id: string;
  label: string;
  tailwindCagr: number;
  tamNote: string;
  color: string;
};

type AnalysisCandidate = {
  ticker: string;
  name: string;
  megatrend: string;
  patternScore: number;
  decision:
    | "ADD"
    | "WATCH"
    | "PASS"
    | "PRUNE"
    | "DEMOTE"
    | "OWN"
    | "OWN_STARTER"
    | "WATCH_STARTER"
    | "REENTRY_WATCH";
  status: "owned" | "watchlist" | "new" | "pruned" | "exited";
  moat: string;
  orderBook: string;
  earnings: string;
  valuation: string;
  riskFlag: string;
};

type AnalysisData = {
  asOf: string;
  framework: string;
  framework_plain_english?: string;
  criteria: string[];
  megatrends: Megatrend[];
  candidates: AnalysisCandidate[];
  decisionsSummary: Record<string, string[]>;
};

type BacktestCriteria = Record<string, boolean>;

type BacktestRow = {
  ticker: string;
  cohort: "winner" | "loser";
  entry_quarter: string;
  "1y_return_pct": number;
  score: number;
  would_buy: boolean;
  criteria: BacktestCriteria;
};

type BacktestData = {
  generatedAt: string;
  type: string;
  method: string;
  rules: Record<string, string>;
  cohort: { winners: string[]; losers: string[] };
  summary: {
    winners_caught: number;
    winners_missed: number;
    losers_avoided: number;
    losers_bought: number;
    winner_capture_rate_pct: number;
    loser_avoidance_rate_pct: number;
    precision_pct: number;
  };
  details: BacktestRow[];
  next_step: string;
};

function AnalysisTab({
  embedded = false,
  showCandidatesTable = true,
}: { embedded?: boolean; showCandidatesTable?: boolean } = {}) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [mtime, setMtime] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTrend, setActiveTrend] = useState<string | null>(null);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<BacktestData | null>(null);

  useEffect(() => {
    fetch("/api/analysis")
      .then((r) => r.json())
      .then((j) => {
        setData(j.data);
        setMtime(j.mtime || null);
        setLoaded(true);
      });
    fetch("/api/backtest")
      .then((r) => r.json())
      .then((j) => {
        if (j.data) setBacktest(j.data);
      })
      .catch(() => {});
  }, []);

  if (!loaded) return <Skeleton />;
  if (!data) return <EmptyState message="No analysis data found." />;

  const filtered = activeTrend
    ? data.candidates.filter((c) => c.megatrend === activeTrend)
    : data.candidates;

  const counts = {
    add: data.decisionsSummary.add?.length || 0,
    watch:
      (data.decisionsSummary.watch?.length || 0) +
      (data.decisionsSummary.reentry_watch?.length || 0),
    pass: data.decisionsSummary.pass?.length || 0,
    prune:
      (data.decisionsSummary.prune?.length || 0) +
      (data.decisionsSummary.demote?.length || 0),
  };

  const activeTrendObj = activeTrend
    ? data.megatrends.find((m) => m.id === activeTrend)
    : undefined;

  return (
    <div>
      {embedded ? (
        <SectionTitle
          title="Megatrend analysis"
          subtitle={`${data.candidates.length} candidates · 7-check framework`}
          actions={<CockpitCounts counts={counts} />}
        />
      ) : (
        <PageHeader
          title="Analysis"
          info={
            data.framework_plain_english ||
            "Pickaxe-seller pattern. 7 checks: booming customer, locked-in supplier, rising orders, profit acceleration, ready capacity, valuation runway, chart confirms."
          }
          subtitle={`${data.candidates.length} candidates`}
          mtime={mtime}
          actions={<CockpitCounts counts={counts} />}
        />
      )}

      <section className="pt-2 pb-2">
        <div
          className="rounded-lg overflow-hidden grid lg:grid-cols-[minmax(280px,340px)_1fr]"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="border-b lg:border-b-0 lg:border-r"
            style={{ borderColor: "var(--border)" }}
          >
            <MegatrendTailwindBars
              megatrends={data.megatrends}
              candidates={data.candidates}
              active={activeTrend}
              onSelect={setActiveTrend}
            />
          </div>
          <MegatrendScatter
            megatrends={data.megatrends}
            candidates={filtered}
            hoveredTicker={hoveredTicker}
            setHoveredTicker={setHoveredTicker}
          />
        </div>
      </section>

      {showCandidatesTable && (
        <Chapter
          num="02"
          eyebrow="Who"
          title="Candidates"
          hint="Click a row to see moat, order book, and risk."
          rightMeta={`${filtered.length} ${
            activeTrend ? `in ${activeTrendObj?.label}` : "total"
          }`}
        >
          <CandidatesTable
            candidates={filtered}
            megatrends={data.megatrends}
            hoveredTicker={hoveredTicker}
            setHoveredTicker={setHoveredTicker}
          />
        </Chapter>
      )}

      <Chapter
        num="03"
        eyebrow="How"
        title="The 7 checks"
        hint="What every candidate is scored against."
        collapsible
      >
        <CriteriaCard criteria={data.criteria} />
      </Chapter>

      {backtest && (
        <Chapter
          num="04"
          eyebrow="Proof"
          title="Backtest"
          hint="Does the rule separate winners from losers?"
          collapsible
        >
          <BacktestCard bt={backtest} />
        </Chapter>
      )}
    </div>
  );
}

function Chapter({
  num,
  eyebrow,
  title,
  hint,
  rightMeta,
  clearFilter,
  collapsible,
  first,
  children,
}: {
  num: string;
  eyebrow: string;
  title: string;
  hint?: string;
  rightMeta?: string;
  clearFilter?: { label: string; color: string; onClear: () => void };
  collapsible?: boolean;
  first?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <section className={first ? "pt-2 pb-2" : "pt-10 pb-2"}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-primary tracking-tight leading-none">
            {title}
          </h2>
          {hint && (
            <span className="text-[12px] text-tertiary">{hint}</span>
          )}
          {clearFilter && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] mono-true px-2 py-0.5 rounded-md"
              style={{
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: clearFilter.color }}
              />
              {clearFilter.label}
              <button
                onClick={clearFilter.onClear}
                className="ml-1 text-tertiary hover:text-primary accent-ring"
                aria-label="Clear filter"
              >
                ✕
              </button>
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3">
          {rightMeta && (
            <span className="mono-true text-[11px] text-tertiary">
              {rightMeta}
            </span>
          )}
          {collapsible && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center px-3 py-1 rounded-md text-[11px] font-medium text-secondary hover:text-primary transition-colors accent-ring"
              style={{
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
              }}
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
        </div>
      </div>
      {open && children}
    </section>
  );
}

type TagTone = "pos" | "neg" | "warn" | "info" | "neutral";

function Tag({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: TagTone;
}) {
  const cls =
    tone === "pos"
      ? "bg-pos-tint text-pos"
      : tone === "neg"
      ? "bg-neg-tint text-neg"
      : tone === "warn"
      ? "bg-amber-500/15 text-amber-500"
      : tone === "info"
      ? "bg-blue-500/15 text-blue-500"
      : "surface-subtle text-tertiary";
  // Normalize label to sentence case (e.g., "URGENT" → "Urgent")
  const display = label
    .toString()
    .toLowerCase()
    .replace(/(^\w|\s\w|·\s\w)/g, (s) => s.toUpperCase());
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md whitespace-nowrap ${cls}`}
      style={{ borderRadius: "6px" }}
    >
      {display}
    </span>
  );
}

function decisionBadge(d: AnalysisCandidate["decision"]) {
  const map: Record<string, { label: string; tone: TagTone }> = {
    ADD: { label: "ADD", tone: "pos" },
    OWN: { label: "OWN", tone: "info" },
    OWN_STARTER: { label: "STARTER", tone: "info" },
    WATCH: { label: "WATCH", tone: "warn" },
    WATCH_STARTER: { label: "WATCH·STARTER", tone: "warn" },
    REENTRY_WATCH: { label: "RE-ENTRY", tone: "warn" },
    PRUNE: { label: "PRUNE", tone: "neg" },
    DEMOTE: { label: "DEMOTE", tone: "neg" },
    PASS: { label: "PASS", tone: "neutral" },
  };
  const { label, tone } = map[d] || map.PASS;
  return <Tag label={label} tone={tone} />;
}

function CockpitCounts({
  counts,
}: {
  counts: { add: number; watch: number; pass: number; prune: number };
}) {
  // Compact horizontal strip — chips, not stat tiles.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CountChip label="Add" value={counts.add} tone="pos" />
      <CountChip label="Watch" value={counts.watch} />
      <CountChip label="Pass" value={counts.pass} />
      <CountChip label="Prune" value={counts.prune} tone="neg" />
    </div>
  );
}

function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "neg" | "pos";
}) {
  const dotCls =
    tone === "pos"
      ? "bg-[var(--pos)]"
      : tone === "neg"
      ? "bg-[var(--neg)]"
      : "bg-[var(--text-tertiary)]";
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
      <span className="text-[11.5px] text-secondary">{label}</span>
      <span className="mono-true text-[12.5px] font-semibold text-primary">
        {value}
      </span>
    </div>
  );
}

function BacktestCard({ bt }: { bt: BacktestData }) {
  const winners = bt.details.filter((d) => d.cohort === "winner");
  const losers = bt.details.filter((d) => d.cohort === "loser");
  const totalWinners = bt.summary.winners_caught + bt.summary.winners_missed;
  const totalLosers = bt.summary.losers_avoided + bt.summary.losers_bought;
  return (
    <div
      className="rounded-lg p-6 md:p-7 space-y-8"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <p className="text-[11.5px] text-tertiary leading-relaxed max-w-[60ch]">
          {bt.method}
        </p>
        <span className="mono-true text-[11px] text-tertiary">
          {bt.type === "logical_backtest" ? "v1 · post-hoc" : bt.type}
        </span>
      </div>

      {/* Hero stat row: 4 metrics, no card chrome, divide-x */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6 md:divide-x divide-y md:divide-y-0" style={{ borderColor: "var(--border)" }}>
        <BtMetric
          label="Winners caught"
          big={`${bt.summary.winners_caught}/${totalWinners}`}
          sub={`${bt.summary.winner_capture_rate_pct}% capture`}
          tone="pos"
          first
        />
        <BtMetric
          label="Losers avoided"
          big={`${bt.summary.losers_avoided}/${totalLosers}`}
          sub={`${bt.summary.loser_avoidance_rate_pct}% avoidance`}
          tone="pos"
        />
        <BtMetric
          label="Precision"
          big={`${bt.summary.precision_pct}%`}
          sub="of all buy signals"
        />
        <BtMetric
          label="Cohort"
          big={`${winners.length}+${losers.length}`}
          sub="winners + losers"
        />
      </div>

      {/* Cohort details — collapsed by default */}
      <details className="group">
        <summary
          className="cursor-pointer list-none accent-ring inline-flex items-center gap-2 text-[11.5px] text-tertiary hover:text-secondary"
        >
          <span className="mono-true">
            view {winners.length + losers.length} cohort details
          </span>
          <span className="group-open:rotate-90 transition-transform mono-true text-[10px]">
            ›
          </span>
        </summary>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8 mt-6">
          <BacktestList title="Winners cohort" rows={winners} />
          <BacktestList title="Losers cohort" rows={losers} />
        </div>
        <div
          className="text-[11px] text-tertiary leading-relaxed pt-4 mt-6"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <span className="eyebrow text-tertiary mr-2">Caveat</span>
          {bt.next_step}
        </div>
      </details>
    </div>
  );
}

function BtMetric({
  label,
  big,
  sub,
  tone,
  first,
}: {
  label: string;
  big: string;
  sub: string;
  tone?: "pos" | "neg";
  first?: boolean;
}) {
  const cls =
    tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-primary";
  return (
    <div className={`${first ? "" : "md:pl-8"} pt-6 md:pt-0`}>
      <div className="eyebrow mb-2">{label}</div>
      <div className={`text-3xl mono-true font-semibold ${cls} leading-none`}>
        {big}
      </div>
      <div className="mono-true text-[10.5px] text-tertiary mt-2">{sub}</div>
    </div>
  );
}

function BacktestList({
  title,
  rows,
}: {
  title: string;
  rows: BacktestRow[];
}) {
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      <ul style={{ borderTop: "1px solid var(--border)" }}>
        {rows.map((r) => {
          const ret = r["1y_return_pct"];
          const retCls =
            ret > 0 ? "text-pos" : ret < 0 ? "text-neg" : "text-tertiary";
          return (
            <li
              key={r.ticker}
              className="cockpit-row flex items-center gap-4 text-[12.5px] py-2.5"
            >
              <span className="font-medium mono-true text-primary w-24 truncate">
                {r.ticker}
              </span>
              <span className="flex-1 mono-true text-tertiary text-[11px]">
                {r.score}/7
                <span className="mx-2 opacity-50">·</span>
                <span
                  className={
                    r.would_buy
                      ? "text-pos"
                      : "text-tertiary"
                  }
                  style={{
                    letterSpacing: "0.12em",
                    fontWeight: r.would_buy ? 500 : 400,
                  }}
                >
                  {r.would_buy ? "BUY" : "skip"}
                </span>
              </span>
              <span
                className={`${retCls} mono-true w-16 text-right font-medium`}
              >
                {ret > 0 ? "+" : ""}
                {ret}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function megatrendById(megatrends: Megatrend[], id: string) {
  return megatrends.find((m) => m.id === id);
}

const TREND_EXPLAINER: Record<string, string> = {
  "AI infrastructure": "Data centers, power, cooling, compute hardware",
  Defense: "Indigenization push, order book visibility, export wins",
  "Power & grid": "T&D capex, transformers, smart-grid build-out",
  "EVs & batteries": "EV ecosystem, Li-ion, charging, components",
  "Specialty chemicals": "CDMO, CRAMS, China-plus-one chem outsourcing",
  "Industrial capex": "Capex cycle - bearings, machining, automation",
  "Premium consumption": "Premiumisation, wealth + financialisation",
  EMS: "Electronics manufacturing services - export + domestic",
  "Precious Metals": "Gold/silver miners and refiners",
  Logistics: "Express logistics, 3PL, warehousing",
  Cables: "Wires & cables - capex + housing demand",
  Retail: "Organised retail, quick-commerce, value retail",
  "Financial Infra": "Exchanges, depositories, asset managers",
  "IT Services": "Large-cap IT services, ER&D, GenAI tooling",
  Other: "Uncategorised ideas",
};

function trendExplainer(label: string, megatrends: Megatrend[]): string {
  const m = megatrends.find((m) => prettyTrend(m.label) === label);
  if (m?.tamNote) return m.tamNote;
  return TREND_EXPLAINER[label] ?? "";
}

function MegatrendTailwindBars({
  megatrends,
  candidates,
  active,
  onSelect,
}: {
  megatrends: Megatrend[];
  candidates: AnalysisCandidate[];
  active: string | null;
  onSelect: (id: string | null) => void;
}) {
  const total = candidates.length;
  const counted = megatrends.map((m) => ({
    ...m,
    count: candidates.filter((c) => c.megatrend === m.id).length,
  }));
  const sorted = [...counted].sort((a, b) => b.count - a.count);

  return (
    <ul className="flex flex-col pt-2">
      {sorted.map((m, i) => {
        const isActive = active === m.id;
        const pct = total > 0 ? (m.count / total) * 100 : 0;
        return (
          <li
            key={m.id}
            onClick={() => onSelect(isActive ? null : m.id)}
            className="px-5 md:px-6 py-3.5 flex items-center gap-3 transition-colors cursor-pointer hover:bg-[var(--bg-subtle)]"
            style={{
              borderTop: i > 0 ? "1px solid var(--border)" : undefined,
              background: isActive ? "var(--bg-subtle)" : undefined,
            }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: m.color }}
            />
            <span className="text-[13px] text-primary font-medium flex-1 truncate">
              {m.label}
            </span>
            <span className="mono-true text-[13px] font-semibold text-primary shrink-0">
              {m.count}
            </span>
            <span className="mono-true text-[12px] text-tertiary shrink-0 w-12 text-right">
              {pct.toFixed(1)}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MegatrendScatter({
  megatrends,
  candidates,
  hoveredTicker,
  setHoveredTicker,
}: {
  megatrends: Megatrend[];
  candidates: AnalysisCandidate[];
  hoveredTicker: string | null;
  setHoveredTicker: (t: string | null) => void;
}) {
  // Axes swapped: X = megatrend lanes (categorical), Y = pattern score (3..7, 7 on top).
  const W = Math.max(560, megatrends.length * 78 + 96);
  const H = 360;
  const padL = 22;
  const padR = 16;
  const padT = 24;
  const padB = 56; // extra room for vertical megatrend labels
  const yMin = 3;
  const yMax = 7;
  const y = (s: number) =>
    padT + ((yMax - s) / (yMax - yMin)) * (H - padT - padB);
  const laneX = (id: string) => {
    const i = megatrends.findIndex((m) => m.id === id);
    const innerW = W - padL - padR;
    return padL + ((i + 0.5) / megatrends.length) * innerW;
  };
  const ticks = [3, 4, 5, 6, 7];

  // Step 1 — De-collide dots within the same megatrend lane (horizontal offset for clusters at same score).
  const positioned = candidates.map((c, idx) => {
    const peers = candidates.filter(
      (p) =>
        p.megatrend === c.megatrend &&
        Math.abs(p.patternScore - c.patternScore) < 0.5
    );
    const peerIdx = peers.findIndex((p) => p.ticker === c.ticker);
    const offset = (peerIdx - (peers.length - 1) / 2) * 16;
    return {
      ...c,
      _idx: idx,
      _x: laneX(c.megatrend) + offset,
      _y: y(c.patternScore),
      _labelY: y(c.patternScore),
      _labelW: c.ticker.length * 6.5 + 8,
    };
  });

  // Step 2 — Resolve LABEL collisions globally.
  const labelH = 13;
  const labelOrder = [...positioned].sort((a, b) => a._labelY - b._labelY);
  for (let i = 0; i < labelOrder.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = labelOrder[j];
      const b = labelOrder[i];
      const aFlip = a._x + 7 + 5 + a._labelW > W - padR;
      const bFlip = b._x + 7 + 5 + b._labelW > W - padR;
      const aLeft = aFlip ? a._x - a._labelW - 12 : a._x + 5;
      const aRight = aFlip ? a._x - 5 : a._x + a._labelW + 12;
      const bLeft = bFlip ? b._x - b._labelW - 12 : b._x + 5;
      const bRight = bFlip ? b._x - 5 : b._x + b._labelW + 12;
      const xOverlap = aLeft < bRight && bLeft < aRight;
      if (!xOverlap) continue;
      if (Math.abs(b._labelY - a._labelY) < labelH) {
        b._labelY = a._labelY + labelH;
      }
    }
  }

  const decisionStyle = (d: AnalysisCandidate["decision"]) => {
    switch (d) {
      case "ADD":
        return { fill: "var(--color-pos, #16a34a)", stroke: "white" };
      case "OWN":
      case "OWN_STARTER":
        return { fill: "#3b82f6", stroke: "white" };
      case "WATCH":
      case "WATCH_STARTER":
      case "REENTRY_WATCH":
        return { fill: "#f59e0b", stroke: "white" };
      case "PRUNE":
      case "DEMOTE":
        return { fill: "var(--color-neg, #dc2626)", stroke: "white" };
      case "PASS":
      default:
        return { fill: "#94a3b8", stroke: "white" };
    }
  };

  return (
    <div className="flex flex-col min-w-0">
      <div className="w-full p-5 md:p-6">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="block w-full h-auto"
          role="img"
          aria-label="Megatrend by pattern score"
        >
          {/* vertical lane separators + megatrend short label on bottom */}
          {megatrends.map((m, i) => {
            const innerW = W - padL - padR;
            const left = padL + (i / megatrends.length) * innerW;
            const mid = left + innerW / megatrends.length / 2;
            const short = m.label
              .replace(/[\/.,]/g, "")
              .split(/\s+/)
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 3);
            return (
              <g key={`lane-${m.id}`}>
                {i > 0 && (
                  <line
                    x1={left}
                    x2={left}
                    y1={padT}
                    y2={H - padB}
                    stroke="currentColor"
                    strokeOpacity={0.05}
                  />
                )}
                <text
                  x={mid}
                  y={H - padB + 18}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  fontSize="9"
                  fill="currentColor"
                  opacity={0.5}
                  style={{ letterSpacing: "0.08em" }}
                >
                  {short}
                </text>
              </g>
            );
          })}

          {/* y-axis pattern-score ticks */}
          {ticks.map((t) => (
            <g key={`tick-${t}`}>
              <line
                x1={padL - 4}
                x2={W - padR + 4}
                y1={y(t)}
                y2={y(t)}
                stroke="currentColor"
                strokeOpacity={t === 6 ? 0.25 : 0.06}
                strokeDasharray={t === 6 ? "3 3" : "none"}
              />
              <text
                x={padL - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="10"
                fill="currentColor"
                opacity={0.5}
              >
                {t}
              </text>
            </g>
          ))}
          {/* threshold mini-label, sits to the right end of the dashed line */}
          <text
            x={W - padR}
            y={y(6) - 4}
            textAnchor="end"
            fontSize="9"
            fill="currentColor"
            opacity={0.45}
          >
            buy ≥6
          </text>

          {/* dots */}
          {positioned.map((c) => {
            const style = decisionStyle(c.decision);
            const isHover = hoveredTicker === c.ticker;
            const r = isHover ? 9 : 7;
            const flipLeft = c._x + r + 5 + c._labelW > W - padR;
            const labelX = flipLeft ? c._x - r - 5 : c._x + r + 5;
            const needsConnector = Math.abs(c._labelY - c._y) > 1;
            return (
              <g key={c.ticker}>
                {needsConnector && (
                  <line
                    x1={c._x}
                    y1={c._y}
                    x2={labelX}
                    y2={c._labelY}
                    stroke="currentColor"
                    strokeOpacity={0.18}
                    strokeWidth={0.75}
                  />
                )}
                <circle
                  cx={c._x}
                  cy={c._y}
                  r={r}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={1.5}
                  onMouseEnter={() => setHoveredTicker(c.ticker)}
                  onMouseLeave={() => setHoveredTicker(null)}
                  style={{ cursor: "pointer", transition: "r 0.15s" }}
                />
                <text
                  x={labelX}
                  y={c._labelY}
                  textAnchor={flipLeft ? "end" : "start"}
                  dominantBaseline="middle"
                  className="text-[10.5px] fill-current mono"
                  fill="currentColor"
                  opacity={isHover ? 1 : 0.85}
                  style={{
                    pointerEvents: "none",
                    fontWeight: isHover ? 600 : 400,
                  }}
                >
                  {c.ticker}
                </text>
              </g>
            );
          })}

          {/* tooltip */}
          {hoveredTicker &&
            (() => {
              const c = positioned.find((p) => p.ticker === hoveredTicker);
              if (!c) return null;
              const tipW = 280;
              const tipH = 96;
              let tx = c._x + 14;
              let ty = c._y - tipH - 12;
              if (tx + tipW > W - 4) tx = c._x - tipW - 14;
              if (ty < 4) ty = c._y + 14;
              const mt = megatrendById(megatrends, c.megatrend);
              return (
                <g style={{ pointerEvents: "none" }}>
                  <rect
                    x={tx}
                    y={ty}
                    width={tipW}
                    height={tipH}
                    rx={8}
                    fill="var(--bg-card, white)"
                    stroke="currentColor"
                    strokeOpacity={0.18}
                    strokeWidth={1}
                  />
                  <text
                    x={tx + 12}
                    y={ty + 18}
                    className="text-[11px] fill-current"
                    fill="currentColor"
                    fontWeight={600}
                  >
                    {c.ticker} · {c.name}
                  </text>
                  <text
                    x={tx + 12}
                    y={ty + 34}
                    className="text-[9.5px] fill-current"
                    fill={mt?.color || "currentColor"}
                  >
                    {mt?.label}
                  </text>
                  <text
                    x={tx + 12}
                    y={ty + 52}
                    className="text-[9.5px] fill-current"
                    fill="currentColor"
                    opacity={0.85}
                  >
                    Score {c.patternScore.toFixed(1)} · {c.decision}
                  </text>
                  <foreignObject
                    x={tx + 12}
                    y={ty + 56}
                    width={tipW - 24}
                    height={tipH - 60}
                  >
                    <div
                      className="text-[9.5px] leading-snug"
                      style={{
                        color: "var(--text-secondary, #555)",
                        whiteSpace: "normal",
                      }}
                    >
                      {c.moat}
                    </div>
                  </foreignObject>
                </g>
              );
            })()}
        </svg>
      </div>
      <div
        className="px-6 py-4 flex items-center justify-end gap-4 flex-wrap"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <Legend />
      </div>
    </div>
  );
}

function Legend() {
  const items: { label: string; color: string }[] = [
    { label: "ADD", color: "#16a34a" },
    { label: "Own", color: "#3b82f6" },
    { label: "Watch", color: "#f59e0b" },
    { label: "Pass", color: "#94a3b8" },
    { label: "Prune", color: "#dc2626" },
  ];
  return (
    <div className="flex gap-3 flex-wrap">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: it.color }}
          />
          <span className="text-[10.5px] text-tertiary">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Layman-friendly titles + analogies for each of the 7 checks. Order matches
// the `criteria` array from megatrend_analysis.json. If the API ever changes
// the order, the index-pairing here will need a refresh.
const CRITERIA_LAYMAN: { title: string; analogy: string }[] = [
  {
    title: "The customer is in a real boom",
    analogy:
      "Like selling shovels during a gold rush — but only if the rush is real. If their customer (AI, defense, EV) is genuinely growing, the orders keep coming.",
  },
  {
    title: "Hard to replace",
    analogy:
      "If the customer can't easily switch to a competitor — because of certifications, designed-in parts, or long approvals — the supplier has pricing power.",
  },
  {
    title: "Orders piling up",
    analogy:
      "If they'll do ₹100 of work this year, they should already have ₹150+ booked on the order book. And it should be growing every quarter, not shrinking.",
  },
  {
    title: "Profits accelerating",
    analogy:
      "Two quarters in a row of >40% profit growth means the engine is hot, not a one-off. Operating leverage is kicking in.",
  },
  {
    title: "Capacity already built",
    analogy:
      "Factory and equipment are already there — no big new spending needed. So every new order falls mostly to the bottom line, not into more capex.",
  },
  {
    title: "Still cheap, not crowded",
    analogy:
      "If big funds already piled in and the stock is already expensive, the easy money is gone. We want to be early, before the crowd shows up.",
  },
  {
    title: "Chart looks healthy",
    analogy:
      "We don't fight the tape. Stock should be in an uptrend — trading above its 50-day and 200-day moving average — confirming the fundamentals story.",
  },
];

function CriteriaCard({ criteria }: { criteria: string[] }) {
  return (
    <div
      className="rounded-lg p-6 md:p-7"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <ol className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
        {criteria.map((c, i) => {
          const layman = CRITERIA_LAYMAN[i];
          return (
            <li
              key={i}
              className="flex gap-4 items-start py-4"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <span className="mono-true text-[11px] text-tertiary shrink-0 mt-0.5 w-5">
                0{i + 1}
              </span>
              <div className="flex-1 min-w-0">
                {layman ? (
                  <>
                    <div className="text-[13.5px] font-medium text-primary leading-snug mb-1">
                      {layman.title}
                    </div>
                    <p className="text-[12.5px] text-secondary leading-relaxed mb-2">
                      {layman.analogy}
                    </p>
                    <p className="text-[11.5px] text-tertiary leading-relaxed">
                      <span className="font-medium">What we check:</span> {c}
                    </p>
                  </>
                ) : (
                  <p className="text-[12.5px] text-secondary leading-relaxed">
                    {c}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CandidatesTable({
  candidates,
  megatrends,
  hoveredTicker,
  setHoveredTicker,
}: {
  candidates: AnalysisCandidate[];
  megatrends: Megatrend[];
  hoveredTicker: string | null;
  setHoveredTicker: (t: string | null) => void;
}) {
  const sorted = [...candidates].sort(
    (a, b) => b.patternScore - a.patternScore
  );

  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <ul>
        <li
          className="grid grid-cols-[140px_1fr_72px_104px] gap-x-6 items-center px-4 py-3 text-[11px] font-medium text-tertiary"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}
        >
          <span>Ticker</span>
          <span>Megatrend</span>
          <span className="text-right">Score</span>
          <span>Decision</span>
        </li>
        {sorted.map((c) => (
          <CandidateRow
            key={c.ticker}
            c={c}
            mt={megatrendById(megatrends, c.megatrend)}
            isHover={hoveredTicker === c.ticker}
            setHoveredTicker={setHoveredTicker}
          />
        ))}
      </ul>
    </section>
  );
}

function CandidateRow({
  c,
  mt,
  isHover,
  setHoveredTicker,
}: {
  c: AnalysisCandidate;
  mt: Megatrend | undefined;
  isHover: boolean;
  setHoveredTicker: (t: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      onMouseEnter={() => setHoveredTicker(c.ticker)}
      onMouseLeave={() => setHoveredTicker(null)}
      style={{
        borderBottom: "1px solid var(--border)",
        background: isHover ? "var(--bg-subtle)" : "transparent",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left grid grid-cols-[140px_1fr_72px_104px] gap-x-6 items-center px-4 py-3.5 accent-ring"
      >
        <div>
          <div className="font-medium mono-true text-primary text-[12.5px]">
            {c.ticker}
          </div>
          <div className="text-[10.5px] text-tertiary mt-0.5">{c.name}</div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-1 h-4 rounded-full shrink-0"
            style={{ background: mt?.color }}
          />
          <span className="text-secondary text-[11.5px] truncate">
            {mt?.label}
          </span>
        </div>
        <span
          className={`text-right mono-true text-[14px] ${
            c.patternScore >= 6
              ? "text-pos font-semibold"
              : c.patternScore >= 5
              ? "text-primary"
              : "text-tertiary"
          }`}
        >
          {c.patternScore.toFixed(1)}
        </span>
        <span>{decisionBadge(c.decision)}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-3 px-4 pb-5 text-[11.5px] leading-relaxed">
          <DetailItem label="Moat" value={c.moat} />
          <DetailItem label="Order book" value={c.orderBook} />
          <DetailItem label="Earnings" value={c.earnings} />
          <DetailItem label="Valuation" value={c.valuation} />
          <DetailItem label="Risk flag" value={c.riskFlag} tone="warn" />
        </div>
      )}
    </li>
  );
}

function DetailItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className={tone === "warn" ? "text-secondary" : "text-secondary"}>
        {value}
      </div>
    </div>
  );
}

// ---------- Journal (Tasks + Decisions) ----------

type AssetClass =
  | "in-equity"
  | "us-equity"
  | "mf"
  | "bonds"
  | "metals"
  | "other";

type TaskSource = "manual" | "us-research" | "mf-research";

type TaskActionType =
  | "buy"
  | "sell"
  | "trim"
  | "switch"
  | "rebalance"
  | "monitor"
  | "watch";

type TaskFlowEndpoint = {
  ticker: string;
  subtitle?: string;
};

type TaskFlow = {
  from: TaskFlowEndpoint;
  to: TaskFlowEndpoint;
  trigger: string;
  gap?: string;
  status?: "armed" | "near" | "fired" | "blocked";
  secondary?: string;
};

type TaskAnchor = {
  // "HOLD" for thesis holds, "GATE" for regime gates, "DECIDE" for pending user calls.
  label: string;
  summary: string;
};

type Task = {
  id: string;
  heading?: string;
  subheading?: string;
  priority?: "urgent" | "high" | "med" | "low";
  ticker?: string;
  amc?: string;
  // "cross" = cross-asset / regime tasks (e.g. deploy gate) that aren't a
  // single silo. Stored verbatim in tasks.json; not part of AssetClass.
  asset?: AssetClass | "cross";
  actionType?: TaskActionType;
  source?: TaskSource;
  // Legacy single-line text — displayed as heading when heading is missing.
  text?: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
  parkedAt?: string;
  // Flow tasks: source → trigger → destination. Renders as a money-flow row.
  flow?: TaskFlow;
  // Anchor tasks: pure monitor / regime gate / decision-pending. Renders as a pill.
  anchor?: TaskAnchor;
};

type TaskAssetFilter = "all" | AssetClass;

const ASSET_FILTER_OPTIONS: { value: TaskAssetFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in-equity", label: "IN equity" },
  { value: "us-equity", label: "US equity" },
  { value: "mf", label: "Mutual funds" },
  { value: "bonds", label: "Bonds" },
  { value: "metals", label: "Metals" },
];

function buildAssetCounts(items: { asset?: AssetClass | "cross" }[]): Record<TaskAssetFilter, number> {
  const c: Record<TaskAssetFilter, number> = {
    "all": items.length,
    "in-equity": 0,
    "us-equity": 0,
    "mf": 0,
    "bonds": 0,
    "metals": 0,
    "other": 0,
  };
  for (const it of items) {
    const a = (it.asset ?? "other") as AssetClass;
    c[a] = (c[a] ?? 0) + 1;
  }
  return c;
}

function assetFromTicker(ticker: string, usTickers: Set<string>): AssetClass {
  if (usTickers.has(ticker)) return "us-equity";
  if (/^GOLD|^SILVER/i.test(ticker)) return "metals";
  return "in-equity";
}

function deriveTaskAsset(t: Task, usTickers: Set<string>): AssetClass | "cross" {
  if (t.asset) return t.asset;
  if (t.ticker) return assetFromTicker(t.ticker, usTickers);
  const txt = `${t.heading ?? ""} ${t.subheading ?? ""} ${t.text ?? ""}`.toLowerCase();
  if (/\b(sdi|bond|treasur|debt|coupon)\b/.test(txt)) return "bonds";
  if (/\b(mutual fund|sip|nav|amc|elss)\b/.test(txt)) return "mf";
  if (/\bgold|silver|metal\b/.test(txt)) return "metals";
  return "other";
}

type Decision = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  qty?: number;
  price?: number;
  rationale: string;
  asset?: AssetClass;
  verdict: "good" | "bad" | "pending";
  reviewAt?: string;
  note?: string;
  // Enriched server-side from latest snapshot
  currentPrice?: number;
  sinceDecisionPct?: number;
  outcome?: "saved" | "missed" | "winning" | "losing" | "flat" | "exited";
};

function TasksTab() {
  return (
    <div className="space-y-7">
      <PageHero
        title="Tasks"
        info="Action items surfaced from portfolio checks, watchlist scans, and journal entries."      />
      <section>
        <TasksSection />
      </section>
    </div>
  );
}

function DecisionTrackerTab() {
  return (
    <div className="space-y-7">
      <PageHero
        title="Decision tracker"
        info="Logged decisions with entry price, current price, and verdict — to keep yourself honest."
      />
      <section className="px-1.5">
        <DecisionsSection />
      </section>
    </div>
  );
}

function StrategyLabTab() {
  return (
    <div className="space-y-7">
      <PageHero
        title="Strategy lab"
        info="Backtest of logged decisions, regime gate comparison, and rule scorecard. Built by scripts/backtest/run_all.py."
      />
      <StrategyLab />
    </div>
  );
}

type TaskActionFilter = "all" | TaskActionType;

const ACTION_FILTER_OPTIONS: { value: TaskActionFilter; label: string }[] = [
  { value: "all", label: "All actions" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "trim", label: "Trim" },
  { value: "switch", label: "Switch" },
  { value: "rebalance", label: "Rebalance" },
  { value: "monitor", label: "Monitor" },
  { value: "watch", label: "Watch" },
];

// Build US research tasks (concentration / drawdown / trim-candidate flags).
// Shared by TasksSection and OverviewTab so home card + tasks page stay in sync.
function buildUsResearchTasks(usData: USStocksData | null | undefined): Task[] {
  const positions = usData?.positions ?? [];
  const totalValue = usData?.totals?.currentINR ?? 0;
  const out: Task[] = [];
  for (const p of positions) {
    const weightPct = totalValue > 0 ? (p.currentINR / totalValue) * 100 : 0;
    if (weightPct > CONCENTRATION.usSingleName) {
      out.push({
        id: `usr-conc-${p.ticker}`,
        heading: `Trim ${p.ticker} — concentration ${weightPct.toFixed(1)}% of US book`,
        subheading: `Single-name weight breach: rule is <${CONCENTRATION.usSingleName}%. ${p.name}.`,
        priority: "high",
        ticker: p.ticker,
        asset: "us-equity",
        actionType: "trim",
        source: "us-research",
        done: false,
        createdAt: "—",
      });
      continue;
    }
    if (p.pnlPct < US_RESEARCH.reassessDrawdownPct) {
      out.push({
        id: `usr-reassess-${p.ticker}`,
        heading: `Reassess ${p.ticker} — ${p.pnlPct.toFixed(1)}%`,
        subheading: `${p.name}. Reassess thesis or harvest the loss for tax.`,
        priority: "high",
        ticker: p.ticker,
        asset: "us-equity",
        actionType: "watch",
        source: "us-research",
        done: false,
        createdAt: "—",
      });
    } else if (p.pnlPct > US_RESEARCH.trimWinnerPct) {
      out.push({
        id: `usr-trim-${p.ticker}`,
        heading: `Trim candidate ${p.ticker} — +${p.pnlPct.toFixed(1)}%`,
        subheading: `${p.name}. De-risk paper gains on a high-vol name.`,
        priority: "med",
        ticker: p.ticker,
        asset: "us-equity",
        actionType: "trim",
        source: "us-research",
        done: false,
        createdAt: "—",
      });
    }
  }
  return out;
}

// Build MF rotation tasks. Takes rotations as input (sourced from
// /api/mfrotations) so the data lives in memory/project_mf_rotations.json,
// not hardcoded in this file.
function buildMfResearchTasks(rotations: MFRotationItem[]): Task[] {
  const ACTION_TO_TYPE: Record<MFRotationItem["action"], TaskActionType> = {
    Switch: "switch",
    Kill: "sell",
    Exit: "sell",
    Consolidate: "switch",
    Promote: "buy",
    Cap: "watch",
    Watch: "watch",
  };
  return rotations.map((r, i) => ({
    id: `mfr-${i}-${r.scheme}`.replace(/\s+/g, "-"),
    heading: `${r.action} — ${r.scheme}`,
    subheading: r.impact ? `${r.reason} (${r.impact})` : r.reason,
    priority: (r.action === "Kill" || r.action === "Exit" ? "high" : "med") as Task["priority"],
    amc: r.amc,
    // Stash the scheme name so the staleness matcher can key on the instrument
    // (rotations carry no ticker; the scheme string holds the fund identity).
    text: r.scheme,
    asset: "mf" as const,
    actionType: ACTION_TO_TYPE[r.action],
    source: "mf-research" as const,
    done: false,
    createdAt: "—",
  }));
}

const SUGGESTION_SOURCES: ReadonlySet<TaskSource> = new Set(["us-research", "mf-research"]);

function isSuggestion(t: Task): boolean {
  return SUGGESTION_SOURCES.has((t.source ?? "manual") as TaskSource);
}

// Action families: a suggestion's intent is "realised" by a decision whose
// action sits in the same family. "exit/restructure" covers anything that
// reduces or replaces a position (Kill/Exit→sell, Switch/Consolidate→switch,
// trim); "add" covers Promote→buy. monitor/watch are observational — no
// decision ever closes them, so they never auto-expire.
const SUGGESTION_DECISION_FAMILY: Partial<Record<TaskActionType, ReadonlySet<string>>> = {
  sell: new Set(["SELL", "TRIM", "SWITCH", "EXIT", "REDEEM"]),
  trim: new Set(["SELL", "TRIM", "SWITCH"]),
  switch: new Set(["SWITCH", "SELL", "TRIM", "CONSOLIDATE", "EXIT", "REDEEM"]),
  buy: new Set(["BUY", "ADD"]),
};

function normTicker(s: string | undefined | null): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Alpha words of a scheme name, dropping plan-noise tokens that never appear in
// a ticker (REGULAR/DIRECT/PLAN/FUND…) and parenthetical hints. Used to test
// whether a decision ticker is a word-prefix acronym of the scheme.
const SCHEME_NOISE_WORDS = new Set([
  "FUND", "PLAN", "REGULAR", "DIRECT", "GROWTH", "SCHEME", "THE", "AND",
  "ASSET", "TAX", "SAVER", "TO", "FRESH", "DEPLOY", "CAP", "WATCH", "TER",
]);

function schemeWords(scheme: string | undefined | null): string[] {
  return (scheme ?? "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ") // drop "(Regular → Direct)" etc.
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length > 0 && !SCHEME_NOISE_WORDS.has(w));
}

/**
 * Does the decision ticker correspond to the scheme via the standard fund
 * shorthand — i.e. can `ticker` be consumed left-to-right by taking a leading
 * chunk from each scheme word in order? Examples:
 *   ACMEDY            ← Acme · Dividend · Yield   (Acme + D + Y)
 *   ZENLARGECAP       ← Zenith · Large · Cap
 *   ORBITPHARMA       ← Orbit · Pharma · Healthcare
 * Generic — no hardcoded tickers; works for any AMC-prefixed acronym ticker.
 */
function tickerMatchesScheme(ticker: string, scheme: string | undefined | null): boolean {
  const t = normTicker(ticker);
  if (!t) return false;
  const words = schemeWords(scheme);
  if (words.length === 0) return false;
  let pos = 0;
  for (const w of words) {
    if (pos >= t.length) break;
    // Greedily consume the longest leading overlap between the remaining ticker
    // and this word; every word must contribute at least its first letter.
    let k = 0;
    while (k < w.length && pos + k < t.length && t[pos + k] === w[k]) k++;
    if (k === 0) return false; // word contributed nothing → not this scheme
    pos += k;
  }
  return pos === t.length; // whole ticker accounted for by the scheme's words
}

/**
 * A derived suggestion is STALE once the action it proposes has already been
 * executed for that instrument — cross-referenced against the decisions log.
 * Honesty rule: an idea that's already been acted on is not a pending idea.
 *
 * Generic match (no hardcoded tickers/schemes):
 *   1. instrument — the suggestion's ticker (US) or scheme name (MF) must
 *      share identity with a decision ticker. We accept exact equality, the
 *      decision ticker appearing inside the normalised scheme, OR the decision
 *      ticker being the scheme's word-prefix acronym (handles "Acme Dividend
 *      Yield" → ACMEDY and "Zenith Large Cap (Regular → Direct)" → ZENLARGECAP).
 *   2. action — the decision's action must fall in the suggestion action's
 *      family. monitor/watch have no family, so they are never marked stale.
 */
function suggestionExecuted(t: Task, decisions: Decision[]): boolean {
  if (!isSuggestion(t)) return false;
  const family = t.actionType ? SUGGESTION_DECISION_FAMILY[t.actionType] : undefined;
  if (!family) return false; // monitor / watch — observational, never auto-expire
  const instrument = t.ticker ?? t.text; // US: ticker; MF: scheme name in text
  const key = normTicker(instrument);
  if (!key) return false;
  return decisions.some((d) => {
    if (!family.has((d.action ?? "").toUpperCase())) return false;
    const dt = normTicker(d.ticker);
    if (!dt) return false;
    return dt === key || key.includes(dt) || tickerMatchesScheme(dt, instrument);
  });
}

function TasksSection() {
  const [manualTasks, setManualTasks] = useState<Task[]>([]);
  const [usData, setUsData] = useState<USStocksData | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cap, setCap] = useState<number | null>(null);
  const [filter, setFilter] = useState<TaskAssetFilter>("all");
  const [actionFilter, setActionFilter] = useState<TaskActionFilter>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Open the explainer modal when TriggerBanner (or any other surface)
  // dispatches `dashboard:open-task`. Dashboard root handles the tab switch.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (id) setSelectedTaskId(id);
    };
    window.addEventListener("dashboard:open-task", onOpen);
    return () => window.removeEventListener("dashboard:open-task", onOpen);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then((r) => r.json()).catch(() => ({ tasks: [] })),
      fetch("/api/usstocks").then((r) => r.json()).catch(() => ({ data: null })),
      fetch("/api/decisions").then((r) => r.json()).catch(() => ({ decisions: [] })),
    ])
      .then(([tasksRes, usRes, decRes]) => {
        setManualTasks((tasksRes.tasks || []).map((t: Task) => ({
          ...t,
          source: t.source ?? "manual",
        })));
        const metaCap = (tasksRes?._meta as { cap?: number } | undefined)?.cap;
        if (typeof metaCap === "number") setCap(metaCap);
        if (usRes?.data) setUsData(usRes.data);
        setDecisions(decRes?.decisions || []);
      })
      .finally(() => setLoaded(true));
  }, [reloadKey]);

  const usTickers = useMemo(
    () => new Set((usData?.positions ?? []).map((p) => p.ticker)),
    [usData]
  );

  const mfRotations = useMFRotations();
  const usResearchTasks = useMemo<Task[]>(() => buildUsResearchTasks(usData), [usData]);
  const mfResearchTasks = useMemo<Task[]>(() => buildMfResearchTasks(mfRotations), [mfRotations]);

  // The REAL queue — tasks.json only. These are commitments and the only thing
  // the cap counts.
  const realTasks = useMemo<Task[]>(
    () =>
      manualTasks.map((t) => ({
        ...t,
        asset: deriveTaskAsset(t, usTickers),
      })),
    [manualTasks, usTickers]
  );

  // Derived SUGGESTIONS — computed client-side from live pnl + rotations. Ideas,
  // not commitments: they never count toward the cap, render in their own quiet
  // group, and drop out once the decisions log shows the action was executed.
  const suggestions = useMemo<Task[]>(
    () =>
      [...usResearchTasks, ...mfResearchTasks].filter(
        (t) => !t.done && !suggestionExecuted(t, decisions)
      ),
    [usResearchTasks, mfResearchTasks, decisions]
  );

  // allTasks (real + suggestions) backs the asset-filter pill counts and the
  // modal lookup. The cap, grouping, and over-cap banner read realTasks only.
  const allTasks = useMemo<Task[]>(
    () => [...realTasks, ...suggestions],
    [realTasks, suggestions]
  );

  const counts = useMemo(
    () => buildAssetCounts(allTasks.filter((t) => !t.done)),
    [allTasks]
  );

  const matchesFilter = useCallback(
    (t: Task) => {
      const assetMatch = filter === "all" || (t.asset ?? "other") === filter;
      const actionMatch = actionFilter === "all" || t.actionType === actionFilter;
      return assetMatch && actionMatch;
    },
    [filter, actionFilter]
  );

  const active = useMemo(
    () => realTasks.filter((t) => !t.done && matchesFilter(t)),
    [realTasks, matchesFilter]
  );
  const done = useMemo(
    () => realTasks.filter((t) => t.done && matchesFilter(t)),
    [realTasks, matchesFilter]
  );
  const visibleSuggestions = useMemo(
    () => suggestions.filter(matchesFilter).sort(sortInGroup),
    [suggestions, matchesFilter]
  );

  // Group active REAL tasks by priority. The group header IS the hierarchy —
  // nothing else on the row has to shout. Within a group, overdue rows float
  // to the top, then newest-first. Parked tasks are just priority:"low" and
  // fall into the Low group naturally (their "waiting" cue rides on the
  // blocked flow chip, not a separate section).
  const grouped = useMemo(() => {
    const out: Record<TaskGroupKey, Task[]> = {
      urgent: [],
      high: [],
      med: [],
      low: [],
    };
    for (const t of active) out[(t.priority ?? "low") as TaskGroupKey].push(t);
    for (const key of Object.keys(out) as TaskGroupKey[]) {
      out[key].sort(sortInGroup);
    }
    return out;
  }, [active]);

  // Cap is a property of the REAL queue (tasks.json), not the current view and
  // NOT the derived suggestions. Reading a filtered subset made the banner lie;
  // counting suggestions made it lie worse ("21/10" when only 10 are real).
  // Count unfiltered open real tasks instead.
  const openCount = realTasks.filter((t) => !t.done).length;
  const overCap = cap !== null && openCount >= cap;
  // A filter is narrowing the view iff either control is off "all".
  const filterActive = filter !== "all" || actionFilter !== "all";

  return (
    <div className="space-y-7">
      <Toolbar className="px-3 md:px-5">
        <ToolbarGroup>
          <Segmented<TaskAssetFilter>
            ariaLabel="Filter tasks by asset"
            value={filter}
            onChange={setFilter}
            options={ASSET_FILTER_OPTIONS.filter(
              (o) => o.value === "all" || counts[o.value] > 0
            ).map((o) => ({ value: o.value, label: o.label }))}
          />
        </ToolbarGroup>
        <ToolbarGroup>
          <FilterDropdown<TaskActionFilter>
            label="Action"
            ariaLabel="Filter by action type"
            value={actionFilter}
            onChange={setActionFilter}
            defaultValue="all"
            options={ACTION_FILTER_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
        </ToolbarGroup>
      </Toolbar>

      {!loaded ? (
        <Skeleton />
      ) : (
        <div className="space-y-7 px-1.5">
          {/* Over-cap banner reports the unfiltered queue, so it must render
              even when the current filter shows zero rows. */}
          {overCap && (
            <div
              className="mx-3 md:mx-5 mb-1 flex items-center justify-between gap-3 rounded-md px-3 py-2"
              style={{ background: "var(--warn-tint)" }}
            >
              <span className="text-[12px]" style={{ color: "var(--warn)" }}>
                Queue full. {openCount}/{cap} active. Close one before adding.
              </span>
              <span className="mono-true text-[11.5px]" style={{ color: "var(--warn)" }}>
                {openCount}/{cap}
              </span>
            </div>
          )}

          {active.length === 0 && visibleSuggestions.length === 0 ? (
            <EmptyState
              message={
                filterActive
                  ? "No tasks match this filter."
                  : "No open tasks. Queue is clear."
              }
            />
          ) : (
          <>
          {TASK_GROUPS.map((g) => {
            const rows = grouped[g.key];
            if (rows.length === 0) return null;
            const overdue = rows.filter((t) => overdueDays(t) > 0).length;
            return (
              <section key={g.key} className="space-y-1">
                <PriorityGroupHeader label={g.label} count={rows.length} overdue={overdue} />
                <ul
                  key={`${g.key}-${filter}-${actionFilter}`}
                  className="list-stagger"
                >
                  {rows.map((t, i) => (
                    <TaskRow
                      key={t.id}
                      t={t}
                      idx={i}
                      onClick={() => setSelectedTaskId(t.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          {/* Suggestions — derived from live pnl + MF rotations, never from
              tasks.json. They are ideas, not commitments: quieter tint, no age
              column (no createdAt), and they don't count toward the cap. Stale
              ones (already executed per the decisions log) are filtered out
              upstream. */}
          {visibleSuggestions.length > 0 && (
            <section className="space-y-1">
              <SuggestionsGroupHeader count={visibleSuggestions.length} />
              <ul
                key={`suggestions-${filter}-${actionFilter}`}
                className="list-stagger"
              >
                {visibleSuggestions.map((t, i) => (
                  <SuggestionRow
                    key={t.id}
                    t={t}
                    idx={i}
                    onClick={() => setSelectedTaskId(t.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          </>
          )}
        </div>
      )}

      {done.length > 0 && (
        <details className="mt-2 px-1.5">
          <summary
            className="flex items-baseline gap-2.5 px-3 md:px-5 py-3 cursor-pointer list-none
                       text-[15px] font-semibold tracking-[-0.005em] text-tertiary hover:text-secondary transition-colors"
          >
            Done
            <span className="mono-true text-[12.5px] text-tertiary">{done.length}</span>
          </summary>
          <ul className="list-stagger">
            {done.map((t, i) => (
              <li
                key={t.id}
                style={{ ["--idx" as string]: i }}
                onClick={() => setSelectedTaskId(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedTaskId(t.id);
                  }
                }}
                className="relative grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 py-4 px-1
                           cursor-pointer opacity-60 hover:opacity-100 transition-opacity accent-ring
                           after:content-[''] after:absolute after:bottom-0 after:left-[52px] after:right-1 after:h-px after:bg-[var(--border)]"
              >
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] justify-self-center"
                  style={{ background: "var(--pos-tint)", color: "var(--pos)" }}
                >
                  ✓
                </span>
                <span
                  className="text-[12.5px] text-tertiary leading-snug truncate line-through"
                  title={t.heading ?? t.text}
                >
                  {t.heading ?? t.text}
                </span>
                <span className="mono-true text-[11.5px] text-tertiary tabular-nums text-right">
                  {t.completedAt ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <TaskExplainerModal
        task={allTasks.find((t) => t.id === selectedTaskId) ?? null}
        onClose={() => setSelectedTaskId(null)}
        onTaskUpdated={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

const TASK_CHIP_PALETTE = [
  "#1f5db8",
  "#d23a35",
  "#f59e0b",
  "#4338ca",
  "#0d9488",
  "#7c3aed",
  "#0066b3",
  "#be185d",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function TaskChip({ task }: { task: Task }) {
  let label = "";
  if (task.amc) {
    label = task.amc
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 3)
      .toUpperCase();
  } else if (task.asset === "bonds") {
    label = "BD";
  } else {
    const txt = task.heading ?? task.text ?? "T";
    label = txt
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 2)
      .toUpperCase();
  }
  const seed = task.amc || task.heading || task.id;
  const color = TASK_CHIP_PALETTE[hashString(seed) % TASK_CHIP_PALETTE.length];
  return (
    <div
      className="rounded-lg flex items-center justify-center mono-true text-white shrink-0"
      style={{
        width: 36,
        height: 36,
        background: color,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "-0.02em",
      }}
      aria-label={label}
    >
      {label || "·"}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority grouping — the group header IS the hierarchy. Fixed order
// Urgent · High · Med · Low; Done collapses last. Replaces the old
// flow/anchor/parked/legacy card-grid split. Within a group, overdue rows
// float to the top, then newest-first.
// ─────────────────────────────────────────────────────────────────────────────

type TaskGroupKey = "urgent" | "high" | "med" | "low";

const TASK_GROUPS: { key: TaskGroupKey; label: string }[] = [
  { key: "urgent", label: "Urgent" },
  { key: "high", label: "High" },
  { key: "med", label: "Med" },
  { key: "low", label: "Low" },
];

function sortInGroup(a: Task, b: Task): number {
  const oa = overdueDays(a);
  const ob = overdueDays(b);
  if (oa > 0 !== (ob > 0)) return oa > 0 ? -1 : 1;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

const ACTION_SHORT: Record<TaskActionType, string> = {
  buy: "BUY",
  sell: "SELL",
  trim: "TRIM",
  switch: "SWITCH",
  rebalance: "REBAL",
  monitor: "MON",
  watch: "WATCH",
};

/**
 * Priority group header — a real section H2 (per DESIGN.md), with a count and
 * an overdue tally. The label text itself is the rank; no tint, no left mark.
 */
function PriorityGroupHeader({
  label,
  count,
  overdue,
}: {
  label: string;
  count: number;
  overdue: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 md:px-5 pb-1">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-primary">{label}</h2>
        <span className="mono-true text-[12.5px] text-tertiary">{count}</span>
      </div>
      {overdue > 0 && (
        <span className="mono-true text-[11.5px]" style={{ color: "var(--warn)" }}>
          {overdue} past&nbsp;limit
        </span>
      )}
    </div>
  );
}

/**
 * Single task row. One CSS-grid template, single-line label, signal in
 * columns. Priority is the group, so there is NO priority column on the row.
 *
 *   [ 40px chip ] [ action·ticker lead · heading ] [ status chip ] [ age ]
 *
 * Prose (subheading) and the flow from→to visual live in the modal only.
 */
function TaskRow({ t, idx, onClick }: { t: Task; idx?: number; onClick?: () => void }) {
  const heading = t.heading ?? t.text ?? "(untitled)";
  const meta = t.ticker ? getMeta(t.ticker) : null;
  const age = ageState(t);

  return (
    <li
      style={idx !== undefined ? ({ ["--idx" as string]: idx } as React.CSSProperties) : undefined}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="group relative grid grid-cols-[40px_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-5 px-1 cursor-pointer transition-colors hover:bg-[var(--bg-subtle)] accent-ring after:content-[''] after:absolute after:bottom-0 after:left-[52px] after:right-1 after:h-px after:bg-[var(--border)]"
    >
      {/* col 1 — chip / logo */}
      {t.ticker && meta ? (
        <LogoImg ticker={t.ticker} domain={meta.domain} size={40} />
      ) : t.asset === "cross" ? (
        <CrossChip />
      ) : (
        <TaskChip task={t} />
      )}

      {/* col 2 — lead + single-line heading, stacked horizontally (still one line) */}
      <div className="min-w-0 flex items-center gap-2.5">
        <ActionTickerLead t={t} />
        <span className="text-[13px] text-primary leading-snug truncate" title={heading}>
          {heading}
        </span>
      </div>

      {/* col 3 — status chip (flow.status OR anchor.label OR nothing) */}
      <div className="shrink-0">{statusChip(t)}</div>

      {/* col 4 — age vs lifetime */}
      <AgeColumn age={age} />
    </li>
  );
}

/**
 * Action-type glyph + ticker chip, both shrink-0, sitting before the heading
 * on the same baseline. This is a column, not a second line.
 */
function ActionTickerLead({ t }: { t: Task }) {
  return (
    <span className="flex items-center gap-2 shrink-0">
      {t.actionType && (
        <span className="mono-true text-[10px] uppercase tracking-[0.06em] text-tertiary w-[34px]">
          {ACTION_SHORT[t.actionType]}
        </span>
      )}
      {t.ticker && (
        <span
          className="mono-true text-[12.5px] font-semibold tracking-[0.01em] px-2 py-[3px] rounded text-primary"
          style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
        >
          {t.ticker}
        </span>
      )}
    </span>
  );
}

/**
 * Suggestions group header — same section-H2 shape as PriorityGroupHeader, but
 * the label is dimmed (text-tertiary) so the group reads as quieter than the
 * real-task ranks above it. No overdue tally: suggestions have no lifetime.
 */
function SuggestionsGroupHeader({ count }: { count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 md:px-5 pb-1">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-tertiary">Suggestions</h2>
        <span className="mono-true text-[12.5px] text-tertiary">{count}</span>
      </div>
    </div>
  );
}

/**
 * Suggestion row — a derived idea, not a commitment. Same grid law as TaskRow
 * (40px chip · single-line label · status · trailing column, tokens only, NO
 * side-stripe) but distinctly quieter: the heading rides text-tertiary, and the
 * trailing age column is dropped (suggestions carry no createdAt) in favour of a
 * static "idea" tag so the column grid still aligns with the real rows above.
 */
function SuggestionRow({ t, idx, onClick }: { t: Task; idx?: number; onClick?: () => void }) {
  const heading = t.heading ?? t.text ?? "(untitled)";
  const meta = t.ticker ? getMeta(t.ticker) : null;
  return (
    <li
      style={idx !== undefined ? ({ ["--idx" as string]: idx } as React.CSSProperties) : undefined}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="group relative grid grid-cols-[40px_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-5 px-1 cursor-pointer opacity-75 transition-all hover:opacity-100 hover:bg-[var(--bg-subtle)] accent-ring after:content-[''] after:absolute after:bottom-0 after:left-[52px] after:right-1 after:h-px after:bg-[var(--border)]"
    >
      {/* col 1 — chip / logo */}
      {t.ticker && meta ? (
        <LogoImg ticker={t.ticker} domain={meta.domain} size={40} />
      ) : (
        <TaskChip task={t} />
      )}

      {/* col 2 — lead + single-line heading; heading dimmed to read as an idea */}
      <div className="min-w-0 flex items-center gap-2.5">
        <ActionTickerLead t={t} />
        <span className="text-[13px] text-tertiary leading-snug truncate" title={heading}>
          {heading}
        </span>
      </div>

      {/* col 3 — status chip (none for suggestions today; keeps the grid aligned) */}
      <div className="shrink-0">{statusChip(t)}</div>

      {/* col 4 — no age (no createdAt); a static, dimmed marker holds the column */}
      <span className="mono-true text-[10px] uppercase tracking-[0.06em] text-tertiary tabular-nums text-right w-[58px]">
        idea
      </span>
    </li>
  );
}

/**
 * Status chip resolution (col 3) — first match wins:
 *   1. flow.status chip (the money-move state)
 *   2. anchor.label chip (HOLD / WATCH / GATE / DECIDE)
 *   3. nothing (the actionType lead already carries it)
 */
function statusChip(t: Task): React.ReactNode {
  if (t.flow) return <FlowStatusChip status={t.flow.status ?? "armed"} />;
  if (t.anchor) return <AnchorLabelChip label={t.anchor.label} />;
  return null;
}

function FlowStatusChip({ status }: { status: NonNullable<TaskFlow["status"]> }) {
  const s = {
    fired: { color: "var(--neg)", background: "var(--neg-tint)" },
    near: { color: "var(--warn)", background: "var(--warn-tint)" },
    armed: { color: "var(--text-secondary)", background: "var(--bg-subtle)" },
    blocked: { color: "var(--text-tertiary)", background: "var(--bg-subtle)" },
  }[status];
  return (
    <span
      className="mono-true text-[10px] font-semibold uppercase tracking-[0.06em] px-1.5 py-[3px] rounded"
      style={s}
    >
      {status}
    </span>
  );
}

function AnchorLabelChip({ label }: { label: string }) {
  // HOLD / WATCH stay neutral (a hold is not an alarm); GATE is warn; DECIDE is brand.
  const s =
    label === "GATE"
      ? { color: "var(--warn)", background: "var(--warn-tint)" }
      : label === "DECIDE"
      ? { color: "var(--brand)", background: "var(--brand-tint)" }
      : { color: "var(--text-tertiary)", background: "var(--bg-subtle)" };
  return (
    <span
      className="mono-true text-[10px] font-semibold uppercase tracking-[0.06em] px-1.5 py-[3px] rounded"
      style={s}
    >
      {label}
    </span>
  );
}

/**
 * Age column (col 4) — days-open vs tier lifetime, right-aligned mono.
 * Reads "9d / 7d" in warn when past tier limit, "3d / 30d" in tertiary
 * otherwise; "—" (tertiary, never warn) when createdAt is missing.
 */
function AgeColumn({ age }: { age: { open: number | null; limit: number; overdue: boolean } }) {
  if (age.open === null)
    return (
      <span className="mono-true text-[11.5px] text-tertiary tabular-nums text-right w-[58px]">
        —
      </span>
    );
  return (
    <span
      className="mono-true text-[11.5px] tabular-nums text-right w-[58px]"
      style={{ color: age.overdue ? "var(--warn)" : "var(--text-tertiary)" }}
    >
      {age.open}d / {age.limit}d
    </span>
  );
}

/** Regime/gate marker for ticker-less cross-asset tasks (asset === "cross"). */
function CrossChip() {
  return (
    <div
      className="rounded-lg flex items-center justify-center text-tertiary justify-self-center border border-dashed border-subtle bg-[var(--bg-subtle)]"
      style={{ width: 40, height: 40, fontSize: 15, fontWeight: 600 }}
      aria-label="cross-asset"
    >
      ⌖
    </div>
  );
}

function deriveDecisionAsset(d: Decision, usTickers: Set<string>): AssetClass {
  return d.asset ?? assetFromTicker(d.ticker, usTickers);
}

function DecisionsSection() {
  const [items, setItems] = useState<Decision[]>([]);
  const [usTickers, setUsTickers] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [filter, setFilter] = useState<TaskAssetFilter>("all");

  useEffect(() => {
    Promise.all([
      fetch("/api/decisions").then((r) => r.json()).catch(() => ({ decisions: [] })),
      fetch("/api/usstocks").then((r) => r.json()).catch(() => ({ data: null })),
    ])
      .then(([decRes, usRes]) => {
        setItems(decRes.decisions || []);
        if (usRes?.data?.positions) {
          setUsTickers(new Set(usRes.data.positions.map((p: { ticker: string }) => p.ticker)));
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const enriched = useMemo(
    () => items.map((d) => ({ ...d, asset: deriveDecisionAsset(d, usTickers) })),
    [items, usTickers]
  );

  const counts = useMemo(() => buildAssetCounts(enriched), [enriched]);

  const filtered = useMemo(
    () =>
      enriched.filter((d) =>
        filter === "all" ? true : (d.asset ?? "other") === filter
      ),
    [enriched, filter]
  );

  // Use the live `outcome` (computed in /api/decisions from current price)
  // rather than the stored `verdict`. Verdicts only auto-promote after a 30-day
  // holding window (VERDICT.minDaysHeld) so a verdict-only view freezes for
  // weeks. Outcome refreshes every fetch and gives a live read of how each
  // call is playing out.
  const tracked = filtered.filter(
    (i) => i.outcome && i.outcome !== "flat" && i.outcome !== "exited"
  );
  const good = tracked.filter(
    (i) => i.outcome === "winning" || i.outcome === "saved"
  ).length;
  const total = tracked.length;
  const hitRate = total > 0 ? Math.round((good / total) * 100) : null;

  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={() => setStatsOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 text-[12px] text-tertiary hover:text-primary transition-colors mb-3"
        >
          <span>{statsOpen ? "Hide stats" : "Show stats"}</span>
          <Chevron open={statsOpen} />
        </button>
        {statsOpen && (
          <div className="surface rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 md:grid-cols-4 -m-px">
              <CompactStat label="Logged" value={String(items.length)} />
              <CompactStat
                label="Tracked"
                value={`${total} / ${items.length}`}
              />
              <CompactStat
                label="Good"
                value={String(good)}
                accent={good > 0 ? "pos" : undefined}
              />
              <CompactStat
                label="Hit rate"
                value={hitRate !== null ? `${hitRate}%` : "—"}
                accent={
                  hitRate !== null
                    ? hitRate >= 60
                      ? "pos"
                      : hitRate < 40
                      ? "neg"
                      : undefined
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      <Toolbar className="px-3 md:px-5">
        <ToolbarGroup>
          <Segmented<TaskAssetFilter>
            ariaLabel="Filter decisions by asset"
            value={filter}
            onChange={setFilter}
            options={ASSET_FILTER_OPTIONS.filter(
              (o) => o.value === "all" || counts[o.value] > 0
            ).map((o) => ({ value: o.value, label: o.label }))}
          />
        </ToolbarGroup>
      </Toolbar>

      {!loaded ? (
        <Skeleton />
      ) : filtered.length ? (
        <DecisionTimeline key={filter} items={filtered} />
      ) : (
        <EmptyState message="No decisions in this filter." />
      )}
    </div>
  );
}

// Vertical timeline grouped by date, with each decision showing
// entry → current price and a since-decision delta.
function DecisionTimeline({ items }: { items: Decision[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, Decision[]>();
    for (const d of items) {
      const arr = map.get(d.date) ?? [];
      arr.push(d);
      map.set(d.date, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) => (a[0] < b[0] ? 1 : -1)
    );
  }, [items]);

  return (
    <div className="relative pl-8">
      <div
        className="absolute left-[11px] top-2 bottom-2 w-px"
        style={{ background: "var(--border)" }}
      />
      {grouped.map(([date, dayItems], gi) => (
        <section key={date} className="relative pb-12 last:pb-0">
          <div
            className="absolute -left-[26px] top-[10px] w-2.5 h-2.5 rounded-full"
            style={{
              background: "var(--brand)",
              boxShadow: "0 0 0 4px var(--bg-base)",
            }}
          />
          <div className="type-body-sm font-medium text-primary mb-5">
            {formatDateLabel(date)}
          </div>
          <ul className="list-stagger space-y-5">
            {dayItems.map((d, i) => (
              <TimelineDecision key={d.id} d={d} idx={gi * 4 + i} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TimelineDecision({ d, idx }: { d: Decision; idx?: number }) {
  const meta = getMeta(d.ticker);

  // Action verb (inline colored prefix, not a Tag chrome).
  const actionVerb =
    d.action === "BUY"
      ? "Bought"
      : d.action === "SELL"
      ? "Sold"
      : d.action === "TRIM"
      ? "Trimmed"
      : d.action;
  const actionVerbCls =
    d.action === "BUY"
      ? "text-pos"
      : d.action === "SELL" || d.action === "TRIM"
      ? "text-neg"
      : "text-secondary";

  // Since-decision delta — for SELL/TRIM, price going DOWN after we sold is good.
  const isSell = d.action === "SELL" || d.action === "TRIM";
  const pct = d.sinceDecisionPct;
  const deltaIsFavourable =
    pct === undefined ? null : isSell ? pct < 0 : pct > 0;
  const deltaCls =
    deltaIsFavourable === null
      ? "text-tertiary"
      : deltaIsFavourable
      ? "text-pos"
      : "text-neg";
  const deltaLabel = pct === undefined ? "—" : fmtPct(pct, 1);
  const sellHint =
    pct === undefined || !isSell
      ? null
      : pct < 0
      ? `Dodged a ${fmtPct(pct, 1)} drop`
      : `Gave up ${fmtPct(pct, 1)} upside`;

  const outcomeLabelMap: Record<NonNullable<Decision["outcome"]>, string> = {
    saved: "Good exit",
    missed: "Missed upside",
    winning: "Winning",
    losing: "Losing",
    flat: "Flat",
    exited: "Exited · untracked",
  };
  const outcomeBadge =
    d.outcome && d.outcome !== "exited" ? (
      <Tag
        label={outcomeLabelMap[d.outcome]}
        tone={deltaIsFavourable ? "pos" : "neg"}
      />
    ) : d.outcome === "exited" ? (
      <Tag label="Exited · untracked" tone="neutral" />
    ) : null;

  const verdictBadge =
    d.verdict === "good" ? (
      <Tag label="Good call" tone="pos" />
    ) : d.verdict === "bad" ? (
      <Tag label="Bad call" tone="neg" />
    ) : null;

  return (
    <li
      className="surface rounded-lg p-5"
      style={idx !== undefined ? { ["--idx" as string]: idx } : undefined}
    >
      <div className="flex items-start gap-3.5">
        <LogoImg ticker={d.ticker} domain={meta.domain} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex items-baseline gap-2 flex-wrap min-w-0">
              <span className={`font-semibold text-[13.5px] ${actionVerbCls}`}>
                {actionVerb}
              </span>
              <span className="font-semibold mono-true text-primary text-[14px]">
                {d.ticker}
              </span>
              {d.qty && d.price !== undefined && (
                <span className="type-caption text-tertiary mono-true">
                  {d.qty} × ₹{fmtINR(d.price)}
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3 flex-wrap">
              {d.price !== undefined && d.currentPrice !== undefined && (
                <div className="flex items-center gap-2 type-caption mono-true whitespace-nowrap">
                  <span className="text-tertiary">₹{fmtINR(d.price)}</span>
                  <span className="text-tertiary opacity-60">→</span>
                  <span className="text-primary">
                    ₹{fmtINR(d.currentPrice)}
                  </span>
                  <span className={deltaCls}>{deltaLabel}</span>
                </div>
              )}
            </div>
          </div>
          {d.rationale && (
            <p className="text-[13px] text-secondary leading-relaxed mt-2 max-w-[68ch]">
              {d.rationale}
            </p>
          )}
          {(outcomeBadge || verdictBadge || sellHint) && (
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {outcomeBadge}
              {verdictBadge}
              {sellHint && (
                <span className="text-[11.5px] text-tertiary">· {sellHint}</span>
              )}
            </div>
          )}
          {d.note && (
            <p className="text-[11.5px] text-tertiary mt-2 leading-relaxed">
              {d.note}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


// ---------- Shared UI ----------

// ---------- Brief workflow ----------

type BriefData = {
  snapshot: Snapshot | null;
  watchlist: WatchlistEntry[];
};

type JournalEntry = {
  at: string;
  date: string;
  capital?: { amount?: number; note?: string };
  urgentReviewed?: number;
  totalValue?: number;
  todayMovePct?: number;
  regime?: string;
  userNote?: string;
};

type BriefAction = {
  itemId: string;
  status: "acted" | "snoozed";
  at: string;
  until?: string;
  note?: string;
};

function BriefModal({
  onClose,
  goToTab,
}: {
  onClose: () => void;
  goToTab: (t: TabId) => void;
}) {
  const [step, setStep] = useState(0);
  const [capital, setCapital] = useState({ added: "", note: "" });
  const [data, setData] = useState<BriefData | null>(null);
  const [lastBrief, setLastBrief] = useState<JournalEntry | null>(null);
  const [actions, setActions] = useState<BriefAction[]>([]);
  const [submitted, setSubmitted] = useState({
    capital: false,
    journal: false,
  });
  // Synchronous guards — React state updates are async and don't protect
  // against rapid sequential close paths (Esc + backdrop + close button).
  const journalLockRef = useRef(false);
  const capitalLockRef = useRef(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/snapshot").then((r) => r.json()),
      fetch("/api/watchlist").then((r) => r.json()),
      fetch("/api/brief/journal").then((r) => r.json()),
      fetch("/api/brief/actions").then((r) => r.json()),
    ])
      .then(([s, w, j, a]) => {
        setData({
          snapshot: s.data || null,
          watchlist: w.entries || [],
        });
        const entries: JournalEntry[] = j.data?.entries || [];
        setLastBrief(entries[0] || null);
        setActions(a.data?.actions || []);
      })
      .catch(() => setData({ snapshot: null, watchlist: [] }));
  }, []);

  const refreshActions = useCallback(async () => {
    try {
      const r = await fetch("/api/brief/actions");
      const j = await r.json();
      setActions(j.data?.actions || []);
    } catch {
      // ignore — UI will retry on next mount
    }
  }, []);

  const submitCapital = useCallback(async () => {
    const amount = parseFloat(capital.added);
    if (!isFinite(amount) || amount <= 0) return; // skip if blank/invalid
    if (capitalLockRef.current) return;
    capitalLockRef.current = true;
    try {
      await fetch("/api/brief/capital", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, note: capital.note || undefined }),
      });
      setSubmitted((s) => ({ ...s, capital: true }));
    } catch {
      capitalLockRef.current = false; // allow retry on next Next click
    }
  }, [capital]);

  const submitJournal = useCallback(async () => {
    if (journalLockRef.current) return;
    journalLockRef.current = true;
    const s = data?.snapshot;
    const amount = parseFloat(capital.added);
    const todayMovePct =
      s && s.totalValue > 0
        ? s.holdings.reduce(
            (sum, h) => sum + ((h.dayChangePct ?? 0) / 100) * h.value,
            0
          ) / s.totalValue * 100
        : undefined;
    try {
      await fetch("/api/brief/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capital:
            isFinite(amount) && amount > 0
              ? { amount, note: capital.note || undefined }
              : undefined,
          urgentReviewed: s?.urgent?.length ?? 0,
          totalValue: s?.totalValue,
          todayMovePct,
          regime: s?.regime,
          userNote: capital.note || undefined,
        }),
      });
      setSubmitted((sub) => ({ ...sub, journal: true }));
    } catch {
      journalLockRef.current = false; // allow retry; lock blocks dup writes
    }
  }, [data, capital]);

  // Esc to close — also flushes journal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        submitJournal().finally(onClose);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, submitJournal]);

  const handleClose = () => {
    submitJournal().finally(onClose);
  };

  const totalSteps = 4;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card w-full max-w-xl max-h-[90vh] overflow-y-auto no-scrollbar rounded-lg diffuse"
        style={{ background: "var(--bg-card)" }}
      >
        {/* Header */}
        <div
          className="px-7 pt-6 pb-4 flex items-baseline justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <div className="text-[11px] text-tertiary mb-1 inline-flex items-baseline gap-2">
              Daily brief
              {lastBrief && (
                <span className="text-tertiary">
                  · last {humanizeDaysAgo(lastBrief.at)}
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold text-primary tracking-tight">
              {step === 0 && "Anything fresh?"}
              {step === 1 && "Recap"}
              {step === 2 && "Time-sensitive"}
              {step === 3 && "Done"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="mono-true text-[11px] text-tertiary">
              {step + 1} / {totalSteps}
            </span>
            <button
              onClick={handleClose}
              className="text-tertiary hover:text-primary text-2xl leading-none accent-ring"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Step content */}
        <div className="px-7 py-6 min-h-[260px]">
          {!data && <Skeleton />}
          {data && step === 0 && (
            <BriefStepCapital
              capital={capital}
              setCapital={setCapital}
            />
          )}
          {data && step === 1 && (
            <BriefStepRecap data={data} goToTab={goToTab} />
          )}
          {data && step === 2 && (
            <BriefStepTimeSensitive
              data={data}
              goToTab={goToTab}
              actions={actions}
              refreshActions={refreshActions}
            />
          )}
          {data && step === 3 && (
            <BriefStepDone
              data={data}
              capital={capital}
              lastBrief={lastBrief}
            />
          )}
        </div>

        {/* Footer */}
        <div
          className="px-7 py-4 flex items-center justify-between"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={() => (step > 0 ? setStep(step - 1) : handleClose())}
            className="text-[12px] text-tertiary hover:text-primary accent-ring"
          >
            {step > 0 ? "← Back" : "Cancel"}
          </button>
          <button
            onClick={async () => {
              // Submit capital when leaving step 0
              if (step === 0) await submitCapital();
              if (step < totalSteps - 1) setStep(step + 1);
              else handleClose();
            }}
            className="text-[12.5px] font-medium px-4 py-2 rounded-lg accent-ring transition-colors"
            style={{
              background: "var(--brand)",
              color: "var(--brand-fg)",
            }}
          >
            {step < totalSteps - 1 ? "Next →" : "Close"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function humanizeDaysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "a week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

function BriefStepCapital({
  capital,
  setCapital,
}: {
  capital: { added: string; note: string };
  setCapital: (c: { added: string; note: string }) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-secondary leading-relaxed">
        Quick context before we dive in. Skip anything that doesn't apply.
      </p>
      <div>
        <label className="eyebrow block mb-2">Fresh capital today (₹)</label>
        <input
          type="number"
          value={capital.added}
          onChange={(e) => setCapital({ ...capital, added: e.target.value })}
          placeholder="0"
          className="w-full px-3 py-2 rounded-lg mono-true text-[14px] accent-ring"
          style={{
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </div>
      <div>
        <label className="eyebrow block mb-2">Anything I should know?</label>
        <textarea
          value={capital.note}
          onChange={(e) => setCapital({ ...capital, note: e.target.value })}
          placeholder="e.g. trimmed a position, exited a stock, plan to add to a holding"
          rows={3}
          className="w-full px-3 py-2 rounded-lg text-[12.5px] accent-ring resize-none"
          style={{
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </div>
    </div>
  );
}

function BriefStepRecap({
  data,
  goToTab,
}: {
  data: BriefData;
  goToTab: (t: TabId) => void;
}) {
  const s = data.snapshot;
  if (!s) return <EmptyState message="No snapshot data." />;
  const todayMove = s.holdings.reduce(
    (sum, h) => sum + ((h.dayChangePct ?? 0) / 100) * h.value,
    0
  );
  const sortedToday = [...s.holdings].sort(
    (a, b) => (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0)
  );
  const best = sortedToday[0];
  const worst = sortedToday[sortedToday.length - 1];

  return (
    <div className="space-y-5">
      <div>
        <div className="eyebrow mb-1.5">Where you stand</div>
        <div className="text-[13px] text-secondary leading-relaxed">
          {s.regime || "—"}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-6">
        <BriefMetric
          label="Portfolio"
          value={`₹${fmtINR(s.totalValue)}`}
        />
        <BriefMetric
          label="Today"
          value={`${todayMove >= 0 ? "+" : ""}₹${fmtINR(
            Math.round(todayMove)
          )}`}
          tone={todayMove >= 0 ? "pos" : "neg"}
        />
        <BriefMetric
          label="Cash"
          value={`₹${fmtINR(s.cash || 0)}`}
        />
      </div>
      {best && worst && best.ticker !== worst.ticker && (
        <div className="grid grid-cols-2 gap-x-6 pt-2">
          <BriefMover ticker={best.ticker} pct={best.dayChangePct} tone="pos" />
          <BriefMover ticker={worst.ticker} pct={worst.dayChangePct} tone="neg" />
        </div>
      )}
      <button
        onClick={() => goToTab("holdings")}
        className="text-[11.5px] text-tertiary hover:text-primary mono-true accent-ring"
      >
        view all holdings →
      </button>
    </div>
  );
}

function BriefStepTimeSensitive({
  data,
  goToTab,
  actions,
  refreshActions,
}: {
  data: BriefData;
  goToTab: (t: TabId) => void;
  actions: BriefAction[];
  refreshActions: () => Promise<void>;
}) {
  const s = data.snapshot;
  const allUrgent = s?.urgent || [];

  // Build stable itemId from urgent flag — index-stable across same payload
  const itemIdFor = (u: UrgentItem, i: number) =>
    `urgent:${u.ticker || "n"}:${i}:${(u.headline || "")
      .slice(0, 24)
      .replace(/\s+/g, "_")}`;

  const handledIds = new Set(actions.map((a) => a.itemId));
  // Preserve original index — don't use indexOf, which collides on identical
  // urgent payloads.
  const indexedUrgent = allUrgent.map((u, originalIndex) => ({
    u,
    originalIndex,
    id: itemIdFor(u, originalIndex),
  }));
  const visibleUrgent = indexedUrgent.filter(
    ({ id }) => !handledIds.has(id)
  );
  const handledCount = indexedUrgent.length - visibleUrgent.length;

  // Watchlist entries that are genuinely "ready to buy" today — not
  // conditional, not waiting, not owned.
  const ownedTickers = new Set(s?.holdings.map((h) => h.ticker) || []);
  const triggers = data.watchlist.filter((w) => {
    if (ownedTickers.has(w.ticker)) return false;
    return isActionableTrigger(w.entryTrigger);
  });

  const hasAny = visibleUrgent.length > 0 || triggers.length > 0;

  const submitAction = async (itemId: string, status: "acted" | "snoozed") => {
    try {
      await fetch("/api/brief/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, status }),
      });
      await refreshActions();
    } catch {
      // best-effort; UI will show stale state until next refresh
    }
  };

  if (!hasAny) {
    return (
      <div className="text-[13px] text-secondary leading-relaxed space-y-2">
        <p>
          Nothing urgent. No portfolio rules tripped and no watchlist names ready to buy.
        </p>
        {handledCount > 0 && (
          <p className="text-[11px] text-tertiary">
            {handledCount} item{handledCount === 1 ? "" : "s"} acted on or
            snoozed earlier.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {visibleUrgent.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-[11px] text-tertiary">Things to look at</span>
            {handledCount > 0 && (
              <span className="text-[10.5px] text-tertiary">
                {handledCount} acted/snoozed
              </span>
            )}
          </div>
          <ul className="space-y-4">
            {visibleUrgent.map(({ u, id }) => {
              return (
                <li key={id} className="flex items-start gap-3">
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                    style={{
                      background:
                        u.level === "crit"
                          ? "var(--neg)"
                          : u.level === "warn"
                          ? "var(--warn)"
                          : "var(--text-tertiary)",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-primary leading-snug">
                      {u.ticker && (
                        <span className="font-semibold mono-true mr-1.5">
                          {u.ticker}
                        </span>
                      )}
                      <span className="text-secondary">
                        {u.headline}
                      </span>
                    </div>
                    {u.action && (
                      <div className="text-[11.5px] text-tertiary mt-1 leading-snug">
                        {u.action}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => submitAction(id, "acted")}
                        className="text-[10.5px] text-secondary hover:text-pos accent-ring transition-colors"
                      >
                        Mark acted
                      </button>
                      <span className="text-tertiary text-[10px]">·</span>
                      <button
                        onClick={() => submitAction(id, "snoozed")}
                        className="text-[10.5px] text-secondary hover:text-primary accent-ring transition-colors"
                      >
                        Snooze 7 days
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {triggers.length > 0 && (
        <div>
          <div className="text-[11px] text-tertiary mb-3">
            Watchlist names ready to buy
          </div>
          <ul className="space-y-2">
            {triggers.slice(0, 5).map((w) => (
              <li
                key={w.ticker}
                className="text-[12.5px] flex items-baseline gap-3"
              >
                <span className="mono-true font-semibold text-primary shrink-0 w-24">
                  {w.ticker}
                </span>
                <span className="text-secondary truncate flex-1">
                  {shortenTrigger(w.entryTrigger)}
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => goToTab("stockresearch")}
            className="text-[11.5px] text-tertiary hover:text-primary accent-ring mt-3"
          >
            See all ideas →
          </button>
        </div>
      )}
    </div>
  );
}


// True only when the trigger clearly says "go" — e.g. "trigger hit", "now
// possible", "starter on...", "buy now". Filters out conditionals ("only if",
// "wait for"), neutral zones, and false-positives from substring matches.
function isActionableTrigger(trigger?: string): boolean {
  if (!trigger) return false;
  // Negative signals — explicit wait / conditional / neutral language.
  // If any of these are present, the trigger is NOT ready.
  if (
    /\b(only\s+if|wait\s+for|pending|hold\s+off|neutral\s+zone|don[‘’’]t\s+chase|too\s+early)\b/i.test(
      trigger
    )
  ) {
    return false;
  }
  // Positive signals — explicit go indicators. Word-bounded to avoid
  // false substring matches inside longer ticker symbols.
  return /\b(trigger\s+hit|now\s+possible|ready\s+to\s+buy|buy\s+now|starter\s+(?:on|now)|first\s+small\s+starter)\b/i.test(
    trigger
  );
}

function shortenTrigger(text?: string): string {
  if (!text) return "—";
  // Common patterns to short summaries
  if (/TRIGGER HIT/i.test(text)) return "Trigger hit — ready to buy";
  if (/breakout/i.test(text) && /pullback/i.test(text))
    return "Buy on pullback or breakout";
  if (/starter/i.test(text)) return "Take a small starter position";
  if (/Accumulate/i.test(text)) return "Accumulate on dips";
  // Otherwise truncate
  return text.length > 60 ? text.slice(0, 58).trim() + "…" : text;
}

function BriefStepDone({
  data,
  capital,
  lastBrief,
}: {
  data: BriefData;
  capital: { added: string; note: string };
  lastBrief: JournalEntry | null;
}) {
  const s = data.snapshot;
  const urgentCount = s?.urgent?.length || 0;
  const freshAmt = parseFloat(capital.added);
  const fresh =
    isFinite(freshAmt) && freshAmt > 0 ? `₹${fmtINR(freshAmt)}` : null;

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-secondary leading-relaxed">
        You&apos;re up to speed. Closing this saves today&apos;s entry to your
        journal.
      </p>
      <div className="space-y-2">
        {fresh && (
          <BriefBullet>
            Logged fresh capital:{" "}
            <strong className="text-primary mono-true">{fresh}</strong>
          </BriefBullet>
        )}
        {urgentCount > 0 ? (
          <BriefBullet>
            <strong className="text-primary">{urgentCount}</strong> urgent flag
            {urgentCount === 1 ? "" : "s"} reviewed.
          </BriefBullet>
        ) : (
          <BriefBullet>No urgent flags. Portfolio on thesis.</BriefBullet>
        )}
        {capital.note && (
          <BriefBullet>
            Note:{" "}
            <span className="text-secondary italic">
              &quot;{capital.note}&quot;
            </span>
          </BriefBullet>
        )}
      </div>

      {lastBrief && (
        <div
          className="pt-4 mt-2 text-[11.5px] text-tertiary leading-relaxed"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <span className="text-[11px] text-tertiary mr-2 font-medium">Previously</span>
          Last brief {humanizeDaysAgo(lastBrief.at)}
          {lastBrief.urgentReviewed != null
            ? `, ${lastBrief.urgentReviewed} flag${
                lastBrief.urgentReviewed === 1 ? "" : "s"
              } reviewed`
            : ""}
          {lastBrief.capital?.amount
            ? `, +₹${fmtINR(lastBrief.capital.amount)} capital logged`
            : ""}
          .
        </div>
      )}
    </div>
  );
}

function BriefMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  const cls =
    tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-primary";
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={`text-xl mono-true font-semibold ${cls} leading-none`}>
        {value}
      </div>
    </div>
  );
}

function BriefMover({
  ticker,
  pct,
  tone,
}: {
  ticker: string;
  pct?: number;
  tone: "pos" | "neg";
}) {
  const cls = tone === "pos" ? "text-pos" : "text-neg";
  return (
    <div>
      <div className="eyebrow mb-1.5">{tone === "pos" ? "Best today" : "Worst today"}</div>
      <div className="flex items-baseline gap-2">
        <span className="mono-true text-[13px] font-medium text-primary">
          {ticker}
        </span>
        <span className={`mono-true text-[12px] ${cls}`}>
          {pct !== undefined ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function BriefBullet({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[12.5px] text-secondary py-2.5 px-3 rounded-lg flex items-start gap-2"
      style={{ background: "var(--bg-subtle)" }}
    >
      <span className="text-pos mt-0.5">✓</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

function ageHoursFromISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function PageHero({
  title,
  subtitle,
  info,
  actions,
  children,
  headerClassName,
  stale,
}: {
  title: React.ReactNode;
  subtitle?: string;
  info?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  headerClassName?: string;
  stale?: { source: string; ageHours: number } | null;
}) {
  const showStale = !!stale && stale.ageHours > 24;
  return (
    <div className="space-y-8">
      <header className={`flex items-center justify-between gap-5 flex-wrap ${headerClassName ?? "px-1.5"}`}>
        <div className="min-w-0">
          <h1
            className="text-[20px] md:text-[24px] leading-[1.05] font-black tracking-[-0.02em] text-primary inline-flex items-center gap-2 uppercase"
            style={{
              fontFamily: "var(--font-display-wide), system-ui, sans-serif",
              fontStretch: "120%",
            }}
          >
            {title}
            {info && <InfoTip text={info} />}
            {showStale && stale && (
              <span
                className="mono-true normal-case tracking-normal font-medium text-[10.5px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                style={{
                  background: "var(--warn-tint)",
                  color: "var(--warn)",
                  border: "1px solid var(--warn-tint)",
                }}
                title={`Last updated ${Math.round(stale.ageHours)}h ago from ${stale.source}. Run /portfolio-check to refresh.`}
              >
                STALE
                <span aria-hidden="true">·</span>
                <span>{stale.source}</span>
                <span>{Math.round(stale.ageHours)}h</span>
              </span>
            )}
          </h1>
          {subtitle && (
            <p className="text-[12.5px] text-tertiary mt-2 leading-snug">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      {children && (
        <section className="surface rounded-lg overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4 -m-px">
            {children}
          </div>
        </section>
      )}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  mtime,
  actions,
  info,
}: {
  title: React.ReactNode;
  subtitle?: string;
  mtime?: string | null;
  actions?: React.ReactNode;
  info?: string;
}) {
  return (
    <header
      className="flex items-baseline justify-between gap-6 flex-wrap pb-4 mb-3"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[22px] md:text-[26px] leading-none font-semibold text-primary inline-flex items-center">
          {title}
          {info && <InfoTip text={info} />}
        </h1>
        {subtitle && (
          <span className="mono-true text-[12px] text-tertiary">
            {subtitle}
          </span>
        )}
        {mtime && (
          <span className="mono-true text-[10.5px] text-tertiary">
            · updated {formatShort(mtime)}
          </span>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </header>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="surface rounded-lg p-10 text-sm text-tertiary text-center">
      {message}
    </div>
  );
}

/** Full-area shimmer — a white wash sitting over the page's grey background,
 *  pulsing visibly. When `fadingOut` is true the overlay fades to 0 over
 *  600ms (matched to the content slide-in underneath) so the BG colour
 *  transitions smoothly without a jump. */
function Skeleton({ fadingOut = false }: { fadingOut?: boolean }) {
  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 md:left-72 z-10 pointer-events-none transition-opacity duration-[400ms] ease-in-out"
      style={{
        background: "var(--bg-base)",
        opacity: fadingOut ? 0 : 1,
        animation: "pulse 1500ms cubic-bezier(0.4, 0, 0.6, 1) infinite",
      }}
    />
  );
}

function ConfidenceBadge({ value }: { value?: string }) {
  if (!value) return null;
  const upper = value.toUpperCase();
  const level =
    upper.match(/(HIGH|MEDIUM-HIGH|MEDIUM|LOW-MEDIUM|LOW)/)?.[0] ??
    upper.split(/[\s—\-(]/)[0];
  const isHigh = level.includes("HIGH") && !level.includes("LOW");
  const isLow = level.includes("LOW") && !level.includes("HIGH");
  const tone: TagTone = isHigh ? "pos" : isLow ? "neg" : "warn";
  return <Tag label={level} tone={tone} />;
}

function fmtINR(n: number | null | undefined) {
  if (n === undefined || n === null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n === undefined || n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}


function formatShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
