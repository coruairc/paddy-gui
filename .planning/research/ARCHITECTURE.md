# Architecture Research

**Domain:** v1.1 feature integration into Paddy's controller/desk architecture (chat-header model picker, slash-command palette, per-session model application, hermetic test isolation)
**Researched:** 2026-11-21
**Confidence:** HIGH (repo-read directly + live-captured v2 spec + official published OpenAPI, cross-verified)

## Existing Architecture (verified in code, v1.1 start)

The single-process, two-half structure is intact after the v2 migration (commit `9a08c1b`). Every new feature lands inside it — no new processes, services, or state stores.

```
Browser (sandboxed, no node:* imports)
┌──────────────────────────────────────────────────────────────┐
│  app.tsx (desk UI, event reducer)  settings.tsx (9 panels)   │
│  src/lib/desk/client.ts — api.* methods + mirrored types     │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP /api/* + SSE /api/events (auth'd, origin-checked)
┌───────────────┴──────────────────────────────────────────────┐
│  src/server/http.ts — Node↔Web adapter, auth, SSE pump        │
│  src/server/api.ts — route table, validation, redaction      │
│  src/server/runtime.ts — supervisor, subscriber hub, DI seams│
│  src/server/opencode-client.ts — ONLY OpenCode adapter (v2)  │
│  src/server/normalize.ts — v2 wire → GuiEvent/ChatMessage    │
│  src/server/state.ts — atomic ~/.paddy/state.json (0600)     │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP + Basic auth, SSE /api/event
        opencode serve (v2.3.2, child process or attached)
```

Two facts shape everything below:

1. **Per-session model application on send already exists.** `opencode-client.ts:189-204` (`sendMessage`) POSTs `/api/session/{id}/model` before `/prompt` when `providerID`+`modelID` are given; `api.ts:236-249` (`send`) splits the `"providerID/modelID"` string; `app.tsx:307` passes `model` state. MODEL-02's server half is *done* — what's missing is picker UI, a light models-list route, and persistence of the desk default.
2. **The v2 migration kept the desk contract stable** (GuiEvent, ChatMessage, client.ts types), so new features are additive: new client methods, new routes, new UI state. The SSE/event pipeline needs **no changes** for commands or models (command output streams back as ordinary `session.text.*`/`session.tool.*` events).

## Integration Points (new vs modified — the core answer)

### Server layer

