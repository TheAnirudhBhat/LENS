// Parsers that turn the markdown memory files into structured data the UI can render as tables.

export type WatchlistEntry = {
  ticker: string;
  company: string;
  added?: string;
  entryPrice?: number;
  thesis?: string;
  entryTrigger?: string;
  exitTrigger?: string;
  framework?: string;
  confidence?: string;
  sectorTailwind?: string;
  lastNewsCheck?: string;
  status: "active" | "passed";
  passedReason?: string;
};

// Section boundary regex — tolerate header variants so authors can write
// "## Passed", "## Demoted / Passed", "## Pruned" etc. without breaking parsing.
const PASSED_SECTION_RE = /^## (?:Passed|Demoted|Pruned|Demoted\s*\/\s*Passed)\b[^\n]*$/m;

// Heuristic: only treat a heading as a ticker entry if its first token looks
// like a real ticker (short, mostly uppercase). Long sentence headings like
// "Demoted in this consolidation" get filtered out.
function looksLikeTickerHeading(firstLine: string): boolean {
  const stripped = firstLine.replace(/^\s*\d+[.)]\s*/, "").trim();
  const head = stripped.split(/[—–-]/)[0]?.trim() ?? "";
  if (!head || head.length > 20) return false;
  return /^[A-Z][A-Z0-9&./-]{1,19}$/.test(head);
}

// Clean noise from a ticker token: numbering prefix, trailing markdown
// metadata in italics or brackets.
function cleanTickerHead(raw: string): string {
  return raw
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\s*\*+\([^)]*\)\*+\s*$/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .trim();
}

// Strip trailing italic *(...)* and bracket [...] metadata from a free-form
// segment (typically company name after the em-dash).
function cleanTrailingMeta(s: string): string {
  return s
    .replace(/\s*\*+\([^)]*\)\*+\s*$/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .trim();
}

