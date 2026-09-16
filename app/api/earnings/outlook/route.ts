import { NextResponse } from "next/server";
import { readFile, writeFile, stat } from "node:fs/promises";
import { EARNINGS_OUTLOOK_FILE } from "@/lib/paths";
import type { OutlookEntry } from "@/lib/earnings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheShape = {
  updatedAt: string;
  items: OutlookEntry[];
};

const DIRS = new Set(["+", "-", "neutral"]);
const MAGS = new Set(["low", "med", "high"]);
const CONFS = new Set(["low", "med", "high"]);

// GET — returns disk cache (or empty). Used by the dashboard's Earnings tab.
export async function GET() {
  try {
    const [raw, st] = await Promise.all([
      readFile(EARNINGS_OUTLOOK_FILE, "utf8"),
      stat(EARNINGS_OUTLOOK_FILE),
    ]);
    const parsed = JSON.parse(raw) as Partial<CacheShape>;
    return NextResponse.json({
      updatedAt: parsed.updatedAt ?? new Date(st.mtimeMs).toISOString(),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    });
  } catch {
    return NextResponse.json({ updatedAt: null, items: [] });
  }
}

// POST — overwrite disk cache. Called by the /portfolio-check skill after
// reasoning over fresh earnings_data in chat-context. Validates the new
// (direction/magnitude/confidence/meaningForUser) shape.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) {
      return NextResponse.json(
        { error: "items array required" },
        { status: 400 },
      );
    }
    const items: OutlookEntry[] = [];
    for (const raw of body.items as Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object") continue;
      const ticker = typeof raw.ticker === "string" ? raw.ticker.trim() : "";
      const meaningForUser =
        typeof raw.meaningForUser === "string"
          ? raw.meaningForUser.trim().slice(0, 200)
          : typeof raw.outlook === "string"
            ? raw.outlook.trim().slice(0, 200)
            : "";
      if (!ticker || !meaningForUser) continue;
      const dirRaw = typeof raw.direction === "string" ? raw.direction : "";
      const direction: OutlookEntry["direction"] = DIRS.has(dirRaw)
        ? (dirRaw as OutlookEntry["direction"])
        : "neutral";
      const magRaw = typeof raw.magnitude === "string" ? raw.magnitude : "";
      const magnitude: OutlookEntry["magnitude"] = MAGS.has(magRaw)
        ? (magRaw as OutlookEntry["magnitude"])
        : "med";
      const confRaw = typeof raw.confidence === "string" ? raw.confidence : "";
      const confidence: OutlookEntry["confidence"] = CONFS.has(confRaw)
        ? (confRaw as OutlookEntry["confidence"])
        : "med";
      const period =
        typeof raw.period === "string" && raw.period.trim()
          ? raw.period.trim().slice(0, 32)
          : undefined;
      const watchForRaw = Array.isArray(raw.watchFor) ? raw.watchFor : [];
      const watchFor = watchForRaw
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, 3)
        .map((x) => x.trim().slice(0, 80));
      items.push({
        ticker: ticker.toUpperCase(),
        period,
        direction,
        magnitude,
        confidence,
        meaningForUser,
        watchFor,
      });
    }
    const payload: CacheShape = {
      updatedAt: new Date().toISOString(),
      items: items.slice(0, 30),
    };
    await writeFile(
      EARNINGS_OUTLOOK_FILE,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    return NextResponse.json({ ok: true, count: payload.items.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
