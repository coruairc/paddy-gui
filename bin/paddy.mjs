#!/usr/bin/env node
/**
 * Paddy wrapper. Resolves to the install root and execs `npm run dev` there.
 * Also handles `paddy update`, `paddy uninstall`, `paddy doctor`, and
 * `paddy --version`.
 *
 * Paddy is the interface. OpenCode does the work.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const installRoot = resolve(here, "..");
const home = homedir();
const binDir = process.env.PADDY_BIN_DIR?.trim() || join(home, ".local", "bin");
const stateDir = process.env.PADDY_HOME?.trim() || join(home, ".config", "opencode-web");
const nodeMajor = Number.parseInt((process.versions.node.split(".")[0] ?? "0"), 10);

function say(line) { process.stdout.write(`${line}\n`); }
function warn(line) { process.stderr.write(`paddy: ${line}\n`); }

function ensureRepo() {
  if (!existsSync(join(installRoot, "package.json"))) {
    warn("install root is missing package.json — reinstall with the curl installer.");
    process.exit(2);
  }
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(installRoot, "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function run(cmd, args, cwd = installRoot) {
  const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  return child;
}

const args = process.argv.slice(2);
const subcommand = args[0] ?? "start";
const rest = args.slice(1);

switch (subcommand) {
  case "-v":
  case "--version": {
    say(`paddy ${readVersion()} (node ${process.versions.node.trim()})`);
    process.exit(0);
    break;
  }

  case "help":
  case "-h":
  case "--help": {
    say(`paddy ${readVersion()}

Paddy is the interface. OpenCode does the work.

Usage:
  paddy                Start the local desk at http://127.0.0.1:8080
  paddy start          Same as above
  paddy update         Pull the latest and reinstall
  paddy uninstall      Remove the wrapper (keeps the checkout)
  paddy doctor         Print install and runtime info
  paddy --version      Print the installed version
  paddy help           Print this help

Environment:
  PADDY_HOME           State directory (default ~/.config/opencode-web)
  PADDY_BIN_DIR        Where the wrapper lives (default ~/.local/bin)
  OPENCODE_URL         Connect to an already-running OpenCode server
  OPENCODE_SERVER_PASSWORD
                       OpenCode server password (if you set one)
  OPENCODE_WEB_TOKEN   Token required for non-loopback access to /api
  OPENCODE_WEB_HOST    Bind host (127.0.0.1 default; refuses remote without a token)
`);
    process.exit(0);
    break;
  }

  case "doctor": {
    ensureRepo();
    say(`paddy ${readVersion()}`);
    say(`node ${process.versions.node.trim()}`);
    say(`install root  ${installRoot}`);
    say(`state dir     ${stateDir}`);
    say(`wrapper dir   ${binDir}`);
    say(`opencode      detected via OpenCode runtime: which opencode`);
    process.exit(0);
    break;
  }

  case "uninstall": {
    const wrapper = join(binDir, process.platform === "win32" ? "paddy.cmd" : "paddy");
    try {
      rmSync(wrapper, { force: true });
      say(`removed ${wrapper}`);
    } catch (err) {
      warn(`could not remove ${wrapper}: ${err.message}`);
    }
    say("checkout and state stay on disk. To remove them entirely:");
    say(`  rm -rf ${installRoot}`);
    say(`  rm -rf ${stateDir}`);
    process.exit(0);
    break;
  }

  case "update": {
    ensureRepo();
    try {
      say("fetching latest");
      execFileSync("git", ["-C", installRoot, "fetch", "--depth", "1", "origin"], { stdio: "inherit" });
      execFileSync("git", ["-C", installRoot, "reset", "--hard", "FETCH_HEAD"], { stdio: "inherit" });
    } catch (err) {
      warn(`git update failed: ${err.message}`);
      process.exit(1);
    }
    say("npm install");
    run("npm", ["install", "--no-fund", "--no-audit"]);
    say("updated.");
    process.exit(0);
    break;
  }

  case "start":
  default: {
    ensureRepo();
    if (nodeMajor < 22) {
      warn(`Node.js ${process.versions.node.trim()} is too old. Need 22+.`);
      process.exit(2);
    }
    mkdirSync(stateDir, { recursive: true });
    process.env.OPENCODE_WEB_HOME = stateDir;
    run("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "8080"]);
    break;
  }

  void rest;
}