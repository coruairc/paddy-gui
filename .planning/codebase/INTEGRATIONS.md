---
last_mapped_commit: d358aee016758bde70bd5b2782a5b1ebf27b6aba
last_mapped_at: 2026-10-29
---
# External Integrations

**Analysis Date:** 2026-10-29

## APIs & External Services

**OpenCode local HTTP API (primary integration):**
- Paddy is a local web client for OpenCode. Every model, session, tool, file, and provider operation is delegated to an `opencode serve` process over HTTP.
- Base URL resolution (`src/server/runtime.ts:108-163`):
  1. `OPENCODE_URL` env var, or the URL saved in Settings → Connection (`state.connectionUrl`).
  2. Probe `http://127.0.0.1:4096` and attach if healthy.
  3. Otherwise spawn `opencode serve --hostname 127.0.0.1 --port <4096 or free port>` (`src/server/runtime.ts:227-254`).
- Client: hand-written `OpenCodeClient` in `src/server/opencode-client.ts` using global `fetch`. No OpenCode SDK package is installed.
- Auth to OpenCode: HTTP Basic (`username:password`, default username `opencode`). The password is either generated (`ocw_<48 hex>`), read from `OPENCODE_SERVER_PASSWORD`, or stored in controller state. Sent only server-side (`src/server/opencode-client.ts:342-348`).

Endpoints consumed (all relative to the OpenCode base URL):

| Method | Path | Used for | Code |
|---|---|---|---|
| GET | `/global/health` | Connection probe / version | `src/server/opencode-client.ts:87` |
| GET | `/global/event` | SSE event stream | `src/server/opencode-client.ts:299` |
| GET/POST | `/session` | List / create sessions | `src/server/opencode-client.ts:91-103` |
| GET/PATCH/DELETE | `/session/{id}` | Read / rename / archive / delete | `src/server/opencode-client.ts:105-130` |
| POST | `/session/{id}/prompt_async` | Send a user turn | `src/server/opencode-client.ts:132` |
| POST | `/session/{id}/abort` | Stop a run | `src/server/opencode-client.ts:150` |
| GET/DELETE | `/session/{id}/message[/{messageId}]` | Message history / delete for retry | `src/server/opencode-client.ts:156-169` |
| GET | `/session/{id}/diff` | Changed files | `src/server/opencode-client.ts:171` |
| GET/PATCH | `/config` | Read/update OpenCode config (model, agents, MCP) | `src/server/opencode-client.ts:177-190` |
| GET | `/provider`, `/provider/auth` | Provider + auth status | `src/server/opencode-client.ts:192-198` |
| PUT/DELETE | `/auth/{providerId}` | Store/remove provider API keys (forwarded, never persisted by Paddy) | `src/server/opencode-client.ts:200-208` |
| GET | `/agent` | Agent list | `src/server/opencode-client.ts:210` |
| GET/POST | `/mcp`, `/mcp/{name}/connect`, `/mcp/{name}/disconnect` | MCP server status/control | `src/server/opencode-client.ts:214-235` |
| GET | `/permission` | Pending permission prompts | `src/server/opencode-client.ts:237` |
| POST | `/permission/{id}/reply` (fallback `/session/{id}/permissions/{id}`) | Allow/always/reject | `src/server/opencode-client.ts:244-265` |
| GET/POST | `/question`, `/question/{id}/reply`, `/question/{id}/reject` | Interactive questions | `src/server/opencode-client.ts:267-285` |
| GET | `/vcs`, `/file/status` | Branch + working-tree status | `src/server/opencode-client.ts:287-293` |

**Model provider APIs:**
- No direct integration. Paddy does not call OpenAI, Anthropic, Google, xAI, DeepSeek, or any model endpoint. Provider credentials and model routing belong to OpenCode; Paddy forwards key writes to OpenCode's `/auth/{providerId}` and redacts them from responses (`src/server/api.ts:302-316`, `src/server/security.ts:115-143`).

