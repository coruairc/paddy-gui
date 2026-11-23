import type { ActivityItem, ChatMessage, SessionSummary } from "@/lib/desk/client";

export function appendDelta(list: ChatMessage[], messageId: string, delta: string): ChatMessage[] {
  if (!list.some((item) => item.id === messageId)) {
    return [...list, { id: messageId, role: "assistant", text: delta, created: Date.now(), activity: [] }];
  }
  return list.map((item) => (item.id === messageId ? { ...item, text: item.text + delta } : item));
}

export function upsertActivity(list: ChatMessage[], messageId: string, item: ActivityItem): ChatMessage[] {
  if (!list.some((message) => message.id === messageId)) {
    return [...list, { id: messageId, role: "assistant", text: "", created: Date.now(), activity: [item] }];
  }
  return list.map((message) => {
    if (message.id !== messageId) return message;
    const activity = message.activity.some((entry) => entry.id === item.id)
      ? message.activity.map((entry) => (entry.id === item.id ? item : entry))
      : [...message.activity, item];
    return { ...message, activity };
  });
}

export function upsertSession(list: SessionSummary[], session: SessionSummary): SessionSummary[] {
  return [...list.filter((item) => item.id !== session.id), session].sort((a, b) => b.updated - a.updated);
}

export function mergeMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const existingIndex = list.findIndex((item) => item.id === message.id);
  if (existingIndex !== -1) {
    return list.map((item) =>
      item.id === message.id
        ? {
            ...item,
            text: message.text || item.text,
            error: message.error ?? item.error,
            activity: message.activity.length ? message.activity : item.activity,
            pending: false,
          }
        : item,
    );
  }
  if (message.role === "user") {
    const pendingIndex = list.findIndex(
      (item) => item.pending && item.role === "user" && item.text === message.text && Math.abs(item.created - message.created) < 5000,
    );
    if (pendingIndex !== -1) {
      const next = [...list];
      next[pendingIndex] = { ...message, pending: false };
      return next;
    }
  }
  return [...list, message];
}

/**
 * Progress order for one tool step: a snapshot may confirm or advance a live
 * step, never move a finished one back to running.
 */
const ACTIVITY_RANK: Record<ActivityItem["status"], number> = {
  pending: 0,
  running: 1,
  completed: 2,
  error: 2,
};

/** Merge one message's steps by id, keeping snapshot order and live-only steps. */
function mergeActivity(live: ActivityItem[], snapshot: ActivityItem[]): ActivityItem[] {
  const liveById = new Map(live.map((item) => [item.id, item]));
  const merged = snapshot.map((item) => {
    const current = liveById.get(item.id);
    if (!current) return item;
    liveById.delete(item.id);
    return ACTIVITY_RANK[item.status] >= ACTIVITY_RANK[current.status] ? item : current;
  });
  return [...merged, ...live.filter((item) => liveById.has(item.id))];
}

/**
 * Fold a freshly fetched session snapshot into the live transcript after a
 * disconnect. The snapshot decides order, so a message missed in the gap lands
 * where it belongs rather than after later live ones. Messages match by id
 * (nothing doubles on a retried catch-up); a longer locally streamed body wins
 * over a snapshot taken before its last delta; a live tool step is never pushed
 * back to an older snapshot status; an unseen server user message still settles
 * a matching optimistic echo. Only live-only messages (system notes, an echo
 * with no server twin) are appended.
 */
export function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const liveById = new Map(list.map((item) => [item.id, item]));
  const merged = incoming.map((message) => {
    const current = liveById.get(message.id);
    if (current) {
      liveById.delete(message.id);
      return {
        ...current,
        text: message.text.length >= current.text.length ? message.text : current.text,
        error: message.error ?? current.error,
        activity: mergeActivity(current.activity, message.activity),
        files: message.files ?? current.files,
        pending: false,
      };
    }
    if (message.role === "user") {
      // Same reconciliation as mergeMessage: settle an optimistic echo in place.
      const echo = [...liveById.values()].find(
        (item) =>
          item.pending &&
          item.role === "user" &&
          item.text === message.text &&
          Math.abs(item.created - message.created) < 5000,
      );
      if (echo) liveById.delete(echo.id);
    }
    return { ...message, pending: false };
  });
  return [...merged, ...list.filter((item) => liveById.has(item.id))];
}

/**
 * A caught-up snapshot is still working only while a step is unfinished. A
 * missed idle event would leave `working` stuck otherwise; the next status,
 * delta or activity event re-asserts it if the turn actually continues.
 */
export function workingAfterCatchUp(list: ChatMessage[]): boolean {
  return list.some((message) =>
    message.activity.some((item) => item.status === "pending" || item.status === "running"),
  );
}

/**
 * Catch-up may only clear `working`, never set it. A live idle frame can land
 * during the openSession round trip; a snapshot taken before it may still show
 * a running step, and there is no later idle to undo a forced `true`.
 */
export function settleWorkingAfterCatchUp(liveWorking: boolean, snapshotWorking: boolean): boolean {
  return snapshotWorking ? liveWorking : false;
}

export function hasPendingBubble(list: ChatMessage[]): boolean {
  return list.some((m) => m.pending);
}
/**
 * Replace a command's optimistic echo with the server's expanded user message.
 * Commands expand `$ARGUMENTS`, so text equality cannot be used.
 */
export function replacePendingEcho(
  list: ChatMessage[],
  tempId: string,
  message: ChatMessage,
): ChatMessage[] {
  const index = list.findIndex((item) => item.id === tempId);
  if (index === -1) return [...list, { ...message, pending: false }];
  const next = [...list];
  next[index] = { ...message, pending: false };
  return next;
}

/**
 * Settle a command's optimistic echo without a server user message (session
 * error, idle, or chat/project switch). The bubble stays as a plain user line
 * so the transcript still shows what ran, but it no longer blocks sending.
 */
export function settlePendingEcho(list: ChatMessage[], tempId: string | null): ChatMessage[] {
  if (!tempId) return list;
  const index = list.findIndex((item) => item.id === tempId);
  if (index === -1 || !list[index].pending) return list;
  const next = [...list];
  next[index] = { ...list[index], pending: false };
  return next;
}

/** Drop every optimistic bubble, e.g. when leaving a chat whose replies will never arrive here. */
export function dropPendingBubbles(list: ChatMessage[]): ChatMessage[] {
  return list.some((item) => item.pending) ? list.filter((item) => !item.pending) : list;
}

/**
 * The prompt Retry/Edit may act on: the newest user message, as long as it is
 * not a pending echo — a local, unsent bubble has nothing server-side to resend
 * or rewrite. There is no older-message editing: OpenCode sessions are linear.
 */
export function retryableUserId(list: ChatMessage[]): string | null {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message.role !== "user") continue;
    return message.pending ? null : message.id;
  }
  return null;
}

export type CommandEchoRefs = { pending: string | null; settled: string | null };

/**
 * Which local echo (if any) a server user message should replace. A pending
 * echo wins; an echo settled by idle/error can still be replaced by a late
 * server message so the prompt is not shown twice.
 */
export function echoToReplace(refs: CommandEchoRefs): string | null {
  return refs.pending ?? refs.settled;
}

/** Collapsed "Show work · N" preview: everything when short, else the last few plus how many are hidden. */
export function activityPreview<T>(items: readonly T[], max = 4): { shown: T[]; hidden: number } {
  if (items.length <= max) return { shown: [...items], hidden: 0 };
  const shown = items.slice(-(max - 1));
  return { shown, hidden: items.length - shown.length };
}
