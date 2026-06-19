import os from "node:os";
import path from "node:path";

const home = os.homedir();
// Claude's memory folder is the home path with every "/" turned into "-"
// (e.g. /Users/jane -> -Users-jane). Derive it so no username is hardcoded;
// set PORTFOLIO_MEMORY_DIR to override for a different machine or layout.
const projectSlug = home.replace(/\//g, "-");
export const MEMORY_DIR =
  process.env.PORTFOLIO_MEMORY_DIR ??
  path.join(home, ".claude", "projects", projectSlug, "memory");
export const SNAPSHOT_FILE = path.join(MEMORY_DIR, "latest_snapshot.json");
export const REPORTS_DIR = path.join(MEMORY_DIR, "daily_market_reports");
export const WATCHLIST_FILE = path.join(MEMORY_DIR, "project_stock_watchlist.md");
export const PORTFOLIO_FILE = path.join(MEMORY_DIR, "project_investment_portfolio.md");
export const MUTUAL_FUNDS_FILE = path.join(MEMORY_DIR, "project_mutual_funds.md");
export const US_STOCKS_FILE = path.join(MEMORY_DIR, "us_stocks.json");
export const BONDS_FILE = path.join(MEMORY_DIR, "bonds.json");
export const ANALYSIS_FILE = path.join(MEMORY_DIR, "megatrend_analysis.json");
export const BACKTEST_FILE = path.join(MEMORY_DIR, "backtest_results.json");

// Brief modal persistence
export const PORTFOLIO_HISTORY_FILE = path.join(MEMORY_DIR, "portfolio_history.json");
export const BRIEF_ACTIONS_FILE = path.join(MEMORY_DIR, "brief_actions.json");
export const BRIEF_JOURNAL_FILE = path.join(MEMORY_DIR, "brief_journal.json");
export const NEWS_CACHE_FILE = path.join(MEMORY_DIR, "news_cache.json");
export const EARNINGS_OUTLOOK_FILE = path.join(MEMORY_DIR, "earnings_outlook.json");
export const EARNINGS_DATA_FILE = path.join(MEMORY_DIR, "earnings_data.json");
export const TASKS_FILE = path.join(MEMORY_DIR, "tasks.json");
export const DECISIONS_FILE = path.join(MEMORY_DIR, "decisions.json");
export const TRIGGERS_FILE = path.join(MEMORY_DIR, "triggers.json");

// ───────────────────────────────────────────────────────────────────────────
// Foundation: per-user profile + research data + first-run UI state.
// ───────────────────────────────────────────────────────────────────────────
export const PROFILE_FILE = path.join(MEMORY_DIR, "profile.json");
export const STRATEGY_FILE = path.join(MEMORY_DIR, "strategy.md");
export const RESEARCH_DIR = path.join(MEMORY_DIR, "research");
export const UI_STATE_FILE = path.join(MEMORY_DIR, "ui_state.json");
