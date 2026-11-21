import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_STATE, normalizeState, publicState, readState, writeState } from "./state.ts";

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