| File | Status | Change | Detail |
|------|--------|--------|--------|
| `src/server/opencode-client.ts` | **NEW methods** | `listModels(directory?)`, `listCommands(directory?)`, `runCommand(directory, sessionId, {name, text})` | `listModels`: `GET /api/model?location[directory]=` → `{data: Model.Info[]}` (request() already unwraps `.data`); reuse/`export` the existing private `defaultModel()` result to also return the OpenCode default. `listCommands`: `GET /api/command?location[directory]=` → `{data: Command.Info[]}`, `Command.Info = {name, description?}`. `runCommand`: `POST /api/session/{id}/command` body `{name, text}` — **both required, `additionalProperties: false`** (verified against published OpenAPI). Add `OpenCodeCommand` wire type next to the existing `OpenCodeModel`. |
| `src/server/opencode-client.ts` | **MODIFIED (delete)** | remove `updateConfig()` (lines 271-282) | It targets dead `PATCH /api/config`. v2's only config write is `PATCH /api/experimental/config` (shell only) — no drop-in replacement. Repo convention: dead scaffold wired into the build is a hazard (removed app-builder scaffolding in v1.0 for exactly this). |
| `src/server/api.ts` | **NEW routes** | `GET /api/models`, `GET /api/commands`, `POST /api/sessions/{id}/command` | `/models` and `/commands`: project-scoped via `requireProject()`, mirror `readOpenCode()`'s degrade-to-empty when disconnected (like `/agents` returns `[]`). `/sessions/{id}/command`: new `rest === "command"` branch in `sessionRoute()` (api.ts:189), body validation copied from `send()` — `name` must be a non-empty string, `text` a string (allow `""` for zero-arg commands). Return `202 {ok: true}` like `send`. |
| `src/server/api.ts` | **MODIFIED** | `updateSettings()` (line 157) accepts `body.model` | `if (typeof body.model === "string") runtime.state.deskModel = body.model.trim()` → `persist()`. **No new persistence route needed** — `PATCH /api/settings` already exists and is the sanctioned desk-state write path. |
| `src/server/api.ts` | **MODIFIED** | `bootstrap()` (line 69) sources `model` from state | `model = runtime.state.deskModel || <existing config/defaultModel derivation>`. Persisted desk default wins; OpenCode default is the fallback for fresh installs. |
| `src/server/api.ts` | **MODIFIED (delete)** | remove `patchConfig()` route (lines 303-311) | Dead once Settings stops calling it (see V2-02 below). |
| `src/server/state.ts` | **MODIFIED** | `AppState.deskModel: string` | Add to `AppState`, `EMPTY_STATE` (`""`), `normalizeState` (guard: `typeof input?.deskModel === "string" ? … : ""`), and `publicState` (expose `deskModel`). **This is the persistence location for MODEL-02.** `normalizeState` rebuilds field-by-field, so old state files (including `~/.config/opencode-web` compat installs) upgrade silently: missing field → `""` → bootstrap falls back to OpenCode default. Never persist per-session model state here — OpenCode owns that (authority constraint). |
| `src/server/runtime.ts` | **MODIFIED** | injectable `probe` seam | Add `probe?: ProbeImpl` to `ControllerRuntimeOptions` (line 35-40, next to the existing `spawn`/`sleep`/`kill` seams) and route `connectInner()`'s probe call (line 145) through it. **This is the V2-01 fix** — see Data Flow / Hermetic Tests. |
| `src/server/normalize.ts` | **MODIFIED (optional)** | map `session.model.selected` → system message | Currently ignored (unknown → null). After `POST …/model`, OpenCode emits this event and a `Session.Message.ModelSelected` message. Mapping it to a system message ("Model set to X") gives the picker visible confirmation in the thread. Optional polish; not required by MODEL-01/02. |

### Browser layer

| File | Status | Change | Detail |
|------|--------|--------|--------|
| `src/lib/desk/client.ts` | **NEW** | types + `api.models()`, `api.commands()`, `api.runCommand(id, name, text)` | New types: `DeskModel = {key: string; modelID: string; providerID: string; name?: string}` (key = `"providerID/modelID"` — matches the existing string-model contract used by `api.send`) and `DeskCommand = {name: string; description?: string}`. `api.models(): {models: DeskModel[]; default?: string}`, `api.commands(): {commands: DeskCommand[]}`, `runCommand` POSTs to `/api/sessions/{id}/command`. |
| `src/lib/desk/client.ts` | **MODIFIED (delete)** | remove `patchConfig` | Dead after Settings migration. |
| `src/components/desk/app.tsx` | **MODIFIED** | header model picker + composer slash palette + submit interception | (a) Model state already exists (`const [model, setModel]` line 45) and is already applied on send (line 307) — the picker writes it and persists via `api.settings({model})`. (b) New state: `models`, `commands`, palette open/selection indices. (c) `submit()` (line 275): if draft parses as `/name args` and `name` is a known command → `api.runCommand()` instead of `api.send()`; local echo identical (pending user message with the full `/name args` text). (d) `chooseProject()` (line 195-200): drop the `api.config()` model re-read — the desk default is global (one desk default per PROJECT.md Out-of-Scope), sourced from bootstrap. |
| `src/components/desk/app.tsx` — new components | **NEW** | `ModelPicker`, `CommandPalette` | Kebab-case files per convention. Picker: trigger in the chat **header** (app.tsx:437-460, next to Retry/Rename/Archive) showing the current model name; menu lists models **grouped by provider** (group with `useMemo` over the flat list — grouping is presentation). Command palette: absolutely-positioned list above the composer, shown when draft starts with `/`; filter by the token after `/`; ↑/↓ navigate, Enter/Tab run-or-complete, Esc dismiss. Only a **leading** `/` triggers it (mid-message `/` like paths is ordinary text). |
| `src/components/desk/commands.ts` | **NEW** | pure slash-logic module | `parseCommandDraft(draft): {name, args} \| null` and `filterCommands(commands, query)` as pure functions, co-located `commands.test.ts` under `node:test`. Mirrors the existing `messages.ts` pattern (pure reducers kept out of components so they stay unit-testable without RTL — a stated repo convention). |
| `src/components/desk/settings.tsx` | **MODIFIED** | `setDeskDefault()` (line 302-321) drops `api.patchConfig` | Persist via `api.settings({ model: fullModel })`; delete the misleading dual-note ("saved in OpenCode" / "set for this desk") — it currently swallows the 404. **Also affected:** Agents "Save agent" (line 437) and Permissions "Save permissions" (line 475) still call `api.patchConfig` and will 404 — see V2-02 decision below. |

