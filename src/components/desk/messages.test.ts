import test from "node:test";
import assert from "node:assert/strict";
import {
  appendDelta,
  dropPendingBubbles,
  echoToReplace,
  hasPendingBubble,
  mergeMessage,
  replacePendingEcho,
  settlePendingEcho,
  upsertActivity,
} from "./messages.ts";

function msg(overrides: Partial<{ id: string; role: "user" | "assistant" | "system"; text: string; created: number; pending: boolean; activity: { id: string; tool: string; title: string; status: "pending" | "running" | "completed" | "error" }[] }>) {
  return {
    id: overrides.id ?? "m1",
    role: overrides.role ?? "assistant",
    text: overrides.text ?? "",
    created: overrides.created ?? 1000,
    activity: overrides.activity ?? [],
    pending: overrides.pending,
  };
}

test("mergeMessage reconciles optimistic pending user bubble", () => {
  const list = [msg({ id: "local_1", role: "user", text: "hi", created: 1000, pending: true })];
  const server = msg({ id: "srv_1", role: "user", text: "hi", created: 1200 });
  const out = mergeMessage(list, server);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "srv_1");
  assert.equal(out[0].pending, false);
});

test("mergeMessage does not reconcile when text differs", () => {
  const list = [msg({ id: "local_1", role: "user", text: "hi", created: 1000, pending: true })];
  const server = msg({ id: "srv_1", role: "user", text: "bye", created: 1200 });
  const out = mergeMessage(list, server);
  assert.equal(out.length, 2);
});

test("mergeMessage does not reconcile when created diff >= 5000", () => {
  const list = [msg({ id: "local_1", role: "user", text: "hi", created: 1000, pending: true })];
  const server = msg({ id: "srv_1", role: "user", text: "hi", created: 7000 });
  const out = mergeMessage(list, server);
  assert.equal(out.length, 2);
});

test("mergeMessage updates by exact id", () => {
  const list = [msg({ id: "a1", role: "assistant", text: "old", created: 1000, activity: [] })];
  const update = msg({ id: "a1", role: "assistant", text: "new", created: 1000, activity: [{ id: "t1", tool: "read", title: "r", status: "completed" }] });
  const out = mergeMessage(list, update);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "new");
  assert.equal(out[0].activity.length, 1);
});

test("appendDelta appends or concatenates", () => {
  const list: ReturnType<typeof msg>[] = [];
  const a = appendDelta(list as any, "m", "Hi");
  assert.equal(a.length, 1);
  assert.equal(a[0].text, "Hi");
  const b = appendDelta(a as any, "m", " there");
  assert.equal(b[0].text, "Hi there");
});

test("upsertActivity adds and updates", () => {
  const list: any[] = [];
  const a = upsertActivity(list, "m", { id: "t1", tool: "read", title: "r", status: "running" });
  assert.equal(a.length, 1);
  assert.equal(a[0].activity[0].status, "running");
  const b = upsertActivity(a, "m", { id: "t1", tool: "read", title: "r2", status: "completed" });
  assert.equal(b[0].activity.length, 1);
  assert.equal(b[0].activity[0].status, "completed");
  assert.equal(b[0].activity[0].title, "r2");
});

test("hasPendingBubble", () => {
  const list = [msg({ id: "x", role: "user", text: "hi", created: 1, pending: true })];
  assert.equal(hasPendingBubble(list as any), true);
  const list2 = [msg({ id: "x", role: "user", text: "hi", created: 1, pending: false })];
  assert.equal(hasPendingBubble(list2 as any), false);
});
test("replacePendingEcho swaps the optimistic command bubble in place", () => {
  const list = [
    { id: "local_1", role: "user" as const, text: "/echo hi", created: 1, activity: [], pending: true },
    { id: "m2", role: "assistant" as const, text: "ok", created: 2, activity: [] },
  ];
  const expanded = { id: "msg_9", role: "user" as const, text: "Repeat: hi", created: 3, activity: [] };
  const next = replacePendingEcho(list, "local_1", expanded);
  assert.equal(next.length, 2);
  assert.equal(next[0].id, "msg_9");
  assert.equal(next[0].text, "Repeat: hi");
  assert.equal(next[0].pending, false);
  assert.equal(next[1].id, "m2");
});

test("replacePendingEcho appends when the echo is gone", () => {
  const message = { id: "msg_9", role: "user" as const, text: "expanded", created: 1, activity: [] };
  assert.deepEqual(replacePendingEcho([], "local_x", message), [{ ...message, pending: false }]);
});

test("settlePendingEcho unblocks the composer after a session error or idle", () => {
  const list = [
    msg({ id: "a1", role: "assistant", text: "earlier" }),
    msg({ id: "local_9", role: "user", text: "/review", pending: true }),
  ];
  assert.equal(hasPendingBubble(list), true);
  const out = settlePendingEcho(list, "local_9");
  assert.equal(hasPendingBubble(out), false);
  assert.equal(out.length, 2);
  assert.equal(out[1].text, "/review");
  assert.equal(list[1].pending, true, "input is not mutated");
});

test("settlePendingEcho is a no-op without a matching pending echo", () => {
  const list = [msg({ id: "local_1", role: "user", text: "hi", pending: true })];
  assert.equal(settlePendingEcho(list, null), list);
  assert.equal(settlePendingEcho(list, "local_missing"), list);
  const settled = [msg({ id: "local_2", role: "user", text: "/x", pending: false })];
  assert.equal(settlePendingEcho(settled, "local_2"), settled);
});

test("dropPendingBubbles clears optimistic bubbles when leaving a chat", () => {
  const list = [
    msg({ id: "u1", role: "user", text: "done" }),
    msg({ id: "local_3", role: "user", text: "/review", pending: true }),
  ];
  const out = dropPendingBubbles(list);
  assert.deepEqual(out.map((m) => m.id), ["u1"]);
  assert.equal(hasPendingBubble(out), false);
  const clean = [msg({ id: "u1", role: "user", text: "done" })];
  assert.equal(dropPendingBubbles(clean), clean);
});

test("a late server message replaces a settled echo instead of duplicating it", () => {
  const settled = settlePendingEcho([msg({ id: "local_4", role: "user", text: "/review", pending: true })], "local_4");
  const tempId = echoToReplace({ pending: null, settled: "local_4" });
  assert.equal(tempId, "local_4");
  const out = replacePendingEcho(settled, tempId!, msg({ id: "srv_4", role: "user", text: "Review the diff" }));
  assert.deepEqual(out.map((m) => m.id), ["srv_4"]);
});

test("echoToReplace prefers the pending echo and is null after a reset", () => {
  assert.equal(echoToReplace({ pending: "local_new", settled: "local_old" }), "local_new");
  assert.equal(echoToReplace({ pending: null, settled: null }), null);
});
