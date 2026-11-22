import test from "node:test";
import assert from "node:assert/strict";
import { createRequestGate, runLatest } from "./request-gate.ts";

test("only the latest ticket is current", () => {
  const gate = createRequestGate();
  const a = gate.begin();
  assert.ok(gate.isCurrent(a));
  const b = gate.begin();
  assert.ok(!gate.isCurrent(a));
  assert.ok(gate.isCurrent(b));
});

test("invalidate drops every outstanding ticket", () => {
  const gate = createRequestGate();
  const a = gate.begin();
  gate.invalidate();
  assert.ok(!gate.isCurrent(a));
  const b = gate.begin();
  assert.ok(gate.isCurrent(b));
});

test("a late response from a switched-away project is ignored (simulated)", async () => {
  const gate = createRequestGate();
  const applied: string[] = [];
  let loading = false;
  async function load(project: string, delay: number) {
    const ticket = gate.begin();
    loading = true;
    await new Promise((r) => setTimeout(r, delay));
    if (!gate.isCurrent(ticket)) return;
    applied.push(project);
    loading = false;
  }
  const slowA = load("A", 20);
  gate.invalidate(); // project switch
  loading = false; // switch clears the flag
  await load("B", 1);
  await slowA;
  assert.deepEqual(applied, ["B"]);
  assert.equal(loading, false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Mirrors openSession: selected/opening flags, data applied, settle clears "opening". */
function openHarness() {
  const gate = createRequestGate();
  const state = { applied: [] as string[], errors: [] as string[], forgotten: [] as string[], opening: null as string | null };
  function open(id: string, response: Promise<string>) {
    state.opening = id;
    return runLatest(gate, () => response, {
      onData: (data) => state.applied.push(data),
      onError: (err) => state.errors.push(`${id}:${(err as Error).message}`),
      onAnyError: (err) => {
        if ((err as { status?: number }).status === 404) state.forgotten.push(id);
      },
      onSettled: () => {
        state.opening = null;
      },
    });
  }
  return { gate, state, open };
}

test("a completion from an older open is ignored once another chat is opened", async () => {
  const { state, open } = openHarness();
  const a = deferred<string>();
  const b = deferred<string>();
  const openA = open("A", a.promise);
  const openB = open("B", b.promise);
  b.resolve("B-data");
  assert.equal(await openB, true);
  assert.equal(state.opening, null);
  a.resolve("A-data"); // late
  assert.equal(await openA, false);
  assert.deepEqual(state.applied, ["B-data"]);
  assert.equal(state.opening, null);
});

test("A → B → A applies only the latest A, and the first A cannot clear the opening state", async () => {
  const { state, open } = openHarness();
  const a1 = deferred<string>();
  const b = deferred<string>();
  const a2 = deferred<string>();
  const first = open("A", a1.promise);
  const second = open("B", b.promise);
  const third = open("A", a2.promise);
  a1.resolve("A-first"); // same id, older ticket
  assert.equal(await first, false);
  assert.equal(state.opening, "A", "the stale A must not re-enable Send while the latest A is in flight");
  b.resolve("B-data");
  assert.equal(await second, false);
  assert.deepEqual(state.applied, []);
  a2.resolve("A-second");
  assert.equal(await third, true);
  assert.deepEqual(state.applied, ["A-second"]);
  assert.equal(state.opening, null);
});

test("invalidate (new chat, project switch, archive, delete) drops an in-flight open entirely", async () => {
  const { gate, state, open } = openHarness();
  const a = deferred<string>();
  const openA = open("A", a.promise);
  gate.invalidate();
  state.opening = null; // the handler resets it
  a.resolve("A-data");
  assert.equal(await openA, false);
  assert.deepEqual(state.applied, []);
  assert.equal(state.opening, null);
});

test("a stale failure shows no error, but a 404 still forgets that id", async () => {
  const { state, open } = openHarness();
  const a = deferred<string>();
  const b = deferred<string>();
  const openA = open("A", a.promise);
  const openB = open("B", b.promise);
  a.reject(Object.assign(new Error("Session not found"), { status: 404 }));
  assert.equal(await openA, false);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.forgotten, ["A"]);
  b.reject(Object.assign(new Error("down"), { status: 503 }));
  assert.equal(await openB, true);
  assert.deepEqual(state.errors, ["B:down"]);
  assert.deepEqual(state.forgotten, ["A"]);
  assert.equal(state.opening, null);
});