## Data Flow Changes

### Model picker → per-session application (MODEL-01/02)

```
Picker select → setModel("provider/model") → api.settings({model})
    → PATCH /api/settings → state.deskModel → persist() (~/.paddy/state.json)
Reload: bootstrap → model = state.deskModel || OpenCode default → setModel
Send (existing, unchanged): app.tsx submit → api.send(id, text, model)
    → api.ts send() → splitModel → client.sendMessage()
    → POST /api/session/{id}/model  {model:{id, providerID}}
    → POST /api/session/{id}/prompt {text}
Optional feedback: session.model.selected event → system message in thread
```

The picker's model list: `GET /api/models` → `client.listModels()` (`GET /api/model?location[directory]=`) → flat `DeskModel[]` + default badge from `GET /api/model/default`. Do **not** reuse `getProviders()` for the picker — it fans out 4 parallel requests and returns the redacted Settings-shaped composite; the desk picker wants the single light call.

### Slash command (CMD-01/02)

```
draft "/" → api.commands() → GET /api/commands → requireClient().listCommands()
    → GET /api/command?location[directory]= → {data:[{name,description}]}
    → palette (filtered by parseCommandDraft/filterCommands)
Submit "/name args" → api.runCommand(id, name, text)
    → POST /api/sessions/{id}/command {name, text}
    → command executes in-session; output arrives as ordinary
      session.text.* / session.tool.* SSE events → existing applyEvent reducer
Failure: HTTP error → keep the echoed user message + append a system
      message with the error (CMD-02 "errors surface in the thread"),
      not just the top-of-screen error bar.
Unknown "/name": reject client-side with a system message — no roundtrip.
```

No `GuiEvent`/`DeskEvent` union changes. No normalize.ts changes required (command execution reuses the prompt event pipeline). Optionally refresh the command list on the `command.updated` v2 event.

### Hermetic test isolation (V2-01) — root cause and fix

The failing test is `runtime.test.ts:118` "spawn uses detached:true". Root cause chain, verified in code:

- `connectInner()` (`runtime.ts:125-180`) probes `http://127.0.0.1:4096` (line 145) using `credentials()`, which falls back to **`process.env.OPENCODE_SERVER_PASSWORD`** (line 185).
- On this dev machine a live v2.3.2 server holds :4096 and the ambient env password authenticates → probe returns `"ok"` → `attach()` → **`spawn` is never called** → `assert.ok(spawnCalls.length > 0)` fails.
- Second ambient leak: `process.env.OPENCODE_URL` (line 141) forces the explicit-attach path, also bypassing spawn.

Fix (smallest change that matches the architecture):

