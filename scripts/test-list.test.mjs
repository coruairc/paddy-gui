import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function testFiles(dir) {
  return readdirSync(join(root, dir), { recursive: true })
    .map((entry) => join(dir, String(entry)).split("\\").join("/"))
    .filter((path) => /\.test\.(ts|mjs)$/.test(path))
    .sort();
}

test("npm test runs every test file in src/ and scripts/", () => {
  const script = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.test;
  const listed = new Set(script.split(/\s+/));
  const missing = [...testFiles("src"), ...testFiles("scripts")].filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `add these to the "test" script in package.json: ${missing.join(", ")}`);
});
