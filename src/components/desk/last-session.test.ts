import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_GLOBAL_KEY,
  clearAllLastSessions,
  forgetProject,
  forgetSession,
  isMissingSession,
  lastSessionKey,
  OPENING_CHAT_MESSAGE,
  pickResumeId,
  planSend,
  readLastSession,
  rememberSession,
  sessionForSend,
  type StorageLike,
} from "./last-session.ts";

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    dump: () => Object.fromEntries(map),
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
  get length(): number {
    throw new Error("SecurityError");
  },
  key: () => {
    throw new Error("SecurityError");
  },
};

test("resume uses only the per-project key, never the global fallback", () => {
  const storage = memoryStorage({ [LEGACY_GLOBAL_KEY]: "ses_other_project" });
  const sessions = [{ id: "ses_other_project" }, { id: "ses_a" }];
  assert.equal(pickResumeId(storage, "prj_a", sessions), null);
  // The cross-project global key is dropped on sight.
  assert.equal(storage.getItem(LEGACY_GLOBAL_KEY), null);
});

test("resume returns the stored id when the project's session list contains it", () => {
  const storage = memoryStorage({ [lastSessionKey("prj_a")]: "ses_a" });
  assert.equal(pickResumeId(storage, "prj_a", [{ id: "ses_x" }, { id: "ses_a" }]), "ses_a");
  assert.equal(storage.getItem(lastSessionKey("prj_a")), "ses_a");
});

test("a stale or foreign stored id is forgotten, not resumed", () => {
  const storage = memoryStorage({ [lastSessionKey("prj_a")]: "ses_deleted", [lastSessionKey("prj_b")]: "ses_b" });
  assert.equal(pickResumeId(storage, "prj_a", [{ id: "ses_a" }]), null);
  assert.equal(storage.getItem(lastSessionKey("prj_a")), null);
  assert.equal(storage.getItem(lastSessionKey("prj_b")), "ses_b");
});

test("an empty session list resumes nothing but keeps the key (listing may have failed)", () => {
  const storage = memoryStorage({ [lastSessionKey("prj_a")]: "ses_a" });
  assert.equal(pickResumeId(storage, "prj_a", []), null);
  assert.equal(storage.getItem(lastSessionKey("prj_a")), "ses_a");
});

test("no project means no resume", () => {
  const storage = memoryStorage({ [lastSessionKey("prj_a")]: "ses_a" });
  assert.equal(pickResumeId(storage, null, [{ id: "ses_a" }]), null);
  assert.equal(readLastSession(storage, null), null);
});

test("remember writes only the per-project key and drops the legacy global", () => {
  const storage = memoryStorage({ [LEGACY_GLOBAL_KEY]: "ses_old" });
  rememberSession(storage, "prj_a", "ses_a");
  assert.deepEqual(storage.dump(), { [lastSessionKey("prj_a")]: "ses_a" });
  rememberSession(storage, null, "ses_b");
  rememberSession(storage, "prj_a", "");
  assert.deepEqual(storage.dump(), { [lastSessionKey("prj_a")]: "ses_a" });
});

test("forgetSession removes a 404'd id from every project key, and only that id", () => {
  const storage = memoryStorage({
    [lastSessionKey("prj_a")]: "ses_dead",
    [lastSessionKey("prj_b")]: "ses_dead",
    [lastSessionKey("prj_c")]: "ses_live",
    unrelated: "ses_dead",
  });
  forgetSession(storage, "ses_dead");
  assert.deepEqual(storage.dump(), { [lastSessionKey("prj_c")]: "ses_live", unrelated: "ses_dead" });
});

test("forgetProject removes one project's key", () => {
  const storage = memoryStorage({ [lastSessionKey("prj_a")]: "ses_a", [lastSessionKey("prj_b")]: "ses_b" });
  forgetProject(storage, "prj_a");
  assert.deepEqual(storage.dump(), { [lastSessionKey("prj_b")]: "ses_b" });
});

test("reset clears every paddy:lastSession* key and leaves other keys alone", () => {
  const storage = memoryStorage({
    [LEGACY_GLOBAL_KEY]: "ses_g",
    [lastSessionKey("prj_a")]: "ses_a",
    [lastSessionKey("prj_b")]: "ses_b",
    "paddy:panel:right": "420",
  });
  clearAllLastSessions(storage);
  assert.deepEqual(storage.dump(), { "paddy:panel:right": "420" });
});

test("every helper survives a storage that throws on every call", () => {
  assert.equal(readLastSession(throwing, "prj_a"), null);
  assert.equal(pickResumeId(throwing, "prj_a", [{ id: "ses_a" }]), null);
  assert.doesNotThrow(() => rememberSession(throwing, "prj_a", "ses_a"));
  assert.doesNotThrow(() => forgetSession(throwing, "ses_a"));
  assert.doesNotThrow(() => forgetProject(throwing, "prj_a"));
  assert.doesNotThrow(() => clearAllLastSessions(throwing));
  assert.equal(pickResumeId(null, "prj_a", [{ id: "ses_a" }]), null);
});

test("only a 404 counts as a missing session", () => {
  assert.equal(isMissingSession(Object.assign(new Error("Session not found"), { status: 404 })), true);
  assert.equal(isMissingSession(Object.assign(new Error("Select a project first"), { status: 400 })), false);
  assert.equal(isMissingSession(Object.assign(new Error("down"), { status: 503 })), false);
  assert.equal(isMissingSession(new Error("network")), false);
  assert.equal(isMissingSession(null), false);
});

test("sends reuse only a confirmed session; an unconfirmed id is never reused or replaced", () => {
  assert.deepEqual(sessionForSend(null, null), { kind: "create" });
  assert.deepEqual(sessionForSend("ses_a", "ses_a"), { kind: "reuse", id: "ses_a" });
  // Resume still in flight (or failed without being cleared): do not reuse the id.
  assert.deepEqual(sessionForSend("ses_a", null), { kind: "wait" });
  assert.deepEqual(sessionForSend("ses_b", "ses_a"), { kind: "wait" });
});

test("planSend keeps the draft while a chat is still opening", () => {
  // Bootstrap resume or a sidebar click selected ses_a, the server has not confirmed it yet.
  assert.deepEqual(planSend({ text: "continue", busy: false, current: "ses_a", confirmed: null }), {
    kind: "wait",
    message: OPENING_CHAT_MESSAGE,
  });
  assert.deepEqual(planSend({ text: "continue", busy: false, current: "ses_a", confirmed: "ses_a" }), { kind: "go" });
  assert.deepEqual(planSend({ text: "continue", busy: false, current: null, confirmed: null }), { kind: "go" });
  assert.deepEqual(planSend({ text: "   ", busy: false, current: "ses_a", confirmed: "ses_a" }), { kind: "ignore" });
  assert.deepEqual(planSend({ text: "hi", busy: true, current: "ses_a", confirmed: "ses_a" }), { kind: "ignore" });
});
