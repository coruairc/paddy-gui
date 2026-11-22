import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DIFF_UPSTREAM_BYTES, OpenCodeClient, OpenCodeError, readCapped, SESSION_PAGE_LIMIT } from "./opencode-client.ts";

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

test("listModels scopes by directory and unwraps the envelope", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: {
      data: [{ id: "gpt-6.2-astra", modelID: "gpt-6.2-astra", providerID: "openai", name: "Astra" }],
    },
  }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const models = await client.listModels("/work/app");
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "gpt-6.2-astra");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/model");
  assert.equal(url.searchParams.get("location[directory]"), "/work/app");
});

test("getDefaultModel tolerates a null payload", async () => {
  const { fetchImpl } = mockFetch(() => ({ body: { data: null } }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  assert.equal(await client.getDefaultModel(), null);
});

test("a rejected model switch aborts before the prompt is sent", async () => {
  const { fetchImpl, calls } = mockFetch((url) => {
    if (url.includes("/model")) return { status: 400, body: { message: "unknown model" } };
    return { body: { data: { id: "msg_user" } } };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await assert.rejects(
    client.sendMessage("/work/app", "ses_1", {
      text: "hello",
      providerID: "openai",
      modelID: "no-such-model",
    }),
    OpenCodeError,
  );
  assert.equal(
    calls.some((call) => call.url.includes("/prompt")),
    false,
    "prompt must never be issued after a failed model switch",
  );
});

test("listCommands scopes by directory and unwraps the envelope", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { data: [{ name: "echo", description: "Repeat" }] },
  }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const commands = await client.listCommands("/work/app");
  assert.deepEqual(commands, [{ name: "echo", description: "Repeat" }]);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/command");
  assert.equal(url.searchParams.get("location[directory]"), "/work/app");
});

test("runCommand posts name and args text to the session command route", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({ status: 204 }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await client.runCommand("/work/app", "ses_1", { name: "echo", text: "hello" });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/session/ses_1/command");
  assert.equal(url.searchParams.get("location[directory]"), null);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: "echo", text: "hello" });
});

test("a command 404 surfaces its _tag message", async () => {
  const { fetchImpl } = mockFetch(() => ({
    status: 404,
    body: { _tag: "CommandNotFoundError", command: "nope", message: "Command not found: nope" },
  }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await assert.rejects(
    client.runCommand("/work/app", "ses_1", { name: "nope", text: "" }),
    (err: unknown) =>
      err instanceof OpenCodeError &&
      err.status === 404 &&
      err.message === "Command not found: nope",
  );
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

test("session list page derives truncation from page size, not cursor.next", async () => {
  // Shapes copied from live OpenCode v2.3.2: `cursor.next` is set on every non-empty page, even the last.
  const session = (id: string) => ({ id, time: { created: 1, updated: 1 } });
  const { fetchImpl, calls } = mockFetch((url) => {
    if (url.includes("search=full")) {
      return {
        body: {
          data: Array.from({ length: SESSION_PAGE_LIMIT }, (_, index) => session(`ses_${index}`)),
          cursor: { previous: "cur_prev", next: "cur_next" },
        },
      };
    }
    return { body: { data: [session("ses_only")], cursor: { previous: "cur_prev", next: "cur_next" } } };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });

  const full = await client.listSessionsPage("/work/app", "full");
  assert.equal(full.sessions.length, SESSION_PAGE_LIMIT);
  assert.equal(full.hasMore, true);

  const last = await client.listSessionsPage("/work/app");
  assert.deepEqual(last.sessions.map((item) => item.id), ["ses_only"]);
  assert.equal(last.hasMore, false, "a short last page is complete even though cursor.next is set");

  for (const call of calls) assert.match(call.url, new RegExp(`limit=${SESSION_PAGE_LIMIT}`));
  assert.match(calls[0].url, /directory=%2Fwork%2Fapp/);
  // The array-returning wrapper still unwraps the same response.
  assert.deepEqual((await client.listSessions("/work/app")).map((item) => item.id), ["ses_only"]);
});

test("getDiff asks for hunks with context and forwards the turn range", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { data: [{ file: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 1, deletions: 1, status: "modified" }] },
  }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const latest = await client.getDiff("/work/app", "ses_1");
  assert.equal(latest.length, 1);
  assert.match(calls[0].url, /\/api\/session\/ses_1\/diff\?/);
  assert.match(calls[0].url, /context=3/);
  assert.doesNotMatch(calls[0].url, /from=|to=/);
  await client.getDiff("/work/app", "ses_1", { from: "msg_u1", to: "msg_u9" });
  assert.match(calls[1].url, /from=msg_u1/);
  assert.match(calls[1].url, /to=msg_u9/);
});

function chunkedResponse(chunks: number, chunkBytes: number, headers?: Record<string, string>) {
  let pulled = 0;
  const chunk = new TextEncoder().encode("x".repeat(chunkBytes));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  return { response: new Response(body, { status: 200, headers }), pulled: () => pulled };
}

test("readCapped streams under the cap and aborts past it without buffering the rest", async () => {
  const small = chunkedResponse(3, 10);
  assert.equal(await readCapped(small.response, 100), "x".repeat(30));
  const big = chunkedResponse(1000, 10);
  await assert.rejects(readCapped(big.response, 95), (err: unknown) => err instanceof OpenCodeError && err.status === 502 && !err.retryable);
  assert.ok(big.pulled() <= 12, `pulled ${big.pulled()} chunks`);
  const declared = chunkedResponse(1, 10, { "content-length": "5000" });
  await assert.rejects(readCapped(declared.response, 100), /too large/);
  assert.equal(declared.pulled(), 0, "a declared oversize body is never read");
});

test("readCapped decodes multi-byte characters split across chunks", async () => {
  const bytes = new TextEncoder().encode("é✓");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  assert.equal(await readCapped(new Response(body), 100), "é✓");
});

test("getDiff fails cleanly (502, nothing parsed) when the upstream body passes the ceiling", { timeout: 30_000 }, async () => {
  let pulled = 0;
  const chunk = new TextEncoder().encode('{"data":[' + " ".repeat(1024 * 1024));
  // Bounded at twice the ceiling: if the cap regresses the stream ends and the
  // assertion below fails, instead of the suite hanging on an endless body.
  const limit = Math.ceil((2 * MAX_DIFF_UPSTREAM_BYTES) / chunk.byteLength);
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= limit) return controller.close();
          pulled += 1;
          controller.enqueue(chunk);
        },
      }),
      { status: 200 },
    );
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await assert.rejects(client.getDiff("/work/app", "ses_1"), (err: unknown) => err instanceof OpenCodeError && err.status === 502 && /too large/.test(err.message));
  assert.ok(pulled <= Math.ceil(MAX_DIFF_UPSTREAM_BYTES / chunk.byteLength) + 2, `pulled ${pulled} MB`);
});

test("a reset mid-body is a retryable transport error, not a generic failure", async () => {
  let pulled = 0;
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          if (pulled > 3) return controller.error(new Error("socket hang up"));
          controller.enqueue(new TextEncoder().encode('{"data":['));
        },
      }),
      { status: 200 },
    );
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  await assert.rejects(
    client.getDiff("/work/app", "ses_1"),
    (err: unknown) => err instanceof OpenCodeError && err.status === 0 && err.retryable === true && /socket hang up/.test(err.message),
  );
});
