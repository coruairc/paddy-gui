import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { helpText, parseArgv, loadDotEnv, kitRoot, VERSION, checkForUpdate } from "./paddy.mjs";
import { loadResolvedAccounts } from "../src/lib/harness/config.mjs";

const bin = join(kitRoot(), "bin/paddy.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("help lists gateway, chat, models, doctor", () => {
  const text = helpText();
  for (const needle of [
    "paddy gateway",
    "paddy gateway start",
    "paddy chat",
    "paddy models",
    "paddy doctor",
    "paddy update",
    "paddy update --check",
    "paddy configure",
    "paddy config",
    "paddy config init",
    "paddy config show",
    "paddy config get",
    "paddy config set",
    "paddy config unset",
    "paddy config schema",
    "paddy config validate",
    "paddy config import",
    "paddy onboard",
    "paddy dashboard",
    "paddy skills",
    "paddy skills install",
    "paddy skills import",
    "paddy skills export",
    "paddy memory",
    "paddy memory status",
    "paddy approve",
    "paddy channels",
    "paddy pairing approve",
    "paddy gateway setup",
  ]) {
    assert.match(text, new RegExp(needle.replace(/ /g, "\\s+")));
  }
  assert.doesNotMatch(text, /npx/);
});

test("parseArgv extracts flags and rest", () => {
  const { flags, rest } = parseArgv([
    "--port",
    "9090",
    "--host",
    "0.0.0.0",
    "gateway",
    "status",
    "--json",
  ]);
  assert.equal(flags.port, 9090);
  assert.equal(flags.host, "0.0.0.0");
  assert.equal(flags.json, true);
  assert.deepEqual(rest, ["gateway", "status"]);
});

test("parseArgv rejects unknown flags", () => {
  assert.throws(() => parseArgv(["--nope"]), /Unknown flag/);
});

test("loadDotEnv skips comments and quotes", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-env-"));
  const file = join(dir, ".env");
  writeFileSync(
    file,
    `# hi\nXAI_API_KEY="sk-test"\nEMPTY=\n# comment\nPOOLSIDE_API_KEY=abc\n`,
  );
  const env = loadDotEnv(file);
  assert.equal(env.XAI_API_KEY, "sk-test");
  assert.equal(env.POOLSIDE_API_KEY, "abc");
  assert.equal(env.EMPTY, "");
});

test("paddy --help exits 0 and mentions gateway", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /paddy gateway/);
  assert.match(r.stdout, /paddy update/);
});

test("paddy --version prints semver", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);
});

