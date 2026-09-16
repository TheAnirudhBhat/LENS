import { NextResponse } from "next/server";
import { readFile, stat, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  SNAPSHOT_FILE,
  US_STOCKS_FILE,
  MUTUAL_FUNDS_FILE,
  WATCHLIST_FILE,
  NEWS_CACHE_FILE,
} from "@/lib/paths";
import { TICKER_META } from "@/lib/tickerMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Types ----------

type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
  snippet: string;
  imageUrl?: string;
  region: "IN" | "US" | "GLOBAL";
};

type Direction = "+" | "-" | "neutral";
type Magnitude = "low" | "med" | "high";
type Horizon = "days" | "weeks" | "quarters";
type Confidence = "low" | "med" | "high";
type Actionability = "watch" | "trigger" | "context" | "skip";
type EventType =
  | "earnings"
  | "guidance"
  | "M&A"
  | "regulatory"
  | "macro"
  | "sector"
  | "geo"
  | "rating";

type Tagging = {
  tickers: string[];
  direction: Direction;
  magnitude: Magnitude;
  mechanism: string;
  horizon: Horizon;
  confidence: Confidence;
  sector?: string;
  actionability: Actionability;
  eventType?: EventType;
};

type TaggedArticle = NewsItem & {
  tagging: Tagging;
  /** Played-out: stub price-delta per ticker (% since publish). */
  priceDelta?: Record<string, number>;
};

type CacheEntry = {
  fetchedAt: number;
  articles: TaggedArticle[];
  llmEnabled: boolean;
  holdingsCount: number;
};

// In-memory cache (2hr TTL)
const TTL_MS = 2 * 60 * 60 * 1000;
let memCache: CacheEntry | null = null;

// ---------- RSS sources ----------

const RSS_SOURCES: { url: string; source: string; region: NewsItem["region"] }[] = [
  // India · 7
  {
    url: "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
    source: "Economic Times",
    region: "IN",
  },
  {
    url: "https://www.livemint.com/rss/markets",
    source: "Mint",
    region: "IN",
  },
  {
    url: "https://www.business-standard.com/rss/markets-106.rss",
    source: "Business Standard",
    region: "IN",
  },
  {
    url: "https://www.moneycontrol.com/rss/marketreports.xml",
    source: "Moneycontrol",
    region: "IN",
  },
  {
    url: "https://www.ndtvprofit.com/feed",
    source: "NDTV Profit",
    region: "IN",
  },
  {
    url: "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml",
    source: "NSE",
    region: "IN",
  },
  {
    url: "https://www.bseindia.com/data/xml/notices.xml",
    source: "BSE",
    region: "IN",
  },
  // US & Global · 5
  {
    url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
    source: "WSJ Markets",
    region: "US",
  },
  {
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    source: "CNBC Markets",
    region: "US",
  },
  {
    url: "https://finance.yahoo.com/news/rssindex",
    source: "Yahoo Finance",
    region: "US",
  },
  {
    url: "https://apnews.com/index.rss",
    source: "AP",
    region: "US",
  },
  {
    url: "https://feeds.bloomberg.com/markets/news.rss",
    source: "Bloomberg Markets",
    region: "GLOBAL",
  },
];

// Source priority for entity-overlap dedup (higher = preferred to keep).
const SOURCE_PRIORITY: Record<string, number> = {
  Bloomberg: 10,
  "Bloomberg Markets": 10,
  Reuters: 10,
  "WSJ Markets": 9,
  WSJ: 9,
  "Economic Times": 7,
  Mint: 7,
  "Business Standard": 7,
  "CNBC Markets": 6,
  CNBC: 6,
  Moneycontrol: 5,
  "NDTV Profit": 5,
  "Yahoo Finance": 4,
  AP: 7,
  NSE: 8, // primary source for announcements
  BSE: 8,
};

// ---------- Tiny RSS parser (no deps) ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function extract(tag: string, block: string): string | undefined {
  const m =
    block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ||
    block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : undefined;
}

function extractImage(block: string): string | undefined {
  // try common patterns: <media:content url>, <enclosure url>, <img src> in description
  const media = block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i);
  if (media) return media[1];
  const enc = block.match(/<enclosure[^>]*url="([^"]+)"/i);
  if (enc) return enc[1];
  const desc = extract("description", block) || "";
  const img = decodeEntities(desc).match(/<img[^>]*src="([^"]+)"/i);
  if (img) return img[1];
  return undefined;
}

async function fetchRSS(url: string, source: string, region: NewsItem["region"]): Promise<NewsItem[]> {
  try {
    // 5s timeout per source so a slow feed can't stall the whole pull.
    const ctrl = new AbortController();
    const tmo = setTimeout(() => ctrl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (portfolio-dashboard news engine; contact: local)",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: ctrl.signal,
        // Avoid Next caching at the fetch layer; we manage our own cache
        cache: "no-store",
      });
    } finally {
      clearTimeout(tmo);
    }
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
    const blocks = xml.match(itemRe) || [];
    for (const block of blocks.slice(0, 30)) {
      const title = stripTags(extract("title", block) || "");
      const link = stripTags(extract("link", block) || "");
      const pub = extract("pubDate", block) || extract("dc:date", block) || "";
      const desc = stripTags(extract("description", block) || "");
      if (!title || !link) continue;
      const publishedAt = pub ? new Date(pub).toISOString() : new Date().toISOString();
      items.push({
        id: link,
        title,
        link,
        source,
        publishedAt,
        snippet: desc.slice(0, 220),
        imageUrl: extractImage(block),
        region,
      });
    }
    return items;
  } catch {
    return [];
  }
}

