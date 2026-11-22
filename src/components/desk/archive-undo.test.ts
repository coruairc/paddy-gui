import test from "node:test";
import assert from "node:assert/strict";
import { ARCHIVE_UNDO_MS, RESUME_MIN_MS, createArchiveUndo, shouldReturnFocus } from "./archive-undo.ts";

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
    now: () => clock,
    failNext: (err: Error | null) => (fail = err),
  };
}

test("archive is immediate (archived: true) and Undo restores it (archived: false)", async () => {
  const t = setup();
  const notice = await t.undo.archive({ id: "ses_A", title: "Fix auth" });
  assert.deepEqual(t.calls, [["ses_A", true]]);
  assert.deepEqual(notice, { sessionId: "ses_A", title: "Fix auth", until: 1_000 + ARCHIVE_UNDO_MS, paused: false });
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
  assert.deepEqual(t.undo.notice, notice, "the user can try Undo again");
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

test("hover or focus pauses the countdown; it resumes with the time that was left", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.tick(5_000);
  assert.equal(t.undo.pause("hover")?.paused, true);
  t.tick(60_000);
  assert.equal(t.undo.expire(), false, "never expires while paused");
  const resumed = t.undo.resume("hover");
  assert.equal(resumed?.paused, false);
  assert.equal(resumed?.until, t.now() + ARCHIVE_UNDO_MS - 5_000);
  t.tick(ARCHIVE_UNDO_MS - 5_000 + 1);
  assert.equal(t.undo.expire(), true);
});

test("both holds must be released before the countdown runs again", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.undo.pause("hover");
  assert.equal(t.undo.pause("focus")?.paused, true, "a second hold keeps it held");
  assert.equal(t.undo.resume("hover")?.paused, true, "focus still inside");
  assert.equal(t.undo.resume("focus")?.paused, false);
});

test("Undo works while paused even long after the original deadline", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.undo.pause("focus");
  t.tick(ARCHIVE_UNDO_MS * 10);
  assert.equal(await t.undo.undo(), "ses_A");
  assert.deepEqual(t.calls.at(-1), ["ses_A", false]);
});

test("resuming with almost no time left still leaves RESUME_MIN_MS", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.tick(ARCHIVE_UNDO_MS - 100);
  t.undo.pause("hover");
  const resumed = t.undo.resume("hover");
  assert.equal(resumed?.until, t.now() + RESUME_MIN_MS);
});

test("hovering a notice that is already due does not revive it", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.tick(ARCHIVE_UNDO_MS + 10);
  assert.equal(t.undo.pause("hover")?.paused, false);
  assert.equal(t.undo.expire(), true);
});

test("a new archive starts running even if the last notice was left held", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.undo.pause("focus"); // e.g. Undo unmounted while focused and no blur arrived
  t.undo.dismiss();
  const next = await t.undo.archive({ id: "ses_B", title: "B" });
  assert.equal(next.paused, false);
  t.undo.pause("hover");
  assert.equal(t.undo.resume("hover")?.paused, false, "no stale focus hold from the old notice");
  t.tick(ARCHIVE_UNDO_MS + 1);
  assert.equal(t.undo.expire(), true);
});

test("a failed Undo brings the notice back with time to retry, still honouring holds", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  t.tick(ARCHIVE_UNDO_MS - 10);
  t.failNext(new Error("offline"));
  const pending = t.undo.undo();
  t.tick(500); // slow request ran past the original deadline
  await assert.rejects(pending, /offline/);
  assert.equal(t.undo.notice?.until, t.now() + RESUME_MIN_MS);
  assert.equal(t.undo.expire(), false);
  // Focus stayed on Undo: the restored notice is held.
  t.failNext(null);
  await t.undo.archive({ id: "ses_B", title: "B" });
  t.undo.pause("focus");
  t.failNext(new Error("offline"));
  const again = t.undo.undo();
  t.undo.resume("focus"); // left while the request was in flight
  await assert.rejects(again, /offline/);
  assert.equal(t.undo.notice?.paused, false, "the restored notice follows the released hold");
});

test("a failed Undo never replaces a notice for a chat archived meanwhile", async () => {
  let rejectRestore: (err: Error) => void = () => {};
  const undo = createArchiveUndo((_id, archived) =>
    archived ? Promise.resolve() : new Promise((_, reject) => (rejectRestore = reject)),
  );
  await undo.archive({ id: "ses_A", title: "A" });
  const pending = undo.undo();
  await undo.archive({ id: "ses_B", title: "B" }); // lands while A's restore is in flight
  rejectRestore(new Error("offline"));
  await assert.rejects(pending, /offline/);
  assert.equal(undo.notice?.sessionId, "ses_B");
});

test("forget drops the notice of a chat deleted elsewhere, also during a pending Undo", async () => {
  const t = setup();
  await t.undo.archive({ id: "ses_A", title: "A" });
  assert.equal(t.undo.forget("ses_B"), false);
  assert.equal(t.undo.notice?.sessionId, "ses_A");
  assert.equal(t.undo.forget("ses_A"), true);
  assert.equal(t.undo.notice, null);
  assert.equal(await t.undo.undo(), null, "no dead Undo");
  await t.undo.archive({ id: "ses_C", title: "C" });
  t.failNext(new Error("Session not found"));
  const pending = t.undo.undo();
  t.undo.forget("ses_C");
  await assert.rejects(pending, /not found/);
  assert.equal(t.undo.notice, null, "a 404 does not bring a deleted chat's Undo back");
});

test("focus returns to the composer from the notice or <body>, never stolen from elsewhere", () => {
  const body = { id: "body" } as unknown as Element;
  const other = { id: "sidebar-row" } as unknown as Element;
  assert.equal(shouldReturnFocus(other, body, true), true);
  assert.equal(shouldReturnFocus(body, body, false), true);
  assert.equal(shouldReturnFocus(null, body, false), true);
  assert.equal(shouldReturnFocus(other, body, false), false);
});
