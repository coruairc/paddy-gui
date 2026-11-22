/**
 * Archive with undo. OpenCode v2.3.2 `PATCH /api/session/{id}` takes
 * `{ archived: boolean }` ("Archive the session with true or restore it with
 * false. Repeating the current state is a no-op."), proxied by the desk's
 * `PATCH /api/sessions/:id`. So archive happens immediately and Undo is a real
 * restore (`archived: false`) — nothing is deferred, so there is nothing to
 * flush on unload or on the next action.
 */
export const ARCHIVE_UNDO_MS = 8000;

export type ArchiveNotice = { sessionId: string; title: string; until: number };

export type ArchiveUndo = {
  readonly notice: ArchiveNotice | null;
  /** Archive now; on success the notice offers Undo until `until`. A newer archive replaces it. */
  archive(session: { id: string; title: string }): Promise<ArchiveNotice>;
  /**
   * Restore the noticed chat. Resolves to its id, or null when there is nothing
   * (left) to undo — expired, dismissed, or already undone (double-click safe).
   * On failure the notice comes back so the user can try again.
   */
  undo(): Promise<string | null>;
  dismiss(): void;
  /** Drop the notice once its time is up; true if it was dropped. */
  expire(): boolean;
};

export function createArchiveUndo(
  setArchived: (id: string, archived: boolean) => Promise<unknown>,
  now: () => number = Date.now,
  ttlMs = ARCHIVE_UNDO_MS,
): ArchiveUndo {
  let notice: ArchiveNotice | null = null;
  return {
    get notice() {
      return notice;
    },
    async archive(session) {
      await setArchived(session.id, true);
      notice = { sessionId: session.id, title: session.title, until: now() + ttlMs };
      return notice;
    },
    async undo() {
      const current = notice;
      notice = null;
      if (!current || now() > current.until) return null;
      try {
        await setArchived(current.sessionId, false);
      } catch (err) {
        // Only bring it back if nothing newer took its place meanwhile.
        notice ??= current;
        throw err;
      }
      return current.sessionId;
    },
    dismiss() {
      notice = null;
    },
    expire() {
      if (!notice || now() < notice.until) return false;
      notice = null;
      return true;
    },
  };
}
