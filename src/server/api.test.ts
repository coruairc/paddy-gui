import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "./api.ts";
import { OpenCodeError } from "./opencode-client.ts";
import { ControllerRuntime } from "./runtime.ts";
import { newId } from "./state.ts";

function runtimeWithProject() {
  const root = mkdtempSync(join(tmpdir(), "ocw-api-"));
  const project = join(root, "app");
  mkdirSync(project);
  const file = join(root, "state.json");
  const runtime = new ControllerRuntime(file);
  const id = newId("prj");
  runtime.state.projects = [{ id, name: "App", path: project, createdAt: 1 }];
  runtime.state.activeProjectId = id;
  runtime.status = {
    installed: true,
    connected: true,
    healthy: true,
    startedByController: false,
    authRequired: false,
    controllerVersion: "0.2.0",
    version: "1.18.33",
  };
  const calls: string[] = [];
  runtime.client = {
    listSessions: async () => {
      calls.push("list");
      return [{ id: "ses_1", title: "Authentication bug", time: { created: 10, updated: 20 } }];
    },
    listSessionsPage: async () => {
      calls.push("list");
      return { sessions: [{ id: "ses_1", title: "Authentication bug", time: { created: 10, updated: 20 } }], hasMore: false };
    },
    createSession: async () => {
      calls.push("create");
      return { id: "ses_2", title: "New chat", time: { created: 30, updated: 30 } };
    },
    getSession: async () => ({ id: "ses_1", title: "Authentication bug", time: { created: 10, updated: 20 } }),
    listMessages: async () => [{ id: "msg_1", type: "user", time: { created: 11 }, text: "Fix auth" }],
    getDiff: async () => [{ file: "src/auth.ts", additions: 2, deletions: 1, before: "a", after: "b" }],
    updateSession: async (_dir: string, _id: string, patch: { title?: string }) => ({
      id: "ses_1",
      title: patch.title ?? "Authentication bug",
      time: { created: 10, updated: 21 },
    }),
    deleteSession: async () => {
      calls.push("delete");
    },
    sendMessage: async () => {
      calls.push("send");
    },
    abortSession: async () => {
      calls.push("abort");
    },
    deleteMessage: async () => undefined,
    getConfig: async () => ({ model: "openai/gpt" }),
    listModels: async () => [
      {
        id: "gpt-6.2-astra",
        modelID: "gpt-6.2-astra",
        providerID: "openai",
        name: "GPT-6.2 Astra",
        status: "active",
        enabled: true,
        limit: { context: 628000, output: 128000 },
        time: { released: 1794960000000 },
        capabilities: { tools: true },
        variants: [{ id: "low" }, { id: "high" }],
      },
      {
        id: "gpt-6.2-astra-fast",
        modelID: "gpt-6.2-astra",
        providerID: "openai",
        name: "GPT-6.2 Astra Fast",
      },
      {
        id: "qwen4-max",
        modelID: "qwen4-max-preview",
        providerID: "alibaba-token-plan",
        name: "Qwen4 Max",
      },
    ],
    getDefaultModel: async () => ({
      id: "gemini-3",
      modelID: "gemini-3-preview",
      providerID: "google",
      name: "Gemini 3",
    }),
    listCommands: async () => [
      { name: "echo", description: "Repeat the arguments" },
      { name: "noargs" },
      { description: "nameless" },
    ],
    runCommand: async (_dir: string, _id: string, input: { name: string; text: string }) => {
      calls.push(`command:${input.name}:${input.text}`);
    },
    setApiKey: async () => {
      calls.push("set-key");
    },
    getProviders: async () => ({
      all: [{ id: "alibaba-token-plan", models: {} }],
      connected: ["alibaba-token-plan"],
      default: {},
      key: "sk-should-not-leak",
    }),
    getProviderAuth: async () => ({ openai: [{ type: "api", label: "API key" }] }),
    getAgents: async () => [],
    getMcp: async () => ({}),
    listPermissions: async () => [],
    listQuestions: async () => [],
    getVcs: async () => ({ branch: "main" }),
    getFileStatus: async () => [],
    replyPermission: async () => {
      calls.push("replyPermission");
    },
    replyQuestion: async () => {
      calls.push("replyQuestion");
    },
    rejectQuestion: async () => {
      calls.push("rejectQuestion");
    },
  } as unknown as ControllerRuntime["client"];
  return { runtime, calls, project };
}

