// Last-known FX persistence.
//
// A missing `fx` block on us_stocks.json used to silently fall back to a 1:1
// USD→INR rate, which turns a $10k holding into ₹10k (a ~95x understatement of
// the US silo). To make that failure mode impossible, we persist the last live
// rate to MEMORY_DIR/fx_last_known.json and read it back when no live rate is
// present. If neither a live rate nor a stored rate exists, callers should
// throw — a loud error beats a silently wrong portfolio total.
//
// Shape on disk: { "usdInr": number, "asOf": "YYYY-MM-DD" }. External data,
// resolved via lib/paths.ts MEMORY_DIR — NOT committed to the repo.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MEMORY_DIR } from "./paths";

export const FX_LAST_KNOWN_FILE = path.join(MEMORY_DIR, "fx_last_known.json");

export type LastKnownFx = { usdInr: number; asOf: string };

/**
 * Read the last-known USD→INR rate from disk. Returns the numeric rate, or
 * `null` when the file is missing / malformed / non-positive. Synchronous so it
 * can be used inside otherwise-sync fallback expressions.
 */
export function readLastKnownFx(): LastKnownFx | null {
  try {
    const raw = readFileSync(FX_LAST_KNOWN_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<LastKnownFx>;
    const usdInr = Number(parsed?.usdInr);
    if (!Number.isFinite(usdInr) || usdInr <= 0) return null;
    return { usdInr, asOf: String(parsed?.asOf ?? "") };
  } catch {
    return null;
  }
}

/**
 * Last-known USD→INR rate as a number. Throws when no usable rate is stored,
 * so a missing live `fx` block can never silently degrade to 1:1.
 */
export function getLastKnownFx(): number {
  const last = readLastKnownFx();
  if (last) return last.usdInr;
  throw new Error(
    `[fx] No live USD→INR rate and no stored fallback at ${FX_LAST_KNOWN_FILE}. ` +
      `Refusing to assume 1:1 (would understate the US silo ~95x). ` +
      `Run a US-stocks sync, or seed the file with {"usdInr": <rate>, "asOf": "YYYY-MM-DD"}.`,
  );
}

/**
 * Persist a freshly-observed live rate so future loads have a real fallback.
 * Best-effort: a write failure is swallowed (the live rate already drove this
 * request; persistence is only for the next one).
 */
export function writeLastKnownFx(usdInr: number, asOf?: string): void {
  if (!Number.isFinite(usdInr) || usdInr <= 0) return;
  const payload: LastKnownFx = {
    usdInr,
    asOf: asOf && asOf.length > 0 ? asOf : new Date().toISOString().slice(0, 10),
  };
  try {
    writeFileSync(FX_LAST_KNOWN_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // best-effort persistence; ignore
  }
}

/**
 * Resolve the FX rate for a load: prefer the live rate, persist it through, and
 * otherwise fall back to the last-known stored rate. Throws (via
 * getLastKnownFx) when neither exists.
 */
export function resolveFx(liveUsdInr: number | null | undefined, liveAsOf?: string): number {
  if (liveUsdInr != null && Number.isFinite(liveUsdInr) && liveUsdInr > 0) {
    writeLastKnownFx(liveUsdInr, liveAsOf);
    return liveUsdInr;
  }
  return getLastKnownFx();
}
