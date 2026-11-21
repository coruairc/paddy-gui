# Phase 9: Slash Command Palette - Research

**Researched:** 2026-11-21
**Domain:** OpenCode v2.3.2 command HTTP/SSE contract + four-layer Paddy integration (controller → desk)
**Confidence:** HIGH (command contract captured live from a throwaway v2.3.2 server this session; integration points read in repo at HEAD `e6b5088`)

## Summary

This research resolves the MEDIUM-confidence command endpoint shapes flagged in STATE.md by capturing the contract **from the local OpenCode v2.3.2 server itself**, not the published OpenAPI. The live server on 127.0.0.1:4096 requires auth (401 on unauthenticated `/openapi.json`), so a throwaway `opencode serve` was spawned on 127.0.0.1:43217 with a freshly generated password (never echoed), probed, and killed. All findings below tagged `[VERIFIED: live v2.3.2]` come from that server's own `/openapi.json` and live request/SSE captures.

**The settled semantics:** `POST /api/session/{id}/command` takes `{name, text}` where **`text` is args-only** — the server substitutes it into the command template's `$ARGUMENTS` and persists the *expanded* text as the user message. Zero-arg commands work with `text: ""` (the field is required; omitting it is a 400). Unknown commands return **404 with a flat `{_tag:"CommandNotFoundError", command, message}` body**. `command.updated` is a **pure invalidation signal with `data: {}`** — the palette must refetch `GET /api/command`. The expanded user message reaches the browser **only via `session.inbox.enqueued`** (there are no `session.message.*` events in v2.3.2), which the current normalizer drops.

**Two findings change the plan of record in `.planning/research/ARCHITECTURE.md`:** (1) CMD-03 *does* require a `GuiEvent`/`DeskEvent` union addition — `command.updated` normalizes to `null` today and the runtime only emits normalized events, so the browser can never see it without a new mapping. (2) The "local echo identical" strategy is incomplete: the server's expanded user message text differs from the echoed `/name args`, and `mergeMessage` reconciles pending echoes by *identical text* — so command echoes need explicit replacement logic. Relatedly, a **pre-existing stuck-pending-echo bug** was verified in code: no SSE event ever clears the optimistic user bubble in the current prompt flow, and the composer guards on `messages.some(m => m.pending)`. Phase 9's inbox mapping should fix this for both flows.

**Primary recommendation:** Build the four-layer command path exactly as ARCHITECTURE.md maps it, with three amendments: a `commands-changed` event variant for CMD-03, a `session.inbox.enqueued` → user-message mapping for echo reconciliation, and server-authoritative unknown-command handling (dispatch and surface the 404 in-thread) with a client-side pre-check only as a snappy-path optimization. Zero new dependencies.

## User Constraints

**No Phase 9 CONTEXT.md exists yet** (`.planning/phases/09-slash-command-palette/` was not created before this research). The binding constraints below are milestone-level locked decisions, copied verbatim from their sources.

### Locked decisions (from `.planning/STATE.md` § Decisions)

> - [Roadmap v1.1]: Feature verticals (model picker, commands) land data path before UI, per the four-layer pattern; sequentially to keep review surface one-feature-wide.
> - [Roadmap v1.1]: Zero new dependencies — both widgets are hand-built WAI-ARIA APG comboboxes (research SUMMARY.md).
> - [Roadmap v1.1]: V2-03 redaction hardening lands in Phase 7, before any new model/command routes route identifier-shaped payloads through `redactSecrets`.

### Locked scope exclusions (from `.planning/REQUIREMENTS.md` § Out of Scope, verbatim rows)

> | Client-side command registry | Violates OpenCode authority — commands come only from the server |
> | `cmdk`/Radix/fuse.js component or search libraries | Stack change; hand-built comboboxes fit the constraints |
> | Global Cmd+K command palette | Scope is composer-anchored `/` commands only |
> | Per-argument command autocomplete | The v2 command API has no argument schema; would mean reimplementing OpenCode |
> | Sending `/name` as plain prompt text | Commands are a distinct dispatch; must not silently become prompts |

### Phase 7 dependency (from `.planning/phases/07-v2-hardening-foundation/07-CONTEXT.md`, verbatim)

> - Exact whole-string needle matching: a string node is replaced only when it equals a needle; key-based `SECRET_KEY` field redaction stays unchanged. …
> - Tests land in both `security.test.ts` (unit) and `api.test.ts` (route-level round-trip) — fixtures before any new model/command routes in Phases 8–9.

Phase 7 code has **not landed yet** at HEAD (no `deskModel`, no injectable `probe` seam found in `src/server/` this session — only Phase 7 docs commits exist). Phase 9 plans must assume Phase 7 executes first (roadmap order) and must not re-implement its items.

## Project Constraints (from AGENTS.md)

- **Stack:** Node 22+, TypeScript, TanStack Start; one process; no separate backend service or database.
- **Test runner:** `node:test` only — Jest/Vitest forbidden.
- **Security boundary:** the controller (`src/server/*`) is the only component with shell/filesystem/OpenCode access; the browser never imports `node:*` and never sees the OpenCode password.
- **Authority:** OpenCode is the source of truth for sessions, messages, models, commands. No client-side command registry.
- **Conventions that bind new code:** kebab-case files; named exports; `type` aliases by default; discriminated unions on a literal `type` field; validation returns `{ok}` unions or throws `OpenCodeError` at the boundary; every workspace path through `validateWorkspacePath`; credential-shaped output through `redactSecrets`; pure logic in plain `.ts` modules co-located with `node:test` suites (no RTL/jsdom); server modules open with a JSDoc invariant block; Prettier (double quotes, semicolons, trailing commas, width 100).
- **Generated file:** never edit `src/routeTree.gen.ts`.
- **Git:** commit only named files; no `git add -A`.

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|-------------|------------------|
| CMD-01 | User typing `/` in the composer sees a filterable, keyboard-first palette of OpenCode commands (name + description) sourced from `GET /api/command` | Live-captured `GET /api/command` contract: `{location, data: Command.Info[]}` envelope, `Command.Info = {name, description?}` (description genuinely optional — verified), `location[directory]` scoping, cold-start empty-list race and its `command.updated` remedy (§ Live Contract 1) |
| CMD-02 | Submitting `/name args` runs the command via `POST /api/session/{id}/command`; unknown or failing commands surface their error in the thread as a system message, not a transient toast | Live-captured POST body `{name, text}` (args-only `text`), 204 success, exact 400/404/500 error bodies for in-thread mapping, expanded-user-message SSE flow, `session.execution.failed` shape for async failures (§ Live Contract 2–5) |
| CMD-03 | The command list refreshes when OpenCode emits `command.updated` while the desk is open | Live-captured `command.updated` payload (`data: {}`, envelope `location.directory`); verified that current `normalizeEvent` drops it and `eventLoop` emits only normalized events → new event variant required (§ Live Contract 6, § Architecture Patterns) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Command registry (source of truth) | OpenCode server | — | Locked: commands come only from the server; `GET /api/command` per project |
| Command list proxy + redaction | API/Backend (controller `api.ts` → `opencode-client.ts`) | — | Browser never talks to OpenCode directly; allowlist + redaction at the boundary |
| Palette UI, filter, keyboard navigation | Browser / Client | — | Presentation only; pure filter/parse helpers in `commands.ts` for `node:test` |
| Dispatch decision (leading `/` detection) | Browser / Client (pure parser) | — | Input interpretation; mid-text slashes stay ordinary prompts |
| Template expansion + execution | OpenCode server | Controller (proxy only) | Server substitutes `$ARGUMENTS`; **never synthesize expanded text client-side** |
| Expanded user message delivery | OpenCode (`session.inbox.enqueued`) | Controller (`normalize.ts`) → Browser | Only SSE path carrying the user message in v2.3.2 |
| Error surfacing in-thread | Browser / Client | Controller (error mapping via `errorMessage`/`errorResult`) | CMD-02: persistent system message, not toast |
| `command.updated` invalidation | Controller (normalize + fan-out) | Browser (refetch on event + on palette open) | Existing SSE hub fans out to all tabs (multi-tab safe) |

