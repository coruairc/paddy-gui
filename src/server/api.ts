/**
 * HTTP API for the browser. Every workspace path is checked against the
 * project allowlist. Provider keys are forwarded to OpenCode and never echoed.
 */

import {
  OpenCodeError,
  projectAuthMethod,
  type OpenCodeIntegration,
  type OpenCodeModelInfo,
  type OpenCodeOAuthAttempt,
  type OpenCodeOAuthAttemptStatus,
  type OpenCodeProviderInfo,
} from "./opencode-client.ts";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  getProviderDirectory,
  type DirectoryModel,
  type ProviderDirectory,
} from "./provider-directory.ts";
import {
  groupSessionsByDate,
  summarizeSession,
  toChatMessages,
  maskSecrets,
  toDiffFiles,
  type DiffFile,
  type SessionSummary,
} from "./normalize.ts";
import { redactSecrets, safeJson, validateWorkspacePath } from "./security.ts";
import { newId, publicState, validateAvailableModels, validateDeskModel } from "./state.ts";
import { CONTROLLER_VERSION, type ControllerRuntime } from "./runtime.ts";

export type ApiResult = { status: number; body: unknown; stream?: ReadableStream<Uint8Array> };

/** Composition hook: tests supply a fixture-backed directory; production uses the process cache. */
export type ApiDependencies = { providerDirectory?: ProviderDirectory };

const encoder = new TextEncoder();

