# Phase 8: Chat Model Picker - Research

**Researched:** 2026-11-21
**Domain:** OpenCode v2.3.2 model HTTP/SSE contract (live-captured) + Paddy four-layer picker integration
**Confidence:** HIGH — every wire contract below was captured live from a throwaway local `opencode serve` v2.3.2 this session; every repo integration point was read at HEAD with line numbers.

## User Constraints

No Phase 8 CONTEXT.md exists yet (discuss-phase has not run). The binding constraints below come from AGENTS.md/PROJECT.md, REQUIREMENTS.md, and the upstream Phase 7 locked decisions. Treat them as locked.

### Project constraints (from AGENTS.md / PROJECT.md)

- **Tech stack**: Node 22+, TypeScript, TanStack Start — one process; no separate backend service or database.
- **Test runner**: `node:test` only — adding Jest/Vitest is a stack change outside this milestone.
- **Security**: the controller is the only component with shell/filesystem access; the browser stays sandboxed from both. Browser code must not import `src/server/*` (`node:*`).
- **Authority**: OpenCode remains the source of truth for sessions, messages, models, and file changes.
- **Compatibility**: existing installs keep state at `~/.config/opencode-web`; reuse when present.
- **Zero new dependencies** — milestone research plan of record (`.planning/research/SUMMARY.md`: "Headline: zero new packages — runtime or dev"). No component-render tooling (no jsdom/RTL); UI logic lives in pure `.ts` modules.

### Locked upstream decisions (Phase 7 CONTEXT.md — this phase DEPENDS on them)

Verbatim from `.planning/phases/07-v2-hardening-foundation/07-CONTEXT.md:28-38`:

> ### deskModel Persistence (V2-02)
> - `AppState.deskModel: string` — full `provider/model` id, `""` = unset; matches the existing `model` string state in `app.tsx`/`settings.tsx`. Update `EMPTY_STATE`, `normalizeState`, `publicState`.
> - Old state files upgrade silently in `normalizeState` (missing/invalid → `""`), same pattern as every other field — no migration script, no version bump.
> - API surface: extend existing `updateSettings` + `bootstrap`/`publicState` with `deskModel` — no new route.
> - Accept any string; the controller does not validate against the model list. OpenCode is authoritative; Phase 8 reconciles on send/resume.
>
> ### Redaction Hardening (V2-03)
> - Exact whole-string needle matching: a string node is replaced only when it equals a needle; key-based `SECRET_KEY` field redaction stays unchanged. This eliminates identifier corruption (e.g. provider id `alibaba-token-plan` becoming `alibaba-[redacted]-plan`).
> - Regression proof: an exact-match round-trip test where a registered needle is a substring of `alibaba-token-plan` and the payload must survive byte-identical; the test fails if substring replacement is reintroduced.
> - Tests land in both `security.test.ts` (unit) and `api.test.ts` (route-level round-trip) — fixtures before any new model/command routes in Phases 8–9.

### Deferred / out of scope (REQUIREMENTS.md, verbatim)

- REQUIREMENTS.md:49: "**MODEL-04**: Model variant selection (reasoning-effort etc.) if v2 represents variants as distinct entries or `Model.Ref.variant`" — **v2 milestone, deferred**. This research records the variant representation (below) but Phase 8 builds NO variant UI and sends NO variant.
- REQUIREMENTS.md:61: "`cmdk`/Radix/fuse.js component or search libraries | Stack change; hand-built comboboxes fit the constraints"
- REQUIREMENTS.md:63: "Persisting the model into OpenCode global config | v2 has no remote global-config write (`PATCH /api/config` → 404)"
- REQUIREMENTS.md:58: "Multi-desk model profiles | One desk default applied per-session is sufficient for v1.1"
- 07-CONTEXT.md:81: "Model picker UI, `session.model.selected` reconciliation, session-resume seeding — Phase 8." (confirms these are THIS phase's job)

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md:12-14, verbatim) | Research Support |
|----|-------------|------------------|
| MODEL-01 | "User can pick a model from the chat header/composer (not only Settings) via a popup grouped by provider, with live filtering, full keyboard control, and the always-visible active model" | `GET /api/model` live-captured: flat `Model.Info[]` with `providerID` (grouping), `name`/`id` (filtering), `status`/`limit.context`/`time.released` (metadata). Header slot at `app.tsx:437-460`; existing `model` state at `app.tsx:45`. Hand-built APG combobox, pure `models.ts` helpers. |
| MODEL-02 | "The chosen desk default persists in Paddy state across browser reloads, seeds session resume, and the header reconciles against OpenCode's `session.model.selected` events so it never drifts from what actually runs" | Persistence target = Phase 7 `deskModel` (not yet in `state.ts` — dependency gate). Resume seed = `Session.Info.model` (`Model.Ref`, live-captured; `variant` normalizes to `"default"`). Reconciliation = `session.model.selected` SSE (live-captured payload). Send path already POSTs the model (`opencode-client.ts:189-204`). **Critical: POST /model does NOT validate the ref — see Pitfall 2.** |
| MODEL-03 | "The picker surfaces model metadata OpenCode already provides (status, context window, release date) so the user can choose informed" | Exact fields live-verified: `status` enum `"alpha"\|"beta"\|"deprecated"\|"active"`; `limit.context` (integer, required); `time.released` (epoch-ms number, required). All 272 live entries are `status:"active"`, `enabled:true`. |
</phase_requirements>

## Summary

The server half of the model picker already exists: `sendMessage` POSTs `/api/session/{id}/model` before every prompted send, `app.tsx` holds a `model` string state, and `api.ts send()` splits `"providerID/modelID"` into the wire ref. Phase 8 is therefore (a) one new light data path through the four-layer pattern (`listModels()` → `GET /api/models` → `api.models()` → picker UI), (b) a hand-built keyboard-first combobox in the chat header, (c) resume seeding + SSE reconciliation, all riding on Phase 7's `deskModel` persistence and exact-match redaction.

This session captured the complete model contract from a **throwaway local OpenCode v2.3.2** (spawned with a self-generated password on an ephemeral port, probed, and killed; the live :4096 server requires auth and was not touched). Three findings change the plan of record from earlier milestone research:

1. **`id` ≠ `modelID` for 23 of 272 catalog entries.** Speed-tier entries (`gpt-6.2-astra-fast`, `-flex`, `-ultrafast`) share a `modelID` but have distinct `id` and `name`. The unique entry key is `providerID/id`, and `Model.Ref.id` takes the **entry `id`** (live-verified: POSTing `gpt-6.2-astra-fast` stores and echoes exactly that). The existing Settings composite (`getProviders`) keys by `modelID` and silently collapses these tiers — the picker must not reuse it (independent of the 4-request fan-out reason).
2. **`POST /api/session/{id}/model` performs NO catalog validation.** Unknown model ids and mismatched provider/id pairs both return **204** and emit `session.model.selected` (live-verified). "Failed model switch aborts the send" therefore covers HTTP failures (400 malformed body / 404 unknown session / 503 disconnected), while *invalid-model* protection must come from the picker only offering catalog entries and validating the persisted `deskModel` against the fetched list. An invalid ref that slips through fails at **prompt time**, not switch time.
3. **Raw `Model.Info` carries account-shaped identifiers** in `headers` (e.g. `x-opencode-org-id`, `chatgpt-account-id`) and open-ended `settings`/`body` objects. The controller must project a safe subset (`DeskModel`) before anything reaches the browser — never forward raw `Model.Info`.

**Primary recommendation:** Build the four-layer models data path with a projected `DeskModel` keyed by `providerID/id` (first-slash split), a pure `models.ts` helper module (group/filter/parse/reconcile) tested under `node:test`, one additive `GuiEvent`/`DeskEvent` variant for `session.model.selected`, resume seeding via an optional `SessionSummary.model`, and a header APG combobox writing the existing `model` state + Phase 7's `api.settings({model})`. Zero new packages.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Model catalog fetch (`GET /api/model`) | Controller (`opencode-client.ts`) | — | Only the controller talks to OpenCode (Basic auth, password never leaves it) |
| Catalog projection to safe `DeskModel` + redaction | Controller (`api.ts` route) | — | Security boundary: strip `headers`/`settings`/`body`, run `redactSecrets` |
| Desk default persistence (`deskModel`) | Controller (`state.ts`, Phase 7) | — | Atomic 0600 `~/.paddy/state.json`; v2 has no remote global-config write |
| Per-session model application on send | Controller (`opencode-client.sendMessage`, existing) | — | Already POSTs `/api/session/{id}/model` then `/prompt` |
| Grouping / filtering / keyboard navigation logic | Browser — pure `models.ts` module | — | DOM-free so `node:test` covers it (no RTL allowed) |
| Picker UI (combobox), header active-model display | Browser (`app.tsx` + new `model-picker.tsx`) | — | Presentation only; writes existing `model` state |
| SSE reconciliation (`session.model.selected`) | Controller (`normalize.ts` → runtime fan-out) | Browser (`applyEvent`) | Controller normalizes wire events; every tab receives via existing `/api/events` hub |
| Resume seeding (`Session.Info.model`) | Controller (`summarizeSession`) | Browser (`openSession`) | Session truth lives in OpenCode; summary carries it to the UI |

