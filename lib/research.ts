/**
 * Research loader — reads research/us.json or research/mf.json from MEMORY_DIR.
 *
 * Fallback chain:
 *   1. Real file present → validate, return { entries, isDemo: LENS_DEMO==="1" }
 *   2. ENOENT           → return { entries: [], isDemo: LENS_DEMO==="1" }
 *   3. Corrupt JSON     → throw loudly
 *
 * isDemo mirrors lib/profile.ts — reflects the LENS_DEMO env flag (npm run demo).
 * Server-side only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RESEARCH_DIR } from "./paths";
import { USCandidateSchema, MFCandidateSchema, parseOrThrow } from "./schemas";

type Market = "us" | "mf";
const SCHEMA = { us: USCandidateSchema, mf: MFCandidateSchema } as const;

async function readJsonOrNull(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw new Error(
      `Failed to read/parse ${file}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function loadResearch(
  market: Market,
  dir: string = RESEARCH_DIR
): Promise<{
  entries: z.output<(typeof SCHEMA)[Market]>[];
  isDemo: boolean;
}> {
  const isDemo = process.env.LENS_DEMO === "1";
  const schema = z.array(SCHEMA[market]);
  const real = await readJsonOrNull(join(dir, `${market}.json`));
  if (real !== null) {
    return {
      entries: parseOrThrow(schema, real, `research/${market}.json`),
      isDemo,
    };
  }
  return { entries: [], isDemo };
}
