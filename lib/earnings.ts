// Earnings data fetchers — Yahoo Finance quoteSummary first, defensive cache shape.
//
// Strict rules (drawn from the rebuild brief):
// - PRIMARY: Yahoo Finance quoteSummary (free, no key) with crumb-cookie flow.
// - FALLBACK: best-effort screen-scrape of the public quote page when crumb
//   acquisition fails. Each ticker fetched independently; one failure must not
//   take down the rest. No throws — always return null on failure.
// - Cache lives at `<MEMORY_DIR>/earnings_data.json` (see lib/paths.ts),
//   24h TTL. The route owns reads/writes; this file ships the schema.
//
// IN tickers use `.NS` (NSE) / `.BO` (BSE) suffix. US tickers are plain.

export type EarningsMetrics = {
  revenue?: number;
  revenueLabel?: string; // pre-formatted ("₹XXX Cr", "$10B") if known
  revenueYoYPct?: number;
  // `eps` / `epsYoYPct` actually carry NET INCOME (total profit), not per-share
  // EPS — Yahoo's financialsChart "earnings" series is net income. Field names
  // are retained for cache back-compat; the UI labels these "Profit".
  eps?: number;
  epsYoYPct?: number;
  epsEstimate?: number;
  surprisePct?: number;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  profitMarginPct?: number;
};

export type EarningsRecord = {
  ticker: string;
  company: string;
  market: "IN" | "US";
  period: string; // "Q4 FY26", "Q1 CY26"
  reportedAt: string; // ISO
  metrics: EarningsMetrics;
  brief: string; // one-line summary
  sourceUrl: string;
  sourceName: string; // "Yahoo Finance", "BSE filing", "Company IR", etc
  nextEarningsDate?: string; // ISO
  sector?: string;
};

export type EarningsCache = {
  updatedAt: string;
  records: EarningsRecord[];
};

// Forward-looking outlook seeded by /portfolio-check Phase 3.8. New shape:
// `meaningForUser` replaces old `outlook`. Direction/magnitude/confidence
// match News tagging so we can render the same hero block.
export type OutlookEntry = {
  ticker: string;
  period?: string;
  direction: "+" | "-" | "neutral";
  magnitude: "low" | "med" | "high";
  confidence: "low" | "med" | "high";
  meaningForUser: string; // ≤200 chars — "what this means for you"
  watchFor: string[]; // ≤3 items, each ≤80 chars
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Append the right Yahoo suffix for IN tickers. BSE/NSE choice is best-effort.
export function yahooSymbol(
  ticker: string,
  market: "IN" | "US",
  exchange?: string,
): string {
  if (market === "US") return ticker;
  const ex = (exchange || "").toUpperCase();
  if (ex === "BSE" || ex === "BOM") return `${ticker}.BO`;
  return `${ticker}.NS`;
}

async function tryFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<Response | null> {
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(init?.headers ?? {}),
      },
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

// ---------- Yahoo crumb / cookie acquisition ----------

let cachedCrumb: { token: string; cookie: string; expiresAt: number } | null =
  null;

async function getYahooCrumb(): Promise<{ token: string; cookie: string } | null> {
  if (cachedCrumb && cachedCrumb.expiresAt > Date.now()) {
    return { token: cachedCrumb.token, cookie: cachedCrumb.cookie };
  }
  // Step 1: hit fc.yahoo.com to receive consent cookies.
  const consent = await tryFetch("https://fc.yahoo.com", {
    redirect: "manual",
  });
  if (!consent) return null;
  const cookieHeader = consent.headers.get("set-cookie") ?? "";
  if (!cookieHeader) return null;
  // Coalesce all Set-Cookie pairs to a single `Cookie` header value.
  const cookie = cookieHeader
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  // Step 2: request crumb.
  const cr = await tryFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { Cookie: cookie, Accept: "text/plain" },
  });
  if (!cr) return null;
  const token = (await cr.text()).trim();
  if (!token || token.length > 64) return null;
  cachedCrumb = { token, cookie, expiresAt: Date.now() + 30 * 60 * 1000 };
  return { token, cookie };
}

// ---------- Yahoo quoteSummary ----------

