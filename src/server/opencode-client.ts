/**
 * OpenCodeClient talks to the installed OpenCode HTTP server.
 * Paths match the OpenAPI spec served by `opencode serve` (classic + permission reply).
 * Unsupported calls surface as errors instead of invented endpoints.
 */

export type OpenCodeHealth = { healthy?: boolean; version?: string };

export type OpenCodeSession = {
  id: string;
  title?: string;
  directory?: string;
  path?: string;
  time?: { created?: number; updated?: number; archived?: number };
  summary?: { additions?: number; deletions?: number; files?: number };
};

export type OpenCodePart = {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
  };
  error?: { data?: { message?: string }; name?: string };
};

export type OpenCodeMessage = {
  info: {
    id: string;
    role?: string;
    time?: { created?: number; completed?: number };
    error?: { data?: { message?: string }; name?: string };
  };
  parts?: OpenCodePart[];
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
    return (await this.request("GET", "/global/health")) as OpenCodeHealth;
  }

  async listSessions(directory: string, search?: string): Promise<OpenCodeSession[]> {
    const data = await this.request("GET", "/session", {
      query: { directory, search, roots: "true" },
    });
    return Array.isArray(data) ? (data as OpenCodeSession[]) : [];
  }

  async createSession(directory: string, title?: string): Promise<OpenCodeSession> {
    return (await this.request("POST", "/session", {
      query: { directory },
      body: title ? { title } : {},
    })) as OpenCodeSession;
  }

  async getSession(directory: string, sessionId: string): Promise<OpenCodeSession> {
    return (await this.request("GET", `/session/${encodeURIComponent(sessionId)}`, {
      query: { directory },
    })) as OpenCodeSession;
  }

  async updateSession(
    directory: string,
    sessionId: string,
    patch: { title?: string; archived?: boolean },
  ): Promise<OpenCodeSession> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.archived === true) body.time = { archived: Date.now() };
    if (patch.archived === false) body.time = { archived: 0 };
    return (await this.request("PATCH", `/session/${encodeURIComponent(sessionId)}`, {
      query: { directory },
      body,
    })) as OpenCodeSession;
  }

  async deleteSession(directory: string, sessionId: string): Promise<void> {
    await this.request("DELETE", `/session/${encodeURIComponent(sessionId)}`, {
      query: { directory },
    });
  }

  async sendMessage(
    directory: string,
    sessionId: string,
    input: { text: string; providerID?: string; modelID?: string; agent?: string },
  ): Promise<void> {
    const body: Record<string, unknown> = {
      parts: [{ type: "text", text: input.text }],
    };
    if (input.providerID && input.modelID) {
      body.model = { providerID: input.providerID, modelID: input.modelID };
    }
    if (input.agent) body.agent = input.agent;
    await this.request("POST", `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      query: { directory },
      body,
    });
  }

  async abortSession(directory: string, sessionId: string): Promise<void> {
    await this.request("POST", `/session/${encodeURIComponent(sessionId)}/abort`, {
      query: { directory },
    });
  }

  async listMessages(directory: string, sessionId: string): Promise<OpenCodeMessage[]> {
    const data = await this.request("GET", `/session/${encodeURIComponent(sessionId)}/message`, {
      query: { directory },
    });
    return Array.isArray(data) ? (data as OpenCodeMessage[]) : [];
  }

  async deleteMessage(directory: string, sessionId: string, messageId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}`,
      { query: { directory } },
    );
  }

  async getDiff(directory: string, sessionId: string): Promise<unknown> {
    return this.request("GET", `/session/${encodeURIComponent(sessionId)}/diff`, {
      query: { directory },
    });
  }

  async getConfig(directory?: string): Promise<Record<string, unknown>> {
    const data = await this.request("GET", "/config", {
      query: directory ? { directory } : undefined,
    });
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  }

  async updateConfig(patch: Record<string, unknown>, directory?: string): Promise<Record<string, unknown>> {
    const data = await this.request("PATCH", "/config", {
      query: directory ? { directory } : undefined,
      body: patch,
    });
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  }

  async getProviders(directory?: string): Promise<unknown> {
    return this.request("GET", "/provider", { query: directory ? { directory } : undefined });
  }

  async getProviderAuth(directory?: string): Promise<unknown> {
    return this.request("GET", "/provider/auth", { query: directory ? { directory } : undefined });
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    await this.request("PUT", `/auth/${encodeURIComponent(providerId)}`, {
      body: { type: "api", key },
    });
  }

  async removeApiKey(providerId: string): Promise<void> {
    await this.request("DELETE", `/auth/${encodeURIComponent(providerId)}`);
  }

  async getAgents(directory?: string): Promise<unknown> {
    return this.request("GET", "/agent", { query: directory ? { directory } : undefined });
  }

  async getMcp(directory?: string): Promise<unknown> {
    return this.request("GET", "/mcp", { query: directory ? { directory } : undefined });
  }

  async addMcp(directory: string | undefined, name: string, config: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/mcp", {
      query: directory ? { directory } : undefined,
      body: { name, config },
    });
  }

  async connectMcp(directory: string | undefined, name: string): Promise<void> {
    await this.request("POST", `/mcp/${encodeURIComponent(name)}/connect`, {
      query: directory ? { directory } : undefined,
    });
  }

  async disconnectMcp(directory: string | undefined, name: string): Promise<void> {
    await this.request("POST", `/mcp/${encodeURIComponent(name)}/disconnect`, {
      query: directory ? { directory } : undefined,
    });
  }

  async listPermissions(directory?: string): Promise<unknown[]> {
    const data = await this.request("GET", "/permission", {
      query: directory ? { directory } : undefined,
    });
    return Array.isArray(data) ? data : [];
  }

  async replyPermission(
    directory: string | undefined,
    requestId: string,
    reply: "once" | "always" | "reject",
    sessionId?: string,
  ): Promise<void> {
    try {
      await this.request("POST", `/permission/${encodeURIComponent(requestId)}/reply`, {
        query: directory ? { directory } : undefined,
        body: { reply },
      });
    } catch (err) {
      if (!(err instanceof OpenCodeError) || !sessionId || (err.status !== 404 && err.status !== 400)) {
        throw err;
      }
      await this.request(
        "POST",
        `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`,
        { query: directory ? { directory } : undefined, body: { response: reply } },
      );
    }
  }

  async listQuestions(directory?: string): Promise<unknown[]> {
    const data = await this.request("GET", "/question", {
      query: directory ? { directory } : undefined,
    });
    return Array.isArray(data) ? data : [];
  }

  async replyQuestion(directory: string | undefined, requestId: string, answers: string[][]): Promise<void> {
    await this.request("POST", `/question/${encodeURIComponent(requestId)}/reply`, {
      query: directory ? { directory } : undefined,
      body: { answers },
    });
  }

  async rejectQuestion(directory: string | undefined, requestId: string): Promise<void> {
    await this.request("POST", `/question/${encodeURIComponent(requestId)}/reject`, {
      query: directory ? { directory } : undefined,
    });
  }

  async getVcs(directory: string): Promise<unknown> {
    return this.request("GET", "/vcs", { query: { directory } });
  }

  async getFileStatus(directory: string): Promise<unknown> {
    return this.request("GET", "/file/status", { query: { directory } });
  }

  /**
   * Subscribe to the global SSE stream. Calls onEvent for each parsed payload.
   * Resolves when the stream ends. Throws on connection failure.
   */
  async subscribeToEvents(onEvent: (event: unknown) => void, signal?: AbortSignal): Promise<void> {
    this.eventAbort?.abort();
    const controller = new AbortController();
    this.eventAbort = controller;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/global/event`, {
        headers: this.headers({ accept: "text/event-stream" }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new OpenCodeError(response.status, `Event stream failed (${response.status})`, response.status >= 500);
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
    init?: { query?: Record<string, string | undefined>; body?: unknown },
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
      throw new OpenCodeError(response.status, errorMessage(data, response.status), response.status >= 500 || response.status === 0);
    }
    return data;
  }
}

export function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nested = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : null;
    const message =
      (typeof nested?.message === "string" && nested.message) ||
      (typeof record.message === "string" && record.message) ||
      (typeof record.name === "string" && record.name);
    if (message) return message;
  }
  if (status === 401) return "OpenCode rejected the controller credentials";
  if (status === 0) return "OpenCode is unavailable";
  return `OpenCode request failed (${status})`;
}
