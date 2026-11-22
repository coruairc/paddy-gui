/**
 * The inspector's latest-turn "Changes" state, owned by one session. Every
 * update names the session it is for, and `visibleChanges` only returns data
 * for the session that is open now — so after Archive, a delete, or a new
 * chat created by sending (ensureSession), another chat's files can never
 * render, whichever code path changed the chat and whether or not it reset.
 */
import type { DiffFile } from "@/lib/desk/client";

export type SessionChanges = {
  sessionId: string | null;
  files: DiffFile[];
  loading: boolean;
  error: string | null;
};

export type VisibleChanges = Pick<SessionChanges, "files" | "loading" | "error">;

export const EMPTY_CHANGES: SessionChanges = { sessionId: null, files: [], loading: false, error: null };

const NOTHING: VisibleChanges = { files: [], loading: false, error: null };

export function changesLoaded(sessionId: string, files: DiffFile[], error: string | null = null): SessionChanges {
  return { sessionId, files, loading: false, error };
}

/** Start a refresh for `sessionId`; keeps its current files while loading, drops another session's. */
export function changesLoading(state: SessionChanges, sessionId: string): SessionChanges {
  return { sessionId, files: state.sessionId === sessionId ? state.files : [], loading: true, error: null };
}

export function changesFailed(state: SessionChanges, sessionId: string, error: string): SessionChanges {
  return { sessionId, files: state.sessionId === sessionId ? state.files : [], loading: false, error };
}

/** End a refresh; a settle for a session that is no longer the owner changes nothing. */
export function changesSettled(state: SessionChanges, sessionId: string): SessionChanges {
  return state.sessionId === sessionId && state.loading ? { ...state, loading: false } : state;
}

/** What the inspector may show for the open session: nothing that belongs to another one. */
export function visibleChanges(state: SessionChanges, openSessionId: string | null): VisibleChanges {
  if (!openSessionId || state.sessionId !== openSessionId) return NOTHING;
  return { files: state.files, loading: state.loading, error: state.error };
}

/** What the Changes tab renders. */
export type ChangesView = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; files: DiffFile[] };

/**
 * The Changes tab's displayed state, computed from the raw session-tagged
 * state and the open chat. ChangesPanel calls this itself (it takes the raw
 * state, not files), so there is no props path that can render another
 * chat's files.
 */
export function changesPanelView(state: SessionChanges, openSessionId: string | null): ChangesView {
  const shown = visibleChanges(state, openSessionId);
  if (shown.error) return { kind: "error", message: shown.error };
  if (shown.loading && !shown.files.length) return { kind: "loading" };
  return { kind: "ready", files: shown.files };
}
