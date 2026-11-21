# Phase 7: v2 Hardening Foundation - Pattern Map

**Mapped:** 2026-11-21
**Files analyzed:** 13 (all modifications to existing files; zero new source files)
**Analogs found:** 13 / 13 (every analog is the target file's own established pattern or a sibling in the same layer)
**Verified at HEAD:** `e6b5088` — all line numbers below re-checked against current HEAD (research cited `acfc44e`; every cited range still matches). All analog paths confirmed git-tracked via `git ls-files`.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/server/runtime.ts` | service (connection supervisor) | event-driven / request-response | itself — `spawn`/`sleep`/`kill` DI seams (`runtime.ts:32-40, 61-74`) | exact |
| `src/server/runtime.test.ts` | test | DI-injected unit | itself — seam-injection test (`runtime.test.ts:33-56`) + failing spawn test (`:118-150`) | exact |
| `src/server/security.ts` | utility (security boundary) | transform | itself — `redactSecrets` walk (`security.ts:159-184`) | exact |
| `src/server/security.test.ts` | test | pure unit | itself — redaction test (`security.test.ts:84-92`, must be rewritten) | exact |
| `src/server/state.ts` | store (persistence) | file-I/O / CRUD | itself — `connectionUrl` normalize/public pattern (`state.ts:26, 39, 92, 108`) | exact |
| `src/server/state.test.ts` | test | file-I/O round-trip | itself — owned-password round-trip test (`state.test.ts:8-27`) | exact |
| `src/server/api.ts` | controller (route table) | request-response | itself — `updateSettings` (`api.ts:157-168`), `bootstrap` (`:69-98`) | exact |
| `src/server/api.test.ts` | test | request-response (fake client) | itself — `runtimeWithProject()`/`call()` harness (`api.test.ts:11-91`), settings tests (`:169-201`) | exact |
| `src/server/opencode-client.ts` | service (HTTP adapter) | request-response | itself — `getConfig` (`:254-269`), `getAgents` (`:369-371`) | exact |
| `src/server/opencode-client.test.ts` | test | request-response (fake fetch) | itself — `mockFetch` (`opencode-client.test.ts:5-16`) | exact — **no edit needed** (grep: zero `updateConfig`/`patchConfig` references) |
| `src/lib/desk/client.ts` | service (browser API client) | request-response | itself — `api.settings` (`client.ts:170`), `Bootstrap` type (`:175-186`) | exact |
| `src/components/desk/settings.tsx` | component (Settings UI) | request-response + local state | itself — Connection `note` pattern (`settings.tsx:120-163`), `saveKey` error pattern (`:270-285`) | exact |
| `src/components/desk/app.tsx` *(discretion only)* | component (desk shell) | event-driven | itself — bootstrap seeding (`app.tsx:125`), `chooseProject` override (`:200`) | exact |

**Note on analogs:** because this phase is pure hardening of existing files, the closest analog for each change is the pattern already inside the same file (or its co-located test). The planner should copy these in-file patterns verbatim; RESEARCH.md proposed snippets are design, the excerpts below are repo truth at HEAD.

## Pattern Assignments

### `src/server/runtime.ts` (service, event-driven) — probe DI seam (V2-01)

**Analog:** itself — the three existing DI seams.

**Seam type + options pattern** (lines 32-40):
```typescript
export type SpawnImpl = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
export type SleepImpl = (ms: number) => Promise<void>;
export type KillImpl = (pid: number, signal: NodeJS.Signals) => void;
export type ControllerRuntimeOptions = {
  stateFile?: string;
  spawn?: SpawnImpl;
  sleep?: SleepImpl;
  kill?: KillImpl;
};
```
Add `export type ProbeImpl = (url: string, auth: { username: string; password: string }) => Promise<"ok" | "auth" | "down">;` beside these, and `probe?: ProbeImpl;` to the options type. The return union must match the private probe's exactly.

**Field + constructor assignment pattern** (lines 61-63, 72-74):
```typescript
  private readonly spawnImpl: SpawnImpl;
  private readonly sleepImpl: SleepImpl;
  private readonly killImpl: KillImpl;
```
```typescript
    this.spawnImpl = opts.spawn ?? spawn;
    this.sleepImpl = opts.sleep ?? sleep;
    this.killImpl = opts.kill ?? process.kill.bind(process);
```
Add `private readonly probeImpl: ProbeImpl;` and `this.probeImpl = opts.probe ?? ((url, auth) => this.probe(url, auth));` — keep the private method as the default impl.

**Call site 1 — `connectInner`** (lines 145-146):
```typescript
    const probed = await this.probe("http://127.0.0.1:4096", this.credentials());
    if (probed === "ok") return this.attach("http://127.0.0.1:4096", this.credentials(), false);
```

**Call site 2 — `waitUntilReady`** (lines 235-242):
```typescript
  private async waitUntilReady(url: string, auth: { username: string; password: string }): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const probed = await this.probe(url, auth);
      if (probed === "ok") return true;
      await this.sleepImpl(250);
    }
    return false;
  }
