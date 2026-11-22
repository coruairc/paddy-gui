/**
 * Translate OpenCode v2 events and messages into the GUI's own shapes.
 * The browser should not have to understand OpenCode part types.
 */

import type { OpenCodeMessage, OpenCodePart, OpenCodeSession } from "./opencode-client.ts";

export type ActivityStatus = "pending" | "running" | "completed" | "error";

export type ActivityItem = {
  id: string;
  tool: string;
  title: string;
  status: ActivityStatus;
  detail?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  created: number;
  error?: string;
  activity: ActivityItem[];
  pending?: boolean;
  /** Project-relative paths this assistant step changed (v2 `snapshot.files`). */
  files?: string[];
};

export type SessionSummary = {
  id: string;
  title: string;
  directory?: string;
  created: number;
  updated: number;
  archived: boolean;
  additions: number;
  deletions: number;
  files: number;
  model?: string;
};

export type DiffFileStatus = "added" | "modified" | "deleted";

export type DiffFile = {
  file: string;
  additions: number;
  deletions: number;
  patch: string;
  status: DiffFileStatus;
  /** Git reported a binary change: there are no text lines to show. */
  binary: boolean;
  /** The patch was cut at MAX_PATCH_CHARS (or OpenCode flagged `more`). */
  truncated: boolean;
};

/** Per-file patch cap so one huge generated file can't stall the browser. */
export const MAX_PATCH_CHARS = 400_000;

export type PermissionPrompt = {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
  kind: "permission" | "question";
};

export type GuiEvent =
  | { type: "message"; sessionId: string; message: ChatMessage }
  | { type: "text-delta"; sessionId: string; messageId: string; delta: string }
  | { type: "activity"; sessionId: string; messageId: string; item: ActivityItem }
  | { type: "permission"; prompt: PermissionPrompt }
  | { type: "permission-cleared"; id: string }
  | { type: "session"; session: SessionSummary }
  | { type: "session-deleted"; id: string }
  | { type: "status"; sessionId: string; state: "idle" | "working" | "retry" | "error"; detail?: string }
  | { type: "diff"; sessionId: string; files: DiffFile[] }
  | { type: "step-files"; sessionId: string; messageId: string; files: string[] }
  | { type: "model-selected"; sessionId: string; model: string }
  | { type: "commands-updated" }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "malformed"; message: string };

const TOOL_LABELS: Record<string, string> = {
  read: "Reading",
  write: "Editing",
  edit: "Editing",
  bash: "Running",
  shell: "Running",
  grep: "Searching",
  glob: "Searching",
  webfetch: "Fetching",
  task: "Working",
};

/** Tool calls started without final status yet, so success can keep their label. */
const toolCache = new Map<string, ActivityItem>();

export function toolTitle(tool: string, title?: string, input?: Record<string, unknown>): string {
  const verb = TOOL_LABELS[tool] ?? humanize(tool);
  if (title && !title.startsWith("{")) return title;
  const file = stringField(input, ["filePath", "file", "path"]);
  const command = stringField(input, ["command", "cmd"]);
  const query = stringField(input, ["pattern", "query"]);
  const target = file || command || query;
  return target ? `${verb} ${target}` : verb;
}

export function summarizeSession(session: OpenCodeSession): SessionSummary {
  const created = session.time?.created ?? Date.now();
  const updated = session.time?.updated ?? created;
  return {
    id: session.id,
    title: session.title?.trim() || "New chat",
    directory: session.location?.directory || session.directory || session.path,
    created,
    updated,
    archived: Boolean(session.time?.archived),
    additions: session.summary?.additions ?? 0,
    deletions: session.summary?.deletions ?? 0,
    files: session.summary?.files ?? 0,
    ...(session.model?.providerID && session.model?.id
      ? { model: `${session.model.providerID}/${session.model.id}` }
      : {}),
  };
}

export function toChatMessage(message: OpenCodeMessage): ChatMessage {
  const kind = message.type ?? message.role ?? "";
  const role = kind === "user" ? "user" : kind === "system" ? "system" : "assistant";
  const parts = Array.isArray(message.content) ? message.content : [];
  const text =
    role === "assistant"
      ? parts
          .filter((part) => part.type === "text" && part.text && !part.text.startsWith("<"))
          .map((part) => part.text ?? "")
          .join("")
          .trim()
      : (message.text ?? "").trim();
  const activity = parts.filter((part) => part.type === "tool").map(toActivity);
  const files = role === "assistant" ? stepFiles(message.snapshot?.files) : [];
  return {
    id: message.id,
    role,
    text,
    created: message.time?.created ?? Date.now(),
    error: messageError(message.error),
    activity,
    ...(files.length ? { files } : {}),
  };
}