async function call(runtime: ControllerRuntime, method: string, path: string, body?: unknown) {
  const request = new Request("http://127.0.0.1:8080" + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
  const result = await handleApi(runtime, request);
  return result;
}

test("new session, resume, and rename stay on OpenCode", async () => {
  const { runtime, calls } = runtimeWithProject();
  const created = await call(runtime, "POST", "/api/sessions", {});
  assert.equal(created.status, 201);
  assert.equal(calls.includes("create"), true);
  const opened = await call(runtime, "GET", "/api/sessions/ses_1");
  assert.equal(opened.status, 200);
  const body = opened.body as { messages: { text: string }[] };
  assert.equal(body.messages[0].text, "Fix auth");
  const renamed = await call(runtime, "PATCH", "/api/sessions/ses_1", { title: "API refactor" });
  assert.equal((renamed.body as { session: { title: string } }).session.title, "API refactor");
});

test("project selection rejects paths outside the allowlist", async () => {
  const { runtime } = runtimeWithProject();
  const bad = await call(runtime, "POST", "/api/projects", { path: "/tmp/not-a-real-paddy-workspace" });
  assert.equal(bad.status, 400);
  const relative = await call(runtime, "POST", "/api/projects", { path: "relative" });
  assert.equal(relative.status, 400);
});

test("provider responses do not leak secrets and malformed bodies fail", async () => {
  const { runtime, calls } = runtimeWithProject();
  runtime.state.connectionPassword = "super-secret-password";
  const providers = await call(runtime, "GET", "/api/providers");
  assert.equal(JSON.stringify(providers.body).includes("sk-should-not-leak"), false);
  assert.equal(JSON.stringify(providers.body).includes("super-secret-password"), false);
  const request = new Request("http://127.0.0.1:8080/api/projects", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
  const malformed = await handleApi(runtime, request);
  assert.equal(malformed.status, 400);
  await call(runtime, "PUT", "/api/providers/openai/key", { key: "sk-new" });
  assert.equal(calls.includes("set-key"), true);
  const echoed = await call(runtime, "PUT", "/api/providers/openai/key", { key: "sk-new" });
  assert.equal(JSON.stringify(echoed.body).includes("sk-new"), false);
});

test("identifier payloads survive the providers route byte-identical", async () => {
  const { runtime } = runtimeWithProject();
  // Registers "token" as a needle via secretNeedles; it is a substring of the
  // provider id, so exact-match redaction must not corrupt the id (V2-03).
  // Boundary exercised: redactSecrets(providers, ...) at api.ts:286. Values
  // under provider-id KEYS (the default map) are intentionally not asserted —
  // key-based redaction clobbers those and that behavior is locked unchanged.
  runtime.state.connectionPassword = "token";
  const result = await call(runtime, "GET", "/api/providers");
  assert.equal(result.status, 200);
  const body = result.body as { providers: { all: { id: string }[]; connected: string[] } };
  assert.equal(body.providers.all[0].id, "alibaba-token-plan");
  assert.equal(body.providers.connected[0], "alibaba-token-plan");
});

test("model catalog projects a whitelisted, id-keyed payload", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "GET", "/api/models");
  assert.equal(result.status, 200);
  const body = result.body as {
    models: Record<string, unknown>[];
    default: string;
  };
  assert.deepEqual(
    body.models.map((model) => model.key),
    [
      "openai/gpt-6.2-astra",
      "openai/gpt-6.2-astra-fast",
      "alibaba-token-plan/qwen4-max",
    ],
  );
  // Duplicate modelID entries keep distinct keys.
  assert.equal(new Set(body.models.map((model) => model.key)).size, 3);
  // The default key is built from entry `id`, never `modelID`.
  assert.equal(body.default, "google/gemini-3");
  const first = body.models[0];
  assert.deepEqual(Object.keys(first).sort(), [
    "context",
    "enabled",
    "id",
    "key",
    "name",
    "providerID",
    "released",
    "status",
    "tools",
    "variantCount",
  ]);
  assert.equal(first.status, "active");
  assert.equal(first.context, 628000);
  assert.equal(first.released, 1794960000000);
  assert.equal(first.tools, true);
  assert.equal(first.variantCount, 2);
  const json = JSON.stringify(body);
  for (const banned of ["headers", "settings", "body", "package", "compatibility"]) {
    assert.equal(json.includes(`"${banned}"`), false, `${banned} must not cross the boundary`);
  }
});

test("model catalog degrades to an empty payload while disconnected", async () => {
  const { runtime } = runtimeWithProject();
  runtime.status.connected = false;
  runtime.client = null;
  const result = await call(runtime, "GET", "/api/models");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { models: [], default: "" });
});

