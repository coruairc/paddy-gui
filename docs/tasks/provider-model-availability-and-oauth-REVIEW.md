---
phase: provider-model-availability-and-oauth
reviewed: 2026-11-23T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/server/provider-directory.ts
  - src/server/provider-directory.test.ts
  - src/server/api.ts
  - src/server/api.test.ts
  - src/server/opencode-client.ts
  - src/server/opencode-client.test.ts
  - src/server/state.ts
  - src/server/state.test.ts
  - src/lib/desk/client.ts
  - src/components/desk/settings.tsx
  - src/components/desk/app.tsx
  - package.json
findings:
  critical: 0
  warning: 7
  info: 8
  total: 15
status: issues_found
---

# Provider model availability + OAuth sign-in + Configured / Not configured: Code Review Report

**Reviewed:** 2026-11-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found
**Scope:** commits `c546d0b..60a039e` (HEAD). Intent taken from `docs/tasks/provider-model-availability-and-oauth.md`.

## Summary

The change is well structured. The models.dev fetch is correctly isolated in `provider-directory.ts`, and I confirmed the approved host is the only outbound destination. `redirect: "error"` is set and is covered by a test. The response is projected through an explicit allowlist. The OAuth attempt ID is regex-validated before any upstream call, and every OAuth route resolves the integration and method against OpenCode's own inventory before proxying. `package.json` changed only the `test` script (one file added); there are no dependency changes. The 127 focused tests in `provider-directory`, `state`, `opencode-client` and `api` all pass (`flock -w 900 /tmp/team-build.lock node --experimental-strip-types --test ...`).

I found **no Critical issues**. The defects are in robustness and correctness of the directory cache and the OAuth projections, plus one defence-in-depth gap on the OAuth responses. Most significant:

1. An empty but valid models.dev body (`{}`) is cached as a *successful* 24-hour result, so the Not configured tab shows "Every OpenCode-supported provider is configured" for a day (WR-01).
2. A failed read of `/api/provider` silently marks every integration as "Not configured", which breaks AC-C1 (WR-02).
3. The OAuth projections dereference unchecked upstream payloads and return an unvalidated `url` and `attemptID` to the browser (WR-03, WR-04).

## Critical Issues

None.

## Warnings

### WR-01: Empty catalog body is cached as a successful fetch for 24 h

**File:** `src/server/provider-directory.ts:127-134` (also `src/server/api.ts:471`)
**Issue:** `projectDirectory()` returns `[]` for a valid JSON object with no usable entries (for example `{}`), and it is not treated as `SHAPE_ERROR` (only `null` is). `load()` therefore caches `{ providers: [], fetchedAt }` for `PROVIDER_DIRECTORY_TTL_MS` (24 h). `readProviderDirectory` then returns `{ directory: [] }` with no `error`, so the UI shows the success state "Every OpenCode-supported provider is configured." for a day. I reproduced this: `new ProviderDirectory({ fetch: () => Response("{}") }).get()` returns `providers: 0, error: undefined, fetchedAt: 0`. The fail-closed negative cache (60 s) is never applied.
**Fix:**
```ts
// provider-directory.ts, in load(), after projectDirectory():
const providers = projectDirectory(parsed.value);
if (providers === null || providers.length === 0) {
  return this.rememberFailure(SHAPE_ERROR);
}
```
Add a test with `{}` and with `{ "x": null }` expecting `error` to match `/unexpected shape/i`.

### WR-02: A failed `/api/provider` read marks every integration "Not configured"

**File:** `src/server/api.ts:482` and `:493-498`
**Issue:** `client.getProviderCatalog(projectPath).catch(() => null)` is handled as `providers ?? []`, so `active` is empty when the read fails. Every models.dev entry that is in the integration inventory is then returned with `configured: false`, including providers that are active. The inventory failure is handled correctly (returns `OPENCODE_INVENTORY_ERROR`, lines 487-490), but the active-provider failure is not. This contradicts AC-C1 ("Do not label ... when OpenCode has no corresponding...") and the R2 decision in the planning doc. A user can be shown "Connect" for a provider that is already configured.
**Fix:**
```ts
const [integrations, providers] = await Promise.all([
  client.listIntegrations(projectPath).catch(() => null),
  client.getProviderCatalog(projectPath).catch(() => null),
]);
if (!integrations || !providers) {
  response.error = OPENCODE_INVENTORY_ERROR;
  return json(200, redactSecrets(response, secretNeedles(runtime)));
}
```
Add a test where `getProviderCatalog` throws, expecting `directory: []` and the error.

