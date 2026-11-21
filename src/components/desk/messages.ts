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