test("model keys and default survive redaction with a registered needle", async () => {
  const { runtime } = runtimeWithProject();
  // "token" is a needle and a substring of the alibaba provider id; the
  // projection must rename identifiers to `key` only AFTER redaction.
  runtime.state.connectionPassword = "token";
  const result = await call(runtime, "GET", "/api/models");
  assert.equal(result.status, 200);
  const body = result.body as { models: { key: string }[]; default: string };
  assert.deepEqual(
    body.models.map((model) => model.key),
    [
      "openai/gpt-6.2-astra",
      "openai/gpt-6.2-astra-fast",
      "alibaba-token-plan/qwen4-max",
    ],
  );
  assert.equal(body.default, "google/gemini-3");
  assert.equal(JSON.stringify(body).includes('"modelKey"'), false);
});

test("command catalog projects name and description only", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "GET", "/api/commands");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    commands: [
      { name: "echo", description: "Repeat the arguments" },
      { name: "noargs", description: "" },
    ],
  });
});

test("command catalog degrades while disconnected", async () => {
  const { runtime } = runtimeWithProject();
  runtime.status.connected = false;
  runtime.client = null;
  const result = await call(runtime, "GET", "/api/commands");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { commands: [] });
});

test("command dispatch forwards args and accepts empty text", async () => {
  const { runtime, calls } = runtimeWithProject();
  const run = await call(runtime, "POST", "/api/sessions/ses_1/command", {
    name: "echo",
    text: "hello world",
  });
  assert.equal(run.status, 202);
  assert.equal(calls.includes("command:echo:hello world"), true);

  const noArgs = await call(runtime, "POST", "/api/sessions/ses_1/command", {
    name: "noargs",
    text: "",
  });
  assert.equal(noArgs.status, 202);
  assert.equal(calls.includes("command:noargs:"), true);

  const missing = await call(runtime, "POST", "/api/sessions/ses_1/command", { text: "x" });
  assert.equal(missing.status, 400);
});

test("command dispatch requires a selected project, same 400 as the prompt route", async () => {
  const { runtime, calls } = runtimeWithProject();
  runtime.state.activeProjectId = null;
  const command = await call(runtime, "POST", "/api/sessions/ses_other/command", { name: "echo", text: "" });
  const prompt = await call(runtime, "POST", "/api/sessions/ses_other/messages", { text: "hi" });
  assert.equal(command.status, 400);
  assert.equal(prompt.status, 400);
  assert.deepEqual(command.body, prompt.body);
  assert.equal((command.body as { error: string }).error, "Select a project first");
  assert.equal(calls.some((item) => item.startsWith("command:")), false);
});

test("command dispatch rejects a project that is no longer allowlisted", async () => {
  const { runtime, calls } = runtimeWithProject();
  runtime.state.projects = runtime.state.projects.map((item) => ({ ...item, path: item.path + "-gone" }));
  const command = await call(runtime, "POST", "/api/sessions/ses_1/command", { name: "echo", text: "" });
  const prompt = await call(runtime, "POST", "/api/sessions/ses_1/messages", { text: "hi" });
  assert.equal(command.status, 400);
  assert.equal(command.status, prompt.status);
  assert.deepEqual(command.body, prompt.body);
  assert.equal(calls.some((item) => item.startsWith("command:")), false);
});

test("a malformed percent-escape in a route id is a 400, not a 500", async () => {
  const { runtime, calls } = runtimeWithProject();
  const routes: Array<[string, string, unknown?]> = [
    ["POST", "/api/sessions/%E0%A4%A/command", { name: "echo" }],
    ["GET", "/api/sessions/%E0%A4%A"],
    ["POST", "/api/sessions/%/messages", { text: "hi" }],
    ["POST", "/api/projects/%E0%A4%A"],
    ["DELETE", "/api/projects/%ZZ"],
    ["POST", "/api/mcp/%E0%A4%A/connect"],
    ["POST", "/api/permissions/%E0%A4%A/reply", { reply: "once", sessionId: "ses_1" }],
    ["PUT", "/api/providers/%E0%A4%A/key", { key: "k" }],
    ["DELETE", "/api/providers/%E0%A4%A/key"],
  ];
  for (const [method, path, body] of routes) {
    const result = await call(runtime, method, path, body);
    assert.equal(result.status, 400, `${method} ${path}`);
    assert.equal((result.body as { error: string }).error, "Malformed path parameter");
  }
  assert.equal(calls.some((item) => item.startsWith("command:") || item === "send" || item === "set-key"), false);
});

