---
last_mapped_commit: d358aee016758bde70bd5b2782a5b1ebf27b6aba
last_mapped_at: 2026-10-29
---
# Testing Patterns

**Analysis Date:** 2026-10-29

## Test Framework

**Runner:**
- Node's built-in test runner (`node:test`), no test framework dependency. No Jest, Vitest, Mocha, or Playwright test runner is configured.
- No config file. Test files are listed explicitly in `package.json` scripts — there is no glob discovery, so **a new test file is not run until it is added to the `test` script**.

**Assertion Library:**
- `node:assert/strict` — imported as `assert` in every test file. No chai/expect.

**Run Commands:**
```bash
npm test                # install.sh test + all six TS tests (see below)
node --test scripts/install.sh.test.mjs
node --experimental-strip-types --test \
  src/server/security.test.ts src/server/opencode-client.test.ts \
  src/server/api.test.ts src/server/normalize.test.ts src/server/state.test.ts \
  src/components/autonomous-drink.test.ts
npm run typecheck       # tsc --noEmit
npm run lint            # eslint .
```

`npm test` (verbatim from `package.json:24`):
```bash
node --test scripts/install.sh.test.mjs && node --experimental-strip-types --test \
  src/server/security.test.ts src/server/opencode-client.test.ts src/server/api.test.ts \
  src/server/normalize.test.ts src/server/state.test.ts src/components/autonomous-drink.test.ts
```

**Node version:** Docker base is `node:24-bookworm-slim` (`Dockerfile:12`). `.ts` tests rely on `--experimental-strip-types`, so they run on Node ≥22.

**Coverage:** No coverage tool, no thresholds, no `c8`/`nyc`/`--experimental-test-coverage` wiring. Nothing is enforced.

## Test File Organization

**Location:**
- Co-located beside the source file, same directory, no `__tests__`/`tests/` directory.
  - `src/server/api.ts` → `src/server/api.test.ts`
  - `src/components/autonomous-drink.ts` → `src/components/autonomous-drink.test.ts`
  - `scripts/preview.mjs` → `scripts/preview.test.mjs`
- `install.sh.test.mjs` also exists at the repo root as a copy of `scripts/install.sh.test.mjs` (the `npm test` script runs the root copy).

**Naming:**
- `<module>.test.ts` for TypeScript sources (needs `--experimental-strip-types`).
- `<module>.test.mjs` for plain ESM scripts and `.sh` CLIs (`install.sh.test.mjs`).

**Structure:**
```
src/server/{security,opencode-client,api,normalize,state}.test.ts
src/components/autonomous-drink.test.ts
scripts/{brand-check,browser-smoke-verdict,check-auth-invariant,grok-pwa-plugin,
         install.sh,link-cli,migration-plan,preview,sign-out-plan,
         with-app-env,write-atomic}.test.mjs
install.sh.test.mjs
```

## Test Structure

**Suite Organization:**
- Flat top-level `test("...")` calls. **No `describe`/`suite` nesting anywhere** — verified across all 17 test files. Grouping is done with comment dividers instead:

```js
// ── Live preview ─────────────────────────────────────────────────────────────

test("preview: a successful sign-out clears the token, then redirects", async () => {
  const h = preview();
  await h.run();
  assert.equal(h.requests, 1);
  assert.deepEqual(h.order, ["clear", "redirect"]);
});
```
(`scripts/sign-out-plan.test.mjs:59-66`)

- Test names are lowercase behavioral sentences, no "should", often with a namespace prefix for multi-mode files (`preview: ...`, `deployed: ...` in `scripts/sign-out-plan.test.mjs`), or a plain description of the guarantee (`"new session, resume, and rename stay on OpenCode"`, `src/server/api.test.ts:84`).

**Patterns:**
- **Factories at the top of the file**, before the first test: `runtimeWithProject()` (`src/server/api.test.ts:11`), `makeWorkspace()` (`scripts/write-atomic.test.mjs:20`), `makeClock()` (`src/components/autonomous-drink.test.ts:11`), `viewport()`/`verdict()` (`scripts/browser-smoke-verdict.test.mjs:19-36`), `harness()` (`scripts/sign-out-plan.test.mjs:28`).
- **One behavior per test**, multiple assertions, no shared mutable state between tests.
- **Setup is inline in the test** (build the fixture, act, assert) rather than `beforeEach`.
- **Teardown via `try/finally`** for temp dirs and env vars, or `t.after` — no global hooks:

```ts
const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
const file = join(dir, "state.json");
try {
  writeState(file, state);
  assert.equal(readState(file).ownedServerPassword, "ocw_secret");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
```
(`src/server/state.test.ts:9-17`)

