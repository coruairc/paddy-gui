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

export type ActivityItem = {
  id: string;
  tool: string;
  title: string;
  status: "pending" | "running" | "completed" | "error";
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

export type DiffFile = { file: string; additions: number; deletions: number; patch: string };

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
  | { type: "error"; message: string; sessionId?: string }
  | { type: "malformed"; message: string };

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
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  connect: () => request<ConnectionStatus>("/api/connect", { method: "POST" }),
  disconnect: () => request<ConnectionStatus>("/api/disconnect", { method: "POST" }),
  addProject: (path: string, name?: string) =>
    request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ path, name }) }),
  removeProject: (id: string) => request("/api/projects/" + encodeURIComponent(id), { method: "DELETE" }),
  selectProject: (id: string) => request("/api/projects/" + encodeURIComponent(id), { method: "POST" }),
  sessions: () => request<{ sessions: SessionSummary[]; groups: { label: string; items: SessionSummary[] }[]; archived: SessionSummary[] }>("/api/sessions"),
  createSession: () => request<{ session: SessionSummary }>("/api/sessions", { method: "POST", body: "{}" }),
  openSession: (id: string) =>
    request<{ session: SessionSummary; messages: ChatMessage[]; files: DiffFile[] }>("/api/sessions/" + encodeURIComponent(id)),
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
  diff: (id: string) => request<{ files: DiffFile[] }>("/api/sessions/" + encodeURIComponent(id) + "/diff"),
  providers: () => request<{ providers: unknown; auth: unknown }>("/api/providers"),
  agents: () => request<unknown>("/api/agents"),
  mcp: () => request<unknown>("/api/mcp"),
  config: () => request<Record<string, unknown>>("/api/config"),
  patchConfig: (patch: Record<string, unknown>, scope?: "project") =>
    request("/api/config", { method: "PATCH", body: JSON.stringify({ patch, scope }) }),
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
  sessions: SessionSummary[];
  groups: { label: string; items: SessionSummary[] }[];
  model: string;
  controllerVersion: string;
};
