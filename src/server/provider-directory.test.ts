import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderDirectory,
  PROVIDER_DIRECTORY_MAX_BYTES,
  PROVIDER_DIRECTORY_MAX_MODELS,
  PROVIDER_DIRECTORY_MAX_PROVIDERS,
  PROVIDER_DIRECTORY_NEGATIVE_TTL_MS,
  PROVIDER_DIRECTORY_TTL_MS,
  PROVIDER_DIRECTORY_URL,
} from "./provider-directory.ts";

const FIXTURE = {
  openai: {
    id: "openai",
    name: "OpenAI",
    doc: "https://platform.openai.com/docs/models",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-5": {
        id: "gpt-5",
        name: "GPT-5",
        family: "gpt",
        cost: { input: 1.25, output: 10 },
        limit: { context: 400_000, output: 128_000 },
      },
      "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 mini" },
    },
  },
  "credential-provider": {
    id: "credential-provider",
    name: "Credential Provider",
    api: "https://secret.example.invalid/v1",
    env: ["SECRET_TOKEN"],
    models: { m1: { id: "m1", name: "M1", cost: { input: 0 } } },
  },
};

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fixtureFetch(body: unknown) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(body);
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

test("projects only safe display metadata and drops env/npm/api/cost/base-URL fields", async () => {
  const { fetchImpl } = fixtureFetch(FIXTURE);
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 1_000 });
  const result = await directory.get();
  assert.equal(result.error, undefined);
  assert.equal(result.providers.length, 2);

  const [openai, credential] = result.providers;
  assert.deepEqual(Object.keys(openai).sort(), ["doc", "id", "modelCount", "models", "name"]);
  assert.equal(openai.id, "openai");
  assert.equal(openai.name, "OpenAI");
  assert.equal(openai.doc, "https://platform.openai.com/docs/models");
  assert.equal(openai.modelCount, 2);
  assert.deepEqual(openai.models, [
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 mini" },
  ]);
  assert.deepEqual(Object.keys(openai.models[0]).sort(), ["id", "name"]);

  // A provider with no doc omits the field entirely rather than emitting undefined.
  assert.deepEqual(Object.keys(credential).sort(), ["id", "modelCount", "models", "name"]);

  const json = JSON.stringify(result.providers);
  for (const banned of [
    "OPENAI_API_KEY",
    "SECRET_TOKEN",
    "@ai-sdk/openai",
    "api.openai.com",
    "secret.example.invalid",
    '"env"',
    '"npm"',
    '"api"',
    '"cost"',
    '"limit"',
    '"family"',
  ]) {
    assert.equal(json.includes(banned), false, `${banned} must not cross the boundary`);
  }
});

test("bounds models per provider while keeping the true model count", async () => {
  const models = Object.fromEntries(
    Array.from({ length: PROVIDER_DIRECTORY_MAX_MODELS + 50 }, (_, index) => [
      `model-${index}`,
      { id: `model-${index}`, name: `Model ${index}` },
    ]),
  );
  const { fetchImpl } = fixtureFetch({ huge: { id: "huge", name: "Huge", models } });
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });
  const { providers } = await directory.get();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].models.length, PROVIDER_DIRECTORY_MAX_MODELS);
  assert.equal(providers[0].modelCount, PROVIDER_DIRECTORY_MAX_MODELS + 50);
});

test("bounds total providers", async () => {
  const body = Object.fromEntries(
    Array.from({ length: PROVIDER_DIRECTORY_MAX_PROVIDERS + 10 }, (_, index) => [
      `p${index}`,
      { id: `p${index}`, name: `Provider ${index}`, models: {} },
    ]),
  );
  const { fetchImpl } = fixtureFetch(body);
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });
  const { providers } = await directory.get();
  assert.equal(providers.length, PROVIDER_DIRECTORY_MAX_PROVIDERS);
});