**Assertion patterns actually used:**
- `assert.equal(actual, expected)` — most common; for booleans `assert.equal(x, true/false)` rather than `assert.ok`.
- `assert.deepEqual(actual, expected)` for arrays/objects/result unions (`scripts/write-atomic.test.mjs:28`).
- `assert.match(string, /regex/)` / `assert.doesNotMatch(...)` for error text and generated markup.
- `assert.ok(value)` when only truthiness matters (`assert.ok(prompt)`, `src/server/opencode-client.test.ts:41`).
- Third-arg failure messages are used to explain intent: `assert.equal(r.status, 0, r.stderr)` (`scripts/install.sh.test.mjs:18`), `assert.deepEqual(h.order, [], "no redirect may claim a sign-out the server never made")` (`scripts/sign-out-plan.test.mjs:124`).

## Mocking

**Framework:** None — no `mock` library, no `jest.mock`. Mocks are hand-written fakes injected through constructor options or assigned to a plain object.

**Patterns:**

1. **Inject `fetch`** (preferred for the OpenCode client). `ClientOptions.fetch` accepts a `typeof fetch`, so tests pass a fake and record calls:

```ts
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
```
(`src/server/opencode-client.test.ts:5-16`) — assertions then inspect `calls[0].url`, `prompt.init?.body`, `prompt.init?.headers`.

2. **Structural fake cast** for the runtime's client. A full literal of async stubs is cast once, and side effects are recorded into a local array:

```ts
runtime.client = {
  listSessions: async () => { calls.push("list"); return [...] },
  // ...
} as unknown as ControllerRuntime["client"];
```
(`src/server/api.test.ts:30-70`)

3. **Injected clock** for time-based logic — a deterministic timer map with `advance(ms)` instead of real waits (`src/components/autonomous-drink.test.ts:11-47`):

```ts
const clock = makeClock(() => 0.5);
const { controller, drinks } = record(clock);
controller.start();
clock.advance(60_000);
assert.equal(drinks.length, 1);
```

4. **`node:test` mock timers** where the code uses global `setTimeout` and injection is not available (`scripts/sign-out-plan.test.mjs:84-96`):

```js
test("preview: a sign-out that never settles clears and redirects once the wait expires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const done = h.run();
  t.mock.timers.tick(TEST_TIMEOUT_MS - 1);
  await flush();
  t.mock.timers.tick(1);
  await done;
});
```
With `const flush = () => new Promise((resolve) => setImmediate(resolve));` — only `setTimeout` is mocked, so microtasks still drain (`scripts/sign-out-plan.test.mjs:17-22`).

5. **Real subprocesses** for CLI/install behavior — `spawnSync`, never a mocked `child_process`:

```js
function run(args, env = {}) {
  return spawnSync("bash", [sh, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}
```
(`scripts/install.sh.test.mjs:9-14`); `spawnSync(process.execPath, [join(import.meta.dirname, "link-cli.mjs")], {...})` (`scripts/link-cli.test.mjs:27`).

**What to Mock:**
- Outbound HTTP (`fetch`), time (`setTimeout`/clock), and randomness (`random`) — the three non-deterministic edges.
- OpenCode itself. `README.md:169`: "Tests mock OpenCode. A real API key is not required."

**What NOT to Mock:**
- The filesystem — tests create real temp workspaces under `tmpdir()`.
- `node:fs`, `node:path`, `node:child_process` internals.
- The function under test; helpers are called directly, not spied on.

## Fixtures and Factories

**Test Data:**
- Temp workspace factory per concern, with the prefix naming the concern:

```js
function makeWorkspace({ siteJson, cardFile, narrowFile, cardBytes = 200 * 1024 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "brand-check-"));
  mkdirSync(join(root, "public"), { recursive: true });
  mkdirSync(join(root, "src/lib/og"), { recursive: true });
  mkdirSync(join(root, ".grok"), { recursive: true });
  // write only the inputs the case needs
  return root;
}
```
(`scripts/brand-check.test.mjs:25-53`)

- Partial-override factory for structured fixtures: `viewport(overrides = {})` + `verdict(desktop = {}, mobile = {})` (`scripts/browser-smoke-verdict.test.mjs:19-36`).
- Config objects are literal `const` at file scope: `const cfg: AutonomousConfig = { minInitialDelayMs: 30_000, ... }` (`src/components/autonomous-drink.test.ts:49-54`).

**Location:**
- No `fixtures/` or `__fixtures__` directory. All fixtures are local functions/constants in the test file that uses them. Shared script helpers live in `scripts/*.mjs` and are imported (e.g. `isMainModule`, `mergeAppEnv`, `projectRoot`, `readAppEnv` from `scripts/with-app-env.mjs`).

**Path resolution in tests:**
- `const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")` (`scripts/brand-check.test.mjs:18`, `scripts/write-atomic.test.mjs:17`).
- Newer files use `import.meta.dirname` directly (`scripts/install.sh.test.mjs:7`, `scripts/link-cli.test.mjs:27`) — prefer this.

## Coverage

**Requirements:** None enforced. No coverage script, no threshold, no CI gate.

**View Coverage:** Not configured. If needed:
```bash
node --experimental-strip-types --experimental-test-coverage --test <files>
```

## Test Types

**Unit Tests:**
- Pure-function modules: `src/server/security.ts` (auth predicates, path allowlist, redaction, JSON parsing), `src/server/normalize.ts` (event/message translation), `src/components/autonomous-drink.ts` (scheduler state machine), and all `scripts/*.mjs` parsers/verdict builders.
- This is the dominant style — argument in, result object or value out.

