/**
 * OpenCodeClient talks to the installed OpenCode HTTP server (v2).
 * Every call uses the `/api` prefix and unwraps the `{ data }` envelope.
 * Paths come from the server's `/openapi.json`; unsupported calls surface as
 * errors instead of invented endpoints.
 */

export type OpenCodeHealth = { healthy?: boolean; version?: string };

export type OpenCodeSession = {
  id: string;
  parentID?: string;
  projectID?: string;
  title?: string;
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
  time?: { created?: number; updated?: number; archived?: number; busy?: number };
  location?: { directory?: string };
  /** Legacy v1 fields kept so normalize stays defensive. */
  directory?: string;
  path?: string;
  summary?: { additions?: number; deletions?: number; files?: number };
};

export type OpenCodeToolState = {
  status?: string;
  title?: string;
  input?: Record<string, unknown> | string;
  content?: Array<{ type?: string; text?: string }> | string;
  output?: string;
  metadata?: Record<string, unknown>;
  error?: string | { message?: string };
};

export type OpenCodePart = {
  type?: string;
  id?: string;
  /** v2 tool name. */
  name?: string;
  /** v1 tool name, tolerated for old events. */
  tool?: string;
  text?: string;
  executed?: boolean;
  state?: OpenCodeToolState;
  time?: { created?: number; completed?: number };
};

export type OpenCodeMessage = {
  id: string;
  /** v2 discriminant: user | assistant | system | idle | shell | ... */
  type?: string;
  /** v1 role, tolerated for fixtures. */
  role?: string;
  time?: { created?: number; completed?: number; firstToken?: number; streamed?: number };
  /** user / system / synthetic messages. */
  text?: string;
  /** assistant message parts. */
  content?: OpenCodePart[];
  error?: { message?: string } | { data?: { message?: string }; name?: string };
  /** v2 assistant step snapshot; `files` are project-relative paths the step changed. */
  snapshot?: { start?: string; end?: string; files?: unknown };
};

/** Range for `GET /api/session/:id/diff`: user message ids; both optional (default = newest turn). */
export type DiffRange = { from?: string; to?: string };

/** Unchanged lines around each hunk. Without it v2 returns whole-file patches. */
export const DIFF_CONTEXT_LINES = 3;

/**
 * Ceiling on the raw upstream diff body. The browser response is capped at
 * 5 MB of patch text (normalize.ts MAX_DIFF_TOTAL_CHARS), but that budget is
 * spent after per-file cuts (400k each) and JSON escaping, so the raw body
 * legitimately runs several times larger. 32 MiB leaves room for that while
 * bounding controller memory. Past it the read is aborted and nothing is
 * parsed: a cut JSON body can't be masked reliably, so no partial patch (and
 * no partial secret) is ever passed on.
 */
export const MAX_DIFF_UPSTREAM_BYTES = 32 * 1024 * 1024;

export type OpenCodeModel = {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  status?: string;
  capabilities?: { reasoning?: boolean; attachment?: boolean; toolcall?: boolean };
  limit?: { context?: number; input?: number; output?: number };
};

/** v2 catalog entry from `GET /api/model`. Raw `headers`/`settings`/`body` never leave the controller. */
export type OpenCodeModelInfo = {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  status?: "alpha" | "beta" | "deprecated" | "active";
  enabled?: boolean;
  limit?: { context?: number; input?: number; output?: number };
  time?: { released?: number };
  capabilities?: { tools?: boolean; input?: string[]; output?: string[]; temperature?: boolean };
  variants?: Array<{ id?: string }>;
};

/** v2 slash-command catalog entry from `GET /api/command`. */
export type OpenCodeCommand = {
  name: string;
  description?: string;
};

export type OpenCodeFormField = {
  key?: string;
  type?: string;
  title?: string;
  description?: string;
  hidden?: boolean;
  options?: unknown[];
};

export type OpenCodeForm = {
  id?: string;
  sessionID?: string;
  title?: string;
  fields?: OpenCodeFormField[];
};

export type OpenCodePermission = {
  id?: string;
  sessionID?: string;
  action?: string;
  resources?: unknown[];
  save?: unknown[];
  metadata?: Record<string, unknown>;
  source?: unknown;
  message?: string;
};

