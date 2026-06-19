/**
 * INDmoney login bridge.
 *
 * The indian-broker MCP server (../indian-stock-mcp-agent) holds Playwright
 * sessions in process memory — there is no shared on-disk session token to
 * import. So we spawn it as a long-lived child of the Next dev server, speak
 * JSON-RPC over stdio, and keep it alive across requests via module state.
 *
 * Login flow:
 *   1. UI POSTs /api/indmoney/login.
 *   2. We ensure the MCP child is running, then call tools/call broker_connect
 *      {broker:"indmoney"}. The MCP opens a headed Chrome.
 *   3. User logs in via OTP. The MCP captures the session in its store.
 *   4. UI polls /api/indmoney/status which calls broker_status on the same
 *      child; once `connected: true`, UI flips.
 *
 * We also mirror the latest status to ~/.claude/.../indmoney-session.json so
 * if the Next.js process restarts and the child dies, the UI still has a
 * "last known" hint (the user will need to re-login though, since the MCP's
 * Playwright context goes with it).
 */

import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MEMORY_DIR } from "@/lib/paths";

const MCP_JS =
  process.env.INDMONEY_MCP_JS ??
  path.join(
    os.homedir(),
    "claude",
    "personal",
    "projects",
    "indian-stock-mcp-agent",
    "build",
    "index.js"
  );

const SESSION_FILE = path.join(MEMORY_DIR, "indmoney-session.json");

export type IndmoneyStatus = {
  connected: boolean;
  sessionAgeMinutes?: number;
  connectedAt?: string;
};

type RpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

type Child = {
  proc: ChildProcessWithoutNullStreams;
  buf: string;
  pending: Map<number, (m: RpcMessage) => void>;
  nextId: number;
  initialized: Promise<void>;
};

// Module-level singleton. Survives across API requests within one Next.js
// server process. HMR in dev nukes it (acceptable: user re-logins).
let child: Child | null = null;

function spawnChild(): Child {
  const proc = spawn(process.execPath, [MCP_JS], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      BROWSER_DATA_DIR:
        process.env.INDMONEY_BROWSER_DATA_DIR ??
        path.join(
          os.homedir(),
          "claude",
          "personal",
          "projects",
          "indian-stock-mcp-agent",
          "browser-data"
        ),
    },
  });
  const c: Child = {
    proc,
    buf: "",
    pending: new Map(),
    nextId: 1,
    initialized: Promise.resolve(),
  };
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    c.buf += chunk;
    let idx: number;
    while ((idx = c.buf.indexOf("\n")) >= 0) {
      const line = c.buf.slice(0, idx).trim();
      c.buf = c.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcMessage;
        if (typeof msg.id === "number" && c.pending.has(msg.id)) {
          c.pending.get(msg.id)!(msg);
          c.pending.delete(msg.id);
        }
      } catch {
        // ignore non-JSON
      }
    }
  });
  proc.on("exit", () => {
    if (child === c) child = null;
  });
  // Drain stderr — MCP logs go there. Keep silent in prod.
  proc.stderr.on("data", () => {});

  c.initialized = (async () => {
    await rpc(c, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "portfolio-dashboard", version: "0.1.0" },
    });
    // notifications/initialized has no id
    c.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
  })();
  return c;
}

function rpc(c: Child, method: string, params: unknown, timeoutMs = 30_000): Promise<RpcMessage> {
  return new Promise((resolve, reject) => {
    const id = c.nextId++;
    const timer = setTimeout(() => {
      c.pending.delete(id);
      reject(new Error(`MCP timeout: ${method}`));
    }, timeoutMs);
    c.pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    c.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function getChild(): Child {
  if (!child) child = spawnChild();
  return child;
}

function parseToolResult(msg: RpcMessage): string {
  if (msg.error) throw new Error(msg.error.message);
  const r = msg.result as { content?: Array<{ type: string; text?: string }> } | undefined;
  const txt = r?.content?.find((p) => p.type === "text")?.text;
  return txt ?? "";
}

/** Kick off the headed browser login. Returns once the browser is open
 *  (does NOT wait for the user to finish logging in). */
export async function startLogin(): Promise<{ message: string }> {
  const c = getChild();
  await c.initialized;
  const msg = await rpc(c, "tools/call", {
    name: "broker_connect",
    arguments: { broker: "indmoney", method: "browser_login" },
  });
  return { message: parseToolResult(msg) };
}

/** Query current connection status. */
export async function getStatus(): Promise<IndmoneyStatus> {
  if (!child) {
    // No live MCP — fall back to last-known persisted status.
    return readPersistedStatus();
  }
  try {
    await child.initialized;
    const msg = await rpc(child, "tools/call", {
      name: "broker_status",
      arguments: {},
    });
    const text = parseToolResult(msg);
    // broker_status returns a JSON-stringified array of brokers in the text
    // payload. Find the indmoney entry.
    const parsed = JSON.parse(text) as Array<{
      broker: string;
      connected: boolean;
      sessionAgeMinutes?: number;
    }>;
    const ind = parsed.find((b) => b.broker === "indmoney");
    const status: IndmoneyStatus = {
      connected: !!ind?.connected,
      sessionAgeMinutes: ind?.sessionAgeMinutes,
      connectedAt: ind?.connected
        ? new Date(Date.now() - (ind.sessionAgeMinutes ?? 0) * 60_000).toISOString()
        : undefined,
    };
    // Persist for next process restart.
    writePersistedStatus(status).catch(() => {});
    return status;
  } catch {
    return readPersistedStatus();
  }
}

async function readPersistedStatus(): Promise<IndmoneyStatus> {
  try {
    const raw = await readFile(SESSION_FILE, "utf8");
    const parsed = JSON.parse(raw) as IndmoneyStatus;
    return { ...parsed, connected: false }; // stale — always show disconnected
  } catch {
    return { connected: false };
  }
}

async function writePersistedStatus(s: IndmoneyStatus): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(s, null, 2), "utf8");
}