```
Replace `this.probe(` with `this.probeImpl(` at **both** sites (RESEARCH Pitfall 3). After the edit, grep `this.probe(` — zero direct calls may remain outside the default wrapper.

**Private probe being wrapped — keep unchanged as default** (lines 224-233):
```typescript
  private async probe(url: string, auth: { username: string; password: string }): Promise<"ok" | "auth" | "down"> {
    const client = new OpenCodeClient({ baseUrl: url, username: auth.username, password: auth.password });
    try {
      await client.getStatus();
      return "ok";
    } catch (err) {
      if (err instanceof OpenCodeError && err.status === 401) return "auth";
      return "down";
    }
  }
```

**Env-sensitive paths the test must scrub around** (lines 141-143, 182-187):
```typescript
    const explicit = (this.state.connectionUrl || process.env.OPENCODE_URL || "").trim();
    if (explicit) {
      return this.attach(explicit, this.credentials(), false);
    }
```
```typescript
  private credentials(): { username: string; password: string } {
    return {
      username: this.state.connectionUsername || process.env.OPENCODE_SERVER_USERNAME || "opencode",
      password: this.state.connectionPassword || process.env.OPENCODE_SERVER_PASSWORD || this.ownedPassword || "",
    };
  }
```

---

### `src/server/runtime.test.ts` (test, DI unit) — fix spawn test (V2-01)

**Analog:** itself — every other runtime test already injects seams.

**DI injection pattern** (lines 38-47, from "seam injection uses custom sleep and kill"):
```typescript
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    kill: (pid, signal) => {
      killCalls.push([pid, String(signal)]);
    },
    spawn: () => child as any,
  });
```

**Failing test to fix in place** (lines 118-150) — extend the options object at 123-131 with `probe: async () => "down",`:
```typescript
test("spawn uses detached:true", async () => {
  const file = tempStateFile();
  const spawnCalls: any[] = [];
  const child = makeChild(7777);
  // make child never ready so connect resolves quickly-ish
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async () => {},
    kill: () => {},
    spawn: (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      return child as any;
    },
  });
```

**Env save/restore pattern to extend** (lines 132-147) — currently handles only `OPENCODE_BIN`; add save/delete/restore for `OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME` in the same try/finally shape:
```typescript
  const prevBin = process.env.OPENCODE_BIN;
  const bin = join(tmpdir(), "fake-opencode-bin");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  process.env.OPENCODE_BIN = bin;
  try {
    await runtime.connect();
  } finally {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = prevBin;
    try {
      rmSync(bin, { force: true });
    } catch {
      /* ignore */
    }
  }
  assert.ok(spawnCalls.length > 0, "spawn invoked");
  assert.equal(spawnCalls[0].opts.detached, true, "detached true");
```

**Helpers to reuse unchanged** (lines 9-21): `makeChild(pid)` (EventEmitter fake) and `tempStateFile()` (mkdtemp under `tmpdir()`).

**Scope lock:** only this test + the seam. The other 6 tests in this file (and all other suites) stay untouched. Do NOT add an attach-branch test — `attach()` builds a real `OpenCodeClient` with real fetch (RESEARCH Pitfall 8).

---

### `src/server/security.ts` (utility, transform) — exact-match redaction (V2-03)

**Analog:** itself — the current `redactSecrets` walk.

**Corruption site — the ONLY lines that change** (lines 159-168):
```typescript
export function redactSecrets<T>(value: T, extra: readonly string[] = []): T {
  const needles = extra.filter((item) => item && item.length >= 4);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      let out = node;
      for (const needle of needles) {
        if (out.includes(needle)) out = out.split(needle).join("[redacted]");
      }
      return out;
    }
```
Replace the string branch body with whole-string equality: `return needles.some((needle) => node === needle) ? "[redacted]" : node;`. Keep the `length >= 4` filter line byte-identical (locked).

**Key-based redaction — UNCHANGED** (line 156 and lines 172-176):
```typescript
const SECRET_KEY = /(^key$|api[_-]?key|token|password|secret|authorization|credential|private[_-]?key)/i;
```
```typescript
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (SECRET_KEY.test(key)) {
          out[key] = child ? "[redacted]" : child;
          continue;
        }
```

**JSDoc invariant header convention** (line 158): `/** Remove credential-shaped fields before anything reaches the browser or logs. */` — update wording only if the contract description changes; keep the one-line doc style.

---

### `src/server/security.test.ts` (test, pure unit) — rewrite + regression (V2-03)

**Analog:** itself — existing test structure (`node:test` + `node:assert/strict`, lines 4-5).

**Test that MUST be rewritten in the same task as the semantic change** (lines 84-92) — it encodes the OLD substring contract:
```typescript
test("secrets are stripped from objects and strings", () => {
  const redacted = redactSecrets(
    { provider: { apiKey: "sk-live-secret", name: "openai" }, note: "token sk-live-secret leaked" },
    ["sk-live-secret"],
  );
  assert.equal(redacted.provider.apiKey, "[redacted]");
  assert.equal(redacted.note.includes("sk-live-secret"), false);
  assert.equal(JSON.stringify(redacted).includes("sk-live-secret"), false);
});
```
Rewrite contract: keep the `apiKey` key-redaction assertion; add exact-equality case (string === needle → `"[redacted]"`); assert the prose case now SURVIVES (documents the locked tradeoff). Do not delete the test outright.

**New regression fixtures** (design from RESEARCH §Code Examples — canonical `alibaba-token-plan` id, needle `"token"` length 5 passes the ≥4 filter):
```typescript
test("identifier payloads round-trip byte-identical through redaction", () => {
  const payload = {
    all: [{ id: "alibaba-token-plan", models: {} }],
    connected: ["alibaba-token-plan"],
  };
  const out = redactSecrets(payload, ["token"]);
  assert.deepEqual(out, payload);
  assert.equal(JSON.stringify(out), JSON.stringify(payload));
});

test("exact needle values are still redacted", () => {
  const out = redactSecrets({ a: "token", b: "alibaba-token-plan" }, ["token"]);
  assert.equal(out.a, "[redacted]");
  assert.equal(out.b, "alibaba-token-plan");
});
```
Reintroducing `out.split(needle).join(...)` fails the first test. **Pitfall 4:** never assert survival of VALUES under provider-id KEYS (e.g. `default["alibaba-token-plan"]`) — key-based redaction still clobbers those; that is locked behavior.

---

### `src/server/state.ts` (store, file-I/O) — deskModel field (V2-02)

**Analog:** itself — `connectionUrl`/`ownedServerPassword` field lifecycle.

**Type + doc-comment pattern** (lines 21-33):
```typescript
export type AppState = {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  appearance: Appearance;
  /** Optional override. Empty means discover/start the local OpenCode server. */
  connectionUrl: string;
  connectionUsername: string;
  /** Never serialized to the browser. */
  connectionPassword: string;
  /** Password this controller generated for a server it spawned, kept so a
   *  controller restart can re-attach to the still-running server. */
  ownedServerPassword: string;
};
```
Add `deskModel: string;` with a doc comment (desk default `provider/model`, `""` = unset). It is NOT a secret — no "never serialized" comment.

**EMPTY_STATE pattern** (lines 35-43): add `deskModel: "",` alongside `connectionUrl: "",`.

**Silent-upgrade normalize pattern** (line 92 and lines 97-99):
```typescript
    connectionUrl: typeof input?.connectionUrl === "string" ? input.connectionUrl : "",
```
```typescript
    connectionPassword: typeof input?.connectionPassword === "string" ? input.connectionPassword : "",
    ownedServerPassword:
      typeof input?.ownedServerPassword === "string" ? input.ownedServerPassword : "",
```
Add `deskModel: typeof input?.deskModel === "string" ? input.deskModel : "",` — missing/invalid → `""`. No migration script, no version bump. `writeState` (lines 60-71) re-normalizes on persist, so old files upgrade on first load/save automatically.

**publicState projection pattern** (lines 103-112):
```typescript
export function publicState(state: AppState) {
  return {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    appearance: state.appearance,
    connectionUrl: state.connectionUrl,
    connectionUsername: state.connectionUsername,
    hasConnectionPassword: Boolean(state.connectionPassword),
  };
}
```
Add `deskModel: state.deskModel,`. Passwords remain excluded.

---

### `src/server/state.test.ts` (test, file-I/O round-trip) — deskModel cases (V2-02)

**Analog:** itself — the owned-password round-trip test (lines 8-18):
```typescript
test("owned server password survives a controller restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
  const file = join(dir, "state.json");
  try {
    const state = { ...EMPTY_STATE, ownedServerPassword: "ocw_secret" };
    writeState(file, state);
    assert.equal(readState(file).ownedServerPassword, "ocw_secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```
Mirror this shape for: old-file silent upgrade (write JSON without `deskModel` → `readState(file).deskModel === ""`), invalid-type normalize (`normalizeState({ deskModel: 42 }).deskModel === ""`), round-trip, and `publicState` exposure. **Import note:** current imports are `import { mkdtempSync, rmSync } from "node:fs";` (line 3) — add `writeFileSync` for the old-file fixture.

**publicState secrecy test pattern** (lines 20-27) — for deskModel assert the INVERSE (it IS published):
```typescript
  const published = JSON.stringify(publicState(state));
  assert.equal(published.includes("ocw_secret"), false);
```

---

### `src/server/api.ts` (controller, request-response) — delete PATCH /config; deskModel in settings/bootstrap (V2-02)

**Analog:** itself — `updateSettings` and `bootstrap`.

**DELETE — route line** (line 48):
```typescript
    if (request.method === "PATCH" && route === "/config") return await patchConfig(runtime, request);
```

**DELETE — handler** (lines 303-311):
```typescript
async function patchConfig(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  const scope = body.scope === "project" ? activeProject(runtime)?.path : undefined;
  if (body.scope === "project" && !scope) return json(400, { error: "Select a project first" });
  const patch = body.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return json(400, { error: "Config patch is required" });
  const updated = await runtime.requireClient().updateConfig(patch as Record<string, unknown>, scope);
  return json(200, redactSecrets(updated, secretNeedles(runtime)));
}
```
After deletion, unknown routes fall through to the existing `return json(404, { error: "Not found" });` (line 56) — that is the 404 regression behavior, no new code needed. **KEEP** the GET read paths: `/config` in the `readOpenCode` group (line 45) and `client.getConfig` — bootstrap and Permissions depend on them.

**EXTEND — updateSettings** (lines 157-168), the sanctioned desk-state write path:
```typescript
async function updateSettings(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  if (body.appearance === "light" || body.appearance === "dark") runtime.state.appearance = body.appearance;
  if (typeof body.connectionUrl === "string") runtime.state.connectionUrl = body.connectionUrl.trim();
```
Add `if (typeof body.deskModel === "string") runtime.state.deskModel = body.deskModel;` before `runtime.persist()` (line 166). Accept ANY string — no model-list validation (locked). Response `json(200, publicState(runtime.state))` (line 167) carries `deskModel` automatically once `publicState` includes it.

**EXTEND — bootstrap precedence** (lines 82-97):
```typescript
    try {
      const config = await runtime.requireClient().getConfig(project.path);
      model = typeof config.model === "string" ? config.model : "";
    } catch {
      /* config is optional on first paint */
    }
  }
  return {
    status,
    ...publicState(runtime.state),
    sessions,
    groups: groupSessionsByDate(sessions.filter((item) => !item.archived)),
    model,
    agent,
    controllerVersion: CONTROLLER_VERSION,
  };
```
Before the return: `if (runtime.state.deskModel) model = runtime.state.deskModel;` — persisted desk default wins; OpenCode config model stays the fallback. The `...publicState` spread simultaneously exposes raw `deskModel` for Phase 8. `app.tsx:125` (`setModel(data.model)`) then works unchanged on reload. (RESEARCH Pitfall 6: without the precedence line, persistence is invisible.)

**Discretion — reset** (lines 112-122): optionally add `runtime.state.deskModel = "";` beside `runtime.state.appearance = "dark";` for consistency (RESEARCH Open Question 2). Existing reset test keeps passing either way.

**Shared boundary helpers — unchanged:** `readBody` (lines 400-409, `{ok}` union → `OpenCodeError(400)`), `secretNeedles` (lines 417-419), `errorResult` (lines 421-427), `json` (lines 429-431). All surviving `redactSecrets` call sites (101, 286, 288, 289, 340) keep working; line 310 disappears with the handler.

---

### `src/server/api.test.ts` (test, request-response) — harness reuse + replacements (V2-02/V2-03)

**Analog:** itself — `runtimeWithProject()` fake-client harness and `call()` helper.

**Harness** (lines 11-28, 83-91) — pre-set connected status, fake client, no network:
```typescript
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
```
```typescript
async function call(runtime: ControllerRuntime, method: string, path: string, body?: unknown) {
  const request = new Request("http://127.0.0.1:8080" + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
  const result = await handleApi(runtime, request);
  return result;
}
```

**DELETE — mock line** (line 58): `updateConfig: async (patch: Record<string, unknown>) => patch,`

**REPLACE — config-forward test** (lines 138-143) with the inverse 404 regression:
```typescript
test("config changes are forwarded, not reimplemented", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "PATCH", "/api/config", { patch: { model: "anthropic/claude" } });
  assert.equal(result.status, 200);
  assert.equal((result.body as { model: string }).model, "anthropic/claude");
});
```
→ new test asserts `result.status === 404` for the same call (guards reintroduction).

**Settings-test pattern to mirror for deskModel round-trip** (lines 178-184):
```typescript
test("non-empty password replaces stored password", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "stored-pw";
  const result = await call(runtime, "PATCH", "/api/settings", { connectionPassword: "new-pw" });
  assert.equal(result.status, 200);
  assert.equal(runtime.state.connectionPassword, "new-pw");
});
```
New deskModel test: PATCH `/api/settings` `{ deskModel: "alibaba-token-plan/model-a" }` → 200 + `body.deskModel` + `runtime.state.deskModel`; then GET `/api/bootstrap` → `body.model === "alibaba-token-plan/model-a"` (bootstrap works offline here: `getConfig` mocked at line 57 returns `{ model: "openai/gpt" }`, so precedence is provable).

**Route-level redaction round-trip pattern** (lines 114-119) — extend for identifiers:
```typescript
test("provider responses do not leak secrets and malformed bodies fail", async () => {
  const { runtime, calls } = runtimeWithProject();
  runtime.state.connectionPassword = "super-secret-password";
  const providers = await call(runtime, "GET", "/api/providers");
  assert.equal(JSON.stringify(providers.body).includes("sk-should-not-leak"), false);
```
For the V2-03 fixture: set `runtime.state.connectionPassword = "token"` (registers needle via `secretNeedles`), override the `getProviders` mock (line 62) to return `{ all: [{ id: "alibaba-token-plan", models: {} }], connected: ["alibaba-token-plan"], default: {} }`, GET `/api/providers`, assert `all[0].id` and `connected[0]` byte-identical. Boundary exercised: `api.ts:286`. **Pitfall 4:** do not assert survival of values under provider-id keys (`default` map).

---

### `src/server/opencode-client.ts` (service adapter, request-response) — delete updateConfig (V2-02)

**Analog:** itself — sibling methods `getConfig` / `getAgents`.

**DELETE — method** (lines 271-282):
```typescript
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
```

**KEEP — live read sibling** (lines 254-269, `getConfig` merges v2 config docs; bootstrap + Permissions depend on it) and the simple GET shape (lines 369-371):
```typescript
  async getAgents(directory?: string): Promise<unknown> {
    return this.request("GET", "/api/agent", { query: locationQuery(directory) });
  }
```

**Error convention (unchanged, for context):** every method routes through private `request()` (lines 553-592) which maps non-2xx to `OpenCodeError(status, message, retryable)` (class at lines 106-115) and network failure to `OpenCodeError(0, ..., true)`. Deleting `updateConfig` removes the only PATCH `/api/config` caller; no other method references it.

---

### `src/server/opencode-client.test.ts` (test, fake fetch) — NO EDIT REQUIRED

Grep at HEAD: zero `updateConfig`/`patchConfig` references in this file. The brief lists it in scope, but deletion of the client method requires no test change here. If any test were needed, the analog is `mockFetch` (lines 5-16):
```typescript
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

---

### `src/lib/desk/client.ts` (browser API client, request-response) — delete patchConfig; deskModel mirror (V2-02)

**Analog:** itself — `api.settings` and the `Bootstrap` mirror type.

**DELETE — method** (lines 150-151):
```typescript
  patchConfig: (patch: Record<string, unknown>, scope?: "project") =>
    request("/api/config", { method: "PATCH", body: JSON.stringify({ patch, scope }) }),
```

**KEEP — migration target, no signature change needed** (line 170):
```typescript
  settings: (body: Record<string, unknown>) => request("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
```
Also keep `config: () => request<Record<string, unknown>>("/api/config")` (line 149) — live GET read path.

**EXTEND — Bootstrap mirror** (lines 175-186): add `deskModel: string;`:
```typescript
export type Bootstrap = {
  status: ConnectionStatus;
  projects: Project[];
  activeProjectId: string | null;
  appearance: "dark" | "light";
  connectionUrl: string;
  hasConnectionPassword: boolean;
  sessions: SessionSummary[];
  groups: { label: string; items: SessionSummary[] }[];
  model: string;
  controllerVersion: string;
};
```
**Do not "fix" the pre-existing mirror gap** (`connectionUsername` absent from `Bootstrap` though `publicState` returns it) — out of scope. Browser code must never import `src/server/*`; types are duplicated by design.

**Error convention (unchanged):** `request<T>()` (lines 96-108) throws `Error(data.error || \`Request failed (${response.status})\`)` — Settings callers catch and narrow to a string.

---

### `src/components/desk/settings.tsx` (component, request-response + local state) — save migration + read-only sections (V2-02)

**Analog:** itself — Connection `note` pattern, `saveKey` error pattern, existing read-only note styling.

**MIGRATE — `setDeskDefault`** (lines 302-321):
```typescript
  async function setDeskDefault() {
    if (!selected) return;
    const fullModel = `${provider.id}/${selected}`;
    setSavingModel(true);
    setError(null);
    setNote(null);
    // OpenCode v2 has no remote write for the desk default model; the chosen
    // model is applied per-session on send (POST /api/session/{id}/model).
    // Update the desk model first so the choice always takes effect, then
    // best-effort persist to OpenCode config (ignored when unsupported).
    onModelChange(fullModel);
    try {
      await api.patchConfig({ model: fullModel });
      setNote("Desk default model saved in OpenCode.");
    } catch {
      setNote("Desk default model set for this desk.");
    } finally {
      setSavingModel(false);
    }
  }
```
Keep `onModelChange(fullModel)` first (instant UI). Replace try body with `await api.settings({ deskModel: fullModel }); setNote("Desk default model saved.");`. Replace the silently-positive catch with real error surfacing via the existing `error` state — copy the **`saveKey` error pattern** (lines 280-281):
```typescript
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this provider credential.");
```
Update the stale comment block (lines 308-311): persistence is now real and local. Note/error render lines already exist (lines 390-391): `{note && <p className="text-xs text-ok">{note}</p>}` / `{error && <p className="text-xs text-danger">{error}</p>}`.

**READ-ONLY — Agents section** (lines 397-445): keep `api.agents()` load + selector for browsing (lines 403-427); render `prompt`/`model` read-only (e.g. `readOnly` textarea / disabled input / static text). DELETE the Save button block (lines 431-441) containing the dead call (line 437):
```typescript
          void api.patchConfig({ agent: { [name]: agent } }).then(() => setNote("Agent saved.")).catch((err: Error) => setNote(err.message));
```
REPLACE the misleading header (line 417):
```typescript
      <p className="text-muted">Only fields OpenCode already supports are shown. Saving writes the agent block back through OpenCode config.</p>
```
→ honest read-only note (wording discretion), same `text-muted` paragraph style. Keep `note` state for load errors (line 442).

**READ-ONLY — Permissions section** (lines 447-481): keep `api.config()` load (lines 451-461); render each value as static text or `disabled` select (select markup at lines 468-472). DELETE the Save button (lines 475-477):
```typescript
      <Button onClick={() => void api.patchConfig({ permission: values }).then(() => setNote("Permissions saved.")).catch((err: Error) => setNote(err.message))}>
        Save permissions
      </Button>
```
KEEP the true explanatory line (line 464): `These are OpenCode's permission defaults. Live prompts still appear in the chat and are never auto-approved.` Add a read-only note in the same style.

**Note/feedback pattern to copy — Connection section** (lines 124, 134-137, 158):
```typescript
  const [note, setNote] = useState<string | null>(null);
```
```typescript
            void api.settings({ connectionUrl: url, connectionUsername: username, connectionPassword: password }).then(() => {
              setPassword("");
              setNote("Saved. Reconnect to apply.");
            });
```
```typescript
      {note && <p className="text-ok">{note}</p>}
```
Inline `note`/`error` only — no toasts (locked). Semantic tokens only: `text-muted`, `text-subtle`, `text-ok`, `text-danger`, `bg-elevated`, `border-border`.

**Existing redaction-defense line — keep** (line 252): `const providerDefault = defaultModel === "[redacted]" ? "" : defaultModel;` (Pitfall 4: key-based redaction of provider-id-keyed `default` map is unchanged behavior).

---

### `src/components/desk/app.tsx` (component — DISCRETION ONLY)

Not in the locked file list; RESEARCH Pitfall 7 / Open Question 1. Verified at HEAD:
- Line 125: `setModel(data.model);` — bootstrap seeding; works unchanged once api.ts applies deskModel precedence. **No edit needed.**
- Line 200: `if (typeof config.model === "string") setModel(config.model);` — `chooseProject` re-seeds from project config, masking the desk default on project switch. Optional one-line guard (`&& !model`); default is to LEAVE IT and note Phase 8 ownership (full reconciliation is Phase 8 locked scope). Either choice satisfies the locked criteria.

## Shared Patterns

### DI for side effects (never module mocking)
**Source:** `src/server/runtime.ts:32-40, 61-74` (spawn/sleep/kill); `src/server/opencode-client.ts:117-136` (`fetch?: typeof fetch` in `ClientOptions`)
**Apply to:** the new probe seam and its test injection
```typescript
export type ClientOptions = {
  baseUrl: string;
  username?: string;
  password?: string;
  fetch?: typeof fetch;
};
```
```typescript
    this.fetchImpl = options.fetch ?? fetch;
```

### Error handling — OpenCodeError only, mapped once
**Source:** `src/server/opencode-client.ts:106-115` (class), `src/server/api.ts:421-427` (`errorResult`), `src/server/api.ts:57-59` (single try/catch in `handleApi`)
**Apply to:** all server changes (no new error types; deleted route falls through to existing 404)
```typescript
function errorResult(err: unknown): ApiResult {
  if (err instanceof OpenCodeError) {
    const status = err.status === 0 ? 503 : err.status || 500;
    return json(status, { error: err.message, retryable: err.retryable });
  }
  return json(500, { error: err instanceof Error ? err.message : "Controller error" });
}
```

### Validation — `{ ok }` unions at the boundary, typeof guards for settings fields
**Source:** `src/server/security.ts:148-154` (`safeJson`), `src/server/api.ts:400-409` (`readBody`), `src/server/api.ts:159-165` (settings field guards)
**Apply to:** `deskModel` acceptance (`typeof body.deskModel === "string"` — accept any string, no model-list validation)
```typescript
export function safeJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Malformed JSON" };
  }
}
```

### Redaction boundary — every OpenCode payload passes redactSecrets + secretNeedles
**Source:** `src/server/api.ts:417-419` (needles), `src/server/api.ts:286` (providers boundary)
**Apply to:** V2-03 change (semantics only; call sites unchanged) and both regression fixtures
```typescript
function secretNeedles(runtime: ControllerRuntime): string[] {
  return [runtime.state.connectionPassword, process.env.OPENCODE_SERVER_PASSWORD ?? ""].filter(Boolean);
}
```
```typescript
    return json(200, { providers: redactSecrets(providers, secretNeedles(runtime)), auth });
```

### Test conventions — node:test + node:assert/strict, co-located, temp dirs, fake injection
**Source:** `src/server/state.test.ts:1-18` (imports + mkdtemp/finally pattern), `src/server/api.test.ts:11-91` (fake-client harness), `src/server/runtime.test.ts:9-21` (fake child + temp state)
**Apply to:** every test edit this phase; run via `node --experimental-strip-types --test <file>`; full gate `flock -w 900 /tmp/team-build.lock npm test` in BOTH environments (live-server host + `unshare -Urn sh -c 'ip link set lo up && npm test'`)
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

### UI feedback — inline note/error state, semantic Tailwind tokens
**Source:** `src/components/desk/settings.tsx:124, 158` (Connection note), `:280-281, 390-391` (ProviderCard error/note render)
**Apply to:** model-save migration and both read-only sections; no toast infrastructure
```typescript
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this provider credential.");
```
```typescript
        {note && <p className="text-xs text-ok">{note}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every change modifies an existing file whose own patterns are the analog. Zero new files, zero new abstractions. |

## Planner Guardrails (from locked decisions + research pitfalls)

1. **Delete, don't wrap** — the dead chain's 9 locations (RESEARCH §Dead-Chain Deletion List, all re-verified at HEAD) are deleted end-to-end; no try/catch around 404s.
2. **Both probe call sites** — `runtime.ts:145` AND `:237`; grep `this.probe(` after edit (Pitfall 3).
3. **Rewrite, don't delete** — `security.test.ts:84-92` and `api.test.ts:138-143` must be replaced with new-contract tests in the same task as their semantic changes (Pitfalls 1-2).
4. **Fixture shape** — assert identifier survival in arrays/fields (`all[].id`, `connected[]`), never values under provider-id keys (Pitfall 4).
5. **Bootstrap precedence** — `deskModel` wins when non-empty; keep both `model` and `deskModel` in the response (Pitfall 6).
6. **No scope creep** — no attach-branch test / fetch seam on runtime (Pitfall 8); no new routes, files, dependencies; `package.json`/lockfile untouched; `routeTree.gen.ts` untouched; `Bootstrap.connectionUsername` mirror gap left alone.
7. **Env scrub** — `OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD` (locked) + `OPENCODE_SERVER_USERNAME` (discretionary symmetry) in the spawn test's save/restore (Pitfall 5).

## Metadata

**Analog search scope:** `src/server/`, `src/lib/desk/`, `src/components/desk/` (all 13 in-scope files read at HEAD; targeted non-overlapping reads for `opencode-client.ts`)
**Files scanned:** 13 source/test files + `package.json` suite composition (via RESEARCH, verified)
**Git-tracked verification:** `git ls-files` non-empty for all 13 paths — no mirror paths emitted
**HEAD at mapping:** `e6b5088` (research line numbers at `acfc44e` re-verified; all match)
**Pattern extraction date:** 2026-11-21