test("unknown command exits 2", () => {
  const r = run(["blorp"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown command/);
});

test("paddy config --yes writes ~/.paddy (onboard is an alias)", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  const r = run(["config", "--yes", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(existsSync(join(home, "config.json")), true);
  const cfg = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(cfg.version, 1);
  assert.equal(cfg.gateway.port, 8080);
  assert.equal(cfg.cli.token, "${PADDY_CLI_TOKEN}");
  const envText = readFileSync(join(home, ".env"), "utf8");
  assert.match(envText, /PADDY_CLI_TOKEN=/);
  const alias = run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  assert.equal(alias.status, 0, alias.stderr + alias.stdout);
});

test("doctor --json reports kit and home", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const r = run(["doctor", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  const names = payload.checks.map((c) => c.name);
  assert.ok(names.includes("node"));
  assert.ok(names.includes("kit"));
  assert.ok(names.includes("home"));
  assert.ok(names.includes("update"));
});

test("agent list includes paddy", () => {
  const r = run(["agent", "list", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.agents[0].id, "paddy");
});

test("paddy skills install copies a hub playbook into workspace.json", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const r = run(["skills", "install", "meeting-actions", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.skill.name, "meeting-actions");
  const ws = JSON.parse(readFileSync(join(home, "workspace.json"), "utf8"));
  assert.equal(ws.skills[0].name, "meeting-actions");
  assert.equal(ws.skills[0].status, "active");
});

test("paddy skills import then export round-trips SKILL.md", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const file = join(home, "SKILL.md");
  writeFileSync(
    file,
    `---
name: morning-brief
description: overnight rollup
triggers: [morning brief]
---

canvas_render kind=markdown title="Morning brief"
`,
  );
  const imported = run(["skills", "import", file, "--json"], { PADDY_HOME: home });
  assert.equal(imported.status, 0, imported.stderr + imported.stdout);
  const payload = JSON.parse(imported.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.skill.name, "morning-brief");
  const exported = run(["skills", "export", "morning-brief"], { PADDY_HOME: home });
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /name: morning-brief/);
  assert.match(exported.stdout, /canvas_render/);
});

test("parseArgv reads channel flags", () => {
  const { flags, rest } = parseArgv([
    "channels",
    "add",
    "telegram",
    "--token",
    "123:abc",
    "--sync",
    "both",
    "--allow-from",
    "42",
  ]);
  assert.equal(flags.token, "123:abc");
  assert.equal(flags.sync, "both");
  assert.equal(flags.allowFrom, "42");
  assert.deepEqual(rest, ["channels", "add", "telegram"]);
});

test("paddy channels add telegram writes canonical config.json and .env", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-ch-"));
  const r = run(
    ["channels", "add", "telegram", "--token", "111:AAA", "--json"],
    { PADDY_HOME: home },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.id, "telegram");
  const saved = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(saved.channels.telegram.token, "${TELEGRAM_BOT_TOKEN}");
  assert.equal(saved.channels.telegram.access.mode, "pairing");
  assert.match(readFileSync(join(home, ".env"), "utf8"), /TELEGRAM_BOT_TOKEN=111:AAA/);
  assert.equal(existsSync(join(home, "channels.json")), false);
  const accounts = loadResolvedAccounts(home);
  assert.equal(accounts.telegram.token, "111:AAA");
});

test("paddy channels import reads OpenClaw telegram botToken into canonical config", () => {
  const root = mkdtempSync(join(tmpdir(), "paddy-imp-"));
  mkdirSync(join(root, ".openclaw"));
  writeFileSync(
    join(root, ".openclaw", "openclaw.json"),
    `{ channels: { telegram: { enabled: true, botToken: "oc:tok", dmPolicy: "pairing" } } }\n`,
  );
  const paddyHome = join(root, ".paddy");
  const r = run(["channels", "import", "--json"], { PADDY_HOME: paddyHome, HOME: root });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  const saved = JSON.parse(readFileSync(join(paddyHome, "config.json"), "utf8"));
  assert.equal(saved.channels.telegram.token, "${TELEGRAM_BOT_TOKEN}");
  assert.match(readFileSync(join(paddyHome, ".env"), "utf8"), /TELEGRAM_BOT_TOKEN=oc:tok/);
  assert.equal(existsSync(join(paddyHome, "channels.json")), false);
  const accounts = loadResolvedAccounts(paddyHome);
  assert.equal(accounts.telegram.token, "oc:tok");
});

test("paddy channels add is what the live bridge consumes (no channels.json)", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-rt-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const r = run(
    ["channels", "add", "telegram", "--token", "live:tok", "--dm-policy", "allowlist", "--allow-from", "42", "--json"],
    { PADDY_HOME: home },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const accounts = loadResolvedAccounts(home);
  assert.equal(accounts.telegram.token, "live:tok");
  assert.equal(accounts.telegram.dmPolicy, "allowlist");
  assert.deepEqual(accounts.telegram.allowFrom, ["42"]);
  assert.equal(existsSync(join(home, "channels.json")), false);
});

test("paddy config show redacts secrets", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-show-"));
  run(["channels", "add", "telegram", "--token", "SECRETTOKEN99", "--json"], { PADDY_HOME: home });
  const r = run(["config", "show", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /SECRETTOKEN99/);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.config.channels.telegram.token, "${TELEGRAM_BOT_TOKEN}");
});

