import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountConfigured,
  CHANNELS_PAUSED_HTTP_STATUS,
  channelsPausedWebhookResponse,
  defaultAccount,
  mentionedIn,
  OPENCLAW_CHANNELS_PAUSED_MESSAGE,
  pairingCode,
  senderAllowed,
} from "./channels.ts";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configSet, loadCanonical } from "./config.mjs";
import {
  channelBridgeState,
  OPENCLAW_CHANNELS_PAUSED_MESSAGE as PAUSED_MJS,
} from "./bridge-gate.mjs";
import { OPENCLAW_CHANNELS_PAUSED_MESSAGE as PAUSED_PURE } from "./channels-paused.ts";

test("pairingCode is 4 chars from the alphabet", () => {
  const code = pairingCode();
  assert.equal(code.length, 4);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
});

test("senderAllowed pairing asks unknown senders to pair", () => {
  const acc = { ...defaultAccount(), dmPolicy: "pairing" as const, allowFrom: ["111"] };
  assert.equal(senderAllowed(acc, "111"), "allow");
  assert.equal(senderAllowed(acc, "222"), "pair");
});

test("senderAllowed open lets anyone in", () => {
  const acc = { ...defaultAccount(), dmPolicy: "open" as const, allowFrom: [] };
  assert.equal(senderAllowed(acc, "999"), "allow");
});

test("senderAllowed allowlist denies strangers", () => {
  const acc = { ...defaultAccount(), dmPolicy: "allowlist" as const, allowFrom: ["111"] };
  assert.equal(senderAllowed(acc, "222"), "deny");
});

test("mentionedIn finds a bot handle", () => {
  assert.equal(mentionedIn("hey @paddy_bot look", ["@paddy_bot", "Paddy"]), true);
  assert.equal(mentionedIn("hello there", ["@paddy_bot"]), false);
});

test("accountConfigured matches each bridge", () => {
  assert.equal(accountConfigured("telegram", { ...defaultAccount(), token: "123:abc" }), true);
  assert.equal(accountConfigured("slack", { ...defaultAccount(), token: "xoxb" }), false);
  assert.equal(
    accountConfigured("slack", { ...defaultAccount(), token: "xoxb", appToken: "xapp" }),
    true,
  );
  assert.equal(
    accountConfigured("whatsapp", { ...defaultAccount(), token: "EAA", phoneId: "1" }),
    true,
  );
});

// ── Phase E: openclaw.runtime gates Paddy's channel bridge + webhooks ──────────
const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function tmpHome(runtime?: "paddy" | "openclaw"): string {
  const dir = mkdtempSync(join(tmpdir(), "paddy-phase-e-"));
  loadCanonical({ home: dir, persist: true });
  if (runtime) configSet("openclaw.runtime", runtime, { home: dir });
  return dir;
}

test("paused message: pure module, channels re-export and .mjs mirror are identical", () => {
  assert.equal(
    PAUSED_PURE,
    "Channels are configured in ~/.openclaw/openclaw.json, Paddy's bridge is paused.",
  );
  assert.equal(OPENCLAW_CHANNELS_PAUSED_MESSAGE, PAUSED_PURE);
  assert.equal(PAUSED_MJS, PAUSED_PURE);
});

test("channels-paused.ts stays pure (no imports)", () => {
  const src = readFileSync(join(kitRoot, "src/lib/harness/channels-paused.ts"), "utf8");
  assert.doesNotMatch(src, /\bimport\b|\brequire\(/);
});

test("bridge starts on default (paddy) runtime", () => {
  const fresh = tmpHome();
  assert.deepEqual(channelBridgeState({ home: fresh }), {
    runtime: "paddy",
    start: true,
    bridge: "on",
    message: "",
  });
  assert.equal(channelBridgeState({ home: tmpHome("paddy") }).start, true);
});

test("bridge does not start when openclaw.runtime=openclaw", () => {
  const st = channelBridgeState({ home: tmpHome("openclaw") });
  assert.equal(st.runtime, "openclaw");
  assert.equal(st.start, false);
  assert.equal(st.bridge, "paused");
  assert.equal(st.message, OPENCLAW_CHANNELS_PAUSED_MESSAGE);
});

function runBridge(home: string, ms: number) {
  return new Promise<{ code: number | null; stdout: string; alive: boolean }>((resolve) => {
    const child = spawn(process.execPath, [join(kitRoot, "bin/paddy-bridge.mjs"), "--origin", "http://127.0.0.1:9"], {
      env: { ...process.env, PADDY_HOME: home, PADDY_CLI_TOKEN: "test-token-not-used-0000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    let exited = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: null, stdout, alive: !exited });
    }, ms);
    child.on("exit", (code) => {
      exited = true;
      clearTimeout(timer);
      resolve({ code, stdout, alive: false });
    });
  });
}

test("paddy-bridge process keeps running on paddy runtime (no channels, no network)", async () => {
  const r = await runBridge(tmpHome("paddy"), 1200);
  assert.equal(r.alive, true, r.stdout);
  assert.doesNotMatch(r.stdout, /bridge is paused/);
});

test("paddy-bridge process exits immediately on openclaw runtime", async () => {
  const r = await runBridge(tmpHome("openclaw"), 5000);
  assert.equal(r.alive, false);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.split(OPENCLAW_CHANNELS_PAUSED_MESSAGE).length - 1, 1);
});

test("webhook guard passes through on paddy runtime", () => {
  assert.equal(channelsPausedWebhookResponse({ home: tmpHome() }), null);
  assert.equal(channelsPausedWebhookResponse({ home: tmpHome("paddy") }), null);
});

test("webhook guard refuses with 409 JSON when openclaw runtime", async () => {
  const res = channelsPausedWebhookResponse({ home: tmpHome("openclaw") });
  assert.ok(res);
  assert.equal(CHANNELS_PAUSED_HTTP_STATUS, 409);
  assert.equal(res.status, 409);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: OPENCLAW_CHANNELS_PAUSED_MESSAGE,
    code: "openclaw_channels_paused",
    runtime: "openclaw",
  });
});

test("every /api/hooks route handler checks the paused guard first", () => {
  const dir = join(kitRoot, "src/routes/api/hooks");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 2, files.join(","));
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    const handlers = src.match(/async function handle\w*\(/g) ?? [];
    assert.ok(handlers.length > 0, `${f} has no handlers`);
    for (const m of src.matchAll(/async function handle\w*\([^)]*\)[^{]*\{\n([^\n]*\n){0,3}/g)) {
      assert.match(m[0], /channelsPausedWebhookResponse\(\)/, `${f}: ${m[0].split("\n")[0]}`);
    }
  }
});