export type OpenCodeMcpServer = {
  name?: string;
  status?: { status?: string; error?: string };
  title?: string;
  integrationID?: string;
};

export type OpenCodeProviderModel = Omit<OpenCodeModel, "capabilities"> & {
  /** OpenCode's model kind; only `chat` models are valid for the picker. */
  type?: string;
  enabled?: boolean;
  time?: { released?: number };
  capabilities?: {
    tools?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: string[];
    output?: string[];
    temperature?: boolean;
  };
  variants?: Array<{ id?: string }>;
};

/** A provider entry from `GET /api/provider`; `models` is OpenCode's own
 *  provider-listed catalog (not the smaller `/api/model` picker catalog). */
export type OpenCodeProviderInfo = {
  id?: string;
  integrationID?: string;
  name?: string;
  models?: Record<string, OpenCodeProviderModel>;
};

/** Form schema attached to an integration auth method (`Form.Field`). */
export type OpenCodeAuthFormField = {
  key?: string;
  type?: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  format?: string;
  placeholder?: string;
  pattern?: string;
  default?: unknown;
  options?: Array<{ value?: unknown; label?: string; description?: string }>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  custom?: boolean;
  when?: Array<{ key?: string; op?: string; value?: unknown }>;
  /** External form fields only. */
  url?: string;
};

export type OpenCodeIntegrationMethod = {
  id?: string;
  type?: string;
  label?: string;
  names?: string[];
  command?: string;
  form?: OpenCodeAuthFormField[];
};

export type OpenCodeIntegration = {
  id?: string;
  name?: string;
  methods?: OpenCodeIntegrationMethod[];
  connections?: unknown[];
};

/** Unwrapped `POST /api/integration/:id/connect/oauth` result. Never a credential. */
export type OpenCodeOAuthAttempt = {
  attemptID: string;
  url: string;
  instructions?: string;
  mode?: "auto" | "code" | string;
  paste?: boolean;
  time?: { created?: number; expires?: number };
};

export type OpenCodeOAuthAttemptStatus = {
  status?: "pending" | "complete" | "failed" | "expired" | string;
  message?: string;
  time?: { created?: number; expires?: number };
};

export class OpenCodeError extends Error {
  status: number;
  retryable: boolean;
  constructor(status: number, message: string, retryable = false) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status;
    this.retryable = retryable;
  }
}

export type ClientOptions = {
  baseUrl: string;
  username?: string;
  password?: string;
  fetch?: typeof fetch;
};