### WR-03: OAuth projections dereference unchecked upstream payloads (500 on an empty body)

**File:** `src/server/api.ts:921-944` and `src/server/opencode-client.ts:557-581`
**Issue:** `OpenCodeClient.request()` returns `null` for any 204 (line 829). `startOAuthConnect` and `getOAuthConnectStatus` cast that `null` to the attempt type. `projectOAuthAttempt(attempt)` then reads `attempt.time`, and `projectOAuthStatus(attempt)` reads `attempt.status`, both of which throw `TypeError`. `errorResult` turns this into a 500 whose message is the raw TypeError text. Nothing in the route layer guards for a missing or non-object payload.
**Fix:**
```ts
// api.ts
function projectOAuthAttempt(attempt: OpenCodeOAuthAttempt | null): Record<string, unknown> {
  if (!attempt || typeof attempt !== "object") throw new OpenCodeError(502, "OpenCode returned no sign-in attempt");
  ...
}
function projectOAuthStatus(attempt: OpenCodeOAuthAttemptStatus | null): Record<string, unknown> {
  if (!attempt || typeof attempt !== "object") throw new OpenCodeError(502, "OpenCode returned no sign-in status");
  ...
}
```

### WR-04: OAuth start returns an unvalidated `attemptID` and `url` to the browser

**File:** `src/server/api.ts:921-926` (rendered at `src/components/desk/settings.tsx:1201-1206` and `:1117`)
**Issue:**
- `attemptID` falls back to `""` when OpenCode omits it. The browser then calls `/oauth/` and `/oauth/<id>` with an id that the local route regex rejects (400, or 404 for the empty path). The attempt is created upstream but can never be polled, completed or cancelled from Paddy, and it is orphaned until it expires. `OAUTH_ATTEMPT` is checked only on inbound requests, never on the value Paddy returns.
- `url` is forwarded as-is into `<a href>` ("Open sign-in") and `navigator.clipboard.writeText`. I confirmed that `javascript:alert(1)` passes through `startOAuthConnect` unchanged. The threat requires a misbehaving OpenCode response, so this is not directly attacker-reachable, but the controller is the stated security boundary and should not forward non-web schemes.
**Fix:**
```ts
// api.ts, in projectOAuthAttempt (or before it, in integrationOAuth):
const attemptID = typeof attempt?.attemptID === "string" ? attempt.attemptID : "";
if (!OAUTH_ATTEMPT.test(attemptID)) throw new OpenCodeError(502, "OpenCode returned an unusable sign-in attempt");
const url = safeHttpUrl(attempt.url); // returns "" unless new URL(v).protocol is https: or http:
if (!url) throw new OpenCodeError(502, "OpenCode returned an unusable sign-in link");
```

### WR-05: OAuth responses skip the secret-redaction pass every other proxy route applies

**File:** `src/server/api.ts:865` and `:886`
**Issue:** `projectOAuthAttempt` and `projectOAuthStatus` are the only proxied responses that are returned without `redactSecrets(..., secretNeedles(runtime))`. `instructions`, `message` and `url` are passed through verbatim. An upstream message that echoes a credential, or the controller's own password, would reach the browser. Every other route in `handleApi` applies this pass, and `redactSecrets` also covers the key-named fields (`token`, `secret`, `key`).
**Fix:**
```ts
return json(200, { attempt: redactSecrets(projectOAuthAttempt(attempt), secretNeedles(runtime)) });
return json(200, { attempt: redactSecrets(projectOAuthStatus(status), secretNeedles(runtime)) });
```

### WR-06: `complete()` starts a second concurrent poll loop; the orphaned timer cannot be cleared

**File:** `src/components/desk/settings.tsx:1061-1090` (poll loop at `:960-1011`)
**Issue:** `complete()` calls `void poll(attempt.attemptID)` on success without first calling `stopPolling()`. If the 2-second poll timer is already scheduled (the normal case while the user types the code), two chains run. Each pending response overwrites `timerRef.current`, so the earlier timer is no longer tracked and `stopPolling()` (in cancel and on teardown) cannot clear it. The chains share `pollCount`, so the 300-poll (about 10 min) budget is consumed twice as fast. The error path already guards this (`if (timerRef.current === null)`, line 1081), but the success path does not.
**Fix:**
```ts
// complete(), success branch:
stopPolling();
setCode("");
void poll(attempt.attemptID);
```