/** Only user/assistant turns become chat bubbles; v2 emits bookkeeping messages too. */
export function toChatMessages(messages: OpenCodeMessage[]): ChatMessage[] {
  return messages
    .filter((message) => {
      const kind = message.type ?? message.role;
      return kind === "user" || kind === "assistant";
    })
    .map(toChatMessage);
}

export function toActivity(part: OpenCodePart): ActivityItem {
  const state = part.state ?? {};
  const tool = part.name || part.tool || "tool";
  const input = state.input && typeof state.input === "object" ? state.input : undefined;
  const item: ActivityItem = {
    id: part.id || tool,
    tool,
    title: toolTitle(tool, state.title, input),
    status: activityStatus(state.status),
    detail: stateError(state.error) || clip(contentText(state.content), 4000),
  };
  if (item.status === "running" || item.status === "pending") toolCache.set(item.id, item);
  return item;
}

export function normalizeEvent(raw: unknown): GuiEvent | null {
  const event = unwrap(raw);
  if (!event) return { type: "malformed", message: "Event was not an object" };
  const type = String(event.type ?? "");
  if (type === "malformed") return { type: "malformed", message: "OpenCode sent a malformed event" };
  const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const sessionId = text(data.sessionID);

  if (type === "server.connected") return null;

  if (type === "command.updated") return { type: "commands-updated" };

  if (type === "session.inbox.enqueued") {
    const item = (data.item && typeof data.item === "object" ? data.item : {}) as Record<string, unknown>;
    const payload = (item.payload && typeof item.payload === "object" ? item.payload : {}) as Record<string, unknown>;
    const inboxId = text(data.inboxID);
    const itemText = text(payload.text);
    if (!sessionId || !inboxId || item.type !== "user" || !itemText) return null;
    return {
      type: "message",
      sessionId,
      message: { id: inboxId, role: "user", text: itemText, created: Date.now(), activity: [] },
    };
  }

  if (type === "session.model.selected") {
    const model = (data.model && typeof data.model === "object" ? data.model : {}) as Record<string, unknown>;
    const id = text(model.id);
    const providerID = text(model.providerID);
    if (!sessionId || !id || !providerID) return null;
    return { type: "model-selected", sessionId, model: `${providerID}/${id}` };
  }

  if (type === "session.text.delta") {
    const messageId = text(data.assistantMessageID);
    const delta = text(data.delta);
    return sessionId && messageId && delta
      ? { type: "text-delta", sessionId, messageId, delta }
      : null;
  }
  if (type === "session.text.ended") {
    const messageId = text(data.assistantMessageID);
    if (!sessionId || !messageId) return null;
    return {
      type: "message",
      sessionId,
      message: {
        id: messageId,
        role: "assistant",
        text: text(data.text),
        created: numberField(data.time && (data.time as Record<string, unknown>).created) || Date.now(),
        activity: [],
      },
    };
  }
  if (type === "session.text.started" || type === "session.reasoning.delta") return null;

  if (type.startsWith("session.execution.")) {
    if (!sessionId) return null;
    if (type === "session.execution.started") {
      return { type: "status", sessionId, state: "working" };
    }
    if (type === "session.execution.failed") {
      return {
        type: "status",
        sessionId,
        state: "error",
        detail: stateError(data.error) || "Session failed",
      };
    }
    return { type: "status", sessionId, state: "idle" };
  }
  if (type === "session.step.ended") {
    const messageId = text(data.assistantMessageID);
    const files = stepFiles(data.files);
    return sessionId && messageId && files.length ? { type: "step-files", sessionId, messageId, files } : null;
  }

  if (type === "session.idle") {
    return sessionId ? { type: "status", sessionId, state: "idle" } : null;
  }

  if (type.startsWith("session.tool.")) {
    const messageId = text(data.assistantMessageID);
    const id = text(data.id);
    if (!sessionId || !messageId || !id) return null;
    if (type === "session.tool.input.started") {
      const item = toActivity({
        id,
        name: text(data.name),
        state: { status: "running" },
      });
      return { type: "activity", sessionId, messageId, item };
    }
    if (type === "session.tool.called") {
      const remembered = toolCache.get(id);
      const item = toActivity({
        id,
        name: text(data.name) || remembered?.tool,
        state: {
          status: "running",
          input: data.input && typeof data.input === "object" ? (data.input as Record<string, unknown>) : undefined,
        },
      });
      return { type: "activity", sessionId, messageId, item };
    }
    if (type === "session.tool.progress") return null;
    if (type === "session.tool.success") {
      const remembered = toolCache.get(id);
      toolCache.delete(id);
      return {
        type: "activity",
        sessionId,
        messageId,
        item: {
          id,
          tool: remembered?.tool ?? "tool",
          title: remembered?.title ?? humanize(remembered?.tool ?? "tool"),
          status: "completed",
          detail: clip(contentText(data.content), 4000),
        },
      };
    }
    if (type === "session.tool.failed") {
      const remembered = toolCache.get(id);
      toolCache.delete(id);
      return {
        type: "activity",
        sessionId,
        messageId,
        item: {
          id,
          tool: remembered?.tool ?? "tool",
          title: remembered?.title ?? humanize(remembered?.tool ?? "tool"),
          status: "error",
          detail: stateError(data.error),
        },
      };
    }
    return null;
  }

  if (type === "session.created") {
    const id = text(data.sessionID) || text(data.id);
    if (!id) return null;
    return {
      type: "session",
      session: summarizeSession({
        id,
        title: text(data.title),
        location: data.location as { directory?: string } | undefined,
        time: data.time as { created?: number; updated?: number } | undefined,
      }),
    };
  }
  if (type === "session.renamed" || type === "session.archived" || type === "session.unarchived") {
    const id = text(data.sessionID) || text(data.id);
    if (!id) return null;
    const now = Date.now();
    return {
      type: "session",
      session: {
        id,
        title: text(data.title) || "New chat",
        directory: (data.location as { directory?: string } | undefined)?.directory,
        created: now,
        updated: now,
        archived: type === "session.archived" ? true : type === "session.unarchived" ? false : Boolean(data.archived),
        additions: 0,
        deletions: 0,
        files: 0,
      },
    };
  }
  if (type === "session.deleted") {
    const id = text(data.sessionID) || text(data.id);
    return id ? { type: "session-deleted", id } : null;
  }
  if (type === "session.error") {
    return {
      type: "error",
      sessionId: sessionId || undefined,
      message: stateError(data.error) || "Session failed",
    };
  }

  if (type === "permission.asked") {
    const id = text(data.id);
    const permissionSessionId = text(data.sessionID);
    if (!id || !permissionSessionId) return null;
    const metadata = data.metadata && typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : {};
    const resources = Array.isArray(data.resources) ? data.resources.map(String) : [];
    return {
      type: "permission",
      prompt: {
        id,
        sessionId: permissionSessionId,
        kind: "permission",
        title: text(data.action) || "Permission",
        detail:
          text(data.message) ||
          stringField(metadata, ["command", "cmd"]) ||
          resources.join("\n") ||
          JSON.stringify(metadata).slice(0, 500),
      },
    };
  }
  if (type === "permission.replied") {
    const id = text(data.requestID) || text(data.permissionID) || text(data.id);
    return id ? { type: "permission-cleared", id } : null;
  }
  if (type === "form.created") {
    const id = text(data.id);
    const formSessionId = text(data.sessionID);
    if (!id || !formSessionId) return null;
    const fields = Array.isArray(data.fields) ? (data.fields as Record<string, unknown>[]) : [];
    const first = fields.find((field) => field.hidden !== true) ?? fields[0];
    return {
      type: "permission",
      prompt: {
        id,
        sessionId: formSessionId,
        kind: "question",
        title: text(data.title) || text(first?.title) || "Question",
        detail: text(first?.title) || text(first?.description) || "The agent is waiting for an answer.",
      },
    };
  }
  if (type === "form.replied" || type === "form.cancelled") {
    const id = text(data.formID) || text(data.id);
    return id ? { type: "permission-cleared", id } : null;
  }

  return null;
}

