import test from "node:test";
import assert from "node:assert/strict";
import { appendDelta, hasPendingBubble, mergeMessage, upsertActivity } from "./messages.ts";

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