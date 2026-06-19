import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MEMORY_DIR } from "@/lib/paths";
import { TasksFileSchema, parseOrThrow, TaskSchema } from "@/lib/schemas";
import type { z } from "zod";

const FILE = path.join(MEMORY_DIR, "tasks.json");

type Task = z.infer<typeof TaskSchema>;

async function read(): Promise<{ tasks: Task[]; _meta?: unknown }> {
  const raw = await readFile(FILE, "utf8");
  const json = JSON.parse(raw);
  return parseOrThrow(TasksFileSchema, json, "tasks") as {
    tasks: Task[];
    _meta?: unknown;
  };
}

async function write(data: { tasks: Task[]; _meta?: unknown }) {
  await writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

type Priority = NonNullable<Task["priority"]>;
const VALID_PRIORITIES: Priority[] = ["urgent", "high", "med", "low"];

// PATCH /api/tasks/[id] — surgical update of `done` and/or `priority`.
// Used by the task explainer modal for: mark done, snooze (demote priority).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const data = await read();
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (typeof body.done === "boolean") {
    t.done = body.done;
    t.completedAt = body.done ? new Date().toISOString().slice(0, 10) : undefined;
  }
  if (typeof body.priority === "string" && VALID_PRIORITIES.includes(body.priority as Priority)) {
    t.priority = body.priority as Priority;
  }

  await write(data);
  return NextResponse.json({ ok: true, task: t });
}
