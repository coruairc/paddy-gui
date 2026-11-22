import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Both naming styles count, so a `*.spec.*` file cannot slip past the list either.
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

function testFiles(dir) {
  return readdirSync(join(root, dir), { recursive: true })
    .map((entry) => join(dir, String(entry)).split("\\").join("/"))
    .filter((path) => !path.includes("/node_modules/") && TEST_FILE.test(path))
    .sort();
}

test("the guard recognises .test.* and .spec.* files and ignores ordinary modules", () => {
  for (const path of ["src/a.test.ts", "src/a.spec.ts", "src/b.spec.tsx", "scripts/c.spec.mjs", "scripts/d.test.js", "src/e.spec.mts"]) {
    assert.ok(TEST_FILE.test(path), path);
  }
  for (const path of ["src/a.ts", "src/spec.ts", "src/test.ts", "src/a.test.ts.snap", "src/inspector.tsx"]) {
    assert.ok(!TEST_FILE.test(path), path);
  }
});

test("npm test runs every test file in src/ and scripts/", () => {
  const script = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.test;
  const listed = new Set(script.split(/\s+/));
  const missing = [...testFiles("src"), ...testFiles("scripts")].filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `add these to the "test" script in package.json: ${missing.join(", ")}`);
});

test("the test-list guard itself is in the npm test script", () => {
  const script = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.test;
  assert.ok(script.split(/\s+/).includes("scripts/test-list.test.mjs"), "keep scripts/test-list.test.mjs in the test script");
});