test("paddy config validate accepts a fresh install", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-val-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const r = run(["config", "validate", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
});

test("paddy channels import conflict keeps existing until --yes", () => {
  const root = mkdtempSync(join(tmpdir(), "paddy-cf-"));
  mkdirSync(join(root, ".openclaw"));
  writeFileSync(
    join(root, ".openclaw", "openclaw.json"),
    `{ channels: { telegram: { enabled: true, botToken: "theirs:tok", dmPolicy: "open" } } }\n`,
  );
  const home = join(root, ".paddy");
  run(["channels", "add", "telegram", "--token", "mine:tok", "--json"], { PADDY_HOME: home, HOME: root });
  const first = run(["channels", "import", "--json"], { PADDY_HOME: home, HOME: root });
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const payload = JSON.parse(first.stdout);
  assert.ok(payload.conflicts?.some((c) => c.id === "telegram"));
  const kept = loadResolvedAccounts(home);
  assert.equal(kept.telegram.token, "mine:tok");
  const replaced = run(["channels", "import", "--yes", "--json"], { PADDY_HOME: home, HOME: root });
  assert.equal(replaced.status, 0, replaced.stderr + replaced.stdout);
  const after = loadResolvedAccounts(home);
  assert.equal(after.telegram.token, "theirs:tok");
  assert.equal(after.telegram.dmPolicy, "open");
});

test("paddy channels export does not change canonical config", () => {
  const root = mkdtempSync(join(tmpdir(), "paddy-ex-"));
  const home = join(root, ".paddy");
  run(["channels", "add", "telegram", "--token", "exp:tok", "--json"], { PADDY_HOME: home, HOME: root });
  const before = readFileSync(join(home, "config.json"), "utf8");
  const r = run(["channels", "export", "--to", "both", "--json"], { PADDY_HOME: home, HOME: root });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(home, "config.json"), "utf8"), before);
  assert.match(readFileSync(join(root, ".openclaw", "openclaw.json"), "utf8"), /exp:tok/);
  assert.match(readFileSync(join(root, ".hermes", ".env"), "utf8"), /TELEGRAM_BOT_TOKEN=exp:tok/);
});

function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Paddy Test",
      GIT_AUTHOR_EMAIL: "paddy@test",
      GIT_COMMITTER_NAME: "Paddy Test",
      GIT_COMMITTER_EMAIL: "paddy@test",
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return r;
}

function pointKit(home, kit) {
  const path = join(home, "config.json");
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  cfg.kit = { ...(cfg.kit || {}), root: kit };
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

function seedBareOrigin() {
  const origin = mkdtempSync(join(tmpdir(), "paddy-origin-"));
  git(origin, ["init", "--bare"]);
  git(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  const seed = mkdtempSync(join(tmpdir(), "paddy-seed-"));
  git(seed, ["init"]);
  writeFileSync(join(seed, "README"), "paddy\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "init"]);
  git(seed, ["branch", "-M", "main"]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "-u", "origin", "main"]);
  return origin;
}

test("paddy update --check --json fails clearly on a zip-kit (no .git)", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-upd-zip-"));
  const kit = mkdtempSync(join(tmpdir(), "paddy-zipkit-"));
  writeFileSync(join(kit, "README"), "vendored\n");
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  pointKit(home, kit);
  const r = run(["update", "--check", "--json"], { PADDY_HOME: home });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /isn't a git checkout/);
  assert.doesNotMatch(r.stderr + r.stdout, /Error: /);
});

test("paddy update --check --json reports a git fetch error instead of crashing", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-upd-noremote-"));
  const kit = mkdtempSync(join(tmpdir(), "paddy-noremote-"));
  git(kit, ["init"]);
  writeFileSync(join(kit, "README"), "solo\n");
  git(kit, ["add", "."]);
  git(kit, ["commit", "-m", "init"]);
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  pointKit(home, kit);
  const r = run(["update", "--check", "--json"], { PADDY_HOME: home });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /git fetch failed/i);
  assert.doesNotMatch(r.stderr, /ERR_UNHANDLED|throw /);
});