## Live-Captured v2.3.2 Model Contract

**Capture method:** live :4096 returned `401` unauthenticated for `/api/info` and `/openapi.json`, so a throwaway server was spawned: `~/.opencode/bin/opencode serve --hostname 127.0.0.1 --port <ephemeral>` with `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` env (self-generated `randomBytes(24).base64url`, in-memory only, never printed) — the exact spawn shape the controller uses (`runtime.ts:247-253`). Two runs: full capture + a focused ref-semantics probe. Both servers killed and verified gone; scratch sessions created under `/tmp/opencode/p8-scratch` and deleted via API (verified: 0 rows in `session_v2`). Artifacts: `/tmp/opencode/p8-openapi.json`, `p8-models.json`, `p8-results.json`, `p8-probe2.json`, scripts `p8-capture.mjs`, `p8-probe2.mjs`. Server reported `"version": "2.3.2"`. [VERIFIED: live v2.3.2 capture, /tmp/opencode/p8-results.json]

### GET /api/model

- Path: `GET /api/model`, optional query `location[directory]` (deepObject) and `types`. OpenAPI on `types`: *"Only list models of these types. Defaults to chat, the only type offered for sessions."* [VERIFIED: live capture, p8-openapi.json paths./api/model.get]
- Response `200`: `{ location, data: Model.Info[] }` — the standard `{data}` envelope; `request()` already unwraps it (`opencode-client.ts:591,595-600`). [VERIFIED: live capture + src/server/opencode-client.ts:595-600]
- Live list: **272 models, all `type:"chat"`, all `enabled:true`, all `status:"active"`**, across 10 providers: `google:25, opencode:85, github-copilot:36, openai:34, opencode-go:33, alibaba-token-plan:20, ollama-cloud:27, deepseek:2, xai:7, poolside:3`. [VERIFIED: live capture, p8-results.json model.providerCounts]
- **Location scoping does not filter the catalog**: `?location[directory]=/tmp/opencode/p8-scratch` returned a byte-identical 272-item list. Passing the project directory is still correct (matches `locationQuery`, and `/api/model/default` resolves per-location), but do not expect a per-project subset. [VERIFIED: live capture, p8-results.json model.scopedSameAsGlobal=true]

### Model.Info — exact schema

OpenAPI `Model.Info` (`additionalProperties: false`), required fields verbatim: `"required": ["id","modelID","providerID","name","capabilities","variants","time","cost","status","enabled","limit"]`. Optional: `canonical`, `type`, `family`, `compatibility`, `package`, `settings`, `headers`, `body`. [VERIFIED: live capture, p8-openapi.json components.schemas["Model.Info"]]

Key property schemas (verbatim excerpts):

```json
"status": { "type": "string", "enum": ["alpha", "beta", "deprecated", "active"] }
"time": { "type": "object", "properties": { "released": { "type": "number" } }, "required": ["released"], "additionalProperties": false }
"limit": { "properties": { "context": {"type":"integer"}, "input": {"type":"integer"}, "output": {"type":"integer"} }, "required": ["context", "output"], "additionalProperties": false }
"capabilities": { "properties": { "tools": {"type":"boolean"}, "freeform": {"type":"array"}, "input": {"type":"array","items":{"type":"string"}}, "output": {"type":"array","items":{"type":"string"}}, "temperature": {"type":"boolean"} }, "required": ["tools","input","output"], "additionalProperties": false }
"variants": { "type": "array", "items": { "$ref": "#/components/schemas/Model.Variant" } }
```
[VERIFIED: live capture, p8-openapi.json]

**Real sample item** (google/gemini-4-neon; `headers`/`settings` omitted here — see Pitfall 4; full item in `/tmp/opencode/p8-models.json`):

```json
{
  "id": "gemini-4-neon", "modelID": "gemini-4-neon", "providerID": "google",
  "type": "chat", "family": "gemini", "name": "Gemini 4 Neon",
  "package": "@opencode/ai/providers/google",
  "capabilities": { "tools": true, "input": ["text","image","video","audio","pdf"], "output": ["text"], "temperature": true },
  "variants": [ { "id": "low", "settings": { "thinkingConfig": { "includeThoughts": true, "thinkingLevel": "low" } } },
                { "id": "medium", "settings": { "thinkingConfig": { "includeThoughts": true, "thinkingLevel": "medium" } } },
                { "id": "high", "settings": { "thinkingConfig": { "includeThoughts": true, "thinkingLevel": "high" } } },
                { "id": "xhigh", "settings": { "thinkingConfig": { "includeThoughts": true, "thinkingLevel": "xhigh" } } } ],
  "time": { "released": 1794960000000 },
  "cost": [ { "input": 3, "output": 15, "cache": { "read": 0.15, "write": 0 } } ],
  "status": "active", "enabled": true,
  "limit": { "context": 1048576, "output": 65536 }
}
```
[VERIFIED: live capture, p8-results.json model.samples[0]]

Metadata mapping for MODEL-03: **status** = `status` (enum above); **context window** = `limit.context` (tokens; `limit.input` optional, present e.g. on `openai/gpt-6.2-astra` with `{"context":628000,"input":500000,"output":128000}`); **release date** = `time.released` (epoch **milliseconds**, e.g. `1794960000000`). `cost` is USD-per-million-tokens tiers (optional display; not required by MODEL-03). [VERIFIED: live capture, p8-results.json + p8-openapi.json Model.Cost]

### CRITICAL: `id` is the entry key, `modelID` is the wire model

23 entries have `id !== modelID`. Example — `openai/gpt-6.2-astra` appears **3 times**, distinguished only by `id`/`name`:

```json
{ "id": "gpt-6.2-astra",           "modelID": "gpt-6.2-astra", "providerID": "openai", "name": "GPT-6.2 Astra" }
{ "id": "gpt-6.2-astra-fast",      "modelID": "gpt-6.2-astra", "providerID": "openai", "name": "GPT-6.2 Astra Fast" }
{ "id": "gpt-6.2-astra-ultrafast", "modelID": "gpt-6.2-astra", "providerID": "openai", "name": "GPT-6.2 Astra Ultrafast" }
```
[VERIFIED: live capture, p8-probe2.json divergent + p8-results.json model.duplicateKeys]

Live probe of `Model.Ref.id` semantics (all POSTs → 204, then `GET /api/session/{id}`):

| Sent `model` | Stored `Session.Info.model` |
|---|---|
| `{id:"gpt-6.2-astra-fast", providerID:"openai"}` | `{id:"gpt-6.2-astra-fast", providerID:"openai", variant:"default"}` |
| `{id:"gpt-6.2-astra", providerID:"openai"}` | `{id:"gpt-6.2-astra", providerID:"openai", variant:"default"}` |

[VERIFIED: live capture, p8-probe2.json probes[0..1]]

**Consequences:** the desk model string must be `providerID/id` (entry id). The picker's unique React key / selection key is `providerID/id`. The existing send path works unchanged because `splitModel` slices at the **first** `/` and `sendMessage` puts the remainder into `Model.Ref.id` — but only if the string carries the entry `id`, not the shared `modelID`. Also: **3 poolside entries have `/` inside `id`** (`poolside/poolside/laguna-s-2.1`, `poolside/poolside/laguna-xs-2.1`, `poolside/poolside/laguna-m.1`) — first-slash split handles them; `split("/")` or last-slash parsing would break. No `providerID` contains `/`. [VERIFIED: live capture, p8-probe2.json idsContainingSlash]

### Model.Ref + POST /api/session/{sessionID}/model

OpenAPI `Model.Ref` verbatim: `"properties": {"id":{"type":"string"},"providerID":{"$ref":"#/components/schemas/Provider.ID"},"variant":{"type":"string"}}, "required":["id","providerID"], "additionalProperties":false`. Request body: `{ "model": Model.Ref }` (required, `additionalProperties:false`). Responses: **204** (no content), 400 InvalidRequestError, 401, 404 SessionNotFoundError. [VERIFIED: live capture, p8-openapi.json]

Live behavior — **the endpoint records the ref without validating it against the catalog**:

