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
    listMessages: async () => [{ info: { id: "msg_1", role: "user", time: { created: 11 } }, parts: [{ type: "text", text: "Fix auth" }] }],
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
    updateConfig: async (patch: Record<string, unknown>) => patch,
    setApiKey: async () => {
      calls.push("set-key");
    },
    getProviders: async () => ({ all: [], connected: [], key: "sk-should-not-leak" }),
    getProviderAuth: async () => ({ openai: [{ type: "api", label: "API key" }] }),
    getAgents: async () => [],
    getMcp: async () => ({}),
    listPermissions: async () => [],
    listQuestions: async () => [],
    getVcs: async () => ({ branch: "main" }),
    getFileStatus: async () => [],
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

test("unavailable OpenCode becomes a recoverable error", async () => {
  const { runtime } = runtimeWithProject();
  runtime.status.connected = false;
  runtime.client = null;
  const result = await call(runtime, "GET", "/api/sessions");
  assert.equal(result.status, 503);
  assert.equal((result.body as { retryable?: boolean }).retryable, true);
});

test("config changes are forwarded, not reimplemented", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "PATCH", "/api/config", { patch: { model: "anthropic/claude" } });
  assert.equal(result.status, 200);
  assert.equal((result.body as { model: string }).model, "anthropic/claude");
});

test("question replies require an explicit answer", async () => {
  const { runtime } = runtimeWithProject();
  const missing = await call(runtime, "POST", "/api/permissions/que_1/reply", { reply: "once", kind: "question" });
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
