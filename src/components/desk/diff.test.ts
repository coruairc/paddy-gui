import test from "node:test";
import assert from "node:assert/strict";
import { capHunks, countLines, createTurnTracker, languageForPath, latestTurnFiles, mergeStepFiles, middleTruncate, parsePatch, turnFiles } from "./diff.ts";

// Real OpenCode v2.3.2 patch shape (diff --git, index, ---/+++ headers, context=3 hunks).
const PATCH = [
  "diff --git a/src/server/state.ts b/src/server/state.ts",
  "index ae12613..a5ce3f9 100644",
  "--- a/src/server/state.ts",
  "+++ b/src/server/state.ts",
  "@@ -30,4 +30,5 @@ export type AppState = {",
  "   connectionPassword: string;",
  "-  old: string;",
  "+  deskModel: string;",
  "+  extra: string;",
  "   ownedServerPassword: string;",
  "@@ -90,2 +91,2 @@",
  "-a",
  "+b",
  "\\ No newline at end of file",
  "",
].join("\n");

test("parsePatch numbers old and new lines and drops file headers", () => {
  const { hunks, binary } = parsePatch(PATCH);
  assert.equal(binary, false);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].header, "@@ -30,4 +30,5 @@ export type AppState = {");
  assert.deepEqual(hunks[0].lines, [
    { kind: "ctx", text: "  connectionPassword: string;", oldNo: 30, newNo: 30 },
    { kind: "del", text: "  old: string;", oldNo: 31 },
    { kind: "add", text: "  deskModel: string;", newNo: 31 },
    { kind: "add", text: "  extra: string;", newNo: 32 },
    { kind: "ctx", text: "  ownedServerPassword: string;", oldNo: 32, newNo: 33 },
  ]);
  assert.deepEqual(hunks[1].lines.map((line) => line.kind), ["del", "add", "meta"]);
  assert.equal(hunks[1].lines[0].oldNo, 90);
  assert.equal(hunks[1].lines[1].newNo, 91);
});

test("parsePatch keeps lines that look like headers inside a hunk", () => {
  const { hunks } = parsePatch("@@ -1,2 +1,2 @@\n---flag\n+++flag\n");
  assert.deepEqual(hunks[0].lines.map((line) => [line.kind, line.text]), [["del", "--flag"], ["add", "++flag"]]);
});

test("parsePatch detects binary patches and tolerates empty input", () => {
  assert.equal(parsePatch("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n").binary, true);
  assert.equal(parsePatch("diff --git a/x b/x\nGIT binary patch\nliteral 5\n").binary, true);
  assert.deepEqual(parsePatch(""), { hunks: [], binary: false });
});

test("capHunks hides rows past the limit and reports how many", () => {
  const big = "@@ -1,0 +1,500 @@\n" + Array.from({ length: 500 }, (_, i) => `+line ${i}`).join("\n");
  const { hunks } = parsePatch(big);
  assert.equal(countLines(hunks), 501);
  const capped = capHunks(hunks, 100);
  assert.equal(countLines(capped.hunks), 100);
  assert.equal(capped.hidden, 401);
  assert.equal(capHunks(hunks, 1000).hidden, 0);
  assert.equal(capHunks(hunks, 1000).hunks, hunks);
});

test("middleTruncate keeps the file name and both path ends", () => {
  assert.equal(middleTruncate("src/a.ts"), "src/a.ts");
  const long = "src/components/desk/very/deep/nested/folder/structure/app.tsx";
  const short = middleTruncate(long, 32);
  assert.equal(short.length, 32);
  assert.ok(short.endsWith("/app.tsx"));
  assert.ok(short.startsWith("src/"));
  assert.ok(short.includes("…"));
  const name = middleTruncate("a-really-long-generated-file-name-that-is-huge.min.js", 20);
  assert.equal(name.length, 20);
  assert.ok(name.endsWith(".min.js"));
});

test("languageForPath maps common extensions and names", () => {
  assert.equal(languageForPath("src/app.tsx"), "tsx");
  assert.equal(languageForPath("a/b/c.mjs"), "javascript");
  assert.equal(languageForPath("README.md"), "markdown");
  assert.equal(languageForPath("docker/Dockerfile"), "dockerfile");
  assert.equal(languageForPath("scripts/install.sh"), "shellscript");
  assert.equal(languageForPath(".env"), null);
  assert.equal(languageForPath("LICENSE"), null);
  assert.equal(languageForPath("x.unknownext"), null);
});

