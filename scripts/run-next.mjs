#!/usr/bin/env node
// Conditional corporate-CA wrapper around the Next.js CLI.
//
// Why this exists: the package.json scripts used to hardcode
//   NODE_EXTRA_CA_CERTS=$HOME/.ssl/netskope-ca.pem
// in front of every `next` invocation. That env var points at a corporate
// (Netskope) CA bundle that only exists on the owner's machine. On any other
// machine the path resolves to a missing file and Node aborts at startup,
// which made the public clone uninstallable.
//
// This wrapper resolves a CA path only if one is actually present, applies it
// when found, and otherwise leaves NODE_EXTRA_CA_CERTS unset. Net effect: the
// corporate CA still applies on the owner's machine, and is silently skipped
// everywhere else.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Resolve the locally-installed Next.js binary so we don't depend on `next`
// being on PATH. On Windows npm installs `next.cmd`; everywhere else `next`.
function resolveNextBin() {
  const binDir = join(process.cwd(), "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? ["next.cmd", "next.exe", "next"]
      : ["next"];
  for (const name of candidates) {
    const full = join(binDir, name);
    if (existsSync(full)) {
      return full;
    }
  }
  // Fall back to a bare `next` and let spawn surface a clear error.
  return "next";
}

function resolveCaPath() {
  // (a) Respect an explicitly-set NODE_EXTRA_CA_CERTS if it points at a real file.
  const fromEnv = process.env.NODE_EXTRA_CA_CERTS;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  // (b) The owner's corporate CA, installed outside the repo.
  const ownerCa = join(homedir(), ".ssl", "netskope-ca.pem");
  if (existsSync(ownerCa)) {
    return ownerCa;
  }

  // (c) A repo-local bundle, if someone drops one in.
  const localCa = join(process.cwd(), "corp-ca-bundle.pem");
  if (existsSync(localCa)) {
    return localCa;
  }

  return null;
}

const caPath = resolveCaPath();
if (caPath) {
  process.env.NODE_EXTRA_CA_CERTS = caPath;
} else {
  // Ensure a stale/missing-file value can't crash Node at startup.
  delete process.env.NODE_EXTRA_CA_CERTS;
}

// Forward every arg after the script straight through to the Next.js CLI,
// e.g. `dev -p 3002`, `build`, `start -p 3002`.
const args = process.argv.slice(2);
const nextBin = resolveNextBin();

const child = spawn(nextBin, args, {
  stdio: "inherit",
  env: process.env,
  // `.cmd` shims on Windows require a shell to execute.
  shell: process.platform === "win32",
});

child.on("error", (err) => {
  console.error(`[run-next] failed to launch next: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