// ---------- Targeted news fan-out ----------

// Google News RSS supports `when:7d` to scope the time window. The query
// otherwise mirrors what a user would type in the news search box.
function buildTargetedQuery(ticker: string, companyName?: string): string {
  if (companyName && companyName !== ticker) {
    return `"${companyName}" OR "${ticker}" stock news when:7d`;
  }
  return `"${ticker}" stock news when:7d`;
}

function googleNewsRssUrl(query: string, region: "IN" | "US"): string {
  const encoded = encodeURIComponent(query);
  if (region === "US") {
    return `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
  }
  return `https://news.google.com/rss/search?q=${encoded}&hl=en-IN&gl=IN&ceid=IN:en`;
}

function bingNewsRssUrl(query: string): string {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
}

/**
 * Fetch targeted news for a single ticker. 5s timeout, top 3 results, 7d window.
 * Returns [] silently on any failure so one bad ticker doesn't stall the run.
 */
async function fetchTargetedNews(
  ticker: string,
  companyName: string | undefined,
  region: "IN" | "US"
): Promise<NewsItem[]> {
  const query = buildTargetedQuery(ticker, companyName);
  const sourceLabel = `Google News · ${ticker}`;
  const newsRegion: NewsItem["region"] = region;
  // First try Google News RSS. On failure, fall back to Bing.
  const candidates = [
    { url: googleNewsRssUrl(query, region), source: sourceLabel },
    { url: bingNewsRssUrl(query), source: `Bing News · ${ticker}` },
  ];
  for (const c of candidates) {
    try {
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(c.url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (portfolio-dashboard news engine; contact: local)",
            Accept: "application/rss+xml, application/xml, text/xml, */*",
          },
          signal: ctrl.signal,
          cache: "no-store",
        });
      } finally {
        clearTimeout(tmo);
      }
      if (!res.ok) continue;
      const xml = await res.text();
      const items: NewsItem[] = [];
      const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
      const blocks = xml.match(itemRe) || [];
      // Google News titles already embed " - <source>" suffix; strip when present.
      for (const block of blocks.slice(0, 3)) {
        const rawTitle = stripTags(extract("title", block) || "");
        if (!rawTitle) continue;
        const link = stripTags(extract("link", block) || "");
        if (!link) continue;
        const pub = extract("pubDate", block) || extract("dc:date", block) || "";
        const desc = stripTags(extract("description", block) || "");
        const sourceTag = extract("source", block);
        const displaySource = sourceTag ? stripTags(sourceTag) : c.source;
        // Strip " - SourceName" suffix Google News appends.
        const cleanTitle = rawTitle.replace(/\s+-\s+[^-]{2,40}$/, "");
        const publishedAt = pub ? new Date(pub).toISOString() : new Date().toISOString();
        items.push({
          id: link,
          title: cleanTitle || rawTitle,
          link,
          source: displaySource || c.source,
          publishedAt,
          snippet: desc.slice(0, 220),
          imageUrl: extractImage(block),
          region: newsRegion,
        });
      }
      if (items.length > 0) return items;
    } catch {
      // try next candidate
    }
  }
  return [];
}

// ---------- Holdings extraction ----------

// Targeted-news query overrides for tickers whose canonical company name in
// TICKER_META is too generic or ambiguous to match Google News reliably.
// Falls back to TICKER_META[ticker].name when no override exists; final
// fallback is the ticker symbol itself.
// Add entries here for any ticker whose NSE symbol doesn't yield useful
// Google News results on its own (e.g. bond instrument codes, renamed
// companies, or very short/ambiguous symbols).
const TARGETED_NAME_OVERRIDES: Record<string, string> = {
  TMPV: "Tata Motors",
};

function resolveCompanyName(ticker: string): string | undefined {
  if (TARGETED_NAME_OVERRIDES[ticker]) return TARGETED_NAME_OVERRIDES[ticker];
  const meta = TICKER_META[ticker];
  if (meta?.name && meta.name !== ticker) return meta.name;
  return undefined;
}

type TargetedTicker = {
  ticker: string;
  region: "IN" | "US";
  companyName?: string;
};

type UserPortfolio = {
  inTickers: string[];
  usTickers: string[];
  mfTickers: string[];
  watchlist: string[];
  /** All tickers that should be actively scanned via targeted Google News queries. */
  targetedTickers: TargetedTicker[];
  // Compact card with sector hints
  prefixSummary: string;
};

