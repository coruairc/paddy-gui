import test from "node:test";
import assert from "node:assert/strict";
import {
  groupSessionsByDate,
  normalizeEvent,
  summarizeSession,
  toChatMessage,
  toChatMessages,
  toDiffFile,
} from "./normalize.ts";

test("sessions group into today and yesterday", () => {
  const now = new Date("2026-09-29T15:00:00").getTime();
  const groups = groupSessionsByDate(
    [
      { id: "a", title: "Authentication bug", created: now, updated: now, archived: false, additions: 0, deletions: 0, files: 0 },
      { id: "b", title: "Website changes", created: now - 86_400_000, updated: now - 86_400_000, archived: false, additions: 0, deletions: 0, files: 0 },
    ],
    now,
  );
  assert.equal(groups[0].label, "Today");
  assert.equal(groups[0].items[0].title, "Authentication bug");
  assert.equal(groups[1].label, "Yesterday");
});

test("v2 sessions summarize from location and time", () => {
  const summary = summarizeSession({
    id: "ses_1",
    title: "Auth bug",
    time: { created: 10, updated: 20, archived: 30 },
    location: { directory: "/work/app" },
  });
  assert.equal(summary.directory, "/work/app");
  assert.equal(summary.created, 10);
  assert.equal(summary.updated, 20);
  assert.equal(summary.archived, true);
  assert.equal(summary.additions, 0);
});

test("v2 messages and tool activity are normalized", () => {
  const message = toChatMessage({
    id: "msg_1",
    type: "assistant",
    time: { created: 1 },
    content: [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "I found the issue" },
      { type: "tool", id: "prt_1", name: "read", state: { status: "completed", title: "Reading src/auth.ts" } },
    ],
  });
  assert.equal(message.role, "assistant");
  assert.equal(message.text, "I found the issue");
  assert.equal(message.activity.length, 1);
  assert.equal(message.activity[0].title, "Reading src/auth.ts");
  assert.equal(message.activity[0].status, "completed");

  const user = toChatMessage({ id: "msg_0", type: "user", time: { created: 0 }, text: "Fix auth" });
  assert.equal(user.role, "user");
  assert.equal(user.text, "Fix auth");
});

test("bookkeeping messages are not chat bubbles", () => {
  const messages = toChatMessages([
    { id: "u1", type: "user", text: "hi" },
    { id: "a1", type: "assistant", content: [{ type: "text", text: "hello" }] },
    { id: "i1", type: "idle" },
    { id: "m1", type: "model-switched" },
  ]);
  assert.deepEqual(
    messages.map((message) => message.id),
    ["u1", "a1"],
  );
});

test("tool events update activity and keep their label", () => {
  const started = normalizeEvent({
    type: "session.tool.input.started",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", id: "call_1", name: "read" },
  });
  assert.equal(started?.type, "activity");
  if (started?.type === "activity") assert.equal(started.item.status, "running");

  const success = normalizeEvent({
    type: "session.tool.success",
    data: {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      id: "call_1",
      content: [{ type: "text", text: "file contents" }],
      metadata: { status: "completed" },
    },
  });
  assert.equal(success?.type, "activity");
  if (success?.type === "activity") {
    assert.equal(success.item.status, "completed");
    assert.equal(success.item.tool, "read");
    assert.equal(success.item.title, "Reading");
    assert.match(success.item.detail ?? "", /file contents/);
  }
});

