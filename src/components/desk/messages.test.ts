import test from "node:test";
import assert from "node:assert/strict";
import {
  activityPreview,
  appendDelta,
  dropPendingBubbles,
  echoToReplace,
  hasPendingBubble,
  mergeMessage,
  mergeMessages,
  replacePendingEcho,
  settlePendingEcho,
  settleWorkingAfterCatchUp,
  upsertActivity,
  workingAfterCatchUp,
} from "./messages.ts";
import { catchUpProjectMatches, createReconnectScheduler, reconnectDelay } from "./event-stream.ts";

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

test("activityPreview lists everything up to 4 and otherwise says how many are hidden", () => {
  assert.deepEqual(activityPreview([1, 2, 3, 4]), { shown: [1, 2, 3, 4], hidden: 0 });
  assert.deepEqual(activityPreview([1, 2, 3, 4, 5]), { shown: [3, 4, 5], hidden: 2 });
  const nine = activityPreview([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(nine.shown.length + nine.hidden, 9, "shown + hidden always equals the count in the button");
  assert.deepEqual(activityPreview([]), { shown: [], hidden: 0 });
});

// ── Catch-up after an SSE disconnect ───────────────────────────────────────

test("mergeMessages adds the messages missed while disconnected exactly once", () => {
  const live = [msg({ id: "u1", role: "user", text: "hi", created: 1 })];
  const snapshot = [
    msg({ id: "u1", role: "user", text: "hi", created: 1 }),
    msg({ id: "a2", role: "assistant", text: "hello", created: 2 }),
  ];
  const once = mergeMessages(live, snapshot);
  assert.deepEqual(once.map((m) => m.id), ["u1", "a2"]);
  const twice = mergeMessages(once, snapshot);
  assert.deepEqual(twice.map((m) => m.id), ["u1", "a2"], "a retried catch-up must not duplicate");
  assert.equal(live.length, 1, "input is not mutated");
});

test("mergeMessages updates a known message but keeps a longer live body", () => {
  const live = [msg({ id: "a1", role: "assistant", text: "Hello there", created: 2 })];
  const stale = [msg({ id: "a1", role: "assistant", text: "Hello", created: 2 })];
  assert.equal(mergeMessages(live, stale)[0].text, "Hello there");
  const newer = [
    msg({
      id: "a1",
      role: "assistant",
      text: "Hello there, friend",
      created: 2,
      activity: [{ id: "t1", tool: "read", title: "r", status: "completed" }],
    }),
  ];
  const out = mergeMessages(live, newer);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Hello there, friend");
  assert.equal(out[0].activity[0].id, "t1");
});

test("mergeMessages settles an optimistic echo the snapshot already contains", () => {
  const live = [msg({ id: "local_1", role: "user", text: "hi", created: 1000, pending: true })];
  const snapshot = [msg({ id: "srv_1", role: "user", text: "hi", created: 1200 })];
  const out = mergeMessages(live, snapshot);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "srv_1");
  assert.equal(out[0].pending, false);
});

test("mergeMessages renders the transcript in snapshot order", () => {
  // The live view saw a3 (delivered before the gap closed); a2 was missed.
  const live = [
    msg({ id: "u1", role: "user", text: "hi", created: 1 }),
    msg({ id: "a3", role: "assistant", text: "done", created: 3 }),
  ];
  const snapshot = [
    msg({ id: "u1", role: "user", text: "hi", created: 1 }),
    msg({ id: "a2", role: "assistant", text: "working", created: 2 }),
    msg({ id: "a3", role: "assistant", text: "done", created: 3 }),
  ];
  assert.deepEqual(
    mergeMessages(live, snapshot).map((m) => m.id),
    ["u1", "a2", "a3"],
    "a missed message must land between the messages that were already shown",
  );
});

test("mergeMessages never regresses a finished step to a stale snapshot status", () => {
  const live = [
    msg({
      id: "a1",
      role: "assistant",
      text: "done",
      activity: [{ id: "t1", tool: "read", title: "read", status: "completed" }],
    }),
  ];
  const snapshot = [
    msg({
      id: "a1",
      role: "assistant",
      text: "done",
      activity: [{ id: "t1", tool: "read", title: "read", status: "running" }],
    }),
  ];
  const out = mergeMessages(live, snapshot);
  assert.equal(out[0].activity[0].status, "completed", "the live completion is newer than the snapshot");
});

test("mergeMessages takes a newer snapshot completion and keeps a live-only step", () => {
  const live = [
    msg({
      id: "a1",
      role: "assistant",
      activity: [
        { id: "t1", tool: "read", title: "read", status: "running" },
        { id: "t2", tool: "bash", title: "bash", status: "running" },
      ],
    }),
  ];
  const snapshot = [
    msg({
      id: "a1",
      role: "assistant",
      activity: [{ id: "t1", tool: "read", title: "read", status: "completed" }],
    }),
  ];
  const out = mergeMessages(live, snapshot);
  assert.deepEqual(
    out[0].activity.map((item) => [item.id, item.status]),
    [
      ["t1", "completed"],
      ["t2", "running"],
    ],
  );
});

test("mergeMessages appends live-only messages after the snapshot and drops settled echoes", () => {
  const live = [
    msg({ id: "sys_1", role: "system", text: "note" }),
    msg({ id: "local_1", role: "user", text: "hi", created: 1000, pending: true }),
  ];
  const snapshot = [msg({ id: "srv_1", role: "user", text: "hi", created: 1200 })];
  const out = mergeMessages(live, snapshot);
  assert.deepEqual(out.map((m) => m.id), ["srv_1", "sys_1"]);
  assert.equal(out[0].pending, false);
});

test("workingAfterCatchUp is false when every caught-up step has finished", () => {
  assert.equal(workingAfterCatchUp([]), false);
  assert.equal(
    workingAfterCatchUp([
      msg({
        id: "a1",
        role: "assistant",
        activity: [
          { id: "t1", tool: "read", title: "read", status: "completed" },
          { id: "t2", tool: "bash", title: "bash", status: "error" },
        ],
      }),
    ]),
    false,
  );
});

test("workingAfterCatchUp is true while any caught-up step is pending or running", () => {
  assert.equal(
    workingAfterCatchUp([
      msg({ id: "a1", role: "assistant", activity: [{ id: "t1", tool: "read", title: "read", status: "running" }] }),
    ]),
    true,
  );
  assert.equal(
    workingAfterCatchUp([
      msg({ id: "a1", role: "assistant", activity: [{ id: "t1", tool: "bash", title: "bash", status: "pending" }] }),
    ]),
    true,
  );
});

test("catch-up may clear working but never forces it true over a live idle", () => {
  // The lost-idle case: the snapshot says idle, so the stuck spinner clears.
  assert.equal(settleWorkingAfterCatchUp(true, false), false);
  // A live idle landed during the openSession round trip; a stale snapshot
  // that still shows running must not resurrect the spinner (no later idle).
  assert.equal(settleWorkingAfterCatchUp(false, true), false);
  assert.equal(settleWorkingAfterCatchUp(true, true), true);
  assert.equal(settleWorkingAfterCatchUp(false, false), false);
});

// ── Supervised stream reconnection ─────────────────────────────────────────

/** Deterministic timers for the reconnect scheduler, mirroring autonomous-drink.test.ts. */
function makeTimerClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id: unknown) => {
      timers.delete(id as number);
    },
    pending: () => timers.size,
    advance: (ms: number) => {
      const end = now + ms;
      for (;;) {
        let earliest: number | null = null;
        let earliestAt = Infinity;
        for (const [id, timer] of timers) {
          if (timer.at <= end && timer.at < earliestAt) {
            earliest = id;
            earliestAt = timer.at;
          }
        }
        if (earliest === null) break;
        const timer = timers.get(earliest)!;
        timers.delete(earliest);
        now = earliestAt;
        timer.fn();
      }
      now = end;
    },
  };
}