| Probe | POST status | Stored session model |
|---|---|---|
| unknown id `{id:"no-such-model-xyz", providerID:"openai"}` | **204** | `{id:"no-such-model-xyz", providerID:"openai", variant:"default"}` |
| mismatched provider `{id:"gpt-6.2-astra-fast", providerID:"google"}` | **204** | `{id:"gpt-6.2-astra-fast", providerID:"google", variant:"default"}` |
| with variant `{id:"gpt-6.2-astra-fast", providerID:"openai", variant:"high"}` | **204** | `{id:"gpt-6.2-astra-fast", providerID:"openai", variant:"high"}` |

[VERIFIED: live capture, p8-probe2.json probes[2..4]]

Every accepted POST also appended a `model-switched` message to the session (even the invalid ones) and emitted `session.model.selected`. **Design rule:** the picker prevents invalid refs by construction (only catalog entries selectable; persisted `deskModel` checked against the fetched list at bootstrap). "Abort send on failed switch" = abort on HTTP error from the model POST (malformed body 400, unknown session 404, disconnected 503) — the existing `sendMessage` already throws before `/prompt` in that case. An invalid ref that reaches OpenCode fails later, at prompt execution (assumed failure surface: `session.execution.failed` / assistant error — not probed, see Assumptions A1).

### Session.Info.model (resume seeding)

`Session.Info` schema: `"model": {"$ref": "#/components/schemas/Model.Ref"}` — **optional** (`Session.Info` required list is `["id","projectID","cost","tokens","time","location"]`). Fresh session has no `model`; after a POST it is `{id, providerID, variant}`. **When no variant was sent, the server normalizes `variant` to `"default"`** (live-verified above). Live `Session.Info` sample (scratch session):

```json
{ "id": "ses_dfff8faadffefdtWaT6Oyd9dHL", "projectID": "5a114356bd0931d3d906726d97ee99b887e3806a",
  "model": { "id": "gpt-6.2-astra-fast", "providerID": "openai", "variant": "high" },
  "cost": 0, "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
  "time": { "created": 1795296789864, "updated": 1795296797067 },
  "title": "p8-probe2", "location": { "directory": "/tmp/opencode/p8-scratch" } }
```
[VERIFIED: live capture, p8-probe2.json sessionInfoSample]

Resume rule: seed the header from `session.model.providerID + "/" + session.model.id` when present; ignore `variant` in Phase 8 (MODEL-04 deferred) — in particular do not treat `"default"` as a user-chosen variant or round-trip it into the desk string. The repo wire type already tolerates this shape: `opencode-client.ts:16` `model?: { id?: string; providerID?: string; variant?: string };` [VERIFIED: src/server/opencode-client.ts:16]

### SSE: session.model.selected (reconciliation)

Event name **`session.model.selected`** — confirmed both in the OpenAPI union and live on the wire. Schema `data` verbatim: `"properties": {"sessionID":{"$ref":"#/components/schemas/Session.ID"},"model":{"$ref":"#/components/schemas/Model.Ref"},"previous":{"$ref":"#/components/schemas/Model.Ref"}}, "required":["sessionID","model"], "additionalProperties":false`. Envelope required: `["id","created","type","durable","data"]`. [VERIFIED: live capture, p8-openapi.json schemas["session.model.selected"]]

Live frames (first selection has no `previous`; later ones do; `model.id` is the entry id; `variant` absent when unset, `"default"` inside `previous`):

```json
{ "id": "evt_200047acf001zQTFfLl3cuDKmx", "created": 1795296623311, "type": "session.model.selected",
  "data": { "sessionID": "ses_dfffb885affeWv9Fdls30cnM9y", "model": { "id": "gemini-4-neon", "providerID": "google" } },
  "durable": { "aggregateID": "ses_dfffb885affeWv9Fdls30cnM9y", "seq": 1, "version": 1 } }
{ "id": "evt_200048e6a001JyHxTxv1HeDZUb", "created": 1795296628330, "type": "session.model.selected",
  "data": { "sessionID": "ses_dfffb885affeWv9Fdls30cnM9y",
            "model": { "id": "gemini-4-neon", "providerID": "opencode" },
            "previous": { "id": "gemini-4-neon", "providerID": "google", "variant": "high" } },
  "durable": { "aggregateID": "ses_dfffb885affeWv9Fdls30cnM9y", "seq": 3, "version": 1 } }
```
[VERIFIED: live capture, p8-results.json events.forSession]

Related wire facts:
- **`model-switched` message**: `Session.Message.ModelSelected` schema — `"type": {"enum":["model-switched"]}`, required `["id","time","type","model"]`, plus optional `previous: Model.Ref`. Live message list after 5 POSTs contained exactly 5 `model-switched` messages. `toChatMessages` currently filters these out (only user/assistant pass — `normalize.ts:133-140`), so they are invisible today; mapping to a system message is optional polish. [VERIFIED: live capture, p8-openapi.json + p8-probe2.json modelSwitchedMessages; VERIFIED: src/server/normalize.ts:133-140]
- **Invalidation events exist**: `model.updated` and `models-dev.refreshed` are in the event union; their `data` is arbitrary non-null (`"not":{"type":"null"}`) — no useful payload, treat as "refetch the catalog" signals. Neither fired during the capture window; firing conditions unverified (A3). [VERIFIED: live capture, p8-openapi.json schemas; ASSUMED for firing conditions]
- Event types actually observed on the stream: `command.updated`, `mcp.resources.changed`, `mcp.status.changed`, `server.connected`, `session.model.selected`. [VERIFIED: live capture, p8-results.json events.typesSeen]

### Variants (record-only — MODEL-04 deferred)

Reasoning-effort variants are a **nested `variants: [{id, settings}]` array on Model.Info, NOT distinct list entries** (the distinct-entry lookalikes are speed tiers keyed by `id`, above). Variant ids seen: `low/medium/high/xhigh` (google, github-copilot), `minimal/low/medium/high/xhigh/max` (opencode), `low/medium/high/xhigh/max` (openai). `Model.Ref.variant` is accepted by the POST (live: `variant:"high"` → stored and echoed). `Model.Variant` schema: required `["id"]`, optional `settings`/`headers`/`body`. **Phase 8 sends no variant and renders no variant UI**; the picker may show a subtle "reasoning" affordance count at most — recommended: nothing, keep deferred. [VERIFIED: live capture, p8-results.json + p8-probe2.json]

### GET /api/model/default

Response schema: `{ location, data: Model.Info | null }` (`"anyOf":[{"$ref":"#/components/schemas/Model.Info"},{"type":"null"}]`). Live call returned `google/gemini-4-neon` as `data` (full Model.Info). The repo already consumes this via private `defaultModel()` (`opencode-client.ts:537-543`) which formats `"${providerID}/${modelID ?? id}"` — **note it prefers `modelID`**; for a default whose entry has `id !== modelID` this would produce the wrong key. Phase 8's exposed default should prefer `id` (or reuse the projection used for the list). [VERIFIED: live capture, p8-openapi.json + p8-results.json model.default; VERIFIED: src/server/opencode-client.ts:537-543]

## Standard Stack

**Zero new packages.** Everything below is already installed and load-bearing.

### Core (all existing)
| Library | Version (package.json) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react / react-dom | ^19.2.0 | Picker component (controlled combobox) | Repo UI framework; plain state, no headless lib needed |
| typescript | ^5.7.0 (strict) | All new code | Project constraint |
| node:test + node:assert/strict | built-in (Node 22+) | All new tests | AGENTS.md mandates; no Jest/Vitest |
| tailwindcss | ^4.3.0 | Picker styling via semantic tokens (`bg-elevated`, `text-fg`, `text-muted`, `border-border`, `text-accent`) | CONVENTIONS: semantic tokens, not raw palette |
| lucide-react | ^0.510.0 | Chevron/check icons | Already used throughout desk |
| zod | (installed, used only by preview bridge) | NOT needed here | Boundary validation stays result-union style per repo convention |

[VERIFIED: package.json:26-66 read this session]

### Alternatives Considered (all rejected — locked by constraints)
| Instead of | Could Use | Tradeoff / why rejected |
|------------|-----------|----------|
| Hand-built APG combobox | cmdk / radix-select / headlessui | REQUIREMENTS.md:61 explicitly out of scope (stack change) |
| Substring filter | fuse.js fuzzy search | Out of scope; 272 items filter fine with `includes` (Settings precedent settings.tsx:265-268) |
| New models route | Reuse `getProviders()` | 4-request fan-out + Settings-shaped composite + **collapses id≠modelID tiers** (keys by modelID, opencode-client.ts:305-311) |
| Per-session model in Paddy state | Persist per-session picks | Violates OpenCode authority; desk default only (REQUIREMENTS.md:58) |