test("streaming, permission, form, and malformed events", () => {
  const delta = normalizeEvent({
    type: "session.text.delta",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "Hi" },
  });
  assert.equal(delta?.type, "text-delta");

  const permission = normalizeEvent({
    type: "permission.asked",
    data: {
      id: "per_1",
      sessionID: "ses_1",
      action: "bash",
      resources: ["rm *"],
      save: [],
      metadata: { command: "rm -rf build" },
      message: "Run rm -rf build",
    },
  });
  assert.equal(permission?.type, "permission");
  if (permission?.type === "permission") {
    assert.equal(permission.prompt.kind, "permission");
    assert.equal(permission.prompt.title, "bash");
    assert.match(permission.prompt.detail, /rm/);
  }

  const form = normalizeEvent({
    type: "form.created",
    data: {
      id: "form_1",
      sessionID: "ses_1",
      title: "Choose",
      fields: [{ key: "answer", type: "string", title: "Deploy?", description: "Ship it now?" }],
    },
  });
  assert.equal(form?.type, "permission");
  if (form?.type === "permission") {
    assert.equal(form.prompt.kind, "question");
    assert.equal(form.prompt.title, "Choose");
    assert.match(form.prompt.detail, /Deploy/);
  }

  const failed = normalizeEvent({
    type: "session.execution.failed",
    data: { sessionID: "ses_1", error: { type: "provider", message: "quota exceeded" } },
  });
  assert.deepEqual(failed, {
    type: "status",
    sessionId: "ses_1",
    state: "error",
    detail: "quota exceeded",
  });

  const created = normalizeEvent({
    type: "session.created",
    data: { sessionID: "ses_1", title: "New work", location: { directory: "/work/app" } },
  });
  assert.equal(created?.type, "session");
  if (created?.type === "session") {
    assert.equal(created.session.id, "ses_1");
    assert.equal(created.session.directory, "/work/app");
  }

  const bad = normalizeEvent("nope");
  assert.equal(bad?.type, "malformed");
});

test("diffs keep added and removed counts", () => {
  const file = toDiffFile({ file: "src/auth.ts", before: "a\n", after: "b\n", additions: 1, deletions: 1 });
  assert.equal(file.additions, 1);
  assert.match(file.patch, /\+b/);

  const v2 = toDiffFile({ file: "src/auth.ts", patch: "--- a\n+++ b\n+x", additions: 3, deletions: 2, status: "modified" });
  assert.equal(v2.file, "src/auth.ts");
  assert.equal(v2.additions, 3);
  assert.equal(v2.deletions, 2);
});

test("session.model.selected normalizes to one additive variant", () => {
  const first = normalizeEvent({
    type: "session.model.selected",
    data: { sessionID: "ses_x", model: { id: "gemini-4-neon", providerID: "google" } },
  });
  assert.deepEqual(first, {
    type: "model-selected",
    sessionId: "ses_x",
    model: "google/gemini-4-neon",
  });

  // A later switch carries `previous`; only the new model is read.
  const switched = normalizeEvent({
    type: "session.model.selected",
    data: {
      sessionID: "ses_x",
      model: { id: "gemini-4-neon", providerID: "opencode" },
      previous: { id: "gemini-4-neon", providerID: "google", variant: "high" },
    },
  });
  assert.deepEqual(switched, {
    type: "model-selected",
    sessionId: "ses_x",
    model: "opencode/gemini-4-neon",
  });
});

test("partial model-selected payloads are dropped", () => {
  assert.equal(
    normalizeEvent({
      type: "session.model.selected",
      data: { sessionID: "ses_x", model: { id: "gemini-4-neon" } },
    }),
    null,
  );
  assert.equal(
    normalizeEvent({
      type: "session.model.selected",
      data: { sessionID: "ses_x", model: { providerID: "google" } },
    }),
    null,
  );
  assert.equal(
    normalizeEvent({
      type: "session.model.selected",
      data: { model: { id: "gemini-4-neon", providerID: "google" } },
    }),
    null,
  );
});

test("session summaries project the session's own model without a variant", () => {
  const withVariant = summarizeSession({
    id: "ses_1",
    model: { id: "gpt-6.2-astra-fast", providerID: "openai", variant: "high" },
  });
  assert.equal(withVariant.model, "openai/gpt-6.2-astra-fast");

  const normalized = summarizeSession({
    id: "ses_1",
    model: { id: "gpt-6.2-astra-fast", providerID: "openai", variant: "default" },
  });
  assert.equal(normalized.model, "openai/gpt-6.2-astra-fast");
  assert.equal(JSON.stringify(normalized).includes("default"), false);

  assert.equal(summarizeSession({ id: "ses_1" }).model, undefined);
  assert.equal(summarizeSession({ id: "ses_1", model: { providerID: "openai" } }).model, undefined);
  assert.equal(summarizeSession({ id: "ses_1", model: { id: "x" } }).model, undefined);
});