### WR-07: Request bodies are read without any size cap

**File:** `src/server/api.ts:1027-1028` (no cap found in `src/server/http.ts`)
**Issue:** `readBody` calls `request.text()` with no byte limit. The new OAuth routes read the whole body first, then check `code` (8192) and `answer` (50 keys, but no per-string limit) afterwards. A large authenticated body is therefore buffered in full before any validation. This predates this change for other routes, but the OAuth routes add new unbounded inputs.
**Fix:** Reject bodies over a fixed cap (for example 64 KiB) before buffering: check `content-length`, and read via a streamed reader that aborts past the cap. Also cap each `answer` string length in `oauthAnswer`.

## Info

### IN-01: models.dev `doc` URL is forwarded unvalidated

**File:** `src/server/provider-directory.ts:172` and `src/server/api.ts:517`
**Issue:** `doc` is any non-empty string up to 2048 characters. It is not rendered today (DirectoryCard does not use it), but a future `<a href={doc}>` would inherit a `javascript:` risk.
**Fix:** Keep `doc` only if `new URL(doc).protocol` is `https:`.

### IN-02: `configured` mixes provider IDs and integration IDs

**File:** `src/server/api.ts:494-497`
**Issue:** `active` contains both `provider.id` and `provider.integrationID`. A models.dev entry can therefore be hidden from Not configured because a different provider's alias is active, while no Configured card shows that entry's ID. The Configured and Not configured counts can then disagree. This may be intended, but it is not documented.
**Fix:** Either document the alias rule in the function comment, or match only `provider.id` and use `integrationID` solely to find auth methods.

### IN-03: A failed refresh discards the last good catalog

**File:** `src/server/provider-directory.ts:141-145`
**Issue:** After the 24-hour TTL expires, a transient upstream failure replaces the good catalog with an error for 60 seconds. Serving the last good result with a `stale` flag would be more robust. This is a design choice, not a defect.

### IN-04: Unknown OAuth status values are treated as "pending"

**File:** `src/server/api.ts:933-938` (poll loop `src/components/desk/settings.tsx:960-971`)
**Issue:** Any status other than `complete`, `failed` or `expired` is projected to `pending`. An unexpected terminal status keeps the UI polling for about 10 minutes before "timed out".
**Fix:** Pass unknown statuses through as `failed`, or stop after a fixed number of consecutive unknown responses.

### IN-05: Non-hidden form-field defaults pass through the auth projection

**File:** `src/server/opencode-client.ts:968`
**Issue:** Only `hidden` fields have their `default` removed. A visible field whose default is a credential would reach the browser. The current OpenCode form schema makes this unlikely.
**Fix:** Also strip `default` when `field.key` matches the credential pattern (`SECRET_KEY` in `security.ts`).

### IN-06: `loadDirectory()` has no request gate

**File:** `src/components/desk/settings.tsx:285-302` (called from `refreshAll` at `:310-314` and from Retry at `:440`)
**Issue:** Overlapping calls can resolve out of order, so an older response can overwrite a newer one. The codebase already uses `createRequestGate` for the equivalent model and command catalogs.
**Fix:** Wrap `loadDirectory` in a `createRequestGate()` ticket and drop responses that are no longer current.

### IN-07: Identifiers are truncated, not rejected

**File:** `src/server/provider-directory.ts:213-218`
**Issue:** `boundedString` silently truncates IDs longer than 256 characters. Two distinct long model IDs with the same prefix collapse, and the truncated ID is not a real OpenCode ID. No current consumer adds from the directory, but AC-C5 requires validation before any add.
**Fix:** Reject overlong IDs (skip the entry) instead of truncating them.

### IN-08: Test gaps and one pre-existing no-op

**Files:** `src/server/api.test.ts`, `src/server/provider-directory.test.ts`, `src/server/opencode-client.test.ts`
**Issue:** The following are not covered in the tests I read: an empty `{}` catalog (WR-01); `getProviderCatalog` failing in the directory route (WR-02); a 204 or empty OAuth start/status payload (WR-03); an invalid `attemptID` or non-http URL in an OAuth start response (WR-04); the duplicate poll in `complete()` (WR-06). Separately, `src/server/api.ts:125` contains `.filter((item) => !item.archived || true)`, which is always true. It predates this change (present in `c546d0b`) and is a no-op.
**Fix:** Add regression tests for the items listed above. Remove the `|| true` filter as a separate, unrelated cleanup.

---

_Reviewed: 2026-11-23T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