/** Relative paths only, de-duplicated, bounded: anything else in the payload is dropped. */
export function stepFiles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item || item.length > 1024 || out.includes(item)) continue;
    out.push(item);
    if (out.length >= 500) break;
  }
  return out;
}

const BINARY_PATCH = /^(?:Binary files .* differ|GIT binary patch)$/m;

/**
 * Validate one v2 `FileDiff.Info` (file, patch, additions, deletions, status,
 * more) at the boundary. v1-style `{before, after}` entries are still accepted.
 */
export function toDiffFile(raw: unknown): DiffFile {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const file = clipPath(String(item.file ?? item.path ?? "file"));
  const before = typeof item.before === "string" ? item.before : "";
  const after = typeof item.after === "string" ? item.after : "";
  const full = typeof item.patch === "string" ? item.patch : unified(before, after, file);
  const cut = full.length > MAX_PATCH_CHARS;
  const patch = cut ? full.slice(0, full.lastIndexOf("\n", MAX_PATCH_CHARS) + 1 || MAX_PATCH_CHARS) : full;
  return {
    file,
    additions: numberField(item.additions) || countPrefix(full, "+"),
    deletions: numberField(item.deletions) || countPrefix(full, "-"),
    patch,
    status: diffStatus(item.status, full, before, after),
    binary: BINARY_PATCH.test(full),
    truncated: cut || item.more === true,
  };
}

