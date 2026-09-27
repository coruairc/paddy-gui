#!/usr/bin/env node
/**
 * Paddy CLI — same control plane as `openclaw gateway` / `hermes gateway`.
 *
 *   paddy gateway          run in the foreground
 *   paddy gateway start    background
 *   paddy chat "…"         one-shot (gateway must be up)
 *
 * Talks to the local gateway over HTTP. Keys come from the gateway env
 * (selfhost.env), not from the browser's localStorage.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  openSync,
  closeSync,
  realpathSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { HUB_SKILLS } from "../src/lib/harness/hub-catalog.mjs";
import { parseSkillMd, toSkillMd } from "../src/lib/harness/skill-md.mjs";
import {
  canonicalConfigSchema,
  configGet,
  configSet,
  configUnset,
  exportToLineage,
  importFromLineage,
  loadCanonical,
  loadPendingPairs,
  loadResolvedAccounts,
  redactConfig,
  removeCanonicalChannel,
  resolvedSnapshot,
  saveCanonical,
  savePendingPairs,
  upsertCanonicalChannel,
  validateCanonical,
} from "../src/lib/harness/config.mjs";
import {
  parseConfigureSections,
  runConfigureWizard,
} from "../src/lib/harness/configure-wizard.mjs";

export const VERSION = "0.1.0";
const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "127.0.0.1";

function preferAlias(id) {
  const raw = String(id || "").trim();
  if (raw === "laguna-s" || raw === "laguna-xs") return "laguna";
  if (raw === "chatgpt-plus" || raw === "chatgpt-pro" || raw === "codex") return "chatgpt";
  if (raw === "claude-pro" || raw === "claude-max") return "claude";
  if (raw === "kimi-coding" || raw === "moonshot") return "kimi";
  if (raw === "zai" || raw === "zhipu" || raw === "z-ai" || raw === "glm") return "glm";
  return raw;
}

function preferModel(id) {
  const raw = String(id || "").trim();
  if (raw === "laguna-xs") return "poolside/laguna-xs-2.1";
  if (raw === "laguna-s") return "poolside/laguna-s-2.1";
  return undefined;
}

export function kitRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function paddyHome() {
  return process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
}

function homePath(...parts) {
  return join(paddyHome(), ...parts);
}

export function parseArgv(argv) {
  const flags = {
    port: undefined,
    host: undefined,
    json: false,
    help: false,
    version: false,
    yes: false,
    check: false,
    prefer: undefined,
    token: undefined,
    appToken: undefined,
    sync: undefined,
    allowFrom: undefined,
    dmPolicy: undefined,
    phoneId: undefined,
    verifyToken: undefined,
    number: undefined,
    url: undefined,
    from: undefined,
    user: undefined,
    pass: undefined,
    to: undefined,
    target: undefined,
    confirm: false,
    kind: undefined,
    section: [],
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--version" || a === "-V") flags.version = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--check") flags.check = true;
    else if (a === "--port") flags.port = Number(argv[++i]);
    else if (a?.startsWith("--port=")) flags.port = Number(a.slice(7));
    else if (a === "--host") flags.host = argv[++i];
    else if (a?.startsWith("--host=")) flags.host = a.slice(7);
    else if (a === "--prefer") flags.prefer = argv[++i];
    else if (a?.startsWith("--prefer=")) flags.prefer = a.slice(9);
    else if (a === "--token") flags.token = argv[++i];
    else if (a?.startsWith("--token=")) flags.token = a.slice(8);
    else if (a === "--app-token") flags.appToken = argv[++i];
    else if (a?.startsWith("--app-token=")) flags.appToken = a.slice(12);
    else if (a === "--sync") flags.sync = argv[++i];
    else if (a?.startsWith("--sync=")) flags.sync = a.slice(7);
    else if (a === "--allow-from") flags.allowFrom = argv[++i];
    else if (a?.startsWith("--allow-from=")) flags.allowFrom = a.slice(13);
    else if (a === "--dm-policy") flags.dmPolicy = argv[++i];
    else if (a?.startsWith("--dm-policy=")) flags.dmPolicy = a.slice(12);
    else if (a === "--phone-id") flags.phoneId = argv[++i];
    else if (a?.startsWith("--phone-id=")) flags.phoneId = a.slice(11);
    else if (a === "--verify-token") flags.verifyToken = argv[++i];
    else if (a?.startsWith("--verify-token=")) flags.verifyToken = a.slice(15);
    else if (a === "--number") flags.number = argv[++i];
    else if (a?.startsWith("--number=")) flags.number = a.slice(9);
    else if (a === "--url") flags.url = argv[++i];
    else if (a?.startsWith("--url=")) flags.url = a.slice(6);
    else if (a === "--from") flags.from = argv[++i];
    else if (a?.startsWith("--from=")) flags.from = a.slice(7);
    else if (a === "--user") flags.user = argv[++i];
    else if (a?.startsWith("--user=")) flags.user = a.slice(7);
    else if (a === "--pass") flags.pass = argv[++i];
    else if (a?.startsWith("--pass=")) flags.pass = a.slice(7);
    else if (a === "--to") flags.to = argv[++i];
    else if (a?.startsWith("--to=")) flags.to = a.slice(5);
    else if (a === "--target") flags.target = argv[++i];
    else if (a?.startsWith("--target=")) flags.target = a.slice(9);
    else if (a === "--confirm") flags.confirm = true;
    else if (a === "--kind") flags.kind = argv[++i];
    else if (a?.startsWith("--kind=")) flags.kind = a.slice(7);
    else if (a === "--section") flags.section.push(argv[++i]);
    else if (a?.startsWith("--section=")) flags.section.push(a.slice(10));
    else if (a === "--") rest.push(...argv.slice(i + 1));
    else if (a?.startsWith("-") && a !== "-") {
      throw new Error(`Unknown flag ${a}`);
    } else if (a) rest.push(a);
  }
  if (flags.port != null && (!Number.isFinite(flags.port) || flags.port < 1 || flags.port > 65535)) {
    throw new Error(" --port must be 1–65535");
  }
  return { flags, rest };
}

export function helpText() {
  return `Paddy Irishman — Irish-roots super harness  v${VERSION}

Usage:
  paddy <command> [flags]

Gateway
  paddy gateway              Run the gateway + channel bridge in the foreground
  paddy gateway start        Start in the background
  paddy gateway stop         Stop the background gateway
  paddy gateway restart      Restart the background gateway
  paddy gateway status       Is the gateway up?
  paddy gateway setup        Hermes-style wizard (Telegram, Discord, Slack, …)

  paddy configure            Interactive section wizard (↑/↓ + Enter)
  paddy config               Same wizard on a TTY; --yes / non-TTY → first-run init
  paddy config init          First-run home + selfhost.env
  paddy config show          Print canonical config (secrets redacted)
  paddy config get <path>    Read a path (secrets redacted)
  paddy config set <path> <json>  Set a path to a JSON value
  paddy config unset <path>  Remove a path
  paddy config schema        Print JSON Schema subset (FE / Control UI)
  paddy config validate      Check the JSON schema
  paddy config import        Pull OpenClaw / Hermes into Paddy config
  paddy channels             List connected channels
  paddy channels add <id>    Connect telegram | discord | slack | whatsapp | signal | email
  paddy channels remove <id> Disconnect a channel
  paddy channels export      Write compatibility files (--to openclaw|hermes|both)
  paddy pairing approve CODE Allow a stranger (pairing policy)

Talk
  paddy chat                 Interactive REPL (gateway must be running)
  paddy chat "message"       One-shot turn
  paddy dashboard            Open the web console
  paddy models               List brains the gateway can see
  paddy models prefer <id>   Remember a preferred brain
  paddy skills               List skills on this mind
  paddy skills install <id>  Copy a hub playbook onto this mind
  paddy skills import [file] Add a SKILL.md (stdin if omitted or -)
  paddy skills export <name> Print a skill as SKILL.md
  paddy memory               Show MEMORY.md facts (alias: list)
  paddy memory status        Char meters + entry count
  paddy memory list [target] List memory|user entries
  paddy memory search <q>    Ranked recall search
  paddy memory add <text>    Append a MEMORY entry (--target user)
  paddy memory recall <q>    Preview injection ranking
  paddy memory reset         Wipe store (--target all|memory|user --confirm)
  paddy approve allow|deny   Allow or deny the last held tool
  paddy agent list           List minds

Setup
  paddy onboard              Alias for paddy config init (first-run)
  paddy doctor               Check the install
  paddy status               Alias for gateway status
  paddy update               Pull the latest release and reinstall
  paddy update --check       Check for an update without applying it

Flags
  --port <n>     Gateway port (default ${DEFAULT_PORT})
  --host <h>     Bind / connect host (default ${DEFAULT_HOST})
  --prefer <id>  Brain for this chat (supergrok, chatgpt, claude, kimi, glm, …)
  --json         Machine-readable output
  --token <s>    Bot token (channels add)
  --app-token    Slack app token (xapp-…)
  --allow-from   Comma-separated user ids
  --dm-policy    pairing | allowlist | open
  --sync         openclaw | hermes | both  (export compatibility after add)
  --to           openclaw | hermes | both  (channels export)
  --from         openclaw | hermes | both  (config import)
  --section <s>  Configure wizard section filter (repeatable)
  --yes          Non-interactive config / setup / import replace
  --help

Keys live in ~/.paddy/.env (secrets) and selfhost.env (brains). config.json is the
canonical structure — OpenClaw and Hermes files are import/export only.

Quick start
  curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash
  paddy gateway
`;
}

function ensureHome() {
  mkdirSync(paddyHome(), { recursive: true, mode: 0o700 });
  try { chmodSync(paddyHome(), 0o700); } catch { /* already owned */ }
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureHome();
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* ignore */ }
}

