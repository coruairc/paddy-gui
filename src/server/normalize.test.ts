import test from "node:test";
import assert from "node:assert/strict";
import {
  groupSessionsByDate,
  normalizeEvent,
  summarizeSession,
  toChatMessage,
  toChatMessages,
  toDiffFile,
  stepFiles,
  maskSecrets,
  toDiffFiles,
  MAX_DIFF_TOTAL_CHARS,
  MAX_PATCH_CHARS,
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

test("command.updated normalizes to an invalidation event", () => {
  assert.deepEqual(
    normalizeEvent({ type: "command.updated", location: { directory: "/work/app" }, data: {} }),
    { type: "commands-updated" },
  );
});

test("session.inbox.enqueued maps the expanded user message", () => {
  const event = normalizeEvent({
    type: "session.inbox.enqueued",
    data: {
      inboxID: "msg_1",
      sessionID: "ses_1",
      item: { type: "user", payload: { text: "Repeat: hello world" }, delivery: "steer" },
    },
  });
  assert.equal(event?.type, "message");
  if (event?.type === "message") {
    assert.equal(event.sessionId, "ses_1");
    assert.equal(event.message.id, "msg_1");
    assert.equal(event.message.role, "user");
    assert.equal(event.message.text, "Repeat: hello world");
    assert.deepEqual(event.message.activity, []);
  }
});

test("partial or non-user inbox events are dropped", () => {
  const base = {
    type: "session.inbox.enqueued",
    data: { inboxID: "msg_1", sessionID: "ses_1", item: { type: "user", payload: { text: "x" } } },
  };
  assert.equal(
    normalizeEvent({ ...base, data: { ...base.data, inboxID: undefined } }),
    null,
  );
  assert.equal(
    normalizeEvent({ ...base, data: { ...base.data, sessionID: undefined } }),
    null,
  );
  assert.equal(
    normalizeEvent({ ...base, data: { ...base.data, item: { type: "assistant", payload: { text: "x" } } } }),
    null,
  );
  assert.equal(
    normalizeEvent({ ...base, data: { ...base.data, item: { type: "user", payload: {} } } }),
    null,
  );
});

// Shape copied from a real OpenCode v2.3.2 `GET /api/session/:id/diff?context=3` response.
const V2_MODIFIED = {
  file: "src/server/state.ts",
  patch:
    "diff --git a/src/server/state.ts b/src/server/state.ts\nindex ae12613..a5ce3f9 100644\n--- a/src/server/state.ts\n+++ b/src/server/state.ts\n@@ -30,6 +30,8 @@ export type AppState = {\n   connectionPassword: string;\n+  deskModel: string;\n+  extra: string;\n   ownedServerPassword: string;\n",
  additions: 2,
  deletions: 0,
  status: "modified",
};

test("toDiffFile keeps the v2 FileDiff.Info fields", () => {
  const file = toDiffFile(V2_MODIFIED);
  assert.equal(file.file, "src/server/state.ts");
  assert.equal(file.status, "modified");
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 0);
  assert.equal(file.binary, false);
  assert.equal(file.truncated, false);
  assert.equal(file.patch, V2_MODIFIED.patch);
});

test("toDiffFile infers status from git headers when OpenCode omits or garbles it", () => {
  const added = toDiffFile({ file: "a.ts", patch: "diff --git a/a.ts b/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1 @@\n+x\n", status: "weird" });
  assert.equal(added.status, "added");
  assert.equal(added.additions, 1, "the +++ header is not counted");
  const deleted = toDiffFile({ file: "b.ts", patch: "deleted file mode 100644\n--- a/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-y\n" });
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.deletions, 1);
  assert.equal(toDiffFile({ file: "c.ts", patch: "@@ -1 +1 @@\n-a\n+b\n" }).status, "modified");
});

test("toDiffFile flags binary patches and OpenCode's `more`", () => {
  const binary = toDiffFile({ file: "logo.png", patch: "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n", additions: 0, deletions: 0, status: "modified" });
  assert.equal(binary.binary, true);
  assert.equal(toDiffFile({ ...V2_MODIFIED, more: true }).truncated, true);
});

test("toDiffFile caps an oversized patch on a line boundary and marks it truncated", () => {
  const line = "+" + "x".repeat(99) + "\n";
  const patch = "@@ -0,0 +1,9999 @@\n" + line.repeat(Math.ceil(MAX_PATCH_CHARS / line.length) + 50);
  const file = toDiffFile({ file: "big.txt", patch, additions: 9999, deletions: 0, status: "added" });
  assert.equal(file.truncated, true);
  assert.ok(file.patch.length <= MAX_PATCH_CHARS);
  assert.ok(file.patch.endsWith("\n"));
  assert.equal(file.additions, 9999, "counts come from OpenCode, not the cut patch");
});

