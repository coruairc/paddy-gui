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

test("connect reads health", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({ body: { healthy: true, version: "1.18.33" } }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const health = await client.connect();
  assert.equal(health.version, "1.18.33");
  assert.match(calls[0].url, /\/global\/health$/);
});

test("session create, restore, and prompt use the directory scope", async () => {
  const { fetchImpl, calls } = mockFetch((url, init) => {
    if (url.includes("/session?") && init?.method === "POST") return { body: { id: "ses_1", title: "Auth bug", time: { created: 1, updated: 2 } } };
    if (url.includes("/session/ses_1?") && init?.method === "GET") return { body: { id: "ses_1", title: "Auth bug" } };
    if (url.includes("/prompt_async")) return { status: 204 };
    if (url.includes("/message")) return { body: [{ info: { id: "msg_1", role: "user" }, parts: [{ type: "text", text: "Fix auth" }] }] };
    return { body: [] };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", password: "pw", fetch: fetchImpl });
  const created = await client.createSession("/work/app", "Auth bug");
  assert.equal(created.id, "ses_1");
  const restored = await client.getSession("/work/app", "ses_1");
  assert.equal(restored.title, "Auth bug");
  await client.sendMessage("/work/app", "ses_1", { text: "Fix auth", providerID: "openai", modelID: "gpt" });
  const prompt = calls.find((call) => call.url.includes("prompt_async"));
  assert.ok(prompt);
  assert.match(prompt.url, /directory=%2Fwork%2Fapp/);
  const body = JSON.parse(String(prompt.init?.body));
  assert.equal(body.parts[0].text, "Fix auth");
  assert.equal(body.model.modelID, "gpt");
  assert.match(String(prompt.init?.headers && (prompt.init.headers as Record<string, string>).authorization), /^Basic /);
  const messages = await client.listMessages("/work/app", "ses_1");
  assert.equal(messages[0].info.id, "msg_1");
});

test("config updates and provider failures surface as errors", async () => {
  const { fetchImpl } = mockFetch((url, init) => {
    if (url.includes("/config") && init?.method === "PATCH") return { body: { model: "anthropic/claude" } };
    if (url.includes("/auth/")) return { status: 401, body: { message: "Invalid API key" } };
    return { status: 503, body: { message: "Model unavailable" } };
  });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const config = await client.updateConfig({ model: "anthropic/claude" }, "/work/app");
  assert.equal(config.model, "anthropic/claude");
  await assert.rejects(() => client.setApiKey("openai", "sk-test"), (err: unknown) => {
    assert.ok(err instanceof OpenCodeError);
    assert.equal(err.status, 401);
    assert.match(err.message, /Invalid API key/);
    return true;
  });
});

test("event stream parses frames and reconnects are the caller's job", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"payload":{"type":"session.idle","properties":{"sessionID":"ses_1"}}}\n\n'));
      controller.close();
    },
  });
  const fetchImpl: typeof fetch = async () => new Response(stream, { status: 200 });
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const events: unknown[] = [];
  await client.subscribeToEvents((event) => events.push(event));
  assert.equal(events.length, 1);
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
