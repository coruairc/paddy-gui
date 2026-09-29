import test from "node:test";
import assert from "node:assert/strict";
import { groupSessionsByDate, normalizeEvent, toChatMessage, toDiffFile } from "./normalize.ts";

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

test("messages and tool activity are normalized", () => {
  const message = toChatMessage({
    info: { id: "msg_1", role: "assistant", time: { created: 1 } },
    parts: [
      { type: "text", text: "I found the issue" },
      { id: "prt_1", type: "tool", tool: "read", state: { status: "completed", title: "Reading src/auth.ts" } },
    ],
  });
  assert.equal(message.text, "I found the issue");
  assert.equal(message.activity[0].title, "Reading src/auth.ts");
});

test("streaming, permission, and malformed events", () => {
  const delta = normalizeEvent({
    payload: { type: "message.part.updated", properties: { delta: "Hi", part: { type: "text", sessionID: "ses_1", messageID: "msg_1" } } },
  });
  assert.equal(delta?.type, "text-delta");
  const permission = normalizeEvent({
    type: "permission.asked",
    properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["rm *"], metadata: {} },
  });
  assert.equal(permission?.type, "permission");
  if (permission?.type === "permission") assert.match(permission.prompt.detail, /rm/);
  const bad = normalizeEvent("nope");
  assert.equal(bad?.type, "malformed");
});

test("diffs keep added and removed counts", () => {
  const file = toDiffFile({ file: "src/auth.ts", before: "a\n", after: "b\n", additions: 1, deletions: 1 });
  assert.equal(file.additions, 1);
  assert.match(file.patch, /\+b/);
});