## Live-Captured v2.3.2 Command Contract

> Capture method: throwaway `opencode serve --hostname 127.0.0.1 --port 43217` (binary `~/.opencode/bin/opencode`, `opencode v2.3.2`), password generated via `node:crypto` and passed as `OPENCODE_SERVER_PASSWORD` (the same env mechanism Paddy's own supervisor uses — `src/server/runtime.ts:247-253` sets `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` on the spawned child). Scratch project `/tmp/opencode/cmd-research/project/` with `.opencode/command/echo-test.md` (template `Repeat exactly the following arguments and nothing else: $ARGUMENTS`) and `noargs-test.md` (template `Say the single word: pong`). Server killed and port released after capture; scratch session deleted (204). Raw evidence: `/tmp/opencode/cmd-research/{openapi-local.json,semantics-results.json,hotreload-results.json,events.jsonl}` (ephemeral — key payloads quoted verbatim below).

### 1. `GET /api/command` — the palette source [VERIFIED: live v2.3.2]

Request: `GET /api/command?location[directory]=<absolute project path>` (deepObject `location` query param, optional; Basic auth required). Without `location`, the server scopes to **its own CWD** (live: returned the repo directory because the throwaway server was launched from it) — the controller must always pass the active project's directory.

Response 200 (verbatim, cold start — registry not yet scanned):

```json
{ "location": { "directory": "/tmp/opencode/cmd-research/project" }, "data": [] }
```

Response 200 after registry scan (verbatim entries):

```json
{ "name": "init", "description": "guided AGENTS.md setup" }
{ "name": "echo-test", "description": "Echo the arguments back (EDITED description)" }
{ "name": "nodesc-test" }
```

- Envelope is `{location: {directory}, data: Command.Info[]}` — matches the repo's `unwrapData` convention. [VERIFIED: live v2.3.2]
- Local OpenAPI `Command.Info` schema (verbatim): `{"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"}},"required":["name"],"additionalProperties":false}` — **`description` is optional in schema and in practice** (`nodesc-test` was created without description frontmatter and listed as `{"name":"nodesc-test"}`). [VERIFIED: live v2.3.2]
- **Project scoping is real:** scratch project listed 83 commands (globals + builtins + its 2 fixtures); the paddy-gui directory listed 81 — `gsd-plan-phase` present, `echo-test` absent, builtin `init` present. The palette must refetch when the active project changes. [VERIFIED: live v2.3.2]
- **The list mixes builtins, plugin commands, and project commands.** Observed names include `init`, `review`, `goal`, `gsd-*` (e.g. `gsd-plan-phase`), and colon-namespaced `rea:*` (e.g. `rea:audit_residual_unknowns`). **Command names may contain colons and hyphens** — the draft parser must not restrict names to `[a-z-]`. [VERIFIED: live v2.3.2]
- **Cold-start race:** the first `GET /api/command` for a freshly touched project returned `data: []`; `command.updated` events fired ~1s later (timestamps 1795296702084 / 1795296702774 for the scratch dir); the next GET returned the full 83-command list. Mechanism (lazy async scan triggered by project activation) is inferred, but the observable behavior — *early GET can be empty; `command.updated` marks completion* — is verified. **Mitigation: refetch on palette open AND on `command.updated`; never treat an empty cached list as authoritative for "unknown command" rejection.** [VERIFIED: live v2.3.2 for behavior; ASSUMED for mechanism]
- Error responses: 400 `InvalidRequestError`, 401, 404 `LocationNotFoundError` (per local OpenAPI). [VERIFIED: live v2.3.2 OpenAPI]

### 2. `POST /api/session/{sessionID}/command` — dispatch [VERIFIED: live v2.3.2]

Local OpenAPI request body (verbatim required/properties): `"required":["name","text"]`, `"additionalProperties":false`, properties: `name` (string), `text` (string), `files` (array of `PromptInput.FileAttachment`), `agents` (array of `Prompt.AgentAttachment`), `skills` (array of `PromptInput.SkillAttachment`), `delivery` (`Session.Inbox.Delivery | null`). Operation description: *"Execute a slash command callback immediately."*

- **`{name, text}` is correct and sufficient.** The optional attachment/delivery fields are out of scope for Phase 9 (no argument schema, no attachments in the composer). [VERIFIED: live v2.3.2]
- **Runtime discrepancy:** despite `additionalProperties: false` in the local OpenAPI, the live server **accepted** `{"name":"echo-test","text":"x","arguments":"y"}` with **204** (executed normally). Do not rely on extra-field rejection; send only `{name, text}`. [VERIFIED: live v2.3.2]
- **Success = 204, no body.** Fire-and-forget: POST latency 885 ms cold, 5–20 ms warm; execution proceeds asynchronously. The repo's `request()` already handles this: `if (response.status === 204) return null;` (`src/server/opencode-client.ts:574`). [VERIFIED: live v2.3.2 + VERIFIED: src/server/opencode-client.ts:574]
- Path param is the session ID only — **no `location` query param** on this route; the session carries its own location. [VERIFIED: live v2.3.2 OpenAPI]

### 3. `text` semantics — SETTLED: args-only [VERIFIED: live v2.3.2]

Probe: sent `{"name":"echo-test","text":"hello world"}` → 204. The persisted user message (verbatim from `GET /api/session/{id}/message`):

```json
{ "id": "msg_20005af8f001cpozHiuhosR7D4", "time": { "created": 1795296703417 }, "text": "Repeat exactly the following arguments and nothing else: hello world", "type": "user" }
```

The server substituted `hello world` into `$ARGUMENTS`. Counter-probe: sent `{"name":"echo-test","text":"/echo-test full input probe"}` → user message text became `"Repeat exactly the following arguments and nothing else: /echo-test full input probe"` — the full input is embedded **verbatim as arguments** (double-command garbage). **Therefore the composer must send only the args remainder, never the leading `/name`.** This settles the one-line `submit()` question flagged in SUMMARY.md/ARCHITECTURE.md.

### 4. Zero-arg commands — SETTLED: `text: ""` works; `text` is mandatory [VERIFIED: live v2.3.2]

| Probe | Result |
|-------|--------|
| `{"name":"noargs-test","text":""}` (template has no `$ARGUMENTS`) | 204; user message `"Say the single word: pong"` |
| `{"name":"echo-test","text":""}` (template has `$ARGUMENTS`) | 204; user message `"Repeat exactly the following arguments and nothing else:"` (empty substitution, trailing whitespace trimmed in stored text) |
| `{"name":"echo-test","text":"   "}` (whitespace-only) | 204; same trimmed expansion |
| `{"name":"echo-test"}` (missing `text`) | **400** `{"_tag":"InvalidRequestError","message":"Missing key\n  at [\"text\"]","kind":"Payload"}` |

The browser client must always include `text` (empty string for `/name` with no args). Paddy's own route validation should allow `""` (unlike `send()`, which rejects empty text — see Pitfall 6).

### 5. Error bodies — SETTLED: flat `_tag`-discriminated JSON [VERIFIED: live v2.3.2]

Unknown command (verbatim):

```json
{ "_tag": "CommandNotFoundError", "command": "does-not-exist", "message": "Command not found: does-not-exist" }
```

→ **HTTP 404**. Unknown session (verbatim): `{"_tag":"SessionNotFoundError","sessionID":"ses_nonexistent000","message":"Session not found: ses_nonexistent000"}` → **404**. Local OpenAPI also declares 400 `InvalidRequestError` (`{_tag, message, kind?: string|null, field?: string|null}`), 404 `LocationNotFoundError`, and **500 `CommandExecutionError`** (`{_tag:"CommandExecutionError", command, message}`) for synchronous execution failures. [VERIFIED: live v2.3.2 OpenAPI + live 404/400 captures]

**These bodies already flow through the repo's error machinery unchanged:** `errorMessage()` reads `record.message` (`src/server/opencode-client.ts:632-637`: `(typeof record.message === "string" && record.message)` is in the extraction chain), `request()` throws `OpenCodeError(status, message, status >= 500)`, and `errorResult` returns `{error, retryable}` to the browser (`src/server/api.ts:421-425`). The browser `request()` throws `Error(data.error || ...)` (`src/lib/desk/client.ts:106`). **No new error plumbing is needed — only the in-thread rendering of the caught message (CMD-02).**

### 6. `command.updated` — SETTLED: pure invalidation, `data: {}` [VERIFIED: live v2.3.2]

Captured on hot-add, description-edit, and file-remove of `.opencode/command/*.md` while subscribed to `GET /api/event` (verbatim):

```json
{ "id": "evt_20006dcbb0010z0T44r2wSHK9N", "created": 1795296779451, "type": "command.updated", "location": { "directory": "/tmp/opencode/cmd-research/project" }, "data": {} }
```

- **`data` is an empty object** — no command list, no changed name. The local OpenAPI schema confirms `data` is unconstrained (`"not":{"type":"null"}`). The only usable fields are `type` and the **envelope-level** `location.directory` (note: *not* inside `data`). [VERIFIED: live v2.3.2]
- Fired for: file add, content edit, file remove (watcher latency ≤ ~1–3 s), and the initial registry scan at project activation. A no-op rewrite (identical content) produced **no** event. Events fire per affected project directory (both scratch and server-CWD dirs emitted their own). [VERIFIED: live v2.3.2]
- **CMD-03 consequence:** the browser must **refetch `GET /api/commands`** on this event; there is nothing to merge from the payload. Debounce refetches (bursts of up to 9 events were observed during startup + edits). [VERIFIED: live v2.3.2]

### 7. Expanded user message delivery — SETTLED: `session.inbox.enqueued` [VERIFIED: live v2.3.2]

**v2.3.2 has no `session.message.*` events.** The full local event enum (98 types) includes `session.inbox.enqueued`, `session.inbox.delivered`, `session.inbox.cancelled`, `session.inbox.delivery.changed` — user messages travel through the inbox events. Per command run, the observed sequence was: `session.inbox.enqueued` → `session.execution.started` → `session.instructions.updated` → `session.inbox.delivered` → (`session.text.*`/`session.tool.*` on success | `session.execution.failed` on failure).

`session.inbox.enqueued` (verbatim, carries the expanded text):

```json
{ "id": "evt_20005af9500196I77LRke0uutj", "created": 1795296702357, "type": "session.inbox.enqueued", "location": { "directory": "/tmp/opencode/cmd-research/project" }, "data": { "inboxID": "msg_20005af8f001cpozHiuhosR7D4", "sessionID": "ses_dfffa5497ffexq9z2sLZRW7Mr3", "item": { "type": "user", "payload": { "text": "Repeat exactly the following arguments and nothing else: hello world" }, "delivery": "steer" } }, "durable": { "aggregateID": "ses_dfffa5497ffexq9z2sLZRW7Mr3", "seq": 2, "version": 1 } }
```

- `data.inboxID` **equals the persisted user message ID** (`msg_20005af8f001cpozHiuhosR7D4` in both the event and `GET …/message`). [VERIFIED: live v2.3.2]
- `session.inbox.delivered` data (verbatim): `{"sessionID":"ses_dfffa5497ffexq9z2sLZRW7Mr3","inboxID":"msg_20005af8f001cpozHiuhosR7D4"}`. [VERIFIED: live v2.3.2]
- Wire-shape note: the inbox item uses `item.payload.text`, while the persisted message uses flat `text`. A normal-prompt control probe confirmed the same inbox flow for `POST /prompt` (which returns 200 `{data:{id, sessionID, time, type:"user", payload:{text}, delivery:"steer"}}` — also `payload.text`, and the current `sendMessage` discards that response). [VERIFIED: live v2.3.2]
- `delivery: "steer"` was observed on every item; its busy-session steering semantics were not probed. [ASSUMED]
- **Do not synthesize expanded text client-side** (dispatch instruction + authority constraint): map `session.inbox.enqueued` with `item.type === "user"` to a user `ChatMessage` (`id: data.inboxID`, `text: item.payload.text`). Execution output then arrives as ordinary `session.text.*`/`session.tool.*` events the desk already reduces. [VERIFIED: live v2.3.2]

### 8. Async execution failure shape [VERIFIED: live v2.3.2]

With the session pinned to a nonexistent model (POST `/model` accepts it with 204 — no validation), every command run failed fast without any provider network call. `session.execution.failed` data (verbatim):

```json
{ "sessionID": "ses_dfffa5497ffexq9z2sLZRW7Mr3", "error": { "type": "provider.no-route", "message": "Model unavailable: no-such-provider/no-such-model" } }
```

The message list also gained an `idle` bookkeeping message (verbatim): `{"id":"msg_20005b3bd001riUgmdcaNlHMRj","time":{"created":1795296703421},"type":"idle","outcome":"failed","error":{"type":"provider.no-route","message":"Model unavailable: no-such-provider/no-such-model"}}`. `type:"idle"` is **filtered out** by `toChatMessages` on reload (only `user`/`assistant` survive — `src/server/normalize.ts:133-140`), so async failures are invisible in the reloaded thread unless mapped. Today `normalizeEvent` maps `session.execution.failed` → `{type:"status", state:"error", detail}` which the UI renders in the **top error bar**, not the thread (`src/components/desk/app.tsx:90-96`). CMD-02's "failing commands" path must add in-thread surfacing for this case (see Pattern 3). `POST …/interrupt` returned 200 `{"interrupted":false}` when nothing was running. [VERIFIED: live v2.3.2]

## Standard Stack

**Zero new packages — runtime or dev** (locked decision). Everything below is already installed and read in-repo this session.

### Core (existing modules this phase extends)

| Module | Version @ HEAD | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `src/server/opencode-client.ts` | repo | Add `listCommands()` / `runCommand()` + `OpenCodeCommand` wire type | The only place OpenCode endpoints exist (repo invariant, file header lines 1–6) |
| `src/server/api.ts` | repo | Add `GET /api/commands`, `POST /api/sessions/{id}/command` | Route table + validation + redaction boundary |
| `src/server/normalize.ts` | repo | Map `command.updated` → new event; `session.inbox.enqueued` → user message | The only wire→GUI translator |
| `src/lib/desk/client.ts` | repo | `api.commands()`, `api.runCommand()`, `DeskCommand` type, new `DeskEvent` variant | Single browser API surface |
| `src/components/desk/app.tsx` | repo | Composer interception, palette mount, submit fork, in-thread errors | Existing desk shell |
| `src/components/desk/commands.ts` (**new**) | — | Pure `parseCommandDraft` / `filterCommands` + co-located `commands.test.ts` | Repo convention: pure logic testable under `node:test` without RTL |
| `src/components/desk/command-palette.tsx` (**new**) | — | Hand-built APG combobox list above the composer | Locked: no cmdk/Radix/fuse.js |
| React 19.2 / Tailwind 4.3 tokens | `package.json:40-44` | Palette rendering (`bg-elevated`, `border-border`, `text-fg`, `text-muted`, `text-accent` semantic tokens) | Existing UI stack |
| `node:test` + `--experimental-strip-types` | Node ≥22 (machine: v26.13.1) | All new tests | Locked runner |

### Alternatives Considered (all rejected by locked constraints)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-built combobox | `cmdk` / Radix Select | Stack change — explicitly out of scope (REQUIREMENTS.md) |
| Substring filter | `fuse.js` fuzzy search | Stack change; 83 commands don't need fuzzy ranking |
| Server-sourced list | Client-side command registry | Violates OpenCode authority — explicitly out of scope |
| Existing SSE fan-out | Polling `GET /api/command` | Wasteful; `command.updated` exists precisely for invalidation |

**Installation:** none. **Package Legitimacy Audit:** N/A — this phase installs no external packages (no registry checks required).

## Architecture Patterns

### System Architecture Diagram (command path)

```
Composer draft "/name args"
   │  onChange → parseCommandDraft (leading "/" only)
   ▼
CommandPalette ──filter── commands state ◄── api.commands() ◄── GET /api/commands
   │  (open → refetch;                                                  │
   │   commands-changed event → refetch)                                ▼
   │                                          controller api.ts (requireProject + redactSecrets)
   │                                                          │
   │                                                          ▼
   │                                          opencode-client.listCommands()
   │                                          GET /api/command?location[directory]=<project>
   │                                                          │
   │  Enter/Tab on selection                                  ▼
   ▼                                          OpenCode v2.3.2 registry (builtins + plugins + project)
submit() fork: known-or-stale-list "/name"
   │  local echo "/name args" (pending)
   ▼
api.runCommand(id, name, argsOnlyText)
   ▼
POST /api/sessions/{id}/command {name, text}  ──►  OpenCode POST /api/session/{id}/command
   │                                                    │ 204 (fire-and-forget)
   │  HTTP error (404/400/500)                          ▼
   │  → keep echo + append system message      template expansion ($ARGUMENTS ← text)
   │                                                    │
   │◄─────────────── SSE /api/event ────────────────────┤
   │   session.inbox.enqueued {inboxID, item.payload.text = EXPANDED}
   │        → normalize → user message → replace pending command echo
   │   session.execution.started → status working
   │   session.text.* / session.tool.* → existing reducers (assistant output)
   │   session.execution.failed {error{type,message}} → status error
   │        + (command turn) append system message in-thread
   │
   └─ file watcher: .opencode/command/*.md add/edit/remove
          → command.updated {data:{}} → normalize → commands-changed
          → every tab refetches GET /api/commands (CMD-03)
```

### Recommended new/changed files

```
src/server/opencode-client.ts      # + OpenCodeCommand type, listCommands(), runCommand()
src/server/api.ts                  # + GET /api/commands, POST /api/sessions/{id}/command
src/server/normalize.ts            # + command.updated → commands-changed; inbox.enqueued → user message
src/lib/desk/client.ts             # + DeskCommand, api.commands(), api.runCommand(), DeskEvent variant
src/components/desk/commands.ts    # NEW pure parser/filter (+ commands.test.ts)
src/components/desk/command-palette.tsx  # NEW combobox UI
src/components/desk/app.tsx        # composer interception, submit fork, echo replacement, in-thread errors
src/components/desk/messages.ts    # command-echo replacement reducer support
package.json                       # test script: add commands.test.ts to the explicit file list
```

### Pattern 1: Four-layer wiring (unchanged from ARCHITECTURE.md, now live-verified)

**What:** client method → api route → browser client method → UI, built in layer order with tests at each layer.
**Live-verified shapes for each layer:**

```typescript
// PROPOSED — src/server/opencode-client.ts (wire values verified live)
export type OpenCodeCommand = { name: string; description?: string };

async listCommands(directory?: string): Promise<OpenCodeCommand[]> {
  const data = await this.request("GET", "/api/command", { query: locationQuery(directory) });
  return asArray<OpenCodeCommand>(data); // request() already unwraps the {data} envelope
}

async runCommand(
  _directory: string,
  sessionId: string,
  input: { name: string; text: string }, // text = ARGS ONLY; "" allowed, field mandatory
): Promise<void> {
  await this.request("POST", `/api/session/${encodeURIComponent(sessionId)}/command`, {
    body: { name: input.name, text: input.text }, // 204 → request() returns null
  });
}
```

`locationQuery` already produces the verified query key (`src/server/opencode-client.ts:606-608`, verbatim: `return directory ? { "location[directory]": directory } : {};`). Error bodies (`_tag`/`message`) already parse through `errorMessage()` — no changes needed there.

```typescript
// PROPOSED — src/server/api.ts route validation (mirrors send() at api.ts:236-249, minus the empty-text rejection)
const name = typeof body.name === "string" ? body.name.trim() : "";
if (!name) return json(400, { error: "Command name is required" });
const text = typeof body.text === "string" ? body.text : ""; // "" is valid (zero-arg commands)
await runtime.requireClient().runCommand(project.path, id, { name, text });
return json(202, { ok: true }); // Paddy's own convention (send() returns 202); OpenCode itself answered 204
```

`GET /api/commands` should mirror `readOpenCode()`'s degrade-to-empty when disconnected (`src/server/api.ts:271-274` pattern) and pass the list through `redactSecrets(list, secretNeedles(runtime))` per boundary convention — safe for identifier-shaped names once Phase 7's exact-match needles land (07-CONTEXT.md locked decision).

### Pattern 2: Event invalidation requires a new union variant (CMD-03) — AMENDS ARCHITECTURE.md

**What:** `command.updated` must become a browser-visible event. Today it is silently dropped:

- `normalizeEvent` ends with `return null;` for unknown types (`src/server/normalize.ts:361`). [VERIFIED: src/server/normalize.ts:157-362]
- The runtime emits **only** normalized events (`src/server/runtime.ts:296-299`, verbatim):

```ts
await client.subscribeToEvents((raw) => {
  const normalized = normalizeEvent(raw);
  if (normalized) this.emit(normalized);
}, signal);
```

**Therefore:** add one variant to `GuiEvent` (`src/server/normalize.ts:55-66`) and its mirror to `DeskEvent` (`src/lib/desk/client.ts:82-94`) — e.g. `{ type: "commands-changed" }` (proposed name). Map `command.updated` → that variant in `normalizeEvent`; the payload `data: {}` carries nothing, so no fields are needed. Optionally read the envelope's `location.directory` to scope, but the simplest correct behavior is a global invalidation: every tab refetches `GET /api/commands`, which the controller already scopes to the active project. The browser `applyEvent` handles it by refetching (debounced). **ARCHITECTURE.md's "No GuiEvent/DeskEvent union changes" claim holds for command *execution* events only — it is wrong for CMD-03.**

### Pattern 3: Echo reconciliation via `session.inbox.enqueued` — AMENDS ARCHITECTURE.md

**What:** After the 204, the server's expanded user message arrives only via `session.inbox.enqueued` (§ Live Contract 7). Map it in `normalizeEvent`:

```typescript
// PROPOSED — normalize.ts mapping (all wire fields verified live)
if (type === "session.inbox.enqueued") {
  const item = data.item as Record<string, unknown> | undefined;
  const payload = item?.payload as Record<string, unknown> | undefined;
  const inboxId = text(data.inboxID);
  const itemText = typeof payload?.text === "string" ? payload.text : "";
  if (!sessionId || !inboxId || item?.type !== "user" || !itemText) return null;
  return {
    type: "message",
    sessionId,
    message: { id: inboxId, role: "user", text: itemText, created: Date.now(), activity: [] },
  };
}
```

**Why the UI needs more than this mapping:** `mergeMessage` reconciles a pending local echo only when `item.text === message.text` (`src/components/desk/messages.ts:42-50`, verbatim):

```ts
if (message.role === "user") {
  const pendingIndex = list.findIndex(
    (item) => item.pending && item.role === "user" && item.text === message.text && Math.abs(item.created - message.created) < 5000,
  );
```

For commands the server text is the **expanded template**, never equal to the echoed `/name args` — so without extra logic the thread would show *both* bubbles. Recommended: when dispatching a command, mark the pending echo (e.g. track its `tempId` in a ref); when the next user-role `message` event arrives for that session, replace the marked echo regardless of text (small reducer addition in `messages.ts`, unit-tested). For ordinary prompts the existing identical-text match keeps working — and the inbox mapping **fixes the pre-existing stuck-echo bug** (Pitfall 1).

**In-thread errors (CMD-02), three paths:**
1. **Unknown/failing dispatch (HTTP 404/400/500):** catch in the submit fork → keep the `/name args` echo (mark it non-pending) + append a system `ChatMessage` with `err.message` (already `"Command not found: does-not-exist"` thanks to `errorMessage`). Precedent: the PermissionCard denial flow appends thread-level system messages (`src/components/desk/app.tsx:338`). Do NOT reuse `submit()`'s current catch, which deletes the echo, restores the draft, and sets the top error bar (`app.tsx:308-313`).
2. **Unknown name pre-check (client-side):** if the name is absent from a *fresh, non-empty* cached list, surface a system message without a roundtrip (ARCHITECTURE.md's plan). **If the list is empty or stale (cold start), dispatch anyway and let the server's 404 drive the error** — the server is authoritative and this avoids false "unknown" verdicts. Either way the input never becomes prompt text (locked constraint).
3. **Async execution failure (`session.execution.failed` after a successful 204):** today this renders only in the top error bar via the `status` handler (`app.tsx:90-96`). For a command turn, also append a system message with `event.detail` (the `error.message`, e.g. `"Model unavailable: …"`). Minimal scope: track that the current turn was a command dispatch (ref set on dispatch, cleared on next idle/succeeded) and append only then — avoids changing prompt-flow UX.

### Pattern 4: Leading-slash-only parsing (pure module)

**What:** `parseCommandDraft(draft)` triggers only when the trimmed draft starts with `/`; name = first whitespace-delimited token after `/` (must allow `:` and `-` — live names include `rea:audit_residual_unknowns`, `gsd-plan-phase`); args = the remainder (may be `""`). Mid-text slashes (`check /etc/hosts`) are ordinary prompts. `filterCommands(commands, query)` = case-insensitive substring on name (and optionally description). Both pure, co-located `node:test` suite. [VERIFIED: live v2.3.2 for name shapes; ASSUMED for APG keyboard specifics]

### Anti-Patterns to Avoid

- **Synthesizing expanded text client-side:** the template lives in OpenCode; `Command.Info` exposes only `{name, description?}`. The expansion arrives via `session.inbox.enqueued` — render that. (Dispatch instruction + live evidence.)
- **Sending the full `/name args` as `text`:** live counter-probe proved it embeds the slash literally into `$ARGUMENTS` (§ Live Contract 3).
- **Treating an empty command list as "no commands exist":** cold-start race (§ Live Contract 1). Refetch on open + on `command.updated`.
- **Reusing `submit()`'s error catch for commands:** it deletes the user echo and restores the draft — CMD-02 requires the echo to stay with a persistent system error message.
- **Toasting command errors:** locked requirement — in-thread system messages only.
- **Restricting command names to `[a-z-]+`:** breaks colon-namespaced plugin commands (`rea:*`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `$ARGUMENTS` expansion | Client-side template engine | OpenCode's expansion, delivered via `session.inbox.enqueued` | Templates/frontmatter (agent/model/subagent per `Config.CommandEncoded`) live server-side; client has no template access |
| Command registry | Hardcoded/local command list | `GET /api/command?location[directory]=` | Authority constraint; builtins + plugins + project files merge server-side |
| Error message extraction | New `_tag` parser | Existing `errorMessage()` (`opencode-client.ts:621-642`) | Live error bodies' top-level `message` already matches its extraction chain |
| 204/no-body handling | Special-case in new methods | Existing `request()` (`opencode-client.ts:574`) | Already returns `null` on 204 |
| SSE reconnect/backoff | New event loop | Existing `eventLoop` (`runtime.ts:290-321`) | 500 ms→15 s backoff already handles drops |
| Combobox/fuzzy search | cmdk/fuse.js port | Hand-built APG combobox + substring filter | Locked zero-dep decision; ~83 items |

**Key insight:** the command feature is almost entirely *wiring* — the error machinery, envelope unwrap, location scoping, SSE hub, and reducers all exist. The genuinely new logic is the parser/filter, the palette UI, two normalize mappings, and the echo-replacement reducer.

## Common Pitfalls

### Pitfall 1: Pre-existing stuck pending echo blocks the composer (verified in code — fix within Phase 9)
**What goes wrong:** After any send, the optimistic user bubble stays `pending: true` forever; `submit()` and the Enter handler guard on `messages.some((m) => m.pending)` (`app.tsx:278`, `:591`), and the Send button disables on it (`app.tsx:608`) — so a second send is blocked until the session is re-opened (`openSession` refetch is the only path that replaces messages).
**Why it happens:** v2.3.2 delivers user messages via `session.inbox.enqueued` (live-verified; no `session.message.*` events exist), `normalizeEvent` drops it (`normalize.ts:361`), and `mergeMessage`'s pending reconciliation (`messages.ts:42-50`) therefore never fires. Zero `inbox` references exist in `src/` (grep this session).
**How to avoid:** Phase 9's `session.inbox.enqueued` → user-message mapping (Pattern 3) fixes prompts and commands together. Add a `normalize.test.ts` fixture and a `messages.test.ts` reconciliation test.
**Warning signs:** Send button stays disabled after a completed turn; duplicate user bubbles after reload.
[VERIFIED: src/components/desk/app.tsx:275-314,589-608 + src/components/desk/messages.ts:27-53 + src/server/normalize.ts:157-362 + live v2.3.2 event capture; user-visible impact inferred from code, not browser-tested this session]

### Pitfall 2: Cold-start empty palette / false "unknown command"
**What goes wrong:** First `GET /api/command` after project activation returns `[]`; a palette opened then shows nothing, and a client-side unknown-name check rejects valid commands.
**Why it happens:** Registry scan completes asynchronously; `command.updated` marks completion (live timestamps in § Live Contract 1).
**How to avoid:** Refetch on every palette open; refetch (debounced) on `commands-changed`; when the cached list is empty, dispatch to the server and surface its 404 rather than pre-rejecting.
**Warning signs:** Palette empty right after switching projects, populated seconds later.
[VERIFIED: live v2.3.2]

### Pitfall 3: Duplicate user bubbles after command dispatch
**What goes wrong:** The `/name args` echo and the server's expanded user message both render.
**Why it happens:** `mergeMessage` matches pending echoes by identical text; expanded text never matches.
**How to avoid:** Pattern 3's marked-echo replacement. Test in `messages.test.ts`.
[VERIFIED: src/components/desk/messages.ts:42-50 + live v2.3.2]

### Pitfall 4: `command.updated` silently dropped (CMD-03 fails without a union change)
**What goes wrong:** Palette never refreshes on file add/remove; no error anywhere — the event just vanishes.
**Why it happens:** `normalizeEvent` → `null` → `eventLoop` skips emission (runtime.ts:296-299).
**How to avoid:** Pattern 2's new variant + mapping + `applyEvent` refetch. Verify with the live hot-reload procedure (§ Validation Architecture).
[VERIFIED: src/server/runtime.ts:296-299 + src/server/normalize.ts:361 + live v2.3.2]

### Pitfall 5: Async command failures invisible in the thread
**What goes wrong:** Dispatch succeeds (204) but execution fails (e.g. provider error); the user sees only the top error bar, and nothing persists in the thread (`idle` outcome messages are filtered out on reload).
**Why it happens:** `session.execution.failed` → status error bar only (`app.tsx:90-96`); `toChatMessages` keeps only `user`/`assistant` (`normalize.ts:133-140`).
**How to avoid:** Pattern 3 path 3 — append a system message for command turns on `status` error.
[VERIFIED: live v2.3.2 + src/server/normalize.ts:133-140 + src/components/desk/app.tsx:90-96]

### Pitfall 6: Copying `send()`'s validation rejects zero-arg commands
**What goes wrong:** `send()` does `const text = typeof body.text === "string" ? body.text.trim() : ""; if (!text) return json(400, ...)` (`api.ts:238-239`). Copying that verbatim for the command route makes `/name` (no args) impossible.
**How to avoid:** Require `name` non-empty; accept `text` as any string including `""` (live-verified accepted; missing field is the only 400).
[VERIFIED: src/server/api.ts:236-249 + live v2.3.2]

### Pitfall 7: Redaction dependency ordering (V2-03)
**What goes wrong:** Routing command lists through `redactSecrets` before Phase 7 lands risks the known substring-needle corruption (`security.ts:164-166`: `if (out.includes(needle)) out = out.split(needle).join("[redacted]");`). Command names/descriptions are string *values* (keys `name`/`description` don't match `SECRET_KEY` at `security.ts:156`), so only a literal-password substring could corrupt them — low risk, but the locked ordering exists for a reason.
**How to avoid:** Phase 9 executes after Phase 7 (exact-match needles + round-trip fixtures). Add a command-route round-trip case to `api.test.ts` (identifier-shaped name like `gsd-plan-phase` survives byte-identical with a registered needle present).
[VERIFIED: src/server/security.ts:156-184 + CITED: .planning/phases/07-v2-hardening-foundation/07-CONTEXT.md]

### Pitfall 8: Palette keyboard handling collides with the composer
**What goes wrong:** Enter submits the prompt instead of running the selected command; ArrowUp/Down scroll the textarea; Esc loses the draft.
**Why it happens:** The textarea's `onKeyDown` currently intercepts Enter unconditionally (`app.tsx:589-598`).
**How to avoid:** When the palette is open, intercept ArrowUp/Down/Enter/Tab/Escape *before* the submit path; Esc closes the palette but keeps `draft` untouched (draft is plain `useState` at `app.tsx:35` — palette open/close must never call `setDraft`). APG combobox specifics carried from milestone research. [VERIFIED: src/components/desk/app.tsx:585-602 for current handling; ASSUMED for APG key contract details]

## Code Examples

### Browser client additions (proposed; wire values live-verified)

```typescript
// src/lib/desk/client.ts
export type DeskCommand = { name: string; description?: string };
// DeskEvent union gains: | { type: "commands-changed" }

commands: () => request<{ commands: DeskCommand[] }>("/api/commands"),
runCommand: (id: string, name: string, text: string) =>
  request("/api/sessions/" + encodeURIComponent(id) + "/command", {
    method: "POST",
    body: JSON.stringify({ name, text }), // text = args only, "" allowed
  }),
```

### Submit fork (proposed skeleton inside `app.tsx submit()`)

```typescript
const parsed = parseCommandDraft(draft); // null unless trimmed draft starts with "/"
if (parsed) {
  // palette/list pre-check is an optimization only; empty/stale list → dispatch anyway
  setDraft("");
  const tempId = `local_${Date.now()}`;
  // echo the RAW input; mark it as a command echo for replacement (Pattern 3)
  setMessages((current) => [...current,
    { id: tempId, role: "user", text: draft.trim(), created: Date.now(), activity: [], pending: true }]);
  commandEchoRef.current = { sessionId: id, tempId };
  try {
    await api.runCommand(id, parsed.name, parsed.args); // args-only, live-verified
  } catch (err) {
    // CMD-02: keep the echo, append a persistent system message — NOT the top-bar/toast path
    setMessages((current) => [
      ...current.map((m) => (m.id === tempId ? { ...m, pending: false } : m)),
      { id: `sys_${Date.now()}`, role: "system",
        text: err instanceof Error ? err.message : "Command failed",
        created: Date.now(), activity: [] },
    ]);
    setWorking(false);
  }
  return;
}
// ...existing prompt path unchanged
```

### `command.updated` mapping (proposed; payload live-verified as `data: {}`)

```typescript
// src/server/normalize.ts, inside normalizeEvent
if (type === "command.updated") return { type: "commands-changed" };
```

```typescript
// src/components/desk/app.tsx applyEvent (debounced refetch)
if (event.type === "commands-changed") { scheduleCommandRefetch(); return; }
```

## Contradictions / Amendments to `.planning/research/ARCHITECTURE.md`

| # | ARCHITECTURE.md claim | Live/code finding | Plan impact |
|---|----------------------|-------------------|-------------|
| 1 | "No `GuiEvent`/`DeskEvent` union changes" | True for execution events; **false for CMD-03** — `command.updated` normalizes to `null` and is never emitted (runtime.ts:296-299) | Add one variant + mapping (Pattern 2) |
| 2 | "local echo identical (pending user message with the full `/name args` text)" | Incomplete: expanded server text arrives via `session.inbox.enqueued` (currently dropped) and never text-matches the echo (messages.ts:42-50) | Add inbox mapping + marked-echo replacement (Pattern 3); also fixes pre-existing stuck-echo bug |
| 3 | "Unknown `/name`: reject client-side … no roundtrip" | Viable only with a fresh non-empty list; cold-start `[]` makes pure client-side rejection falsely reject valid commands | Pre-check as optimization; server-authoritative 404 fallback (Pattern 3 path 2) |
| 4 | "`{name, text}` — both required, `additionalProperties: false` (verified against published OpenAPI)" | Local OpenAPI agrees, but adds optional `files`/`agents`/`skills`/`delivery`; **runtime tolerates extra props anyway** (204 with `arguments` extra) | Send only `{name, text}`; don't rely on extra-field rejection |
| 5 | Command execution "output arrives as ordinary session.text.*/session.tool.* SSE" | Confirmed — but the **user** message of the turn arrives via inbox events, and async failure via `session.execution.failed` (top-bar only today) | In-thread error path for command turns (Pattern 3 path 3) |

Everything else in the integration map (method names, route paths, `location[directory]` scoping, `Command.Info = {name, description?}`, 202 Paddy-route convention, four-layer order) was confirmed accurate.

## State of the Art

| Published OpenAPI (newer server, per SUMMARY.md) | Local v2.3.2 (live-captured this session) | Impact |
|--------------|------------------|--------|
| `{name, text}` body, `additionalProperties: false` [CITED: .planning/research/SUMMARY.md] | Same required fields + optional `files`/`agents`/`skills`/`delivery`; extra props tolerated at runtime [VERIFIED: live v2.3.2] | Minimal body remains correct |
| Command shapes MEDIUM pending capture [CITED: .planning/STATE.md] | Now captured: 204 success; flat `_tag` error bodies; `CommandNotFoundError` 404 [VERIFIED: live v2.3.2] | Confidence raised to HIGH |
| — | No `session.message.*` events; user messages via `session.inbox.*` (98-type enum) [VERIFIED: live v2.3.2] | Echo reconciliation must use inbox events |

**Deprecated/outdated:** the v1 `properties`-based event envelope (already migrated; v2 payload is in `data` — re-confirmed live).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | WAI-ARIA APG combobox keyboard contract specifics (Enter/Tab run-or-complete, Esc dismiss, aria-activedescendant) carried from milestone research, not re-fetched this session | Patterns 4 / Pitfall 8 | Low — UX polish; keyboard behavior adjustable in UI tasks |
| A2 | `delivery: "steer"` semantics (steering a busy session) — literal value observed, behavior under concurrent execution not probed | Live Contract 7 | Low — Phase 9 sends no `delivery` field; desk guards on `working` |
| A3 | Cold-start mechanism = lazy async registry scan triggered by project activation (behavior verified, mechanism inferred) | Live Contract 1 / Pitfall 2 | Low — mitigation (refetch on open + event) works regardless of mechanism |
| A4 | Phase 7 (exact-match redaction, hermetic test gate) executes before Phase 9 per roadmap order; Phase 7 code not yet at HEAD | User Constraints / Pitfall 7 | Medium — if ordering changes, redaction round-trip fixtures must land inside Phase 9 first |
| A5 | User-visible impact of the stuck-pending-echo bug (composer blocked after first send) inferred from verified code paths; not browser-tested this session | Pitfall 1 | Low — mechanism is code-verified; the fix (inbox mapping) is required for commands regardless |

## Open Questions

1. **Echo display policy:** replace the `/name args` echo with the server's expanded text (recommended — matches what reload shows, single source of truth) vs. keep the raw echo and suppress the inbox user message for command turns (live/reload inconsistency). Recommendation: replace; planner locks the reducer shape.
2. **Unknown-name UX wording:** system message text for client-side pre-rejection vs. server 404 (`"Command not found: X"`). Recommendation: reuse the server message verbatim in both paths for consistency.
3. **Async-failure surfacing scope:** command-turn-only system message (recommended, minimal) vs. mapping `session.execution.failed` to in-thread system messages for all flows (changes prompt UX — broader than CMD-02). Recommendation: command-turn-only via a dispatch ref.
4. **Stuck-echo fix ownership:** the inbox mapping fixes a pre-existing prompt-flow bug inside Phase 9's diff. Flag to orchestrator/reviewer so the broader-than-commands effect is expected, not scope creep.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `opencode` binary | Live contract verification (Phase 10 VER-05) | ✓ | v2.3.2 (`~/.opencode/bin/opencode`) | — |
| Live OpenCode server :4096 | Desk runtime / live checks | ✓ (listening; auth required — 401 unauthenticated) | 2.3.2 | Throwaway server recipe below |
| Node.js | `node:test` with `--experimental-strip-types` | ✓ | v26.13.1 (≥22 required) | — |
| npm | test/lint/typecheck scripts | ✓ | per codebase/STACK.md: 12.2.1 | — |
| Playwright (devDep) | Optional keyboard-path QA | ✓ (installed, not wired into `npm test`) | ^1.62.0 (`package.json:61`) | Manual keyboard QA |

**Missing dependencies with no fallback:** none. **Missing with fallback:** none.

**Throwaway-server recipe (reusable for Phase 10 live verification):** generate a password with `node:crypto` into a 0600 file; spawn `opencode serve --hostname 127.0.0.1 --port <ephemeral>` with `OPENCODE_SERVER_USERNAME=opencode` + `OPENCODE_SERVER_PASSWORD=<generated>` in env (never echo it); poll auth'd `GET /api/info` until 200; probe; `DELETE` scratch sessions; kill the PID; confirm the port is released. Never read `~/.paddy/state.json` or reuse the live server's password. Working scripts from this session: `/tmp/opencode/cmd-research/{launch,probe,contract,semantics,hotreload,sse-logger}.mjs` (ephemeral).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node v26.13.1, `--experimental-strip-types` for TS suites) — locked, zero new deps |
| Config file | none — `npm test` runs an **explicit file list** (`package.json:22`, verbatim): `node --test scripts/install.sh.test.mjs scripts/link-cli.test.mjs scripts/with-app-env.test.mjs && node --experimental-strip-types --test src/server/security.test.ts src/server/http.test.ts src/server/opencode-client.test.ts src/server/api.test.ts src/server/runtime.test.ts src/server/normalize.test.ts src/server/state.test.ts src/components/autonomous-drink.test.ts src/components/desk/messages.test.ts` |
| Quick run command | `node --experimental-strip-types --test src/components/desk/commands.test.ts` |
| Full suite command | `npm test` (gate: green after Phase 7's V2-01 hermetic fix) |

**New test files must be added to the `package.json` test script by name** — the runner does not glob.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CMD-01 | `listCommands()` hits `GET /api/command?location[directory]=…`, unwraps `{data}`, tolerates missing `description` | unit (mock fetch) | `node --experimental-strip-types --test src/server/opencode-client.test.ts` | ✅ extend (mockFetch pattern at lines 5–17) |
| CMD-01 | `GET /api/commands` route: project required, redaction round-trip (`gsd-plan-phase` byte-identical), degrade-to-empty when disconnected | unit (fake runtime) | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ extend (`runtimeWithProject()` at line 11) |
| CMD-01 | `parseCommandDraft` leading-`/`-only; colon/hyphen names; mid-text slash → null; `filterCommands` substring | unit | `node --experimental-strip-types --test src/components/desk/commands.test.ts` | ❌ Wave 0 (new module + suite) |
| CMD-01 | Palette keyboard path (↑/↓/Enter/Tab/Esc), draft survives open/close | manual / Playwright | `node scripts/browser-smoke.mjs` (extend; not in `npm test`) | ✅ script exists, extend |
| CMD-02 | `runCommand()` POSTs `{name, text}`; 204→null; 404 `CommandNotFoundError` body → `OpenCodeError(404, "Command not found: does-not-exist")`; 400 missing-text body | unit (mock fetch) | `node --experimental-strip-types --test src/server/opencode-client.test.ts` | ✅ extend |
| CMD-02 | Route validation: empty name → 400; `text: ""` accepted → 202; non-string text → 400 | unit (fake runtime) | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ extend |
| CMD-02 | Submit fork: args-only text sent; error keeps echo + appends system message (no draft restore, no top-bar-only) | unit (reducer) + manual | `node --experimental-strip-types --test src/components/desk/messages.test.ts` + live desk check | ✅ extend |
| CMD-02 | `session.inbox.enqueued` (user item) → user message; expanded text replaces marked command echo; prompt echo still reconciles | unit | `node --experimental-strip-types --test src/server/normalize.test.ts src/components/desk/messages.test.ts` | ✅ extend |
| CMD-02 | `session.execution.failed` on a command turn → in-thread system message | unit + manual | normalize/messages suites + live desk check | ✅ extend |
| CMD-03 | `command.updated` (`data: {}`) → `commands-changed` GuiEvent; unknown events still null | unit | `node --experimental-strip-types --test src/server/normalize.test.ts` | ✅ extend |
| CMD-03 | Hot add/edit/remove of `.opencode/command/*.md` refreshes the open palette without reload | manual (live) | Procedure below | ❌ manual-only (filesystem watcher + SSE; no hermetic fixture possible without a live server) |

**Live CMD-03 procedure (manual, ~2 min):** with the desk open on a project, `touch` a new `.opencode/command/probe.md` (frontmatter `description:` + body) → palette refetches within ~1–3 s and lists `probe`; edit its description → list updates; delete it → list drops it. Verified server-side this session (events + list deltas captured); the browser leg is the Phase 9/10 check.

### Sampling Rate
- **Per task commit:** quick run of the touched suite(s) (each < 30 s).
- **Per wave merge:** `npm test` + `npm run typecheck` + `npm run lint`.
- **Phase gate:** full suite green (post-Phase 7 hermetic gate) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/components/desk/commands.ts` + `commands.test.ts` — new pure parser/filter module (covers CMD-01 parsing, CMD-02 dispatch fork logic)
- [ ] `package.json` test script — append `src/components/desk/commands.test.ts` to the explicit list
- [ ] Fixtures in existing suites: `CommandNotFoundError`/`InvalidRequestError` bodies + 204 (opencode-client.test.ts); `{location, data:[{name},{name,description}]}` envelope (api.test.ts); `command.updated` with `data:{}` and `session.inbox.enqueued` with `item.payload.text` (normalize.test.ts); marked-echo replacement (messages.test.ts)
- [ ] Framework install: none — `node:test` present

## Security Domain

`security_enforcement: true`, ASVS level 1 (`.planning/config.json:49-51`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited, unchanged) | Browser↔controller: loopback socket + Host check / `OPENCODE_WEB_TOKEN` (`security.ts:44-78`); controller↔OpenCode: Basic auth, password never leaves the controller |
| V3 Session Management | no (new) | Existing HttpOnly token cookie unchanged; no new session surface |
| V4 Access Control | yes | Command routes go through `requireProject()` → `validateWorkspacePath` allowlist (`api.ts:392-398`); `location[directory]` derived only from the allowlisted active project, never from browser input; session ID validated by OpenCode (404 `SessionNotFoundError`) |
| V5 Input Validation | yes | `readBody`/`safeJson` at the boundary; `name` non-empty string, `text` string (allow `""`); reject non-strings; no shell interpolation anywhere in Paddy (name/text travel as JSON to OpenCode's registry lookup) |
| V6 Cryptography | no (new) | No new crypto; `timingSafeEqual` token compare unchanged |

### Known Threat Patterns for this surface

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-site command dispatch (CSRF-style) | Tampering | Existing `originAllowed` Origin==Host check on every `/api` request (unchanged) |
| Secret leakage via command descriptions/errors | Information disclosure | `redactSecrets(list, secretNeedles(runtime))` on the new GET route (Phase 7 exact-match needles); error messages already flow through `errorResult`; never echo the OpenCode password |
| XSS via command name/description rendering | Tampering | React text interpolation only (auto-escaped); no `dangerouslySetInnerHTML` in the palette |
| Path traversal via `location` | Elevation of privilege | Directory sourced exclusively from the allowlisted active project (`requireProject`), not request input |
| Refetch storm from `command.updated` bursts | Denial of service | Debounce the browser refetch (bursts of 9 events observed live); controller route is a single light GET |
| Malicious/malformed SSE payloads | Spoofing | Defensive narrowing in `normalizeEvent` (existing convention: `text()`/`stringField` guards, unknown → null) |

## Sources

### Primary (HIGH confidence)
- **Live throwaway OpenCode v2.3.2 server** (127.0.0.1:43217, spawned/killed this session): own `/openapi.json` (OpenAPI 3.1.0, "Experimental HttpApi surface"); live captures of `GET /api/command` (cold + warm + scoped), `POST …/command` (args-only, zero-arg, whitespace, unknown, missing-text, extra-prop, unknown-session), `GET …/message` expansions, `POST …/prompt` control, `POST …/interrupt`, and `/api/event` SSE (9 `command.updated`, 5 inbox/enqueued+delivered pairs, 5 `session.execution.failed`). Evidence files: `/tmp/opencode/cmd-research/{openapi-local.json,semantics-results.json,hotreload-results.json,events.jsonl}`.
- **Repo read this session at HEAD `e6b5088`:** `src/server/opencode-client.ts` (full), `src/server/api.ts` (full), `src/server/normalize.ts:1-369`, `src/server/runtime.ts:240-359` + spawn/env grep, `src/server/security.ts:1-80,150-184`, `src/lib/desk/client.ts` (full), `src/components/desk/app.tsx:35-147,255-329,570-619` + greps, `src/components/desk/messages.ts` (full), `src/server/opencode-client.test.ts:1-40`, `src/server/api.test.ts` (grep), `package.json` (full), `.planning/config.json` (full).

### Secondary (MEDIUM confidence)
- `.planning/V2-MIGRATION-SPEC.md` — live-captured v2 migration contract (envelope, scoping, event names); re-confirmed where overlapping.
- `.planning/research/{SUMMARY,ARCHITECTURE}.md` — plan of record; amendments listed above.
- `.planning/phases/07-v2-hardening-foundation/07-CONTEXT.md` — locked redaction ordering.
- `.planning/{REQUIREMENTS,STATE}.md` — requirements, blockers, locked decisions.

### Tertiary (LOW confidence)
- None new. APG keyboard specifics inherited from milestone research (Assumptions Log A1).

## Metadata

**Confidence breakdown:**
- Command contract (endpoints, bodies, errors, events): **HIGH** — captured live from the exact installed version (v2.3.2), not the published spec.
- Integration map / repo facts: **HIGH** — read in code this session with line citations; two ARCHITECTURE.md claims amended with evidence.
- UX keyboard details: **MEDIUM** — carried from milestone research, not re-verified (A1).

**Research date:** 2026-11-21
**Valid until:** contract is version-pinned to OpenCode **v2.3.2** — re-capture on any OpenCode upgrade (the published OpenAPI targets a newer server and already diverges on optional body fields). Repo facts valid until Phase 7/8 land (they touch `api.ts`, `state.ts`, `security.ts`, `runtime.ts`).
