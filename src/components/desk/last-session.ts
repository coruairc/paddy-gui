/**
 * Remembered "last open chat" per project. Framework-free so it runs under
 * `node:test`. Every storage call is guarded: a locked-down or full
 * localStorage must never break bootstrap or the event stream.
 *
 * Only the per-project key `paddy:lastSession:<projectId>` is used. The old
 * global `paddy:lastSession` key could point at another project's chat, so it
 * is never read and is dropped when seen.
 */

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
};

const PREFIX = "paddy:lastSession";
/** Pre-v1.2 global key; read by nothing, cleaned up opportunistically. */
export const LEGACY_GLOBAL_KEY = PREFIX;

export function lastSessionKey(projectId: string): string {
  return `${PREFIX}:${projectId}`;
}

/** `window.localStorage`, or null when absent or when merely touching it throws. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function safeGet(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* quota or privacy mode: remembering is best-effort */
  }
}

function safeRemove(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function ownKeys(storage: StorageLike | null): string[] {
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === PREFIX || key?.startsWith(`${PREFIX}:`)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export function readLastSession(storage: StorageLike | null, projectId: string | null): string | null {
  if (!projectId) return null;
  return safeGet(storage, lastSessionKey(projectId)) || null;
}

/** Remember a session the server just confirmed (opened or created) for this project. */
export function rememberSession(storage: StorageLike | null, projectId: string | null, sessionId: string): void {
  if (!projectId || !sessionId) return;
  safeSet(storage, lastSessionKey(projectId), sessionId);
  safeRemove(storage, LEGACY_GLOBAL_KEY);
}

/** Forget one project's remembered chat (e.g. the project was removed). */
export function forgetProject(storage: StorageLike | null, projectId: string): void {
  safeRemove(storage, lastSessionKey(projectId));
}

/** Forget a session id wherever it is remembered (it 404'd or was deleted). */
export function forgetSession(storage: StorageLike | null, sessionId: string): void {
  for (const key of ownKeys(storage)) {
    if (safeGet(storage, key) === sessionId) safeRemove(storage, key);
  }
}

/** Reset: drop every `paddy:lastSession*` key, including the legacy global one. */
export function clearAllLastSessions(storage: StorageLike | null): void {
  for (const key of ownKeys(storage)) safeRemove(storage, key);
}

/**
 * Which chat to reopen on bootstrap. Only this project's key is considered.
 * When the server's session list for the project is non-empty and does not
 * contain the stored id, the id is dead or foreign: it is forgotten. An empty
 * list proves nothing (listing may have failed), so nothing is resumed but the
 * key is kept.
 */
export function pickResumeId(
  storage: StorageLike | null,
  projectId: string | null,
  sessions: readonly { id: string }[],
): string | null {
  safeRemove(storage, LEGACY_GLOBAL_KEY);
  const stored = readLastSession(storage, projectId);
  if (!stored || !projectId) return null;
  if (sessions.length === 0) return null;
  if (sessions.some((session) => session.id === stored)) return stored;
  forgetProject(storage, projectId);
  return null;
}

/** A failed open whose status says the session is gone. */
export function isMissingSession(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 404;
}

/**
 * What a send should target. Only a session the server has confirmed may be
 * reused; an id that is still being opened (unconfirmed) must not be reused
 * and must not be silently replaced by a brand-new chat either.
 */
export function sessionForSend(
  current: string | null,
  confirmed: string | null,
): { kind: "reuse"; id: string } | { kind: "create" } | { kind: "wait" } {
  if (!current) return { kind: "create" };
  if (current === confirmed) return { kind: "reuse", id: current };
  return { kind: "wait" };
}

export const OPENING_CHAT_MESSAGE = "Still opening that chat. Your message is kept; send it once it has loaded.";

/**
 * Gate for the composer, decided before anything is cleared. `wait` means a
 * chat is still being opened: the caller must keep the typed draft and not
 * create or reuse a session. `go` means ensureSession may run; the draft is
 * cleared only after it succeeds.
 */
export function planSend(input: {
  text: string;
  busy: boolean;
  current: string | null;
  confirmed: string | null;
}): { kind: "ignore" } | { kind: "wait"; message: string } | { kind: "go" } {
  if (!input.text.trim() || input.busy) return { kind: "ignore" };
  if (sessionForSend(input.current, input.confirmed).kind === "wait") {
    return { kind: "wait", message: OPENING_CHAT_MESSAGE };
  }
  return { kind: "go" };
}