export async function handleApi(
  runtime: ControllerRuntime,
  request: Request,
  deps: ApiDependencies = {},
): Promise<ApiResult> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const route = path.startsWith("/api") ? path.slice(4) || "/" : path;
  try {
    if (request.method === "GET" && route === "/events") return events(runtime);
    if (request.method === "GET" && route === "/status") return json(200, await ensureStatus(runtime));
    if (request.method === "POST" && route === "/connect") return json(200, await runtime.connect());
    if (request.method === "POST" && route === "/disconnect") return json(200, await runtime.disconnect());
    if (request.method === "GET" && route === "/bootstrap") return json(200, await bootstrap(runtime));
    if (request.method === "GET" && route === "/fs/dirs") return await listDirectories(request);
    if (request.method === "GET" && route === "/diagnostics") return json(200, diagnostics(runtime));
    if (request.method === "POST" && route === "/settings/reset") return await reset(runtime);
    if (request.method === "GET" && route === "/projects") return json(200, { projects: runtime.state.projects, activeProjectId: runtime.state.activeProjectId });
    if (request.method === "POST" && route === "/projects") return await addProject(runtime, request);
    const project = route.match(/^\/projects\/([^/]+)$/);
    if (project && request.method === "DELETE") return removeProject(runtime, decodeParam(project[1]));
    if (project && request.method === "POST") return selectProject(runtime, decodeParam(project[1]));
    if (request.method === "PATCH" && route === "/settings") return await updateSettings(runtime, request);
    if (request.method === "GET" && route === "/sessions") return await listSessions(runtime);
    if (request.method === "POST" && route === "/sessions") return await createSession(runtime, request);
    const command = route.match(/^\/sessions\/([^/]+)\/command$/);
    if (command && request.method === "POST") return await runCommand(runtime, decodeParam(command[1]), request);
    const session = route.match(/^\/sessions\/([^/]+)(?:\/(.+))?$/);
    if (session) return await sessionRoute(runtime, request, decodeParam(session[1]), session[2]);
    if (request.method === "GET" && (route === "/models")) return await listModels(runtime);
    if (request.method === "GET" && route === "/provider-directory") {
      return await readProviderDirectory(runtime, deps.providerDirectory ?? getProviderDirectory());
    }
    if (request.method === "GET" && route === "/commands") return await listCommands(runtime);
    if (request.method === "GET" && (route === "/config" || route === "/providers" || route === "/agents" || route === "/mcp" || route === "/vcs" || route === "/files/status" || route === "/permissions")) {
      return await readOpenCode(runtime, route);
    }
    // `/integrations/:integrationID/oauth[/:attemptID[/complete]]` — controller
    // proxy for OpenCode-owned OAuth attempts. Keep ahead of the provider key
    // routes so DELETE is not mistaken for a credential removal.
    const oauth = route.match(/^\/integrations\/([^/]+)\/oauth(?:\/([^/]+)(\/complete)?)?$/);
    if (oauth) {
      return await integrationOAuth(
        runtime,
        request,
        decodeParam(oauth[1]),
        oauth[2] === undefined ? undefined : decodeParam(oauth[2]),
        oauth[3] === "/complete",
      );
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
  runtime.state.availableModels = [];
  runtime.persist();
  return json(200, publicState(runtime.state));
}

/** Cap for the folder picker: a bounded payload even in a directory with thousands of entries. */
const DIRECTORY_LIMIT = 500;

/**
 * Directory names for the Add project folder picker. Read-only, validated like
 * adding a project (absolute, existing directory), and no allowlist: a project
 * may live anywhere on the machine the user runs the controller on.
 */
async function listDirectories(request: Request): Promise<ApiResult> {
  const requested = new URL(request.url).searchParams.get("path")?.trim() ?? "";
  const checked = validateWorkspacePath(requested || homedir());
  if (!checked.ok) return json(400, { error: checked.error });
  let dirents;
  try {
    dirents = await readdir(checked.path, { withFileTypes: true });
  } catch {
    // EACCES/EPERM, or the directory vanished mid-listing: one message the user
    // can act on instead of an errno the browser cannot do anything with.
    return json(400, { error: "Cannot read that folder" });
  }
  const directories = dirents
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, path: join(checked.path, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(checked.path);
  return json(200, {
    path: checked.path,
    parent: parent === checked.path ? null : parent,
    entries: directories.slice(0, DIRECTORY_LIMIT),
    truncated: directories.length > DIRECTORY_LIMIT,
  });
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
  let availableModels: string[] | undefined;
  if (body.availableModels !== undefined) {
    const checked = validateAvailableModels(body.availableModels);
    if (!checked.ok) return json(400, { error: checked.error });
    // Clearing or removing keys is always safe offline. New keys must be proven
    // against the connected provider catalog; the browser never supplies
    // metadata. Keys already curated stay removable even if OpenCode stopped
    // listing them (the picker already omits those).
    const current = new Set(runtime.state.availableModels);
    const additions = checked.value.filter((key) => !current.has(key));
    if (additions.length) {
      const catalog = await providerModelIndex(runtime);
      for (const key of additions) {
        const model = catalog.get(key);
        if (!model) return json(400, { error: `That model is not listed by OpenCode: ${key}` });
        if (model.type !== "chat") {
          return json(400, { error: "Only chat models can be added to the chat picker" });
        }
        if (model.enabled === false) return json(400, { error: "That model is disabled in OpenCode" });
      }
    }
    availableModels = checked.value;
  }
  if (body.appearance === "light" || body.appearance === "dark") runtime.state.appearance = body.appearance;
  if (typeof body.connectionUrl === "string") runtime.state.connectionUrl = body.connectionUrl.trim();
  if (typeof body.connectionUsername === "string" && body.connectionUsername.trim()) {
    runtime.state.connectionUsername = body.connectionUsername.trim();
  }
  if (body.clearConnectionPassword === true) runtime.state.connectionPassword = "";
  else if (typeof body.connectionPassword === "string" && body.connectionPassword.trim() !== "") runtime.state.connectionPassword = body.connectionPassword;
  if (deskModel !== undefined) runtime.state.deskModel = deskModel;
  if (availableModels !== undefined) runtime.state.availableModels = availableModels;
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
      // The chat must still open when its diff can't load, but an empty list would
      // read as "No file changes": carry the failure so the inspector can say so.
      client.getDiff(project.path, id).then(
        (files) => ({ files, error: null as string | null }),
        (err: unknown) => ({ files: [] as unknown[], error: err instanceof Error ? err.message : "Could not load changes" }),
      ),
    ]);
    const needles = secretNeedles(runtime);
    return json(200, {
      session: summarizeSession(session),
      messages: toChatMessages(messages),
      files: redactSecrets(toDiffFiles(diff.files, needles), needles),
      ...(diff.error ? { filesError: redactSecrets(maskSecrets(diff.error, needles), needles) } : {}),
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
  if (rest === "edit" && request.method === "POST") return editPrompt(runtime, project.path, id, request);
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

/**
 * Rewrite the newest prompt. OpenCode v2.3.2 has no message-delete route, so the
 * edit stages a revert boundary at that prompt and commits it (commit drops the
 * prompt and everything after it from the session), then sends the new text. A
 * failed revert sends nothing: the old prompt would otherwise be duplicated.
 * The retry route keeps its own (best-effort) deleteMessage call.
 */
async function editPrompt(
  runtime: ControllerRuntime,
  directory: string,
  id: string,
  request: Request,
): Promise<ApiResult> {
  const body = await readBody(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "Message text is required" });
  const client = runtime.requireClient();
  const messages = toChatMessages(await client.listMessages(directory, id));
  const lastUser = [...messages].reverse().find((item) => item.role === "user" && item.text);
  if (!lastUser) return json(400, { error: "Nothing to edit" });
  try {
    await client.stageRevert(directory, id, lastUser.id);
    await client.commitRevert(directory, id);
  } catch (err) {
    // A stage without a commit would leave a boundary armed for a later commit:
    // clear it (best effort) before reporting the failure.
    await client.clearRevert(directory, id).catch(() => undefined);
    return json(503, { error: err instanceof Error ? err.message : "Could not edit that message" });
  }
  await client.sendMessage(directory, id, { text });
  return json(202, { ok: true });
}

// ── Provider directory (models.dev catalog ∩ OpenCode integrations) ────────
// Display metadata only. The configured tab comes from `/api/providers`; this
// route exists so the Not configured tab can name OpenCode-supported providers
// without the browser ever contacting models.dev or a provider API host.

type ProviderDirectoryEntry = {
  id: string;
  name: string;
  doc?: string;
  modelCount: number;
  models: DirectoryModel[];
  integrationID: string;
  configured: boolean;
  auth: Array<Record<string, unknown>>;
};

type ProviderDirectoryBody = {
  directory: ProviderDirectoryEntry[];
  error?: string;
  fetchedAt?: number;
};

const OPENCODE_INVENTORY_ERROR = "OpenCode integrations are unavailable";

async function readProviderDirectory(
  runtime: ControllerRuntime,
  directory: ProviderDirectory,
): Promise<ApiResult> {
  const catalog = await directory.get();
  const response: ProviderDirectoryBody = { directory: [] };
  if (catalog.fetchedAt !== undefined) response.fetchedAt = catalog.fetchedAt;
  if (catalog.error) {
    response.error = catalog.error;
    return json(200, redactSecrets(response, secretNeedles(runtime)));
  }
  if (!catalog.providers.length) return json(200, response);

  const client = runtime.client;
  if (!runtime.status.connected || !client) {
    response.error = OPENCODE_INVENTORY_ERROR;
    return json(200, redactSecrets(response, secretNeedles(runtime)));
  }

  const projectPath = activeProject(runtime)?.path;
  const [integrations, providers] = await Promise.all([
    client.listIntegrations(projectPath).catch(() => null),
    client.getProviderCatalog(projectPath).catch(() => null),
  ]);
  // Without the inventory we cannot tell OpenCode-supported providers from
  // arbitrary models.dev entries; return the retryable error rather than
  // mislabeling the Not configured tab (AC-C1).
  if (!integrations) {
    response.error = OPENCODE_INVENTORY_ERROR;
    return json(200, redactSecrets(response, secretNeedles(runtime)));
  }

  const active = new Set<string>();
  for (const provider of providers ?? []) {
    if (typeof provider.id === "string" && provider.id) active.add(provider.id);
    if (typeof provider.integrationID === "string" && provider.integrationID) {
      active.add(provider.integrationID);
    }
  }
  const integrationsByID = new Map<string, OpenCodeIntegration>();
  for (const integration of integrations) {
    if (typeof integration.id === "string" && integration.id) {
      integrationsByID.set(integration.id, integration);
    }
  }

  const needles = secretNeedles(runtime);
  const entries: ProviderDirectoryEntry[] = [];
  for (const provider of catalog.providers) {
    const integration = integrationsByID.get(provider.id);
    if (!integration) continue;
    // Redact the untrusted display metadata only: auth method objects carry a
    // legitimate `key` field that whole-response key redaction would clobber.
    const safe = redactSecrets(
      {
        id: provider.id,
        name: provider.name,
        ...(provider.doc ? { doc: provider.doc } : {}),
        modelCount: provider.modelCount,
        models: provider.models,
      },
      needles,
    );
    entries.push({
      ...safe,
      integrationID: provider.id,
      configured: active.has(provider.id),
      auth: (Array.isArray(integration.methods) ? integration.methods : []).map((method) =>
        projectAuthMethod(method),
      ),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  response.directory = entries;
  return json(200, response);
}

async function listModels(runtime: ControllerRuntime): Promise<ApiResult> {
  if (!runtime.status.connected) return json(200, { models: [], default: "" });
  const directory = activeProject(runtime)?.path;
  const client = runtime.requireClient();
  const available = runtime.state.availableModels;
  const [catalog, fallback, providerCatalog] = await Promise.all([
    client.listModels(directory),
    client.getDefaultModel(directory).catch(() => null),
    available.length
      ? client.getProviderCatalog(directory).catch(() => [] as OpenCodeProviderInfo[])
      : Promise.resolve([] as OpenCodeProviderInfo[]),
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
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (!entry?.id || !entry.providerID || !entry.name) continue;
    const modelKey = `${entry.providerID}/${entry.id}`;
    if (seen.has(modelKey)) continue;
    seen.add(modelKey);
    projected.push({
      modelKey,
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
  // Curated additions resolve against OpenCode's authoritative chat catalog
  // (`/api/model`, already fetched) unioned with inline provider models. A saved
  // key that disappeared upstream is omitted here but kept in state, so a
  // temporary provider outage does not erase the user's selection.
  if (available.length) {
    const index = modelIndex(catalog, providerCatalog);
    for (const key of available) {
      if (seen.has(key)) continue;
      const model = index.get(key);
      if (!model || model.type !== "chat" || model.enabled === false) continue;
      seen.add(key);
      projected.push({
        modelKey: key,
        id: model.id,
        providerID: model.providerID,
        name: model.name || model.id,
        status: model.status ?? "active",
        context: model.limit?.context ?? 0,
        released: model.time?.released ?? 0,
        enabled: true,
        tools: model.capabilities?.tools === true,
        variantCount: Array.isArray(model.variants) ? model.variants.length : 0,
      });
    }
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
    // string, breaking `authMethods.some(...)`. getProviderAuth already projects
    // methods to {id,type,label,form} and never returns credentials/connections.
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

type ProviderCatalogModel = {
  id: string;
  providerID: string;
  name?: string;
  type?: string;
  enabled?: boolean;
  status?: string;
  limit?: { context?: number };
  time?: { released?: number };
  capabilities?: { tools?: boolean };
  variants?: unknown[];
};

/** Canonical `providerID/...` keys registered for one model. The picker
 *  catalog keys entries by `id`; provider cards may key them by `modelID`, so
 *  both real identifiers are accepted when they differ. */
function modelKeys(providerID: string, id: string, modelID?: string): string[] {
  const keys = [`${providerID}/${id}`];
  if (modelID && modelID !== id) keys.push(`${providerID}/${modelID}`);
  return keys;
}

/** Project an `/api/model` chat catalog entry into the validation shape. */
function modelFromCatalogEntry(entry: OpenCodeModelInfo): ProviderCatalogModel | null {
  if (!entry?.id || !entry.providerID) return null;
  return {
    id: entry.id,
    providerID: entry.providerID,
    ...(typeof entry.name === "string" ? { name: entry.name } : {}),
    // The v2 chat catalog only lists chat models.
    type: "chat",
    ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
    ...(typeof entry.status === "string" ? { status: entry.status } : {}),
    ...(entry.limit ? { limit: { context: entry.limit.context } } : {}),
    ...(entry.time ? { time: { released: entry.time.released } } : {}),
    ...(entry.capabilities ? { capabilities: { tools: entry.capabilities.tools } } : {}),
    ...(Array.isArray(entry.variants) ? { variants: entry.variants } : {}),
  };
}

/** Index of the authoritative chat catalog (`GET /api/model`). Live OpenCode
 *  2.x does not populate inline `models` on `/api/provider`, so this is the
 *  primary source for validating additions. */
function modelIndexFromCatalog(models: OpenCodeModelInfo[]): Map<string, ProviderCatalogModel> {
  const index = new Map<string, ProviderCatalogModel>();
  for (const entry of models) {
    const model = modelFromCatalogEntry(entry);
    if (!model) continue;
    for (const key of modelKeys(model.providerID, model.id, entry.modelID)) {
      if (!index.has(key)) index.set(key, model);
    }
  }
  return index;
}

/** Canonical index of any inline provider models a server still embeds on
 *  `/api/provider` (forward-compat; live 2.x returns none). */
function modelIndexFromProviders(providers: OpenCodeProviderInfo[]): Map<string, ProviderCatalogModel> {
  const index = new Map<string, ProviderCatalogModel>();
  for (const provider of providers) {
    const fallbackProviderID = typeof provider.id === "string" ? provider.id : "";
    const models = provider.models && typeof provider.models === "object" ? provider.models : {};
    for (const [modelKey, raw] of Object.entries(models)) {
      if (!raw || typeof raw !== "object") continue;
      const model = raw as NonNullable<OpenCodeProviderInfo["models"]>[string];
      const providerID =
        typeof model.providerID === "string" && model.providerID ? model.providerID : fallbackProviderID;
      const id =
        (typeof model.modelID === "string" && model.modelID) ||
        (typeof model.id === "string" && model.id) ||
        modelKey;
      if (!providerID || !id) continue;
      const modelID = typeof model.modelID === "string" ? model.modelID : undefined;
      const keys = modelKeys(providerID, id, modelID);
      if (keys.some((key) => index.has(key))) continue;
      const projected: ProviderCatalogModel = {
        id,
        providerID,
        ...(typeof model.name === "string" ? { name: model.name } : {}),
        ...(typeof model.type === "string" ? { type: model.type } : {}),
        ...(typeof model.enabled === "boolean" ? { enabled: model.enabled } : {}),
        ...(typeof model.status === "string" ? { status: model.status } : {}),
        ...(model.limit ? { limit: { context: model.limit.context } } : {}),
        ...(model.time ? { time: { released: model.time.released } } : {}),
        ...(model.capabilities ? { capabilities: { tools: model.capabilities.tools } } : {}),
        ...(Array.isArray(model.variants) ? { variants: model.variants } : {}),
      };
      for (const key of keys) index.set(key, projected);
    }
  }
  return index;
}

/** Validation/merge index: the `/api/model` chat catalog first (authoritative),
 *  then any inline provider models a server still embeds. */
function modelIndex(
  models: OpenCodeModelInfo[],
  providers: OpenCodeProviderInfo[],
): Map<string, ProviderCatalogModel> {
  const index = modelIndexFromCatalog(models);
  for (const [key, model] of modelIndexFromProviders(providers)) {
    if (!index.has(key)) index.set(key, model);
  }
  return index;
}

async function providerModelIndex(runtime: ControllerRuntime): Promise<Map<string, ProviderCatalogModel>> {
  const client = runtime.requireClient();
  const directory = activeProject(runtime)?.path;
  // A failed `/api/provider` read must not reject a model the authoritative
  // chat catalog already proves; inline provider models are optional metadata.
  const [models, providers] = await Promise.all([
    client.listModels(directory),
    client.getProviderCatalog(directory).catch(() => [] as OpenCodeProviderInfo[]),
  ]);
  return modelIndex(models, providers);
}

// Integration.AttemptID in the v2.3.2 schema is `con_` + a generated id.
const OAUTH_ATTEMPT = /^con_[A-Za-z0-9_-]{1,200}$/;
const OAUTH_CODE_MAX_LENGTH = 8192;

/**
 * Same-origin proxy for OpenCode-owned OAuth attempts. Only the integration and
 * method ids listed by OpenCode are forwarded; Paddy never sees or stores a
 * token. The browser holds the attempt id for polling/cancel.
 */
async function integrationOAuth(
  runtime: ControllerRuntime,
  request: Request,
  integrationID: string,
  attemptID: string | undefined,
  complete: boolean,
): Promise<ApiResult> {
  const client = runtime.requireClient();
  const directory = activeProject(runtime)?.path;
  const integrations = await client.listIntegrations(directory);
  const integration = integrations.find((item) => item.id === integrationID);
  if (!integration) return json(404, { error: "Integration not found" });

  if (attemptID === undefined) {
    if (request.method !== "POST") return json(404, { error: "Not found" });
    const body = await readBody(request);
    const methodID = typeof body.methodID === "string" ? body.methodID.trim() : "";
    if (!methodID) return json(400, { error: "methodID is required" });
    const methods = Array.isArray(integration.methods) ? integration.methods : [];
    const method = methods.find((item) => item.id === methodID && item.type === "oauth");
    if (!method) return json(400, { error: "That integration does not list this OAuth method" });
    const answer = oauthAnswer(body.answer);
    if (answer === null) return json(400, { error: "answer must be a form answer object" });
    let label: string | undefined;
    if (body.label !== undefined) {
      if (typeof body.label !== "string") return json(400, { error: "label must be a string" });
      label = body.label.trim();
      if (label.length > 200) return json(400, { error: "label must be at most 200 characters" });
    }
    const attempt = await client.startOAuthConnect(directory, integrationID, {
      methodID,
      ...(answer === undefined ? {} : { answer }),
      ...(label ? { label } : {}),
    });
    return json(200, { attempt: projectOAuthAttempt(attempt) });
  }

  if (!OAUTH_ATTEMPT.test(attemptID)) return json(400, { error: "Invalid OAuth attempt id" });

  if (complete) {
    if (request.method !== "POST") return json(404, { error: "Not found" });
    const body = await readBody(request);
    if (body.code !== undefined && typeof body.code !== "string") {
      return json(400, { error: "code must be a string" });
    }
    const code = typeof body.code === "string" ? body.code : undefined;
    if (code !== undefined && code.length > OAUTH_CODE_MAX_LENGTH) {
      return json(400, { error: "code is too long" });
    }
    await client.completeOAuthConnect(directory, integrationID, attemptID, code);
    return json(200, { ok: true });
  }

  if (request.method === "GET") {
    const status = await client.getOAuthConnectStatus(directory, integrationID, attemptID);
    return json(200, { attempt: projectOAuthStatus(status) });
  }
  if (request.method === "DELETE") {
    await client.cancelOAuthConnect(directory, integrationID, attemptID);
    return json(200, { ok: true });
  }
  return json(404, { error: "Not found" });
}

/** Form.Answer is a record of scalar/array values keyed by form field. */
function oauthAnswer(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 50) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 200) return null;
    if (Array.isArray(item)) {
      if (item.length > 100 || !item.every(isScalarAnswer)) return null;
      out[key] = item;
    } else if (isScalarAnswer(item)) {
      out[key] = item;
    } else {
      return null;
    }
  }
  return out;
}

function isScalarAnswer(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Allowlist the attempt fields the browser may see; nothing credential-shaped. */
function projectOAuthAttempt(attempt: OpenCodeOAuthAttempt): Record<string, unknown> {
  const time = projectOAuthTime(attempt.time);
  return {
    attemptID: typeof attempt.attemptID === "string" ? attempt.attemptID : "",
    url: typeof attempt.url === "string" ? attempt.url : "",
    ...(typeof attempt.instructions === "string" ? { instructions: attempt.instructions } : {}),
    mode: attempt.mode === "code" ? "code" : "auto",
    paste: attempt.paste === true,
    ...(time ? { time } : {}),
  };
}

function projectOAuthStatus(attempt: OpenCodeOAuthAttemptStatus): Record<string, unknown> {
  const time = projectOAuthTime(attempt.time);
  const status =
    attempt.status === "complete" || attempt.status === "failed" || attempt.status === "expired"
      ? attempt.status
      : "pending";
  return {
    status,
    ...(typeof attempt.message === "string" ? { message: attempt.message } : {}),
    ...(time ? { time } : {}),
  };
}

function projectOAuthTime(
  time: { created?: number; expires?: number } | undefined,
): Record<string, number> | null {
  if (!time || typeof time !== "object") return null;
  const projected: Record<string, number> = {};
  if (typeof time.created === "number") projected.created = time.created;
  if (typeof time.expires === "number") projected.expires = time.expires;
  return Object.keys(projected).length ? projected : null;
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