export class OpenCodeClient {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  private readonly fetchImpl: typeof fetch;
  private eventAbort: AbortController | null = null;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.username = options.username || "opencode";
    this.password = options.password || "";
    this.fetchImpl = options.fetch ?? fetch;
  }

  async connect(): Promise<OpenCodeHealth> {
    return this.getStatus();
  }

  disconnect(): void {
    this.eventAbort?.abort();
    this.eventAbort = null;
  }

  async getStatus(): Promise<OpenCodeHealth> {
    const info = (await this.request("GET", "/api/info")) as { version?: string } | null;
    return { healthy: true, version: info?.version };
  }

  async listSessions(directory: string, search?: string): Promise<OpenCodeSession[]> {
    return (await this.listSessionsPage(directory, search)).sessions;
  }

  /**
   * First page of `GET /api/session` (v2: `{ data, cursor }`, newest first).
   * v2.3.2 sets `cursor.next` on every non-empty page, including the last
   * one, so it cannot signal truncation. Instead an explicit `limit` is sent
   * and a full page (`data.length >= limit`) counts as possibly truncated:
   * absence from it proves nothing about a session id.
   */
  async listSessionsPage(directory: string, search?: string): Promise<{ sessions: OpenCodeSession[]; hasMore: boolean }> {
    const page = (await this.request("GET", "/api/session", {
      query: { directory, search, parentID: "null", order: "desc", limit: String(SESSION_PAGE_LIMIT) },
      unwrap: false,
    })) as { data?: unknown } | unknown[] | null;
    const sessions = Array.isArray(page) ? (page as OpenCodeSession[]) : asArray<OpenCodeSession>(page?.data);
    return { sessions, hasMore: sessions.length >= SESSION_PAGE_LIMIT };
  }

  async createSession(directory: string, title?: string): Promise<OpenCodeSession> {
    const body: Record<string, unknown> = { location: { directory } };
    if (title) body.title = title;
    return (await this.request("POST", "/api/session", { body })) as OpenCodeSession;
  }

  async getSession(_directory: string, sessionId: string): Promise<OpenCodeSession> {
    return (await this.request(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}`,
    )) as OpenCodeSession;
  }

  async updateSession(
    _directory: string,
    sessionId: string,
    patch: { title?: string; archived?: boolean },
  ): Promise<OpenCodeSession> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.archived !== undefined) body.archived = patch.archived;
    // v2 answers 204, so read the session back for the caller.
    await this.request("PATCH", `/api/session/${encodeURIComponent(sessionId)}`, { body });
    return this.getSession(_directory, sessionId);
  }

  async deleteSession(_directory: string, sessionId: string): Promise<void> {
    await this.request("DELETE", `/api/session/${encodeURIComponent(sessionId)}`);
  }

  async sendMessage(
    _directory: string,
    sessionId: string,
    input: { text: string; providerID?: string; modelID?: string; agent?: string },
  ): Promise<void> {
    const id = encodeURIComponent(sessionId);
    if (input.providerID && input.modelID) {
      await this.request("POST", `/api/session/${id}/model`, {
        body: { model: { id: input.modelID, providerID: input.providerID } },
      });
    }
    if (input.agent) {
      await this.request("POST", `/api/session/${id}/agent`, { body: { agent: input.agent } });
    }
    await this.request("POST", `/api/session/${id}/prompt`, { body: { text: input.text } });
  }

  async abortSession(_directory: string, sessionId: string): Promise<void> {
    await this.request("POST", `/api/session/${encodeURIComponent(sessionId)}/interrupt`);
  }

  async listMessages(_directory: string, sessionId: string): Promise<OpenCodeMessage[]> {
    const path = `/api/session/${encodeURIComponent(sessionId)}/message`;
    const messages: OpenCodeMessage[] = [];
    let page = (await this.request("GET", path, {
      query: { order: "asc" },
      unwrap: false,
    })) as { data?: OpenCodeMessage[]; cursor?: { next?: string } } | null;
    messages.push(...asArray<OpenCodeMessage>(page?.data));
    let next = page?.cursor?.next;
    // Follow the ascending cursor so long sessions keep their older turns.
    for (let guard = 0; next && guard < 40; guard++) {
      page = (await this.request("GET", path, {
        query: { cursor: next },
        unwrap: false,
      })) as { data?: OpenCodeMessage[]; cursor?: { next?: string } } | null;
      messages.push(...asArray<OpenCodeMessage>(page?.data));
      next = page?.cursor?.next;
    }
    return messages;
  }

  async deleteMessage(
    _directory: string,
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    await this.request(
      "DELETE",
      `/api/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}`,
    );
  }

  /**
   * v2 session revert (`POST /api/session/:id/revert/stage`, body `{ messageID }`).
   * Staging marks the reversible boundary at that message; committing it is what
   * drops the transcript from that message onward. `files` is omitted on purpose:
   * editing a prompt rewinds the conversation, not the working tree.
   */
  async stageRevert(_directory: string, sessionId: string, messageId: string): Promise<void> {
    await this.request("POST", `/api/session/${encodeURIComponent(sessionId)}/revert/stage`, {
      body: { messageID: messageId },
    });
  }

  /** Commit the staged revert (`POST …/revert/commit`, 204): the boundary becomes permanent. */
  async commitRevert(_directory: string, sessionId: string): Promise<void> {
    await this.request("POST", `/api/session/${encodeURIComponent(sessionId)}/revert/commit`);
  }

  /** Drop a staged revert without applying it (`DELETE …/revert`, 204); cleanup for a failed edit. */
  async clearRevert(_directory: string, sessionId: string): Promise<void> {
    await this.request("DELETE", `/api/session/${encodeURIComponent(sessionId)}/revert`);
  }

  /**
   * v2 `GET /api/session/:id/diff` → `{ data: FileDiff.Info[] }` (file, patch,
   * additions, deletions, status, optional more). Per turn: `from` is the user
   * message whose turn to diff, `to` extends through a later turn.
   */
  async getDiff(_directory: string, sessionId: string, range: DiffRange = {}): Promise<unknown[]> {
    const data = await this.request(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/diff`,
      { query: { from: range.from, to: range.to, context: String(DIFF_CONTEXT_LINES) }, maxBytes: MAX_DIFF_UPSTREAM_BYTES },
    );
    return asArray<unknown>(data);
  }

  /**
   * v2 returns an array of config documents. Merge their `info` objects so the
   * desk can keep reading a flat `{ model, mcp, agent, ... }` shape.
   */
  async getConfig(directory?: string): Promise<Record<string, unknown>> {
    const query = locationQuery(directory);
    const docs = await this.request("GET", "/api/config", { query });
    const merged: Record<string, unknown> = {};
    for (const doc of asArray<Record<string, unknown>>(docs)) {
      const info = doc.info;
      if (info && typeof info === "object" && !Array.isArray(info)) {
        Object.assign(merged, info as Record<string, unknown>);
      }
    }
    if (typeof merged.model !== "string") {
      const model = await this.defaultModel(query).catch(() => null);
      if (model) merged.model = model;
    }
    return merged;
  }

  async listModels(directory?: string): Promise<OpenCodeModelInfo[]> {
    const data = await this.request("GET", "/api/model", { query: locationQuery(directory) });
    return asArray<OpenCodeModelInfo>(data);
  }

  async getDefaultModel(directory?: string): Promise<OpenCodeModelInfo | null> {
    const data = await this.request("GET", "/api/model/default", {
      query: locationQuery(directory),
    });
    return data && typeof data === "object" ? (data as OpenCodeModelInfo) : null;
  }

  async listCommands(directory?: string): Promise<OpenCodeCommand[]> {
    const data = await this.request("GET", "/api/command", { query: locationQuery(directory) });
    return asArray<OpenCodeCommand>(data);
  }

  async runCommand(
    _directory: string,
    sessionId: string,
    input: { name: string; text: string },
  ): Promise<void> {
    await this.request("POST", `/api/session/${encodeURIComponent(sessionId)}/command`, {
      body: { name: input.name, text: input.text },
    });
  }

  /**
   * `GET /api/provider` raw provider entries. Unlike `getProviders`, this keeps
   * OpenCode's provider-listed models (including ones absent from the smaller
   * `/api/model` picker catalog) so the controller can validate additions.
   */
  async getProviderCatalog(directory?: string): Promise<OpenCodeProviderInfo[]> {
    const data = await this.request("GET", "/api/provider", { query: locationQuery(directory) });
    return asArray<OpenCodeProviderInfo>(data);
  }

  async getProviders(directory?: string): Promise<unknown> {
    const query = locationQuery(directory);
    const [providerList, modelList, integrations, defaultModel] = await Promise.all([
      this.request("GET", "/api/provider", { query }),
      this.request("GET", "/api/model", { query }).catch(() => []),
      this.request("GET", "/api/integration", { query }).catch(() => []),
      this.request("GET", "/api/model/default", { query }).catch(() => null),
    ]);
    const providers = asArray<Record<string, unknown>>(providerList);
    const models = asArray<OpenCodeModel>(modelList);
    const connectedIds = new Set(
      asArray<Record<string, unknown>>(integrations)
        .filter((item) => Array.isArray(item.connections) && item.connections.length > 0)
        .map((item) => String(item.id ?? "")),
    );
    const connectedProviderIds = providers
      .filter((provider) => connectedIds.has(String(provider.integrationID ?? provider.id ?? "")))
      .map((provider) => String(provider.id ?? ""));
    const all = providers.map((provider) => {
      const id = String(provider.id ?? "");
      const integrationID = String(provider.integrationID ?? id);
      // Prefer the provider's own models. Those carry the authoritative
      // providerID/type/enabled metadata and include models the `/api/model`
      // picker catalog omits. The `/api/model` match stays as a fallback for
      // older servers/tests whose provider entry has no `models` record.
      const providerModels: Record<string, Record<string, unknown>> = {};
      const rawModels =
        provider.models && typeof provider.models === "object"
          ? (provider.models as Record<string, OpenCodeProviderModel>)
          : {};
      if (Object.keys(rawModels).length > 0) {
        for (const [key, model] of Object.entries(rawModels)) {
          const modelId = model?.modelID ?? model?.id ?? key;
          if (!modelId) continue;
          providerModels[modelId] = projectProviderModel(model ?? {}, modelId);
        }
      } else {
        for (const model of models) {
          if (model.providerID !== id && model.providerID !== integrationID) continue;
          const key = model.modelID ?? model.id ?? "";
          if (!key) continue;
          providerModels[key] = projectProviderModel(model, key);
        }
      }
      return { ...provider, models: providerModels };
    });
    const defaults: Record<string, string> = {};
    const fallback = defaultModel as OpenCodeModel | null;
    if (fallback?.providerID) {
      const modelId = fallback.modelID ?? fallback.id;
      if (modelId) defaults[fallback.providerID] = modelId;
    }
    return {
      all,
      default: defaults,
      connected: connectedProviderIds,
    };
  }

  /** `GET /api/integration`: methods and their form schema. Credentials live in
   *  `connections`, which this method deliberately does not return. */
  async listIntegrations(directory?: string): Promise<OpenCodeIntegration[]> {
    const data = await this.request("GET", "/api/integration", {
      query: locationQuery(directory),
    });
    return asArray<OpenCodeIntegration>(data);
  }

  /**
   * v2 lists integrations and their auth methods. Map them back to the
   * provider -> method list the desk renders; never expose credentials.
   * Method ids, exact types and form schema are preserved for OAuth/metadata.
   */
  async getProviderAuth(directory?: string): Promise<unknown> {
    const integrations = await this.listIntegrations(directory);
    const auth: Record<string, Array<Record<string, unknown>>> = {};
    for (const integration of integrations) {
      const id = String(integration.id ?? "");
      const methods = asArray<OpenCodeIntegrationMethod>(integration.methods);
      if (!id || !methods.length) continue;
      auth[id] = methods.map((method) => projectAuthMethod(method));
    }
    return auth;
  }

  /** Start an OpenCode-managed OAuth attempt; the authorization URL is upstream-owned. */
  async startOAuthConnect(
    directory: string | undefined,
    integrationID: string,
    input: { methodID: string; answer?: Record<string, unknown>; label?: string },
  ): Promise<OpenCodeOAuthAttempt> {
    const body: Record<string, unknown> = { methodID: input.methodID };
    if (input.answer !== undefined) body.answer = input.answer;
    if (input.label !== undefined) body.label = input.label;
    return (await this.request(
      "POST",
      `/api/integration/${encodeURIComponent(integrationID)}/connect/oauth`,
      { query: locationQuery(directory), body },
    )) as OpenCodeOAuthAttempt;
  }

  async getOAuthConnectStatus(
    directory: string | undefined,
    integrationID: string,
    attemptID: string,
  ): Promise<OpenCodeOAuthAttemptStatus> {
    return (await this.request(
      "GET",
      `/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}`,
      { query: locationQuery(directory) },
    )) as OpenCodeOAuthAttemptStatus;
  }

  async completeOAuthConnect(
    directory: string | undefined,
    integrationID: string,
    attemptID: string,
    code?: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}/complete`,
      { query: locationQuery(directory), body: code === undefined ? {} : { code } },
    );
  }

  async cancelOAuthConnect(
    directory: string | undefined,
    integrationID: string,
    attemptID: string,
  ): Promise<void> {
    await this.request(
      "DELETE",
      `/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}`,
      { query: locationQuery(directory) },
    );
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    await this.request("POST", "/api/credential", {
      body: { integrationID: providerId, value: { type: "key", key }, activate: true },
    });
  }

  async removeApiKey(providerId: string): Promise<void> {
    const data = await this.request("GET", "/api/credential");
    for (const entry of asArray<Record<string, unknown>>(data)) {
      if (entry.integrationID !== providerId) continue;
      const id = String(entry.id ?? "");
      if (id) await this.request("DELETE", `/api/credential/${encodeURIComponent(id)}`);
    }
  }

  async getAgents(directory?: string): Promise<unknown> {
    return this.request("GET", "/api/agent", { query: locationQuery(directory) });
  }

  /**
   * v2 returns `{ location, data: Mcp.Server[] }`. The desk renders a record
   * keyed by server name, so adapt here.
   */
  async getMcp(directory?: string): Promise<unknown> {
    const data = await this.request("GET", "/api/mcp", { query: locationQuery(directory) });
    const servers: Record<string, { status: string; error?: string }> = {};
    for (const server of asArray<OpenCodeMcpServer>(data)) {
      if (!server.name) continue;
      const status = server.status ?? {};
      servers[server.name] = {
        status: String(status.status ?? "unknown"),
        ...(status.error ? { error: status.error } : {}),
      };
    }
    return servers;
  }

  async addMcp(
    directory: string | undefined,
    name: string,
    config: Record<string, unknown>,
  ): Promise<unknown> {
    const { enabled, ...rest } = config as { enabled?: boolean } & Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...rest };
    if (enabled !== undefined) normalized.disabled = !enabled;
    return this.request("PUT", `/api/experimental/mcp/${encodeURIComponent(name)}`, {
      query: locationQuery(directory),
      body: { config: normalized },
    });
  }

  async connectMcp(directory: string | undefined, name: string): Promise<void> {
    await this.request("POST", `/api/experimental/mcp/${encodeURIComponent(name)}/connect`, {
      query: locationQuery(directory),
    });
  }

  async disconnectMcp(directory: string | undefined, name: string): Promise<void> {
    await this.request("POST", `/api/experimental/mcp/${encodeURIComponent(name)}/disconnect`, {
      query: locationQuery(directory),
    });
  }

  async listPermissions(directory?: string): Promise<OpenCodePermission[]> {
    const data = await this.request("GET", "/api/permission/request", {
      query: locationQuery(directory),
    });
    return asArray<OpenCodePermission>(data);
  }

  async replyPermission(
    _directory: string | undefined,
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
  ): Promise<void> {
    if (!sessionId) throw new OpenCodeError(400, "A session ID is required to reply to a permission");
    await this.request(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
      { body: { decision: reply } },
    );
  }

  async listQuestions(directory?: string): Promise<OpenCodeForm[]> {
    const data = await this.request("GET", "/api/form", { query: locationQuery(directory) });
    return asArray<OpenCodeForm>(data);
  }

  async replyQuestion(
    directory: string | undefined,
    sessionId: string,
    formId: string,
    answer: string,
  ): Promise<void> {
    if (!sessionId) throw new OpenCodeError(400, "A session ID is required to answer a question");
    const forms = await this.listQuestions(directory);
    const form = forms.find((item) => item.id === formId);
    const fields = Array.isArray(form?.fields) ? form.fields : [];
    const field = fields.find((item) => !item.hidden && item.key) ?? fields.find((item) => item.key);
    if (!field?.key) throw new OpenCodeError(404, "Question form was not found");
    await this.request(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formId)}/reply`,
      { body: { answer: { [field.key]: coerceAnswer(field, answer) } } },
    );
  }

  async rejectQuestion(
    _directory: string | undefined,
    sessionId: string,
    formId: string,
  ): Promise<void> {
    if (!sessionId) throw new OpenCodeError(400, "A session ID is required to cancel a question");
    await this.request(
      "DELETE",
      `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formId)}`,
    );
  }

  async getVcs(directory: string): Promise<unknown> {
    const data = (await this.request("GET", "/api/vcs", {
      query: locationQuery(directory),
    })) as Record<string, unknown> | null;
    const branch = data?.branch as { current?: string } | undefined;
    return { branch: branch?.current ?? null };
  }

  async getFileStatus(directory: string): Promise<unknown> {
    return this.request("GET", "/api/vcs/status", { query: locationQuery(directory) });
  }

  /**
   * Subscribe to the v2 event stream. Calls onEvent for each parsed payload.
   * Resolves when the stream ends. Throws on connection failure.
   */
  async subscribeToEvents(onEvent: (event: unknown) => void, signal?: AbortSignal): Promise<void> {
    this.eventAbort?.abort();
    const controller = new AbortController();
    this.eventAbort = controller;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/event`, {
        headers: this.headers({ accept: "text/event-stream" }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new OpenCodeError(
          response.status,
          `Event stream failed (${response.status})`,
          response.status >= 500,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data) continue;
          try {
            onEvent(JSON.parse(data));
          } catch {
            onEvent({ type: "malformed", raw: data.slice(0, 200) });
          }
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (this.eventAbort === controller) this.eventAbort = null;
    }
  }

  private defaultModel(query: Record<string, string | undefined>): Promise<string | null> {
    return this.request("GET", "/api/model/default", { query }).then((data) => {
      const model = data as OpenCodeModel | null;
      const id = model?.modelID ?? model?.id;
      return model?.providerID && id ? `${model.providerID}/${id}` : null;
    });
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json", ...extra };
    if (this.password) {
      headers.authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    }
    return headers;
  }

  private async request(
    method: string,
    path: string,
    init?: { query?: Record<string, string | undefined>; body?: unknown; unwrap?: boolean; maxBytes?: number },
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(init?.query ?? {})) {
      if (value) url.searchParams.set(key, value);
    }
    const headers = this.headers();
    let body: string | undefined;
    if (init?.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body });
    } catch (err) {
      throw new OpenCodeError(0, err instanceof Error ? err.message : "OpenCode is unavailable", true);
    }
    if (response.status === 204) return null;
    const text = init?.maxBytes === undefined ? await response.text() : await readCapped(response, init.maxBytes);
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 300) };
      }
    }
    if (!response.ok) {
      throw new OpenCodeError(
        response.status,
        errorMessage(data, response.status),
        response.status >= 500 || response.status === 0,
      );
    }
    return init?.unwrap === false ? data : unwrapData(data);
  }
}

/**
 * Read a body as text, giving up once it passes `maxBytes`. Streams when the
 * body is a ReadableStream, so an oversized response is never held in full.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new OpenCodeError(502, `The diff is too large to load (over ${Math.round(maxBytes / (1024 * 1024))} MB)`, false);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      // A reset mid-body is a transport failure like a refused connection: retryable 503.
      throw new OpenCodeError(0, err instanceof Error ? err.message : "OpenCode closed the connection", true);
    }
    const { done, value } = chunk;
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function unwrapData(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data) && "data" in data) {
    return (data as { data: unknown }).data;
  }
  return data;
}

/** Page size for the session list; matches OpenCode v2.3.2's documented default ("newest 50"). */
export const SESSION_PAGE_LIMIT = 50;

/** Browser-safe projection of a provider-listed model: no settings, costs, or
 *  vendor request bodies. */
function projectProviderModel(model: OpenCodeProviderModel, id: string): Record<string, unknown> {
  const projected: Record<string, unknown> = { id };
  if (typeof model.modelID === "string" && model.modelID) projected.modelID = model.modelID;
  if (typeof model.providerID === "string" && model.providerID) projected.providerID = model.providerID;
  if (typeof model.name === "string" && model.name) projected.name = model.name;
  if (typeof model.type === "string" && model.type) projected.type = model.type;
  if (typeof model.enabled === "boolean") projected.enabled = model.enabled;
  if (typeof model.status === "string" && model.status) projected.status = model.status;
  if (model.limit && typeof model.limit === "object") {
    const limit: Record<string, number> = {};
    for (const key of ["context", "input", "output"] as const) {
      const value = model.limit[key];
      if (typeof value === "number") limit[key] = value;
    }
    if (Object.keys(limit).length) projected.limit = limit;
  }
  if (typeof model.time?.released === "number") projected.time = { released: model.time.released };
  if (model.capabilities && typeof model.capabilities === "object") {
    const capabilities: Record<string, unknown> = {};
    for (const key of ["tools", "reasoning", "attachment", "temperature"] as const) {
      if (typeof model.capabilities[key] === "boolean") capabilities[key] = model.capabilities[key];
    }
    for (const key of ["input", "output"] as const) {
      if (Array.isArray(model.capabilities[key])) {
        capabilities[key] = (model.capabilities[key] as unknown[]).filter((item) => typeof item === "string");
      }
    }
    if (Object.keys(capabilities).length) projected.capabilities = capabilities;
  }
  if (Array.isArray(model.variants)) projected.variantCount = model.variants.length;
  return projected;
}

/** Project an integration auth method: keep the id/type/label/form schema the
 *  UI needs, never `connections` or any credential value. */
function projectAuthMethod(method: OpenCodeIntegrationMethod): Record<string, unknown> {
  const type = typeof method.type === "string" ? method.type : "";
  const names = Array.isArray(method.names) ? method.names.filter((item) => typeof item === "string") : [];
  const projected: Record<string, unknown> = {
    type,
    label:
      (typeof method.label === "string" && method.label) ||
      (names.length ? names.join(", ") : type === "key" ? "API key" : type),
  };
  if (typeof method.id === "string" && method.id) projected.id = method.id;
  if (Array.isArray(method.form)) {
    projected.form = method.form
      .map((field) => projectAuthFormField(field))
      .filter((field): field is Record<string, unknown> => field !== null);
  }
  return projected;
}

function projectAuthFormField(field: OpenCodeAuthFormField): Record<string, unknown> | null {
  if (!field || typeof field !== "object") return null;
  const type = typeof field.type === "string" ? field.type : "";
  if (!type) return null;
  const projected: Record<string, unknown> = { type };
  for (const key of ["key", "title", "description", "format", "placeholder", "pattern"] as const) {
    if (typeof field[key] === "string" && field[key]) projected[key] = field[key];
  }
  for (const key of ["required", "hidden", "custom"] as const) {
    if (typeof field[key] === "boolean") projected[key] = field[key];
  }
  for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"] as const) {
    if (typeof field[key] === "number") projected[key] = field[key];
  }
  // Hidden fields are filled by OpenCode; never echo a possible default.
  if (!field.hidden && isScalarOrScalarArray(field.default)) projected.default = field.default;
  if (Array.isArray(field.options)) {
    projected.options = field.options
      .slice(0, 200)
      .flatMap((option) => {
        if (!option || typeof option !== "object" || !isScalar(option.value)) return [];
        const clean: Record<string, unknown> = { value: option.value };
        if (typeof option.label === "string") clean.label = option.label;
        if (typeof option.description === "string") clean.description = option.description;
        return [clean];
      });
  }
  if (Array.isArray(field.when)) {
    projected.when = field.when
      .slice(0, 50)
      .flatMap((condition) => {
        if (!condition || typeof condition !== "object") return [];
        if (typeof condition.key !== "string" || !isScalar(condition.value)) return [];
        return [{ key: condition.key, op: condition.op, value: condition.value }];
      });
  }
  if (typeof field.url === "string" && field.url) projected.url = field.url;
  return projected;
}

function isScalar(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isScalarOrScalarArray(value: unknown): boolean {
  if (value === undefined) return false;
  if (isScalar(value)) return true;
  return Array.isArray(value) && value.every((item) => isScalar(item));
}

function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function locationQuery(directory?: string): Record<string, string | undefined> {
  return directory ? { "location[directory]": directory } : {};
}

function coerceAnswer(field: OpenCodeFormField, answer: string): unknown {
  const trimmed = answer.trim();
  if (field.type === "boolean") return trimmed === "true" || trimmed === "yes" || trimmed === "y";
  if (field.type === "number" || field.type === "integer") {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : trimmed;
  }
  if (field.type === "multiselect") return trimmed ? trimmed.split(",").map((item) => item.trim()) : [];
  return answer;
}

export function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nested = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : null;
    const error = record.error;
    const fromError =
      typeof error === "string"
        ? error
        : error && typeof error === "object"
          ? (error as Record<string, unknown>).message
          : undefined;
    const message =
      (typeof fromError === "string" && fromError) ||
      (typeof nested?.message === "string" && nested.message) ||
      (typeof record.message === "string" && record.message) ||
      (typeof record.name === "string" && record.name);
    if (message) return message;
  }
  if (status === 401) return "OpenCode rejected the controller credentials";
  if (status === 0) return "OpenCode is unavailable";
  return `OpenCode request failed (${status})`;
}
