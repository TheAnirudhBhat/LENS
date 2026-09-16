/**
 * Kite Connect (Zerodha) client utility.
 *
 * Setup — add to `.env.local` (gitignored):
 *   KITE_API_KEY=<your_api_key>
 *   KITE_API_SECRET=<your_api_secret>
 *   KITE_ACCESS_TOKEN=<populated_after_login_flow>
 *
 * Login flow:
 *   1. GET /api/kite/login  → redirects to Kite OAuth URL
 *   2. Kite redirects back to /api/kite/callback?request_token=...&action=login
 *   3. Callback exchanges request_token + api_secret → access_token (24h)
 *   4. Access token is stored in a local file (kite-session.json, gitignored)
 *      because the hook denies writing to .env.local — you can promote to env
 *      after first run by copying the value.
 *
 * Daily refresh: access_token expires ~6 AM IST next day. Re-run /api/kite/login.
 */

import { KiteConnect as KiteConnectImport } from "kiteconnect";
import type { KiteConnectParams } from "kiteconnect";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";

// kiteconnect@5.3 mistypes the default export as a const value instead of a
// constructor. At runtime it IS a class. Cast through unknown so call sites
// can `new` it without TS yelling.
type KiteClient = {
  setAccessToken: (t: string) => void;
  getLoginURL: () => string;
  generateSession: (
    requestToken: string,
    apiSecret: string
  ) => Promise<{
    access_token: string;
    user_id?: string;
    user_name?: string;
    email?: string;
    login_time?: Date | string;
  }>;
  getHoldings: () => Promise<unknown>;
  getLTP: (instruments: string | string[]) => Promise<unknown>;
};
const KiteConnect = KiteConnectImport as unknown as new (
  p: KiteConnectParams
) => KiteClient;

const SESSION_FILE = path.join(MEMORY_DIR, "kite-session.json");

export type KiteSession = {
  access_token: string;
  user_id?: string;
  user_name?: string;
  email?: string;
  login_time?: string;
  expires_at?: string;
};

/** Read the stored Kite session (access token + metadata) if available. */
export async function readSession(): Promise<KiteSession | null> {
  try {
    const raw = await readFile(SESSION_FILE, "utf8");
    const parsed = JSON.parse(raw) as KiteSession;
    if (!parsed.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSession(s: KiteSession): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(s, null, 2), "utf8");
}

/** Construct a Kite client. If `withSession`, includes a saved access_token. */
export async function getKite(withSession = true): Promise<KiteClient> {
  const apiKey = process.env.KITE_API_KEY;
  if (!apiKey) {
    throw new Error("KITE_API_KEY missing — add to .env.local");
  }
  const kc = new KiteConnect({ api_key: apiKey });
  if (withSession) {
    const session = await readSession();
    if (session?.access_token) {
      kc.setAccessToken(session.access_token);
    }
  }
  return kc;
}

/** Get the URL the user clicks to log into Kite. */
export async function getLoginURL(): Promise<string> {
  const kc = await getKite(false);
  return kc.getLoginURL();
}

/** Exchange a request_token (from callback) for an access_token, and persist. */
export async function generateSession(requestToken: string): Promise<KiteSession> {
  const apiSecret = process.env.KITE_API_SECRET;
  if (!apiSecret) {
    throw new Error("KITE_API_SECRET missing — add to .env.local");
  }
  const kc = await getKite(false);
  const r = await kc.generateSession(requestToken, apiSecret);
  const session: KiteSession = {
    access_token: r.access_token,
    user_id: r.user_id,
    user_name: r.user_name,
    email: r.email,
    login_time: r.login_time?.toString(),
    // Kite tokens expire next morning ~6 AM IST; mark approximately.
    expires_at: nextExpiryIST().toISOString(),
  };
  await writeSession(session);
  return session;
}

/** Approximate next-day 6 AM IST as token expiry. */
function nextExpiryIST(): Date {
  const now = new Date();
  // IST = UTC+5:30; 6 AM IST = 00:30 UTC
  const tomorrowUTC = new Date(now);
  tomorrowUTC.setUTCDate(now.getUTCDate() + 1);
  tomorrowUTC.setUTCHours(0, 30, 0, 0);
  return tomorrowUTC;
}

// In-process dedupe cache. Multiple API routes (/api/snapshot, /api/decisions)
// call getHoldings() in parallel on first page load — without this, every
// route hit fires its own Kite roundtrip (~600ms each over the slice VPN).
// 30s TTL is long enough to fold the parallel storm into one call but short
// enough that manual refreshes still pick up live LTP changes.
let holdingsCache: { at: number; promise: Promise<unknown> } | null = null;
const HOLDINGS_TTL_MS = 30_000;

/** Fetch live equity holdings from Kite. Deduped across parallel callers. */
export async function getHoldings() {
  const now = Date.now();
  if (holdingsCache && now - holdingsCache.at < HOLDINGS_TTL_MS) {
    return holdingsCache.promise;
  }
  const kc = await getKite();
  const promise = kc.getHoldings().catch((err) => {
    // Don't poison the cache on failure — next caller retries.
    holdingsCache = null;
    throw err;
  });
  holdingsCache = { at: now, promise };
  return promise;
}

/** LTPs for a list of NSE/BSE instruments — e.g. ["NSE:RELIANCE", "BSE:TCS"]. */
export async function getLTP(instruments: string[]) {
  const kc = await getKite();
  return kc.getLTP(instruments);
}