1. Add `probe?: (url, auth) => Promise<"ok"|"auth"|"down">` to `ControllerRuntimeOptions` and use it in `connectInner` — identical in shape to the existing `spawn`/`sleep`/`kill` seams, which the runtime was explicitly built around (`runtime.ts:32-40`).
2. In the test: inject `probe: async () => "down"` and scrub ambient env (`OPENCODE_URL`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`) alongside the existing `OPENCODE_BIN` save/restore. The fake `OPENCODE_BIN` + injected spawn child then exercise the spawn branch deterministically.
3. Assert the 4096-default behavior separately (probe seam returning `"ok"` → attach, no spawn) so both branches are covered without a live server.

This keeps `connectInner`'s real-world flow (probe → attach → spawn) intact and makes the suite green in any environment — the V2-01 gate, which every later phase runs `npm test` against.

## Patterns to Follow (existing, load-bearing for these features)

### Pattern 1: four-layer feature wiring

**What:** Every OpenCode-backed feature is exactly: a client method (`opencode-client.ts`, the only place endpoints exist) → an api.ts route (validation + redaction) → a client.ts method + mirrored type → UI state in app.tsx. The V2-MIGRATION-SPEC states this as "OpenCode path coupling."

**Why it matters here:** models and commands each add one column through all four layers. Building them in layer order (client → route → browser client → UI) means each layer is testable before its consumer exists (`opencode-client.test.ts` mocks `fetch`; `api.test.ts` fakes the runtime client).

### Pattern 2: DI seams for ambient side effects

**What:** `ControllerRuntimeOptions` already injects `spawn`/`sleep`/`kill` (runtime.ts:35-40); `OpenCodeClient` injects `fetch`. Tests construct real instances with temp state files (`tempStateFile()`), never the singleton.

**When to use:** any new code that touches process env, network, or ports must be injectable the same way. The probe seam for V2-01 is the third application of this pattern, not a new mechanism.

### Pattern 3: pure logic in plain .ts modules

**What:** Streaming/reducer logic lives in `messages.ts` with co-located `node:test` suites; components stay thin. There is no RTL/jsdom — keep new UI logic (slash parsing, model grouping keys) in pure modules (`commands.ts`) so it stays unit-testable.

### Pattern 4: result-union validation at the boundary

**What:** api.ts handlers throw `OpenCodeError(400, …)` for bad bodies (`readBody`, `send`); `validateWorkspacePath` returns `{ok}` unions. New `POST /sessions/{id}/command` validation should copy `send()`'s shape exactly.

## Anti-Patterns to Avoid

### Anti-Pattern 1: persisting model/commands in OpenCode global config

**What people do:** try to restore v1's `PATCH /api/config` write for the desk default (or via `PATCH /api/experimental/config`).
**Why it's wrong:** `PATCH /api/config` does not exist in v2 (verified: published OpenAPI lists only `PATCH /api/experimental/config`, shell-scoped). The 404 is the symptom; the decision is already logged in PROJECT.md — per-session `POST /api/session/{id}/model` is the supported path, desk default lives in Paddy state.
**Do this instead:** `AppState.deskModel` via the existing `PATCH /api/settings` route.

### Anti-Pattern 2: reusing getProviders() for the chat picker

**What people do:** lift Settings' provider composite into the chat header.
**Why it's wrong:** 4 parallel OpenCode requests, secret-redaction pass, and a nested Settings-specific shape for a picker that needs one flat list + a default marker. It also couples header latency to Settings' needs.
**Do this instead:** dedicated light `listModels()` + `GET /api/models`.

### Anti-Pattern 3: swallowing the command 404/error in a toast

**What people do:** catch command failures into the top error bar or a sonner toast.
**Why it's wrong:** CMD-02 requires errors to surface **in the thread**; the user's `/name args` echo must stay visible with the failure attached, or the turn reads as if it vanished.
**Do this instead:** keep the echoed user message, append a system ChatMessage with the error text (the PermissionCard "Permission denied" flow, app.tsx:338-341, is the in-repo precedent for thread-level system errors).

### Anti-Pattern 4: treating `/` anywhere in the draft as a command

**What people do:** regex the whole draft for `/word`.
**Why it's wrong:** "check /etc/hosts and /var/log" is an ordinary prompt; leading-slash-only matches OpenCode TUI semantics and user expectation.
**Do this instead:** `parseCommandDraft` triggers only when the trimmed draft starts with `/` and the first token matches a known command name; unknown leading `/name` → client-side system message, no roundtrip.

## V2-02 Decision Flag (for the roadmap)

"Settings saves never 404" has **three** call sites, not one (verified in settings.tsx):

| Call site | Line | Treatment |
|-----------|------|-----------|
| Providers → "Use as desk default" | 314 | **Fix:** persist to Paddy state (`api.settings({model})`) — in scope for MODEL-02. |
| Agents → "Save agent" | 437 | **Decision needed:** v2 has no remote global-config write. Either mark the section read-only with an explicit "OpenCode v2 does not expose global config writes" note, or remove the save affordance. Silently catching the 404 (current behavior) is the worst option. |
| Permissions → "Save permissions" | 475 | Same decision as Agents. |

Minimal-milestone scope is the model call site; the other two still 404 today and should at minimum stop pretending to save. Recommend read-only treatment over removal (the GET side still works and is informative) — but this is a roadmap-level call, not a research one.

## Suggested Build Order (dependency-driven, avoids rework)

1. **Hermetic test fix (V2-01)** — probe seam + env scrub in runtime.test.ts.
   *Why first:* it is the quality gate every subsequent phase verifies against (`npm test` green in a clean environment). Tiny, independent, unblocks everything.
2. **Desk-model persistence foundation (V2-02 model half)** — `state.ts` `deskModel` (+normalize/public/EMPTY), `updateSettings` accepts `model`, `bootstrap` prefers it, `settings.tsx setDeskDefault` switches to `api.settings`, remove the `patchConfig` chain (client method, api route, client.ts method) and decide the Agents/Permissions treatment.
   *Why before the picker:* the picker needs somewhere durable to write. Picker-first would ship a selection that resets on reload and need rework.
3. **Models data path (MODEL-01 server half)** — `opencode-client.listModels()` (+ default), `GET /api/models` route, client.ts types + `api.models()`, with client/api tests.
   *Why before picker UI:* four-layer order — each layer lands with its tests before the consumer.
4. **Model picker UI (MODEL-01/02 complete)** — header picker component, provider grouping, wiring to existing `model` state and send path; optional `session.model.selected` → system message.
5. **Commands data path (CMD-01 server half)** — `listCommands()`, `runCommand()`, `GET /api/commands` + `POST /api/sessions/{id}/command`, client.ts methods, pure `commands.ts` + tests.
   *Order note:* independent of 3-4 (could parallel), but sequential keeps the review surface one-feature-wide; listed after models because MODEL-* requirements are first in the milestone.
6. **Slash palette UI + execution (CMD-01/02 complete)** — composer interception, palette component, thread-level error surfacing, unknown-command handling.

Steps 1 and 2 are small and could merge into one phase if the roadmap wants fewer, larger phases; 3+4 and 5+6 are natural feature-vertical pairs.

## Open Verification Items (phase-specific)

- **Command `text` semantics:** the OpenAPI requires `{name, text}` but does not state whether `text` is the arguments only (`"scaffold"`) or the full input (`"/new scaffold"`). Verify against the live server (spec's manual-verification section) during phase 5/6 — it changes one line in `submit()`'s interception. Cached digest flagged MEDIUM for this reason; everything else is cross-verified HIGH.
- **Zero-arg commands:** whether `text: ""` is accepted for commands like `/new` with no arguments — same live check.
- `session.model.selected` payload shape (for the optional system-message mapping) — capture from the live event stream if that polish is scheduled.

## Sources

- Repo, read directly (highest tier, current): `src/server/{api,runtime,state,opencode-client}.ts`, `src/lib/desk/client.ts`, `src/components/desk/{app,settings}.tsx`, `src/server/runtime.test.ts` — HIGH.
- `.planning/V2-MIGRATION-SPEC.md` — live-captured v2.3.2 contract (curated) — HIGH.
- `https://opencode.ai/docs/server/` + `https://opencode.ai/docs/openapi.json` (fetched 2026-11-21) — official published OpenAPI; cross-verified against the live-captured spec; confirms command/model routes, required bodies, and absence of `PATCH /api/config` — MEDIUM→HIGH where cross-verified (single-source semantic gap on `text` semantics → MEDIUM).
- `.planning/PROJECT.md` — milestone scope, constraints, decisions (per-session model application decision already logged).

---
*Architecture research for: Paddy v1.1 — model picker, slash commands, v2 hardening*
*Researched: 2026-11-21*