type YahooSummary = {
  quoteSummary?: {
    result?: Array<{
      earnings?: {
        financialsChart?: {
          quarterly?: Array<{
            date?: string; // "4Q2024"
            revenue?: { raw?: number; fmt?: string };
            earnings?: { raw?: number; fmt?: string };
          }>;
        };
      };
      earningsHistory?: {
        history?: Array<{
          epsActual?: { raw?: number };
          epsEstimate?: { raw?: number };
          surprisePercent?: { raw?: number };
          quarter?: { raw?: number; fmt?: string };
          period?: string; // "-1q"
        }>;
      };
      calendarEvents?: {
        earnings?: {
          earningsDate?: Array<{ raw?: number; fmt?: string }>;
        };
      };
      financialData?: {
        revenueGrowth?: { raw?: number };
        grossMargins?: { raw?: number };
        operatingMargins?: { raw?: number };
        profitMargins?: { raw?: number };
        totalRevenue?: { raw?: number; fmt?: string };
      };
      price?: {
        shortName?: string;
        longName?: string;
        marketCap?: { raw?: number; fmt?: string };
      };
    }>;
  };
};

function formatCurrencyFromRaw(
  raw: number | undefined,
  market: "IN" | "US",
): string | undefined {
  if (raw === undefined || isNaN(raw)) return undefined;
  if (market === "US") {
    if (raw >= 1e9) return `$${(raw / 1e9).toFixed(2)}B`;
    if (raw >= 1e6) return `$${(raw / 1e6).toFixed(1)}M`;
    return `$${raw.toFixed(0)}`;
  }
  // INR Cr
  const cr = raw / 1e7;
  if (cr >= 1) return `₹${cr.toFixed(0)} Cr`;
  return `₹${raw.toLocaleString("en-IN")}`;
}

function inferPeriodLabel(rawQ?: string, market?: "IN" | "US"): string {
  // Yahoo gives "4Q2024" → "Q4 CY24" (US) or "Q4 FY25" (IN — approximate)
  if (!rawQ) return "";
  const m = rawQ.match(/^([1-4])Q(\d{4})$/i);
  if (!m) return rawQ;
  const q = m[1];
  const yr = m[2].slice(-2);
  return market === "IN" ? `Q${q} FY${yr}` : `Q${q} CY${yr}`;
}