export function loadConfig() {
  const { config, env } = loadCanonical({ persist: true });
  const tokenRef = typeof config.cli?.token === "string" ? config.cli.token : "";
  const token =
    (env.PADDY_CLI_TOKEN || "").trim() ||
    (tokenRef.startsWith("${") ? "" : tokenRef);
  return {
    port: Number(config.gateway?.port) || DEFAULT_PORT,
    host: typeof config.gateway?.host === "string" && config.gateway.host ? config.gateway.host : DEFAULT_HOST,
    token,
    preferredProvider: preferAlias(
      typeof config.brain?.preferred === "string" ? config.brain.preferred : "supergrok",
    ),
    preferredModel: typeof config.brain?.model === "string" ? config.brain.model : undefined,
    root: typeof config.kit?.root === "string" && config.kit.root ? config.kit.root : kitRoot(),
    ref: typeof config.kit?.ref === "string" && config.kit.ref ? config.kit.ref : undefined,
  };
}

export function saveConfig(patch) {
  const { config } = loadCanonical({ persist: true });
  if (patch.port != null) config.gateway.port = Number(patch.port) || config.gateway.port;
  if (patch.host) config.gateway.host = patch.host;
  if (patch.preferredProvider) config.brain.preferred = preferAlias(patch.preferredProvider);
  if (patch.preferredModel !== undefined) {
    if (patch.preferredModel) config.brain.model = patch.preferredModel;
    else delete config.brain.model;
  }
  if (patch.root) config.kit.root = patch.root;
  if (patch.ref) {
    config.kit = config.kit || {};
    config.kit.ref = patch.ref;
  }
  let token = patch.token;
  if (!token) token = loadConfig().token;
  if (!token || token.length < 16) token = randomBytes(24).toString("hex");
  saveCanonical(config, { envPatch: { PADDY_CLI_TOKEN: token } });
  const next = loadConfig();
  next.token = token;
  return next;
}

function pidPath() {
  return homePath("gateway.pid");
}

function logPath() {
  return homePath("gateway.log");
}

export function readPid() {
  try {
    const [pidLine, portLine] = readFileSync(pidPath(), "utf8").trim().split(/\n/);
    const pid = Number(pidLine);
    const port = Number(portLine) || loadConfig().port;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, port };
  } catch {
    return null;
  }
}

function writePid(pid, port) {
  ensureHome();
  writeFileSync(pidPath(), `${pid}\n${port}\n`, { mode: 0o600 });
  try { chmodSync(pidPath(), 0o600); } catch { /* ignore */ }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function loadDotEnv(file) {
  if (!file || !existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

function gatewayEnv(cfg) {
  const root = cfg.root || kitRoot();
  const fileEnv = {
    ...loadDotEnv(join(root, "selfhost.env.example")),
    ...loadDotEnv(homePath("selfhost.env")),
    ...loadDotEnv(join(root, "selfhost.env")),
    ...loadDotEnv(homePath(".env")),
  };
  for (const [k, v] of Object.entries(fileEnv)) {
    if (typeof v === "string" && !v.trim()) delete fileEnv[k];
  }
  const env = { ...fileEnv, ...process.env };
  env.PADDY_CLI_TOKEN = cfg.token;
  env.PADDY_MODEL = cfg.preferredProvider;
  return env;
}

function out(flags, data, text) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function fail(flags, error, code = 1) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  } else {
    process.stderr.write(`paddy: ${error}\n`);
  }
  process.exitCode = code;
}

export function baseUrl(cfg, flags) {
  const host = flags.host || cfg.host || DEFAULT_HOST;
  const port = flags.port || cfg.port || DEFAULT_PORT;
  const hostname = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  if (!/^[A-Za-z0-9.-]+$/.test(hostname)) {
    throw new Error("host must be a hostname or IP");
  }
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error("port must be 1–65535");
  }
  return { host, port: n, hostname, origin: `http://${hostname}:${n}` };
}

export async function fetchCli(cfg, flags, { method = "GET", body } = {}) {
  const { origin } = baseUrl(cfg, flags);
  const headers = { accept: "application/json" };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  if (body) headers["content-type"] = "application/json";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch(`${origin}/api/cli`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: res.ok, raw: text.slice(0, 400) };
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

function spawnCaptured(command, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* gone */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }, 1500);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr: timedOut ? `${stderr}\ntimed out after ${timeoutMs}ms`.trim() : stderr,
        timedOut,
      });
    });
  });
}

function sanitizeGitRef(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "HEAD") return "";
  if (s.startsWith("-")) return "";
  if (!/^[A-Za-z0-9._/-]+$/.test(s)) return "";
  return s.replace(/^origin\//, "").replace(/^tags\//, "");
}

async function gitStdout(root, args, timeoutMs = 15_000) {
  const r = await spawnCaptured("git", args, { cwd: root, timeoutMs });
  if (r.code !== 0) return "";
  return r.stdout.trim();
}

async function detectGitRef(root) {
  const branch = sanitizeGitRef(await gitStdout(root, ["rev-parse", "--abbrev-ref", "HEAD"]));
  if (branch) return branch;
  const tag = sanitizeGitRef(await gitStdout(root, ["describe", "--tags", "--exact-match"]));
  if (tag) return tag;
  const upstream = sanitizeGitRef(await gitStdout(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]));
  if (upstream) return upstream;
  const originHead = sanitizeGitRef(
    await gitStdout(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
  );
  if (originHead) return originHead;
  return "main";
}

async function resolveUpdateRef(root) {
  try {
    const stored = sanitizeGitRef(loadConfig().ref);
    if (stored) return stored;
  } catch {
    /* no config yet */
  }
  return detectGitRef(root);
}

const NOT_A_GIT_CHECKOUT =
  "paddy update: this install isn't a git checkout (zip kit or vendored). Re-download the kit to update.";