**Installation:** none. **Package Legitimacy Audit:** not triggered — this phase installs no external packages (gate applies only to phases that install).

## Repo Integration Points (read at HEAD this session)

### Layer 1 — `src/server/opencode-client.ts` (the only OpenCode adapter)

**Existing per-session model POST on send** (the server half of MODEL-02 is DONE), verbatim lines 189-204:

```typescript
async sendMessage(
  _directory: string,
  sessionId: string,
  input: { text: string; providerID?: string; modelID?: string; agent?: string },
): Promise<void> {
  const id = encodeURIComponent(sessionId);
  if (input.providerID && input.modelID) {
    await this.request("POST", `/api/session/${id}/model`, {
      body: { model: { id: input.modelID, providerID: input.providerID } },
    });
  }
  if (input.agent) {
    await this.request("POST", `/api/session/${id}/agent`, { body: { agent: input.agent } });
  }
  await this.request("POST", `/api/session/${id}/prompt`, { body: { text: input.text } });
}
```
[VERIFIED: src/server/opencode-client.ts:189-204] — the parameter is *named* `modelID` but lands in `Model.Ref.id`; it works correctly iff the desk string carries the **entry id**. A model-POST HTTP failure throws `OpenCodeError` before `/prompt` → send aborts (success criterion 3, HTTP-failure half).

**Where `listModels()` lands:** next to `getProviders` (line 284). Reuse `locationQuery` (lines 606-608, verbatim: `return directory ? { "location[directory]": directory } : {};`) and `request()`'s automatic `{data}` unwrap (line 591: `return init?.unwrap === false ? data : unwrapData(data);`). [VERIFIED: src/server/opencode-client.ts:591,606-608]

**Do NOT reuse `getProviders()`** — verbatim lines 286-291 show the 4-request fan-out:

```typescript
const [providerList, modelList, integrations, defaultModel] = await Promise.all([
  this.request("GET", "/api/provider", { query }),
  this.request("GET", "/api/model", { query }).catch(() => []),
  this.request("GET", "/api/integration", { query }).catch(() => []),
  this.request("GET", "/api/model/default", { query }).catch(() => null),
]);
```
[VERIFIED: src/server/opencode-client.ts:286-291] — and lines 305-311 key models by `model.modelID ?? model.id`, collapsing the 23 speed-tier entries (last wins). Confirmed anti-pattern for the picker.

**Existing wire type is partially WRONG for v2.3.2** — `OpenCodeModel` lines 62-70 verbatim:

```typescript
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
[VERIFIED: src/server/opencode-client.ts:62-70] — `capabilities.{reasoning,attachment,toolcall}` **do not exist** in the live v2.3.2 schema (actual: `tools`, `input[]`, `output[]`, `temperature?`). The browser mirror `RuntimeModel` (`client.ts:16-22`) carries the same wrong shape. Phase 8's `DeskModel` must use the live-verified fields; do not copy these. (Fixing Settings' display is out of scope; note for Phase 10.)

**Private `defaultModel()`** (lines 537-543) already formats `"${providerID}/${modelID ?? id}"` — expose/rework for the picker's default badge, preferring `id` (see contract section). [VERIFIED: src/server/opencode-client.ts:537-543]

### Layer 2 — `src/server/api.ts` (route table)

- **`send()`** lines 236-249 already threads the model: `const model = typeof body.model === "string" ? body.model : ""; const [providerID, modelID] = splitModel(model);` then `sendMessage(...)`, returns `json(202, { ok: true })`. [VERIFIED: src/server/api.ts:240-248]
- **`splitModel`** lines 411-415 verbatim: `if (!model.includes("/")) return [undefined, undefined]; const index = model.indexOf("/"); return [model.slice(0, index), model.slice(index + 1)];` — **first-slash split, already poolside-safe**. Keep. [VERIFIED: src/server/api.ts:411-415]
- **New `GET /api/models` route** lands in the `readOpenCode` GET cluster (line 45 route list) or as its own branch mirroring `readOpenCode()`'s degrade-when-disconnected behavior (lines 271-274: `/vcs` → `{branch:null}`, `/agents` → `[]`). Project-scoped via `activeProject(runtime)`; `requireProject()` (lines 392-398) when a project is mandatory. Apply `redactSecrets(payload, secretNeedles(runtime))` at the boundary like every other OpenCode read (lines 286-289). [VERIFIED: src/server/api.ts:45-47,268-301,392-398]
- **`bootstrap()`** lines 69-98 currently derives `model` from `getConfig(project.path)` (lines 82-87). **Phase 7 changes this to prefer `state.deskModel`** — Phase 8 reads `boot.model` as-is. [VERIFIED: src/server/api.ts:82-87]
- **`updateSettings()`** lines 157-168 currently handles appearance/connection fields only; **Phase 7 adds the model field** (per 07-CONTEXT "extend existing updateSettings ... with deskModel — no new route"). Phase 8 writes through it; the exact body key (`model` vs `deskModel`) must be read from Phase 7's executed code at plan time — milestone ARCHITECTURE.md:44 specifies `body.model`. [VERIFIED: src/server/api.ts:157-168; VERIFIED: .planning/research/ARCHITECTURE.md:44]
- **`secretNeedles`** lines 417-419 verbatim: `return [runtime.state.connectionPassword, process.env.OPENCODE_SERVER_PASSWORD ?? ""].filter(Boolean);` [VERIFIED: src/server/api.ts:417-419]

### Layer 3 — `src/lib/desk/client.ts` (browser API + mirrored types)

- `api.send` lines 138-142 verbatim: `send: (id, text, model?, agent?) => request("/api/sessions/" + encodeURIComponent(id) + "/messages", { method: "POST", body: JSON.stringify({ text, model, agent }) })`. [VERIFIED: src/lib/desk/client.ts:138-142]
- `api.settings` line 170: `settings: (body: Record<string, unknown>) => request("/api/settings", { method: "PATCH", body: JSON.stringify(body) })` — the picker's persistence write goes through this existing method. [VERIFIED: src/lib/desk/client.ts:170]
- `Bootstrap` type lines 175-186 includes `model: string` (line 184). `SessionSummary` lines 42-52 has **no model field** — resume seeding adds an optional one (mirrored in `normalize.ts`). `DeskEvent` union lines 82-94 has **no model variant** — reconciliation adds one. [VERIFIED: src/lib/desk/client.ts:42-52,82-94,175-186]
- New `api.models()` + `DeskModel` type land here, mirroring the server projection (types are duplicated by design across the boundary — ARCHITECTURE constraint).

### Layer 4 — UI: `src/components/desk/app.tsx` (+ new files)

- Model state line 45 verbatim: `const [model, setModel] = useState("");` [VERIFIED: src/components/desk/app.tsx:45]
- Bootstrap seeds it line 125: `setModel(data.model);` [VERIFIED: src/components/desk/app.tsx:125]
- **`chooseProject()` lines 195-200 re-reads project config and overwrites the desk model**: `const [data, config] = await Promise.all([api.sessions(), api.config().catch(...)]); ... if (typeof config.model === "string") setModel(config.model);` — milestone ARCHITECTURE.md:57 says drop this re-read (desk default is global, sourced from bootstrap). Phase 8 should remove it so the persisted desk default survives project switches. [VERIFIED: src/components/desk/app.tsx:195-200; VERIFIED: .planning/research/ARCHITECTURE.md:57]
- Send path line 307 verbatim: `await api.send(id, text, model || undefined, agent || undefined);` — on failure the catch (308-313) removes the pending echo, restores the draft, sets error. **This is the existing abort-on-failure behavior the picker inherits.** [VERIFIED: src/components/desk/app.tsx:307-313]
- **Header slot** lines 437-460: title left, Live/Offline + Retry/Rename/Archive right (`active && !settingsOpen` block, 449-458). The picker trigger belongs here, always visible when a project is selected (not gated on `active` — criterion 1 says always-visible active model). [VERIFIED: src/components/desk/app.tsx:437-460]
- `openSession()` lines 218-238: receives `{session, messages, files}` — resume seeding hooks here (`setModel(data.session.model)` when present). [VERIFIED: src/components/desk/app.tsx:218-238]
- `applyEvent` lines 58-113: the reducer switch; note line 102 gates session-scoped events on `sessionRef.current` — the new model event must be handled **before** that gate or with its own session check (a model switch for the active session must update the header; other sessions' events must not). [VERIFIED: src/components/desk/app.tsx:102]
- Settings panel already shares the same state: `model={model}` / `onModelChange={setModel}` (lines 467, 473) — picker and Settings stay in sync for free. [VERIFIED: src/components/desk/app.tsx:467,473]
- **New files** (kebab-case convention): `src/components/desk/model-picker.tsx` (component) and `src/components/desk/models.ts` + `models.test.ts` (pure helpers — mirrors the `messages.ts`/`messages.test.ts` pattern). [VERIFIED: src/components/desk/ directory listing: app.tsx, messages.ts, messages.test.ts, settings.tsx]

### Event pipeline — `src/server/normalize.ts`

- `summarizeSession` lines 93-107 builds `SessionSummary` **without model** — add optional `model` from `session.model` (`providerID/id`). [VERIFIED: src/server/normalize.ts:93-107]
- `normalizeEvent` reads `event.data` (line 162) and falls through to `return null` (line 361) for unknown types — **`session.model.selected` is ignored today**. Add a branch returning the new GuiEvent variant. [VERIFIED: src/server/normalize.ts:162,361]
- `GuiEvent` union lines 55-66 — additive variant, e.g. `{ type: "model-selected"; sessionId: string; model: string }`, mirrored in `DeskEvent`. **Note:** milestone ARCHITECTURE.md:33 claimed "no GuiEvent/DeskEvent union changes" — that held for commands; MODEL-02's header reconciliation requires this one additive variant (a system-message mapping alone would not update the header). Flagged deviation, justified by criterion 3. [VERIFIED: src/server/normalize.ts:55-66; VERIFIED: .planning/research/ARCHITECTURE.md:33]
- Runtime fan-out needs **no changes**: `eventLoop` pipes every normalized event to all subscribers (`runtime.ts:296-298`), and `api.ts events()` (373-386) streams them to every tab — multi-tab reconciliation (VER-06) comes free. [VERIFIED: src/server/runtime.ts:296-298; VERIFIED: src/server/api.ts:373-386]

### Security boundary — `src/server/security.ts`

Current redaction is **substring-based** (Phase 7 changes it to exact-match), verbatim lines 156, 162-167:

```typescript
const SECRET_KEY = /(^key$|api[_-]?key|token|password|secret|authorization|credential|private[_-]?key)/i;
...
if (typeof node === "string") {
  let out = node;
  for (const needle of needles) {
    if (out.includes(needle)) out = out.split(needle).join("[redacted]");
  }
  return out;
}
```
[VERIFIED: src/server/security.ts:156,162-167]

Live-catalog interaction (verified against the captured 272-item list): **zero modelIDs match `SECRET_KEY`**, but **providerID `alibaba-token-plan` DOES match it** — safe as a *value* (post-Phase-7 exact needles), catastrophic as an *object key* (key-based redaction replaces the whole value with `"[redacted]"`). The flat `DeskModel[]` projection avoids keying by provider/model entirely. No top-level `Model.Info` field name matches `SECRET_KEY`. [VERIFIED: live capture analysis, p8-probe2 run + security.ts:156 regex applied to p8-models.json]

### Settings touchpoint — `src/components/desk/settings.tsx`

`setDeskDefault()` lines 302-317 (verbatim core): `const fullModel = \`${provider.id}/${selected}\`; ... onModelChange(fullModel); try { await api.patchConfig({ model: fullModel }); ...` — **Phase 7 migrates this to `api.settings` and deletes the patchConfig chain**; Phase 8's picker shares the same `model` state + persistence path, no Settings work required in Phase 8 beyond not regressing it. Settings' filter precedent (lines 265-268): `return !filter || \`${item.name} ${item.id}\`.toLowerCase().includes(filter);` [VERIFIED: src/components/desk/settings.tsx:265-268,302-317]

