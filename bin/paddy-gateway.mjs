#!/usr/bin/env node
/**
 * Supervisor: Vite dashboard + channel bridge. Owned by `paddy gateway`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { channelBridgeState } from "../src/lib/harness/bridge-gate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.PADDY_BIND || "127.0.0.1";
const port = process.env.PADDY_PORT || "8080";

const wrapper = join(root, "scripts/with-app-env.mjs");
const viteJs = join(root, "node_modules/vite/bin/vite.js");
const viteBin = existsSync(viteJs) ? viteJs : "vite";
const bridge = join(root, "bin/paddy-bridge.mjs");

if (!existsSync(wrapper)) {
  process.stderr.write(`paddy: not a kit (${wrapper} missing)\n`);
  process.exit(1);
}

const children = [];

function start(args, name) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (shutting) return;
    process.stderr.write(`paddy: ${name} exited (${signal || code})\n`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shutting = false;
function shutdown(code = 0) {
  if (shutting) return;
  shutting = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start([wrapper, viteBin, "dev", "--host", host, "--port", String(port)], "dashboard");
// openclaw.runtime=openclaw: OpenClaw polls the bots — never start a second poller.
const bridgeGate = channelBridgeState();
if (bridgeGate.start) {
  start([bridge, "--origin", `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`], "bridge");
} else {
  process.stdout.write(`paddy: ${bridgeGate.message}\n`);
}

const origin = `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`;
const token = (process.env.PADDY_CLI_TOKEN || "").trim();
if (token) {
  const tick = () => {
    fetch(`${origin}/api/cli`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "wake" }),
    }).catch(() => {});
  };
  const timer = setInterval(tick, 30_000);
  timer.unref?.();
}
