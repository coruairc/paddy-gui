import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HIGHLIGHT_LINE_LENGTH, MAX_HIGHLIGHT_LINES, tokenizeLines } from "./highlight.ts";

test("tokenizeLines highlights with Monokai colours, one entry per line", async () => {
  const lines = ["const answer = 42;", "// note"];
  const tokens = await tokenizeLines(lines, "typescript");
  assert.ok(tokens);
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]?.map((token) => token.content).join(""), lines[0]);
  const colours = new Set(tokens.flat().map((token) => token?.color?.toUpperCase()));
  assert.ok(colours.has("#F92672") || colours.has("#66D9EF"), "keyword colour from the Monokai theme");
  assert.ok(colours.has("#88846F") || colours.has("#75715E"), "comment colour from the Monokai theme");
});

test("a minified line is left plain and does not stall tokenizing", async () => {
  const started = performance.now();
  const tokens = await tokenizeLines(["x".repeat(300_000), "let y = 1;"], "javascript");
  const elapsed = performance.now() - started;
  assert.ok(tokens);
  assert.equal(tokens[0], null, "long line → plain text");
  assert.equal(tokens[1]?.map((token) => token.content).join(""), "let y = 1;");
  assert.ok(elapsed < 2000, `took ${Math.round(elapsed)} ms`);
  assert.ok(MAX_HIGHLIGHT_LINE_LENGTH <= 1000);
});

test("unknown languages, empty input and huge files fall back to plain text", async () => {
  assert.equal(await tokenizeLines(["a"], null), null);
  assert.equal(await tokenizeLines(["a"], "not-a-language"), null);
  assert.equal(await tokenizeLines([], "typescript"), null);
  assert.equal(await tokenizeLines(Array.from({ length: MAX_HIGHLIGHT_LINES + 1 }, () => "a"), "typescript"), null);
});