export async function checkForUpdate(kitRootPath) {
  const root = kitRootPath || kitRoot();
  if (!existsSync(join(root, ".git"))) {
    return { ok: false, git: false, error: NOT_A_GIT_CHECKOUT };
  }
  const ref = await resolveUpdateRef(root);
  const fetched = await spawnCaptured("git", ["fetch", "--depth", "1", "origin", ref], {
    cwd: root,
    timeoutMs: 20_000,
  });
  if (fetched.code !== 0) {
    const detail = (fetched.stderr || fetched.stdout).trim() || `exit ${fetched.code}`;
    return {
      ok: false,
      git: true,
      ref,
      error: fetched.timedOut ? `git fetch timed out (${ref})` : `git fetch failed: ${detail}`,
    };
  }
  const headOut = await spawnCaptured("git", ["rev-parse", "HEAD"], { cwd: root, timeoutMs: 10_000 });
  const fetchHeadOut = await spawnCaptured("git", ["rev-parse", "FETCH_HEAD"], {
    cwd: root,
    timeoutMs: 10_000,
  });
  const current = headOut.stdout.trim();
  const latest = fetchHeadOut.stdout.trim();
  if (headOut.code !== 0 || !/^[0-9a-f]{7,40}$/i.test(current)) {
    return {
      ok: false,
      git: true,
      ref,
      error: `could not read HEAD: ${(headOut.stderr || headOut.stdout).trim() || "unknown"}`,
    };
  }
  if (fetchHeadOut.code !== 0 || !/^[0-9a-f]{7,40}$/i.test(latest)) {
    return {
      ok: false,
      git: true,
      ref,
      error: `could not read FETCH_HEAD: ${(fetchHeadOut.stderr || fetchHeadOut.stdout).trim() || "unknown"}`,
    };
  }
  const upToDate = current === latest;
  return {
    ok: true,
    git: true,
    upToDate,
    ref,
    current,
    latest,
    shortCurrent: current.slice(0, 7),
    shortLatest: latest.slice(0, 7),
  };
}

function updateRoot() {
  try {
    return loadConfig().root || kitRoot();
  } catch {
    return kitRoot();
  }
}