async function loadUserPortfolio(): Promise<UserPortfolio> {
  const inTickers: string[] = [];
  const inWithMeta: { ticker: string; weight?: number; role?: string }[] = [];
  const usTickers: string[] = [];
  const usWithMeta: { ticker: string; name?: string }[] = [];
  const mfTickers: string[] = [];
  const watchlist: string[] = [];

  // Snapshot (IN equity + bonds + metals)
  try {
    const raw = JSON.parse(await readFile(SNAPSHOT_FILE, "utf8"));
    if (Array.isArray(raw?.holdings)) {
      for (const h of raw.holdings) {
        if (typeof h?.ticker === "string") {
          inTickers.push(h.ticker);
          inWithMeta.push({ ticker: h.ticker, weight: h.weight, role: h.role });
        }
      }
    }
  } catch {
    // ignore
  }

  // US stocks
  try {
    const raw = JSON.parse(await readFile(US_STOCKS_FILE, "utf8"));
    if (Array.isArray(raw?.positions)) {
      for (const p of raw.positions) {
        if (typeof p?.ticker === "string") {
          usTickers.push(p.ticker);
          usWithMeta.push({ ticker: p.ticker, name: p.name });
        }
      }
    }
  } catch {
    // ignore
  }

  // MF — markdown, grep symbol-like tokens (best-effort)
  try {
    const md = await readFile(MUTUAL_FUNDS_FILE, "utf8");
    const m = md.matchAll(/\b([A-Z]{3,}(?:CAP|FUND|FOF|INDEX|NIFTY|FLEXI|NASDAQ|MIRAE|PARAG|MOTILAL|ICICI|SBI|HDFC|AXIS|UTI|KOTAK)[A-Z]*)\b/g);
    const seen = new Set<string>();
    for (const x of m) {
      if (!seen.has(x[1])) {
        seen.add(x[1]);
        mfTickers.push(x[1]);
      }
      if (mfTickers.length >= 20) break;
    }
  } catch {
    // ignore
  }

  // Watchlist — parse `### TICKER — Company` headers in the Active Watchlist
  // section (everything above the `## Passed` divider). Capture confidence so
  // the targeted-news fan-out can prioritise high/med-conf ideas.
  const watchlistTargets: TargetedTicker[] = [];
  try {
    const md = await readFile(WATCHLIST_FILE, "utf8");
    const passedIdx = md.search(/^##\s+Passed\b/m);
    const active = passedIdx >= 0 ? md.slice(0, passedIdx) : md;
    // Each entry starts with `### TICKER — Name`. Em-dash or hyphen accepted.
    const entryRe = /^###\s+([A-Z][A-Z0-9&-]{1,14})\s+[—\-]\s+([^\n]+?)\s*$/gm;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = entryRe.exec(active)) !== null) {
      const tk = match[1];
      const name = match[2].trim();
      if (tk === "TICKER") continue; // skip the format template line
      if (seen.has(tk)) continue;
      seen.add(tk);
      const tail = active.slice(match.index, match.index + 1800);
      const confMatch = tail.match(/\*\*Confidence:\*\*\s*(HIGH|MEDIUM-HIGH|MEDIUM|MED-HIGH|MED|LOW)\b/i);
      const conf = (confMatch?.[1] || "").toUpperCase();
      const isHighOrMed =
        conf === "HIGH" ||
        conf === "MEDIUM-HIGH" ||
        conf === "MED-HIGH" ||
        conf === "MEDIUM" ||
        conf === "MED";
      watchlist.push(tk);
      if (watchlist.length > 25) break;
      if (isHighOrMed) {
        watchlistTargets.push({
          ticker: tk,
          region: "IN",
          companyName: resolveCompanyName(tk) || name,
        });
      }
    }
  } catch {
    // ignore
  }

  // Compact summary for LLM prefix (cacheable)
  const lines: string[] = [];
  lines.push("USER PORTFOLIO (use ONLY tickers from this list when tagging):");
  lines.push("");
  lines.push("Indian equity (NSE/BSE tickers):");
  for (const h of inWithMeta) {
    lines.push(`  ${h.ticker}${h.weight !== undefined ? ` w=${h.weight}%` : ""}${h.role ? ` ${h.role}` : ""}`);
  }
  lines.push("");
  lines.push("US equity:");
  for (const p of usWithMeta) {
    lines.push(`  ${p.ticker}${p.name ? ` (${p.name})` : ""}`);
  }
  if (mfTickers.length) {
    lines.push("");
    lines.push("Mutual funds (informational; tag only if the news directly affects fund category):");
    lines.push("  " + mfTickers.join(", "));
  }
  if (watchlist.length) {
    lines.push("");
    lines.push("Stock watchlist (not yet owned, still tag if relevant):");
    lines.push("  " + watchlist.join(", "));
  }
  lines.push("");
  lines.push("TAGGING RULES:");
  lines.push("- tickers: ONLY symbols from the lists above. [] if nothing applies.");
  lines.push("- direction: '+' if bullish for those tickers, '-' if bearish, 'neutral' if mixed/macro.");
  lines.push("- magnitude: 'low'|'med'|'high' — expected price-impact size.");
  lines.push("- mechanism: ≤120 chars, plain English causal chain.");
  lines.push("- horizon: 'days'|'weeks'|'quarters'.");
  lines.push("- confidence: 'low'|'med'|'high'.");
  lines.push("- sector: one-word optional, e.g. 'banks', 'semis', 'auto'.");
  lines.push("- actionability: 'watch'|'trigger'|'context'|'skip'.");
  lines.push("    * 'trigger' — events that should fire a decision (earnings beat/miss, guidance change, rating, M&A, regulatory ruling).");
  lines.push("    * 'watch'   — meaningful forward signals (sector shift, macro pivot, ongoing thesis pressure).");
  lines.push("    * 'context' — broad market commentary, useful background, no clear action.");
  lines.push("    * 'skip'    — retrospective recaps ('zoomed X%', 'closed up', 'gainers/losers today'); not actionable forward.");
  lines.push("- eventType (optional): 'earnings'|'guidance'|'M&A'|'regulatory'|'macro'|'sector'|'geo'|'rating'. Omit if none fits.");

  // Build active-scan list: every holding + high/med-conf watchlist idea.
  const targetedTickers: TargetedTicker[] = [];
  const targetedSeen = new Set<string>();
  for (const meta of inWithMeta) {
    if (targetedSeen.has(meta.ticker)) continue;
    targetedSeen.add(meta.ticker);
    targetedTickers.push({
      ticker: meta.ticker,
      region: "IN",
      companyName: resolveCompanyName(meta.ticker),
    });
  }
  for (const p of usWithMeta) {
    if (targetedSeen.has(p.ticker)) continue;
    targetedSeen.add(p.ticker);
    targetedTickers.push({
      ticker: p.ticker,
      region: "US",
      companyName: resolveCompanyName(p.ticker) || p.name,
    });
  }
  for (const w of watchlistTargets) {
    if (targetedSeen.has(w.ticker)) continue;
    targetedSeen.add(w.ticker);
    targetedTickers.push(w);
  }

  return {
    inTickers,
    usTickers,
    mfTickers,
    watchlist,
    targetedTickers,
    prefixSummary: lines.join("\n"),
  };
}

