/**
 * Archive with undo. OpenCode v2.3.2 `PATCH /api/session/{id}` takes
 * `{ archived: boolean }` ("Archive the session with true or restore it with
 * false. Repeating the current state is a no-op."), proxied by the desk's
 * `PATCH /api/sessions/:id`. So archive happens immediately and Undo is a real
 * restore (`archived: false`) — nothing is deferred, so there is nothing to
 * flush on unload or on the next action.
 *
 * The Undo window is the only way back from an archive in the UI, so it must be
 * adjustable (WCAG 2.2.1): it pauses while the notice is hovered or has focus,
 * and on resume gets at least RESUME_MIN_MS so leaving it never makes it vanish.
 */
export const ARCHIVE_UNDO_MS = 8000;
export const RESUME_MIN_MS = 3000;

/** While `paused`, `until` is stale; the remaining time is held inside the controller. */
export type ArchiveNotice = { sessionId: string; title: string; until: number; paused: boolean };

/** Why the countdown is held. Both may apply at once; it runs again only when neither does. */
export type NoticeHold = "hover" | "focus";

export type ArchiveUndo = {
  readonly notice: ArchiveNotice | null;
  /** Archive now; on success the notice offers Undo until `until`. A newer archive replaces it. */
  archive(session: { id: string; title: string }): Promise<ArchiveNotice>;
  /**
   * Restore the noticed chat. Resolves to its id, or null when there is nothing
   * (left) to undo — expired, dismissed, or already undone (double-click safe).
   * On failure the notice comes back (with at least RESUME_MIN_MS left) so the
   * user can try again — unless the chat was forgotten meanwhile.
   */
  undo(): Promise<string | null>;
  dismiss(): void;
  /** Drop the notice once its time is up; true if it was dropped. Never while paused. */
  expire(): boolean;
  /** Hold the countdown (pointer over the notice, or focus inside it). Returns the current notice. */
  pause(hold: NoticeHold): ArchiveNotice | null;
  /** Release a hold; once none is left the countdown resumes. Returns the current notice. */
  resume(hold: NoticeHold): ArchiveNotice | null;
  /** The chat was deleted elsewhere: drop its notice, and never bring it back from a pending Undo. */
  forget(sessionId: string): boolean;
};

export function createArchiveUndo(
  setArchived: (id: string, archived: boolean) => Promise<unknown>,
  now: () => number = Date.now,
  ttlMs = ARCHIVE_UNDO_MS,
): ArchiveUndo {
  let notice: ArchiveNotice | null = null;
  /** Time left when the countdown was paused. */
  let left = 0;
  const holds = new Set<NoticeHold>();
  const gone = new Set<string>();

  /** Make the notice's paused state match the holds. */
  function sync() {
    if (!notice) return;
    const t = now();
    if (holds.size > 0 && !notice.paused) {
      // Already due (timer not fired yet): let it expire rather than revive it.
      if (t >= notice.until) return;
      left = notice.until - t;
      notice = { ...notice, paused: true };
    } else if (holds.size === 0 && notice.paused) {
      notice = { ...notice, paused: false, until: t + Math.max(left, RESUME_MIN_MS) };
    }
  }

  return {
    get notice() {
      return notice;
    },
    async archive(session) {
      await setArchived(session.id, true);
      // A new notice starts running: the Archive click came from outside the notice.
      holds.clear();
      notice = { sessionId: session.id, title: session.title, until: now() + ttlMs, paused: false };
      return notice;
    },
    async undo() {
      const current = notice;
      notice = null;
      if (!current || (!current.paused && now() > current.until)) return null;
      try {
        await setArchived(current.sessionId, false);
      } catch (err) {
        // Only bring it back if nothing newer took its place and the chat still exists.
        if (!notice && !gone.has(current.sessionId)) {
          notice = current.paused ? current : { ...current, until: Math.max(current.until, now() + RESUME_MIN_MS) };
          sync();
        }
        throw err;
      }
      return current.sessionId;
    },
    dismiss() {
      notice = null;
    },
    expire() {
      if (!notice || notice.paused || now() < notice.until) return false;
      notice = null;
      return true;
    },
    pause(hold) {
      holds.add(hold);
      sync();
      return notice;
    },
    resume(hold) {
      holds.delete(hold);
      sync();
      return notice;
    },
    forget(sessionId) {
      gone.add(sessionId);
      if (notice?.sessionId !== sessionId) return false;
      notice = null;
      return true;
    },
  };
}

/**
 * Where focus goes when the notice closes (Undo, Dismiss, Escape, timeout,
 * deleted elsewhere): to the composer if focus was inside the notice or has
 * already dropped to <body> — never left on <body>, never stolen from elsewhere.
 */
export function shouldReturnFocus(active: Element | null, body: Element | null, inNotice: boolean): boolean {
  return inNotice || !active || active === body;
}