## Phase 7 Dependency Contract (gate before Phase 8 execution)

Phase 7 is **discussed but NOT executed** (only `07-CONTEXT.md` exists; `state.ts` at HEAD has no `deskModel` — verified by full read of lines 21-112). Phase 8's plan must verify these landed before building on them:

| Deliverable (Phase 7) | What Phase 8 reads/writes | Verification at plan/execute time |
|---|---|---|
| `AppState.deskModel: string` (+EMPTY_STATE/normalizeState/publicState) | Picker persists selection via `api.settings({model})`; bootstrap returns it as `boot.model` | `grep deskModel src/server/state.ts` + state.test.ts green |
| `updateSettings` accepts model; `bootstrap` prefers `state.deskModel` | Read `boot.model`; write `api.settings({model: key})` | Read executed api.ts; confirm exact body key |
| Exact-match `redactSecrets` + `alibaba-token-plan` round-trip fixtures | New `/api/models` route passes identifier-shaped payloads through redaction | security.test.ts + api.test.ts fixtures exist BEFORE the new route lands |
| Dead `updateConfig`/`patchConfig` chain deleted | Picker never calls patchConfig | grep shows no patchConfig in src/ |
| Hermetic `npm test` gate (probe seam) | Phase 8 exit criterion `npm test` green is meaningful | runtime.test.ts passes with live :4096 up AND down |

If Phase 7 slips, Phase 8's data-path + pure-helper work can still land (tests use fake clients), but the persistence wiring and UI completion block on it.

## Architecture Patterns

### System Architecture Diagram (model picker data flows)

```
                         ┌────────────────────────── Browser (sandboxed) ─────────────────────────┐
                         │  model-picker.tsx (APG combobox)                                        │
                         │    ▲ open: api.models()          │ select: setModel(key)                │
                         │    │                             ▼                                     │
                         │  app.tsx model state ── api.settings({model}) ──┐                       │
                         │    ▲ boot.model / resume seed / SSE reconcile   │                       │
                         └────┼────────────────────────────────────────────┼───────────────────────┘
                              │ /api/events (SSE fan-out, all tabs)        │ PATCH /api/settings
┌─────────────────────────────┼────────────────────────────────────────────┼──────────────────────┐
│ Controller                  │                                            ▼                      │
│  api.ts ── GET /api/models ─┼──────────────► state.deskModel ── persist() ── ~/.paddy/state.json │
│    │            ▲           │                        (Phase 7)                                 │
│    │            │ project + redactSecrets(projection)                                          │
│    ▼            │           │                                                                  │
│  opencode-client.listModels()   normalizeEvent(session.model.selected) ◄── runtime eventLoop   │
│    │            ▲           │        → GuiEvent "model-selected" ──► fan-out to all tabs       │
│    │            │           │                                                                  │
│  send path (EXISTING): api.send → splitModel(first /) → sendMessage:                           │
│    POST /api/session/{id}/model {model:{id,providerID}} ──(204 | 4xx/5xx→abort)──► POST /prompt│
└────┼────────────┼───────────────────────────────────────────────────────────────────────────────┘
     ▼            │
  opencode serve v2.3.2 ── GET /api/model {data:Model.Info[]} ──► project to DeskModel[]
     │  GET /api/model/default {data:Model.Info|null}
     └─ SSE /api/event: session.model.selected {sessionID, model, previous?}
```

Primary trace: user opens picker → `api.models()` → controller `listModels()` → OpenCode `GET /api/model` → projected+redacted `DeskModel[]` → grouped/filtered list → select → `setModel` + `api.settings` → `deskModel` persisted → next send POSTs the ref per-session → OpenCode emits `session.model.selected` → normalize → fan-out → every tab's header reconciles.

### Pattern 1: Four-layer feature wiring (layer order = build order)
`opencode-client.listModels()` (+tests, mockFetch) → `api.ts GET /api/models` (+tests, fake runtime client) → `client.ts api.models()` + mirrored `DeskModel` → `model-picker.tsx` + `models.ts` helpers (+tests). Each layer ships tested before its consumer exists. [VERIFIED: .planning/research/ARCHITECTURE.md:115-119; test seams verified in opencode-client.test.ts:5-16 and api.test.ts:11-80]

### Pattern 2: Pure logic in plain .ts modules (no RTL)
`models.ts` exports DOM-free functions: `modelKey(m) = providerID + "/" + id`, `parseModelKey(key)` (first-slash), `groupModelsByProvider(list)`, `filterModels(list, query)` (substring over name+id+providerID), `resolveActiveModel(key, list)` (membership + display name), `seedFromSessionModel(sessionModel)` (ignore variant). Co-located `models.test.ts` under `node:test`. Precedent: `messages.ts` reducers. [VERIFIED: src/components/desk/messages.ts:1-30 read this session]

### Pattern 3: Result-union validation + OpenCodeError at the boundary
New route validation copies `send()`/`readBody` shape; failures throw `OpenCodeError(400,…)`; `handleApi`'s single try/catch maps to `{error, retryable}`. [VERIFIED: src/server/api.ts:236-249,400-409,421-427]

