/**
 * Translate OpenCode events and messages into the GUI's own shapes.
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
  role: "user" | "assistant";
  text: string;
  created: number;
  error?: string;
  activity: ActivityItem[];
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
};

export type DiffFile = {
  file: string;
  additions: number;
  deletions: number;
  patch: string;
};

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
    directory: session.directory || session.path,
    created,
    updated,
    archived: Boolean(session.time?.archived),
    additions: session.summary?.additions ?? 0,
    deletions: session.summary?.deletions ?? 0,
    files: session.summary?.files ?? 0,
  };
}

export function toChatMessage(message: OpenCodeMessage): ChatMessage {
  const role = message.info.role === "user" ? "user" : "assistant";
  const parts = message.parts ?? [];
  const text = parts
    .filter((part) => part.type === "text" && part.text && !part.text.startsWith("<"))
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  const activity = parts.filter((part) => part.type === "tool").map(toActivity);
  const error = message.info.error?.data?.message || message.info.error?.name;
  return {
    id: message.info.id,
    role,
    text,
    created: message.info.time?.created ?? Date.now(),
    error,
    activity,
  };
}

export function toActivity(part: OpenCodePart): ActivityItem {
  const status = (part.state?.status ?? "pending") as ActivityStatus;
  const tool = part.tool || "tool";
  return {
    id: part.id || part.callID || tool,
    tool,
    title: toolTitle(tool, part.state?.title, part.state?.input),
    status: status === "running" || status === "pending" || status === "completed" || status === "error" ? status : "pending",
    detail: part.state?.error || clip(part.state?.output, 4000),
  };
}

export function normalizeEvent(raw: unknown): GuiEvent | null {
  const event = unwrap(raw);
  if (!event) return { type: "malformed", message: "Event was not an object" };
  const type = String(event.type ?? "");
  const props = (event.properties ?? {}) as Record<string, unknown>;
  if (type === "malformed") return { type: "malformed", message: "OpenCode sent a malformed event" };
  if (type === "message.updated" || type === "message.part.updated") {
    if (type === "message.part.updated") {
      const part = props.part as OpenCodePart | undefined;
      const sessionId = part?.sessionID as string | undefined;
      const messageId = part?.messageID as string | undefined;
      if (!sessionId || !messageId || !part) return null;
      if (part.type === "text" && typeof props.delta === "string" && props.delta) {
        return { type: "text-delta", sessionId, messageId, delta: props.delta };
      }
      if (part.type === "tool") {
        return { type: "activity", sessionId, messageId, item: toActivity(part) };
      }
      if (part.type === "text" && part.text) {
        return {
          type: "message",
          sessionId,
          message: {
            id: messageId,
            role: "assistant",
            text: part.text,
            created: Date.now(),
            activity: [],
          },
        };
      }
      return null;
    }
    const info = props.info as OpenCodeMessage["info"] | undefined;
    if (!info?.id) return null;
    const sessionId = (info as { sessionID?: string }).sessionID;
    if (!sessionId) return null;
    return {
      type: "message",
      sessionId,
      message: toChatMessage({ info, parts: [] }),
    };
  }
  if (type === "permission.asked" || type === "permission.updated" || type === "permission.v2.asked") {
    const permission = (props.permission ? props : (props as { id?: string }).id ? props : props) as Record<string, unknown>;
    const id = String(permission.id ?? props.id ?? "");
    const sessionId = String(permission.sessionID ?? props.sessionID ?? "");
    if (!id || !sessionId) return null;
    const patterns = Array.isArray(permission.patterns) ? permission.patterns.map(String) : [];
    const metadata = permission.metadata && typeof permission.metadata === "object" ? (permission.metadata as Record<string, unknown>) : {};
    const command = stringField(metadata, ["command", "cmd"]) || patterns.join("\n");
    return {
      type: "permission",
      prompt: {
        id,
        sessionId,
        kind: "permission",
        title: String(permission.permission ?? permission.title ?? "Permission"),
        detail: command || JSON.stringify(metadata).slice(0, 500),
      },
    };
  }
  if (type === "permission.replied" || type === "permission.v2.replied") {
    const id = String(props.permissionID ?? props.requestID ?? props.id ?? "");
    return id ? { type: "permission-cleared", id } : null;
  }
  if (type === "question.asked" || type === "question.v2.asked") {
    const id = String(props.id ?? "");
    const sessionId = String(props.sessionID ?? "");
    const questions = Array.isArray(props.questions) ? props.questions : [];
    const first = questions[0] as { question?: string; header?: string } | undefined;
    if (!id || !sessionId) return null;
    return {
      type: "permission",
      prompt: {
        id,
        sessionId,
        kind: "question",
        title: first?.header || "Question",
        detail: first?.question || "The agent is waiting for an answer.",
      },
    };
  }
  if (type === "session.status") {
    const sessionId = String(props.sessionID ?? "");
    const status = props.status as { type?: string; message?: string } | undefined;
    const state = status?.type === "busy" ? "working" : status?.type === "retry" ? "retry" : "idle";
    return { type: "status", sessionId, state, detail: status?.message };
  }
  if (type === "session.idle") {
    return { type: "status", sessionId: String(props.sessionID ?? ""), state: "idle" };
  }
  if (type === "session.error") {
    const error = props.error as { data?: { message?: string }; name?: string } | undefined;
    return {
      type: "error",
      sessionId: props.sessionID ? String(props.sessionID) : undefined,
      message: error?.data?.message || error?.name || "Session failed",
    };
  }
  if (type === "session.diff") {
    const sessionId = String(props.sessionID ?? "");
    const files = Array.isArray(props.diff) ? props.diff.map(toDiffFile) : [];
    return { type: "diff", sessionId, files };
  }
  if (type === "session.created" || type === "session.updated") {
    const info = props.info as OpenCodeSession | undefined;
    return info?.id ? { type: "session", session: summarizeSession(info) } : null;
  }
  if (type === "session.deleted") {
    const info = props.info as OpenCodeSession | undefined;
    return info?.id ? { type: "session-deleted", id: info.id } : null;
  }
  return null;
}

export function toDiffFile(raw: unknown): DiffFile {
  const item = (raw ?? {}) as Record<string, unknown>;
  const file = String(item.file ?? item.path ?? "file");
  const before = typeof item.before === "string" ? item.before : "";
  const after = typeof item.after === "string" ? item.after : "";
  const patch = typeof item.patch === "string" ? item.patch : unified(before, after, file);
  return {
    file,
    additions: numberField(item.additions) || countPrefix(patch, "+"),
    deletions: numberField(item.deletions) || countPrefix(patch, "-"),
    patch,
  };
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

function unwrap(raw: unknown): { type?: string; properties?: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.payload && typeof record.payload === "object") {
    return record.payload as { type?: string; properties?: Record<string, unknown> };
  }
  return record as { type?: string; properties?: Record<string, unknown> };
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
  return patch.split("\n").filter((line) => line.startsWith(prefix) && !line.startsWith(prefix + prefix)).length;
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
