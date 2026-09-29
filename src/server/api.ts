/**
 * HTTP API for the browser. Every workspace path is checked against the
 * project allowlist. Provider keys are forwarded to OpenCode and never echoed.
 */

import { OpenCodeError } from "./opencode-client.ts";
import {
  groupSessionsByDate,
  summarizeSession,
  toChatMessage,
  toDiffFile,
  type DiffFile,
  type SessionSummary,
} from "./normalize.ts";
import { redactSecrets, safeJson, validateWorkspacePath } from "./security.ts";
import { newId, publicState } from "./state.ts";
import { CONTROLLER_VERSION, type ControllerRuntime } from "./runtime.ts";

export type ApiResult = { status: number; body: unknown; stream?: ReadableStream<Uint8Array> };

const encoder = new TextEncoder();

export async function handleApi(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const route = path.startsWith("/api") ? path.slice(4) || "/" : path;
  try {
    if (request.method === "GET" && route === "/events") return events(runtime);
    if (request.method === "GET" && route === "/status") return json(200, await ensureStatus(runtime));
    if (request.method === "POST" && route === "/connect") return json(200, await runtime.connect());
    if (request.method === "POST" && route === "/disconnect") return json(200, await runtime.disconnect());
    if (request.method === "GET" && route === "/bootstrap") return json(200, await bootstrap(runtime));
    if (request.method === "GET" && route === "/diagnostics") return json(200, diagnostics(runtime));
    if (request.method === "POST" && route === "/settings/reset") return reset(runtime);
    if (request.method === "GET" && route === "/projects") return json(200, { projects: runtime.state.projects, activeProjectId: runtime.state.activeProjectId });
    if (request.method === "POST" && route === "/projects") return await addProject(runtime, request);
    const project = route.match(/^\/projects\/([^/]+)$/);
    if (project && request.method === "DELETE") return removeProject(runtime, decodeURIComponent(project[1]));
    if (project && request.method === "POST") return selectProject(runtime, decodeURIComponent(project[1]));
    if (request.method === "PATCH" && route === "/settings") return updateSettings(runtime, request);
    if (request.method === "GET" && route === "/sessions") return await listSessions(runtime);
    if (request.method === "POST" && route === "/sessions") return await createSession(runtime, request);
    const session = route.match(/^\/sessions\/([^/]+)(?:\/(.+))?$/);
    if (session) return await sessionRoute(runtime, request, decodeURIComponent(session[1]), session[2]);
    if (request.method === "GET" && (route === "/config" || route === "/providers" || route === "/agents" || route === "/mcp" || route === "/vcs" || route === "/files/status" || route === "/permissions")) {
      return await readOpenCode(runtime, route);
    }
    if (request.method === "PATCH" && route === "/config") return await patchConfig(runtime, request);
    if (request.method === "PUT" && route.startsWith("/providers/")) return await setKey(runtime, request, route);
    if (request.method === "DELETE" && route.startsWith("/providers/")) return await removeKey(runtime, route);
    if (request.method === "POST" && route === "/mcp") return await addMcp(runtime, request);
    const mcp = route.match(/^\/mcp\/([^/]+)\/(connect|disconnect|disable)$/);
    if (mcp && request.method === "POST") return await mcpAction(runtime, decodeURIComponent(mcp[1]), mcp[2]);
    const permission = route.match(/^\/permissions\/([^/]+)\/reply$/);
    if (permission && request.method === "POST") return await replyPermission(runtime, request, decodeURIComponent(permission[1]));
    return json(404, { error: "Not found" });
  } catch (err) {
    return errorResult(err);
  }
}

async function ensureStatus(runtime: ControllerRuntime) {
  if (!runtime.status.connected && !runtime.status.authRequired) {
    await runtime.connect();
  }
  return runtime.status;
}

async function bootstrap(runtime: ControllerRuntime) {
  const status = await ensureStatus(runtime);
  const project = activeProject(runtime);
  let sessions: SessionSummary[] = [];
  let model = "";
  let agent = "";
  if (status.connected && project) {
    try {
      const listed = await runtime.requireClient().listSessions(project.path);
      sessions = listed.map(summarizeSession).filter((item) => !item.archived || true);
    } catch (err) {
      status.error = err instanceof Error ? err.message : status.error;
    }
    try {
      const config = await runtime.requireClient().getConfig(project.path);
      model = typeof config.model === "string" ? config.model : "";
    } catch {
      /* config is optional on first paint */
    }
  }
  return {
    status,
    ...publicState(runtime.state),
    sessions,
    groups: groupSessionsByDate(sessions.filter((item) => !item.archived)),
    model,
    agent,
    controllerVersion: CONTROLLER_VERSION,
  };
}

