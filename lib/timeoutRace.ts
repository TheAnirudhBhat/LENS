/**
 * withinMs — bound how long a request waits on best-effort live enrichment.
 *
 * The file-backed API routes enrich stored data with live network calls (Kite,
 * Yahoo, mfapi). Those caches are warm (~5ms) most of the time, but a cold open
 * after >60s idle would otherwise block the first paint on a 1-3s round-trip.
 *
 * withinMs returns the enriched result if it lands within `ms`, else returns the
 * stored `fallback` immediately. The enrichment promise is NOT cancelled — it
 * keeps running and still populates the underlying 60s cache, so the next request
 * gets the live values fast. Never rejects (a thrown enrichment yields fallback).
 *
 * Net effect: paint is capped at `ms`; data is live whenever the network is quick
 * or the cache is warm, and the stored values (kept fresh by the refresh cron /
 * portfolio-check) cover the cold-and-slow case.
 */
/**
 * Paint budget for the file-backed routes that gate the Overview's first paint
 * (snapshot / mutual funds / US stocks). The stored files are kept fresh by the
 * refresh cron + /portfolio-check, so we only wait this long for live enrichment
 * before serving stored data; the live fetch keeps warming the cache for the next
 * request. Lower = faster cold paint, marginally less chance of catching a live
 * value on the very first hit after the cache goes cold.
 */
export const PAINT_BUDGET_MS = 350;

export function withinMs<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    work.catch(() => fallback),
    guard,
  ]).finally(() => clearTimeout(timer));
}
