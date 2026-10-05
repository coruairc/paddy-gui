#!/usr/bin/env node
/**
 * Put `paddy` on PATH (~/.local/bin). Used by postinstall and the curl installer.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(kitRoot, "bin", "paddy.mjs");
const win = process.platform === "win32";

export function linkCli() {
  const binDir = process.env.PADDY_BIN_DIR?.trim() || join(homedir(), ".local", "bin");
  const dest = join(binDir, win ? "paddy.cmd" : "paddy");
  if (!existsSync(cli)) {
    throw new Error(`missing ${cli}`);
  }
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  if (/["$`\n;&|<>]/.test(cli) || /["$`\n;&|<>]/.test(binDir)) {
    throw new Error("unsafe path for paddy wrapper");
  }
  if (win) {
    writeFileSync(dest, `@echo off\r\nnode "${cli}" %*\r\n`, { encoding: "utf8", mode: 0o755 });
  } else {
    writeFileSync(
      dest,
      `#!/usr/bin/env bash\nexport PATH="${binDir}:$PATH"\nexec node "${cli}" "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    chmodSync(dest, 0o755);
  }
  return { binDir, dest };
}

function pathHas(dir) {
  const path = process.env.PATH || process.env.Path || "";
  return path.split(win ? ";" : ":").includes(dir);
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { binDir, dest } = linkCli();
  process.stdout.write(`paddy → ${dest}\n`);
  if (!pathHas(binDir)) {
    process.stdout.write(`${binDir} is not on PATH yet. Add it: export PATH="${binDir}:$PATH"\n`);
  }
}