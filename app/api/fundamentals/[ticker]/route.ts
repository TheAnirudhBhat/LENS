import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Fundamentals = {
  ticker: string;
  pe?: number;
  roce?: number;
  roe?: number;
  dividendYield?: number;
  debtToEquity?: number;
  marketCap?: number;
  priceToBook?: number;
  salesGrowth3Y?: number;
  profitGrowth3Y?: number;
  promoterHolding?: number;
  source: string;
};

type Cache = { at: number; data: Fundamentals };
const cache = new Map<string, Cache>();
const TTL = 60 * 60 * 1000; // 1h

const ratioPatterns: Array<[keyof Fundamentals, RegExp]> = [
  ["pe", /Stock P\/E[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)/i],
  ["roce", /ROCE[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)\s*%/i],
  ["roe", /ROE[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)\s*%/i],
  ["dividendYield", /Dividend Yield[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)\s*%/i],
  ["debtToEquity", /Debt to equity[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)/i],
  ["marketCap", /Market Cap[\s\S]*?<span[^>]*class="number"[^>]*>([\d,]+)/i],
  ["priceToBook", /Price to book[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)/i],
  ["promoterHolding", /Promoter holding[\s\S]*?<span[^>]*class="number"[^>]*>([\d.]+)\s*%/i],
];

function parseNum(s: string) {
  return Number(s.replace(/,/g, ""));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  const cached = cache.get(t);
  if (cached && Date.now() - cached.at < TTL) {
    return NextResponse.json({ data: cached.data, cached: true });
  }

  // Try consolidated first, then standalone
  const urls = [
    `https://www.screener.in/company/${t}/consolidated/`,
    `https://www.screener.in/company/${t}/`,
  ];
  let html: string | null = null;
  let usedUrl = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
      });
      if (res.ok) {
        html = await res.text();
        usedUrl = url;
        break;
      }
    } catch {
      // try next
    }
  }
  if (!html) {
    return NextResponse.json(
      { error: "screener.in fetch failed for " + t },
      { status: 502 }
    );
  }

  const data: Fundamentals = { ticker: t, source: usedUrl };
  for (const [key, re] of ratioPatterns) {
    const m = html.match(re);
    if (m) {
      (data as Record<string, unknown>)[key] = parseNum(m[1]);
    }
  }

  // Sales + Profit 3Y CAGR from the "Growth" block if present
  const salesGrowth = html.match(
    /Compounded Sales Growth[\s\S]*?3 Years:[\s\S]*?<span[^>]*>([\-\d.]+)\s*%/i
  );
  if (salesGrowth) data.salesGrowth3Y = parseNum(salesGrowth[1]);
  const profitGrowth = html.match(
    /Compounded Profit Growth[\s\S]*?3 Years:[\s\S]*?<span[^>]*>([\-\d.]+)\s*%/i
  );
  if (profitGrowth) data.profitGrowth3Y = parseNum(profitGrowth[1]);

  cache.set(t, { at: Date.now(), data });
  return NextResponse.json({ data, cached: false });
}
