import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AVAILABLE_MODELS_MAX,
  EMPTY_STATE,
  normalizeState,
  publicState,
  readState,
  validateAvailableModels,
  writeState,
} from "./state.ts";

test("owned server password survives a controller restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
  const file = join(dir, "state.json");
  try {
    const state = { ...EMPTY_STATE, ownedServerPassword: "ocw_secret" };
    writeState(file, state);
    assert.equal(readState(file).ownedServerPassword, "ocw_secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeState defaults the owned password and keeps it out of publicState", () => {
  const state = normalizeState({ ownedServerPassword: "ocw_secret", connectionPassword: "user_pw" });
  assert.equal(state.ownedServerPassword, "ocw_secret");
  assert.equal(normalizeState(null).ownedServerPassword, "");
  const published = JSON.stringify(publicState(state));
  assert.equal(published.includes("ocw_secret"), false);
  assert.equal(published.includes("user_pw"), false);
});

test("deskModel upgrades silently and round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
  const file = join(dir, "state.json");
  try {
    // An old-format file predates deskModel entirely.
    writeFileSync(file, JSON.stringify({ projects: [], appearance: "dark" }));
    assert.equal(readState(file).deskModel, "");
    assert.equal(normalizeState({ deskModel: 42 } as any).deskModel, "");
    assert.equal(normalizeState(null).deskModel, "");

    const state = {
      ...EMPTY_STATE,
      deskModel: "alibaba-token-plan/model-a",
      connectionPassword: "user_pw",
      ownedServerPassword: "ocw_secret",
    };
    writeState(file, state);
    assert.equal(readState(file).deskModel, "alibaba-token-plan/model-a");

    const published = publicState(state);
    assert.equal(published.deskModel, "alibaba-token-plan/model-a");
    const serialized = JSON.stringify(published);
    assert.equal(serialized.includes("ocw_secret"), false);
    assert.equal(serialized.includes("user_pw"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("availableModels upgrades silently, prunes invalid entries, dedupes and caps", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
  const file = join(dir, "state.json");
  try {
    // An old-format file predates availableModels entirely.
    writeFileSync(file, JSON.stringify({ projects: [], appearance: "dark" }));
    assert.deepEqual(readState(file).availableModels, []);
    assert.deepEqual(normalizeState(null).availableModels, []);

    // Hand-edited or corrupt entries load as a bounded, deduped, valid list.
    writeFileSync(
      file,
      JSON.stringify({
        projects: [],
        appearance: "dark",
        availableModels: [
          "openai/gpt-6.2-astra",
          "openai/gpt-6.2-astra",
          42,
          "no-slash",
          "openai/<script>",
          "",
          "opencode-go/gemini-4-neon",
        ],
      }),
    );
    assert.deepEqual(readState(file).availableModels, [
      "openai/gpt-6.2-astra",
      "opencode-go/gemini-4-neon",
    ]);

    const many = Array.from({ length: AVAILABLE_MODELS_MAX + 10 }, (_, index) => `bulk/model-${index}`);
    writeFileSync(file, JSON.stringify({ projects: [], appearance: "dark", availableModels: many }));
    const capped = readState(file).availableModels;
    assert.equal(capped.length, AVAILABLE_MODELS_MAX);
    assert.equal(capped[0], "bulk/model-0");

    const state = {
      ...EMPTY_STATE,
      availableModels: ["openai/gpt-6.2-astra", "opencode-go/gemini-4-neon"],
      connectionPassword: "user_pw",
    };
    writeState(file, state);
    assert.deepEqual(readState(file).availableModels, [
      "openai/gpt-6.2-astra",
      "opencode-go/gemini-4-neon",
    ]);
    assert.deepEqual(publicState(state).availableModels, state.availableModels);
    assert.equal(JSON.stringify(publicState(state)).includes("user_pw"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateAvailableModels rejects malformed lists but dedupes and bounds valid ones", () => {
  assert.equal(validateAvailableModels("openai/gpt").ok, false);
  assert.equal(validateAvailableModels([42]).ok, false);
  assert.equal(validateAvailableModels(["openai/gpt", "no-slash"]).ok, false);
  assert.equal(
    validateAvailableModels(Array.from({ length: AVAILABLE_MODELS_MAX + 1 }, (_, index) => `bulk/model-${index}`)).ok,
    false,
  );
  const deduped = validateAvailableModels(["openai/gpt", "openai/gpt", "openai/other"]);
  assert.deepEqual(deduped, { ok: true, value: ["openai/gpt", "openai/other"] });
  assert.deepEqual(validateAvailableModels([]), { ok: true, value: [] });
});

test("an invalid deskModel persisted before validation loads as unset; valid ones round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
  const file = join(dir, "state.json");
  try {
    for (const bad of ["x".repeat(5010), "no-slash", "openai/" + "m".repeat(300), "open ai/gpt", "openai/<b>", "trailing/"]) {
      writeFileSync(file, JSON.stringify({ projects: [], appearance: "dark", deskModel: bad }));
      assert.equal(readState(file).deskModel, "", bad.slice(0, 30));
    }
    for (const good of ["openrouter/anthropic/claude-4.5", "ollama/llama3.3:70b"]) {
      writeFileSync(file, JSON.stringify({ projects: [], appearance: "dark", deskModel: good }));
      assert.equal(readState(file).deskModel, good);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
