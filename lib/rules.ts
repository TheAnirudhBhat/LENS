/**
 * lib/rules.ts — server-side loader for `rules.json` in the data dir.
 *
 * - Missing file (fresh install) → DEFAULT_RULES, flagged via `source`.
 * - Malformed file → throws with the Zod message. Never a silent default:
 *   a rulebook that quietly falls back is two rulebooks.
 * - Cached by mtime so a hand edit shows up on the next request without a
 *   restart.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MEMORY_DIR } from "@/lib/paths";
import { DEFAULT_RULES, RulesSchema, type Rules } from "@/lib/rulesSchema";

export const RULES_FILE = path.join(MEMORY_DIR, "rules.json");

export type LoadedRules = Rules & { source: "file" | "defaults" };

let cache: { mtimeMs: number; rules: LoadedRules } | null = null;

export function loadRules(): LoadedRules {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(RULES_FILE).mtimeMs;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return { ...DEFAULT_RULES, source: "defaults" };
    }
    throw err;
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.rules;

  const parsed = RulesSchema.safeParse(JSON.parse(readFileSync(RULES_FILE, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `rules.json is malformed — fix it, the score will not run on defaults while a file exists: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const rules: LoadedRules = { ...parsed.data, source: "file" };
  cache = { mtimeMs, rules };
  return rules;
}
