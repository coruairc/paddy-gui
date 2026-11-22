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
