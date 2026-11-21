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
};

export type OpenCodeModel = {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  status?: string;
  capabilities?: { reasoning?: boolean; attachment?: boolean; toolcall?: boolean };
  limit?: { context?: number; input?: number; output?: number };
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
    const data = await this.request("GET", "/api/session", {
      query: { directory, search, parentID: "null", order: "desc" },
    });
    return asArray<OpenCodeSession>(data);
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

  async getDiff(_directory: string, sessionId: string): Promise<unknown[]> {
    const data = await this.request(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/diff`,
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

  async updateConfig(
    patch: Record<string, unknown>,
    directory?: string,
  ): Promise<Record<string, unknown>> {
    // v2 only exposes PATCH /api/config/shell-ish writes; keep the v1-shaped
    // call so callers get an explicit error instead of a silent no-op.
    const data = await this.request("PATCH", "/api/config", {
      query: locationQuery(directory),
      body: patch,
    });
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
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
      const providerModels: Record<string, OpenCodeModel> = {};
      for (const model of models) {
        if (model.providerID !== id && model.providerID !== integrationID) continue;
        const key = model.modelID ?? model.id ?? "";
        if (!key) continue;
        providerModels[key] = { ...model, id: model.modelID ?? model.id };
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

  /**
   * v2 lists integrations and their auth methods. Map them back to the
   * provider -> method list the desk renders; never expose credentials.
   */
  async getProviderAuth(directory?: string): Promise<unknown> {
    const data = await this.request("GET", "/api/integration", {
      query: locationQuery(directory),
    });
    const auth: Record<string, { type: string; label: string }[]> = {};
    for (const integration of asArray<Record<string, unknown>>(data)) {
      const id = String(integration.id ?? "");
      const methods = asArray<Record<string, unknown>>(integration.methods);
      if (!id || !methods.length) continue;
      auth[id] = methods.map((method) => {
        const type = String(method.type ?? "");
        const names = Array.isArray(method.names) ? method.names.map(String) : [];
        return {
          type: type === "key" ? "api" : type,
          label:
            (typeof method.label === "string" && method.label) ||
            (names.length ? names.join(", ") : type === "key" ? "API key" : type),
        };
      });
    }
    return auth;
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
    init?: { query?: Record<string, string | undefined>; body?: unknown; unwrap?: boolean },
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
    const text = await response.text();
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

function unwrapData(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data) && "data" in data) {
    return (data as { data: unknown }).data;
  }
  return data;
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