**Platform / Grok chrome (browser-facing, inherited from the app-builder template):**
- Google Fonts stylesheet — IBM Plex Sans/Mono, Instrument Serif (`src/routes/__root.tsx:28`, also `docs/index.html`).
- `https://grok.com/grok-app-builder/extensions.js` — injected into deployed HTML documents (`scripts/grok-pwa-shared.mjs:203`, `:450`).
- `https://og.grok.me` — default Open Graph image service (`scripts/grok-pwa-shared.mjs:10`, overridable with `VITE_OG_SERVICE_URL`).
- Per-app PWA manifest served locally at `/__grok/manifest.webmanifest` (`server/middleware/grok-pwa.ts:73`, dev equivalent in `scripts/grok-pwa-plugin.mjs`).
- Grok preview host bridge — `postMessage` protocol (`grok-preview-bridge`, version 1) between the app and an allowlisted parent frame on `*.grok.com`, `*.grok-sandbox.com`, or `*.preview.*` remint pairs (`src/lib/preview-host-bridge.ts`, `src/lib/preview-embedder-origin.ts`). Messages: `hello`, `navigate`, `history`, `connector-token-ready`. No network calls; origin-gated `postMessage` only.

**Install / distribution endpoints:**
- `https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh` and `install.ps1` (`README.md`, `install.sh`, `install.ps1`).
- `https://github.com/coruairc/paddy-gui.git` — clone target and `paddy update` source (`install.sh:242`, `bin/paddy.mjs:126`).
- `https://nodejs.org/dist/latest-v22.x/...` — Node download when the installer auto-installs Node (`install.sh:152-158`).
- `https://opencode.ai/install` — OpenCode install command documented in README and run inside `Dockerfile:23`.
- `registry.npmjs.org` via `npm install` / `npm ci` (`Dockerfile:34`).
- `ghcr.io/coruairc/paddy-gui` — published container image (`docker-compose.yml:12`, `.github/workflows/publish-image.yml`).

## Data Storage

**Databases:**
- None. No database client, ORM, or migration is installed or executed by the app.
- `scripts/migrate.mjs` references `DATABASE_URL` and `pg` (node-postgres) but `pg` is absent from the lockfile and the script is not invoked by any npm script. `vite.config.ts` contains a PGLite bootstrap plugin whose `src/lib/db.ts` target does not exist and whose `migrations/` directory is absent. Treat all of this as dead template scaffolding.

**File Storage:**
- Local JSON state at `$OPENCODE_WEB_HOME/state.json`, default `~/.paddy/state.json` (`src/server/state.ts:45-49`). Contains project bookmarks, active project, appearance, connection URL/username, connection password, and controller-owned server password. Written atomically (temp file + rename) with mode `0600`; directory `0700` (`src/server/state.ts:60-71`).
- `PADDY_HOME` selects the state directory for the `paddy` CLI; `OPENCODE_WEB_HOME` overrides it for the controller (`bin/paddy.mjs:21-23`, `src/server/state.ts:46`).
- Docker compose maps host `./paddy-data` to `/state` (`docker-compose.yml:24-25`).
- OpenCode owns sessions, messages, diffs, provider keys, and config; Paddy stores none of them.

**Caching:**
- None. Responses are sent with `cache-control: no-store` (`src/server/http.ts:70`); PWA/manifest responses use `no-cache`.

## Authentication & Identity

**Auth Provider:**
- None (no Better Auth, Auth.js, Clerk, or OAuth provider in code, despite `vite.config.ts` retaining an `authPopupPlugin` and `.grok/app-env.json` setting `VITE_AUTH_ENABLED=false`).
- Two independent auth boundaries:
  1. **Browser → controller:** loopback peers are trusted; non-loopback peers require `OPENCODE_WEB_TOKEN` as a Bearer token (`src/server/security.ts:27-47`, `src/server/http.ts:18-30`). A one-time `?token=` URL value is exchanged for an `HttpOnly; SameSite=Strict; Path=/` cookie named `paddy_token` (`src/server/http.ts:35-37`), then stripped from the address bar client-side (`src/components/desk/app.tsx:126-129`). Cross-origin browser requests are rejected by comparing `Origin` to `Host` (`src/server/security.ts:50-60`).
  2. **Controller → OpenCode:** HTTP Basic with a generated or configured password (`src/server/runtime.ts:165-170`).

**Workspace authorization:**
- Absolute directory paths only; must exist and be a directory; later calls are checked against the project bookmark allowlist via realpath (`src/server/security.ts:70-105`, `src/server/api.ts:390-396`).

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, OpenTelemetry, or equivalent dependency.