test("reconnectDelay doubles per attempt and is capped", () => {
  assert.equal(reconnectDelay(1), 1_000);
  assert.equal(reconnectDelay(2), 2_000);
  assert.equal(reconnectDelay(3), 4_000);
  assert.equal(reconnectDelay(4), 8_000);
  assert.equal(reconnectDelay(5), 15_000);
  assert.equal(reconnectDelay(50), 15_000);
  assert.equal(reconnectDelay(0), 1_000, "a bad attempt number still waits the base delay");
});

test("catchUpProjectMatches drops a session list for a project the user left", () => {
  assert.equal(catchUpProjectMatches("A", "A"), true);
  assert.equal(catchUpProjectMatches("A", "B"), false, "a project switch in flight wins");
  assert.equal(catchUpProjectMatches(null, null), true);
  assert.equal(catchUpProjectMatches(null, "A"), false);
});

test("a fatal close schedules one bounded recreation at a time", () => {
  const clock = makeTimerClock();
  let retries = 0;
  const scheduler = createReconnectScheduler(clock, () => {
    retries += 1;
  });
  scheduler.failed();
  scheduler.failed(); // repeated error events for the same dead stream
  assert.equal(clock.pending(), 1);
  assert.equal(scheduler.retrying(), true);
  clock.advance(999);
  assert.equal(retries, 0);
  clock.advance(1);
  assert.equal(retries, 1);
  assert.equal(scheduler.retrying(), false);
  scheduler.failed(); // the replacement failed too: the next delay is longer
  clock.advance(1_999);
  assert.equal(retries, 1);
  clock.advance(1);
  assert.equal(retries, 2);
});

test("a successful open reports the gap, cancels a pending retry and resets the backoff", () => {
  const clock = makeTimerClock();
  let retries = 0;
  const scheduler = createReconnectScheduler(clock, () => {
    retries += 1;
  });
  assert.equal(scheduler.opened(), false, "the first open has nothing to catch up");
  scheduler.failed();
  assert.equal(scheduler.opened(), true, "an open after a fatal close needs catch-up");
  assert.equal(scheduler.retrying(), false, "a late open cancels the scheduled recreation");
  scheduler.failed();
  clock.advance(999);
  assert.equal(retries, 0, "backoff restarted at the base delay");
  clock.advance(1);
  assert.equal(retries, 1);
});

test("a native retry marks a gap without scheduling a second stream", () => {
  const clock = makeTimerClock();
  const scheduler = createReconnectScheduler(clock, () => {});
  scheduler.interrupted();
  assert.equal(scheduler.retrying(), false);
  assert.equal(clock.pending(), 0);
  assert.equal(scheduler.opened(), true);
});

test("stop clears a pending recreation on unmount", () => {
  const clock = makeTimerClock();
  let retries = 0;
  const scheduler = createReconnectScheduler(clock, () => {
    retries += 1;
  });
  scheduler.failed();
  scheduler.stop();
  clock.advance(60_000);
  assert.equal(retries, 0);
  assert.equal(scheduler.retrying(), false);
});
