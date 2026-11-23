export type ConnectionStatus = {
  installed: boolean;
  binary?: string;
  version?: string;
  connected: boolean;
  healthy: boolean;
  url?: string;
  startedByController: boolean;
  authRequired: boolean;
  error?: string;
  controllerVersion: string;
};

export type Project = { id: string; name: string; path: string; createdAt: number };

/** One folder in the Add project picker. Directories only — the endpoint never lists files. */
export type FsDirEntry = { name: string; path: string };

/** `GET /api/fs/dirs`: a read-only directory listing for the folder picker. */
export type FsDirListing = {
  /** Canonical absolute path that was listed. */
  path: string;
  /** Absolute parent directory, or null at the filesystem root. */
  parent: string | null;
  entries: FsDirEntry[];
  /** More than the server's cap of 500 folders: the list is the first 500 by name. */
  truncated: boolean;
};

export type RuntimeModel = {
  id: string;
  name?: string;
  status?: string;
  limit?: { context?: number; input?: number; output?: number };
  capabilities?: { reasoning?: boolean; attachment?: boolean; toolcall?: boolean };
};

export type RuntimeProvider = {
  id: string;
  name?: string;
  env?: string[];
  models?: Record<string, RuntimeModel>;
};

export type ProviderAuthMethod = { type?: string; label?: string };

