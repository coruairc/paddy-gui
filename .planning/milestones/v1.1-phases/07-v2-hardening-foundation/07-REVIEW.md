---
phase: 07-v2-hardening-foundation
reviewed: 2026-11-22T00:45:12Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/components/desk/settings.tsx
  - src/lib/desk/client.ts
  - src/server/api.test.ts
  - src/server/api.ts
  - src/server/opencode-client.ts
  - src/server/runtime.test.ts
  - src/server/runtime.ts
  - src/server/security.test.ts
  - src/server/security.ts
  - src/server/state.test.ts
  - src/server/state.ts
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
  necessity: 0
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-11-22T00:45:12Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the three plans' changed files against the phase contract: exact-match redaction (V2-03), the injectable `ProbeImpl` seam (V2-01), `deskModel` persistence (V2-02), and the Settings/dead-chain cleanup.

What holds up:

- `redactSecrets` string branch is now a single whole-string equality check (`security.ts:168`); no substring splice remains anywhere (`grep 'split(needle)' src/server` → 0). The `length >= 4` needle filter and `SECRET_KEY` key branch are unchanged. The byte-identical regression tests are present at unit and `/api/providers` route level and genuinely fail against the old substring implementation.
- Both probe call sites (`runtime.ts:149`, `:241`) route through `probeImpl`; the production default still delegates to the private `probe` (`runtime.ts:78`). `grep 'await this.probe('` → 0.
- `deskModel` is in all four state sites (`AppState`, `EMPTY_STATE`, `normalizeState`, `publicState`), the `typeof` guard silently upgrades old files, `bootstrap` gives the persisted value precedence, `reset` clears it, and `publicState` never exposes either password.
- The dead `updateConfig` → `PATCH /api/config` → `api.patchConfig` chain is gone from `src/` (repo-wide grep → 0 outside ignored `dist/`), and the inverse 404 regression is present and passing.
- The model-default save now surfaces failures through `setError` (no silently-positive catch), and no toast infrastructure was introduced.
- Verified locally: full `npm test` (88/88 TS + script suites), `npx tsc --noEmit` exit 0, and targeted eslint shows only the 3 pre-existing `react-hooks/exhaustive-deps` warnings.

What does not hold up:

- The phase asserts the GET `/api/config` read path is retained and that Permissions renders OpenCode data read-only with no error notes (07-03-PLAN must_haves; 07-VALIDATION manual check). The route is still advertised in `readOpenCode`'s dispatch group (`api.ts:45`), but `readOpenCode` has **no `/config` branch** — I executed `handleApi` directly and confirmed `GET /api/config` returns `404 {"error":"Not found"}` and never calls `getConfig`. The read-only Permissions section therefore shows a "Not found" note and fabricated `ask` values for every key. This is the phase's own V2-02 acceptance criterion failing.
- The read-only Agents section does not seed its model field for the initially selected agent, so it displays "No model set in OpenCode" even when one exists — a misleading read-only surface.
- Two smaller test-reliability gaps weaken the hermeticity claim (environment-dependent seam assertion; fixed `/tmp` path for parallel runs) and the spawned test still performs a loopback bind.

The necessity rubric was read; no necessity findings were identified (`necessity: 0`).

## Critical Issues

### CR-01: `GET /api/config` is dispatched but has no handler — Permissions read-only section always errors

**File:** `src/server/api.ts:45`, `src/server/api.ts:272-304` (also `src/components/desk/settings.tsx:439-449`, `src/lib/desk/client.ts:149`)

**Issue:** The GET dispatch group includes `route === "/config"` (`api.ts:45`) and forwards to `readOpenCode(runtime, "/config")`. `readOpenCode` handles `/providers`, `/agents`, `/mcp`, `/permissions`, `/vcs`, and `/files/status`, but there is no `/config` branch — execution reaches `return json(404, { error: "Not found" })` (`api.ts:304`), or `400 "Select a project first"` when no project is active, or `503` when disconnected. I reproduced this by constructing a runtime with a project and a fake `getConfig` and calling `handleApi`:

```text
status: 404 body: {"error":"Not found"} getConfigCalled: false
```

Consequences:

1. `Permissions` (`settings.tsx:440`) calls `api.config()`, hits 404, lands in `.catch((err) => setNote(err.message))`, and renders the note "Not found". `values` stays `{}`, so all five permission rows render `values[key] ?? "ask"` (`settings.tsx:457`) — i.e. it fabricates `ask` defaults rather than showing OpenCode's real permission configuration.
2. `app.tsx:197` calls `api.config()` on project switch and silently swallows the failure, so the config-model fallback never re-seeds the desk model (deferred UI work, but the same root cause).

This directly violates the phase's stated outcomes — 07-03-PLAN must_haves say "Agents and Permissions sections render OpenCode data read-only ... no Settings action 404s or silently fails", and 07-VALIDATION's manual check says "no error notes". The research file asserts (`07-RESEARCH.md:450`) "`GET /api/config` ... live read paths — keep them [VERIFIED: grep + reads this session]"; that verification was wrong. The handler existed at `5f1477d` but was dropped in the v2 migration (`9a08c1b`), so the defect is pre-existing — but this phase made the route load-bearing by converting Permissions to a read-only view of it and declared V2-02 complete.

**Fix:** Add the missing branch in `readOpenCode` alongside the other OpenCode reads, before the `if (!directory) return json(400, ...)` guard so it works without a selected project (matching the old 5f1477d behavior):

```ts
if (route === "/config") {
  return json(200, redactSecrets(await client.getConfig(directory), secretNeedles(runtime)));
}
```

Add the corresponding regression test (the phase currently has none for this route):

```ts
test("GET /api/config returns the merged config", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "GET", "/api/config");
  assert.equal(result.status, 200);
  assert.equal((result.body as { model: string }).model, "openai/gpt");
});
```

