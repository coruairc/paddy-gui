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

test("non-string deskModel is ignored", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "PATCH", "/api/settings", { deskModel: 42 });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.deskModel, "");
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