test("turnFiles groups assistant snapshot files per turn under the last assistant message", () => {
  const groups = turnFiles([
    { id: "msg_u1", role: "user" },
    { id: "msg_a1", role: "assistant", files: ["a.ts"] },
    { id: "msg_a2", role: "assistant", files: ["a.ts", "b.ts"] },
    { id: "msg_u2", role: "user" },
    { id: "msg_a3", role: "assistant" },
    { id: "msg_u3", role: "user" },
    { id: "msg_a4", role: "assistant", files: ["c.ts"] },
  ]);
  assert.deepEqual([...groups.entries()], [
    ["msg_a2", { from: "msg_u1", files: ["a.ts", "b.ts"], turn: 0 }],
    ["msg_a4", { from: "msg_u3", files: ["c.ts"], turn: 2 }],
  ]);
});

test("turnFiles only uses a live echo id for the newest turn", () => {
  const groups = turnFiles([
    { id: "inbox_1", role: "user" },
    { id: "msg_a1", role: "assistant", files: ["old.ts"] },
    { id: "tmp_2", role: "user", pending: true },
    { id: "msg_a2", role: "assistant", files: ["new.ts"] },
  ]);
  assert.deepEqual([...groups.entries()], [["msg_a2", { from: undefined, files: ["new.ts"], turn: 1 }]]);
});

test("mergeStepFiles adds new paths once and keeps identity when nothing changes", () => {
  const list = [{ id: "msg_a", files: ["a.ts"] }, { id: "msg_b" }];
  const next = mergeStepFiles(list, "msg_a", ["a.ts", "b.ts"]);
  assert.deepEqual(next[0].files, ["a.ts", "b.ts"]);
  assert.equal(next[1], list[1]);
  assert.equal(mergeStepFiles(next, "msg_a", ["b.ts"]), next);
  assert.equal(mergeStepFiles(list, "msg_missing", ["x.ts"]), list);
});

test("a live turn keeps its turn key as messages arrive and the echo is replaced", () => {
  const live = turnFiles([
    { id: "msg_u0", role: "user" },
    { id: "msg_a0", role: "assistant", files: ["x.ts"] },
    { id: "tmp_1", role: "user", pending: true },
    { id: "msg_a1", role: "assistant", files: ["a.ts"] },
  ]);
  const grown = turnFiles([
    { id: "msg_u0", role: "user" },
    { id: "msg_a0", role: "assistant", files: ["x.ts"] },
    { id: "msg_u1", role: "user" },
    { id: "msg_a1", role: "assistant", files: ["a.ts"] },
    { id: "msg_a2", role: "assistant", files: ["b.ts"] },
  ]);
  assert.equal(live.get("msg_a1")?.turn, 1);
  assert.equal(grown.has("msg_a1"), false, "the block moves to the newest assistant message");
  assert.deepEqual(grown.get("msg_a2"), { from: "msg_u1", files: ["a.ts", "b.ts"], turn: 1 });
});

test("two idle events for one turn end it once", () => {
  const tracker = createTurnTracker();
  assert.equal(tracker.idle(), false, "idle with no activity is not a turn end");
  tracker.busy();
  tracker.busy();
  assert.equal(tracker.idle(), true);
  assert.equal(tracker.idle(), false, "execution.succeeded + session.idle → one refresh");
  tracker.busy();
  tracker.reset();
  assert.equal(tracker.idle(), false, "switching chats forgets the old turn");
});

test("latestTurnFiles counts only the newest turn, from snapshot files", () => {
  const earlier = [
    { id: "msg_u1", role: "user" },
    { id: "msg_a1", role: "assistant", files: ["a.ts", "b.ts"] },
  ];
  assert.deepEqual(latestTurnFiles(earlier), ["a.ts", "b.ts"]);
  const next = [...earlier, { id: "tmp_2", role: "user", pending: true }, { id: "msg_a2", role: "assistant" }];
  assert.deepEqual(latestTurnFiles(next), [], "a new turn with no edits yet is not the previous turn's count");
  const live = [...next.slice(0, 3), { id: "msg_a2", role: "assistant", files: ["c.ts"] }];
  assert.deepEqual(latestTurnFiles(live), ["c.ts"]);
  assert.deepEqual(latestTurnFiles([]), []);
});