export async function fetchYahooEarnings(
  ticker: string,
  market: "IN" | "US",
  exchange?: string,
): Promise<EarningsRecord | null> {
  const symbol = yahooSymbol(ticker, market, exchange);
  const crumb = await getYahooCrumb();
  if (!crumb) return null;
  const modules =
    "earnings,earningsHistory,calendarEvents,financialData,price";
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb.token)}`;
  const res = await tryFetch(url, {
    headers: {
      Cookie: crumb.cookie,
      Accept: "application/json",
    },
  });
  if (!res) return null;
  let parsed: YahooSummary;
  try {
    parsed = (await res.json()) as YahooSummary;
  } catch {
    return null;
  }
  const result = parsed.quoteSummary?.result?.[0];
  if (!result) return null;

  const fin = result.financialData;
  const earn = result.earnings;
  const hist = result.earningsHistory?.history ?? [];
  const cal = result.calendarEvents?.earnings;
  const price = result.price;

  // Latest quarterly print from financialsChart.
  const quarterly = earn?.financialsChart?.quarterly ?? [];
  const latest = quarterly[quarterly.length - 1];
  const prev = quarterly[quarterly.length - 5]; // YoY 4 quarters back
  const periodLabel = inferPeriodLabel(latest?.date, market);

  const revenueRaw = latest?.revenue?.raw;
  const revenueLabel =
    latest?.revenue?.fmt ?? formatCurrencyFromRaw(revenueRaw, market);
  const prevRev = prev?.revenue?.raw;
  let revenueYoYPct: number | undefined;
  if (revenueRaw && prevRev && prevRev > 0) {
    revenueYoYPct = ((revenueRaw - prevRev) / prevRev) * 100;
  } else if (fin?.revenueGrowth?.raw !== undefined) {
    revenueYoYPct = fin.revenueGrowth.raw * 100;
  }

  // NOTE: Yahoo's financialsChart.quarterly[].earnings is total NET INCOME in
  // reporting currency — NOT per-share EPS. So this YoY is a *profit* growth
  // figure. The field keeps the name `epsYoYPct` for cache/back-compat, but the
  // UI must label it "Profit" (see EarningsTab / PerTickerDrawer). Per-share EPS
  // would have to come from earningsHistory.epsActual, which only carries the
  // trailing ~4 quarters (no reliable year-ago pair), so we don't compute it.
  const netIncomeRaw = latest?.earnings?.raw;
  const prevNetIncome = prev?.earnings?.raw;
  let epsYoYPct: number | undefined;
  if (netIncomeRaw && prevNetIncome && prevNetIncome !== 0) {
    epsYoYPct = ((netIncomeRaw - prevNetIncome) / Math.abs(prevNetIncome)) * 100;
  }

  // Most recent history entry for surprise vs estimate.
  const latestHist = hist[hist.length - 1];
  const surprisePct =
    latestHist?.surprisePercent?.raw !== undefined
      ? latestHist.surprisePercent.raw
      : undefined;
  const epsEstimate = latestHist?.epsEstimate?.raw;

  const grossMarginPct =
    fin?.grossMargins?.raw !== undefined
      ? fin.grossMargins.raw * 100
      : undefined;
  const operatingMarginPct =
    fin?.operatingMargins?.raw !== undefined
      ? fin.operatingMargins.raw * 100
      : undefined;
  const profitMarginPct =
    fin?.profitMargins?.raw !== undefined
      ? fin.profitMargins.raw * 100
      : undefined;

  const company = price?.longName || price?.shortName || ticker;

  const nextEarningsDate =
    cal?.earningsDate && cal.earningsDate[0]?.raw
      ? new Date(cal.earningsDate[0].raw * 1000).toISOString()
      : undefined;

  // Reported-at = current time if we don't have a precise quarter end.
  const reportedAt = new Date().toISOString();

  // Build one-line brief.
  const bits: string[] = [];
  if (revenueLabel)
    bits.push(
      `Revenue ${revenueLabel}${
        revenueYoYPct !== undefined
          ? ` (${revenueYoYPct >= 0 ? "+" : ""}${revenueYoYPct.toFixed(0)}% YoY)`
          : ""
      }`,
    );
  if (netIncomeRaw !== undefined && netIncomeRaw !== null) {
    // netIncomeRaw is total net income (currency), not per-share EPS — format it
    // as a currency figure and label it "Profit" (the same label the UI chips
    // use), not "EPS". One honest name for one number, brief and chips agree.
    const niLabel = formatCurrencyFromRaw(netIncomeRaw, market) ?? `${netIncomeRaw}`;
    bits.push(
      `Profit ${niLabel}${
        epsYoYPct !== undefined
          ? ` (${epsYoYPct >= 0 ? "+" : ""}${epsYoYPct.toFixed(0)}% YoY)`
          : ""
      }`,
    );
  }
  if (operatingMarginPct !== undefined)
    bits.push(`op margin ${operatingMarginPct.toFixed(1)}%`);
  const brief = bits.length ? bits.join(", ") : "Latest reported quarter";

  return {
    ticker,
    company,
    market,
    period: periodLabel || "Latest quarter",
    reportedAt,
    metrics: {
      revenue: revenueRaw,
      revenueLabel,
      revenueYoYPct,
      // `eps` here is net income (currency), not per-share — kept under this key
      // for cache back-compat; UI labels it "Profit". `epsYoYPct` likewise.
      eps: netIncomeRaw,
      epsYoYPct,
      epsEstimate,
      surprisePct,
      grossMarginPct,
      operatingMarginPct,
      profitMarginPct,
    },
    brief,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    sourceName: "Yahoo Finance",
    nextEarningsDate,
  };
}

// Batch helper used by the route. Independent fetches; one failure does not
// take down the rest. Bounded concurrency (4 at a time) to be polite.
export async function fetchYahooBatch(
  targets: Array<{ ticker: string; market: "IN" | "US"; exchange?: string }>,
): Promise<EarningsRecord[]> {
  const out: EarningsRecord[] = [];
  const concurrency = 4;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const idx = cursor++;
      const t = targets[idx];
      try {
        const rec = await fetchYahooEarnings(t.ticker, t.market, t.exchange);
        if (rec) out.push(rec);
      } catch {
        // swallow per-ticker errors
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// Outlook match — exact period preferred, ticker fallback otherwise.
export function findOutlookFor(
  ticker: string,
  period: string | undefined,
  outlooks: OutlookEntry[],
): OutlookEntry | undefined {
  const tk = ticker.toUpperCase();
  if (period) {
    const exact = outlooks.find(
      (o) =>
        o.ticker.toUpperCase() === tk &&
        (o.period ?? "").replace(/\s+/g, "").toUpperCase() ===
          period.replace(/\s+/g, "").toUpperCase(),
    );
    if (exact) return exact;
  }
  return outlooks.find((o) => o.ticker.toUpperCase() === tk);
}

// Lightweight ticker → market detection for watchlist items that lack an
// explicit market hint (all watchlist names are IN equities).
export function deriveMarket(ticker: string): "IN" | "US" {
  return /^[A-Z]{1,5}$/.test(ticker) && ticker.length <= 4 ? "US" : "IN";
}