test("cache serves the directory for 24h and refetches after the TTL", async () => {
  let now = 1_000;
  const { fetchImpl, calls } = fixtureFetch(FIXTURE);
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => now });

  const first = await directory.get();
  assert.equal(calls(), 1);
  assert.equal(first.fetchedAt, 1_000);

  now += PROVIDER_DIRECTORY_TTL_MS - 1;
  const cached = await directory.get();
  assert.equal(calls(), 1, "still within the 24h TTL");
  assert.equal(cached.fetchedAt, 1_000, "fetchedAt is the original fetch time");

  now += 1;
  const refreshed = await directory.get();
  assert.equal(calls(), 2, "TTL boundary triggers a refetch");
  assert.equal(refreshed.fetchedAt, now);
});

test("negative cache suppresses refetch for 60s, then retries", async () => {
  let now = 0;
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => now });

  const first = await directory.get();
  assert.deepEqual(first.providers, []);
  assert.match(first.error ?? "", /failed \(500\)/);
  assert.equal(first.fetchedAt, undefined);
  assert.equal(calls, 1);

  now += PROVIDER_DIRECTORY_NEGATIVE_TTL_MS - 1;
  const cached = await directory.get();
  assert.equal(calls, 1, "failure is cached briefly");
  assert.match(cached.error ?? "", /failed \(500\)/);

  now += 1;
  await directory.get();
  assert.equal(calls, 2, "retry after the negative TTL");
});

test("a hung request becomes a retryable timeout error", async () => {
  const directory = new ProviderDirectory({
    fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch,
    now: () => 0,
    setTimeout: (handler) => {
      queueMicrotask(handler);
      return 0;
    },
    clearTimeout: () => undefined,
  });
  const result = await directory.get();
  assert.deepEqual(result.providers, []);
  assert.match(result.error ?? "", /timed out/i);
});

test("an oversized response is rejected before it is parsed", async () => {
  const directory = new ProviderDirectory({
    fetch: (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(PROVIDER_DIRECTORY_MAX_BYTES + 1) },
      })) as typeof fetch,
    now: () => 0,
  });
  const result = await directory.get();
  assert.deepEqual(result.providers, []);
  assert.match(result.error ?? "", /too large/i);
});

test("malformed JSON and unexpected response shapes fail closed", async () => {
  const notJson = new ProviderDirectory({
    fetch: (async () => new Response("not json", { status: 200 })) as typeof fetch,
    now: () => 0,
  });
  const badJson = await notJson.get();
  assert.deepEqual(badJson.providers, []);
  assert.match(badJson.error ?? "", /valid JSON/i);

  const arrayShape = new ProviderDirectory({
    fetch: (async () => jsonResponse(["not", "a", "map"])) as typeof fetch,
    now: () => 0,
  });
  const badShape = await arrayShape.get();
  assert.deepEqual(badShape.providers, []);
  assert.match(badShape.error ?? "", /unexpected shape/i);
});

test("concurrent reads share one in-flight fetch", async () => {
  let calls = 0;
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetchImpl = (async () => {
    calls += 1;
    return pending;
  }) as typeof fetch;
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });

  const first = directory.get();
  const second = directory.get();
  release(jsonResponse(FIXTURE));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a, b, "both callers receive the same cached result");
});

test("provider entries without an id fall back to their map key and junk entries are skipped", async () => {
  const { fetchImpl } = fixtureFetch({
    keyed: { name: "Keyed Provider", models: { m: { id: "m", name: "M" } } },
    broken: null,
    empty: {},
  });
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });
  const { providers } = await directory.get();
  assert.deepEqual(
    providers.map((item) => item.id),
    ["keyed", "empty"],
  );
  assert.equal(providers[0].name, "Keyed Provider");
  assert.equal(providers[1].name, "empty");
});

test("requests the approved URL with redirects disabled", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return jsonResponse(FIXTURE);
  }) as typeof fetch;
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });
  await directory.get();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PROVIDER_DIRECTORY_URL);
  assert.equal(
    calls[0].init?.redirect,
    "error",
    "a 3xx must not be followed to an unapproved host",
  );
});

