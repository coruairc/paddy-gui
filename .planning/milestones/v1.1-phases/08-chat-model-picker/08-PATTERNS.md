# Phase 8: Chat Model Picker - Pattern Map

**Mapped:** 2026-11-22
**Verified at HEAD:** `da15092` — every line number below re-read in the working tree this session. Phase 7 deliverables (`deskModel` in `state.ts`/`api.ts`/`settings.tsx`, exact-match `redactSecrets`) are landed.
**Files analyzed:** 12 (3 new files, 9 modifications)
**Analogs found:** 12 / 12 (all modification targets are their own best analog; `models.ts`/`models.test.ts` borrow from `messages.ts`/`messages.test.ts`; `model-picker.tsx` is a role-match because no combobox exists)
**Tracked-source gate:** every analog path below confirmed via `git ls-files -- <path>` (non-empty). No `.gsd/` mirror paths used.

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/opencode-client.ts` *(mod)* | service (OpenCode adapter) | request-response | itself — `getConfig` (`:254-269`), `getProviders` (`:271-312`), `request()` (`:540-579`) | exact |
| `src/server/api.ts` *(mod)* | controller (route table) | request-response | itself — `readOpenCode` (`:272-306`), `send` (`:240-253`), `splitModel` (`:406-410`) | exact |
| `src/server/normalize.ts` *(mod)* | service (event projection) | event-driven / transform | itself — `summarizeSession` (`:93-107`), `normalizeEvent` (`:157-362`), `GuiEvent` (`:55-66`) | exact |
| `src/lib/desk/client.ts` *(mod)* | service (browser API + mirrored types) | request-response | itself — `request()` (`:96-108`), `api.settings` (`:168`), `DeskEvent` (`:82-94`) | exact |
| `src/components/desk/app.tsx` *(mod)* | component (desk shell) | event-driven + local state | itself — `applyEvent` (`:58-113`), header (`:437-460`), `openSession` (`:218-238`) | exact |
| `src/components/desk/models.ts` *(new)* | utility (pure logic) | transform | `src/components/desk/messages.ts` (`:1-57`) + `settings.tsx` filter (`:265-268`) | role-match |
| `src/components/desk/models.test.ts` *(new)* | test | pure unit | `src/components/desk/messages.test.ts` (`:1-73`) | exact (structure) |
| `src/components/desk/model-picker.tsx` *(new)* | component (APG combobox) | request-response + local state | `settings.tsx` `Providers`/`ProviderCard` (`:165-394`), `PermissionCard` local state (`app.tsx:730-822`) | role-match (no combobox exists) |
| `src/server/opencode-client.test.ts` *(mod)* | test | request-response (fake fetch) | itself — `mockFetch` (`:5-16`), model POST test (`:69-86`) | exact |
| `src/server/api.test.ts` *(mod)* | test | request-response (fake runtime) | itself — `runtimeWithProject()` (`:11-85`), `call()` (`:87-95`), redaction round-trip (`:133-146`) | exact |
| `src/server/normalize.test.ts` *(mod)* | test | pure unit / fixture | itself — event tests (`:102-167`) | exact |
| `package.json` *(NOT modified — see note)* | config (test manifest) | — | itself — `test` script (`:22`) | exact (read-only reference) |

> `src/server/state.ts`, `src/server/security.ts`, `src/server/runtime.ts` need **no edits** this phase: persistence, exact-match redaction, and the SSE fan-out are already in place (verified `state.ts:34,103,115`, `security.ts:156-187`, `runtime.ts:294-303`).

---

## Layer 1 — `src/server/opencode-client.ts` (service, request-response)

**Analog:** itself — the thin-adapter shape plus the `locationQuery`/`request()` helpers.

**Wire type to add** — do **not** reuse the stale `OpenCodeModel` (`:62-70`, whose `capabilities.{reasoning,attachment,toolcall}` do not exist in v2.3.2). Add a permissive live-shaped type beside it:

```typescript
// opencode-client.ts:62-70 (existing, stale — keep for Settings; do not copy into DeskModel)
export type OpenCodeModel = {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  status?: string;
  capabilities?: { reasoning?: boolean; attachment?: boolean; toolcall?: boolean };
  limit?: { context?: number; input?: number; output?: number };
};
```

New type (mirrors live `Model.Info` required fields; keep `id` required, unlike the legacy type):

```typescript
export type OpenCodeModelInfo = {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  status?: "alpha" | "beta" | "deprecated" | "active";
  enabled?: boolean;
  limit?: { context?: number; input?: number; output?: number };
  time?: { released?: number };
  capabilities?: { tools?: boolean; input?: string[]; output?: string[]; temperature?: boolean };
  variants?: Array<{ id: string }>;
};
```

**Method placement + helper reuse** (`:254-269` shows `getConfig` calling `locationQuery` then `this.request`, and `:589-591` shows `asArray`):

```typescript
// opencode-client.ts:254-269 (pattern to copy)
async getConfig(directory?: string): Promise<Record<string, unknown>> {
  const query = locationQuery(directory);
  const docs = await this.request("GET", "/api/config", { query });
  ...
}
```

```typescript
// opencode-client.ts:589-595 (helpers to reuse verbatim)
function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function locationQuery(directory?: string): Record<string, string | undefined> {
  return directory ? { "location[directory]": directory } : {};
}
```

`request()` already unwraps `{data}` (`:578`, `:582-587`), returns `null` on 204 (`:561`), and throws `OpenCodeError` on non-2xx (`:571-577`) — **no new seam needed**; `ClientOptions.fetch` (`:117-122`) is the existing test injection.

Methods to add:
- `listModels(directory?: string)` → `this.request("GET", "/api/model", { query: locationQuery(directory) })`, wrapped in `asArray<OpenCodeModelInfo>`.
- `getDefaultModel(directory?: string)` → `this.request("GET", "/api/model/default", …)`, return object-or-null (the route builds the key from `id`, not `modelID`).

**Correction to RESEARCH snippet:** the existing private `defaultModel()` (`:524-530`) formats `"${providerID}/${modelID ?? id}"` and therefore mis-keys speed-tier defaults. Phase 8's `getDefaultModel()` must build the key from **`id`**, or (safer) return the raw `OpenCodeModelInfo` and let the route project it. Leave `defaultModel()` untouched — `getConfig` depends on it.

**Test analog** — `opencode-client.test.ts:5-16` `mockFetch`, and assert the outgoing model body at `:69-86`:

```typescript
// opencode-client.test.ts:69-86
await client.sendMessage("/work/app", "ses_1", { text: "Fix auth", providerID: "openai", modelID: "gpt", agent: "build" });
const model = calls.find((call) => call.url.includes("/api/session/ses_1/model"));
assert.deepEqual(JSON.parse(String(model.init?.body)), { model: { id: "gpt", providerID: "openai" } });
```
New tests: `listModels` hits `/api/model` with `location[directory]` and unwraps `{data:[…]}`; `/model` 400 causes `sendMessage` to reject **before** `/prompt` (assert no `/prompt` call).

---

## Layer 2 — `src/server/api.ts` (controller, request-response)

**Analog:** itself — `readOpenCode` is the exact degrade-then-call-then-redact shape.

**Route registration** — the `readOpenCode` GET cluster at `:45-47` is where `/models` belongs (either add `route === "/models"` there and handle inside `readOpenCode`, or add its own `if (request.method === "GET" && route === "/models")` branch above it; prefer the dedicated branch because it needs two client calls and a projection):

```typescript
// api.ts:45-47
if (request.method === "GET" && (route === "/config" || route === "/providers" || route === "/agents" || route === "/mcp" || route === "/vcs" || route === "/files/status" || route === "/permissions")) {
  return await readOpenCode(runtime, route);
}
```

**Degrade precedent** (`:272-278`) — disconnected answers 200 with an empty shape; the models route must do `{ models: [], default: "" }`:

```typescript
// api.ts:272-279
async function readOpenCode(runtime: ControllerRuntime, route: string): Promise<ApiResult> {
  const project = activeProject(runtime);
  const directory = project?.path;
  if (!runtime.status.connected) {
    if (route === "/vcs") return json(200, { branch: null });
    if (route === "/agents") return json(200, []);
  }
  const client = runtime.requireClient();
```

**Redaction at the boundary** (`:290`, `:292-294`) — always `redactSecrets(payload, secretNeedles(runtime))`, and keep the returned value a **flat array** of projections so no provider/model id is ever an object *key* (key-based redaction would clobber `alibaba-token-plan`). `secretNeedles` is at `:412-414`.

**Projection shape** (build `key` from entry `id`, never `modelID`):

```typescript
const models = list.map((m) => ({
  key: `${m.providerID}/${m.id}`,
  id: m.id,
  providerID: m.providerID,
  name: m.name,
  status: m.status ?? "active",
  context: m.limit?.context ?? 0,
  released: m.time?.released ?? 0,
  enabled: m.enabled !== false,
  tools: m.capabilities?.tools === true,
  variantCount: Array.isArray(m.variants) ? m.variants.length : 0,
}));
```

Directory comes **only** from `activeProject(runtime)` (`:383-385`) — never a browser query param (security). If the route needs a project, `requireProject(runtime)` (`:387-393`) is the precedent; a projectless read should pass `undefined` like `getProviders` does.

**Route-level test analog** — the fake-runtime harness (`api.test.ts:11-85`) and the identifier round-trip test (`:133-146`):

```typescript
// api.test.ts:133-146
test("identifier payloads survive the providers route byte-identical", async () => {
  const { runtime } = runtimeWithProject();
  runtime.state.connectionPassword = "token";
  const result = await call(runtime, "GET", "/api/providers");
  const body = result.body as { providers: { all: { id: string }[]; connected: string[] } };
  assert.equal(body.providers.all[0].id, "alibaba-token-plan");
});
```

New tests must add `listModels`/`getDefaultModel` to the `runtime.client` object in `runtimeWithProject()` (`:30-83`) — it is cast `as unknown as ControllerRuntime["client"]`, so TypeScript will not force it, but a missing method throws at runtime.

---

## Layer 3a — `src/server/normalize.ts` (service, event-driven)

**Analog:** itself — `GuiEvent` union + `normalizeEvent` branch chain + `summarizeSession`.

**Union to extend** (`:55-66`) — one additive variant, mirrored in `client.ts`:

```typescript
// normalize.ts:55-66
export type GuiEvent =
  | { type: "message"; sessionId: string; message: ChatMessage }
  | { type: "text-delta"; sessionId: string; messageId: string; delta: string }
  | { type: "activity"; sessionId: string; messageId: string; item: ActivityItem }
  | { type: "permission"; prompt: PermissionPrompt }
  | { type: "permission-cleared"; id: string }
  | { type: "session"; session: SessionSummary }
  | { type: "session-deleted"; id: string }
  | { type: "status"; sessionId: string; state: "idle" | "working" | "retry" | "error"; detail?: string }
  | { type: "diff"; sessionId: string; files: DiffFile[] }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "malformed"; message: string };