async function pingHttp(origin) {
  try {
    const res = await fetch(origin, { method: "GET", redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

function spawnGateway(cfg, flags, { detached }) {
  const root = cfg.root || kitRoot();
  const gatewayJs = join(root, "bin/paddy-gateway.mjs");
  const { host, port } = baseUrl(cfg, flags);
  if (!existsSync(gatewayJs)) {
    throw new Error(`Not a Paddy kit (${gatewayJs} missing). Run this from the unzipped folder.`);
  }
  const env = gatewayEnv(cfg);
  env.PADDY_BIND = host;
  env.PADDY_PORT = String(port);
  ensureHome();
  const args = [gatewayJs];
  if (detached) {
    const fd = openSync(logPath(), "a");
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    closeSync(fd);
    writePid(child.pid, port);
    return child;
  }
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  writePid(child.pid, port);
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code, signal) => {
    try {
      const rec = readPid();
      if (rec?.pid === child.pid) rmSync(pidPath(), { force: true });
    } catch {
      /* ignore */
    }
    if (signal) process.exit(128);
    process.exit(code ?? 0);
  });
  return child;
}

async function waitForUp(cfg, flags, ms = 25000) {
  const { origin } = baseUrl(cfg, flags);
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await pingHttp(origin)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function liveWorkspace(flags) {
  try {
    const cfg = loadConfig();
    const r = await fetchCli(cfg, flags, { method: "POST", body: { action: "workspace" } });
    if (r.data?.ok && r.data.workspace) return r.data.workspace;
  } catch {
    /* gateway down — fall back to the on-disk file */
  }
  return loadWorkspace();
}

function loadWorkspace() {
  const fallback = {
    files: {},
    history: [],
    preferredProvider: loadConfig().preferredProvider,
  };
  return readJson(homePath("workspace.json"), fallback);
}

async function pushWorkspace(flags, ws) {
  saveWorkspace(ws);
  try {
    const cfg = loadConfig();
    await fetchCli(cfg, flags, {
      method: "POST",
      body: { action: "workspace-save", workspace: ws },
    });
  } catch {
    /* gateway down */
  }
}

function saveWorkspace(ws) {
  writeJson(homePath("workspace.json"), ws);
}

function applyMutations(ws, mutations) {
  if (!Array.isArray(mutations)) return ws;
  const next = {
    ...ws,
    files: { ...(ws.files ?? {}) },
    history: [...(ws.history ?? [])],
    memories: [...(ws.memories ?? [])],
    skills: [...(ws.skills ?? [])],
    tickets: [...(ws.tickets ?? [])],
    dailyNotes: [...(ws.dailyNotes ?? [])],
  };
  for (const m of mutations) {
    if (!m || typeof m !== "object") continue;
    if (m.type === "write_memory" && m.text) {
      if (m.mode === "replace") next.memories = [];
      next.memories.push({ text: m.text, kind: m.kind || "fact" });
      next.files.memory = `# MEMORY.md\n\n${next.memories.map((x) => `- (${x.kind}) ${x.text}`).join("\n") || "- (empty)"}\n`;
    } else if (m.type === "update_user" && m.content) {
      next.files.user = m.content;
    } else if (m.type === "update_soul" && m.content) {
      next.files.soul = m.content;
    } else if (m.type === "update_heartbeat" && m.content) {
      next.files.heartbeat = m.content;
    } else if (m.type === "create_skill" && m.name) {
      if (!(next.skills ?? []).some((s) => s.name === m.name)) {
        next.skills = [
          { name: m.name, description: m.description, instructions: m.instructions, triggers: m.triggers ?? [], status: "new", uses: 0 },
          ...(next.skills ?? []),
        ];
      }
    } else if (m.type === "patch_skill" && m.name && m.instructions) {
      next.skills = (next.skills ?? []).map((s) =>
        s.name === m.name ? { ...s, instructions: m.instructions, status: s.status === "archived" ? s.status : "active" } : s,
      );
    } else if (m.type === "archive_skill" && m.name) {
      next.skills = (next.skills ?? []).map((s) => (s.name === m.name ? { ...s, status: "archived" } : s));
    } else if (m.type === "install_hub" && m.name) {
      if (!(next.skills ?? []).some((s) => s.name === m.name)) {
        next.skills = [
          { name: m.name, description: m.description, instructions: m.instructions, triggers: m.triggers ?? [], status: "active", uses: 0 },
          ...(next.skills ?? []),
        ];
      }
    } else if (m.type === "create_ticket" && m.title) {
      next.tickets = [
        { id: `t-${Date.now()}`, title: m.title, body: m.body ?? "", status: m.status || "backlog" },
        ...(next.tickets ?? []),
      ];
    } else if (m.type === "update_ticket" && m.id) {
      next.tickets = (next.tickets ?? []).map((t) =>
        t.id === m.id ? { ...t, title: m.title ?? t.title, body: m.body ?? t.body, status: m.status ?? t.status } : t,
      );
    } else if (m.type === "daily_note" && m.content) {
      const date = new Date().toISOString().slice(0, 10);
      const existing = (next.dailyNotes ?? []).find((d) => d.date === date);
      if (existing) {
        next.dailyNotes = next.dailyNotes.map((d) =>
          d.date === date ? { ...d, content: `${d.content}\n${m.content}` } : d,
        );
      } else {
        next.dailyNotes = [{ date, content: m.content }, ...(next.dailyNotes ?? [])];
      }
    } else if (m.type === "schedule_wake") {
      next.wakes = [
        {
          id: `wk-${Date.now()}`,
          at: Date.now() + (Number(m.delayMinutes) || 30) * 60_000,
          reason: m.reason,
          note: m.note,
          fired: false,
          notified: false,
        },
        ...(next.wakes ?? []),
      ];
    } else if (m.type === "checkpoint" && m.label) {
      next.checkpoints = [
        { id: `ck-${Date.now()}`, label: m.label, at: Date.now(), snapshot: "{}" },
        ...(next.checkpoints ?? []),
      ];
    } else if (m.type === "canvas" && m.card) {
      next.canvas = [m.card, ...(next.canvas ?? [])].slice(0, 12);
    }
  }
  return next;
}

async function cmdGateway(sub, flags) {
  const action = sub || "run";
  const cfg = saveConfig({
    port: flags.port || loadConfig().port,
    host: flags.host || loadConfig().host,
    root: kitRoot(),
  });

  if (action === "run") {
    process.stdout.write(`Paddy gateway · ${baseUrl(cfg, flags).origin}\n`);
    process.stdout.write(`Dashboard: paddy dashboard   Chat: paddy chat\n\n`);
    spawnGateway(cfg, flags, { detached: false });
    return;
  }

  if (action === "start") {
    const existing = readPid();
    if (existing && alive(existing.pid)) {
      const { origin } = baseUrl({ ...cfg, port: existing.port }, flags);
      out(
        flags,
        { ok: true, running: true, pid: existing.pid, origin },
        `Already running (pid ${existing.pid}) at ${origin}`,
      );
      return;
    }
    spawnGateway(cfg, flags, { detached: true });
    const rec = readPid();
    const up = await waitForUp(cfg, flags);
    const { origin } = baseUrl(cfg, flags);
    if (!up) {
      fail(flags, `Started pid ${rec?.pid ?? "?"} but ${origin} did not come up. See ${logPath()}`);
      return;
    }
    out(
      flags,
      { ok: true, running: true, pid: rec?.pid, origin },
      `Gateway started (pid ${rec?.pid}) at ${origin}`,
    );
    return;
  }

  if (action === "stop") {
    const rec = readPid();
    if (!rec || !alive(rec.pid)) {
      rmSync(pidPath(), { force: true });
      out(flags, { ok: true, running: false }, "Gateway is not running.");
      return;
    }
    try {
      process.kill(-rec.pid, "SIGTERM");
    } catch {
      try {
        process.kill(rec.pid, "SIGTERM");
      } catch (err) {
        fail(flags, err instanceof Error ? err.message : "kill failed");
        return;
      }
    }
    const start = Date.now();
    while (Date.now() - start < 8000 && alive(rec.pid)) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (alive(rec.pid)) {
      try {
        process.kill(-rec.pid, "SIGKILL");
      } catch {
        try {
          process.kill(rec.pid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
    rmSync(pidPath(), { force: true });
    out(flags, { ok: true, running: false, pid: rec.pid }, `Stopped pid ${rec.pid}.`);
    return;
  }

  if (action === "restart") {
    await cmdGateway("stop", flags);
    await cmdGateway("start", flags);
    return;
  }

  if (action === "status") {
    return cmdStatus(flags);
  }

  if (action === "setup") {
    return cmdGatewaySetup(flags);
  }

  fail(flags, `Unknown gateway command “${action}”. Try run | start | stop | restart | status | setup.`, 2);
}

async function cmdStatus(flags) {
  const cfg = loadConfig();
  const rec = readPid();
  const { origin, port } = baseUrl(cfg, flags);
  const pidAlive = Boolean(rec && alive(rec.pid));
  const http = await pingHttp(origin);
  let api = null;
  try {
    const r = await fetchCli(cfg, flags, { method: "GET" });
    api = r.data;
  } catch {
    api = null;
  }
  const running = pidAlive || http;
  const text = running
    ? `Gateway up${rec ? ` (pid ${rec.pid})` : ""} at ${origin}`
    : `Gateway down. Start with: paddy gateway`;
  out(
    flags,
    {
      ok: running,
      running,
      pid: rec?.pid ?? null,
      pidAlive,
      http,
      origin,
      port,
      api: api && api.ok ? { preferred: api.preferred, locked: api.locked } : null,
    },
    text,
  );
  if (!running) process.exitCode = 1;
}

async function cmdDoctor(flags) {
  const cfg = loadConfig();
  const root = kitRoot();
  const { origin } = baseUrl(cfg, flags);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add("node", Number(process.versions.node.split(".")[0]) >= 22, `node ${process.version}`);
  add("kit", existsSync(join(root, "package.json")) && existsSync(join(root, "scripts/with-app-env.mjs")), root);
  add("home", true, paddyHome());
  add("token", Boolean(cfg.token && cfg.token.length >= 16), cfg.token ? "present" : "missing — run paddy config");
  const envFile = existsSync(join(root, "selfhost.env")) || existsSync(homePath("selfhost.env"));
  add("selfhost.env", envFile, envFile ? "found" : "copy from selfhost.env.example (paddy config)");
  const rec = readPid();
  const http = await pingHttp(origin);
  add("gateway", http, http ? origin : "not running — paddy gateway");
  if (http) {
    try {
      const r = await fetchCli(cfg, flags, { method: "GET" });
      add("cli api", Boolean(r.data?.ok), r.data?.locked ? "up, chat locked (no token on server)" : "up");
      const env = r.data?.env ?? {};
      const brains = Object.entries(env)
        .filter(([, v]) => v)
        .map(([k]) => k);
      add("brains", brains.length > 0, brains.length ? brains.join(", ") : "no env keys — set selfhost.env");
    } catch (err) {
      add("cli api", false, err instanceof Error ? err.message : "fetch failed");
    }
  }

  try {
    const update = await checkForUpdate(updateRoot());
    if (!update.git) {
      add("update", false, "zip kit — re-download to update");
    } else if (!update.ok) {
      add("update", false, update.error);
    } else if (update.upToDate) {
      add("update", true, `up to date (${update.shortCurrent})`);
    } else {
      add("update", false, "update available (run paddy update)");
    }
  } catch (err) {
    add("update", false, err instanceof Error ? err.message : "update check failed");
  }

  const ok = checks.every(
    (c) =>
      c.ok ||
      c.name === "selfhost.env" ||
      c.name === "brains" ||
      c.name === "gateway" ||
      c.name === "update",
  );
  const lines = checks.map((c) => `  ${c.ok ? "ok  " : "warn"}  ${c.name.padEnd(14)} ${c.detail}`);
  out(flags, { ok, origin, checks }, `Paddy doctor\n${lines.join("\n")}`);
}

async function cmdUpdate(flags) {
  const root = updateRoot();
  const check = await checkForUpdate(root);
  if (!check.ok) {
    fail(flags, check.error);
    return;
  }

  if (flags.check) {
    out(
      flags,
      {
        ok: true,
        check: true,
        upToDate: check.upToDate,
        git: true,
        ref: check.ref,
        current: check.current,
        latest: check.latest,
      },
      check.upToDate
        ? `Already up to date (${check.shortCurrent}).`
        : `Update available: ${check.shortCurrent} → ${check.shortLatest} (run paddy update)`,
    );
    return;
  }

  if (check.upToDate) {
    out(
      flags,
      {
        ok: true,
        upToDate: true,
        git: true,
        ref: check.ref,
        current: check.current,
        latest: check.latest,
      },
      `Already up to date (${check.shortCurrent}).`,
    );
    return;
  }

  const rec = readPid();
  const running = Boolean(rec && alive(rec.pid));
  if (running) {
    process.stderr.write("paddy: gateway is running and will restart after the update.\n");
  }
  if (running && !flags.yes && stdinStream.isTTY && stdoutStream.isTTY) {
    const rl = createInterface({ input: stdinStream, output: stdoutStream });
    let answer = "";
    try {
      answer = (await rl.question("Continue? [y/N] ")).trim();
    } finally {
      rl.close();
    }
    if (!/^y(es)?$/i.test(answer)) {
      out(flags, { ok: false, cancelled: true }, "Update cancelled.");
      return;
    }
  }

  const checkout = await spawnCaptured("git", ["checkout", "-q", "FETCH_HEAD"], {
    cwd: root,
    timeoutMs: 20_000,
  });
  if (checkout.code !== 0) {
    fail(
      flags,
      `git checkout failed: ${(checkout.stderr || checkout.stdout).trim() || `exit ${checkout.code}`}`,
    );
    return;
  }

  const npm = await spawnCaptured("npm", ["install", "--no-fund", "--no-audit"], {
    cwd: root,
    timeoutMs: 180_000,
  });
  if (npm.code !== 0) {
    fail(
      flags,
      `npm install failed: ${(npm.stderr || npm.stdout).trim().slice(0, 800) || `exit ${npm.code}`}`,
    );
    return;
  }

  try {
    saveConfig({ ref: check.ref, root });
  } catch {
    /* pin is best-effort */
  }

  let restarted = false;
  if (running) {
    // Memory lives in PGLite/Postgres on disk (not in-process), so a gateway
    // stop/start during update does not wipe workspace state.
    await cmdGateway("stop", flags);
    await cmdGateway("start", flags);
    restarted = true;
  }

  out(
    flags,
    {
      ok: true,
      upToDate: false,
      git: true,
      ref: check.ref,
      previous: check.current,
      current: check.latest,
      restarted,
    },
    `Updated ${check.shortCurrent} → ${check.shortLatest}.${restarted ? " Gateway restarted." : ""}\nIf anything looks off: paddy doctor`,
  );
}

async function cmdModels(rest, flags) {
  const cfg = saveConfig({});
  if (rest[0] === "prefer") {
    const id = rest[1] || flags.prefer;
    if (!id) {
      fail(flags, "Usage: paddy models prefer <id>", 2);
      return;
    }
    const canonical = preferAlias(id);
    const model = preferModel(id);
    const next = saveConfig({ preferredProvider: canonical, preferredModel: model || undefined });
    const ws = loadWorkspace();
    ws.preferredProvider = canonical;
    if (model) ws.preferredModel = model;
    saveWorkspace(ws);
    out(flags, { ok: true, preferredProvider: next.preferredProvider, model }, `Preferred brain: ${canonical}${model ? ` (${model})` : ""}`);
    return;
  }

  let remote = null;
  try {
    const r = await fetchCli(cfg, flags, { method: "GET" });
    remote = r.data;
  } catch {
    remote = null;
  }
  if (!remote?.providers) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }
  const lines = remote.providers.map((p) => {
    const mark = p.id === remote.preferred ? "*" : " ";
    const conn = p.connected ? "env" : "—";
    return `  ${mark} ${p.id.padEnd(14)} ${p.name.padEnd(16)} ${p.model}  [${conn}]`;
  });
  out(
    flags,
    { ok: true, preferred: remote.preferred, providers: remote.providers },
    `Preferred: ${remote.preferred || "supergrok"}\n${lines.join("\n")}\n\nSet with: paddy models prefer <id>`,
  );
}

async function cmdChat(rest, flags) {
  const cfg = loadConfig();
  if (!cfg.token) saveConfig({});
  const { origin } = baseUrl(cfg, flags);
  const up = await pingHttp(origin);
  if (!up) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }

  const rawPrefer = flags.prefer || cfg.preferredProvider;
  const preferred = preferAlias(rawPrefer);
  const model = flags.prefer ? preferModel(flags.prefer) : cfg.preferredModel || preferModel(rawPrefer);
  const oneShot = rest.join(" ").trim();

  async function turn(message) {
    const ws = loadWorkspace();
    const r = await fetchCli(cfg, flags, {
      method: "POST",
      body: {
        action: "chat",
        message,
        history: (ws.history ?? []).slice(-10),
        files: ws.files && Object.keys(ws.files).length ? ws.files : undefined,
        memories: ws.memories,
        skills: ws.skills,
        tickets: ws.tickets,
        dailyNotes: ws.dailyNotes,
        wakes: ws.wakes,
        canvas: ws.canvas,
        checkpoints: ws.checkpoints,
        preferredProvider: preferred,
        model,
        profileName: "Paddy Irishman",
      },
    });
    if (!r.data?.ok) {
      throw new Error(r.data?.error || `HTTP ${r.status}`);
    }
    ws.history = [...(ws.history ?? []), { role: "user", content: message }, { role: "assistant", content: r.data.text }];
    if (r.data.workspace) {
      ws.files = r.data.workspace.files ?? ws.files;
      ws.memories = r.data.workspace.memories ?? ws.memories;
      ws.skills = r.data.workspace.skills ?? ws.skills;
      ws.tickets = r.data.workspace.tickets ?? ws.tickets;
      ws.dailyNotes = r.data.workspace.dailyNotes ?? ws.dailyNotes;
      ws.wakes = r.data.workspace.wakes ?? ws.wakes;
      ws.canvas = r.data.workspace.canvas ?? ws.canvas;
      ws.checkpoints = r.data.workspace.checkpoints ?? ws.checkpoints;
      ws.pendingApprovals = Array.isArray(r.data.pendingApprovals)
        ? r.data.pendingApprovals
        : r.data.pendingApproval
          ? [r.data.pendingApproval]
          : [];
      saveWorkspace(ws);
    } else {
      saveWorkspace(applyMutations(ws, r.data.mutations));
    }
    if (r.data.pendingApproval) {
      const held = r.data.pendingApprovals?.length
        ? r.data.pendingApprovals
        : [r.data.pendingApproval];
      const lines = held.map((p) => `  held: ${p.tool} — ${p.reason}`).join("\n");
      process.stderr.write(`paddy: approval required (open the dashboard to allow/deny)\n${lines}\n`);
    }
    return r.data;
  }

  if (oneShot) {
    try {
      const data = await turn(oneShot);
      out(flags, data, data.text);
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : "chat failed");
    }
    return;
  }

  if (flags.json) {
    fail(flags, "Interactive chat cannot --json. Pass a message: paddy chat \"hello\"", 2);
    return;
  }

  process.stdout.write(`Paddy CLI · ${origin} · ${preferred}\n`);
  process.stdout.write(`Empty line or /exit to quit. /status for gateway.\n\n`);
  const rl = createInterface({ input: stdinStream, output: stdoutStream });
  try {
    while (true) {
      const line = (await rl.question("you › ")).trim();
      if (!line || line === "/exit" || line === "/quit") break;
      if (line === "/status") {
        await cmdStatus(flags);
        continue;
      }
      if (line === "/models") {
        await cmdModels([], flags);
        continue;
      }
      try {
        const data = await turn(line);
        process.stdout.write(`\npaddy · ${data.text}\n\n`);
      } catch (err) {
        process.stderr.write(`paddy: ${err instanceof Error ? err.message : "chat failed"}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

async function cmdDashboard(flags) {
  const cfg = loadConfig();
  const { origin } = baseUrl(cfg, flags);
  const up = await pingHttp(origin);
  if (!up) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", origin], { detached: true, stdio: "ignore" }).unref();
    } else {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(opener, [origin], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* headless is fine */
  }
  out(flags, { ok: true, origin }, origin);
}

async function cmdOnboard(flags) {
  const root = kitRoot();
  const cfg = saveConfig({ root, port: flags.port || DEFAULT_PORT, host: flags.host || DEFAULT_HOST });
  const example = join(root, "selfhost.env.example");
  const kitEnv = join(root, "selfhost.env");
  const homeEnv = homePath("selfhost.env");
  let copied = "";
  if (existsSync(example) && !existsSync(kitEnv) && !existsSync(homeEnv)) {
    writeFileSync(homeEnv, readFileSync(example), { mode: 0o600 });
    try { chmodSync(homeEnv, 0o600); } catch { /* ignore */ }
    copied = homeEnv;
  }
  let preferred = cfg.preferredProvider;
  if (!flags.yes && stdinStream.isTTY && stdoutStream.isTTY) {
    const rl = createInterface({ input: stdinStream, output: stdoutStream });
    try {
      const answer = (
        await rl.question(`Preferred brain [${preferred}]: `)
      ).trim();
      if (answer) preferred = answer;
    } finally {
      rl.close();
    }
    saveConfig({ preferredProvider: preferred });
  }
  const fingerprint = createHash("sha256").update(cfg.token).digest("hex").slice(0, 8);
  const text = [
    "Paddy is ready on this machine.",
    `  home     ${paddyHome()}`,
    `  token    ${fingerprint}…`,
    copied ? `  env      wrote ${copied}` : `  env      ${existsSync(kitEnv) ? kitEnv : existsSync(homeEnv) ? homeEnv : "set selfhost.env (see selfhost.env.example)"}`,
    `  prefer   ${preferred}`,
    "",
    "Next:",
    "  1. Put keys / setup-tokens in selfhost.env  (or sign in via the dashboard)",
    "  2. paddy gateway",
    "  3. In another terminal: paddy chat   or   paddy dashboard",
  ].join("\n");
  out(
    flags,
    { ok: true, home: paddyHome(), root, copied: Boolean(copied), envFile: copied || kitEnv, preferredProvider: preferred },
    text,
  );
}

function cmdAgent(rest, flags) {
  const sub = rest[0] || "list";
  if (sub !== "list") {
    fail(flags, "Usage: paddy agent list", 2);
    return;
  }
  out(flags, { ok: true, agents: [{ id: "paddy", name: "Paddy Irishman" }] }, "  paddy    Paddy Irishman    (seed mind — extra agents live in the dashboard on this machine)");
}

async function cmdSkills(rest, flags) {
  const sub = (rest[0] || "list").toLowerCase();
  const ws = await liveWorkspace(flags);
  const skills = [...(ws.skills ?? [])];

  if (sub === "list") {
    if (!skills.length) {
      out(flags, { ok: true, skills: [] }, "No skills on this mind yet. Install from the hub, import a SKILL.md, or chat — then they persist.");
      return;
    }
    const lines = skills.map((s) => `  ${(s.status || "active").padEnd(8)} ${s.name} — ${s.description || ""}`);
    out(flags, { ok: true, skills }, lines.join("\n"));
    return;
  }

  if (sub === "install") {
    const q = rest.slice(1).join(" ").trim().toLowerCase();
    if (!q) {
      fail(flags, "Usage: paddy skills install <slug-or-name>", 2);
      return;
    }
    const found = HUB_SKILLS.find(
      (s) => s.slug.toLowerCase() === q || s.name.toLowerCase() === q || s.slug.toLowerCase().endsWith(`/${q}`),
    );
    if (!found) {
      const names = HUB_SKILLS.map((s) => s.name).join(", ");
      fail(flags, `Unknown hub skill “${q}”. Bundled: ${names}`);
      return;
    }
    if (skills.some((s) => s.name === found.name)) {
      fail(flags, `${found.name} is already installed.`);
      return;
    }
    const next = {
      name: found.name,
      description: found.description,
      instructions: found.instructions,
      triggers: found.triggers ?? [],
      status: "active",
      uses: 0,
      origin: "hub",
      slug: found.slug,
      registry: found.registry,
      version: found.version,
    };
    ws.skills = [next, ...skills];
    await pushWorkspace(flags, ws);
    out(
      flags,
      { ok: true, skill: next },
      `Live · ${found.name}\n  say “${found.triggers?.[0] ?? found.name}” — or paddy chat "Use the ${found.name} skill."`,
    );
    return;
  }

  if (sub === "import") {
    const file = rest[1];
    let text = "";
    try {
      if (!file || file === "-") {
        text = readFileSync(0, "utf8");
      } else {
        text = readFileSync(resolve(file), "utf8");
      }
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : "Could not read SKILL.md");
      return;
    }
    const parsed = parseSkillMd(text);
    if (!parsed.ok) {
      fail(flags, parsed.error);
      return;
    }
    const idx = skills.findIndex((s) => s.name === parsed.name);
    if (idx >= 0) {
      const prev = skills[idx];
      skills[idx] = {
        ...prev,
        description: parsed.description,
        instructions: parsed.instructions,
        triggers: parsed.triggers.length ? parsed.triggers : prev.triggers,
        status: prev.status === "archived" ? "active" : prev.status || "active",
        version: parsed.version || prev.version,
      };
      ws.skills = skills;
      await pushWorkspace(flags, ws);
      out(flags, { ok: true, updated: true, name: parsed.name }, `Updated ${parsed.name}`);
      return;
    }
    const created = {
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
      triggers: parsed.triggers,
      status: "active",
      uses: 0,
      origin: "learned",
      version: parsed.version || undefined,
    };
    ws.skills = [created, ...skills];
    await pushWorkspace(flags, ws);
    out(
      flags,
      { ok: true, updated: false, skill: created },
      `Live · ${parsed.name}${parsed.triggers[0] ? `\n  say “${parsed.triggers[0]}”` : ""}`,
    );
    return;
  }

  if (sub === "export") {
    const name = (rest[1] || "").toLowerCase();
    if (!name) {
      fail(flags, "Usage: paddy skills export <name>", 2);
      return;
    }
    const hit = skills.find((s) => String(s.name || "").toLowerCase() === name);
    if (!hit) {
      fail(flags, `No skill named ${name}.`);
      return;
    }
    const md = toSkillMd(hit);
    if (flags.json) out(flags, { ok: true, name: hit.name, markdown: md }, md);
    else process.stdout.write(md.endsWith("\n") ? md : `${md}\n`);
    return;
  }

  fail(flags, "Usage: paddy skills [list|install <id>|import [file]|export <name>]", 2);
}

async function cmdMemory(rest, flags) {
  const {
    applyMemoryWrite,
    memoryList,
    memoryReset,
    memoryStatus,
    resolveMemoryLimits,
    usageMeters,
  } = await import("../src/lib/harness/memory-hermes.mjs");

  const sub = (rest[0] || "list").toLowerCase();
  const ws = await liveWorkspace(flags);
  const limits = resolveMemoryLimits();

  if (sub === "status") {
    const status = memoryStatus(ws);
    const lines = [
      `MEMORY ${status.memoryChars}/${status.memoryLimit} chars`,
      `USER ${status.userChars}/${status.userLimit} chars`,
      `entries ${status.entryCount} · fts ${status.ftsEnabled ? "on" : "off"} · embed ${status.embeddingMode}`,
    ];
    out(flags, { ok: true, ...status }, lines.join("\n"));
    return;
  }

  if (sub === "list" || sub === "dump" || sub === "show") {
    const target = (flags.target || rest[1] || "").toLowerCase();
    if (target === "memory" || target === "user") {
      const listed = memoryList(ws, target);
      const lines = (listed.entries || []).map((e) =>
        typeof e === "string" ? `  ${e}` : `  (${e.kind || "fact"}) ${e.text}`,
      );
      out(
        flags,
        { ok: true, ...listed },
        lines.length ? lines.join("\n") : `No ${target} entries.`,
      );
      return;
    }
    const memories = ws.memories ?? [];
    const file = typeof ws.files?.memory === "string" ? ws.files.memory.trim() : "";
    if (!memories.length && !file) {
      out(flags, { ok: true, memories: [] }, "No MEMORY.md facts yet.");
      return;
    }
    const lines = memories.length
      ? memories.map((m) => `  (${m.kind || "fact"}) ${m.text}`)
      : [file];
    out(flags, { ok: true, memories, file: file || null }, lines.join("\n"));
    return;
  }

  if (sub === "search" || sub === "recall") {
    const query = rest.slice(1).join(" ").trim();
    if (!query) {
      fail(flags, `Usage: paddy memory ${sub} <query>`, 2);
      return;
    }
    const q = query.toLowerCase();
    const tokens = q.split(/[^a-z0-9-]+/).filter((w) => w.length > 2);
    const scored = (ws.memories ?? []).map((m) => {
      const body = String(m.text || "").toLowerCase();
      let score = 0;
      if (body.includes(q)) score += 2;
      for (const tok of tokens) if (body.includes(tok)) score += 1;
      return {
        entry: m,
        score,
        similarity: score > 0 ? Math.min(1, score / 4) : 0,
        recency: 0.5,
        importance: typeof m.importance === "number" ? m.importance : 0.5,
      };
    });
    const apiHits = scored
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limits.recallLimit);
    const lines = apiHits.map(
      (h) => `  [${h.score.toFixed(2)}] (${h.entry.kind || "fact"}) ${h.entry.text}`,
    );
    out(
      flags,
      { ok: true, hits: apiHits, memoryUsage: usageMeters(ws, limits) },
      lines.length ? lines.join("\n") : "No hits.",
    );
    return;
  }

  if (sub === "add") {
    const target = (flags.target || "memory").toLowerCase() === "user" ? "user" : "memory";
    const body = rest.slice(1).join(" ").trim();
    if (!body) {
      fail(flags, "Usage: paddy memory add <text> [--target memory|user]", 2);
      return;
    }
    const result = applyMemoryWrite(ws, {
      target,
      action: "add",
      text: body,
      kind: flags.kind || "fact",
      limits,
    });
    if (!result.ok) {
      fail(flags, result.error || "memory write failed");
      return;
    }
    await pushWorkspace(flags, result.workspace);
    out(
      flags,
      { ok: true, message: result.message, usage: result.usage },
      `${result.message} (${result.usage?.memory || ""} · ${result.usage?.user || ""})`,
    );
    return;
  }

  if (sub === "reset") {
    const targetRaw = (flags.target || rest[1] || "all").toLowerCase();
    const target = targetRaw === "memory" || targetRaw === "user" ? targetRaw : "all";
    const confirm = Boolean(flags.confirm) || Boolean(flags.yes);
    const result = memoryReset(ws, target, confirm);
    if (!result.ok) {
      fail(flags, result.error || "reset refused (pass --confirm)");
      return;
    }
    await pushWorkspace(flags, result.workspace);
    out(flags, { ok: true, message: result.message }, result.message);
    return;
  }

  fail(flags, "Usage: paddy memory status|list|search|add|recall|reset", 2);
}

async function cmdApprove(rest, flags) {
  const cfg = loadConfig();
  const { origin } = baseUrl(cfg, flags);
  const up = await pingHttp(origin);
  if (!up) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }
  const action = (rest[0] || "").toLowerCase();
  if (action !== "allow" && action !== "deny") {
    fail(flags, "Usage: paddy approve allow | paddy approve deny", 2);
    return;
  }
  const ws = loadWorkspace();
  const held = Array.isArray(ws.pendingApprovals) ? ws.pendingApprovals : [];
  const pending = held[0];
  if (!pending) {
    fail(flags, "Nothing held. A gated tool (send_channel / spawn_subagent) queues here after chat.");
    return;
  }
  const r = await fetchCli(cfg, flags, {
    method: "POST",
    body: {
      action: "approve",
      allow: action === "allow",
      tool: pending.tool,
      args: pending.args,
      preferredProvider: ws.preferredProvider || cfg.preferredProvider,
      model: cfg.preferredModel,
    },
  });
  if (!r.data?.ok) {
    fail(flags, r.data?.error || `HTTP ${r.status}`);
    return;
  }
  ws.pendingApprovals = held.slice(1);
  if (action === "allow" && r.data.mutation) {
    Object.assign(ws, applyMutations(ws, [r.data.mutation]));
  }
  if (action === "allow" && r.data.text && pending.tool === "spawn_subagent") {
    ws.history = [
      ...(ws.history ?? []),
      { role: "assistant", content: r.data.text },
    ];
  }
  saveWorkspace(ws);
  const next = ws.pendingApprovals[0];
  const extra = next ? `\nNext held: ${next.tool}` : "";
  out(flags, r.data, `${r.data.text || (action === "allow" ? "Allowed." : "Denied.")}${extra}`);
}

const BRIDGE_IDS = ["telegram", "discord", "slack", "whatsapp", "signal", "email"];

function parseSync(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "openclaw" || v === "hermes" || v === "both") return v;
  return "";
}

async function cmdConfigure(flags, sections) {
  if (!stdinStream.isTTY || !stdoutStream.isTTY) {
    fail(
      flags,
      "paddy configure needs an interactive TTY. Use paddy config get|set|unset|show|schema|validate, or paddy config init --yes.",
      2,
    );
    return;
  }
  // Ensure ~/.paddy exists via the same first-run path install uses (non-interactive).
  await cmdOnboard({ ...flags, yes: true });
  const parsed = parseConfigureSections(sections ?? flags.section ?? []);
  if (parsed.invalid.length) {
    fail(flags, `Unknown configure section(s): ${parsed.invalid.join(", ")}`, 2);
    return;
  }
  await runConfigureWizard({
    sections: parsed.sections,
    log: (line) => process.stdout.write(`${line}\n`),
  });
}

async function cmdConfig(rest, flags) {
  const sub = (rest[0] || "").toLowerCase();
  if (!sub) {
    // Install / CI: --yes or non-TTY keeps first-run init. Interactive TTY → wizard.
    if (flags.yes || !stdinStream.isTTY || !stdoutStream.isTTY) {
      await cmdOnboard(flags);
      return;
    }
    await cmdConfigure(flags, flags.section);
    return;
  }
  if (sub === "init") {
    await cmdOnboard(flags);
    return;
  }
  if (sub === "configure") {
    await cmdConfigure(flags, flags.section);
    return;
  }
  if (sub === "show") {
    const { config } = loadCanonical({ persist: true });
    const view = redactConfig(config);
    const text = JSON.stringify(view, null, 2);
    out(flags, { ok: true, config: view }, text);
    return;
  }
  if (sub === "get") {
    const path = rest[1];
    if (!path) {
      fail(flags, "Usage: paddy config get <path>", 2);
      return;
    }
    try {
      const result = configGet(path);
      const rendered =
        typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
      out(flags, result, rendered);
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (sub === "set") {
    const path = rest[1];
    const raw = rest.slice(2).join(" ").trim();
    if (!path || !raw) {
      fail(flags, "Usage: paddy config set <path> <json>", 2);
      return;
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      fail(
        flags,
        `Invalid JSON value: ${err instanceof Error ? err.message : String(err)}. Tip: strings need quotes, e.g. '"supergrok"' or '9090'.`,
      );
      return;
    }
    try {
      const result = configSet(path, value);
      out(
        flags,
        result,
        `Set ${result.path}${result.aliasedTo ? ` (→ ${result.aliasedTo})` : ""}.`,
      );
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (sub === "unset") {
    const path = rest[1];
    if (!path) {
      fail(flags, "Usage: paddy config unset <path>", 2);
      return;
    }
    try {
      const result = configUnset(path);
      out(
        flags,
        result,
        `Unset ${result.path}${result.aliasedTo ? ` (→ ${result.aliasedTo})` : ""}.`,
      );
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (sub === "schema") {
    const schema = canonicalConfigSchema();
    out(
      flags,
      { ok: true, schema, schemaVersion: schema.properties?.version?.const },
      JSON.stringify(schema, null, 2),
    );
    return;
  }
  if (sub === "validate") {
    const snap = resolvedSnapshot();
    const valid = validateCanonical(snap.config);
    const missing = (snap.missing || []).map((m) => `${m.path} → ${m.name}`);
    const issues = [
      ...(valid.issues || []).map((i) => ({ ...i, severity: "error" })),
      ...(snap.missing || []).map((m) => ({
        path: m.path,
        message: `missing env ${m.name}`,
        severity: "warning",
      })),
    ];
    if (!valid.ok) {
      const detail = (valid.issues || [])
        .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
        .join("\n");
      fail(flags, detail || valid.errors.join("; "));
      return;
    }
    const extra = missing.length ? `\nMissing env: ${missing.join(", ")}` : "";
    out(
      flags,
      { ok: true, errors: [], missing, issues },
      `config.json ok (version ${snap.config.version})${extra}`,
    );
    return;
  }
  if (sub === "import") {
    const fromFlag = flags.from || rest[1] || (rest.includes("--from") ? "" : "both");
    const source = parseSync(fromFlag) || "both";
    cmdChannels(["import", source], flags);
    return;
  }
  fail(flags, "Usage: paddy config [init|show|get|set|unset|schema|validate|import|configure]", 2);
}

function cmdChannels(rest, flags) {
  const sub = (rest[0] || "list").toLowerCase();

  if (sub === "list") {
    const accounts = loadResolvedAccounts();
    const lines = BRIDGE_IDS.map((id) => {
      const acc = accounts[id];
      const on = Boolean(acc && (acc.token || acc.host || acc.user));
      return `  ${on ? "on " : "off"}  ${id.padEnd(10)} ${on ? acc.dmPolicy || "pairing" : "—"}`;
    });
    out(flags, { ok: true, accounts }, `Channels\n${lines.join("\n")}`);
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const id = (rest[1] || "").toLowerCase();
    if (!BRIDGE_IDS.includes(id)) {
      fail(flags, "Usage: paddy channels remove <telegram|discord|slack|whatsapp|signal|email>", 2);
      return;
    }
    removeCanonicalChannel(id);
    out(flags, { ok: true, id }, `Disconnected ${id}.`);
    return;
  }

  if (sub === "import") {
    const source = parseSync(flags.from || rest[1] || "both") || "both";
    const result = importFromLineage({
      source,
      replace: flags.yes ? BRIDGE_IDS : [],
    });
    if (!result.ok && !result.conflicts?.length) {
      fail(flags, result.error || "Nothing to import.");
      return;
    }
    const bits = [];
    if (result.imported?.length) bits.push(`Imported ${result.imported.join(", ")} into ~/.paddy/config.json.`);
    if (result.conflicts?.length) {
      bits.push(
        `Conflicts: ${result.conflicts.map((c) => c.id).join(", ")}. Re-run with --yes to replace.`,
      );
    }
    if (result.skipped?.length && !result.conflicts?.length) {
      bits.push(`Kept existing: ${result.skipped.join(", ")}.`);
    }
    out(flags, result, bits.join("\n") || "No changes.");
    return;
  }

  if (sub === "export") {
    const target = parseSync(flags.to || flags.sync || rest[1] || "both") || "both";
    const paths = exportToLineage(target);
    out(
      flags,
      { ok: true, paths, target },
      `Wrote ${paths.join(" · ") || "nothing"}. Paddy config.json is unchanged. Restart openclaw / hermes gateway to pick them up.`,
    );
    return;
  }

  if (sub === "add") {
    const id = (rest[1] || "").toLowerCase();
    if (!BRIDGE_IDS.includes(id)) {
      fail(flags, "Usage: paddy channels add <telegram|discord|slack|whatsapp|signal|email> --token …", 2);
      return;
    }
    const acc = {
      dmPolicy: ["pairing", "allowlist", "open"].includes(flags.dmPolicy) ? flags.dmPolicy : "pairing",
      allowFrom: String(flags.allowFrom || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      requireMention: true,
    };
    if (flags.token) acc.token = flags.token;
    if (flags.appToken) acc.appToken = flags.appToken;
    if (flags.phoneId) acc.phoneId = flags.phoneId;
    if (flags.verifyToken) acc.verifyToken = flags.verifyToken;
    if (flags.number) acc.number = flags.number;
    if (flags.url) acc.host = flags.url;
    if (flags.from) acc.from = flags.from;
    if (flags.user) acc.user = flags.user;
    if (flags.pass) acc.pass = flags.pass;
    if (id === "telegram" || id === "discord") {
      if (!acc.token) {
        fail(flags, `Need --token (BotFather / Discord bot token).`);
        return;
      }
    }
    if (id === "slack" && (!acc.token || !acc.appToken)) {
      fail(flags, "Need --token xoxb-… and --app-token xapp-…");
      return;
    }
    upsertCanonicalChannel(id, acc);
    const sync = parseSync(flags.sync);
    const paths = sync ? exportToLineage(sync) : [];
    out(
      flags,
      { ok: true, id, sync: sync || null, paths },
      `Connected ${id} in config.json.${paths.length ? ` Exported ${paths.join(" · ")}.` : ""} Message the bot — pairing codes show in Gateway.`,
    );
    return;
  }

  fail(flags, "Usage: paddy channels [list|add|remove|import|export]", 2);
}

async function cmdPairing(rest, flags) {
  const action = (rest[0] || "").toLowerCase();
  const code = (rest[1] || "").trim();
  if ((action !== "approve" && action !== "deny") || !code) {
    fail(flags, "Usage: paddy pairing approve CODE | paddy pairing deny CODE", 2);
    return;
  }
  const cfg = loadConfig();
  const up = await pingHttp(baseUrl(cfg, flags).origin);
  if (up) {
    const r = await fetchCli(cfg, flags, {
      method: "POST",
      body: { action: "pairing", code, allow: action === "approve" },
    });
    if (!r.data?.ok) {
      fail(flags, r.data?.error || `HTTP ${r.status}`);
      return;
    }
    out(flags, r.data, r.data.text || (action === "approve" ? "Allowed." : "Denied."));
    return;
  }
  const file = { pending: loadPendingPairs(), accounts: loadResolvedAccounts() };
  const needle = code.toUpperCase();
  const pair = (file.pending || []).find((p) => String(p.code).toUpperCase() === needle);
  if (!pair) {
    fail(flags, "Unknown pairing code. Start paddy gateway, then try again.");
    return;
  }
  const pending = file.pending.filter((p) => p.id !== pair.id);
  savePendingPairs(pending);
  if (action === "approve") {
    const acc = file.accounts[pair.channelId] || { dmPolicy: "pairing", allowFrom: [], requireMention: true };
    if (!acc.allowFrom.includes(pair.fromId)) acc.allowFrom.push(pair.fromId);
    upsertCanonicalChannel(pair.channelId, acc);
  }
  out(flags, { ok: true, pair }, `${action === "approve" ? "Allowed" : "Denied"} ${pair.from} on ${pair.channelId}.`);
}

async function cmdGatewaySetup(flags) {
  const id = (flags.to || "telegram").toLowerCase();
  if (!BRIDGE_IDS.includes(id) && flags.yes) {
    fail(flags, "Pass a channel as the first prompt, or: paddy channels add telegram --token …");
    return;
  }
  let channel = BRIDGE_IDS.includes(id) ? id : "telegram";
  let token = flags.token || "";
  if (!flags.yes && stdinStream.isTTY && stdoutStream.isTTY) {
    const rl = createInterface({ input: stdinStream, output: stdoutStream });
    try {
      const pick = (await rl.question(`Channel [${channel}]: `)).trim().toLowerCase();
      if (BRIDGE_IDS.includes(pick)) channel = pick;
      token = (await rl.question("Bot token (empty to skip): ")).trim() || token;
      const allow = (await rl.question("Allow from (user ids, empty = pairing): ")).trim();
      if (allow) flags.allowFrom = allow;
      const syncIn = (await rl.question("Export compatibility files? [n/openclaw/hermes/both]: ")).trim().toLowerCase();
      if (syncIn && syncIn !== "n" && syncIn !== "no") flags.sync = parseSync(syncIn) || "both";
    } finally {
      rl.close();
    }
  }
  if (!token && channel !== "email" && channel !== "signal") {
    fail(flags, "No token. Same as hermes gateway setup — paste the BotFather / Discord token.");
    return;
  }
  flags.token = token;
  cmdChannels(["add", channel], flags);
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    process.stderr.write(`paddy: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
    return;
  }
  const { flags, rest } = parsed;
  if (flags.version && rest.length === 0) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const command = rest[0];
  if (flags.help || !command) {
    process.stdout.write(helpText());
    return;
  }

  try {
    switch (command) {
      case "gateway":
        await cmdGateway(rest[1], flags);
        break;
      case "status":
        await cmdStatus(flags);
        break;
      case "doctor":
        await cmdDoctor(flags);
        break;
      case "update":
        await cmdUpdate(flags);
        break;
      case "models":
      case "model":
        await cmdModels(rest.slice(1), flags);
        break;
      case "chat":
        await cmdChat(rest.slice(1), flags);
        break;
      case "dashboard":
        await cmdDashboard(flags);
        break;
      case "onboard":
        await cmdConfig(["init"], flags);
        break;
      case "configure":
        await cmdConfigure(flags, flags.section);
        break;
      case "agent":
      case "agents":
        cmdAgent(rest.slice(1), flags);
        break;
      case "skills":
      case "skill":
        await cmdSkills(rest.slice(1), flags);
        break;
      case "memory":
      case "memories":
        await cmdMemory(rest.slice(1), flags);
        break;
      case "approve":
        await cmdApprove(rest.slice(1), flags);
        break;
      case "channels":
      case "channel":
        cmdChannels(rest.slice(1), flags);
        break;
      case "config":
        await cmdConfig(rest.slice(1), flags);
        break;
      case "pairing":
      case "pair":
        await cmdPairing(rest.slice(1), flags);
        break;
      case "help":
        process.stdout.write(helpText());
        break;
      case "version":
        process.stdout.write(`${VERSION}\n`);
        break;
      default:
        fail(flags, `Unknown command “${command}”. Try paddy --help`, 2);
    }
  } catch (err) {
    fail(flags, err instanceof Error ? err.message : String(err));
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(entry) === fileURLToPath(import.meta.url);
  }
})();

if (isMain) {
  await main();
}