test("command errors surface their server message", async () => {
  const { runtime } = runtimeWithProject();
  runtime.client = {
    ...(runtime.client as object),
    runCommand: async () => {
      throw new OpenCodeError(404, "Command not found: nope");
    },
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "POST", "/api/sessions/ses_1/command", { name: "nope", text: "" });
  assert.equal(result.status, 404);
  assert.equal((result.body as { error: string }).error, "Command not found: nope");
});

test("unavailable OpenCode becomes a recoverable error", async () => {
  const { runtime } = runtimeWithProject();
  runtime.status.connected = false;
  runtime.client = null;
  const result = await call(runtime, "GET", "/api/sessions");
  assert.equal(result.status, 503);
  assert.equal((result.body as { retryable?: boolean }).retryable, true);
});

test("GET /api/config returns only the permission block", async () => {
  const { runtime } = runtimeWithProject();
  const owned = "ocw_" + "b".repeat(48);
  runtime.state.ownedServerPassword = owned;
  (runtime.client as unknown as { getConfig: () => Promise<unknown> }).getConfig = async () => ({
    model: "openai/gpt",
    permission: { edit: "ask", bash: { "git *": "allow" } },
    provider: { azure: { options: { headers: { "Ocp-Apim-Subscription-Key": "AZ-SECRET-123" } } } },
    mcp: { gh: { environment: { OPENAI_KEY: "sk-envsecret" } } },
    echoed: owned,
  });
  const result = await call(runtime, "GET", "/api/config");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { permission: { edit: "ask", bash: { "git *": "allow" } } });
  const text = JSON.stringify(result.body);
  for (const leaked of ["AZ-SECRET-123", "sk-envsecret", owned, "Ocp-Apim-Subscription-Key", "OPENAI_KEY"]) {
    assert.equal(text.includes(leaked), false, `leaked ${leaked}`);
  }
});

test("GET /api/config without a permission block returns an empty one", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "GET", "/api/config");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { permission: {} });
});

test("the owned server password is a redaction needle", async () => {
  const { runtime } = runtimeWithProject();
  const owned = "ocw_" + "c".repeat(48);
  runtime.state.ownedServerPassword = owned;
  (runtime.client as unknown as { getConfig: () => Promise<unknown> }).getConfig = async () => ({
    permission: { note: owned, nested: [owned] },
  });
  (runtime.client as unknown as { getMcp: () => Promise<unknown> }).getMcp = async () => ({
    gh: { status: "connected", echoed: owned },
  });
  const config = await call(runtime, "GET", "/api/config");
  assert.deepEqual(config.body, { permission: { note: "[redacted]", nested: ["[redacted]"] } });
  const mcp = await call(runtime, "GET", "/api/mcp");
  assert.equal(mcp.status, 200);
  assert.equal(JSON.stringify(mcp.body).includes(owned), false);
  assert.equal((mcp.body as { gh: { echoed: string } }).gh.echoed, "[redacted]");
});

test("PATCH /api/config is gone", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "PATCH", "/api/config", { patch: { model: "anthropic/claude" } });
  assert.equal(result.status, 404);
});

test("question replies require an explicit answer", async () => {
  const { runtime } = runtimeWithProject();
  const missing = await call(runtime, "POST", "/api/permissions/que_1/reply", {
    reply: "once",
    kind: "question",
    sessionId: "ses_1",
  });
  assert.equal(missing.status, 400);
  assert.match((missing.body as { error: string }).error, /answer/i);
});

test("OpenCode errors keep a useful status", async () => {
  const { runtime } = runtimeWithProject();
  runtime.client = {
    ...(runtime.client as object),
    listSessions: async () => {
      throw new OpenCodeError(401, "Invalid API key");
    },
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "GET", "/api/sessions");
  assert.equal(result.status, 401);
  assert.match((result.body as { error: string }).error, /Invalid API key/);
});

test("blank password save preserves stored password", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "stored-pw";
  const result = await call(runtime, "PATCH", "/api/settings", { connectionUrl: "http://x", connectionUsername: "opencode", connectionPassword: "" });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.connectionPassword, "stored-pw");
  assert.equal((result.body as { hasConnectionPassword?: boolean }).hasConnectionPassword, true);
});

test("non-empty password replaces stored password", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "stored-pw";
  const result = await call(runtime, "PATCH", "/api/settings", { connectionPassword: "new-pw" });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.connectionPassword, "new-pw");
});