### Pattern 4: DI seams for tests
`OpenCodeClient` takes `fetch` (ClientOptions, opencode-client.ts:117-122); `api.test.ts` fakes `runtime.client` wholesale; tests build real `ControllerRuntime` with temp state files. New `listModels` needs no new seam. [VERIFIED: src/server/opencode-client.ts:117-122; src/server/api.test.ts:11-80]

### Anti-Patterns to Avoid
- **Keying models by `modelID`** (Settings does; collapses 23 speed-tier entries) — key by entry `id`.
- **Forwarding raw `Model.Info`** to the browser (headers/settings/body carry account identifiers and open-ended provider config).
- **Trusting POST /model 204 as "valid model"** — it is not validation (live-proven).
- **Re-reading project config over the desk default** on project switch (app.tsx:200) — remove per milestone architecture.
- **Last-slash or `split("/")` model parsing** — poolside ids contain `/`.
- **Applying another session's model event to the header** — gate on `sessionRef.current`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Model catalog + grouping source | Scrape `getProviders()` composite | Dedicated `listModels()` → `GET /api/model` | Fan-out, redaction pass, and modelID-key collapse (verified) |
| Per-session model memory | Paddy-side per-session model store | OpenCode `Session.Info.model` + resume seed | Authority constraint; server already stores it |
| Desk default persistence | New route/store | Phase 7 `deskModel` via existing `PATCH /api/settings` | 07-CONTEXT locked: "no new route" |
| Secret redaction | New sanitizer | Existing `redactSecrets` (post-Phase-7 exact-match) + safe projection | Boundary already enforced everywhere |
| SSE parsing / multi-tab fan-out | Second EventSource to OpenCode | Existing runtime eventLoop + `/api/events` hub | One SSE reader per runtime; tabs already share |
| Model-key splitting | New parser in the UI | Existing `splitModel` semantics (first slash) in api.ts; pure `parseModelKey` mirror for display | poolside-safe, already tested path |
| Fuzzy search / combobox lib | fuse.js/cmdk integration | `String.includes` filter + hand-built APG combobox | Locked out of scope; 272 items is small |
| Date formatting for release dates | Custom formatter | `new Date(time.released).toLocaleDateString(...)` (repo precedent groupByDate/formatDay) | Consistent with existing UI |

**Key insight:** the only genuinely new logic is *presentation* (group/filter/keyboard) and *reconciliation* (event → header). Everything with security or authority implications already exists — reuse it.

## Common Pitfalls

### Pitfall 1: Picker key collisions from `id ≠ modelID` (NEW — live-verified)
**What goes wrong:** keying entries by `providerID/modelID` merges "GPT-6.2 Astra", "…Fast", "…Ultrafast" into one React key; selection sends the base ref while the header shows the tier name — trust property broken.
**Why it happens:** 23 catalog entries share `modelID`; `getProviders` already collapses them (opencode-client.ts:308-310).
**How to avoid:** key = `providerID/id`; `Model.Ref.id` = entry `id`; test fixture with two entries sharing `modelID`.
**Warning signs:** duplicate React keys; picker count < `data.length`; header name ≠ stored session model.
[VERIFIED: live capture p8-probe2.json; VERIFIED: src/server/opencode-client.ts:305-311]

### Pitfall 2: POST /model 204 ≠ valid model (NEW — live-verified)
**What goes wrong:** a stale/typosquatted `deskModel` (Phase 7 accepts any string) is POSTed, accepted with 204, echoed by `session.model.selected` — header "reconciles" to a model that then fails at prompt time. The user sees a confident header and a dead turn.
**Why it happens:** the endpoint records refs without catalog validation (unknown id and mismatched provider both 204, live-proven).
**How to avoid:** (a) picker offers only catalog entries; (b) at bootstrap/models-load, check persisted `deskModel` membership in the list — if absent, fall back to OpenCode default and surface a subtle note; (c) keep abort-on-HTTP-error for the POST itself; (d) prompt-time failures already surface via `session.execution.failed` → status error (normalize.ts:196-203).
**Warning signs:** header shows a key not present in `api.models()` output.
[VERIFIED: live capture p8-probe2.json probes[2..3]; VERIFIED: src/server/normalize.ts:196-203]

### Pitfall 3: Redaction corrupts identifier payloads (Phase 7 gate)
**What goes wrong:** pre-Phase-7 substring needles mangle ids; key-based `SECRET_KEY` clobbers any object *keyed* by `alibaba-token-plan` (matches `/token/i`).
**How to avoid:** Phase 7 exact-match fixtures land first; `/api/models` returns a **flat array** of projected objects (never keyed by provider/model id); add a route-level round-trip test with needle-as-substring fixture.
**Warning signs:** `"[redacted]"` appearing inside provider ids or model names.
[VERIFIED: src/server/security.ts:156,162-167; VERIFIED: 07-CONTEXT.md:34-38; live regex analysis of catalog]

### Pitfall 4: Raw Model.Info leaks account-shaped identifiers (NEW — live-verified)
**What goes wrong:** `headers` on opencode/openai entries carry `x-opencode-org-id` and `chatgpt-account-id` values; `settings`/`body` are open-ended (`additionalProperties: {}` in Model.Settings/VariantSettings) and may carry provider config. Forwarding raw items ships these to the browser.
**How to avoid:** server-side projection to `DeskModel` (key, id, modelID?, providerID, name, status, context, released, enabled, tools, variantCount) — whitelist fields, drop `headers`/`settings`/`body`/`package`/`compatibility`. Then `redactSecrets` as belt-and-braces.
**Warning signs:** any `headers`/`settings` key in `/api/models` response.
[VERIFIED: live capture p8-results.json model.variantFields[1].headers, samples; p8-openapi.json Model.Settings]

### Pitfall 5: `variant:"default"` normalization on resume (NEW — live-verified)
**What goes wrong:** resume seeding reads `Session.Info.model.variant === "default"` (server inserts it even when nothing was sent) and either displays a bogus "default" variant badge or round-trips it into the desk key, breaking exact-match lookups.
**How to avoid:** Phase 8 ignores `variant` entirely when seeding/sending (MODEL-04 deferred); desk key is strictly `providerID/id`.
[VERIFIED: live capture p8-probe2.json probes[0].sessionModel]

### Pitfall 6: Model ids containing `/` (NEW — live-verified)
**What goes wrong:** `key.split("/")` breaks `poolside/poolside/laguna-s-2.1` into 3 parts; provider lookup fails.
**How to avoid:** first-slash semantics everywhere (`indexOf("/")`), matching existing `splitModel`. Pure-helper test with the poolside fixture.
[VERIFIED: live capture p8-probe2.json idsContainingSlash; VERIFIED: src/server/api.ts:411-415]

### Pitfall 7: Copying the stale `capabilities` type
**What goes wrong:** `OpenCodeModel`/`RuntimeModel` declare `capabilities.{reasoning,attachment,toolcall}` — none exist in v2.3.2; badges built on them render nothing or lie.
**How to avoid:** `DeskModel` uses live fields (`tools:boolean`, `input[]`, `output[]`, `temperature?`); MODEL-03 only needs status/context/released anyway.
[VERIFIED: src/server/opencode-client.ts:62-70 vs live Model.Capabilities schema]

### Pitfall 8: Stale catalog after provider changes
**What goes wrong:** user adds a provider key in Settings; picker still shows the old list.
**How to avoid:** refetch-on-open with a short TTL (e.g. 30s) is the minimum; `model.updated`/`models-dev.refreshed` events exist for event-driven invalidation (optional polish — payloads carry nothing useful, just refetch). Multi-tab safe via existing fan-out if mapped.
[VERIFIED: live capture p8-openapi.json event schemas; ASSUMED: firing conditions A3]

### Pitfall 9: Reconciliation race / wrong-session application
**What goes wrong:** optimistic `setModel` on select is overwritten by a late event for a *different* session, or the event for the active session is dropped by the `sessionRef` gate ordering.
**How to avoid:** handle `model-selected` with an explicit `event.sessionId === sessionRef.current` check (before the generic gate at app.tsx:102); event payload is authoritative — apply `providerID/id` from `data.model`, ignore `previous`. External switches (OpenCode TUI) then reconcile the header for free.
[VERIFIED: src/components/desk/app.tsx:102; live event payload]

### Pitfall 10: Project switch clobbers the desk default
**What goes wrong:** `chooseProject()` re-reads `api.config()` and `setModel(config.model)` (app.tsx:200), silently replacing the persisted desk default with a project-config value.
**How to avoid:** drop that re-read (milestone ARCHITECTURE.md:57); desk default comes from bootstrap only.
[VERIFIED: src/components/desk/app.tsx:195-200]

## Code Examples