function diagnostics(runtime: ControllerRuntime) {
  return redactSecrets(
    {
      controllerVersion: CONTROLLER_VERSION,
      status: runtime.status,
      projects: runtime.state.projects.length,
      activeProjectId: runtime.state.activeProjectId,
    },
    secretNeedles(runtime),
  );
}

function reset(runtime: ControllerRuntime): ApiResult {
  runtime.state.projects = [];
  runtime.state.activeProjectId = null;
  runtime.state.appearance = "dark";
  runtime.state.connectionUrl = "";
  runtime.state.connectionPassword = "";
  runtime.persist();
  return json(200, publicState(runtime.state));
}

async function addProject(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  const path = typeof body.path === "string" ? body.path : "";
  const checked = validateWorkspacePath(path);
  if (!checked.ok) return json(400, { error: checked.error });
  const existing = runtime.state.projects.find((item) => item.path === checked.path);
  if (existing) {
    runtime.state.activeProjectId = existing.id;
    runtime.persist();
    return json(200, { project: existing, ...publicState(runtime.state) });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : checked.path.split("/").pop() || checked.path;
  const project = { id: newId("prj"), name, path: checked.path, createdAt: Date.now() };
  runtime.state.projects.push(project);
  runtime.state.activeProjectId = project.id;
  runtime.persist();
  return json(201, { project, ...publicState(runtime.state) });
}

function removeProject(runtime: ControllerRuntime, id: string): ApiResult {
  runtime.state.projects = runtime.state.projects.filter((item) => item.id !== id);
  if (runtime.state.activeProjectId === id) runtime.state.activeProjectId = runtime.state.projects[0]?.id ?? null;
  runtime.persist();
  return json(200, publicState(runtime.state));
}

function selectProject(runtime: ControllerRuntime, id: string): ApiResult {
  if (!runtime.state.projects.some((item) => item.id === id)) return json(404, { error: "Project not found" });
  runtime.state.activeProjectId = id;
  runtime.persist();
  return json(200, publicState(runtime.state));
}

async function updateSettings(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  if (body.appearance === "light" || body.appearance === "dark") runtime.state.appearance = body.appearance;
  if (typeof body.connectionUrl === "string") runtime.state.connectionUrl = body.connectionUrl.trim();
  if (typeof body.connectionUsername === "string" && body.connectionUsername.trim()) {
    runtime.state.connectionUsername = body.connectionUsername.trim();
  }
  if (typeof body.connectionPassword === "string") runtime.state.connectionPassword = body.connectionPassword;
  runtime.persist();
  return json(200, publicState(runtime.state));
}

async function listSessions(runtime: ControllerRuntime): Promise<ApiResult> {
  const project = requireProject(runtime);
  const search = undefined;
  const sessions = (await runtime.requireClient().listSessions(project.path, search)).map(summarizeSession);
  return json(200, {
    sessions,
    groups: groupSessionsByDate(sessions.filter((item) => !item.archived)),
    archived: sessions.filter((item) => item.archived),
  });
}

async function createSession(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const project = requireProject(runtime);
  const body = await readBody(request);
  const title = typeof body.title === "string" ? body.title : undefined;
  const session = summarizeSession(await runtime.requireClient().createSession(project.path, title));
  return json(201, { session });
}

async function sessionRoute(runtime: ControllerRuntime, request: Request, id: string, rest?: string): Promise<ApiResult> {
  const project = requireProject(runtime);
  const client = runtime.requireClient();
  if (!rest && request.method === "GET") {
    const [session, messages, diff] = await Promise.all([
      client.getSession(project.path, id),
      client.listMessages(project.path, id),
      client.getDiff(project.path, id).catch(() => []),
    ]);
    return json(200, {
      session: summarizeSession(session),
      messages: messages.map(toChatMessage),
      files: Array.isArray(diff) ? diff.map(toDiffFile) : [],
    });
  }
  if (!rest && request.method === "PATCH") {
    const body = await readBody(request);
    const session = summarizeSession(
      await client.updateSession(project.path, id, {
        title: typeof body.title === "string" ? body.title : undefined,
        archived: typeof body.archived === "boolean" ? body.archived : undefined,
      }),
    );
    return json(200, { session });
  }
  if (!rest && request.method === "DELETE") {
    await client.deleteSession(project.path, id);
    return json(200, { ok: true });
  }
  if (rest === "messages" && request.method === "GET") {
    const messages = (await client.listMessages(project.path, id)).map(toChatMessage);
    return json(200, { messages });
  }
  if (rest === "messages" && request.method === "POST") return send(runtime, project.path, id, request);
  if (rest === "abort" && request.method === "POST") {
    await client.abortSession(project.path, id);
    return json(200, { ok: true });
  }
  if (rest === "retry" && request.method === "POST") return retry(runtime, project.path, id);
  if (rest === "diff" && request.method === "GET") {
    const diff = await client.getDiff(project.path, id);
    const files: DiffFile[] = Array.isArray(diff) ? diff.map(toDiffFile) : [];
    return json(200, { files });
  }
  return json(404, { error: "Not found" });
}

async function send(runtime: ControllerRuntime, directory: string, id: string, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "Message text is required" });
  const model = typeof body.model === "string" ? body.model : "";
  const [providerID, modelID] = splitModel(model);
  await runtime.requireClient().sendMessage(directory, id, {
    text,
    providerID,
    modelID,
    agent: typeof body.agent === "string" ? body.agent : undefined,
  });
  return json(202, { ok: true });
}