test("clear flag deletes stored password", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "stored-pw";
  const result = await call(runtime, "PATCH", "/api/settings", { clearConnectionPassword: true });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.connectionPassword, "");
  assert.equal((result.body as { hasConnectionPassword?: boolean }).hasConnectionPassword, false);
});

test("absent password preserves stored password", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "stored-pw";
  const result = await call(runtime, "PATCH", "/api/settings", { connectionUrl: "http://x" });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.connectionPassword, "stored-pw");
});

test("desk default model persists through settings and bootstrap", async () => {
  const { runtime } = runtimeWithProject();
  const saved = await call(runtime, "PATCH", "/api/settings", { deskModel: "alibaba-token-plan/model-a" });
  assert.equal(saved.status, 200);
  assert.equal((saved.body as { deskModel: string }).deskModel, "alibaba-token-plan/model-a");
  assert.equal(runtime.state.deskModel, "alibaba-token-plan/model-a");
  const boot = await call(runtime, "GET", "/api/bootstrap");
  const body = boot.body as { model: string; deskModel: string };
  // The persisted desk default wins over the mocked OpenCode config model.
  assert.equal(body.model, "alibaba-token-plan/model-a");
  assert.equal(body.deskModel, "alibaba-token-plan/model-a");
});

test("bootstrap falls back to OpenCode config model when deskModel is unset", async () => {
  const { runtime } = runtimeWithProject();
  const boot = await call(runtime, "GET", "/api/bootstrap");
  const body = boot.body as { model: string; deskModel: string };
  assert.equal(body.model, "openai/gpt");
  assert.equal(body.deskModel, "");
});

test("deskModel rejects non-strings, oversized and malformed values with 400 and leaves state unchanged", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.deskModel = "openai/gpt-6.2-astra";
  runtime.state.appearance = "dark";
  const bad: unknown[] = [
    42,
    true,
    { id: "x" },
    ["openai/gpt"],
    "openai/" + "x".repeat(300),
    "x".repeat(200_000),
    "no-slash",
    "/leading",
    "trailing/",
    "openai//double",
    "open ai/gpt",
    "openai/gpt\n",
    "openai/<script>",
  ];
  for (const deskModel of bad) {
    const result = await call(runtime, "PATCH", "/api/settings", { deskModel, appearance: "light" });
    assert.equal(result.status, 400, `expected 400 for ${JSON.stringify(deskModel).slice(0, 40)}`);
    assert.equal(typeof (result.body as { error: unknown }).error, "string");
    assert.equal(runtime.state.deskModel, "openai/gpt-6.2-astra");
    // A rejected PATCH must not half-apply the other fields either.
    assert.equal(runtime.state.appearance, "dark");
  }
});

test("deskModel accepts provider/model keys (model ids may contain slashes, dots, colons)", async () => {
  const { runtime } = runtimeWithProject();
  for (const deskModel of ["openrouter/anthropic/claude-4.5", "ollama/llama3.3:70b", "opencode-go/deepseek-v4.1-flash", "a/" + "b".repeat(254)]) {
    const result = await call(runtime, "PATCH", "/api/settings", { deskModel });
    assert.equal(result.status, 200, deskModel.slice(0, 40));
    assert.equal(runtime.state.deskModel, deskModel);
  }
});

test("deskModel null or empty string clears the desk default", async () => {
  const { runtime } = runtimeWithProject();
  for (const deskModel of [null, ""]) {
    runtime.state.deskModel = "openai/gpt-6.2-astra";
    const result = await call(runtime, "PATCH", "/api/settings", { deskModel });
    assert.equal(result.status, 200);
    assert.equal(runtime.state.deskModel, "");
  }
});

test("deskModel omitted leaves the desk default alone", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.deskModel = "openai/gpt-6.2-astra";
  const result = await call(runtime, "PATCH", "/api/settings", { appearance: "light" });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.deskModel, "openai/gpt-6.2-astra");
});

test("deskModel rejects a model OpenCode lists as disabled", async () => {
  const { runtime } = runtimeWithProject();
  runtime.client = {
    ...(runtime.client as object),
    listModels: async () => [
      { id: "on", modelID: "on", providerID: "openai", name: "On", enabled: true },
      { id: "off", modelID: "off", providerID: "openai", name: "Off", enabled: false },
    ],
  } as unknown as ControllerRuntime["client"];
  const rejected = await call(runtime, "PATCH", "/api/settings", { deskModel: "openai/off" });
  assert.equal(rejected.status, 400);
  assert.match((rejected.body as { error: string }).error, /disabled/);
  assert.equal(runtime.state.deskModel, "");
  const accepted = await call(runtime, "PATCH", "/api/settings", { deskModel: "openai/on" });
  assert.equal(accepted.status, 200);
  // A key the catalog does not list is not proof it is disabled.
  const unknown = await call(runtime, "PATCH", "/api/settings", { deskModel: "openai/unlisted" });
  assert.equal(unknown.status, 200);
});