test("a redirect is never followed and becomes a retryable catalog error", async () => {
  const calls: string[] = [];
  // Emulates WHATWG fetch: with redirect:"error" a 3xx rejects; otherwise the
  // 3xx is followed automatically to the target host.
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url !== PROVIDER_DIRECTORY_URL) {
      // An arbitrary host *would* answer if the redirect were followed.
      return jsonResponse(FIXTURE);
    }
    if (init?.redirect === "error") {
      throw new TypeError("fetch failed: redirect mode is set to error");
    }
    const response = new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/api.json" },
    });
    const location = response.headers.get("location") ?? "";
    await response.body?.cancel().catch(() => undefined);
    return fetchImpl(location, init);
  }) as typeof fetch;
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });

  const result = await directory.get();
  assert.deepEqual(result.providers, []);
  assert.equal(typeof result.error, "string");
  assert.equal(calls.length, 1, "no second request to the redirect target");
  assert.equal(calls.includes("https://attacker.example/api.json"), false);
});

test("an empty or unusable catalog is a shape failure, never a 24h success", async () => {
  for (const body of [{}, { x: null }]) {
    let now = 0;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse(body);
    }) as typeof fetch;
    const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => now });
    const result = await directory.get();
    assert.deepEqual(result.providers, [], JSON.stringify(body));
    assert.match(result.error ?? "", /unexpected shape/i, JSON.stringify(body));
    assert.equal(result.fetchedAt, undefined);

    now += PROVIDER_DIRECTORY_NEGATIVE_TTL_MS - 1;
    await directory.get();
    assert.equal(calls, 1, "cached as a failure");
    now += 1;
    await directory.get();
    assert.equal(calls, 2, "retried after the 60s negative TTL, not a 24h success TTL");
  }
});

test("only https doc links survive the projection", async () => {
  const { fetchImpl } = fixtureFetch({
    script: { id: "script", name: "Script", doc: "javascript:alert(1)", models: {} },
    plain: { id: "plain", name: "Plain", doc: "http://example.invalid/docs", models: {} },
    embedded: { id: "embedded", name: "Embedded", doc: "data:text/html,<script>", models: {} },
    secure: { id: "secure", name: "Secure", doc: "https://example.invalid/docs", models: {} },
  });
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });
  const { providers } = await directory.get();
  const docs = Object.fromEntries(providers.map((provider) => [provider.id, provider.doc]));
  assert.deepEqual(docs, {
    script: undefined,
    plain: undefined,
    embedded: undefined,
    secure: "https://example.invalid/docs",
  });
});

test("overlong provider and model ids are rejected instead of truncated", async () => {
  const longID = "m".repeat(300);
  const { fetchImpl } = fixtureFetch({
    good: { id: "good", name: "Good", models: { [longID]: { id: longID, name: "Long" } } },
    [longID]: { id: longID, name: "Long provider", models: {} },
  });
  const directory = new ProviderDirectory({ fetch: fetchImpl, now: () => 0 });
  const { providers } = await directory.get();
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["good"],
    "an overlong provider id is skipped, not truncated",
  );
  assert.deepEqual(providers[0].models, []);
  assert.equal(providers[0].modelCount, 0);
});

test("a streamed body over the byte cap without content-length is rejected", async () => {
  const chunk = new Uint8Array(256 * 1024).fill(0x20);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent > PROVIDER_DIRECTORY_MAX_BYTES) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const response = new Response(body, { status: 200 });
  assert.equal(response.headers.get("content-length"), null, "exercises the streaming cap");

  const directory = new ProviderDirectory({
    fetch: (async () => response) as typeof fetch,
    now: () => 0,
  });
  const result = await directory.get();
  assert.deepEqual(result.providers, []);
  assert.match(result.error ?? "", /too large/i);
});