export type ProvidersResponse = {
  providers?: {
    all?: RuntimeProvider[];
    default?: Record<string, string>;
    connected?: string[];
  };
  auth?: Record<string, ProviderAuthMethod[]>;
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

export type ActivityItem = {
  id: string;
  tool: string;
  title: string;
  status: "pending" | "running" | "completed" | "error";
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
  /** Paths this assistant step changed (OpenCode snapshot.files). */
  files?: string[];
};

export type DiffFileStatus = "added" | "modified" | "deleted";
export type DiffFile = {
  file: string;
  additions: number;
  deletions: number;
  patch: string;
  status: DiffFileStatus;
  binary: boolean;
  /** Server cut the patch (size cap) or OpenCode reported more. */
  truncated: boolean;
};

/** Browser-safe slash-command catalog entry. */
export type DeskCommand = { name: string; description: string };

/** Browser-safe projection of an OpenCode v2 model catalog entry. */
export type DeskModel = {
  key: string;
  id: string;
  providerID: string;
  name: string;
  status: string;
  context: number;
  released: number;
  enabled: boolean;
  tools: boolean;
  variantCount: number;
};

export type PermissionPrompt = {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
  kind: "permission" | "question";
};

export type DeskEvent =
  | { type: "connection"; status: ConnectionStatus }
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

/** A non-2xx controller response. `status` lets callers tell "gone" (404) from transient failures. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  return data;
}

function initialTokenPath(path: string): string {
  if (typeof window === "undefined") return path;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("token", token);
  return url.pathname + url.search;
}

export const api = {
  // The one-time URL token is exchanged for an HttpOnly cookie by the
  // controller. Subsequent fetches and EventSource inherit that cookie.
  bootstrap: () => request<Bootstrap>(initialTokenPath("/api/bootstrap")),
  connect: () => request<ConnectionStatus>("/api/connect", { method: "POST" }),
  disconnect: () => request<ConnectionStatus>("/api/disconnect", { method: "POST" }),
  addProject: (path: string, name?: string) =>
    request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ path, name }) }),
  removeProject: (id: string) => request("/api/projects/" + encodeURIComponent(id), { method: "DELETE" }),
  selectProject: (id: string) => request("/api/projects/" + encodeURIComponent(id), { method: "POST" }),
  /** Folder picker listing. No path = the controller's home directory. */
  fsDirs: (path?: string) =>
    request<FsDirListing>("/api/fs/dirs" + (path ? `?path=${encodeURIComponent(path)}` : "")),
  sessions: () => request<{ sessions: SessionSummary[]; groups: { label: string; items: SessionSummary[] }[]; archived: SessionSummary[] }>("/api/sessions"),
  createSession: () => request<{ session: SessionSummary }>("/api/sessions", { method: "POST", body: "{}" }),
  openSession: (id: string) =>
    request<{ session: SessionSummary; messages: ChatMessage[]; files: DiffFile[]; filesError?: string }>(
      "/api/sessions/" + encodeURIComponent(id),
    ),
  renameSession: (id: string, title: string) =>
    request("/api/sessions/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ title }) }),
  archiveSession: (id: string, archived: boolean) =>
    request("/api/sessions/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ archived }) }),
  deleteSession: (id: string) => request("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" }),
  send: (id: string, text: string, model?: string, agent?: string) =>
    request("/api/sessions/" + encodeURIComponent(id) + "/messages", {
      method: "POST",
      body: JSON.stringify({ text, model, agent }),
    }),
  abort: (id: string) => request("/api/sessions/" + encodeURIComponent(id) + "/abort", { method: "POST" }),
  retry: (id: string) => request("/api/sessions/" + encodeURIComponent(id) + "/retry", { method: "POST" }),
  /** One turn's changes: `from` is the user message that opened it; omitted = newest turn. */
  diff: (id: string, from?: string) =>
    request<{ files: DiffFile[] }>(
      "/api/sessions/" + encodeURIComponent(id) + "/diff" + (from ? "?from=" + encodeURIComponent(from) : ""),
    ),
  providers: () => request<ProvidersResponse>("/api/providers"),
  models: () => request<{ models: DeskModel[]; default: string }>("/api/models"),
  commands: () => request<{ commands: DeskCommand[] }>("/api/commands"),
  runCommand: (id: string, name: string, text: string) =>
    request("/api/sessions/" + encodeURIComponent(id) + "/command", {
      method: "POST",
      body: JSON.stringify({ name, text }),
    }),
  agents: () => request<unknown>("/api/agents"),
  mcp: () => request<unknown>("/api/mcp"),
  config: () => request<Record<string, unknown>>("/api/config"),
  setKey: (providerId: string, key: string) =>
    request("/api/providers/" + encodeURIComponent(providerId) + "/key", {
      method: "PUT",
      body: JSON.stringify({ key }),
    }),
  removeKey: (providerId: string) =>
    request("/api/providers/" + encodeURIComponent(providerId) + "/key", { method: "DELETE" }),
  addMcp: (name: string, config: Record<string, unknown>) =>
    request("/api/mcp", { method: "POST", body: JSON.stringify({ name, config }) }),
  mcpAction: (name: string, action: "connect" | "disconnect" | "disable") =>
    request(`/api/mcp/${encodeURIComponent(name)}/${action}`, { method: "POST" }),
  reply: (id: string, reply: "once" | "always" | "reject", extra?: { sessionId?: string; kind?: string; message?: string }) =>
    request("/api/permissions/" + encodeURIComponent(id) + "/reply", {
      method: "POST",
      body: JSON.stringify({ reply, ...extra }),
    }),
  vcs: () => request<{ branch?: string }>("/api/vcs"),
  files: () => request<unknown>("/api/files/status"),
  settings: (body: Record<string, unknown>) => request("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  reset: () => request("/api/settings/reset", { method: "POST" }),
  diagnostics: () => request<Record<string, unknown>>("/api/diagnostics"),
};

export type Bootstrap = {
  status: ConnectionStatus;
  projects: Project[];
  activeProjectId: string | null;
  appearance: "dark" | "light";
  connectionUrl: string;
  hasConnectionPassword: boolean;
  deskModel: string;
  sessions: SessionSummary[];
  /** False when the first page was full (there may be more) or listing failed: absence from `sessions` proves nothing. */
  sessionsComplete?: boolean;
  groups: { label: string; items: SessionSummary[] }[];
  model: string;
  controllerVersion: string;
};