test("deskModel disabled check never blocks when the catalog is unavailable", async () => {
  const { runtime } = runtimeWithProject();
  runtime.client = {
    ...(runtime.client as object),
    listModels: async () => {
      throw new OpenCodeError(503, "down");
    },
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "PATCH", "/api/settings", { deskModel: "openai/off" });
  assert.equal(result.status, 200);
  runtime.status.connected = false;
  runtime.client = null;
  const offline = await call(runtime, "PATCH", "/api/settings", { deskModel: "openai/other" });
  assert.equal(offline.status, 200);
});

test("reset clears passwords and deskModel", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "stored-pw";
  runtime.state.ownedServerPassword = "owned-pw";
  runtime.state.deskModel = "alibaba-token-plan/model-a";
  const result = await call(runtime, "POST", "/api/settings/reset", {});
  assert.equal(result.status, 200);
  assert.equal(runtime.state.connectionPassword, "");
  assert.equal(runtime.state.ownedServerPassword, "");
  assert.equal(runtime.state.deskModel, "");
});

test("permission reply reject is forwarded", async () => {
  const { runtime, calls } = runtimeWithProject();
  const result = await call(runtime, "POST", "/api/permissions/per_1/reply", { reply: "reject", sessionId: "ses_1", kind: "permission" });
  assert.equal(result.status, 200);
  assert.equal(calls.includes("replyPermission"), true);
});

test("question reject calls rejectQuestion", async () => {
  const { runtime, calls } = runtimeWithProject();
  const result = await call(runtime, "POST", "/api/permissions/q_1/reply", {
    reply: "reject",
    kind: "question",
    sessionId: "ses_1",
  });
  assert.equal(result.status, 200);
  assert.equal(calls.includes("rejectQuestion"), true);
});

test("question once with answer calls replyQuestion", async () => {
  const { runtime, calls } = runtimeWithProject();
  const result = await call(runtime, "POST", "/api/permissions/q_1/reply", {
    reply: "once",
    kind: "question",
    sessionId: "ses_1",
    message: "yes",
  });
  assert.equal(result.status, 200);
  assert.equal(calls.includes("replyQuestion"), true);
});

test("permission and question replies require a session id", async () => {
  const { runtime } = runtimeWithProject();
  const permission = await call(runtime, "POST", "/api/permissions/per_1/reply", {
    reply: "once",
    kind: "permission",
  });
  assert.equal(permission.status, 400);
  const question = await call(runtime, "POST", "/api/permissions/q_1/reply", {
    reply: "once",
    kind: "question",
    message: "yes",
  });
  assert.equal(question.status, 400);
});

test("invalid reply value is rejected", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "POST", "/api/permissions/per_1/reply", { reply: "maybe" });
  assert.equal(result.status, 400);
});

test("bootstrap says whether the session list is complete", async () => {
  const { runtime } = runtimeWithProject();
  const full = await call(runtime, "GET", "/api/bootstrap");
  assert.equal((full.body as { sessionsComplete: boolean }).sessionsComplete, true);

  runtime.client = {
    ...(runtime.client as object),
    listSessionsPage: async () => ({ sessions: [{ id: "ses_9", title: "Newest", time: { created: 1, updated: 2 } }], hasMore: true }),
  } as unknown as ControllerRuntime["client"];
  const truncated = await call(runtime, "GET", "/api/bootstrap");
  assert.equal((truncated.body as { sessionsComplete: boolean }).sessionsComplete, false);

  runtime.client = {
    ...(runtime.client as object),
    listSessionsPage: async () => {
      throw new OpenCodeError(503, "down");
    },
  } as unknown as ControllerRuntime["client"];
  const failed = await call(runtime, "GET", "/api/bootstrap");
  const body = failed.body as { sessionsComplete: boolean; sessions: unknown[] };
  assert.equal(body.sessionsComplete, false);
  assert.deepEqual(body.sessions, []);
});

