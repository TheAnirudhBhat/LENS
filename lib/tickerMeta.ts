// Ticker → display metadata (name, logo domain, asset class). A small reference set of
// well-known tickers; unknown tickers fall back to a letter avatar via getMeta().

export type TickerMeta = {
  name: string;
  domain?: string;
  asset: "equity" | "etf" | "bond";
  sector?: string;
};

export const TICKER_META: Record<string, TickerMeta> = {
  // Global mega-caps
  AMZN: { name: "Amazon", domain: "amazon.com", asset: "equity", sector: "Consumer Internet" },
  AAPL: { name: "Apple", domain: "apple.com", asset: "equity", sector: "Technology" },
  MSFT: { name: "Microsoft", domain: "microsoft.com", asset: "equity", sector: "Technology" },
  GOOGL: { name: "Alphabet", domain: "google.com", asset: "equity", sector: "Technology" },
  NVDA: { name: "NVIDIA", domain: "nvidia.com", asset: "equity", sector: "Semiconductors" },
  META: { name: "Meta Platforms", domain: "meta.com", asset: "equity", sector: "Technology" },
  TSLA: { name: "Tesla", domain: "tesla.com", asset: "equity", sector: "EV" },

  // India NIFTY mega-caps
  RELIANCE: { name: "Reliance Industries", domain: "ril.com", asset: "equity", sector: "Conglomerate" },
  TCS: { name: "Tata Consultancy Services", domain: "tcs.com", asset: "equity", sector: "IT Services" },
  INFY: { name: "Infosys", domain: "infosys.com", asset: "equity", sector: "IT Services" },
  HDFCBANK: { name: "HDFC Bank", domain: "hdfcbank.com", asset: "equity", sector: "Banking" },
  ICICIBANK: { name: "ICICI Bank", domain: "icicibank.com", asset: "equity", sector: "Banking" },
};

export function getMeta(ticker: string): TickerMeta {
  return (
    TICKER_META[ticker] || {
      name: ticker,
      asset: "equity",
    }
  );
}

export function logoUrl(domain?: string) {
  if (!domain) return null;
  // Clearbit serves high-resolution PNG logos for most public companies.
  // Falls through to a colored-letter avatar via the img onError handler
  // when Clearbit doesn't have an entry for the domain.
  return `https://logo.clearbit.com/${domain}`;
}

// Secondary source — used by HoldingCard's onError fallback chain when
// Clearbit returns 404 (private companies, fund houses, etc).
export function logoFallbackUrl(domain?: string) {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

// Fallback avatar color from ticker hash
export function tickerColor(ticker: string) {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 65%, 40%)`;
}
