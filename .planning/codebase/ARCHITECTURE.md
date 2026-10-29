---
last_mapped_commit: d358aee016758bde70bd5b2782a5b1ebf27b6aba
last_mapped_at: 2026-10-29
---
<!-- refreshed: 2026-10-29 -->
# Architecture

**Analysis Date:** 2026-10-29

## System Overview

Paddy is a **single-process, local-first web desk for OpenCode**. One Node process serves both the React UI (TanStack Start / SSR) and the `/api` controller that talks to a separately-running `opencode serve` HTTP server. There is no separate backend service, no database, and no build-time API layer — the controller is mounted as Vite middleware in dev/preview and as a Nitro middleware in a Vercel build.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (React 19 + TanStack Router/Start, Tailwind v4)              │
│  `src/routes/__root.tsx` · `src/routes/index.tsx`                    │
│  `src/components/desk/app.tsx` (DeskApp) · `desk/settings.tsx`       │
│  `src/lib/desk/client.ts` (typed fetch wrapper + EventSource)        │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │ fetch /api/*                     │ EventSource /api/events
                ▼                                  ▲
┌──────────────────────────────────────────────────┴───────────────────┐
│ Controller HTTP layer (same process)                                 │
│  `src/server/http.ts`   Node adapter, peer auth, origin check        │
│  `src/server/api.ts`    Route table + request validation             │
│  `src/server/security.ts` path allowlist, redaction, bearer token    │
└───────────────┬──────────────────────────────────▲───────────────────┘
                │ calls                            │ emits GuiEvent
                ▼                                  │
┌──────────────────────────────────────────────────┴───────────────────┐
│ Runtime supervisor (module singleton)                                │
│  `src/server/runtime.ts`  detect/spawn/attach OpenCode, SSE loop,    │
│                           subscriber fan-out, connection status      │
│  `src/server/state.ts`    ~/.paddy/state.json (GUI metadata only)    │
│  `src/server/normalize.ts` OpenCode events → GUI event shapes        │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTP + SSE (Basic auth)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ OpenCode server (`opencode serve`, 127.0.0.1:4096 or discovered)     │
│  `src/server/opencode-client.ts` is the only adapter to it           │
│  Owns sessions, messages, models, providers, MCP, permissions, files │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| CLI wrapper | `paddy` command: start dev server, update, uninstall, doctor | `bin/paddy.mjs` |
| Dev/build harness | Injects env, runs Vite, owns preview port 8081 | `scripts/with-app-env.mjs`, `scripts/preview.mjs` |
| Vite plugin host | Mounts `/api` middleware, PWA plugin, TanStack Start, Nitro (build) | `vite.config.ts` |
| Router | Creates TanStack router from generated tree | `src/router.tsx`, `src/routeTree.gen.ts` |
| Root layout | HTML shell, head/meta, Toaster, preview bridge mount | `src/routes/__root.tsx` |
| Desk UI | Whole chat/project/session UI and event reducer | `src/components/desk/app.tsx` |
| Settings UI | Nine settings sections (connection, providers, agents, MCP, …) | `src/components/desk/settings.tsx` |
| Browser API client | Typed `api.*` methods, `DeskEvent` types, token→cookie bootstrap | `src/lib/desk/client.ts` |
| Node adapter | Node req/res → Web `Request`, auth, SSE write-out | `src/server/http.ts` |
| API router | All `/api/*` routes, body validation, error mapping | `src/server/api.ts` |
| Runtime supervisor | Find/spawn/attach OpenCode, reconnect loop, event fan-out | `src/server/runtime.ts` |
| OpenCode adapter | All HTTP calls to `opencode serve` (single place) | `src/server/opencode-client.ts` |
| Event normalizer | OpenCode part/event types → `GuiEvent`/`ChatMessage` | `src/server/normalize.ts` |
| Security boundary | Peer auth, origin check, workspace allowlist, secret redaction | `src/server/security.ts` |
| Persistence | Atomic JSON state at `~/.paddy/state.json`, `publicState()` | `src/server/state.ts` |
| Mascot | Sprite-frame animation + autonomous idle/drink scheduler | `src/components/paddy-mascot.tsx`, `paddy-idle.tsx`, `autonomous-drink.ts`, `use-autonomous-drink.ts` |
| Production PWA middleware | Nitro/h3 middleware for manifest, install page, head injection | `server/middleware/grok-pwa.ts`, `scripts/grok-pwa-shared.mjs` |

## Pattern Overview

**Overall:** Local BFF (backend-for-frontend) + SSR SPA in one process, with an explicit server/client type boundary and an event-driven (SSE) UI.

**Key Characteristics:**
- **One process owns everything.** `vite.config.ts` mounts `src/server/http.ts` on every `/api*` request via `opencodeControllerPlugin()`. There is no `server/index.ts` HTTP server.
- **Controller is the security boundary.** The browser never reads files, runs shell, or sees the OpenCode password. Only `src/server/*` touches `node:fs`, `node:child_process`, and the OpenCode API.
- **OpenCode is the source of truth.** Sessions, messages, models, provider credentials, MCP, and permissions live in OpenCode. Paddy persists only bookmarks/appearance/passwords in `~/.paddy/state.json` (`src/server/state.ts:1-5`).
- **Events, not polling.** A single SSE subscription to OpenCode `/global/event` is normalized and fanned out to every browser subscriber (`src/server/runtime.ts:256-294`, `src/server/api.ts:371-384`).
- **Runtime singleton.** `getRuntime()` returns one `ControllerRuntime` per process (`src/server/runtime.ts:354-359`). Tests construct their own instance with a temp state file.
- **No shared type package.** Client types are mirrored in `src/lib/desk/client.ts`; server types in `src/server/normalize.ts`. The browser must not import server modules (they import `node:*`).

## Layers

**Presentation (browser):**
- Purpose: Render the desk, reduce streamed events into message state, collect user intent.
- Location: `src/routes/`, `src/components/`, `src/lib/desk/client.ts`, `src/lib/utils.ts`, `src/styles.css`
- Contains: Route files, React components, Tailwind theme tokens, fetch wrapper.
- Depends on: `/api` only (HTTP + SSE). No `node:*` imports.
- Used by: the browser.

**Controller transport:**
- Purpose: Translate Node HTTP ↔ Web `Request`/`Response`, enforce auth/origin, stream SSE.
- Location: `src/server/http.ts`
- Contains: `handleNode`, header/cookie helpers, JSON serialization, stream pump.
- Depends on: `security.ts`, `api.ts`, `runtime.ts`.
- Used by: `vite.config.ts` middleware (dev + preview) and tests (`src/server/api.test.ts`).

**Controller API:**
- Purpose: Route table, input validation, project allowlist enforcement, response shaping.
- Location: `src/server/api.ts`
- Contains: `handleApi` and per-route handlers.
- Depends on: `runtime.ts`, `normalize.ts`, `security.ts`, `state.ts`, `opencode-client.ts`.
- Used by: `http.ts`.

**Runtime supervision:**
- Purpose: Own the OpenCode connection lifecycle (detect binary → probe → spawn → attach → reconnect with exponential backoff), hold subscribers.
- Location: `src/server/runtime.ts`
- Contains: `ControllerRuntime`, `ConnectionStatus`, `getRuntime()`.
- Depends on: `opencode-client.ts`, `normalize.ts`, `state.ts`.
- Used by: `api.ts`, `http.ts`.

**Integration adapter:**
- Purpose: The only place that knows OpenCode's HTTP surface (`/session`, `/config`, `/provider`, `/mcp`, `/permission`, `/question`, `/global/event`, …).
- Location: `src/server/opencode-client.ts`
- Contains: `OpenCodeClient`, `OpenCodeError`, OpenCode wire types.
- Depends on: global `fetch` only (injectable for tests).
- Used by: `runtime.ts`, `api.ts`.

**Domain normalization:**
- Purpose: Convert OpenCode part/event/session shapes into GUI shapes; build diffs and date groups.
- Location: `src/server/normalize.ts`
- Contains: `GuiEvent`, `ChatMessage`, `SessionSummary`, `DiffFile`, `PermissionPrompt`, `normalizeEvent`, `toChatMessage`, `toDiffFile`, `groupSessionsByDate`.
- Depends on: OpenCode wire types from `opencode-client.ts`.
- Used by: `runtime.ts`, `api.ts`.

**Security & persistence (cross-cutting):**
- Purpose: Authorization, path allowlisting, secret redaction; atomic state file.
- Location: `src/server/security.ts`, `src/server/state.ts`
- Contains: `authorizePeer`, `originAllowed`, `validateWorkspacePath`, `redactSecrets`, `readState`/`writeState`/`publicState`.
- Depends on: `node:fs`, `node:path`.
- Used by: `http.ts`, `api.ts`, `runtime.ts`.

## Data Flow

### Primary bootstrap path (first paint)

1. Browser loads `/`; TanStack Start renders `DeskApp` (`src/routes/index.tsx:4-8`).
2. `useEffect` calls `api.bootstrap()` → `GET /api/bootstrap` (`src/components/desk/app.tsx:118-152`, `src/lib/desk/client.ts:121`).
3. Vite middleware `opencodeControllerPlugin` matches `/api` and calls `handleNode` (`vite.config.ts:169-190`).
4. `handleNode` authorizes the socket peer and origin, converts to a `Request`, and calls `handleApi(getRuntime(), request)` (`src/server/http.ts:11-44`).
5. `handleApi` matches `GET /bootstrap` → `bootstrap()` → `ensureStatus()` → `runtime.connect()` (`src/server/api.ts:29,62-98`).
6. `runtime.connect()` detects the `opencode` binary, probes `http://127.0.0.1:4096`, or spawns `opencode serve --hostname 127.0.0.1 --port <free>` with a generated `ocw_*` password (`src/server/runtime.ts:100-163`).
7. `bootstrap()` lists sessions and reads config through `runtime.requireClient()` (`src/server/api.ts:75-88`), normalizes them (`normalize.ts`), and returns `publicState()` (no passwords) plus sessions/groups/model (`src/server/state.ts:103-112`).
8. `DeskApp` stores bootstrap data, sets `document.documentElement.dataset.theme`, strips `?token=` from the URL, and opens `new EventSource("/api/events")` (`src/components/desk/app.tsx:121-146`).

### Live event path (agent working)

1. `runtime.attach()` starts `startEventLoop()` (`src/server/runtime.ts:182,256-261`).
2. `OpenCodeClient.subscribeToEvents` streams `GET /global/event` and parses SSE frames (`src/server/opencode-client.ts:299-340`).
3. Each raw event goes through `normalizeEvent()` → `GuiEvent` (`src/server/normalize.ts:137-251`).
4. `runtime.emit()` fans out to subscribers; connection status changes also emit `{type:"connection"}` (`src/server/runtime.ts:70-78`).
5. `GET /api/events` creates a `ReadableStream` that writes `data: <json>\n\n` per event (`src/server/api.ts:371-384`).
6. `handleNode` pumps the stream to the Node response as `text/event-stream` (`src/server/http.ts:45-63`).
7. Browser `EventSource.onmessage` parses `DeskEvent` and calls `applyEvent`, which merges `text-delta`, `activity`, `message`, `permission`, `session`, `status`, `diff` into React state (`src/components/desk/app.tsx:55-116`).

### Send / abort / retry

1. Composer `submit()` optimistically appends a local user message, then `POST /api/sessions/:id/messages` (`src/components/desk/app.tsx:250-279`).
2. `api.send` splits `provider/model` on the first `/` (`src/server/api.ts:409-413`) and calls `client.sendMessage` → `POST /session/:id/prompt_async` (`src/server/opencode-client.ts:132-148`). Returns `202`; the actual reply arrives via SSE.
3. `stop()` → `POST /api/sessions/:id/abort` → `client.abortSession`.
4. `retry()` deletes the last assistant message (best-effort) and re-sends the last user text (`src/server/api.ts:248-263`).

### Permission / question replies

1. OpenCode `permission.asked` / `question.asked` events normalize to `{type:"permission"}` prompts (`src/server/normalize.ts:180-219`).
2. UI renders `PermissionCard`; `api.reply(id, reply, {sessionId, kind, message})` → `POST /api/permissions/:id/reply` (`src/components/desk/app.tsx:299-302`).
3. `replyPermission` validates `once|always|reject`; questions use `replyQuestion`/`rejectQuestion`, permissions use `client.replyPermission` with a legacy-session-endpoint fallback on 404/400 (`src/server/api.ts:350-369`, `src/server/opencode-client.ts:244-265`).

**State Management:**
- Browser: local React `useState`/`useRef` inside `DeskApp` (no Redux/Zustand/react-query in use, despite `@tanstack/react-query` being a dependency). Streaming state is reduced by pure helpers `appendDelta`, `upsertActivity`, `mergeMessage`, `upsertSession` (`src/components/desk/app.tsx:788-819`).
- Server: one mutable `AppState` object per runtime, persisted on every mutation via `runtime.persist()` (`src/server/state.ts:60-71`).
- OpenCode: authoritative for everything else.

## Key Abstractions

**`ControllerRuntime` (`src/server/runtime.ts:34-318`):**
- Purpose: Lifecycle owner for the OpenCode connection + subscriber hub.
- Pattern: Module singleton with injectable state file for tests; serialized connect via a stored promise (`connecting`) to avoid double-spawn.
- Key invariant: `ownedServerPassword` survives restarts so a spawned server can be re-attached (`runtime.ts:52-58,144-148`).

**`OpenCodeClient` (`src/server/opencode-client.ts:64-386`):**
- Purpose: Thin, typed-ish HTTP adapter; no invented endpoints.
- Pattern: Every method calls private `request()`, which builds query params, applies Basic auth, maps non-2xx to `OpenCodeError(status, message, retryable)` (`opencode-client.ts:350-385`). `fetch` is injectable for tests.

**`GuiEvent` / `DeskEvent` (`src/server/normalize.ts:54-65`, `src/lib/desk/client.ts:81-93`):**
- Purpose: The contract between controller and UI. `DeskEvent` = `GuiEvent` + the `connection` variant.
- Pattern: Discriminated union on `type`; UI switch in `applyEvent`.

**`AppState` vs `publicState()` (`src/server/state.ts:21-33,103-112`):**
- Purpose: Separate what the controller stores from what the browser may see.
- Pattern: Explicit projection — `connectionPassword` and `ownedServerPassword` are omitted; only `hasConnectionPassword` is exposed.

**`validateWorkspacePath` (`src/server/security.ts:70-105`):**
- Purpose: A project must be an absolute, existing directory, and (for session routes) inside the configured allowlist after `realpath` resolution.
- Pattern: Resolve → stat → realpath → prefix check with `sep` to prevent `/foo` matching `/foobar`.

**`redactSecrets` (`src/server/security.ts:118-143`):**
- Purpose: Strip credential-shaped keys and known secret values from anything returned by OpenCode or diagnostics.
- Pattern: Recursive walk with key regex + literal needle replacement.

**Autonomous mascot scheduler (`src/components/autonomous-drink.ts:57-122`):**
- Purpose: Framework-agnostic idle↔drink state machine with injected clock/random for deterministic tests.
- Pattern: Dependency-injected timers; React wiring in `src/components/use-autonomous-drink.ts`; enablement flags in `src/components/paddy-animations.ts`.

## Entry Points

**CLI (`bin/paddy.mjs`):**
- Triggers: `paddy`, `paddy start|update|uninstall|doctor|--version`.
- Responsibilities: Validate Node ≥ 22, resolve state dir (`PADDY_HOME` → `~/.paddy` → `~/.config/opencode-web`), exec `npm run dev -- --host 127.0.0.1 --port 8080`.

**Vite dev/preview server (`vite.config.ts`):**
- Triggers: `npm run dev`, `npm run preview` (via `scripts/with-app-env.mjs`).
- Responsibilities: Mount `/api` middleware, PWA plugin, TanStack Start, React, Tailwind. Binds 8080 (dev) / 8081 (preview); refuses non-loopback bind without `OPENCODE_WEB_TOKEN` (`vite.config.ts:193-201`).

**TanStack Start router (`src/router.tsx:5-7`):**
- Triggers: SSR request and client hydration.
- Responsibilities: `createRouter({ routeTree, defaultErrorComponent: AppErrorComponent })`. Route tree is generated into `src/routeTree.gen.ts`.

**Nitro production middleware (`server/middleware/grok-pwa.ts`):**
- Triggers: `vite build` with `nitro({preset:"vercel", serverDir:"./server"})`.
- Responsibilities: `/__grok/manifest.webmanifest`, `?install=1` tutorial page, streaming `<head>` injection (PWA/OG tags).

**Tests:**
- `node --test` against `src/server/*.test.ts` and `src/components/autonomous-drink.test.ts` (see `package.json` `test` script).

## Architectural Constraints

- **Threading:** Single-threaded Node event loop. One OpenCode SSE reader per runtime; one SSE `ReadableStream` per browser tab. No workers.
- **Global state:** `let singleton: ControllerRuntime | null` in `src/server/runtime.ts:354`; `getRuntime()` is the only accessor. All `/api` requests share it, so state changes are process-global.
- **Process boundary:** Browser code must not import `src/server/*` (they import `node:fs`, `node:child_process`). Types are duplicated by design in `src/lib/desk/client.ts`.
- **Auth model:** Loopback socket peer → allowed without token. Non-loopback requires `OPENCODE_WEB_TOKEN` as `Authorization: Bearer` or `?token=` (exchanged for an HttpOnly `paddy_token` cookie) (`src/server/http.ts:15-37`, `src/server/security.ts:27-47`).
- **Origin model:** If `Origin` is present it must equal `Host`; missing Origin is allowed for non-browser clients (`src/server/security.ts:50-60`).
- **Dev-first runtime:** The Docker image runs `npm run dev` (see `Dockerfile` `CMD`), and `/api` is mounted by a Vite plugin, not a standalone server. The Nitro/Vercel path only adds PWA middleware; there is no separate production API server.
- **Generated file:** `src/routeTree.gen.ts` is generated by TanStack Router; edits are overwritten and it is excluded from ESLint.
- **OpenCode path coupling:** All endpoint paths live in `src/server/opencode-client.ts`; adding a feature means adding a client method, an `api.ts` route, a `client.ts` method, and (if streamed) a `normalize.ts` mapping.

## Anti-Patterns

### Duplicated types across the server/client boundary

**What happens:** `DeskEvent` in `src/lib/desk/client.ts:81-93` re-declares `ChatMessage`, `ActivityItem`, `SessionSummary`, `DiffFile`, `PermissionPrompt`, and `ConnectionStatus` already defined in `src/server/normalize.ts:8-65` and `src/server/runtime.ts:19-30`.
**Why it's wrong:** Adding an event variant or field requires edits in two files with no compiler link; drift shows up as silently dropped fields in the UI.
**Do this instead:** When changing a wire shape, update both `src/server/normalize.ts` and `src/lib/desk/client.ts` in the same change. Prefer moving shared shapes into a `node:`-free module under `src/lib/` and importing it from both sides.

### Business logic inside a monolithic component

**What happens:** `DeskApp` (`src/components/desk/app.tsx`, 824 lines) holds 25+ `useState` hooks, the entire event reducer, all API orchestration, and the whole layout. `SettingsPanel` (`src/components/desk/settings.tsx`, 564 lines) inlines nine section components.
**Why it's wrong:** Any change to one flow re-renders the whole desk and risks unrelated state; helpers like `groupByDate` and `upsertSession` are untestable outside the component file.
**Do this instead:** Add new flows as hooks or modules under `src/lib/desk/` (e.g. a `useDeskEvents` reducer module) and keep components presentational. Existing pure helpers at `app.tsx:770-819` are the model to follow.

### Re-implementing server helpers in the client

**What happens:** Session date grouping exists twice — `groupSessionsByDate` in `src/server/normalize.ts:267-282` and `groupByDate` in `src/components/desk/app.tsx:775-786`.
**Why it's wrong:** Labels and ordering can diverge between bootstrap payload and client-side re-grouping after a `session` event.
**Do this instead:** Use the server-provided `groups` from `/api/bootstrap` and `/api/sessions`, or move the grouping into a shared `src/lib/` module.

### Untyped passthrough of OpenCode payloads

**What happens:** `readOpenCode` returns `unknown` for `/providers`, `/agents`, `/mcp`, `/vcs`, `/files/status` (`src/server/api.ts:265-290`), and the UI casts ad hoc (`agentNames` at `app.tsx:821-824`, `settings.tsx` provider/agent shapes).
**Why it's wrong:** A change in OpenCode's response shape fails at runtime in the browser, not at the controller boundary.
**Do this instead:** Declare response types in `src/server/opencode-client.ts` next to the client method, narrow in `api.ts`, and mirror the narrowed shape in `client.ts`.

### Dead scaffold wired into the build

**What happens:** `vite.config.ts` imports `./scripts/migration-plan.mjs` and defines plugins that `ssrLoadModule("/src/lib/db.ts")` and `"/src/lib/auth/popup.server.ts"`; neither module exists in this repo. `tsconfig.json` excludes `src/lib/harness/setup-model-picker.test.mjs`, which also does not exist.
**Why it's wrong:** The plugins are inert only because their code paths are never hit (no `migrations/` dir, no `/auth/popup` request). A stray request or directory makes them throw inside Vite middleware.
**Do this instead:** Remove the unused plugins/imports from `vite.config.ts`, or keep them behind an existence check like `hasGlobbedMigrations()` already does. Do not add files named `src/lib/db.ts` or `src/lib/auth/popup.server.ts` without understanding this wiring.

### `window.prompt` for product flows

**What happens:** Adding a project (`app.tsx:191`), renaming a chat (`app.tsx:410`), and answering a question prompt (`app.tsx:703`) all use blocking `window.prompt`.
**Why it's wrong:** Not styleable, not testable, and blocks the event loop while an SSE stream is live.
**Do this instead:** Use the existing `Input`/`Button` primitives from `src/components/ui/` inside a dialog component, following the inline `PermissionCard` pattern (`app.tsx:671-715`).

## Error Handling

**Strategy:** Errors are typed at the OpenCode boundary, mapped to HTTP status at the API boundary, surfaced as strings in the UI, and as `{type:"error"}` events for async failures.

**Patterns:**
- `OpenCodeError(status, message, retryable)` is the only thrown server error type; `errorResult` maps status `0 → 503` and includes `retryable` (`src/server/api.ts:419-425`, `src/server/opencode-client.ts:46-55`).
- `handleApi` wraps the entire route table in one `try/catch`; route handlers throw instead of returning errors (`src/server/api.ts:27-59`).
- `runtime.requireClient()` throws `OpenCodeError(503, …, retryable=true)` when disconnected (`src/server/runtime.ts:312-317`).
- Connection failures emit `{type:"connection", status}` with `error`; the UI shows a reconnect bar, or a password form when `authRequired` (`app.tsx:56-63,465-503`).
- The SSE loop reconnects with exponential backoff 500 ms → 15 s and re-emits healthy status on success (`src/server/runtime.ts:263-294`).
- Router-level render errors use `AppErrorComponent` (`src/lib/error-component.tsx`, wired in `src/router.tsx`).
- Client `request()` throws `Error(data.error || "Request failed (<status>)")`; callers set local `error` state (`src/lib/desk/client.ts:95-107`).

## Cross-Cutting Concerns

**Logging:** `console.error` only, in the Vite middleware wrappers (`vite.config.ts:79,143,181`). No logger module, no levels, no request logging. `/api/diagnostics` returns a redacted snapshot for support (`src/server/api.ts:100-110`).

**Validation:** Hand-rolled narrowing in `api.ts` (`typeof x === "string"`, `Array.isArray`) plus `safeJson`; `zod` is used only for the preview postMessage bridge (`src/lib/preview-host-bridge.ts:22-44`). No schema library at the API boundary.

**Authentication:** Two distinct layers — (1) browser→controller: peer address + optional bearer/cookie token + origin check (`src/server/http.ts`, `src/server/security.ts`); (2) controller→OpenCode: HTTP Basic with `connectionUsername`/`connectionPassword` or the generated `ownedServerPassword` (`src/server/opencode-client.ts:342-348`).

**Secrets:** `connectionPassword`/`ownedServerPassword` never leave the controller (`publicState`); every OpenCode read path is passed through `redactSecrets` with `secretNeedles(runtime)` (`src/server/api.ts:269-299,415-417`).

**Theming:** CSS custom properties in `src/styles.css` (`@theme` + `[data-theme="light"]`), switched by setting `document.documentElement.dataset.theme` from `appearance` (`app.tsx:129,425-428`).

---

*Architecture analysis: 2026-10-29*