// ---------- Keyword fallback tagging ----------

// Retrospective ("played-out") patterns — these are about what already happened today,
// no forward action implied. Forecast tab will filter these out.
const RETRO_PATTERNS = [
  /\bZOOM(?:ED|ING|S)?\b\s+\d/i,
  /\bSHARES?\s+JUMP(?:ED)?\b/i,
  /\bCLOSED\s+UP\b/i,
  /\bCLOSED\s+DOWN\b/i,
  /\bENDED?\s+(?:THE\s+)?DAY\s+AT\b/i,
  /\bTODAY'?S?\s+(?:GAINERS?|LOSERS?|TOP\s+GAINERS?)\b/i,
  /\bTOP\s+(?:GAINERS?|LOSERS?)\b/i,
  /\bRALLIED\s+\d/i,
  /\bSLUMPED\s+\d/i,
  /\bTUMBLED\s+\d/i,
  /\bSURGED\s+\d/i,
  /\bROSE\s+\d+%?\b/i,
  /\bFELL\s+\d+%?\b/i,
  /\bGAINED\s+\d+%?\b/i,
  /\bLOST\s+\d+%?\b/i,
  /\bSENSEX\s+(?:JUMP|ZOOM|RALLI|SURG|TUMBL|SLUMP|END|CLOS)/i,
  /\bNIFTY\s+(?:JUMP|ZOOM|RALLI|SURG|TUMBL|SLUMP|END|CLOS)/i,
];

const CONTEXT_PATTERNS = [
  /\bMARKET\s+OUTLOOK\b/i,
  /\bMARKET\s+WRAP\b/i,
  /\bDAILY\s+ROUND[-\s]?UP\b/i,
  /\bMARKET\s+UPDATE\b/i,
  /\bMARKET\s+SUMMARY\b/i,
  /\bSESSION\s+REVIEW\b/i,
];

const TRIGGER_KEYWORDS =
  /\b(EARNINGS|RESULTS|GUIDANCE|UPGRADE|DOWNGRADE|MERGER|ACQUISITION|BUYBACK|PROBE|RAID|FRAUD|LAWSUIT|RULING|SETTLEMENT|RECALL|TARIFF|SANCTION|BAN|APPROVED|REJECT|DEAL|STAKE|IPO)\b/i;
const WATCH_KEYWORDS =
  /\b(OUTLOOK|FORECAST|PIPELINE|LAUNCH|EXPANSION|PARTNERSHIP|HIRE|FIRE|RESIGN|CONTRACT|ORDER|WIN)\b/i;

function detectEventType(text: string): EventType | undefined {
  if (/\b(EARNINGS|Q[1-4]\s+(RESULTS|REPORT)|QUARTER(?:LY)?\s+RESULTS?)\b/i.test(text)) return "earnings";
  if (/\b(GUIDANCE|FORECAST|OUTLOOK)\b/i.test(text)) return "guidance";
  if (/\b(MERGER|ACQUISITION|TAKEOVER|BUYOUT|M&A|STAKE\s+SALE|DEAL)\b/i.test(text)) return "M&A";
  if (/\b(SEBI|SEC|FED|RBI|REGULATOR|REGULATORY|RULING|SETTLEMENT|FINE|PROBE|LAWSUIT)\b/i.test(text)) return "regulatory";
  if (/\b(UPGRADE|DOWNGRADE|TARGET\s+PRICE|TP\s+HIKE|RATING)\b/i.test(text)) return "rating";
  if (/\b(WAR|CONFLICT|TARIFF|SANCTION|GEOPOLITIC|TRADE\s+TALK)\b/i.test(text)) return "geo";
  if (/\b(CPI|GDP|INFLATION|UNEMPLOYMENT|FED\s+RATE|RATE\s+CUT|RATE\s+HIKE|JOBS\s+REPORT)\b/i.test(text)) return "macro";
  if (/\b(SECTOR|INDUSTRY)\b/i.test(text)) return "sector";
  return undefined;
}