test("toDiffFile survives junk input", () => {
  const file = toDiffFile(null);
  assert.equal(file.file, "file");
  assert.equal(file.patch, "");
  assert.equal(file.status, "modified");
  assert.equal(toDiffFile({ file: "x".repeat(5000), patch: 42 }).file.length, 1024);
});

test("assistant messages carry snapshot.files; other shapes are dropped", () => {
  const message = toChatMessage({
    id: "msg_a",
    type: "assistant",
    content: [],
    snapshot: { start: "s1", end: "s2", files: ["src/a.ts", "src/a.ts", 7, "", "src/b.ts"] },
  });
  assert.deepEqual(message.files, ["src/a.ts", "src/b.ts"]);
  const none = toChatMessage({ id: "msg_b", type: "assistant", content: [], snapshot: { start: "s", end: "s", files: [] } });
  assert.equal("files" in none, false);
  assert.equal("files" in toChatMessage({ id: "msg_u", type: "user", text: "hi" }), false);
  assert.deepEqual(stepFiles("src/a.ts"), []);
});

test("session.step.ended becomes step-files only when files changed", () => {
  const event = normalizeEvent({
    type: "session.step.ended",
    data: { sessionID: "ses_1", assistantMessageID: "msg_a", finish: "tool-calls", files: ["src/a.ts"] },
  });
  assert.deepEqual(event, { type: "step-files", sessionId: "ses_1", messageId: "msg_a", files: ["src/a.ts"] });
  assert.equal(normalizeEvent({ type: "session.step.ended", data: { sessionID: "ses_1", assistantMessageID: "msg_a", files: [] } }), null);
});

test("one enormous line is shortened, not dropped down to the hunk header", () => {
  const patch = "@@ -1 +1 @@\n-old\n+" + "m".repeat(MAX_PATCH_CHARS * 2) + "\n";
  const file = toDiffFile({ file: "dist/app.min.js", patch, additions: 1, deletions: 1, status: "modified" });
  assert.equal(file.truncated, true);
  assert.ok(file.patch.length <= MAX_PATCH_CHARS);
  const lines = file.patch.split("\n");
  assert.equal(lines[1], "-old");
  assert.ok(lines[2].startsWith("+mmmm") && lines[2].endsWith("…"));
  assert.ok(lines[2].length > MAX_PATCH_CHARS - 100);
});

test("maskSecrets replaces every occurrence of each secret of 4+ chars", () => {
  const pw = "ocw_" + "k".repeat(40);
  assert.equal(maskSecrets(`a${pw}b ${pw}`, [pw]), "a[redacted]b [redacted]");
  assert.equal(maskSecrets("token=short123", ["short123"]), "token=[redacted]");
  assert.equal(maskSecrets("pw=abcd;", ["abcd"]), "pw=[redacted];");
  assert.equal(maskSecrets("let abc = 1;", ["abc"]), "let abc = 1;", "under 4 chars is left alone");
  assert.equal(maskSecrets("nothing here", [pw, ""]), "nothing here");
});

test("maskSecrets masks the longer of two overlapping secrets whole, whatever the input order", () => {
  const short = "prefix-secret";
  const long = "prefix-secret-tail-very-secret";
  for (const order of [[short, long], [long, short], [short, long, short]]) {
    assert.equal(maskSecrets(`x=${long};y=${short}`, order), "x=[redacted];y=[redacted]", order.join(","));
  }
});

test("masking happens before the per-file cap so a cut never leaks a secret prefix", () => {
  const pw = "ocw_" + "s".repeat(60);
  const prefix = "@@ -0,0 +1 @@\n+" + "z".repeat(MAX_PATCH_CHARS - 40);
  const file = toDiffFile({ file: "x.txt", patch: prefix + pw + "\n", status: "added" }, [pw]);
  assert.equal(file.patch.includes("ocw_"), false);
  assert.equal(file.patch.includes("ssss"), false);
});

test("toDiffFiles spends the total budget in order and blanks the rest", () => {
  const chunk = "@@ -0,0 +1 @@\n+" + "a".repeat(MAX_PATCH_CHARS - 20) + "\n";
  const count = Math.ceil(MAX_DIFF_TOTAL_CHARS / chunk.length) + 3;
  const files = toDiffFiles(Array.from({ length: count }, (_, i) => ({ file: `f${i}`, patch: chunk, additions: 1, deletions: 0, status: "added" })));
  const kept = files.filter((file) => file.patch);
  assert.equal(kept.length, Math.floor(MAX_DIFF_TOTAL_CHARS / chunk.length));
  assert.ok(files.slice(kept.length).every((file) => file.patch === "" && file.truncated && file.additions === 1));
  assert.deepEqual(toDiffFiles({ not: "an array" }), []);
});