All wire values below appear verbatim in the quoted contract/repo sections above. New names (`DeskModel`, `models.ts` helpers, `model-selected` variant) are proposed design, not existing repo values.

### listModels() — opencode-client.ts (Layer 1)

```typescript
// Wire facts: GET /api/model -> {data: Model.Info[]}; locationQuery -> {"location[directory]": dir}
// request() unwraps .data automatically (opencode-client.ts:591).
async listModels(directory?: string): Promise<OpenCodeModelInfo[]> {
  const data = await this.request("GET", "/api/model", { query: locationQuery(directory) });
  return asArray<OpenCodeModelInfo>(data);
}

async getDefaultModel(directory?: string): Promise<OpenCodeModelInfo | null> {
  // GET /api/model/default -> {data: Model.Info | null}
  const data = await this.request("GET", "/api/model/default", { query: locationQuery(directory) });
  return data && typeof data === "object" ? (data as OpenCodeModelInfo) : null;
}

// Live-verified subset of Model.Info (required: id, modelID, providerID, name,
// capabilities, variants, time, cost, status, enabled, limit). Keep the wire type
// permissive; the ROUTE projects the safe subset.
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

### GET /api/models route — api.ts (Layer 2, projection + redaction)

```typescript
// Mirrors readOpenCode()'s degrade-when-disconnected (api.ts:271-274 precedent).
if (request.method === "GET" && route === "/models") {
  if (!runtime.status.connected) return json(200, { models: [], default: "" });
  const directory = activeProject(runtime)?.path;
  const client = runtime.requireClient();
  const [list, def] = await Promise.all([
    client.listModels(directory),
    client.getDefaultModel(directory).catch(() => null),
  ]);
  // Whitelist projection: NEVER forward headers/settings/body/package (Pitfall 4).
  const models = list.map((m) => ({
    key: `${m.providerID}/${m.id}`,        // entry id, NOT modelID (Pitfall 1)
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
  const defaultKey = def ? `${def.providerID}/${def.id}` : "";
  return json(200, redactSecrets({ models, default: defaultKey }, secretNeedles(runtime)));
}
```

### Reconciliation — normalize.ts branch (live event fixture)

```typescript
// Live payload: data = {sessionID, model: {id, providerID, variant?}, previous?}
if (type === "session.model.selected") {
  const model = data.model && typeof data.model === "object" ? (data.model as Record<string, unknown>) : {};
  const id = text(model.id);
  const providerID = text(model.providerID);
  if (!sessionId || !id || !providerID) return null;
  return { type: "model-selected", sessionId, model: `${providerID}/${id}` };
}
```
Fixture for normalize.test.ts: the verbatim live frames quoted in the SSE contract section (first-selection without `previous`, switch with `previous`).

### Resume seeding — summarizeSession addition + openSession hook

```typescript
// normalize.ts summarizeSession: OpenCodeSession.model is {id?, providerID?, variant?}
// (opencode-client.ts:16). Ignore variant (Pitfall 5); use entry id.
model: session.model?.providerID && session.model?.id
  ? `${session.model.providerID}/${session.model.id}`
  : undefined,

// app.tsx openSession(), after setSessions(...):
if (data.session.model) setModel(data.session.model);
```

### Pure helpers — models.ts (Layer 4, node:test-coverable)

```typescript
export type DeskModel = {
  key: string; id: string; providerID: string; name: string;
  status: string; context: number; released: number;
  enabled: boolean; tools: boolean; variantCount: number;
};

// First-slash split — poolside ids contain "/" (live: "poolside/poolside/laguna-s-2.1").
export function parseModelKey(key: string): { providerID: string; id: string } | null {
  const index = key.indexOf("/");
  if (index <= 0 || index === key.length - 1) return null;
  return { providerID: key.slice(0, index), id: key.slice(index + 1) };
}

export function filterModels(models: DeskModel[], query: string): DeskModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter((m) => `${m.name} ${m.id} ${m.providerID}`.toLowerCase().includes(needle));
}

export function groupModelsByProvider(models: DeskModel[]): { providerID: string; models: DeskModel[] }[] {
  const groups = new Map<string, DeskModel[]>();
  for (const m of models) groups.set(m.providerID, [...(groups.get(m.providerID) ?? []), m]);
  return [...groups.entries()].map(([providerID, list]) => ({ providerID, models: list }));
}

// Persisted deskModel may be stale/invalid (POST /model does not validate — Pitfall 2).
export function resolveActiveModel(key: string, models: DeskModel[], fallback: string): string {
  return models.some((m) => m.key === key) ? key : fallback;
}
```

### Picker persistence write (uses existing api.settings + Phase 7 field)

```typescript
// app.tsx — on select in the picker:
function chooseModel(key: string) {
  setModel(key);                                   // existing state, applied on send (line 307)
  void api.settings({ model: key }).catch(() => {}); // Phase 7 updateSettings -> deskModel -> persist
}
```
(Body key `model` per milestone ARCHITECTURE.md:44; confirm against Phase 7's executed code — see dependency table.)

## State of the Art

| Old Approach (v1 / current repo) | Current Approach (v2.3.2, live-verified) | Impact |
|--------------|------------------|--------|
| Models via `/provider` composite | `GET /api/model` flat catalog, `{data}` envelope | One light call for the picker |
| `PATCH /api/config` desk default | Dead (404); desk default in Paddy `deskModel` (Phase 7) | Persistence is local-only |
| Model entry key = modelID | Entry key = `id` (modelID is the shared wire model) | Picker keys + default formatting must prefer `id` |
| `capabilities.{reasoning,attachment,toolcall}` (repo types) | `capabilities.{tools,input[],output[],temperature?}` | Don't mirror stale types into DeskModel |
| No model event handling | `session.model.selected` + `model-switched` message | Reconciliation is a first-class wire event |

**Deprecated/outdated:** milestone ARCHITECTURE.md's "no GuiEvent/DeskEvent union changes" (one additive variant needed for MODEL-02); its `DeskModel = {key, modelID, providerID, name?}` sketch (must carry `id`-based key + MODEL-03 metadata fields).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | An invalid model ref that passes POST /model fails at prompt time via `session.execution.failed` / assistant error (not probed — would consume provider quota) | Pitfall 2 | Low: error surfacing already exists for execution failures; only the exact failure type is unverified. Phase 10 live check confirms. |
| A2 | APG select-only combobox keyboard contract (Arrows/Home/End/Enter/Esc/type-ahead, `aria-activedescendant`, `role="listbox"/"option"`) as cited in milestone research from WAI-ARIA APG — not re-fetched this session | Patterns / UI | Low: established pattern; milestone research fetched it. Keyboard QA is manual/Playwright anyway. |
| A3 | `model.updated` / `models-dev.refreshed` fire when providers/models change (schemas exist; neither observed in capture window) | Pitfall 8 | Low: refetch-on-open TTL covers staleness without them. |
| A4 | `GET /api/model` requires Basic auth on the real :4096 server like every other endpoint (throwaway was auth-configured; live probe only confirmed 401 on /api/info + /openapi.json) | Contract | Negligible: controller always sends auth. |
| A5 | 272-item flat list renders fine without virtualization (group+filter before render) | Stack | Low: Settings already renders per-provider lists of similar size; virtualization rejected by milestone research. |
| A6 | Phase 7 `updateSettings` body key will be `model` (per ARCHITECTURE.md:44; 07-CONTEXT says "extend ... with deskModel" without naming the wire key) | Phase 7 dependency | Medium: one-line mismatch; planner MUST read Phase 7's executed api.ts before wiring the write. |

## Open Questions (RESOLVED)

1. **Prompt-time failure shape for an invalid ref** — What we know: POST accepts anything (live). What's unclear: exact error event/message when prompting with `no-such-model-xyz`.
   **RESOLVED:** Deferred to Phase 10 (VER-05) live check (assumption A1). Phase 8 relies on the existing execution-failed surfacing and the abort-before-`/prompt` guard; no Phase 8 code depends on the exact failure type.
2. **Show models of unconnected providers?** — What we know: catalog lists all 10 providers regardless of credentials; `enabled:true` everywhere; connection state lives in `/api/integration` (Settings fan-out).
   **RESOLVED:** Show all entries, mark nothing (OpenCode TUI parity). Locked in `08-CONTEXT.md` ("Picker Experience"); a connected badge is deferred as it would add an extra request not required by MODEL-01/03.
3. **Provider display names** — Model.Info has no provider name; group labels would be raw ids (`alibaba-token-plan`).
   **RESOLVED:** Humanize the raw id for the group label (repo `humanize` precedent) while keeping the raw id in the key. Locked in `08-CONTEXT.md`; no extra provider-name call.
4. **MRU ordering / default badge polish** — P2 in milestone research; `GET /api/model/default` provides the default badge cheaply.
   **RESOLVED:** Include the default badge from the same route's `default` field; defer MRU ordering. Locked in `08-CONTEXT.md` / `08-UI-SPEC.md`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| opencode binary | Live contract capture / Phase 10 verification | ✓ | v2.3.2 (`~/.opencode/bin/opencode`) | — |
| Node.js | node:test, type stripping | ✓ | v26.13.1 (probe ran on it; floor 22) | — |
| Live OpenCode :4096 | Dev-time desk QA | ✓ (auth-required; controller owns credentials) | 2.3.2 | Throwaway spawn pattern (used by this research; controller does the same) |
| npm test infrastructure | Validation gate | ✓ | package.json:22 (9 TS suites + 3 mjs) | — |
| Playwright (manual QA) | Keyboard-path smoke | ✓ (devDep, not in npm test) | ^1.62.0 | Manual keyboard checklist |

**Missing dependencies with no fallback:** none. **Missing with fallback:** none.
Step 2.6 note: no new external dependencies introduced by this phase.

## Validation Architecture

`workflow.nyquist_validation: true` (config.json read this session). **node:test only; zero new deps; no component-render tooling** — all new logic lives in pure `.ts` modules or server layers with existing DI seams.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test + node:assert/strict (built-in), `--experimental-strip-types` for .ts |
| Config file | none — suite list hardcoded in package.json:22 `test` script (new test files must be added there) |
| Quick run command | `node --experimental-strip-types --test src/components/desk/models.test.ts` (per-file) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MODEL-01 | `listModels()` hits `GET /api/model` with `location[directory]`, unwraps `{data}` | unit (mockFetch) | `node --experimental-strip-types --test src/server/opencode-client.test.ts` | ✅ extend |
| MODEL-01 | `/api/models` returns projected flat list; degrade-to-empty when disconnected; requires no body | unit (fake runtime.client) | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ extend |
| MODEL-01 | grouping by providerID; substring filter over name+id+providerID; first-slash key parse incl. `poolside/poolside/laguna-s-2.1`; duplicate-modelID entries stay distinct | unit (pure) | `node --experimental-strip-types --test src/components/desk/models.test.ts` | ❌ Wave 0 (new file + package.json test entry) |
| MODEL-01 | keyboard control, always-visible trigger, popup a11y | manual-only (no RTL allowed) | Playwright `scripts/browser-smoke.mjs` extension or manual checklist at Phase 10 | n/a — justified: repo bans component-render tooling |
| MODEL-02 | picker write → `api.settings({model})` → `deskModel` persisted; bootstrap prefers it | unit (Phase 7 tests + route test) | `node --experimental-strip-types --test src/server/state.test.ts src/server/api.test.ts` | ✅ Phase 7 lands; extend |
| MODEL-02 | resume seed: `summarizeSession` maps `Session.Info.model` → `providerID/id`, ignores `variant:"default"` | unit (live fixture) | `node --experimental-strip-types --test src/server/normalize.test.ts` | ✅ extend |
| MODEL-02 | `session.model.selected` → `model-selected` GuiEvent (with/without `previous`; missing fields → null) | unit (verbatim live frames) | `node --experimental-strip-types --test src/server/normalize.test.ts` | ✅ extend |
| MODEL-02 | header applies event only for active session; stale deskModel falls back when not in catalog | unit (pure resolver + reducer) | `node --experimental-strip-types --test src/components/desk/models.test.ts` | ❌ Wave 0 |
| MODEL-02 | failed model POST aborts send (existing sendMessage order) | unit (mockFetch: /model → 400, assert /prompt never called) | `node --experimental-strip-types --test src/server/opencode-client.test.ts` | ✅ extend |
| MODEL-03 | projection carries `status`/`limit.context`/`time.released` verbatim from wire item | unit (live sample fixture) | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ extend |
| V2-03 guard | `/api/models` round-trip: `alibaba-token-plan` providerID + needle-as-substring payload survives byte-identical | unit (route-level) | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ extend (Phase 7 fixtures first) |
| VER-05/06 (Phase 10) | picked model is what runs; two tabs agree after switch | live manual | desk + OpenCode TUI switch; observe both headers | n/a — cross-phase |

### Sampling Rate
- **Per task commit:** affected suite file(s) via `node --experimental-strip-types --test <file>` (< 5s each)
- **Per wave merge:** `npm test` + `npx tsc --noEmit` + `npm run lint`
- **Phase gate:** full `npm test` green (hermetic post-Phase-7) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/components/desk/models.ts` + `models.test.ts` — pure helpers (new)
- [ ] `package.json` `test` script — append `src/components/desk/models.test.ts` to the strip-types suite list (manifest edit: justified, no dependency change)
- [ ] `GuiEvent`/`DeskEvent` additive `model-selected` variant + `SessionSummary.model?` mirror (normalize.ts + client.ts)
- [ ] No framework install needed; no new fixtures infra (live frames quoted in this document are the fixtures)

## Security Domain

`security_enforcement: true`, ASVS level 1 (config.json).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Existing loopback/token model (http.ts) — picker adds no auth surface |
| V3 Session Management | no | OpenCode owns sessions; Paddy adds no session tokens |
| V4 Access Control | yes | `/api/models` goes through the same auth/origin middleware; project directory from `activeProject`, never from browser input |
| V5 Input Validation | yes | `parseModelKey` result-union; route body validation via `readBody`; model string validated as string (Phase 7 accepts any string — membership check is client-side UX, server stays authoritative) |
| V6 Cryptography | no | none new |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account/org identifier leakage via raw Model.Info `headers`/`settings` | Information disclosure | Whitelist projection server-side (Pitfall 4) + `redactSecrets` |
| Identifier corruption by redaction (`alibaba-token-plan`) | Tampering (integrity) | Phase 7 exact-match needles + flat-array shape + round-trip regression test |
| Browser-supplied workspace path in models query | Elevation of privilege | Directory comes only from `activeProject(runtime)`; never accept a path param on `/api/models` |
| Header drift → user trusts wrong model | Repudiation/integrity | SSE reconciliation + catalog-membership check + abort-on-HTTP-error (criteria 2-3) |
| Cross-site fetch of /api/models | Spoofing | Existing `originAllowed` + peer auth unchanged |

## Sources

### Primary (HIGH confidence)
- **Live throwaway OpenCode v2.3.2 capture (this session)** — `/tmp/opencode/p8-openapi.json` (full server OpenAPI), `p8-models.json` (272-item catalog), `p8-results.json` (schemas, samples, SSE frames, default), `p8-probe2.json` (id/modelID semantics, no-validation probes, Session.Info sample). Scripts: `p8-capture.mjs`, `p8-probe2.mjs`. Both servers killed and verified; scratch sessions deleted and verified.
- **Repo read at HEAD this session** — `src/server/opencode-client.ts` (full), `api.ts` (full), `state.ts` (full), `security.ts` (full), `normalize.ts` (full), `runtime.ts:240-299`, `src/lib/desk/client.ts` (full), `src/components/desk/app.tsx` (full), `settings.tsx:240-314` + grep, `messages.ts:1-30`, test heads (`opencode-client.test.ts`, `api.test.ts`, `normalize.test.ts`), `package.json`.
- `.planning/phases/07-v2-hardening-foundation/07-CONTEXT.md` — locked upstream decisions (verbatim quoted).
- `.planning/REQUIREMENTS.md`, `.planning/V2-MIGRATION-SPEC.md`, `.planning/config.json`.

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` + `ARCHITECTURE.md` (milestone research, 2026-11-21) — integration map, four-layer pattern, APG combobox recommendation (APG itself fetched there, not this session). Two claims superseded by live capture: "no union changes" and the `DeskModel` sketch (see State of the Art).

### Tertiary (LOW confidence)
- None load-bearing. Unverified items are confined to the Assumptions Log (A1–A6).

## Metadata

**Confidence breakdown:**
- Wire contract (Model.Info / Model.Ref / SSE / Session.Info.model): **HIGH** — live-captured from the exact installed version, schema + behavior double-checked.
- Repo integration points: **HIGH** — full reads at HEAD with line numbers; Phase 7 gap explicitly verified (no deskModel yet).
- UI/keyboard patterns: **MEDIUM** — established APG practice via milestone research; manual QA covers it.
- Pitfalls: **HIGH** for 1-7, 9-10 (live-proven or code-verified); **MEDIUM** for 8 (event firing conditions unobserved).

**Research date:** 2026-11-21
**Valid until:** pinned to OpenCode v2.3.2 — re-capture if the installed server version changes (contract is version-specific; 30-day shelf life otherwise).
