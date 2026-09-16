#!/usr/bin/env node
/**
 * First-run bootstrap — what `npm run setup` executes.
 *
 * On a fresh clone the dashboard ships empty and the data dir does not exist,
 * so every /api route 404s and the UI looks broken. This script creates the
 * data dir (+ research/ subdir) and writes a minimal, EMPTY-but-schema-valid
 * stub for each file the routes read — so every route returns "empty", not 404.
 *
 * It is:
 *   - stdlib only (Node ESM, no deps),
 *   - idempotent: an existing file is NEVER overwritten (only missing ones are
 *     created), so re-running creates nothing new and clobbers no real data.
 *
 * Target data dir resolution mirrors lib/paths.ts exactly:
 *   PORTFOLIO_MEMORY_DIR if set, else
 *   ~/.claude/projects/<home-with-"/"-as-"-">/memory
 *
 * Each stub's shape is taken from lib/schemas.ts + the /api route readers so a
 * fresh route parse succeeds (a bad shape would 500 instead of 404).
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Resolve the data dir (mirror of lib/paths.ts derivation) ────────────────
const home = os.homedir();
const projectSlug = home.replace(/\//g, "-");
const MEMORY_DIR =
  process.env.PORTFOLIO_MEMORY_DIR ??
  path.join(home, ".claude", "projects", projectSlug, "memory");
const RESEARCH_DIR = path.join(MEMORY_DIR, "research");

// A stable timestamp for stubs whose readers require a non-empty date field
// (e.g. earnings_data: readDisk() returns null unless `updatedAt` is truthy).
const NOW = new Date().toISOString();

// ── Stub payloads (empty-but-valid shapes) ──────────────────────────────────
// JSON stubs: relative-to-MEMORY_DIR path → serialisable value.
// Markdown stubs handled separately below.

/** latest_snapshot.json — SnapshotSchema: required asOf, totalValue, holdings[]. */
const SNAPSHOT_STUB = {
  asOf: NOW,
  totalValue: 0,
  totalPortfolioValue: 0,
  cash: 0,
  equityValue: 0,
  bondsValue: 0,
  equityInvested: 0,
  equityPnl: 0,
  equityPnlPct: 0,
  holdings: [],
  regime: "",
  nifty: { value: null, dayChangePct: null },
  vix: null,
  urgent: [],
  bookedGains: [],
};

/** us_stocks.json — USStocksDataSchema: totals{...} required, positions[], exited[]. */
const US_STOCKS_STUB = {
  fetchedAt: NOW,
  source: "demo",
  totals: {
    investedINR: 0,
    currentINR: 0,
    pnlINR: 0,
    pnlPct: 0,
    positionCount: 0,
  },
  positions: [],
  exited: [],
};

/** bonds.json — wrapped by /api/bonds as { data, mtime }; UI reads data.positions / data.totals. */
const BONDS_STUB = {
  fetchedAt: NOW,
  source: "demo",
  platform: "demo",
  totals: {
    investedINR: 0,
    activeInvestedINR: 0,
    maturedInvestedINR: 0,
    interestEarnedGrossINR: 0,
    interestEarnedNetINR: 0,
    tdsDeductedINR: 0,
    activeCount: 0,
    maturedCount: 0,
    totalCount: 0,
  },
  positions: [],
};

/** mf_scheme_codes.json — lib/mfapi.ts: { schemes: Record<ticker, {code,name}> }. */
const MF_SCHEME_CODES_STUB = { schemes: {} };

/** tasks.json — TasksFileSchema: { tasks: [] }. */
const TASKS_STUB = { tasks: [] };

/** decisions.json — DecisionsFileSchema: { decisions: [] }. */
const DECISIONS_STUB = { decisions: [] };

/** portfolio_history.json — { history: [] } (brief modal persistence). */
const PORTFOLIO_HISTORY_STUB = { history: [] };

/** earnings_data.json — readDisk() needs truthy updatedAt + records[]. */
const EARNINGS_DATA_STUB = { updatedAt: NOW, records: [] };

/** earnings_outlook.json — { updatedAt, items: [] }. */
const EARNINGS_OUTLOOK_STUB = { updatedAt: NOW, items: [] };

/** news_cache.json — readDiskCache() needs articles[]; keeps llmEnabled/holdingsCount. */
const NEWS_CACHE_STUB = {
  fetchedAt: NOW,
  articles: [],
  llmEnabled: false,
  holdingsCount: 0,
};