export function parseWatchlist(md: string): WatchlistEntry[] {
  const entries: WatchlistEntry[] = [];

  const passedHeaderMatch = PASSED_SECTION_RE.exec(md);
  const passedIdx = passedHeaderMatch?.index ?? md.length;
  const activeStart = md.indexOf("## Active Watchlist");
  // Guard: if "## Active Watchlist" is missing, skip active parsing entirely
  // (don't fall through to md.slice(-1, ...) which returns the last char).
  const activeMatch =
    activeStart >= 0 && activeStart < passedIdx
      ? { 1: md.slice(activeStart, passedIdx) }
      : null;
  const passedMatch = passedHeaderMatch
    ? { 1: md.slice(passedIdx).replace(/^[^\n]*\n/, "") }
    : null;

  if (activeMatch) {
    const blocks = activeMatch[1].split(/^### /m).slice(1);
    for (const block of blocks) {
      const entry = parseActiveBlock(block);
      if (entry) entries.push(entry);
    }
  }

  if (passedMatch) {
    const blocks = passedMatch[1].split(/^### /m).slice(1);
    for (const block of blocks) {
      const entry = parsePassedBlock(block);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

function parseActiveBlock(block: string): WatchlistEntry | null {
  const firstLine = block.split("\n")[0] ?? "";
  if (!looksLikeTickerHeading(firstLine)) return null;
  const [tickerRaw, ...companyParts] = firstLine.split(/[—–]/).map((s) => s.trim());
  const ticker = cleanTickerHead(tickerRaw ?? "");
  if (!ticker) return null;

  const field = (name: string) => {
    const re = new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`, "i");
    const m = block.match(re);
    return m ? m[1].trim() : undefined;
  };

  const addedRaw = field("Added");
  let added: string | undefined;
  let entryPrice: number | undefined;
  if (addedRaw) {
    const m = addedRaw.match(/(\d{4}-\d{2}-\d{2}).*?₹\s*([\d,]+)/);
    if (m) {
      added = m[1];
      entryPrice = Number(m[2].replace(/,/g, ""));
    } else {
      added = addedRaw;
    }
  }

  return {
    ticker,
    company: cleanTrailingMeta(companyParts.join(" — ")) || ticker,
    added,
    entryPrice,
    thesis: field("Thesis"),
    entryTrigger: field("Entry trigger"),
    exitTrigger: field("Exit trigger"),
    framework: field("Framework fit"),
    confidence: field("Confidence"),
    sectorTailwind: field("Sector tailwind"),
    lastNewsCheck: field("Last news check"),
    status: "active",
  };
}

function parsePassedBlock(block: string): WatchlistEntry | null {
  const firstLine = block.split("\n")[0] ?? "";
  if (!looksLikeTickerHeading(firstLine)) return null;
  const [tickerRaw, ...companyParts] = firstLine.split(/[—–]/).map((s) => s.trim());
  const ticker = cleanTickerHead(tickerRaw ?? "");
  if (!ticker) return null;

  const reasonMatch = block.match(/- Reason:\s*(.+)/i);
  return {
    ticker,
    company: cleanTrailingMeta(companyParts.join(" — ")) || ticker,
    status: "passed",
    passedReason: reasonMatch?.[1]?.trim(),
  };
}

export type MultibaggerEntry = {
  rank?: number;
  ticker: string;
  company?: string;
  cmp?: string;
  marketCap?: string;
  confidence?: string;
  framework?: string;
  bullCase?: string;
  risk?: string;
  entryZone?: string;
  horizon?: string;
};

export function parseMultibaggers(md: string): { regime?: string; entries: MultibaggerEntry[] } {
  const regimeMatch = md.match(/##\s*Market Regime\s*\n([\s\S]*?)(?=##|$)/i);
  const regime = regimeMatch?.[1]?.trim().split("\n")[0];

  const topMatch = md.match(/## Top \d+ Candidates([\s\S]*?)(?=## Nearly|## Sector|## Recommended|$)/i);
  const entries: MultibaggerEntry[] = [];
  if (topMatch) {
    const blocks = topMatch[1].split(/^\d+\.\s+/m).slice(1);
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const firstLine = block.split("\n")[0] ?? "";
      if (!looksLikeTickerHeading(firstLine)) continue;
      const [tickerRaw, ...rest] = firstLine.split(/[—–]/).map((s) => s.trim());
      const ticker = cleanTickerHead(tickerRaw ?? "");
      if (!ticker) continue;
      const company = rest
        .join(" — ")
        .replace(/\s*\*+\([^)]*\)\*+\s*$/, "")
        .replace(/\s*\[[^\]]*\]\s*$/, "")
        .trim();

      const field = (name: string) => {
        const re = new RegExp(`-\\s*${name}:\\s*(.+)`, "i");
        const m = block.match(re);
        return m ? m[1].trim() : undefined;
      };

      entries.push({
        rank: i + 1,
        ticker,
        company,
        cmp: field("CMP"),
        marketCap: field("M-cap"),
        confidence: field("Confidence"),
        framework: field("Framework fit"),
        bullCase: field("Bull case"),
        risk: field("Main risk"),
        entryZone: field("Entry zone"),
        horizon: field("Time horizon"),
      });
    }
  }
  return { regime, entries };
}

export type MFEntry = {
  /** Internal short-name (first token of the H3, e.g. "DEMOFLEXI"). Used to
   *  map to mfapi.in scheme codes for live NAV pricing. */
  ticker?: string;
  scheme: string;
  amc: string;
  category: string;
  folio?: string;
  units: number;
  nav: number;
  avgNav?: number;
  invested?: number;
  value: number;
  pnlPct?: number;
  dayChangePct?: number;
  xirr?: number;
  twr?: number;
  inceptionCagr?: number;
  expenseRatio?: number;
  benchmark?: string;
  fundManager?: string;
  distributor?: string;
  since?: string;
  lockIn?: string;
  return1y?: number;
  return3y?: number;
  return5y?: number;
  riskLabel?: "Low" | "Low to Moderate" | "Moderate" | "Moderately High" | "High" | "Very High";
  sipActive?: boolean;
  sipAmount?: number;
  thesisHealth?: "green" | "amber" | "red";
  thesisNote?: string;
  role?: string;
};

export type MFSummary = {
  asOf?: string;
  totalInvested?: number;
  totalValue?: number;
  totalPnLPct?: number;
  xirr?: number;
  monthlySIP?: number;
  entries: MFEntry[];
};

const RISK_LABELS = [
  "Low to Moderate",
  "Moderately High",
  "Very High",
  "Low",
  "Moderate",
  "High",
] as const;

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/-?[\d,]+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parsePercent(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/([+-]?\s*[\d,]+(?:\.\d+)?)\s*%/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseRiskLabel(raw: string | undefined): MFEntry["riskLabel"] {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  for (const label of RISK_LABELS) {
    if (trimmed.toLowerCase() === label.toLowerCase()) return label;
  }
  return undefined;
}

export function parseMutualFunds(md: string): MFSummary {
  const summary: MFSummary = { entries: [] };

  // Snapshot heading: "## Snapshot (2026-05-02)"
  const snapHeading = md.match(/##\s*Snapshot[^\n]*\(([^)]+)\)/i);
  if (snapHeading) summary.asOf = snapHeading[1].trim();

  const snapBlock = md.match(/##\s*Snapshot[^\n]*\n([\s\S]*?)(?=\n##\s|$)/);
  if (snapBlock) {
    const block = snapBlock[1];
    const get = (name: string) => {
      const re = new RegExp(`-\\s*${name}:\\s*(.+)`, "i");
      const m = block.match(re);
      return m ? m[1].trim() : undefined;
    };
    summary.totalInvested = parseNumber(get("Total invested"));
    summary.totalValue = parseNumber(get("Total value"));
    summary.totalPnLPct = parsePercent(get("Net P&L"));
    summary.xirr = parsePercent(get("XIRR"));
    summary.monthlySIP = parseNumber(get("Monthly SIP"));
  }

  const holdingsMatch = md.match(/##\s*Holdings([\s\S]*?)(?=\n##\s|$)/);
  if (!holdingsMatch) return summary;

  const blocks = holdingsMatch[1].split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const entry = parseMFBlock(block);
    if (entry) summary.entries.push(entry);
  }

  return summary;
}

function parseMFBlock(block: string): MFEntry | null {
  const firstLine = (block.split("\n")[0] ?? "").trim();
  if (!firstLine) return null;
  // Skip non-ticker sub-headers (e.g. "Demoted in this consolidation").
  // For MF the shorthand is uppercase-ish (DEMOFLEXI, DEMOELSS, etc.).
  if (!looksLikeTickerHeading(firstLine)) return null;
  const parts = firstLine.split(/[—–]/).map((s) => s.trim());
  // first part is shorthand ticker; rest is the full scheme name
  const ticker = parts.length > 1 ? cleanTickerHead(parts[0]) : undefined;
  const rawScheme = parts.length > 1 ? parts.slice(1).join(" — ") : parts[0];
  // Strip author annotations like "(NEW 2026-05-11)", "(BOOKMARK)",
  // "(SWITCHED 2026-05-07)" — uppercase-led parentheticals are metadata,
  // not part of the standard fund name.
  const scheme = rawScheme
    .replace(/\s*\*+\([^)]*\)\*+\s*$/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s*\([A-Z][A-Z0-9 \-/_,.:]+\)\s*$/, "")
    .trim();
  if (!scheme) return null;

  const get = (name: string) => {
    const re = new RegExp(`-\\s*${name}:\\s*(.+)`, "i");
    const m = block.match(re);
    return m ? m[1].trim() : undefined;
  };

  const amc = get("AMC") ?? "";
  const category = get("Category") ?? "";
  const folio = get("Folio");
  const role = get("role");

  const unitsRaw = get("Units");
  const units = parseNumber(unitsRaw) ?? 0;

  const navRaw = get("NAV");
  const nav = parseNumber(navRaw) ?? 0;
  const dayChangePct = parsePercent(navRaw);

  const avgNav = parseNumber(get("Avg NAV"));
  const invested = parseNumber(get("Invested"));
  const value = parseNumber(get("Value")) ?? 0;
  const pnlPct = parsePercent(get("P&L"));
  const xirr = parsePercent(get("XIRR"));

  // Returns line: "1Y: 22.4% | 3Y: 19.1% | 5Y: 21.5%"
  let return1y: number | undefined;
  let return3y: number | undefined;
  let return5y: number | undefined;
  const returnsLine = block.match(/-\s*1Y:[^\n]+/i);
  if (returnsLine) {
    const r1 = returnsLine[0].match(/1Y:\s*([+-]?[\d.]+)\s*%/i);
    const r3 = returnsLine[0].match(/3Y:\s*([+-]?[\d.]+)\s*%/i);
    const r5 = returnsLine[0].match(/5Y:\s*([+-]?[\d.]+)\s*%/i);
    if (r1) return1y = Number(r1[1]);
    if (r3) return3y = Number(r3[1]);
    if (r5) return5y = Number(r5[1]);
  }

  const twr = parsePercent(get("TWR"));
  const inceptionCagr = parsePercent(get("Inception CAGR"));
  const expenseRatio = parsePercent(get("Expense ratio"));
  const benchmark = get("Benchmark");
  const fundManager = get("Fund manager");
  const distributor = get("Distributor");
  const since = get("Since");
  const lockIn = get("Lock In");

  const riskLabel = parseRiskLabel(get("Risk"));

  // SIP: "₹5,000/mo (active)"
  const sipRaw = get("SIP");
  let sipAmount: number | undefined;
  let sipActive: boolean | undefined;
  if (sipRaw) {
    const m = sipRaw.match(/₹\s*([\d,]+)/);
    if (m) sipAmount = Number(m[1].replace(/,/g, ""));
    sipActive = /active/i.test(sipRaw);
  }

  // Thesis: "green — flagship core, ..."
  const thesisRaw = get("Thesis");
  let thesisHealth: MFEntry["thesisHealth"];
  let thesisNote: string | undefined;
  if (thesisRaw) {
    const m = thesisRaw.match(/^(green|amber|red)\s*[—-]\s*(.+)$/i);
    if (m) {
      thesisHealth = m[1].toLowerCase() as MFEntry["thesisHealth"];
      thesisNote = m[2].trim();
    } else {
      thesisNote = thesisRaw;
    }
  }

  return {
    ticker,
    scheme,
    amc,
    category,
    folio,
    units,
    nav,
    avgNav,
    invested,
    value,
    pnlPct,
    dayChangePct,
    xirr,
    twr,
    inceptionCagr,
    expenseRatio,
    benchmark,
    fundManager,
    distributor,
    since,
    lockIn,
    return1y,
    return3y,
    return5y,
    riskLabel,
    sipActive,
    sipAmount,
    thesisHealth,
    thesisNote,
    role,
  };
}

