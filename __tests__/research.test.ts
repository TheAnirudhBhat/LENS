import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadResearch } from "../lib/research";

const VALID_US = {
  ticker: "X",
  name: "X Corp",
  sector: "Tech",
  thesis: "t",
  whyNow: "n",
  score: 7,
  confidence: "HIGH" as const,
  verdict: "Buy" as const,
  tags: [] as string[],
};

describe("loadResearch", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lens-research-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads valid us.json and returns isDemo:false", async () => {
    writeFileSync(join(dir, "us.json"), JSON.stringify([VALID_US]));
    const result = await loadResearch("us", dir);
    expect(result.isDemo).toBe(false);
    expect(result.entries).toHaveLength(1);
    const first = result.entries[0] as { ticker: string };
    expect(first.ticker).toBe("X");
  });

  it("returns empty entries with isDemo:false when no file", async () => {
    // dir is an empty temp dir — no us.json; no sample fallback
    const result = await loadResearch("us", dir);
    expect(result.isDemo).toBe(false);
    expect(result.entries).toHaveLength(0);
  });

  it("throws on corrupt us.json", async () => {
    writeFileSync(join(dir, "us.json"), "[");
    await expect(loadResearch("us", dir)).rejects.toThrow();
  });
});