test("session diff route forwards a validated turn range and normalizes the payload", async () => {
  const { runtime } = runtimeWithProject();
  const seen: unknown[] = [];
  runtime.state.ownedServerPassword = "ocw_" + "z".repeat(48);
  runtime.client = {
    ...(runtime.client as object),
    getDiff: async (_dir: string, _id: string, range: unknown) => {
      seen.push(range);
      return [
        { file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 1, deletions: 1, status: "modified", junk: { nested: true } },
        { file: "img.png", patch: "Binary files a/img.png and b/img.png differ\n", additions: 0, deletions: 0, status: "added" },
        { file: "src/b.ts", patch: "@@ -1 +1 @@\n-x\n+y\n", additions: 1, deletions: 1, status: "modified" },
      ];
    },
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "GET", "/api/sessions/ses_1/diff?from=msg_u1&to=msg_u2");
  assert.equal(result.status, 200);
  assert.deepEqual(seen, [{ from: "msg_u1", to: "msg_u2" }]);
  const files = (result.body as { files: Array<Record<string, unknown>> }).files;
  assert.deepEqual(Object.keys(files[0]).sort(), ["additions", "binary", "deletions", "file", "patch", "status", "truncated"]);
  assert.equal(files[1].binary, true);
  assert.equal(files[1].status, "added");

  await call(runtime, "GET", "/api/sessions/ses_1/diff");
  assert.deepEqual(seen[1], {});
});

test("session diff route rejects malformed range ids before calling OpenCode", async () => {
  const { runtime } = runtimeWithProject();
  let called = false;
  runtime.client = {
    ...(runtime.client as object),
    getDiff: async () => {
      called = true;
      return [];
    },
  } as unknown as ControllerRuntime["client"];
  // OpenCode's Session.Message.ID is `^msg_`: a bare id is rejected locally, like a malformed one.
  for (const query of ["from=../../etc", "to=a%20b", "from=" + "x".repeat(200), "from=abc", "to=ses_1", "from=msg_" + "x".repeat(125)]) {
    const result = await call(runtime, "GET", `/api/sessions/ses_1/diff?${query}`);
    assert.equal(result.status, 400, query);
    assert.match((result.body as { error: string }).error, /Invalid (from|to) message id/);
  }
  assert.equal(called, false);
});

test("session diff route requires a selected project and surfaces upstream 404s", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.activeProjectId = null;
  const noProject = await call(runtime, "GET", "/api/sessions/ses_1/diff");
  assert.equal(noProject.status, 400);
  const { runtime: second } = runtimeWithProject();
  second.client = {
    ...(second.client as object),
    getDiff: async () => {
      throw new OpenCodeError(404, "Message not found: msg_gone");
    },
  } as unknown as ControllerRuntime["client"];
  const missing = await call(second, "GET", "/api/sessions/ses_1/diff?from=msg_gone");
  assert.equal(missing.status, 404);
});

// A realistic leak: the agent writes the controller's OpenCode password into a project file.
function leakyPatches(pw: string) {
  return [
    {
      file: ".env",
      patch: `diff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1,2 @@\n+OPENCODE_SERVER_PASSWORD=${pw}\n+PORT=4096\n`,
      additions: 2,
      deletions: 0,
      status: "added",
    },
    {
      file: "scripts/start.sh",
      patch: `@@ -1,2 +1,2 @@\n #!/bin/sh\n-opencode serve\n+curl -u opencode:${pw}@127.0.0.1 && opencode serve # ${pw}\n`,
      additions: 1,
      deletions: 1,
      status: "modified",
    },
  ];
}

