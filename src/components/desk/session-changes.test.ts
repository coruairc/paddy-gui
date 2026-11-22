import test from "node:test";
import assert from "node:assert/strict";
import type { DiffFile } from "@/lib/desk/client";
import { readFileSync } from "node:fs";
import { changesFailed, changesLoaded, changesLoading, changesPanelView, changesSettled, EMPTY_CHANGES, visibleChanges } from "./session-changes.ts";

const file = (path: string): DiffFile => ({ file: path, additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x\n", status: "added", binary: false, truncated: false });

test("archive then send: the changes list never shows the archived chat's files", () => {
  // Chat A is open and its latest turn changed old.ts.
  let state = changesLoaded("ses_A", [file("old.ts")]);
  let open: string | null = "ses_A";
  assert.deepEqual(visibleChanges(state, open).files.map((f) => f.file), ["old.ts"]);

  // Archive: the open chat becomes none. No reset of `state` is required.
  open = null;
  assert.deepEqual(visibleChanges(state, open).files, []);

  // Send a prompt: ensureSession creates and selects chat B (still no reset).
  open = "ses_B";
  assert.deepEqual(visibleChanges(state, open).files, [], "B's inspector must not show A's files");

  // A late refresh for A lands and settles while B is open: still invisible.
  state = changesSettled(changesLoaded("ses_A", [file("old.ts")]), "ses_A");
  assert.deepEqual(visibleChanges(state, open).files, []);

  // B's turn ends and its own refresh starts, then lands.
  state = changesLoading(state, "ses_B");
  assert.deepEqual(visibleChanges(state, open), { files: [], loading: true, error: null }, "loading B never carries A's files");
  state = changesSettled(changesLoaded("ses_B", [file("new.ts")]), "ses_B");
  assert.deepEqual(visibleChanges(state, open).files.map((f) => f.file), ["new.ts"]);
});

test("session-deleted: the deleted chat's files and errors disappear", () => {
  const state = changesFailed(changesLoaded("ses_A", [file("a.ts")]), "ses_A", "The diff is too large to load (over 32 MB)");
  assert.equal(visibleChanges(state, "ses_A").error, "The diff is too large to load (over 32 MB)");
  assert.deepEqual(visibleChanges(state, null), { files: [], loading: false, error: null });
  assert.deepEqual(visibleChanges(state, "ses_C"), { files: [], loading: false, error: null });
});

test("a refresh for the same chat keeps its files while loading, and a stale settle is a no-op", () => {
  const loaded = changesLoaded("ses_A", [file("a.ts")]);
  const loading = changesLoading(loaded, "ses_A");
  assert.deepEqual(visibleChanges(loading, "ses_A").files.map((f) => f.file), ["a.ts"]);
  assert.equal(changesSettled(loading, "ses_B"), loading);
  assert.equal(visibleChanges(changesSettled(loading, "ses_A"), "ses_A").loading, false);
  assert.deepEqual(visibleChanges(EMPTY_CHANGES, null).files, []);
});

test("changesPanelView (what ChangesPanel renders) never shows another chat's files or errors", () => {
  const archived = changesLoaded("ses_A", [file("old.ts")]);
  assert.deepEqual(changesPanelView(archived, "ses_A"), { kind: "ready", files: [file("old.ts")] });
  assert.deepEqual(changesPanelView(archived, null), { kind: "ready", files: [] }, "after archive");
  assert.deepEqual(changesPanelView(archived, "ses_B"), { kind: "ready", files: [] }, "after archive → send");
  assert.deepEqual(changesPanelView(changesLoading(archived, "ses_B"), "ses_B"), { kind: "loading" });
  const failed = changesFailed(archived, "ses_A", "too large");
  assert.deepEqual(changesPanelView(failed, "ses_A"), { kind: "error", message: "too large" });
  assert.deepEqual(changesPanelView(failed, "ses_B"), { kind: "ready", files: [] });
  // INFO-1: a failure tagged for B must not carry A's files along.
  assert.deepEqual(changesFailed(archived, "ses_B", "x").files, []);
});

// The panel takes the raw session-tagged state and filters it itself; this pins
// app.tsx to that contract (pass the raw state and the *open* chat's id), so
// swapping in unfiltered data or another id fails here, not only in a browser.
test("app.tsx hands ChangesPanel the raw state and the open session id", () => {
  const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
  const usage = /<ChangesPanel\b([\s\S]*?)\/>/.exec(app)?.[1] ?? "";
  assert.match(usage, /\bchanges=\{changes\}/);
  assert.match(usage, /\bopenSessionId=\{sessionId\}/);
  assert.doesNotMatch(usage, /\bfiles=/, "no props path for unfiltered files");
});

test("ChangesPanel renders through changesPanelView with the open session id", () => {
  const panel = readFileSync(new URL("./files-changed.tsx", import.meta.url), "utf8");
  const body = /export function ChangesPanel\b[\s\S]*?\n}\n/.exec(panel)?.[0] ?? "";
  assert.match(body, /changesPanelView\(changes, openSessionId\)/);
});