function classifyActionability(text: string, hasPortfolioMatch: boolean): Actionability {
  if (RETRO_PATTERNS.some((re) => re.test(text))) return "skip";
  if (CONTEXT_PATTERNS.some((re) => re.test(text))) return "context";
  if (TRIGGER_KEYWORDS.test(text)) return hasPortfolioMatch ? "trigger" : "watch";
  if (WATCH_KEYWORDS.test(text)) return "watch";
  return hasPortfolioMatch ? "watch" : "context";
}

function keywordTag(item: NewsItem, port: UserPortfolio): Tagging {
  const raw = item.title + " " + item.snippet;
  const t = raw.toUpperCase();
  const all = [...port.inTickers, ...port.usTickers, ...port.watchlist];
  const hits = all.filter((tk) => {
    if (tk.length < 3) return false;
    return new RegExp(`\\b${tk}\\b`).test(t);
  });
  // crude direction from a few keywords
  const pos = /(BEAT|SURGE|RALL|UPGRAD|JUMP|RECORD|PROFIT|GROWTH|WIN)/.test(t);
  const neg = /(MISS|FALL|DROP|DOWNGRAD|PROBE|LOSS|SLUMP|CUT|WARN|FRAUD|RAID)/.test(t);
  const direction: Direction = pos && !neg ? "+" : neg && !pos ? "-" : "neutral";
  const actionability = classifyActionability(raw, hits.length > 0);
  const eventType = detectEventType(raw);
  return {
    tickers: hits.slice(0, 4),
    direction,
    magnitude: "low",
    mechanism: hits.length
      ? "Keyword-only match — set ANTHROPIC_API_KEY for richer tagging."
      : "No portfolio overlap.",
    horizon: "days",
    confidence: "low",
    actionability,
    eventType,
  };
}

// ---------- LLM tagging (Claude Haiku 4.5 w/ prompt caching) ----------

