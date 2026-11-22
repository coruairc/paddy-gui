import test from "node:test";
import assert from "node:assert/strict";
import {
  commandSlug,
  filterCommands,
  nextCommandIndex,
  parseCommandInput,
  shouldAutoLoadCommands,
} from "./commands.ts";

const catalog = [
  { name: "echo", description: "Repeat the arguments" },
  { name: "build", description: "Run the build" },
  { name: "noargs", description: "" },
];

test("parseCommandInput accepts only a leading slash", () => {
  assert.deepEqual(parseCommandInput("/echo hello world"), { name: "echo", args: "hello world" });
  assert.deepEqual(parseCommandInput("/echo"), { name: "echo", args: "" });
  assert.deepEqual(parseCommandInput("/echo   spaced   args"), {
    name: "echo",
    args: "spaced   args",
  });
  assert.equal(parseCommandInput(""), null);
  assert.equal(parseCommandInput("hello /echo"), null);
  assert.equal(parseCommandInput("/"), null);
  assert.equal(parseCommandInput("  /echo"), null);
});

test("filterCommands strips one leading slash and matches name or description", () => {
  assert.deepEqual(filterCommands(catalog, ""), catalog);
  assert.deepEqual(filterCommands(catalog, "/"), catalog);
  assert.deepEqual(
    filterCommands(catalog, "ech").map((item) => item.name),
    ["echo"],
  );
  assert.deepEqual(
    filterCommands(catalog, "BUILD").map((item) => item.name),
    ["build"],
  );
  assert.deepEqual(
    filterCommands(catalog, "repeat").map((item) => item.name),
    ["echo"],
  );
  assert.deepEqual(filterCommands(catalog, "/build"), [{ name: "build", description: "Run the build" }]);
  assert.deepEqual(filterCommands(catalog, "zzz"), []);
  assert.deepEqual(filterCommands([], "echo"), []);
});

test("filterCommands survives a 100-command catalog", () => {
  const many = Array.from({ length: 100 }, (_, index) => ({
    name: `cmd-${index}`,
    description: `Command ${index}`,
  }));
  assert.equal(filterCommands(many, "cmd-").length, 100);
  assert.equal(filterCommands(many, "cmd-42").length, 1);
});

test("commandSlug replaces unsafe characters", () => {
  assert.equal(commandSlug("a/b c"), "a_b_c");
  assert.equal(commandSlug("plain-name_1"), "plain-name_1");
});

test("nextCommandIndex clamps without wrapping", () => {
  assert.equal(nextCommandIndex(0, 0, "ArrowDown"), -1);
  assert.equal(nextCommandIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(nextCommandIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(nextCommandIndex(0, 3, "ArrowUp"), 0);
  assert.equal(nextCommandIndex(2, 3, "ArrowDown"), 2);
  assert.equal(nextCommandIndex(1, 3, "Home"), 0);
  assert.equal(nextCommandIndex(1, 3, "End"), 2);
});

test("shouldAutoLoadCommands stops after a failed load so only Retry reloads", () => {
  const base = { open: true, catalogLoaded: false, loading: false, error: null };
  assert.equal(shouldAutoLoadCommands(base), true);
  assert.equal(shouldAutoLoadCommands({ ...base, error: "404 Not Found" }), false);
  assert.equal(shouldAutoLoadCommands({ ...base, loading: true }), false);
  assert.equal(shouldAutoLoadCommands({ ...base, catalogLoaded: true }), false);
  assert.equal(shouldAutoLoadCommands({ ...base, open: false }), false);
});