test("checkForUpdate returns upToDate when HEAD matches FETCH_HEAD", async () => {
  const origin = seedBareOrigin();
  const kit = mkdtempSync(join(tmpdir(), "paddy-current-"));
  const cloned = spawnSync("git", ["clone", "--branch", "main", origin, kit], { encoding: "utf8" });
  assert.equal(cloned.status, 0, cloned.stderr);
  const result = await checkForUpdate(kit);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.upToDate, true);
  assert.equal(result.git, true);
  assert.equal(result.current, result.latest);
  assert.match(result.shortCurrent, /^[0-9a-f]{7}$/);
});

test("paddy update --json on a current checkout does not run npm install", () => {
  const origin = seedBareOrigin();
  const kit = mkdtempSync(join(tmpdir(), "paddy-fresh-"));
  const cloned = spawnSync("git", ["clone", "--branch", "main", origin, kit], { encoding: "utf8" });
  assert.equal(cloned.status, 0, cloned.stderr);
  const home = mkdtempSync(join(tmpdir(), "paddy-upd-fresh-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  pointKit(home, kit);
  const r = run(["update", "--json"], { PADDY_HOME: home });
  assert.equal(r.status ?? 0, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.upToDate, true);
  assert.match(r.stdout, /Already up to date|upToDate/);
  assert.equal(existsSync(join(kit, "node_modules")), false);
  assert.equal(existsSync(join(kit, "package.json")), false);
});


test("paddy config get/set/unset path ops", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-cfgpath-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const set = run(["config", "set", "gateway.port", "9090", "--json"], { PADDY_HOME: home });
  assert.equal(set.status, 0, set.stderr + set.stdout);
  const get = run(["config", "get", "gateway.port", "--json"], { PADDY_HOME: home });
  assert.equal(get.status, 0, get.stderr + get.stdout);
  assert.equal(JSON.parse(get.stdout).value, 9090);
  run(["config", "set", "brain.model", '"gpt-test"', "--json"], { PADDY_HOME: home });
  const unset = run(["config", "unset", "brain.model", "--json"], { PADDY_HOME: home });
  assert.equal(unset.status, 0, unset.stderr + unset.stdout);
  const missing = run(["config", "get", "brain.model", "--json"], { PADDY_HOME: home });
  assert.notEqual(missing.status, 0);
});

test("paddy config schema prints FE subset", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-schema-"));
  const r = run(["config", "schema", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.ok(payload.schema.properties.gateway.properties.auth);
  assert.equal(payload.schema.properties.agents.properties.defaults.properties.memory.properties.memoryCharLimit.default, 2200);
});

test("paddy config set does not echo secrets", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-secret-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const r = run(
    ["config", "set", "gateway.auth.token", '"SUPERSECRETCLI99"', "--json"],
    { PADDY_HOME: home },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /SUPERSECRETCLI99/);
  const show = run(["config", "show", "--json"], { PADDY_HOME: home });
  assert.doesNotMatch(show.stdout, /SUPERSECRETCLI99/);
});

test("channels list prints the OpenClaw paused message once when runtime=openclaw", () => {
  const msg = "Channels are configured in ~/.openclaw/openclaw.json, Paddy's bridge is paused.";
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  const paddy = run(["channels", "list"], { PADDY_HOME: home });
  assert.equal(paddy.status, 0, paddy.stderr);
  assert.ok(!paddy.stdout.includes(msg));
  assert.equal(run(["config", "set", "openclaw.runtime", "\"openclaw\""], { PADDY_HOME: home }).status, 0);
  const r = run(["channels", "list"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Channels\n/);
  assert.match(r.stdout, /telegram/);
  assert.equal(r.stdout.split(msg).length - 1, 1);
  const j = JSON.parse(run(["channels", "list", "--json"], { PADDY_HOME: home }).stdout);
  assert.equal(j.runtime, "openclaw");
  assert.equal(j.bridge, "paused");
  assert.equal(j.message, msg);
});
