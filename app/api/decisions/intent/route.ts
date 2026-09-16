import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { DECISIONS_FILE } from "@/lib/paths";
import { DecisionsFileSchema, parseOrThrow } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Decision = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  qty?: number;
  price?: number;
  rationale?: string;
  asset?: string;
  verdict?: "good" | "bad" | "pending";
  reviewAt?: string;
  note?: string;
  createdAt?: string;
  amountINR?: number;
};

type DecisionsFile = { decisions: Decision[] };

async function readDecisions(): Promise<DecisionsFile> {
  try {
    const raw = await readFile(DECISIONS_FILE, "utf8");
    const json = JSON.parse(raw);
    return parseOrThrow(DecisionsFileSchema, json, "decisions") as DecisionsFile;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("[decisions]")) {
      console.error(msg);
      throw err;
    }
    return { decisions: [] };
  }
}

async function writeDecisions(data: DecisionsFile) {
  await writeFile(DECISIONS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function nextId(decisions: Decision[]): string {
  let max = 0;
  for (const d of decisions) {
    const m = /^d(\d+)$/.exec(d.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `d${max + 1}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const asset = String(body?.asset || "").trim();
    const amountINR = Number(body?.amountINR);
    const rationale = String(body?.rationale || "").trim();
    if (!asset) {
      return NextResponse.json({ error: "asset required" }, { status: 400 });
    }
    if (!Number.isFinite(amountINR) || amountINR <= 0) {
      return NextResponse.json(
        { error: "amountINR must be a positive number" },
        { status: 400 }
      );
    }
    const data = await readDecisions();
    const createdAt = new Date().toISOString();
    const entry: Decision = {
      id: nextId(data.decisions),
      date: createdAt.slice(0, 10),
      action: "DEPLOY_INTENT",
      ticker: "",
      asset,
      amountINR,
      rationale,
      verdict: "pending",
      createdAt,
    };
    data.decisions.unshift(entry);
    await writeDecisions(data);
    return NextResponse.json({ ok: true, id: entry.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