/** triggers.json — { firedAt, items: [] }. */
const TRIGGERS_STUB = { firedAt: "", items: [] };

/** research/us.json + research/mf.json — loadResearch validates a JSON ARRAY of candidates. */
const RESEARCH_STUB = [];

/**
 * profile.json — ProfileSchema. A fresh install can run with NO profile.json
 * (loadProfile returns { profile: null }) and the app falls back to code
 * defaults. We seed a minimal version:1 doc so the file exists and validates;
 * empty ladder + empty buckets means lib/profile.ts merges in code defaults.
 */
const PROFILE_STUB = {
  version: 1,
  goals: { ladder: [] },
  allocation: { buckets: [] },
  strategy: {},
};

/**
 * project_mutual_funds.md — parseMutualFunds() is markdown-driven and tolerant:
 * a Snapshot block + an empty Holdings section yields { asOf, entries: [] }
 * with no entries (looksLikeTickerHeading filters any non-ticker headings).
 */
const MF_MARKDOWN_STUB = `# Mutual Funds

## Snapshot (${NOW.slice(0, 10)})

- Total invested: ₹0
- Total value: ₹0
- Net P&L: 0%
- XIRR: 0%

## Holdings

_No holdings yet. Run /portfolio-check to populate this file._
`;

// ── File manifest ───────────────────────────────────────────────────────────
// Each entry: [absolute path, string contents]. JSON pretty-printed to match
// how the routes write these files (JSON.stringify(x, null, 2)).
const json = (v) => JSON.stringify(v, null, 2) + "\n";

const FILES = [
  [path.join(MEMORY_DIR, "latest_snapshot.json"), json(SNAPSHOT_STUB)],
  [path.join(MEMORY_DIR, "us_stocks.json"), json(US_STOCKS_STUB)],
  [path.join(MEMORY_DIR, "bonds.json"), json(BONDS_STUB)],
  [path.join(MEMORY_DIR, "mf_scheme_codes.json"), json(MF_SCHEME_CODES_STUB)],
  [path.join(MEMORY_DIR, "tasks.json"), json(TASKS_STUB)],
  [path.join(MEMORY_DIR, "decisions.json"), json(DECISIONS_STUB)],
  [path.join(MEMORY_DIR, "portfolio_history.json"), json(PORTFOLIO_HISTORY_STUB)],
  [path.join(MEMORY_DIR, "earnings_data.json"), json(EARNINGS_DATA_STUB)],
  [path.join(MEMORY_DIR, "earnings_outlook.json"), json(EARNINGS_OUTLOOK_STUB)],
  [path.join(MEMORY_DIR, "news_cache.json"), json(NEWS_CACHE_STUB)],
  [path.join(MEMORY_DIR, "triggers.json"), json(TRIGGERS_STUB)],
  [path.join(MEMORY_DIR, "profile.json"), json(PROFILE_STUB)],
  [path.join(RESEARCH_DIR, "us.json"), json(RESEARCH_STUB)],
  [path.join(RESEARCH_DIR, "mf.json"), json(RESEARCH_STUB)],
  [path.join(MEMORY_DIR, "project_mutual_funds.md"), MF_MARKDOWN_STUB],
];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function main() {
  // mkdir -p both dirs (recursive is a no-op if they already exist).
  await mkdir(MEMORY_DIR, { recursive: true });
  await mkdir(RESEARCH_DIR, { recursive: true });

  console.log(`LENS setup — data dir: ${MEMORY_DIR}`);

  const created = [];
  const skipped = [];

  for (const [filePath, contents] of FILES) {
    if (await exists(filePath)) {
      skipped.push(filePath);
      continue;
    }
    await writeFile(filePath, contents, "utf8");
    created.push(filePath);
  }

  for (const p of created) console.log(`  created  ${path.relative(MEMORY_DIR, p)}`);
  for (const p of skipped) console.log(`  skipped  ${path.relative(MEMORY_DIR, p)} (exists)`);

  console.log(
    `\nDone. ${created.length} created, ${skipped.length} skipped (already present).`
  );
  if (created.length > 0) {
    console.log("Start the dashboard with `npm run lens` (or `npm run dev`).");
  }
}

main().catch((err) => {
  console.error("init-data failed:", err);
  process.exit(1);
});