function diffStatus(raw: unknown, patch: string, before: string, after: string): DiffFileStatus {
  if (raw === "added" || raw === "modified" || raw === "deleted") return raw;
  if (/^new file mode /m.test(patch) || /^--- \/dev\/null$/m.test(patch) || (!before && after)) return "added";
  if (/^deleted file mode /m.test(patch) || /^\+\+\+ \/dev\/null$/m.test(patch) || (before && !after)) return "deleted";
  return "modified";
}

function clipPath(path: string): string {
  return path.length > 1024 ? path.slice(0, 1024) : path;
}

export function groupSessionsByDate(sessions: SessionSummary[], now = Date.now()): { label: string; items: SessionSummary[] }[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const yesterday = today - 86_400_000;
  const groups = new Map<string, SessionSummary[]>();
  const ordered = [...sessions].sort((a, b) => b.updated - a.updated);
  for (const session of ordered) {
    const label =
      session.updated >= today ? "Today" : session.updated >= yesterday ? "Yesterday" : formatDay(session.updated);
    const list = groups.get(label) ?? [];
    list.push(session);
    groups.set(label, list);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function unwrap(raw: unknown): { type?: string; data?: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.payload && typeof record.payload === "object") {
    return record.payload as { type?: string; data?: Record<string, unknown> };
  }
  return record as { type?: string; data?: Record<string, unknown> };
}

function activityStatus(status: string | undefined): ActivityStatus {
  if (status === "completed" || status === "error" || status === "running") return status;
  if (status === "streaming") return "running";
  return "pending";
}

function stateError(error: unknown): string | undefined {
  if (typeof error === "string") return error || undefined;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  return undefined;
}

function messageError(error: OpenCodeMessage["error"]): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message) return record.message;
  const nested = record.data;
  if (nested && typeof nested === "object") {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  return typeof record.name === "string" && record.name ? record.name : undefined;
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).text : undefined))
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("\n");
  return text || undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringField(input: Record<string, unknown> | undefined, keys: string[]): string {
  if (!input) return "";
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function humanize(tool: string): string {
  if (!tool) return "Working";
  return tool.replace(/[_-]+/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}\n…` : value;
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function countPrefix(patch: string, prefix: string): number {
  // Header lines (`--- a/x`, `+++ b/x`) are not changes.
  return patch.split("\n").filter((line) => line.startsWith(prefix) && !line.startsWith(prefix.repeat(3))).length;
}

/** Small line diff so the GUI can show changes without a second diff engine. */
export function unified(before: string, after: string, file: string): string {
  if (!before && !after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  const lines = [`--- ${file}`, `+++ ${file}`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (a[i] !== undefined) lines.push(` ${a[i]}`);
      continue;
    }
    if (a[i] !== undefined) lines.push(`-${a[i]}`);
    if (b[i] !== undefined) lines.push(`+${b[i]}`);
  }
  return lines.join("\n");
}
