import { NextResponse } from "next/server";

// Spawn a headless claude to call kite LTP for indices, since Kite MCP is stdio-only
// and Next.js server can't talk to it directly. We'll cache the result in-memory for 60s.

import { spawn } from "node:child_process";
import { MEMORY_DIR } from "@/lib/paths";

export const runtime = "nodejs";

const INSTRUMENTS = [
  "NSE:NIFTY 50",
  "NSE:NIFTY BANK",
  "NSE:NIFTY IT",
  "NSE:NIFTY AUTO",
  "NSE:NIFTY PHARMA",
  "NSE:NIFTY METAL",
  "NSE:INDIA VIX",
];

type Cache = { at: number; data: Record<string, number> | null };
let cache: Cache = { at: 0, data: null };

export async function GET() {
  if (cache.data && Date.now() - cache.at < 60_000) {
    return NextResponse.json({ data: cache.data, cached: true });
  }

  // Read the snapshot file — dashboard already has fresh data written by Claude
  // For indices specifically, we also look at latest_indices.json if Claude wrote one.
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const indicesFile = path.join(MEMORY_DIR, "latest_indices.json");
    const raw = await fs.readFile(indicesFile, "utf8");
    const data = JSON.parse(raw);
    cache = { at: Date.now(), data };
    return NextResponse.json({ data, cached: false });
  } catch {
    return NextResponse.json({ data: null, error: "no indices file yet" });
  }
}