## Warnings

### WR-01: Read-only Agents model field is not populated for the initially selected agent

**File:** `src/components/desk/settings.tsx:402-412`, `src/components/desk/settings.tsx:429`

**Issue:** The initial load sets `name` and `prompt` from the first agent but never sets `model`:

```tsx
const first = payload[0] as { name?: string; prompt?: string } | undefined;
if (first?.name) {
  setName(first.name);
  setPrompt(first.prompt ?? "");
}
```

The select defaults to the first agent (`value={name}`), yet the model `<Input value={model} readOnly placeholder="No model set in OpenCode" />` renders empty because `model` is still `""`. The section therefore claims an agent has no model when OpenCode reports one. (The old editable input had the same pre-existing gap, but this phase's `readOnly` placeholder turns it into an explicit false statement, which conflicts with the "shown here read-only" note.)

**Fix:** Seed `model` in the same effect (and type the first item accordingly):

```tsx
const first = payload[0] as {
  name?: string;
  prompt?: string;
  model?: { providerID?: string; modelID?: string };
} | undefined;
if (first?.name) {
  setName(first.name);
  setPrompt(first.prompt ?? "");
  setModel(
    first.model?.providerID && first.model.modelID
      ? `${first.model.providerID}/${first.model.modelID}`
      : "",
  );
}
```

### WR-02: Hermetic spawn test does not assert the injected probe was used

**File:** `src/server/runtime.test.ts:124-163`

**Issue:** The test injects `probe: async () => "down"` (`:132`) and asserts only that `spawn` was called (`:161`) and `detached: true` (`:162`). It never records or asserts that the injected probe was invoked. In the "nothing listening" environment (the CI-critical case), reverting `connectInner` to the private `this.probe(...)` would still return `"down"`, still take the spawn path, and the test would still pass — so the test cannot detect a seam regression in exactly the environment the V2-01 gate is meant to make trustworthy. (In the live-server environment it would catch it, because the real probe returns `"auth"`.) The static `grep 'await this.probe(' == 0` gate covers direct calls, but the runtime assertion should not depend on the ambient listener.

**Fix:** Record probe invocations and assert them:

```ts
const probeCalls: string[] = [];
const runtime = new ControllerRuntime({
  // ...
  probe: async (url) => {
    probeCalls.push(url);
    return "down";
  },
});
// ...
assert.ok(probeCalls.length > 0, "injected probe was used");
assert.equal(probeCalls[0], "http://127.0.0.1:4096");
```

## Info

### IN-01: Fixed `/tmp/fake-opencode-bin` path contradicts the parallel-run independence claim

**File:** `src/server/runtime.test.ts:142-144`

**Issue:** The test writes the fake binary to a fixed path (`join(tmpdir(), "fake-opencode-bin")`). Two concurrent `npm test` invocations (the repo coordinates shared-tree builds with `flock`) would share that path; one run's `rmSync` in `finally` can remove the other run's binary mid-test, and both write the same file. The comment at `:137-138` explicitly claims the outcome is "independent of ... parallel runs", which is not true for this artifact. `tempStateFile()` already uses `mkdtempSync`; the bin should follow the same pattern.

**Fix:** Create a unique temp directory for the binary:

```ts
const binDir = mkdtempSync(join(tmpdir(), "paddy-bin-"));
const bin = join(binDir, "opencode");
// finally: rmSync(binDir, { recursive: true, force: true });
```

### IN-02: Key-based `SECRET_KEY` redaction can still corrupt identifier-keyed maps

**File:** `src/server/security.ts:156`, `src/server/security.ts:174-175`

**Issue:** `SECRET_KEY` is unanchored (`/(^key$|api[_-]?key|token|password|secret|authorization|credential|private[_-]?key)/i`), and the key branch replaces the **value** under any matching key with the string `"[redacted]"`. The `/providers` payload contains identifier-keyed maps — `providers.default` (provider IDs) and each provider's `models` (model IDs). A model ID such as `"tokenizer-7b"` matches `token`, so its `RuntimeModel` object becomes the string `"[redacted]"`; the client type `RuntimeProvider.models?: Record<string, RuntimeModel>` (`client.ts:28`) then lies, and the Settings model list silently loses that model's name/status. This is the same class of identifier corruption V2-03 set out to remove, just on the key side. It is explicitly locked ("key-based `SECRET_KEY` redaction stays unchanged", 07-CONTEXT D-04) and the new route test deliberately avoids asserting under provider-ID keys, so this is informational rather than a defect in the delivered change.

**Fix:** Not required this phase. For a future decision, either (a) exempt known identifier-keyed maps (provider/model maps) from key-based redaction before walking them, or (b) anchor/allowlist the credential field names so identifier-shaped keys are not matched by the unanchored `token`/`key` alternations.

### IN-03: Spawn test still performs a real loopback bind via `freePort`

**File:** `src/server/runtime.ts:164`, `src/server/runtime.ts:414-429`, `src/server/runtime.test.ts:124-163`

**Issue:** The plan's must-have says "no real network call occurs on the test connect path." The injected probe removes the HTTP call, but `connectInner` still calls `freePort(4096)`, which binds a real TCP socket on `127.0.0.1:4096` (or an ephemeral fallback). It is loopback-only and short-lived, and the netns proof brings `lo` up, so this does not break the gate — but the test is not fully network-free and would fail in a namespace without loopback. This is pre-existing behavior, surfaced for accuracy of the hermeticity claim.

**Fix:** Optional: inject the port allocator the same way as `probe`/`spawn` (e.g. `port?: () => Promise<number>`) so the spawn test can return a fixed port, or explicitly document that loopback must be up for the suite.

---

_Reviewed: 2026-11-22T00:45:12Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