```
Add: `| { type: "model-selected"; sessionId: string; model: string }`.

**Resume projection** (`:93-107`) — `SessionSummary` gains optional `model?: string`; build from `session.model` with a first-slash-safe `providerID/id`, ignoring `variant`:

```typescript
// normalize.ts:93-107
export function summarizeSession(session: OpenCodeSession): SessionSummary {
  const created = session.time?.created ?? Date.now();
  const updated = session.time?.updated ?? created;
  return {
    id: session.id,
    title: session.title?.trim() || "New chat",
    directory: session.location?.directory || session.directory || session.path,
    created,
    updated,
    archived: Boolean(session.time?.archived),
    additions: session.summary?.additions ?? 0,
    deletions: session.summary?.deletions ?? 0,
    files: session.summary?.files ?? 0,
  };
}
```
The wire field already exists: `OpenCodeSession.model?: { id?; providerID?; variant? }` (`opencode-client.ts:16`).

**Event branch** — insert a `session.model.selected` case in `normalizeEvent` before the final `return null` at `:361`. Follow the existing shape: read `data` (`:162`), use the module-local `text()` helper (`:441-443`), return `null` when identifiers are missing:

```typescript
// normalize.ts:157-163 (entry pattern)
export function normalizeEvent(raw: unknown): GuiEvent | null {
  const event = unwrap(raw);
  if (!event) return { type: "malformed", message: "Event was not an object" };
  const type = String(event.type ?? "");
  ...
  const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const sessionId = text(data.sessionID);
```
```typescript
// normalize.ts:441-443
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
```
`sessionId` is already extracted at `:163`, so the branch is `if (type === "session.model.selected") { … }` using `data.model` (`{id, providerID, variant?}`), returning `{ type: "model-selected", sessionId, model: `${providerID}/${id}` }` and `null` if any piece is absent. `previous` is ignored.

**Test analog** — `normalize.test.ts:102-167` feeds literal wire frames and asserts the discriminated result; `:62-73` already asserts `model-switched` bookkeeping stays filtered by `toChatMessages` (`normalize.ts:133-140`) — keep that behavior (no transcript line).

---

## Layer 3b — `src/lib/desk/client.ts` (browser API + mirrored types)

**Analog:** itself — types are duplicated by design; `request()` is the only fetch.

**Base request + error shape** (`:96-108`):

```typescript
// client.ts:96-108
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
```

**API method placement** (`:146` `providers`, `:166-170` reads/settings) — add `models: () => request<{ models: DeskModel[]; default: string }>("/api/models"),` beside `providers`; reuse `settings` (`:168`) for the persistence write — **body key is `deskModel`**, confirmed at HEAD (`api.ts:169`, `settings.tsx:313`); the RESEARCH `{ model: key }` sketch is stale.

**Mirrored types to extend:**
- `SessionSummary` (`:42-52`) gains `model?: string`.
- `DeskEvent` (`:82-94`) gains `| { type: "model-selected"; sessionId: string; model: string }`.
- New `DeskModel` (`{ key, id, providerID, name, status, context, released, enabled, tools, variantCount }`) mirrors the server projection exactly.
- `RuntimeModel` (`:16-22`) stays untouched (Settings only) — do not copy its stale `capabilities`.

---

## Layer 4a — `src/components/desk/models.ts` (new, pure utility)

**Analog:** `src/components/desk/messages.ts` (pure `.ts`, named exports, imports types from the client module) + the Settings substring filter.

**Module pattern** (`messages.ts:1-25`) — plain functions, no React, import types from `@/lib/desk/client`:

```typescript
// messages.ts:1-25
import type { ActivityItem, ChatMessage, SessionSummary } from "@/lib/desk/client";

export function appendDelta(list: ChatMessage[], messageId: string, delta: string): ChatMessage[] { ... }

export function upsertSession(list: SessionSummary[], session: SessionSummary): SessionSummary[] {
  return [...list.filter((item) => item.id !== session.id), session].sort((a, b) => b.updated - a.updated);
}
```

**Filter precedent** — exact substring-over-fields rule to copy (`settings.tsx:265-268`):

```typescript
// settings.tsx:265-268
const filteredModels = models.filter((item) => {
  const filter = modelQuery.trim().toLowerCase();
  return !filter || `${item.name} ${item.id}`.toLowerCase().includes(filter);
});
```

Functions to export (all DOM-free, all `node:test`-coverable):
- `parseModelKey(key)` / `modelKey(entry)` — **first-slash** split (`index <= 0 || index === key.length - 1 → null`), matching `splitModel` semantics (`api.ts:406-410`) so `poolside/poolside/laguna-s-2.1` survives.
- `filterModels(models, query)` — substring over `name + id + providerID`.
- `groupModelsByProvider(models)` — group by raw `providerID`, groups sorted by humanized label, entries sorted by `name`; return `{ providerID, label, models }`.
- `humanizeProviderID(id)` — explicit brand map for the 10 live providers with title-case fallback (reuse the word-splitting logic from `normalize.ts:458-461` `humanize`, which is module-private today, so re-implement it locally).
- `resolveActiveModel(persistedKey, models, defaultKey)` — membership check returning `{ key, isStale }` so the UI can show the stale note without writing state.
- `seedFromSessionModel(sessionModel)` — `providerID/id` from `Session.Info.model`, ignoring `variant` (including the server-inserted `"default"`).
- `modelSlug(key)` — `[^A-Za-z0-9_-] → "_"` for DOM ids (model ids contain `/`).

---

## Layer 4b — `src/components/desk/models.test.ts` (new, test)

**Analog:** `messages.test.ts:1-73` — `node:test` + `node:assert/strict`, a local factory helper, no framework.

```typescript
// messages.test.ts:1-14
import test from "node:test";
import assert from "node:assert/strict";
import { appendDelta, hasPendingBubble, mergeMessage, upsertActivity } from "./messages.ts";

function msg(overrides: Partial<{ id: string; role: ... }>) { ... }
```
`package.json` is LOCKED and must NOT be edited this phase. Invoke the new suite explicitly in every relevant verify step: `node --experimental-strip-types --test src/components/desk/models.test.ts` alongside `npm test`.

Required fixtures: two entries sharing a `modelID` (`gpt-6.2-astra` / `-fast`) must stay distinct keys; `poolside/poolside/laguna-s-2.1` parses to provider `poolside`; stale persisted key resolves to the default with `isStale: true`; filtering matches providerID and name; grouping is alphabetical with per-group counts.

---

## Layer 4c — `src/components/desk/model-picker.tsx` (new, APG combobox)

**Analog:** `settings.tsx` `Providers` (model list + filter + loading/error/empty branches) and `PermissionCard` (local interactive state). There is **no combobox, popover, or keyboard-navigable list in the repo** — this is the one genuinely new UI shape.

**List + state branches to mirror** (`settings.tsx:165-226, 362-386`):

```typescript
// settings.tsx:165-198 (component state + load + filter)
const [providers, setProviders] = useState<RuntimeProvider[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
async function load() {
  setError(null);
  try { ... } catch (err) {
    setError(err instanceof Error ? err.message : "Could not load provider configuration.");
  } finally { setLoading(false); }
}
useEffect(() => { void load(); }, []);
const needle = query.trim().toLowerCase();
```
```typescript
// settings.tsx:367-386 (list + empty branch — note the select() is NOT the pattern to copy)
{models.length ? ( <> ... <select ...> ... </select> </> ) : <p className="text-xs text-subtle">OpenCode reports no models for this provider.</p>}
```
Copy the **loading / error / empty conditional rendering and `load()` retry shape**, not the `<select>`.

**Primitives to reuse verbatim:**
- `Button` (`ui/button.tsx:6-27`) — `variant="ghost" size="sm"` for the trigger, `variant="outline" size="sm"` for Retry/Clear filter. Note the base already includes `focus-visible:ring-2 focus-visible:ring-accent/40`.
- `Badge` (`ui/badge.tsx:20-26`) — `variant="default"` for Default/Deprecated, `variant="warn"` for Alpha/Beta.
- `HelixMark` (`helix-mark.tsx:3-20`) — `<HelixMark spinning className="size-6" />` for the loading panel; do not build a spinner.
- `Input` — **do not** use for the in-popup filter (spec §Component Inventory); the filter is a bare borderless `<input>`.
- `formatTokens` (`lib/utils.ts:35-42`) and `cn` (`:4-6`) for the metadata line.

**Local-state interaction precedent** (`app.tsx:730-758, 782-800`) — `pending`/`asking` guarded async handlers, `requestAnimationFrame(() => inputRef.current?.focus())`:

```typescript
// app.tsx:744-758
async function handle(decision: "once" | "always" | "reject", message?: string) {
  setPending(true);
  try { await onReply(decision, message); } catch { toast.error("Could not reply. Try again."); setPending(false); }
}
function submitAnswer() { const trimmed = answer.trim(); if (!trimmed) return; void handle("once", trimmed); }
```

**Props contract** (keep the component presentational — all grouping/filtering/keyboard-index math lives in `models.ts`):
`{ models, defaultKey, effectiveKey, status, open, onOpenChange, onSelect(key), onRetry, loadError, loading, staleNote }`. The picker reads no API directly except through `api.models()` passed in or called from `app.tsx`; prefer the latter so the 30s cache and error state live in one place.

**Placement** — first child of the header's right cluster (`app.tsx:444`), i.e. `[trigger] · [Live] · [Retry/Rename/Archive]`:

```tsx
// app.tsx:444-459 (insert trigger as the first child of this div)
<div className="flex items-center gap-2">
  <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
    <span className={cn("size-1.5 rounded-full", status?.connected ? "bg-ok pulse-live" : "bg-subtle")} />
    {status?.connected ? "Live" : "Offline"}
  </span>
  {active && !settingsOpen && ( ... )}
</div>
```
Rendered when `project` exists (not gated on `active`, not on `settingsOpen`). No portal; inline `absolute right-0 top-full mt-2 z-50`.

---

## Layer 5 — `src/components/desk/app.tsx` (component, event-driven)

**Analog:** itself — five concrete insertion points.

1. **State + select handler** — existing `model` state (`:45`) and Settings sharing (`:467`, `:473`):

```typescript
// app.tsx:45
const [model, setModel] = useState("");
```
```tsx
// app.tsx:462-476 (picker and Settings stay in sync for free)
<SettingsPanel
  ...
  model={model}
  ...
  onModelChange={setModel}
```
Add `chooseModel(key)` mirroring `settings.tsx:302-320`: `setModel(key)` first (optimistic), then `void api.settings({ deskModel: key }).catch(() => setModelNote("…"))` — the `catch` must set the inline persistence-failure note, never the global `error` bar (spec §8.10).

2. **Bootstrap seed** — `:125` already seeds it; no change beyond keeping the 30s catalog logic out of bootstrap.

3. **Project switch** — `:195-200` currently **overwrites** the desk default; remove the config re-read so the persisted default survives:

```typescript
// app.tsx:195-200 (delete the config half)
const [data, config] = await Promise.all([
  api.sessions(),
  api.config().catch(() => ({} as Record<string, unknown>)),
]);
setSessions(data.sessions);
if (typeof config.model === "string") setModel(config.model);
```
Resolves to `const data = await api.sessions(); setSessions(data.sessions);`.

4. **Resume seed** — `openSession` (`:218-238`) after `setSessions(...)`:

```typescript
// app.tsx:224-233
const data = await api.openSession(id);
setMessages(data.messages);
setFiles(data.files);
setSessions((current) => upsertSession(current, data.session));
```
Add `if (data.session.model) setModel(data.session.model);` (before or after `setSessions`, same block).

5. **SSE reconciliation** — `applyEvent` (`:58-113`). Handle `model-selected` **before** the generic session gate at `:102`, with its own active-session check:

```typescript
// app.tsx:98-102 (the gate the new branch must precede)
if (event.type === "diff") {
  if (!sessionRef.current || sessionRef.current === event.sessionId) setFiles(event.files);
  return;
}
if (!sessionRef.current || ("sessionId" in event && event.sessionId !== sessionRef.current)) return;
```
```typescript
// app.tsx:51-54 (ref mirroring — use it for the explicit check)
const sessionRef = useRef<string | null>(null);
sessionRef.current = sessionId;
```
Branch: `if (event.type === "model-selected") { if (event.sessionId === sessionRef.current) setModel(event.model); return; }` — payload is authoritative; no flash/toast/focus change.

6. **Send path unchanged** — `:307` already passes `model`, and `:308-313` is the abort/restore-on-failure behavior; `sendMessage` throws before `/prompt` (`opencode-client.ts:195-203`). No edit.

7. **Persistence-failure note slot** — above the composer hint (`:613-615`):

```tsx
// app.tsx:613-615
<p className="mx-auto mt-2 max-w-2xl px-2 text-[11px] text-subtle">
  Enter to send · Shift+Enter for a line · work stays in {project?.name ?? "the selected project"}
</p>
```
Insert `{modelNote && <p className="mx-auto mt-2 max-w-2xl px-2 text-[11px] text-warn">{modelNote}</p>}` immediately above it.

---

## Shared Patterns

### Redaction at the controller boundary
**Source:** `src/server/security.ts:156-187`
**Apply to:** the `/api/models` route response only (the projection is already flat; redaction is belt-and-braces).

```typescript
// security.ts:156-187 (exact-match needles — Phase 7 landed)
const SECRET_KEY = /(^key$|api[_-]?key|token|password|secret|authorization|credential|private[_-]?key)/i;
export function redactSecrets<T>(value: T, extra: readonly string[] = []): T {
  const needles = extra.filter((item) => item && item.length >= 4);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return needles.some((needle) => node === needle) ? "[redacted]" : node;
    }
    ...
    if (SECRET_KEY.test(key)) { out[key] = child ? "[redacted]" : child; continue; }
```
Never return an object keyed by provider/model id (`alibaba-token-plan` matches `token`).

### Error handling (throw `OpenCodeError`, map once)
**Source:** `src/server/api.ts:416-422` + `src/server/opencode-client.ts:106-115`
**Apply to:** new route handlers and any client method validation.

```typescript
// api.ts:416-426
function errorResult(err: unknown): ApiResult {
  if (err instanceof OpenCodeError) {
    const status = err.status === 0 ? 503 : err.status || 500;
    return json(status, { error: err.message, retryable: err.retryable });
  }
  return json(500, { error: err instanceof Error ? err.message : "Controller error" });
}
function json(status: number, body: unknown): ApiResult { return { status, body }; }
```
New route code may `throw new OpenCodeError(...)`; `handleApi`'s single `try/catch` (`:27-58`) does the rest. Validation helpers return unions, not throws (`readBody` `:395-404` converts to 400).

### Route body validation
**Source:** `src/server/api.ts:395-404`
**Apply to:** any POST/PATCH added (this phase adds none — persistence reuses `updateSettings`).

```typescript
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const parsed = safeJson(text);
  if (!parsed.ok) throw new OpenCodeError(400, parsed.error);
  ...
}
```

### SSE contract mirroring (server → browser → reducer)
**Source:** `normalize.ts:55-66` → `client.ts:82-94` → `app.tsx:58-113`
**Apply to:** the one new `model-selected` variant. Fan-out needs no change (`runtime.ts:294-303` emits every normalized event to all subscribers; `api.ts:368-381` streams to every tab).

### Test harness seams
**Source:** `api.test.ts:11-95` (fake `runtime.client`) and `opencode-client.test.ts:5-16` (`mockFetch`)
**Apply to:** all three extended server test files. No new dependency, no jsdom/RTL — UI logic must stay in `models.ts`.

### Semantic tokens + primitives
**Source:** `src/styles.css` `@theme`; `ui/button.tsx`, `ui/badge.tsx`, `helix-mark.tsx`
**Apply to:** every new component. Use `bg-bg`/`bg-elevated`/`bg-surface`/`text-fg`/`text-muted`/`border-border`/`text-accent`/`text-warn`/`text-danger`; `--shadow-border-hover` exists (`styles.css:25`). `text-subtle` is banned for picker text (contrast). `formatTokens` for context size.

---

## No Analog Found

| File | Role | Data Flow | Reason / fallback |
|---|---|---|---|
| `src/components/desk/model-picker.tsx` (combobox part only) | component | request-response + local state | No popover/combobox/listbox exists in the repo. Use `08-UI-SPEC.md` §8.1–8.12 (markup, ARIA, keyboard map, state panels) plus the `settings.tsx` loading/error branch and `Button`/`Badge`/`HelixMark` primitives. Keep all nav/filter math in `models.ts`. |
| `humanizeProviderID` brand map | utility | transform | No provider-name source in the repo (`Model.Info` has no provider name). Use the UI-SPEC's explicit map + title-case fallback; mirror `normalize.ts:458-461` word-splitting. |

---

## Metadata

**Analog search scope:** `src/server/`, `src/lib/desk/`, `src/components/desk/`, `src/components/ui/`, `src/styles.css`, `package.json`
**Files scanned:** 20 (10 analogs + 10 integration points/tests)
**Pattern extraction date:** 2026-11-22
**HEAD at extraction:** `da15092`
**Corrections vs `.planning/phases/08-chat-model-picker/08-RESEARCH.md` (re-verified at HEAD):**
- Persistence write key is `deskModel`, not `model` (`api.ts:169`, `settings.tsx:313`) — RESEARCH `A6` resolved.
- `chooseProject` still clobbers the desk model (`app.tsx:195-200`) — removal remains required (Pitfall 10).
- `getProviders` keys by `modelID` (`opencode-client.ts:295-297`) and `defaultModel()` prefers `modelID` (`:527`) — both collapse/mis-key speed tiers; the new path must use entry `id`.
