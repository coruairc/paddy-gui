/**
 * HTTP API for the browser. Every workspace path is checked against the
 * project allowlist. Provider keys are forwarded to OpenCode and never echoed.
 */

import { OpenCodeError } from "./opencode-client.ts";
import {
  groupSessionsByDate,
  summarizeSession,
  toChatMessages,
  toDiffFiles,
  type DiffFile,
  type SessionSummary,
} from "./normalize.ts";
import { redactSecrets, safeJson, validateWorkspacePath } from "./security.ts";
import { newId, publicState, validateDeskModel } from "./state.ts";
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
    if (request.method === "POST" && route === "/settings/reset") return await reset(runtime);
    if (request.method === "GET" && route === "/projects") return json(200, { projects: runtime.state.projects, activeProjectId: runtime.state.activeProjectId });
    if (request.method === "POST" && route === "/projects") return await addProject(runtime, request);
    const project = route.match(/^\/projects\/([^/]+)$/);
    if (project && request.method === "DELETE") return removeProject(runtime, decodeParam(project[1]));
    if (project && request.method === "POST") return selectProject(runtime, decodeParam(project[1]));
    if (request.method === "PATCH" && route === "/settings") return updateSettings(runtime, request);
    if (request.method === "GET" && route === "/sessions") return await listSessions(runtime);
    if (request.method === "POST" && route === "/sessions") return await createSession(runtime, request);
    const command = route.match(/^\/sessions\/([^/]+)\/command$/);
    if (command && request.method === "POST") return await runCommand(runtime, decodeParam(command[1]), request);
    const session = route.match(/^\/sessions\/([^/]+)(?:\/(.+))?$/);
    if (session) return await sessionRoute(runtime, request, decodeParam(session[1]), session[2]);
    if (request.method === "GET" && (route === "/models")) return await listModels(runtime);
    if (request.method === "GET" && route === "/commands") return await listCommands(runtime);
    if (request.method === "GET" && (route === "/config" || route === "/providers" || route === "/agents" || route === "/mcp" || route === "/vcs" || route === "/files/status" || route === "/permissions")) {
      return await readOpenCode(runtime, route);
    }
    if (request.method === "PUT" && route.startsWith("/providers/")) return await setKey(runtime, request, route);
    if (request.method === "DELETE" && route.startsWith("/providers/")) return await removeKey(runtime, route);
    if (request.method === "POST" && route === "/mcp") return await addMcp(runtime, request);
    const mcp = route.match(/^\/mcp\/([^/]+)\/(connect|disconnect|disable)$/);
    if (mcp && request.method === "POST") return await mcpAction(runtime, decodeParam(mcp[1]), mcp[2]);
    const permission = route.match(/^\/permissions\/([^/]+)\/reply$/);
    if (permission && request.method === "POST") return await replyPermission(runtime, request, decodeParam(permission[1]));
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
  // False when the first page came back full (there may be more) or listing
  // failed: the client must not treat "not in this list" as "gone".
  let sessionsComplete = true;
  let model = "";
  const agent = "";
  if (status.connected && project) {
    try {
      const page = await runtime.requireClient().listSessionsPage(project.path);
      sessions = page.sessions.map(summarizeSession).filter((item) => !item.archived || true);
      sessionsComplete = !page.hasMore;
    } catch (err) {
      sessionsComplete = false;
      status.error = err instanceof Error ? err.message : status.error;
    }
    try {
      const config = await runtime.requireClient().getConfig(project.path);
      model = typeof config.model === "string" ? config.model : "";
    } catch {
      /* config is optional on first paint */
    }
  }
  // A saved desk default wins over the OpenCode project-config model; the config
  // model stays the fallback for fresh installs (v2 has no remote global write).
  if (runtime.state.deskModel) model = runtime.state.deskModel;
  return {
    status,
    ...publicState(runtime.state),
    sessions,
    sessionsComplete,
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

async function reset(runtime: ControllerRuntime): Promise<ApiResult> {
  await runtime.disconnect();
  runtime.state.projects = [];
  runtime.state.activeProjectId = null;
  runtime.state.appearance = "dark";
  runtime.state.connectionUrl = "";
  runtime.state.connectionPassword = "";
  runtime.state.ownedServerPassword = "";
  runtime.state.deskModel = "";
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
  // Validate before touching state so a rejected PATCH changes nothing.
  let deskModel: string | undefined;
  if (body.deskModel !== undefined) {
    const checked = validateDeskModel(body.deskModel);
    if (!checked.ok) return json(400, { error: checked.error });
    deskModel = checked.value;
    if (deskModel && (await isDisabledModel(runtime, deskModel))) {
      return json(400, { error: "That model is disabled in OpenCode" });
    }
  }
  if (body.appearance === "light" || body.appearance === "dark") runtime.state.appearance = body.appearance;
  if (typeof body.connectionUrl === "string") runtime.state.connectionUrl = body.connectionUrl.trim();
  if (typeof body.connectionUsername === "string" && body.connectionUsername.trim()) {
    runtime.state.connectionUsername = body.connectionUsername.trim();
  }
  if (body.clearConnectionPassword === true) runtime.state.connectionPassword = "";
  else if (typeof body.connectionPassword === "string" && body.connectionPassword.trim() !== "") runtime.state.connectionPassword = body.connectionPassword;
  if (deskModel !== undefined) runtime.state.deskModel = deskModel;
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
      messages: toChatMessages(messages),
      files: redactSecrets(toDiffFiles(diff, secretNeedles(runtime)), secretNeedles(runtime)),
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
    const messages = toChatMessages(await client.listMessages(project.path, id));
    return json(200, { messages });
  }
  if (rest === "messages" && request.method === "POST") return send(runtime, project.path, id, request);
  if (rest === "abort" && request.method === "POST") {
    await client.abortSession(project.path, id);
    return json(200, { ok: true });
  }
  if (rest === "retry" && request.method === "POST") return retry(runtime, project.path, id);
  if (rest === "diff" && request.method === "GET") {
    const range = diffRange(new URL(request.url).searchParams);
    if (!range.ok) return json(400, { error: range.error });
    const diff = await client.getDiff(project.path, id, range.value);
    // Known secrets (>= 4 chars) are masked anywhere in the patch text, e.g. a
    // `+OPENCODE_SERVER_PASSWORD=<pw>` line; total patch text is capped.
    const files: DiffFile[] = toDiffFiles(diff, secretNeedles(runtime));
    return json(200, { files: redactSecrets(files, secretNeedles(runtime)) });
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
  const messages = toChatMessages(await client.listMessages(directory, id));
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

async function listModels(runtime: ControllerRuntime): Promise<ApiResult> {
  if (!runtime.status.connected) return json(200, { models: [], default: "" });
  const directory = activeProject(runtime)?.path;
  const client = runtime.requireClient();
  const [catalog, fallback] = await Promise.all([
    client.listModels(directory),
    client.getDefaultModel(directory).catch(() => null),
  ]);
  const projected: Array<{
    modelKey: string;
    id: string;
    providerID: string;
    name: string;
    status: string;
    context: number;
    released: number;
    enabled: boolean;
    tools: boolean;
    variantCount: number;
  }> = [];
  for (const entry of catalog) {
    if (!entry?.id || !entry.providerID || !entry.name) continue;
    projected.push({
      modelKey: `${entry.providerID}/${entry.id}`,
      id: entry.id,
      providerID: entry.providerID,
      name: entry.name,
      status: entry.status ?? "active",
      context: entry.limit?.context ?? 0,
      released: entry.time?.released ?? 0,
      enabled: entry.enabled !== false,
      tools: entry.capabilities?.tools === true,
      variantCount: Array.isArray(entry.variants) ? entry.variants.length : 0,
    });
  }
  const defaultKey =
    fallback?.providerID && fallback?.id ? `${fallback.providerID}/${fallback.id}` : "";
  // Project → redact → assemble: identifiers travel under `modelKey` so the
  // `^key$` credential rule cannot replace them with "[redacted]".
  const safe = redactSecrets({ models: projected, default: defaultKey }, secretNeedles(runtime));
  return json(200, {
    models: safe.models.map(({ modelKey, ...rest }) => ({ key: modelKey, ...rest })),
    default: safe.default,
  });
}

async function listCommands(runtime: ControllerRuntime): Promise<ApiResult> {
  if (!runtime.status.connected) return json(200, { commands: [] });
  const directory = activeProject(runtime)?.path;
  const client = runtime.requireClient();
  const catalog = await client.listCommands(directory);
  const projected = catalog
    .filter((entry) => typeof entry?.name === "string" && entry.name.trim() !== "")
    .map((entry) => ({
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : "",
    }));
  return json(200, { commands: redactSecrets(projected, secretNeedles(runtime)) });
}

async function runCommand(
  runtime: ControllerRuntime,
  sessionId: string,
  request: Request,
): Promise<ApiResult> {
  // Same gate as the prompt route (sessionRoute → send): active, allowlisted project.
  const project = requireProject(runtime);
  const body = await readBody(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!name) return json(400, { error: "Command name is required" });
  await runtime.requireClient().runCommand(project.path, sessionId, { name, text });
  return json(202, { ok: true });
}

async function readOpenCode(runtime: ControllerRuntime, route: string): Promise<ApiResult> {
  const project = activeProject(runtime);
  const directory = project?.path;
  if (!runtime.status.connected) {
    if (route === "/vcs") return json(200, { branch: null });
    if (route === "/agents") return json(200, []);
  }
  const client = runtime.requireClient();
  if (route === "/providers") {
    const [providers, auth] = await Promise.all([
      client.getProviders(directory),
      client.getProviderAuth(directory).catch(() => ({})),
    ]);
    // Redact the provider list (it can carry headers/settings), but NOT the auth
    // map: its keys are provider IDs (e.g. "alibaba-token-plan"), and key-based
    // redaction would clobber any ID containing "token"/"key"/"secret" into a
    // string, breaking `authMethods.some(...)`. getProviderAuth already strips
    // credentials down to {type,label}, so the values are safe as-is.
    return json(200, { providers: redactSecrets(providers, secretNeedles(runtime)), auth });
  }
  if (route === "/agents") return json(200, redactSecrets(await client.getAgents(directory), secretNeedles(runtime)));
  if (route === "/config") {
    // Project to the only field the browser reads (Settings → Permissions).
    // The merged config also carries provider headers, MCP env and other
    // credential-shaped values whose key names key-based redaction can miss.
    const config = (await client.getConfig(directory)) as Record<string, unknown> | null | undefined;
    const permission = config && typeof config === "object" ? config.permission : undefined;
    return json(200, redactSecrets({ permission: permission ?? {} }, secretNeedles(runtime)));
  }
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

async function setKey(runtime: ControllerRuntime, request: Request, route: string): Promise<ApiResult> {
  const providerId = decodeParam(route.split("/")[2] ?? "").replace(/\/key$/, "");
  if (!providerId) return json(400, { error: "Provider is required" });
  const body = await readBody(request);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return json(400, { error: "API key is required" });
  await runtime.requireClient().setApiKey(providerId, key);
  return json(200, { ok: true, providerId });
}

async function removeKey(runtime: ControllerRuntime, route: string): Promise<ApiResult> {
  const providerId = decodeParam(route.split("/")[2] ?? "").replace(/\/key$/, "");
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
  return json(200, redactSecrets(status, secretNeedles(runtime)));
}

async function mcpAction(runtime: ControllerRuntime, name: string, action: string): Promise<ApiResult> {
  const project = activeProject(runtime);
  const client = runtime.requireClient();
  if (action === "connect") await client.connectMcp(project?.path, name);
  if (action === "disconnect" || action === "disable") await client.disconnectMcp(project?.path, name);
  return json(200, { ok: true });
}

async function replyPermission(runtime: ControllerRuntime, request: Request, id: string): Promise<ApiResult> {
  const body = await readBody(request);
  const reply = body.reply;
  if (reply !== "once" && reply !== "always" && reply !== "reject") {
    return json(400, { error: "Reply must be once, always, or reject" });
  }
  const project = activeProject(runtime);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) return json(400, { error: "A sessionId is required to reply" });
  if (body.kind === "question") {
    if (reply === "reject") await runtime.requireClient().rejectQuestion(project?.path, sessionId, id);
    else {
      const answer = typeof body.message === "string" ? body.message.trim() : "";
      if (!answer) return json(400, { error: "An answer is required" });
      await runtime.requireClient().replyQuestion(project?.path, sessionId, id, answer);
    }
    return json(200, { ok: true });
  }
  await runtime.requireClient().replyPermission(project?.path, sessionId, id, reply);
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

/** Route params are percent-encoded; a malformed escape is a client error, not a 500. */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new OpenCodeError(400, "Malformed path parameter");
  }
}

/**
 * True only when OpenCode's catalog lists this exact key with `enabled: false`.
 * Offline, a failed catalog read, or a key the catalog does not list are not
 * proof of anything, so they never block the save.
 */
async function isDisabledModel(runtime: ControllerRuntime, key: string): Promise<boolean> {
  if (!runtime.status.connected || !runtime.client) return false;
  try {
    const catalog = await runtime.client.listModels(activeProject(runtime)?.path);
    return catalog.some((entry) => entry?.enabled === false && `${entry.providerID}/${entry.id}` === key);
  } catch {
    return false;
  }
}

// Session.Message.ID in the v2.3.2 openapi is `{"type":"string","pattern":"^msg_"}`.
const MESSAGE_ID = /^msg_[A-Za-z0-9_-]{1,124}$/;

function diffRange(params: URLSearchParams): { ok: true; value: { from?: string; to?: string } } | { ok: false; error: string } {
  const value: { from?: string; to?: string } = {};
  for (const key of ["from", "to"] as const) {
    const raw = params.get(key);
    if (raw === null || raw === "") continue;
    if (!MESSAGE_ID.test(raw)) return { ok: false, error: `Invalid ${key} message id` };
    value[key] = raw;
  }
  return { ok: true, value };
}

function splitModel(model: string): [string | undefined, string | undefined] {
  if (!model.includes("/")) return [undefined, undefined];
  const index = model.indexOf("/");
  return [model.slice(0, index), model.slice(index + 1)];
}

function secretNeedles(runtime: ControllerRuntime): string[] {
  return [
    runtime.state.connectionPassword,
    runtime.state.ownedServerPassword,
    process.env.OPENCODE_SERVER_PASSWORD ?? "",
  ].filter(Boolean);
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