async function retry(runtime: ControllerRuntime, directory: string, id: string): Promise<ApiResult> {
  const client = runtime.requireClient();
  const messages = (await client.listMessages(directory, id)).map(toChatMessage);
  const lastUser = [...messages].reverse().find((item) => item.role === "user" && item.text);
  if (!lastUser) return json(400, { error: "Nothing to retry" });
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
  if (lastAssistant) {
    try {
      await client.deleteMessage(directory, id, lastAssistant.id);
    } catch {
      /* regenerate still sends a new turn if delete is unsupported */
    }
  }
  await client.sendMessage(directory, id, { text: lastUser.text });
  return json(202, { ok: true, text: lastUser.text });
}

async function readOpenCode(runtime: ControllerRuntime, route: string): Promise<ApiResult> {
  const project = activeProject(runtime);
  const directory = project?.path;
  const client = runtime.requireClient();
  if (route === "/config") return json(200, redactSecrets(await client.getConfig(directory), secretNeedles(runtime)));
  if (route === "/providers") {
    const [providers, auth] = await Promise.all([
      client.getProviders(directory),
      client.getProviderAuth(directory).catch(() => ({})),
    ]);
    return json(200, redactSecrets({ providers, auth }, secretNeedles(runtime)));
  }
  if (route === "/agents") return json(200, redactSecrets(await client.getAgents(directory), secretNeedles(runtime)));
  if (route === "/mcp") return json(200, redactSecrets(await client.getMcp(directory), secretNeedles(runtime)));
  if (route === "/permissions") {
    const [permissions, questions] = await Promise.all([
      client.listPermissions(directory),
      client.listQuestions(directory).catch(() => []),
    ]);
    return json(200, { permissions, questions });
  }
  if (!directory) return json(400, { error: "Select a project first" });
  if (route === "/vcs") return json(200, await client.getVcs(directory));
  if (route === "/files/status") return json(200, await client.getFileStatus(directory));
  return json(404, { error: "Not found" });
}

async function patchConfig(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  const scope = body.scope === "project" ? activeProject(runtime)?.path : undefined;
  if (body.scope === "project" && !scope) return json(400, { error: "Select a project first" });
  const patch = body.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return json(400, { error: "Config patch is required" });
  const updated = await runtime.requireClient().updateConfig(patch as Record<string, unknown>, scope);
  return json(200, redactSecrets(updated, secretNeedles(runtime)));
}

async function setKey(runtime: ControllerRuntime, request: Request, route: string): Promise<ApiResult> {
  const providerId = decodeURIComponent(route.split("/")[2] ?? "").replace(/\/key$/, "");
  if (!providerId) return json(400, { error: "Provider is required" });
  const body = await readBody(request);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return json(400, { error: "API key is required" });
  await runtime.requireClient().setApiKey(providerId, key);
  return json(200, { ok: true, providerId });
}

async function removeKey(runtime: ControllerRuntime, route: string): Promise<ApiResult> {
  const providerId = decodeURIComponent(route.split("/")[2] ?? "").replace(/\/key$/, "");
  await runtime.requireClient().removeApiKey(providerId);
  return json(200, { ok: true, providerId });
}