function assertMasked(body: unknown, pw: string) {
  const text = JSON.stringify(body);
  assert.equal(text.includes(pw), false, "password reached the browser");
  assert.equal(text.includes(pw.slice(0, 20)), false, "a password prefix reached the browser");
  const files = (body as { files: Array<{ file: string; patch: string }> }).files;
  assert.match(files[0].patch, /^\+OPENCODE_SERVER_PASSWORD=\[redacted\]$/m, "the surrounding line survives");
  assert.match(files[0].patch, /^\+PORT=4096$/m);
  assert.match(files[1].patch, /^\+curl -u opencode:\[redacted\]@127\.0\.0\.1 && opencode serve # \[redacted\]$/m);
}

for (const source of ["owned", "connection"] as const) {
  test(`${source} password is masked inside patch lines on the diff route and the session GET`, async () => {
    const { runtime } = runtimeWithProject();
    const pw = "ocw_" + "Q7".repeat(24);
    if (source === "owned") runtime.state.ownedServerPassword = pw;
    else runtime.state.connectionPassword = pw;
    runtime.client = {
      ...(runtime.client as object),
      getDiff: async () => leakyPatches(pw),
    } as unknown as ControllerRuntime["client"];
    const diff = await call(runtime, "GET", "/api/sessions/ses_1/diff");
    assert.equal(diff.status, 200);
    assertMasked(diff.body, pw);
    const open = await call(runtime, "GET", "/api/sessions/ses_1");
    assert.equal(open.status, 200);
    assertMasked(open.body, pw);
  });
}

for (const source of ["connection", "env"] as const) {
  test(`a short user-chosen ${source} password is still masked inside patch lines`, async () => {
    const { runtime } = runtimeWithProject();
    const pw = "hunter2pw"; // 9 chars: under the old 16-char floor
    const previous = process.env.OPENCODE_SERVER_PASSWORD;
    if (source === "connection") runtime.state.connectionPassword = pw;
    else process.env.OPENCODE_SERVER_PASSWORD = pw;
    try {
      runtime.client = {
        ...(runtime.client as object),
        getDiff: async () => [
          { file: ".env", patch: `@@ -0,0 +1,2 @@\n+OPENCODE_SERVER_PASSWORD=${pw}\n+URL=http://opencode:${pw}@127.0.0.1:4096\n`, additions: 2, deletions: 0, status: "added" },
        ],
      } as unknown as ControllerRuntime["client"];
      for (const path of ["/api/sessions/ses_1/diff", "/api/sessions/ses_1"]) {
        const result = await call(runtime, "GET", path);
        assert.equal(result.status, 200, path);
        assert.equal(JSON.stringify(result.body).includes(pw), false, path);
        const patch = (result.body as { files: Array<{ patch: string }> }).files[0].patch;
        assert.match(patch, /^\+OPENCODE_SERVER_PASSWORD=\[redacted\]$/m, path);
        assert.match(patch, /^\+URL=http:\/\/opencode:\[redacted\]@127\.0\.0\.1:4096$/m, path);
      }
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
      else process.env.OPENCODE_SERVER_PASSWORD = previous;
    }
  });
}

test("secrets under 4 chars are not substring-masked (trivial strings would shred code)", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "abc";
  runtime.client = {
    ...(runtime.client as object),
    getDiff: async () => [{ file: "a.ts", patch: "@@ -1 +1 @@\n-x\n+const abcValue = 1;\n", additions: 1, deletions: 1, status: "modified" }],
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "GET", "/api/sessions/ses_1/diff");
  assert.match((result.body as { files: Array<{ patch: string }> }).files[0].patch, /abcValue/);
});

test("an oversized upstream diff is a clean 502 on the diff route", async () => {
  const { runtime } = runtimeWithProject();
  runtime.client = {
    ...(runtime.client as object),
    getDiff: async () => {
      throw new OpenCodeError(502, "The diff is too large to load (over 32 MB)", false);
    },
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "GET", "/api/sessions/ses_1/diff");
  assert.equal(result.status, 502);
  assert.deepEqual(Object.keys(result.body as object).sort(), ["error", "retryable"]);
  const open = await call(runtime, "GET", "/api/sessions/ses_1");
  assert.equal(open.status, 200, "opening the chat still works; it just has no files");
  assert.deepEqual((open.body as { files: unknown[] }).files, []);
});

test("diff route caps total patch text and keeps every file's row data", async () => {
  const { runtime } = runtimeWithProject();
  const big = "@@ -0,0 +1,4500 @@\n" + ("+" + "y".repeat(99) + "\n").repeat(4500); // ~450 kB each
  runtime.client = {
    ...(runtime.client as object),
    getDiff: async () =>
      Array.from({ length: 200 }, (_, i) => ({ file: `gen/f${i}.txt`, patch: big, additions: 4500, deletions: 0, status: "added" })),
  } as unknown as ControllerRuntime["client"];
  const result = await call(runtime, "GET", "/api/sessions/ses_1/diff");
  const files = (result.body as { files: Array<{ file: string; patch: string; additions: number; status: string; truncated: boolean }> }).files;
  assert.equal(files.length, 200);
  const total = files.reduce((sum, file) => sum + file.patch.length, 0);
  assert.ok(total <= 5_000_000, `total ${total}`);
  assert.ok(JSON.stringify(result.body).length < 6_000_000);
  const dropped = files.filter((file) => file.patch === "");
  assert.ok(dropped.length > 150);
  for (const file of files) {
    assert.equal(file.additions, 4500);
    assert.equal(file.status, "added");
    assert.equal(file.truncated, true, file.file);
  }
});
