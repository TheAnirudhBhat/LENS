// buildBook() — reports data-freshness provenance for the dashboard's refresh
// indicator. The only consumer (/api/book → RefreshStatusIconButton) reads just
// `sources`, so we stat the three source files and return their mtimes.
// Server-side only (uses node:fs).

import { stat } from "node:fs/promises";
import { MUTUAL_FUNDS_FILE, SNAPSHOT_FILE, US_STOCKS_FILE } from "@/lib/paths";

export type BookSourceProvenance = {
  source: string;
  mtime: string | null;
  ok: boolean;
  note?: string;
};

async function provenance(
  path: string,
  source: string
): Promise<BookSourceProvenance> {
  try {
    const st = await stat(path);
    return { source, mtime: st.mtime.toISOString(), ok: true };
  } catch (err) {
    return {
      source,
      mtime: null,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function buildBook(): Promise<{ sources: BookSourceProvenance[] }> {
  const sources = await Promise.all([
    provenance(SNAPSHOT_FILE, "snapshot"),
    provenance(MUTUAL_FUNDS_FILE, "mutualFunds"),
    provenance(US_STOCKS_FILE, "usStocks"),
  ]);
  return { sources };
}