async function addMcp(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const config = body.config;
  if (!name || !config || typeof config !== "object") return json(400, { error: "MCP name and config are required" });
  const project = activeProject(runtime);
  const record = config as Record<string, unknown>;
  if (record.type !== "local" && record.type !== "remote") return json(400, { error: "MCP type must be local or remote" });
  if (record.type === "local" && !Array.isArray(record.command)) return json(400, { error: "Local MCP requires a command array" });
  if (record.type === "remote" && typeof record.url !== "string") return json(400, { error: "Remote MCP requires a url" });
  const status = await runtime.requireClient().addMcp(project?.path, name, record);
  const current = await runtime.requireClient().getConfig(project?.path);
  const mcp = { ...((current.mcp as Record<string, unknown> | undefined) ?? {}), [name]: record };
  await runtime.requireClient().updateConfig({ mcp }, project?.path).catch(() => undefined);
  return json(200, redactSecrets(status, secretNeedles(runtime)));
}

async function mcpAction(runtime: ControllerRuntime, name: string, action: string): Promise<ApiResult> {
  const project = activeProject(runtime);
  const client = runtime.requireClient();
  if (action === "connect") await client.connectMcp(project?.path, name);
  if (action === "disconnect" || action === "disable") await client.disconnectMcp(project?.path, name);
  if (action === "disable") {
    const current = await client.getConfig(project?.path);
    const mcp = { ...((current.mcp as Record<string, unknown> | undefined) ?? {}) };
    const existing = (mcp[name] as Record<string, unknown> | undefined) ?? { type: "local", command: [] };
    mcp[name] = { ...existing, enabled: false };
    await client.updateConfig({ mcp }, project?.path);
  }
  return json(200, { ok: true });
}

async function replyPermission(runtime: ControllerRuntime, request: Request, id: string): Promise<ApiResult> {
  const body = await readBody(request);
  const reply = body.reply;
  if (reply !== "once" && reply !== "always" && reply !== "reject") {
    return json(400, { error: "Reply must be once, always, or reject" });
  }
  const project = activeProject(runtime);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  if (body.kind === "question") {
    if (reply === "reject") await runtime.requireClient().rejectQuestion(project?.path, id);
    else {
      const answer = typeof body.message === "string" ? body.message : "yes";
      await runtime.requireClient().replyQuestion(project?.path, id, [[answer]]);
    }
    return json(200, { ok: true });
  }
  await runtime.requireClient().replyPermission(project?.path, id, reply, sessionId);
  return json(200, { ok: true });
}

function events(runtime: ControllerRuntime): ApiResult {
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = runtime.subscribe((event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      });
    },
    cancel() {
      unsubscribe();
    },
  });
  return { status: 200, body: null, stream };
}

function activeProject(runtime: ControllerRuntime) {
  return runtime.state.projects.find((item) => item.id === runtime.state.activeProjectId) ?? null;
}

function requireProject(runtime: ControllerRuntime) {
  const project = activeProject(runtime);
  if (!project) throw new OpenCodeError(400, "Select a project first");
  const checked = validateWorkspacePath(project.path, runtime.state.projects.map((item) => item.path));
  if (!checked.ok) throw new OpenCodeError(400, checked.error);
  return project;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const parsed = safeJson(text);
  if (!parsed.ok) throw new OpenCodeError(400, parsed.error);
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    throw new OpenCodeError(400, "Malformed JSON");
  }
  return parsed.value as Record<string, unknown>;
}

function splitModel(model: string): [string | undefined, string | undefined] {
  if (!model.includes("/")) return [undefined, undefined];
  const index = model.indexOf("/");
  return [model.slice(0, index), model.slice(index + 1)];
}

function secretNeedles(runtime: ControllerRuntime): string[] {
  return [runtime.state.connectionPassword, process.env.OPENCODE_SERVER_PASSWORD ?? ""].filter(Boolean);
}

function errorResult(err: unknown): ApiResult {
  if (err instanceof OpenCodeError) {
    const status = err.status === 0 ? 503 : err.status || 500;
    return json(status, { error: err.message, retryable: err.retryable });
  }
  return json(500, { error: err instanceof Error ? err.message : "Controller error" });
}

function json(status: number, body: unknown): ApiResult {
  return { status, body };
}
