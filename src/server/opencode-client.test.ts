import test from "node:test";
import assert from "node:assert/strict";
import { OpenCodeClient, OpenCodeError } from "./opencode-client.ts";

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const result = handler(url, init);
    const status = result.status ?? 200;
    const body = result.body === undefined ? "" : JSON.stringify(result.body);
    return new Response(status === 204 ? null : body, { status });
  };
  return { fetchImpl, calls };
}

test("connect reads server info", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { version: "2.3.2", pid: 1, urls: ["http://127.0.0.1:4096"], paths: { tmp: "/tmp" } },
  }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const health = await client.connect();
  assert.equal(health.version, "2.3.2");
  assert.equal(health.healthy, true);
  assert.match(calls[0].url, /\/api\/info$/);
});

test("session lifecycle uses v2 paths, location scope, and prompt steps", async () => {
  const { fetchImpl, calls } = mockFetch((url, init) => {
    if (new URL(url).pathname === "/api/session" && init?.method === "POST") {
      return { body: { data: { id: "ses_1", title: "Auth bug", time: { created: 1, updated: 2 } } } };
    }
    if (url.match(/\/api\/session\/ses_1$/) && init?.method === "GET") {
      return { body: { data: { id: "ses_1", title: "Auth bug" } } };
    }
    if (url.includes("/model") || url.includes("/agent")) return { status: 204 };
    if (url.includes("/prompt")) return { body: { data: { id: "msg_user" } } };
    if (url.includes("/message")) {
      return {
        body: {
          data: [{ id: "msg_1", type: "user", time: { created: 1 }, text: "Fix auth" }],
          cursor: {},
        },
      };
    }
    if (url.includes("/diff")) {
      return { body: { data: [{ file: "src/auth.ts", patch: "+x", additions: 1, deletions: 0, status: "modified" }] } };
    }
    if (url.includes("/api/session") && init?.method === "GET") {
      return { body: { data: [{ id: "ses_1", title: "Auth bug" }], cursor: {} } };
    }
    return { body: {} };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", password: "pw", fetch: fetchImpl });

  const created = await client.createSession("/work/app", "Auth bug");
  assert.equal(created.id, "ses_1");
  const createCall = calls.find((call) => call.url.includes("/api/session") && call.init?.method === "POST");
  assert.ok(createCall);
  assert.deepEqual(JSON.parse(String(createCall.init?.body)), {
    location: { directory: "/work/app" },
    title: "Auth bug",
  });

  const restored = await client.getSession("/work/app", "ses_1");
  assert.equal(restored.title, "Auth bug");

  await client.sendMessage("/work/app", "ses_1", {
    text: "Fix auth",
    providerID: "openai",
    modelID: "gpt",
    agent: "build",
  });
  const model = calls.find((call) => call.url.includes("/api/session/ses_1/model"));
  assert.ok(model);
  assert.deepEqual(JSON.parse(String(model.init?.body)), {
    model: { id: "gpt", providerID: "openai" },
  });
  const agent = calls.find((call) => call.url.includes("/api/session/ses_1/agent"));
  assert.ok(agent);
  assert.deepEqual(JSON.parse(String(agent.init?.body)), { agent: "build" });
  const prompt = calls.find((call) => call.url.includes("/api/session/ses_1/prompt"));
  assert.ok(prompt);
  assert.deepEqual(JSON.parse(String(prompt.init?.body)), { text: "Fix auth" });
  assert.match(String(prompt.init?.headers && (prompt.init.headers as Record<string, string>).authorization), /^Basic /);

  const sessions = await client.listSessions("/work/app", "auth");
  assert.equal(sessions[0].id, "ses_1");
  const listCall = calls.find((call) => call.url.includes("/api/session?"));
  assert.match(String(listCall?.url), /directory=%2Fwork%2Fapp/);
  assert.match(String(listCall?.url), /search=auth/);

  const messages = await client.listMessages("/work/app", "ses_1");
  assert.equal(messages[0].id, "msg_1");
  assert.match(String(calls.find((call) => call.url.includes("/message"))?.url), /order=asc/);

  const diff = await client.getDiff("/work/app", "ses_1");
  assert.equal(diff.length, 1);
});

test("message pagination follows the v2 cursor", async () => {
  const { fetchImpl, calls } = mockFetch((url) => {
    if (url.includes("cursor=cursor_2")) {
      return { body: { data: [{ id: "msg_2", type: "user", time: { created: 2 }, text: "second" }], cursor: {} } };
    }
    if (url.includes("/message")) {
      return {
        body: { data: [{ id: "msg_1", type: "user", time: { created: 1 }, text: "first" }], cursor: { next: "cursor_2" } },
      };
    }
    return { body: {} };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const messages = await client.listMessages("/work/app", "ses_1");
  assert.deepEqual(
    messages.map((message) => message.id),
    ["msg_1", "msg_2"],
  );
  assert.ok(calls.some((call) => call.url.includes("cursor=cursor_2")));
});

test("session updates and deletes use v2 semantics", async () => {
  const { fetchImpl, calls } = mockFetch((url, init) => {
    if (url.match(/\/api\/session\/ses_1$/) && init?.method === "PATCH") return { status: 204 };
    if (url.match(/\/api\/session\/ses_1$/) && init?.method === "GET") {
      return { body: { data: { id: "ses_1", title: "Renamed", time: { created: 1, updated: 2 } } } };
    }
    if (url.match(/\/api\/session\/ses_1$/) && init?.method === "DELETE") return { status: 204 };
    return { body: {} };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const updated = await client.updateSession("/work/app", "ses_1", { title: "Renamed", archived: true });
  assert.equal(updated.title, "Renamed");
  const patch = calls.find((call) => call.init?.method === "PATCH");
  assert.deepEqual(JSON.parse(String(patch?.init?.body)), { title: "Renamed", archived: true });
  await client.deleteSession("/work/app", "ses_1");
  assert.ok(calls.some((call) => call.init?.method === "DELETE"));
});

test("config merges v2 documents and credential failures surface as errors", async () => {
  const { fetchImpl } = mockFetch((url, init) => {
    if (url.includes("/api/config") && init?.method === "GET") {
      return { body: [{ type: "document", info: { mcp: { docs: {} } } }, { type: "document", info: { model: "anthropic/claude" } }] };
    }
    if (url.includes("/api/credential")) return { status: 401, body: { error: { message: "Invalid API key" } } };
    return { status: 503, body: { error: { message: "Model unavailable" } } };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const config = await client.getConfig("/work/app");
  assert.equal(config.model, "anthropic/claude");
  assert.deepEqual(config.mcp, { docs: {} });
  await assert.rejects(() => client.setApiKey("openai", "sk-test"), (err: unknown) => {
    assert.ok(err instanceof OpenCodeError);
    assert.equal(err.status, 401);
    assert.match(err.message, /Invalid API key/);
    return true;
  });
});

test("config falls back to the v2 default model", async () => {
  const { fetchImpl, calls } = mockFetch((url) => {
    if (url.includes("/api/config")) return { body: [{ type: "document", info: { mcp: {} } }] };
    if (url.includes("/api/model/default")) {
      return { body: { location: {}, data: { id: "deepseek-v4.1-flash", providerID: "opencode-go" } } };
    }
    return { body: {} };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const config = await client.getConfig("/work/app");
  assert.equal(config.model, "opencode-go/deepseek-v4.1-flash");
  assert.ok(calls.some((call) => call.url.includes("/api/model/default")));
});

test("providers are adapted for the desk", async () => {
  const { fetchImpl } = mockFetch((url) => {
    if (url.includes("/api/provider")) {
      return {
        body: {
          location: {},
          data: [{ id: "openai", integrationID: "openai", name: "OpenAI" }],
        },
      };
    }
    if (url.includes("/api/model/default")) {
      return { body: { location: {}, data: { id: "gpt", providerID: "openai" } } };
    }
    if (url.includes("/api/model")) {
      return { body: { location: {}, data: [{ id: "gpt", modelID: "gpt", providerID: "openai", name: "GPT" }] } };
    }
    if (url.includes("/api/integration")) {
      return { body: { location: {}, data: [{ id: "openai", connections: [{ type: "credential" }] }] } };
    }
    return { body: {} };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const providers = (await client.getProviders("/work/app")) as {
    all: { id: string; models?: Record<string, { id?: string }> }[];
    default: Record<string, string>;
    connected: string[];
  };
  assert.equal(providers.all[0].id, "openai");
  assert.equal(providers.all[0].models?.gpt.id, "gpt");
  assert.equal(providers.default.openai, "gpt");
  assert.deepEqual(providers.connected, ["openai"]);
});

test("permission and question replies carry the session id", async () => {
  const { fetchImpl, calls } = mockFetch((url, init) => {
    if (url.includes("/api/form") && init?.method === "GET") {
      return {
        body: {
          location: {},
          data: [
            {
              id: "form_1",
              sessionID: "ses_1",
              title: "Answer",
              fields: [{ key: "answer", type: "string", title: "Your answer" }],
            },
          ],
        },
      };
    }
    return { status: 204 };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await client.replyPermission("/work/app", "ses_1", "per_1", "once");
  const permission = calls.find((call) => call.url.includes("/permission/per_1/reply"));
  assert.match(String(permission?.url), /\/api\/session\/ses_1\/permission\/per_1\/reply$/);
  assert.deepEqual(JSON.parse(String(permission?.init?.body)), { decision: "once" });

  await client.replyQuestion("/work/app", "ses_1", "form_1", "yes");
  const question = calls.find((call) => call.url.includes("/form/form_1/reply"));
  assert.match(String(question?.url), /\/api\/session\/ses_1\/form\/form_1\/reply$/);
  assert.deepEqual(JSON.parse(String(question?.init?.body)), { answer: { answer: "yes" } });

  await client.rejectQuestion("/work/app", "ses_1", "form_1");
  assert.ok(calls.some((call) => call.init?.method === "DELETE" && call.url.includes("/form/form_1")));
});

test("event stream parses v2 frames and reconnects are the caller's job", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('data: {"id":"evt_1","type":"server.connected","data":{}}\n\n'),
      );
      controller.close();
    },
  });
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(stream, { status: 200 });
  };
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const events: unknown[] = [];
  await client.subscribeToEvents((event) => events.push(event));
  assert.equal(events.length, 1);
  assert.match(calls[0], /\/api\/event$/);
});

test("connection loss is an unavailable error", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await assert.rejects(() => client.getStatus(), (err: unknown) => {
    assert.ok(err instanceof OpenCodeError);
    assert.equal(err.retryable, true);
    return true;
  });
});