**Integration Tests:**
- `src/server/api.test.ts` drives `handleApi(runtime, Request)` end-to-end against a fake runtime/client and asserts HTTP status + body shape (`src/server/api.test.ts:74-82`).
- `src/server/opencode-client.test.ts` drives `OpenCodeClient` against a fake `fetch` and asserts URLs, query params, headers, and bodies (`src/server/opencode-client.test.ts:26-49`).
- `src/server/state.test.ts` round-trips real files through `writeState`/`readState`.
- `scripts/install.sh.test.mjs` and `scripts/link-cli.test.mjs` are process-level integration tests (real `bash`/`node` subprocess).

**E2E Tests:**
- No E2E tests in the suite. `playwright` is a devDependency but is only used by the manual smoke scripts `scripts/browser-smoke.mjs` + `scripts/browser-smoke-verdict.mjs` (writes a JSON verdict, compares against a baseline). Not wired into `npm test` or CI.

**Component tests:** None. No jsdom, no `@testing-library/react`. React behavior is covered indirectly by keeping logic in plain `.ts` modules (see `use-autonomous-drink.ts` as the thin React wrapper over the tested `autonomous-drink.ts`).

## Common Patterns

**Async Testing:**
```ts
test("connect reads health", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({ body: { healthy: true, version: "1.18.33" } }));
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", fetch: fetchImpl });
  const health = await client.connect();
  assert.equal(health.version, "1.18.33");
  assert.match(calls[0].url, /\/global\/health$/);
});
```
(`src/server/opencode-client.test.ts:18-24`)

For streams, build a real `ReadableStream` and return it from the fake fetch (`src/server/opencode-client.test.ts:68-80`).

**Error Testing:**
```ts
await assert.rejects(() => client.setApiKey("openai", "sk-test"), (err: unknown) => {
  assert.ok(err instanceof OpenCodeError);
  assert.equal(err.status, 401);
  assert.match(err.message, /Invalid API key/);
  return true;
});
```
(`src/server/opencode-client.test.ts:60-65`) — the predicate form with an explicit `err: unknown` param and `return true` is the house style; a plain `assert.rejects(fn, /regex/)` is used for message-only checks (`scripts/sign-out-plan.test.mjs:123`).

Validation failures are asserted as result objects, not thrown errors:
```ts
const denied = authorizePeer({ remoteAddress: "10.0.0.8", authorization: "Bearer no" });
assert.equal(denied.ok, false);
if (!denied.ok) assert.equal(denied.status, 401);
```
(`src/server/security.test.ts:20-22`) — narrow with `if (!x.ok)` before reading union fields.

**Secret-leak assertions:** JSON-stringify the response and assert the secret is absent:
```ts
assert.equal(JSON.stringify(providers.body).includes("sk-should-not-leak"), false);
```
(`src/server/api.test.ts:109`)

**Environment isolation:**
```js
const prev = process.env.PADDY_BIN_DIR;
process.env.PADDY_BIN_DIR = dir;
try { /* ... */ } finally {
  if (prev === undefined) delete process.env.PADDY_BIN_DIR;
  else process.env.PADDY_BIN_DIR = prev;
}
```
(`scripts/link-cli.test.mjs:11-22`); subprocess tests pass `env: { ...process.env, ...env }` instead of mutating `process.env`.

**File-sync assertions:** duplicated installers are asserted byte-identical rather than diffed in CI (`scripts/install.sh.test.mjs:64-73`).

## Gaps and Caveats

- **11 of 17 test files are not run by `npm test`.** Only `scripts/install.sh.test.mjs` (plus the root copy) runs from `scripts/`. These files are unrun by the standard command and must be invoked individually:
  `scripts/brand-check.test.mjs`, `scripts/browser-smoke-verdict.test.mjs`, `scripts/check-auth-invariant.test.mjs`, `scripts/grok-pwa-plugin.test.mjs`, `scripts/link-cli.test.mjs`, `scripts/migration-plan.test.mjs`, `scripts/preview.test.mjs`, `scripts/sign-out-plan.test.mjs`, `scripts/with-app-env.test.mjs`, `scripts/write-atomic.test.mjs`.
  Add a new `scripts/*.test.mjs` to `package.json` `test`, or run it explicitly.
- **No CI test job.** `.github/workflows/publish-image.yml` only builds/publishes the Docker image; nothing runs `npm test`, `npm run lint`, or `npm run typecheck` on push.
- **`npm run check:auth` does not exist** although `scripts/check-auth-invariant.mjs:21` documents it; use `node scripts/check-auth-invariant.mjs` directly.
- **No component/render tests** and **no E2E in the suite**; UI regressions rely on manual `scripts/browser-smoke.mjs`.
- `tsconfig.json` excludes `src/lib/harness/setup-model-picker.test.mjs`, so that file is not typechecked (the file is not present in this checkout).

---

*Testing analysis: 2026-10-29*