async function llmTagBatch(
  client: Anthropic,
  port: UserPortfolio,
  batch: NewsItem[]
): Promise<Tagging[]> {
  const userBlock = batch
    .map(
      (b, i) =>
        `[${i}] ${b.region} ${b.source} ${b.publishedAt}\n  title: ${b.title}\n  snippet: ${b.snippet}`
    )
    .join("\n\n");

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1800,
    system: [
      {
        type: "text",
        text:
          "You tag financial news against a fixed user portfolio. " +
          "Output STRICT JSON: an array of objects, one per [i] item, in order. " +
          "Each object: " +
          "{tickers:string[], direction:'+'|'-'|'neutral', magnitude:'low'|'med'|'high', " +
          "mechanism:string, horizon:'days'|'weeks'|'quarters', confidence:'low'|'med'|'high', " +
          "sector?:string, " +
          "actionability:'watch'|'trigger'|'context'|'skip', " +
          "eventType?:'earnings'|'guidance'|'M&A'|'regulatory'|'macro'|'sector'|'geo'|'rating'}. " +
          "actionability rules: 'skip' for retrospective recaps ('Sensex zoomed X', 'shares jumped Y%', 'closed up', 'today's gainers/losers'); " +
          "'context' for broad market commentary with no clear forward action; " +
          "'watch' for meaningful forward signals (sector shift, ongoing thesis pressure); " +
          "'trigger' for events likely to fire a decision (earnings, guidance, M&A, regulatory, rating, raid/probe). " +
          "No prose, no markdown fences, JSON only.",
      },
      {
        type: "text",
        text: port.prefixSummary,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Tag these ${batch.length} headlines:\n\n${userBlock}\n\nReturn JSON array of ${batch.length} objects in the same order.`,
      },
    ],
  });

  let text = "";
  for (const block of resp.content) {
    if (block.type === "text") text += block.text;
  }
  // best-effort JSON extraction
  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd < 0) throw new Error("LLM returned no JSON array");
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Tagging[];
  if (!Array.isArray(parsed)) throw new Error("LLM JSON was not an array");
  const validEvent = new Set<EventType>([
    "earnings",
    "guidance",
    "M&A",
    "regulatory",
    "macro",
    "sector",
    "geo",
    "rating",
  ]);
  const validAction = new Set<Actionability>(["watch", "trigger", "context", "skip"]);
  // pad/truncate to batch length
  const out: Tagging[] = [];
  for (let i = 0; i < batch.length; i++) {
    const t = parsed[i];
    if (!t) {
      out.push(keywordTag(batch[i], port));
      continue;
    }
    const actionability: Actionability = validAction.has(t.actionability as Actionability)
      ? (t.actionability as Actionability)
      : classifyActionability(
          batch[i].title + " " + batch[i].snippet,
          Array.isArray(t.tickers) && t.tickers.length > 0
        );
    const eventType: EventType | undefined =
      typeof t.eventType === "string" && validEvent.has(t.eventType as EventType)
        ? (t.eventType as EventType)
        : undefined;
    out.push({
      tickers: Array.isArray(t.tickers) ? t.tickers.slice(0, 5) : [],
      direction: (["+", "-", "neutral"].includes(t.direction) ? t.direction : "neutral") as Direction,
      magnitude: (["low", "med", "high"].includes(t.magnitude) ? t.magnitude : "low") as Magnitude,
      mechanism: typeof t.mechanism === "string" ? t.mechanism.slice(0, 200) : "",
      horizon: (["days", "weeks", "quarters"].includes(t.horizon) ? t.horizon : "days") as Horizon,
      confidence: (["low", "med", "high"].includes(t.confidence) ? t.confidence : "low") as Confidence,
      sector: typeof t.sector === "string" ? t.sector.slice(0, 24) : undefined,
      actionability,
      eventType,
    });
  }
  return out;
}

// ---------- Dedup helpers ----------

const STOP_TOKENS = new Set([
  "The",
  "Why",
  "What",
  "How",
  "When",
  "Where",
  "Who",
  "This",
  "That",
  "Today",
  "Tomorrow",
  "May",
  "Wednesday",
  "Tuesday",
  "Monday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "FY",
  "USD",
  "INR",
  "Rs",
  "Crore",
  "Lakh",
  "Million",
  "Billion",
  "CEO",
  "CFO",
  "IPO",
  "AI",
  "US",
  "UK",
  "EU",
  "EV",
  "GST",
  "AGM",
  "EGM",
  "Stock",
  "Stocks",
  "Share",
  "Shares",
  "Market",
  "Markets",
  "Price",
  "Earnings",
  "Results",
  "Revenue",
  "Profit",
  "Loss",
  "Buy",
  "Sell",
  "Hold",
]);

function extractEntities(text: string): Set<string> {
  // Capture sequences of capitalized tokens (likely names/companies). Strip stopwords.
  const out = new Set<string>();
  const matches = text.match(/\b[A-Z][a-zA-Z&.]{1,}(?:\s+[A-Z][a-zA-Z&.]{1,})*\b/g) || [];
  for (const m of matches) {
    const parts = m.split(/\s+/).filter((p) => !STOP_TOKENS.has(p));
    if (parts.length === 0) continue;
    const joined = parts.join(" ");
    if (joined.length < 3) continue;
    out.add(joined);
    // Also add each non-stopword token individually so single-name companies match
    // multi-name headlines and vice versa.
    for (const p of parts) {
      if (p.length >= 3 && !STOP_TOKENS.has(p)) out.add(p);
    }
  }
  return out;
}

function sourcePriority(source: string, boost?: Set<string>): number {
  // Targeted-only articles (id pre-stamped to a ticker) get a boost so they
  // survive against broad-feed near-duplicates that would otherwise dominate.
  const base = SOURCE_PRIORITY[source] ?? 3;
  if (boost && boost.has(source)) return base + 6;
  if (source.startsWith("Google News · ") || source.startsWith("Bing News · ")) {
    // Per-ticker targeted source label — strong implicit boost.
    return base + 5;
  }
  return base;
}

function isRetro(it: NewsItem): boolean {
  const text = it.title + " " + it.snippet;
  return RETRO_PATTERNS.some((re) => re.test(text));
}

/**
 * Pick the higher-signal article between two near-duplicates (entity-mention overlap).
 * Prefer non-retro, then higher SOURCE_PRIORITY, then newer.
 */
function preferArticle(a: NewsItem, b: NewsItem): NewsItem {
  const ar = isRetro(a);
  const br = isRetro(b);
  if (ar !== br) return ar ? b : a;
  const ap = sourcePriority(a.source);
  const bp = sourcePriority(b.source);
  if (ap !== bp) return ap > bp ? a : b;
  return +new Date(a.publishedAt) >= +new Date(b.publishedAt) ? a : b;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function dedupeArticles(input: NewsItem[]): NewsItem[] {
  // First pass: exact URL + normalized-title dedup (original behaviour).
  const byKey = new Map<string, NewsItem>();
  const seen = new Set<string>();
  const seenTitle = new Set<string>();
  for (const it of input) {
    const linkKey = it.link.split("?")[0];
    const titleKey = it.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(linkKey) || seenTitle.has(titleKey)) continue;
    seen.add(linkKey);
    seenTitle.add(titleKey);
    byKey.set(linkKey, it);
  }

  // Second pass: entity-overlap dedup within a 6h window.
  const pool = Array.from(byKey.values()).sort(
    (a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)
  );
  const kept: NewsItem[] = [];
  const entitiesCache = new WeakMap<NewsItem, Set<string>>();
  const entitiesOf = (it: NewsItem) => {
    let s = entitiesCache.get(it);
    if (!s) {
      s = extractEntities(it.title + " " + it.snippet);
      entitiesCache.set(it, s);
    }
    return s;
  };

  for (const candidate of pool) {
    const cEnt = entitiesOf(candidate);
    if (cEnt.size === 0) {
      kept.push(candidate);
      continue;
    }
    const cT = +new Date(candidate.publishedAt);
    let mergedIndex = -1;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (Math.abs(cT - +new Date(k.publishedAt)) > SIX_HOURS_MS) continue;
      const kEnt = entitiesOf(k);
      if (kEnt.size === 0) continue;
      // overlap = |intersection| / min(|a|, |b|)
      let inter = 0;
      const smaller = cEnt.size <= kEnt.size ? cEnt : kEnt;
      const larger = smaller === cEnt ? kEnt : cEnt;
      for (const e of smaller) if (larger.has(e)) inter++;
      const ratio = inter / Math.max(1, smaller.size);
      if (ratio > 0.5) {
        mergedIndex = i;
        break;
      }
    }
    if (mergedIndex === -1) {
      kept.push(candidate);
    } else {
      kept[mergedIndex] = preferArticle(kept[mergedIndex], candidate);
    }
  }
  return kept;
}

// ---------- View filter ----------

/**
 * Forecast view drops anything that is purely retrospective (`actionability: "skip"`).
 * Played-out view returns everything so the user can audit what already moved.
 */
function filterForView(
  articles: TaggedArticle[],
  view: "forecast" | "playedout" | "all"
): TaggedArticle[] {
  if (view === "playedout" || view === "all") return articles;
  return articles.filter((a) => a.tagging?.actionability !== "skip");
}

// ---------- GET ----------

// Disk cache (written by /portfolio-check skill or POST /api/news/cache).
// Preferred source: zero LLM cost, fresh whenever the user syncs.
async function readDiskCache(): Promise<CacheEntry | null> {
  try {
    const [raw, st] = await Promise.all([
      readFile(NEWS_CACHE_FILE, "utf8"),
      stat(NEWS_CACHE_FILE),
    ]);
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.articles)) return null;
    return {
      fetchedAt: st.mtimeMs,
      articles: data.articles as TaggedArticle[],
      llmEnabled: data.llmEnabled !== false,
      holdingsCount: data.holdingsCount ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fan out one Google News query per portfolio + watchlist ticker in parallel.
 * Each fetched article carries the ticker it was queried under via the
 * returned `byArticleId` map, so the tagger can pre-fill `tickers` even when
 * the headline doesn't mention the symbol verbatim.
 */
async function fetchAllTargetedNews(port: UserPortfolio): Promise<{
  items: NewsItem[];
  byArticleId: Map<string, string>;
}> {
  const byArticleId = new Map<string, string>();
  const results = await Promise.all(
    port.targetedTickers.map(async (t) => {
      const news = await fetchTargetedNews(t.ticker, t.companyName, t.region);
      for (const n of news) byArticleId.set(n.id, t.ticker);
      return news;
    })
  );
  return { items: results.flat(), byArticleId };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const mode = url.searchParams.get("mode"); // "raw" returns trimmed items + tickers for the skill to tag
  const viewParam = url.searchParams.get("view");
  const view: "forecast" | "playedout" | "all" =
    viewParam === "forecast"
      ? "forecast"
      : viewParam === "playedout"
        ? "playedout"
        : "all";

  // Token-efficient skill mode: fetch broad RSS + per-ticker targeted RSS in
  // parallel. Return minimal items + ticker bundle + the per-article ticker
  // pre-stamp so the skill's tagger can fall back to the queried ticker when
  // the headline doesn't mention the symbol verbatim.
  if (mode === "raw") {
    // Bumped to 25 default and 60 hard ceiling so targeted-only items survive
    // alongside broad-feed top stories. /portfolio-check Phase 2.6 documents
    // the new 20-25 sweet spot.
    const cap = Math.min(Number(url.searchParams.get("cap") || "25"), 60);
    const port = await loadUserPortfolio();
    const [rssResults, targeted] = await Promise.all([
      Promise.all(RSS_SOURCES.map((s) => fetchRSS(s.url, s.source, s.region))),
      fetchAllTargetedNews(port),
    ]);
    const all = [...rssResults.flat(), ...targeted.items];
    const deduped = dedupeArticles(all);
    deduped.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    const items = deduped.slice(0, cap).map((it) => {
      const pinnedTicker = targeted.byArticleId.get(it.id);
      return {
        id: it.id,
        title: it.title,
        snippet: it.snippet.slice(0, 140),
        source: it.source,
        region: it.region,
        publishedAt: it.publishedAt,
        imageUrl: it.imageUrl,
        link: it.link,
        // Pre-stamp: tells the chat-agent tagger which ticker this targeted
        // article was queried under. Falls back to keyword/LLM detection.
        pinnedTicker,
      };
    });
    const tickers = {
      in: port.inTickers,
      us: port.usTickers,
      mf: port.mfTickers,
      watchlist: port.watchlist,
    };
    return NextResponse.json({
      items,
      tickers,
      targetedCount: targeted.items.length,
      fanOut: port.targetedTickers.length,
    });
  }

  // Prefer disk cache (written by /portfolio-check) unless force=1
  if (!force) {
    const disk = await readDiskCache();
    if (disk) {
      const filtered = filterForView(disk.articles, view);
      return NextResponse.json({
        articles: filtered,
        llmEnabled: disk.llmEnabled,
        holdingsCount: disk.holdingsCount,
        cached: true,
        source: "disk",
        view,
        fetchedAt: new Date(disk.fetchedAt).toISOString(),
      });
    }
  }

  // Serve from in-memory cache
  if (!force && memCache && Date.now() - memCache.fetchedAt < TTL_MS) {
    const filtered = filterForView(memCache.articles, view);
    return NextResponse.json({
      articles: filtered,
      llmEnabled: memCache.llmEnabled,
      holdingsCount: memCache.holdingsCount,
      cached: true,
      source: "mem",
      view,
      fetchedAt: new Date(memCache.fetchedAt).toISOString(),
    });
  }

  // Load portfolio first so we can fan out targeted Google News queries in
  // parallel with broad RSS. Fan-out covers every holding + every high/med
  // confidence watchlist idea so small caps and low-coverage tickers
  // actually surface in the cache.
  const port = await loadUserPortfolio();
  const holdingsCount = port.inTickers.length + port.usTickers.length;

  const [rssResults, targeted] = await Promise.all([
    Promise.all(RSS_SOURCES.map((s) => fetchRSS(s.url, s.source, s.region))),
    fetchAllTargetedNews(port),
  ]);
  const all = [...rssResults.flat(), ...targeted.items];

  // Dedup (URL + title + entity-overlap within 6h). Targeted articles get
  // a source-priority boost inside `sourcePriority` so they survive against
  // broad-feed near-duplicates.
  const deduped = dedupeArticles(all);

  // Sort newest first, cap raised 40 → 60 to accommodate targeted volume.
  deduped.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const items = deduped.slice(0, 60);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let tagged: TaggedArticle[];
  let llmEnabled = false;

  if (apiKey && items.length > 0) {
    try {
      const client = new Anthropic({ apiKey });
      // Batch in groups of 10 so the cached prefix gets re-used
      const batches: NewsItem[][] = [];
      for (let i = 0; i < items.length; i += 10) batches.push(items.slice(i, i + 10));
      const allTags: Tagging[] = [];
      for (const b of batches) {
        try {
          const t = await llmTagBatch(client, port, b);
          allTags.push(...t);
        } catch (err) {
          console.warn("[news] LLM batch failed; falling back to keyword:", err);
          for (const it of b) allTags.push(keywordTag(it, port));
        }
      }
      tagged = items.map((it, i) => ({ ...it, tagging: allTags[i] || keywordTag(it, port) }));
      llmEnabled = true;
    } catch (err) {
      console.warn("[news] LLM client failed; keyword fallback:", err);
      tagged = items.map((it) => ({ ...it, tagging: keywordTag(it, port) }));
    }
  } else {
    tagged = items.map((it) => ({ ...it, tagging: keywordTag(it, port) }));
  }

  // Pre-stamp targeted-only articles with the ticker they were queried under
  // so a small-cap headline that mentions only the company name still maps
  // to its symbol downstream.
  for (const a of tagged) {
    const pinned = targeted.byArticleId.get(a.id);
    if (pinned && !a.tagging.tickers.includes(pinned)) {
      a.tagging.tickers = [pinned, ...a.tagging.tickers].slice(0, 5);
    }
  }

  // Played-out stub: anything >24h old, populate a tiny synthetic priceDelta.
  // Real price fetch is a TODO — see project_dashboard_improvements.md item.
  const now = Date.now();
  for (const a of tagged) {
    const age = now - +new Date(a.publishedAt);
    if (age > 24 * 60 * 60 * 1000 && a.tagging.tickers.length) {
      a.priceDelta = {};
      for (const t of a.tagging.tickers) {
        // deterministic stub: hash ticker+id to a small % so the UI shows plausible numbers.
        let h = 0;
        for (const c of t + a.id) h = (h * 31 + c.charCodeAt(0)) | 0;
        const pct = ((h % 800) - 400) / 100; // -4% .. +4%
        a.priceDelta[t] = pct;
      }
    }
  }

  memCache = {
    fetchedAt: Date.now(),
    articles: tagged,
    llmEnabled,
    holdingsCount,
  };

  const filtered = filterForView(tagged, view);
  return NextResponse.json({
    articles: filtered,
    llmEnabled,
    holdingsCount,
    cached: false,
    view,
    fetchedAt: new Date(memCache.fetchedAt).toISOString(),
  });
}

// POST — write the disk cache. Called by the /portfolio-check skill after
// tagging in chat-context (no LLM API call needed; the chat agent IS the LLM).
// Body: { articles: TaggedArticle[], llmEnabled?: boolean, holdingsCount?: number }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!Array.isArray(body?.articles)) {
      return NextResponse.json({ error: "articles array required" }, { status: 400 });
    }
    const payload = {
      fetchedAt: new Date().toISOString(),
      articles: body.articles as TaggedArticle[],
      llmEnabled: body.llmEnabled !== false,
      holdingsCount: typeof body.holdingsCount === "number" ? body.holdingsCount : 0,
    };
    await writeFile(NEWS_CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
    // Invalidate in-mem cache so next GET sees disk version
    memCache = null;
    return NextResponse.json({ ok: true, count: body.articles.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
