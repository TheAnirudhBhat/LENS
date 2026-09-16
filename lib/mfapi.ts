/**
 * MFAPI.in client — free public API for live Indian mutual fund NAVs.
 *
 * No auth required. Endpoints:
 *   GET https://api.mfapi.in/mf/<code>/latest  → latest NAV for a scheme
 *   GET https://api.mfapi.in/mf/<code>          → full NAV history
 *   GET https://api.mfapi.in/mf/search?q=<text> → search by name
 *
 * Our internal ticker → scheme_code mapping lives in
 * memory/mf_scheme_codes.json. Update that file when adding a new scheme.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";

const SCHEME_CODES_FILE = path.join(MEMORY_DIR, "mf_scheme_codes.json");

export type MFNavRecord = {
  ticker: string;
  schemeCode: number;
  schemeName: string;
  nav: number;
  date: string; // dd-mm-yyyy as returned by mfapi
};

type SchemeMapEntry = { code: number; name: string };
type SchemeMapFile = { schemes: Record<string, SchemeMapEntry> };

let cachedMap: SchemeMapFile | null = null;

async function loadSchemeMap(): Promise<SchemeMapFile> {
  if (cachedMap) return cachedMap;
  const raw = await readFile(SCHEME_CODES_FILE, "utf8");
  cachedMap = JSON.parse(raw) as SchemeMapFile;
  return cachedMap;
}

/** Fetch latest NAV for a single scheme code. */
export async function fetchLatestNAV(
  schemeCode: number
): Promise<{ nav: number; date: string; name: string } | null> {
  const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}/latest`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    meta?: { scheme_name?: string };
    data?: { date: string; nav: string }[];
    status?: string;
  };
  const latest = json.data?.[0];
  if (!latest) return null;
  const nav = parseFloat(latest.nav);
  if (!Number.isFinite(nav)) return null;
  return { nav, date: latest.date, name: json.meta?.scheme_name ?? "" };
}

// Same dedupe pattern as kite.ts.getHoldings — /api/mfnav, /api/mutualfunds,
// and /api/decisions all call fetchAllNAVs() in parallel on first load.
// 60s TTL since NAVs update once daily anyway.
let navsCache: { at: number; promise: Promise<MFNavRecord[]> } | null = null;
const NAVS_TTL_MS = 60_000;

/** Fetch latest NAVs for all mapped schemes in parallel. Deduped. */
export async function fetchAllNAVs(): Promise<MFNavRecord[]> {
  const now = Date.now();
  if (navsCache && now - navsCache.at < NAVS_TTL_MS) {
    return navsCache.promise;
  }
  const promise = (async () => {
    const map = await loadSchemeMap();
    const tickers = Object.keys(map.schemes);
    const results = await Promise.all(
      tickers.map(async (ticker): Promise<MFNavRecord | null> => {
        const { code, name } = map.schemes[ticker];
        const latest = await fetchLatestNAV(code);
        if (!latest) return null;
        return {
          ticker,
          schemeCode: code,
          schemeName: latest.name || name,
          nav: latest.nav,
          date: latest.date,
        };
      })
    );
    return results.filter((r): r is MFNavRecord => r !== null);
  })().catch((err) => {
    navsCache = null;
    throw err;
  });
  navsCache = { at: now, promise };
  return promise;
}
