import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MEMORY_DIR } from "@/lib/paths";
import { TasksFileSchema, parseOrThrow, TaskSchema } from "@/lib/schemas";
import type { z } from "zod";


// Read live from disk on every request (prod `next build` would otherwise bake the file at build time).
export const dynamic = "force-dynamic";
const FILE = path.join(MEMORY_DIR, "tasks.json");

type Task = z.infer<typeof TaskSchema>;

async function read(): Promise<{ tasks: Task[] }> {
  try {
    const raw = await readFile(FILE, "utf8");
    const json = JSON.parse(raw);
    return parseOrThrow(TasksFileSchema, json, "tasks");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("[tasks]")) {
      console.error(msg);
      throw err;
    }
    return { tasks: [] };
  }
}

async function write(data: { tasks: Task[] }) {
  await writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  try {
    const data = await read();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ tasks: [], error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const data = await read();
  const id = `t${Date.now()}`;
  data.tasks.push({
    id,
    text,
    done: false,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  await write(data);
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const data = await read();
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  t.done = !t.done;
  t.completedAt = t.done ? new Date().toISOString().slice(0, 10) : undefined;
  await write(data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const data = await read();
  data.tasks = data.tasks.filter((t) => t.id !== id);
  await write(data);
  return NextResponse.json({ ok: true });
}
