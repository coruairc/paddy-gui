import test from "node:test";
import assert from "node:assert/strict";
import { ARCHIVE_UNDO_MS, createArchiveUndo } from "./archive-undo.ts";

function setup() {
  const calls: Array<[string, boolean]> = [];
  let clock = 1_000;
  let fail: Error | null = null;
  const undo = createArchiveUndo(
    async (id, archived) => {
      calls.push([id, archived]);
      if (fail) throw fail;
    },
    () => clock,
  );
  return {
    undo,
    calls,
    tick: (ms: number) => (clock += ms),
    failNext: (err: Error | null) => (fail = err),
  };
}

test("archive is immediate (archived: true) and Undo restores it (archived: false)", async () => {
  const t = setup();
  const notice = await t.undo.archive({ id: "ses_A", title: "Fix auth" });
  assert.deepEqual(t.calls, [["ses_A", true]]);
  assert.deepEqual(notice, { sessionId: "ses_A", title: "Fix auth", until: 1_000 + ARCHIVE_UNDO_MS });
  assert.equal(t.undo.notice, notice);
  t.tick(2_000);
  assert.equal(await t.undo.undo(), "ses_A");
  assert.deepEqual(t.calls, [["ses_A", true], ["ses_A", false]]);
  assert.equal(t.undo.notice, null);
});

test("Undo twice (double click) restores once", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  const [first, second] = await Promise.all([t.undo.undo(), t.undo.undo()]);
  assert.deepEqual([first, second], ["ses_A", null]);
  assert.equal(t.calls.filter(([, archived]) => !archived).length, 1);
});

test("a failed archive shows no notice; a failed undo brings the notice back", async () => {
  const t = setup();
  t.failNext(new Error("offline"));
  await assert.rejects(t.undo.archive({ id: "ses_A", title: "A" }), /offline/);
  assert.equal(t.undo.notice, null);
  t.failNext(null);
  const notice = await t.undo.archive({ id: "ses_A", title: "A" });
  t.failNext(new Error("offline"));
  await assert.rejects(t.undo.undo(), /offline/);
  assert.equal(t.undo.notice, notice, "the user can try Undo again");
  t.failNext(null);
  assert.equal(await t.undo.undo(), "ses_A");
});

test("the notice expires, and Undo after expiry or dismiss does nothing", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.tick(ARCHIVE_UNDO_MS - 1);
  assert.equal(t.undo.expire(), false);
  t.tick(2);
  assert.equal(t.undo.expire(), true);
  assert.equal(t.undo.notice, null);
  assert.equal(await t.undo.undo(), null);
  await t.undo.archive({ id: "ses_B", title: "B" });
  t.undo.dismiss();
  assert.equal(await t.undo.undo(), null);
  assert.deepEqual(t.calls, [["ses_A", true], ["ses_B", true]], "no restore call after expiry or dismiss");
});

test("Undo past the deadline does nothing even if the expiry timer has not fired yet", async () => {
  // A throttled background tab can run the click before the timeout.
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.tick(ARCHIVE_UNDO_MS + 1);
  assert.equal(await t.undo.undo(), null);
  assert.deepEqual(t.calls, [["ses_A", true]]);
});

test("archiving another chat replaces the notice; Undo restores the newest", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  await t.undo.archive({ id: "ses_B", title: "B" });
  assert.equal(t.undo.notice?.sessionId, "ses_B");
  assert.equal(await t.undo.undo(), "ses_B");
  assert.deepEqual(t.calls.at(-1), ["ses_B", false]);
});
