import test from "node:test";
import assert from "node:assert/strict";
import { createRequestGate } from "./request-gate.ts";

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