**Logs:**
- `console.error` in Vite plugins and the Node adapter (`vite.config.ts`, `src/server/http.ts`), plus `console.log` in `scripts/migrate.mjs`. No structured logging library.
- Diagnostics endpoint `GET /api/diagnostics` returns version, connection status, and project counts, passed through `redactSecrets` (`src/server/api.ts:100-110`).

## CI/CD & Deployment

**Hosting:**
- Primary: self-hosted local process or Docker container (`Dockerfile`, `docker-compose.yml`).
- Secondary: Vercel via Nitro preset `vercel` (`vite.config.ts:216-226`); prebuilt output committed under `.vercel/output/`.

**CI Pipeline:**
- GitHub Actions `.github/workflows/publish-image.yml` — on push to `main`, `v*` tags, or manual dispatch: checkout, GHCR login with `GITHUB_TOKEN`, buildx setup, metadata tagging (`latest`, semver), build and push `ghcr.io/<repo>` with GHA cache.
- No test, lint, or typecheck job in CI.

## Environment Configuration

**Required env vars:**
- None for default loopback use. OpenCode is auto-detected and spawned.

**Optional env vars (actually read by code):**
- `OPENCODE_WEB_HOST` — bind host; non-loopback requires `OPENCODE_WEB_TOKEN` (`vite.config.ts:184-192`).
- `OPENCODE_WEB_TOKEN` — Bearer token / one-time URL token for remote access (`src/server/http.ts`).
- `OPENCODE_WEB_HOME` — state directory override (`src/server/state.ts:46`).
- `OPENCODE_URL` — attach to an existing OpenCode server (`src/server/runtime.ts:116-127`).
- `OPENCODE_BIN` — explicit OpenCode binary path (`src/server/runtime.ts:81`).
- `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` — credentials for an existing OpenCode server (`src/server/runtime.ts:165-170`).
- `PADDY_HOME`, `PADDY_BIN_DIR` — CLI state dir and wrapper install dir (`bin/paddy.mjs:20-23`).
- `VITE_PUBLIC_HOSTNAME`, `VITE_OG_SERVICE_URL`, `VITE_AUTH_ENABLED`, `VITE_PROJECT_ID`, `X_CREATOR`, `X_CREATOR_ID`, `GROK_PROJECT_ID` — build/platform chrome (`scripts/grok-pwa-shared.mjs`, `src/lib/env.server.ts`).
- `DATABASE_URL` — read only by the unused `scripts/migrate.mjs`.

**Documented but not read by code:**
- `selfhost.env.example` lists `XAI_API_KEY`, `OPENAI_API_KEY`, `CHATGPT_*`, `ANTHROPIC_*`, `GOOGLE_API_KEY`, `KIMI_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_API_KEY`, `ZAI_API_KEY`, `GLM_API_KEY`, `DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `POOLSIDE_API_KEY`, `OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `HF_TOKEN`, `OLLAMA_HOST`, `OLLAMA_MODEL`, channel tokens, webhook secrets, memory/embedding settings, and OpenClaw gateway settings. None of these names appear in `src/`, `server/`, or `scripts/`. They belong to the older harness described in `SELFHOST.md`, which does not match the current OpenCode-client code.

**Secrets location:**
- Process environment for `OPENCODE_WEB_TOKEN` and OpenCode credentials.
- `~/.paddy/state.json` (mode `0600`) for the OpenCode connection password.
- OpenCode's own credential store for provider API keys; Paddy only forwards them and redacts secret-shaped fields (`src/server/security.ts:115-143`).
- `selfhost.env` and `config.json` are git-ignored.

## Webhooks & Callbacks

**Incoming:**
- None. There is no `/api/hooks/*` route in `src/server/api.ts`, despite `selfhost.env.example` mentioning WhatsApp/Telegram/Slack webhook secrets.

**Outgoing:**
- No webhooks. Outbound traffic is limited to the local OpenCode HTTP/SSE connection and the install/update URLs listed above.
- Browser-side: `EventSource("/api/events")` for the server-sent event stream (`src/components/desk/app.tsx:134`), all REST calls to same-origin `/api/*` (`src/lib/desk/client.ts:118-172`), and `postMessage` to an allowlisted Grok parent frame.

---

*Integration audit: 2026-10-29*
