---
last_mapped_commit: d358aee016758bde70bd5b2782a5b1ebf27b6aba
last_mapped_at: 2026-10-29
---
# Codebase Concerns

**Analysis Date:** 2026-10-29

## Priority Summary

| # | Concern | Severity | Primary file |
|---|---------|----------|--------------|
| 1 | Loopback trust + `Host`-derived `localOnly` bypasses token auth (DNS rebinding, reverse proxy) | High | `src/server/http.ts:25`, `src/server/security.ts:33` |
| 2 | Docker/Compose state volume is dead (`PADDY_HOME` never read) | High | `docker-compose.yml:23`, `src/server/state.ts:46` |
| 3 | ~3,500 lines of app-builder template scaffolding still wired into the build | High | `vite.config.ts`, `scripts/`, `src/lib/preview-host-bridge.ts` |
| 4 | `SELFHOST.md` + `selfhost.env.example` document a product that does not exist | High | `SELFHOST.md`, `selfhost.env.example` |
| 5 | `install.sh` downloads a Node tarball without verifying the checksum | High | `install.sh:150` |
| 6 | No CI for tests/lint; `npm run lint` fails and a committed test is stale/broken | High | `.github/workflows/`, `install.sh.test.mjs` |
| 7 | Spawned `opencode serve` child is orphaned on process exit (no signal handling) | Medium | `src/server/runtime.ts:230`, `src/server/runtime.ts:301` |
| 8 | Optimistic user message never reconciles → duplicate chat bubbles | Medium | `src/components/desk/app.tsx:270` |
| 9 | Settings → Connection "Save" silently wipes a stored password | Medium | `src/components/desk/settings.tsx:132` |
| 10 | 29 Radix packages + 8 heavy libraries installed but unused | Medium | `package.json` |

---

## Tech Debt

**App-builder template scaffolding (~3,500 lines) wired into the real build:**
- Issue: The repo is a fork of a hosted app-builder template. Large subsystems for Grok sandbox previews, OAuth popups, PGLite, Postgres migrations, brand/OG gating, and browser smoke tests remain and some are still executed.
- Files: `vite.config.ts`, `scripts/app-env-plugin.mjs`, `scripts/check-auth-invariant.mjs`, `scripts/grok-pwa-plugin.mjs`, `scripts/grok-pwa-shared.mjs`, `scripts/browser-smoke.mjs`, `scripts/browser-smoke-verdict.mjs`, `scripts/brand-check.mjs`, `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `scripts/pack-selfhost.mjs`, `scripts/sign-out-plan.mjs`, `scripts/write-atomic.mjs`, `scripts/preview.mjs`, `scripts/preview-thumbnail.mjs`, `server/middleware/grok-pwa.ts`, `src/lib/preview-host-bridge.ts`, `src/lib/preview-embedder-origin.ts`, `src/components/preview-host-bridge.tsx`, `src/lib/env.server.ts`, `src/lib/og/site.json`
- Impact: Every build mounts `grokPwaPlugin()` (`vite.config.ts:213`), which injects "Grok" PWA/OG chrome and defaults to `DEFAULT_APP_NAME = "Grok App"` and `og.grok.me` (`scripts/grok-pwa-shared.mjs:6-8`). `PreviewHostBridge` is mounted in the root route (`src/routes/__root.tsx:38`) and pulls `zod` into the client bundle. Deploys also run the Nitro `server/middleware/grok-pwa.ts` middleware. This is dead weight, an unexplained outbound-reference surface, and a constant source of lint noise.
- Fix approach: Delete the template subsystems in one change, or move them under `legacy/` and remove them from `vite.config.ts` plugin list and `__root.tsx`. Keep `scripts/with-app-env.mjs`, `scripts/link-cli.mjs`, `scripts/preview.mjs` only if they are still wanted.

**`vite.config.ts` defines two plugins that reference files which do not exist:**
- Issue: `pgliteBootstrapPlugin` (`vite.config.ts:34`) loads `/src/lib/db.ts`; `authPopupPlugin` (`vite.config.ts:65`) loads `/src/lib/auth/popup.server.ts`. Neither file, nor `migrations/`, exists. Both functions are defined and never used (ESLint warns `pgliteBootstrapPlugin is defined but never used`, `authPopupPlugin is defined but never used`).
- Files: `vite.config.ts:34-140`, `tsconfig.json` (comment references `src/lib/db.ts`)
- Impact: Dead code that will throw the moment someone "re-enables" it; ~110 lines of misleading context; `tsconfig.json` comment documents a file that is absent.
- Fix approach: Delete both plugin factories and the stale `tsconfig.json` comment.

**`scripts/migrate.mjs` imports a package that is not a dependency:**
- Issue: `scripts/migrate.mjs:18` does `import pg from "pg"`, but `pg` is not in `package.json`. The script is not referenced by any npm script.
- Files: `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `package.json`
- Impact: If run (or wired into a build), it fails at import time with `ERR_MODULE_NOT_FOUND`.
- Fix approach: Delete, or add `pg` and a `migrate` script if migrations are actually wanted.

**Dead code and no-op expressions in the server:**
- Issue:
  - `src/server/api.ts:78` — `filter((item) => !item.archived || true)` is a no-op; archived sessions are returned in `bootstrap.sessions` and only filtered client-side.
  - `src/server/api.ts:169` — `const search = undefined;` then passed to `listSessions(project.path, search)`.
  - `src/server/api.ts:74` — `let agent = ""` is never reassigned and always returned empty (`Bootstrap` in `src/lib/desk/client.ts` does not even declare `agent`).
  - `src/server/normalize.ts:181` — `(props.permission ? props : (props as { id?: string }).id ? props : props)` — all three branches return `props`.
- Files: `src/server/api.ts`, `src/server/normalize.ts`
- Impact: Readers cannot tell intent from code; `agent` is a permanently empty field in the API contract; the no-op filter hides the real archived-handling rule.
- Fix approach: Remove the dead expressions; decide explicitly whether `bootstrap` should return archived sessions and encode that once.

**Unused helpers and UI components:**
- Issue: `uid`, `formatRelative`, `formatDate`, `formatTokens` in `src/lib/utils.ts` have zero call sites. `src/components/ui/badge.tsx` is never imported.
- Files: `src/lib/utils.ts`, `src/components/ui/badge.tsx`
- Impact: Small, but signals the UI kit was scaffolded rather than used; `uid` uses `Math.random()` and would be a poor id source if adopted.
- Fix approach: Delete, or use them.

**Three identical installer copies plus two divergent tests:**
- Issue: `install.sh`, `docs/install.sh`, `public/install.sh` are byte-identical (md5 `8bf1006…`); same for the three `install.ps1` copies. `install.sh.test.mjs` (repo root) and `scripts/install.sh.test.mjs` have drifted apart.
- Files: `install.sh`, `docs/install.sh`, `public/install.sh`, `install.ps1`, `docs/install.ps1`, `public/install.ps1`, `install.sh.test.mjs`, `scripts/install.sh.test.mjs`
- Impact: Any installer fix must be made in three places or the GitHub Pages/`public` copies silently rot. The root test asserts `paddy gateway`, `--no-onboard`, and `Paddy installed successfully, Sláinte🍀` — none of which exist — so it fails if anyone runs it.
- Fix approach: Generate `docs/` and `public/` copies from the root file in a script, delete the stale root test, keep one test in `scripts/`.

**Documentation drift (actively misleading):**
- `SELFHOST.md` (9.8 KB) documents `paddy gateway`, `paddy chat`, `paddy models`, `paddy skills`, `paddy memory`, `paddy channels`, `paddy approve`, a Telegram/Discord/Slack/WhatsApp bridge, and `~/.paddy/gateway.pid`. `bin/paddy.mjs` implements only `start`, `update`, `uninstall`, `doctor`, `help`, `--version`. Files: `SELFHOST.md`, `bin/paddy.mjs:57-152`
- `selfhost.env.example` lists `PADDY_CLI_TOKEN`, `PADDY_BIND`, `PADDY_OUTBOUND_*`, `PADDY_RECALL_LIMIT`, `OPENCLAW_*`, `TELEGRAM_BOT_TOKEN`, … — no code reads any of them. Files: `selfhost.env.example`
- `README.md:28` says "Set `PADDY_HOME` to override" state; `README.md:167` says `OPENCODE_WEB_HOME` overrides it; only `OPENCODE_WEB_HOME` is read by `src/server/state.ts:46`, and `PADDY_HOME` is only translated in `bin/paddy.mjs:22`. `install.sh:12` assigns `PREFIX="${PADDY_HOME:-…}"` and never uses it.
- `README.md` claims "The header model menu lists models OpenCode reports, grouped by provider" — there is no header model menu; model selection lives in Settings → Providers (`src/components/desk/settings.tsx:203`).
- Fix approach: Delete `SELFHOST.md` + `selfhost.env.example` or rewrite them to the real surface; unify on one state-dir env var and document it once.

**`npm run lint` fails on the committed tree:**
- Issue: `npx eslint .` reports 2 errors and 7 warnings (run 2026-10-29):
  - `bin/paddy.mjs:152` — `Unreachable code` (`void rest;` after a `switch` whose cases all exit)
  - `src/server/api.ts:74` — `'agent' is never reassigned. Use 'const' instead`
  - warnings: `react-hooks/exhaustive-deps` at `src/components/desk/settings.tsx:246,441,474`; unused `pgliteBootstrapPlugin`/`authPopupPlugin` in `vite.config.ts`; `react-refresh/only-export-components` in `src/components/paddy-mascot.tsx:95` and `src/components/ui/button.tsx:45`
- Files: `bin/paddy.mjs`, `src/server/api.ts`, `src/components/desk/settings.tsx`, `vite.config.ts`
- Impact: The lint gate is red, so it cannot be used as a pre-commit/CI signal, and new violations are indistinguishable from known ones.
- Fix approach: Fix the two errors, then either fix or explicitly disable the warnings.

**`tsconfig.json` excludes a file that does not exist:**
- Issue: `"exclude": ["src/lib/harness/setup-model-picker.test.mjs"]` refers to a removed template file.
- Files: `tsconfig.json`
- Fix approach: Drop the exclude entry.

---

## Known Bugs

**Compose/Docker state volume never receives state:**
- Symptoms: `docker compose up` documents `./paddy-data:/state` for persistence, but project bookmarks/appearance/passwords are written to `/root/.paddy/state.json` inside the container and lost on recreate.
- Files: `docker-compose.yml:23`, `Dockerfile:57`, `src/server/state.ts:46`, `bin/paddy.mjs:22`
- Trigger: Run the container with the compose file, add a project, recreate the container.
- Cause: Compose sets `PADDY_HOME=/state`; the container CMD is `npm run dev` (not `bin/paddy.mjs`), so nothing maps `PADDY_HOME` → `OPENCODE_WEB_HOME`, which is the only variable `stateFilePath()` reads.
- Workaround: Set `OPENCODE_WEB_HOME=/state` in the compose environment instead.
- Fix approach: Rename the variable everywhere to `PADDY_HOME` (and read it in `stateFilePath`), or change compose to `OPENCODE_WEB_HOME`.

**Settings → Connection "Save" wipes a stored password and URL:**
- Symptoms: A user with a saved OpenCode password opens Settings → Connection (fields initialize empty at `src/components/desk/settings.tsx:114-116`) and presses Save; the stored password is replaced with `""`, and the connection URL with whatever is in the empty field.
- Files: `src/components/desk/settings.tsx:114-135`, `src/server/api.ts:143-156`
- Trigger: Save with the password field blank while `state.connectionPassword` is non-empty.
- Cause: `updateSettings` assigns `connectionPassword` and `connectionUrl` unconditionally (`src/server/api.ts:151-153`); the UI has no "leave blank to keep" semantics and does not preload `hasConnectionPassword`.
- Fix approach: Only overwrite when the client explicitly signals a change (e.g. `passwordChanged: true`), and show "a password is saved" state in the UI.

**Optimistic user message is never reconciled → duplicate bubbles:**
- Symptoms: Sending a message appends a local `local_<timestamp>` message, then OpenCode's `message.updated` event adds the same user turn under its real `msg_…` id. The thread shows the user's message twice.
- Files: `src/components/desk/app.tsx:268-272`, `src/components/desk/app.tsx:737-744` (`mergeMessage`), `src/server/normalize.ts:97-107`
- Trigger: Send any message and wait for the server event.
- Cause: `mergeMessage` dedupes only by exact `id`; there is no optimistic-id → server-id mapping and no text/time heuristic.
- Fix approach: Keep a pending map of local ids, or drop the optimistic bubble once a `role: "user"` message with the same text arrives; ideally echo the created message id from `POST /messages`.

**Spawned OpenCode server is orphaned on controller exit:**
- Symptoms: Ctrl+C (or `docker stop`) leaves `opencode serve` running on 127.0.0.1:4096, holding the generated password that is still persisted in `state.json`.
- Files: `src/server/runtime.ts:230-250`, `src/server/runtime.ts:290-310`, `src/server/state.ts:30-35`
- Trigger: Start Paddy (controller spawns OpenCode), then terminate the controller with a signal.
- Cause: No `SIGINT`/`SIGTERM`/`beforeExit` handler exists anywhere in `src/` or `bin/` (verified: zero matches); only `disconnect()` via the API kills the child. `child.kill()` also signals only the direct child, not the process group.
- Fix approach: Register signal handlers in `bin/paddy.mjs`/`runtime.ts` that call `disconnect()`, spawn with `detached: true` and kill the negative pid, and clear `ownedServerPassword` once the child is gone.

**`reset` leaves a running child and a persisted server password:**
- Symptoms: "Reset local application settings" clears projects/appearance/`connectionPassword` but keeps `ownedServerPassword` and does not stop the OpenCode child it started.
- Files: `src/server/api.ts:196-204`, `src/server/state.ts:96-120`
- Trigger: Settings → General → Reset.
- Cause: `reset()` mutates only four fields; it never calls `runtime.disconnect()`.
- Fix approach: Route reset through `disconnect()` and clear `ownedServerPassword`.

**`paddy` cannot start on Windows:**
- Symptoms: The documented Windows path (`install.ps1`, `README.md:44`) installs a `paddy.cmd` wrapper, but `paddy` then fails.
- Files: `bin/paddy.mjs:46` (`spawn("npm", …)` with no `shell: true`), `bin/paddy.mjs:324` (`execFileSync("which", …)`), `install.ps1`
- Trigger: Run `paddy` on Windows.
- Cause: `npm` is `npm.cmd` on Windows and needs `shell: true`; `which` does not exist there, so `detectBinary()` silently falls through.
- Fix approach: Use `process.platform === "win32" ? "npm.cmd" : "npm"` (or `shell: true`), and replace `which` with a PATH scan or `where`.

**Root `install.sh.test.mjs` fails:**
- Symptoms: `node --test install.sh.test.mjs` fails assertions expecting `paddy gateway`, `--no-onboard`, and a `Sláinte🍀` success banner.
- Files: `install.sh.test.mjs`, `install.sh`, `install.ps1`
- Trigger: Run the root test file directly (it is *not* in `npm test`).
- Cause: Diverged copy of `scripts/install.sh.test.mjs` left over from an earlier product shape.
- Fix approach: Delete the root copy.

**`bootstrap` returns archived sessions as active:**
- Symptoms: `GET /api/bootstrap` returns archived sessions in `sessions` (client filters them), while `GET /api/sessions` returns a separate `archived` list.
- Files: `src/server/api.ts:78`, `src/server/api.ts:165-176`
- Trigger: Archive a chat, reload the page.
- Cause: The `!item.archived || true` no-op filter.
- Fix approach: Return `{ sessions, archived, groups }` from `bootstrap`, mirroring `listSessions`.

---

## Security Considerations

**Loopback trust combined with a `Host`-header-derived `localOnly` flag (High):**
- Risk: `authorizePeer` grants full access to any request whose socket peer is loopback (`src/server/security.ts:33`). `originAllowed` compares the `Origin` host to the request `Host` header (`src/server/security.ts:55-68`). Both are attacker-controlled in a DNS-rebinding attack: a page on `evil.com:8080` resolving to `127.0.0.1` sends `Host: evil.com:8080` and `Origin: http://evil.com:8080`, which match, while the socket peer is loopback. The same applies behind any reverse proxy on the same host — every request appears to come from loopback and needs no token.
- Files: `src/server/security.ts:27-49`, `src/server/security.ts:55-68`, `src/server/http.ts:18-30`
- Current mitigation: `OPENCODE_WEB_TOKEN` exists but is skipped for loopback peers; `SameSite=Strict` cookie limits browser-driven cross-site sends but does not help non-cookie (loopback) callers.
- Recommendations: Require the `Host` header to be a loopback name even for loopback peers (reject `Host: evil.com`), and treat `localOnly` as opt-in only when the socket peer is loopback *and* `Host` is loopback. Consider requiring the token whenever `Host` is not `127.0.0.1`/`localhost`/`[::1]`.

**`connectionUrl` is user-controlled and used as the authenticated base URL (Medium):**
- Risk: `PATCH /api/settings` accepts any string for `connectionUrl` (`src/server/api.ts:149`). `ControllerRuntime.credentials()` then sends HTTP Basic auth (the stored/`OPENCODE_SERVER_PASSWORD`/`ownedServerPassword`) to that host (`src/server/runtime.ts:180-186`, `src/server/opencode-client.ts:389-396`). A malicious local process (or a rebinding page, see above) can point the controller at an attacker host and capture the OpenCode password, or use the controller as an SSRF proxy.
- Files: `src/server/api.ts:143-156`, `src/server/runtime.ts:139-190`
- Current mitigation: Loopback/`OPENCODE_WEB_TOKEN` gate only.
- Recommendations: Restrict `connectionUrl` to `http://127.0.0.1|localhost|[::1]` unless an explicit "remote server" opt-in env var is set; reject URLs with embedded credentials.

**Credentials are echoed back to the browser inside `connectionUrl` (Medium):**
- Risk: `publicState()` returns `connectionUrl` verbatim (`src/server/state.ts:110-120`) and `bootstrap` does not run `redactSecrets` over it. A URL like `http://user:secret@127.0.0.1:4096` is stored and returned in `/api/bootstrap`, `/api/projects`, `/api/settings`, `/api/settings/reset`.
- Files: `src/server/state.ts:110-120`, `src/server/api.ts:85-110`
- Recommendations: Strip/reject userinfo on write, and apply `redactSecrets` to `publicState` output.

**Plaintext passwords at rest (Medium):**
- Risk: `state.json` stores `connectionPassword` and `ownedServerPassword` in cleartext, mode `0600` (`src/server/state.ts:66-84`). `ownedServerPassword` is never cleared, including on reset (`src/server/api.ts:196-204`), and survives `disconnect()`.
- Files: `src/server/state.ts`, `src/server/runtime.ts:139-186`, `src/server/api.ts:196-204`
- Current mitigation: `0600` file, `0700` directory, never returned to the browser, redacted in diagnostics via `secretNeedles` (`src/server/api.ts:414-416`).
- Recommendations: Clear `ownedServerPassword` when the child exits or on reset/disconnect; consider the OS keyring or an env-provided password only.

**`install.sh` fetches a Node.js tarball without verifying its checksum (High supply chain):**
- Risk: `install_node_tarball` downloads `SHASUMS256.txt` (`install.sh:150-152`) and then never compares it to the downloaded tarball before `tar -xz` (`install.sh:159-166`). A compromised mirror, MITM on a hostile network, or DNS hijack yields arbitrary code execution as the user.
- Files: `install.sh:146-167`, `install.ps1`
- Current mitigation: HTTPS to `nodejs.org` only; no signature/checksum check.
- Recommendations: `sha256sum -c` against the fetched `SHASUMS256.txt` (and fail closed), or install Node via the platform package manager only.

**Unvalidated config patches forwarded to OpenCode (Medium):**
- Risk: `PATCH /api/config` accepts any object and forwards it to OpenCode's `/config` (`src/server/api.ts:337-346`). Any loopback caller can flip `permission` to `allow`, rewrite agents, or add MCP servers — the same capability the UI offers, but with no schema, allowlist, or confirmation.
- Files: `src/server/api.ts:337-346`, `src/components/desk/settings.tsx:390-520`
- Recommendations: Validate with a `zod` schema limited to keys the UI actually edits (`model`, `permission`, `agent`, `mcp`), and audit-log patches.

**Remote mode is plain HTTP and the token cookie is not `Secure` (Medium):**
- Risk: The documented remote mode is `OPENCODE_WEB_HOST=0.0.0.0` over `http://host:8080/?token=…` (`README.md:75-90`). The cookie is set as `paddy_token=…; HttpOnly; SameSite=Strict; Path=/` with no `Secure` and no `__Host-` prefix (`src/server/http.ts:36`), so it is sent in cleartext over the LAN. The token is also accepted from the query string (`src/server/http.ts:17`), which lands in proxy logs and browser history until `replaceState` runs (`src/components/desk/app.tsx:143-145`).
- Files: `src/server/http.ts:14-37`, `src/components/desk/app.tsx:143-145`
- Recommendations: Add `Secure` when the request is HTTPS, document TLS termination for remote mode, and prefer a one-time exchange endpoint over a long-lived `?token=`.

**Token comparison is not constant-time (Low):**
- Risk: `presented !== expected` (`src/server/security.ts:43`) is a timing side channel on a network-reachable secret.
- Files: `src/server/security.ts:43`
- Recommendations: Use `crypto.timingSafeEqual` on equal-length buffers.

**OpenCode error text is forwarded verbatim (Low):**
- Risk: `errorResult` returns `err.message` unredacted (`src/server/api.ts:421-430`); provider/HTTP errors can echo request details, and `redactSecrets` is not applied.
- Files: `src/server/api.ts:421-430`
- Recommendations: Run error messages through `redactSecrets` with `secretNeedles`, and map unknown errors to a generic message.

**`paddy update` runs `git reset --hard` (Low):**
- Risk: `bin/paddy.mjs:117-127` hard-resets the install checkout, discarding any local modifications without warning.
- Files: `bin/paddy.mjs:117-127`
- Recommendations: `git status --porcelain` check first, or `git pull --ff-only`.

---

## Performance Bottlenecks

**Synchronous subprocess on the request path:**
- Problem: `detectBinary()` calls `execFileSync("which", …)` (`src/server/runtime.ts:324`). `GET /api/status` calls `ensureStatus()` → `connect()` → `detectBinary()` whenever the controller is disconnected (`src/server/api.ts:70-76`). The Docker healthcheck polls `/api/status` every 30 s (`Dockerfile:51`), so a disconnected container blocks its event loop on a synchronous `which` every 30 s.
- Files: `src/server/runtime.ts:80-99`, `src/server/runtime.ts:324-331`, `src/server/api.ts:70-76`, `Dockerfile:51`
- Cause: Sync process spawn inside an async request handler.
- Improvement path: Cache the detection result, and use `execFile`/PATH scanning instead of `execFileSync`.

**Per-token full-array copies in the chat renderer:**
- Problem: Every `text-delta` event maps over the entire `messages` array (`src/components/desk/app.tsx:718-726`), and `liveActivity` re-flattens all messages on every render (`src/components/desk/app.tsx:166`). Cost grows with conversation length and token rate; a long agent run is O(n²) in message count.
- Files: `src/components/desk/app.tsx:718-726`, `src/components/desk/app.tsx:166`
- Cause: Whole-list immutable updates per delta; no per-message subscription or batching.
- Improvement path: Buffer deltas per animation frame (or use `useSyncExternalStore` per message id), and cap `liveActivity` to the last N messages rather than flattening everything.

**Side effects inside state updaters double-run in StrictMode:**
- Problem: `applyEvent` calls `setFiles`, `setMessages`, and `setWorking` from *inside* `setSessionId` updater functions (`src/components/desk/app.tsx:96-108`, `src/components/desk/app.tsx:102-115`). React 19 StrictMode invokes updaters twice in development, so deltas can be applied twice and `setWorking` fires twice per event.
- Files: `src/components/desk/app.tsx:96-115`
- Cause: Updater functions are required to be pure; these are not.
- Improvement path: Read the current session id from a ref (`sessionRef` already exists) and branch outside the updater.

**Unbounded request bodies:**
- Problem: `readRaw` buffers the whole request body into memory with no size cap (`src/server/http.ts:103-111`), then `readBody` parses it (`src/server/api.ts:398-408`).
- Files: `src/server/http.ts:103-111`, `src/server/api.ts:398-408`
- Improvement path: Reject `Content-Length` above e.g. 1 MB and enforce a streaming cap.

**SSE fan-out with no backpressure:**
- Problem: `res.write(chunk.value)` ignores its return value (`src/server/http.ts:56`), and each connected browser gets a full JSON serialization per event (`src/server/api.ts:375-392`). A slow client accumulates unbounded buffered data.
- Files: `src/server/http.ts:46-65`, `src/server/api.ts:375-392`
- Improvement path: Track `res.writableLength`/drain, drop or coalesce events per client, and add an SSE heartbeat.

**Sprite animation runs a `requestAnimationFrame` loop indefinitely:**
- Problem: The idle timeline loops forever on rAF (`src/components/paddy-mascot.tsx:59-94`) and preloads ~1 MB of PNGs (`public/paddy-sprites`, 32 files) on mount (`src/components/paddy-mascot.tsx:111-125`).
- Files: `src/components/paddy-mascot.tsx`, `public/paddy-sprites/`
- Improvement path: Pause rAF when the tab is hidden or the mascot is off-screen, and downscale/compress sprites (they are ~35 KB each for a small on-screen figure).

---

## Fragile Areas

**`src/server/runtime.ts` (359 lines, zero direct tests):**
- Files: `src/server/runtime.ts`
- Why fragile: Owns process spawning, port selection, password generation, reconnection backoff, and child lifecycle — the highest-consequence logic in the app — with no unit tests (only `api.test.ts` exercises it with a stub `client`). Specific hazards:
  - `spawnServer` resolves after a fixed 600 ms timer regardless of readiness (`src/server/runtime.ts:239`), so a failed spawn is indistinguishable from a slow one.
  - The `exit` listener (`src/server/runtime.ts:244-252`) stays registered for the life of the process and overwrites status after `disconnect()` kills the child.
  - If `this.child` is alive, `spawnServer` returns immediately even though `freePort` may have chosen a different port, so `waitUntilReady` polls the wrong port (`src/server/runtime.ts:230-237`).
  - `freePort` closes the probe socket before the child binds — a TOCTOU race with anything else on 4096 (`src/server/runtime.ts:333-350`).
  - `connect()` is triggered by a `GET /api/status`, i.e. a read request can spawn a process (`src/server/api.ts:70-76`).
- Safe modification: Add `runtime.test.ts` with an injected spawn/probe seam before touching this file; treat `connect()` as idempotent-by-promise only.
- Test coverage: none for spawn, backoff, port fallback, or exit handling.

**`src/components/desk/app.tsx` (824 lines, one component):**
- Files: `src/components/desk/app.tsx`
- Why fragile: 22 `useState` hooks, a 100-line `applyEvent` reducer, and all layout in one function. Session/project/prompt state is reset ad hoc in `chooseProject`, `newChat`, `openSession`, and `submit`; `chooseProject` does not clear `prompts` (`src/components/desk/app.tsx:172-190`), so a permission prompt from the previous project can remain actionable.
- Safe modification: Extract `applyEvent` into a tested reducer module first, then split panels. Any change to event handling must be checked against `src/server/normalize.ts` event shapes.
- Test coverage: none.

**OpenCode API contract is hand-written and unversioned:**
- Files: `src/server/opencode-client.ts`, `src/server/normalize.ts`
- Why fragile: 30+ endpoints and a dozen event names are matched by hand to `opencode serve`, including speculative variants (`permission.asked`, `permission.updated`, `permission.v2.asked`, `question.v2.asked` — `src/server/normalize.ts:176-210`) and a 404/400 fallback for permission replies (`src/server/opencode-client.ts:296-315`). No schema validation, no contract test against a real server, no version gate. Any upstream rename silently degrades to "no prompts shown" or "no streaming".
- Safe modification: Normalize through an explicit `unknown → GuiEvent` table with a fixture per event name; add a live smoke test against a pinned OpenCode version.
- Test coverage: `src/server/normalize.test.ts` covers the shapes the code already expects, not upstream drift.

**Agent `model` shape is inconsistent between read and write:**
- Files: `src/components/desk/settings.tsx:377-420`
- Why fragile: Reading assumes an object (`item.model?.providerID`, `item.model?.modelID`); saving writes a string (`agent.model = model`). `PATCH /config` also sends only `{ agent: { [name]: … } }`, which may replace rather than merge the `agent` map depending on OpenCode's PATCH semantics — potentially dropping other agents.
- Safe modification: Write `{ providerID, modelID }` and verify merge behaviour against the installed OpenCode before shipping agent editing.

**MCP command parsing cannot express quoted arguments:**
- Files: `src/components/desk/settings.tsx:497`
- Why fragile: `command.trim().split(/\s+/)` splits paths with spaces and quoted flags incorrectly, then persists a broken command array through `POST /mcp` and a second `PATCH /config` (`src/server/api.ts:352-372`).
- Safe modification: Use a shell-words parser or accept a JSON array in the UI.

**`src/server/normalize.ts:109` drops text that starts with `<`:**
- Files: `src/server/normalize.ts:109`
- Why fragile: `.filter((part) => … && !part.text.startsWith("<"))` silently discards legitimate user/assistant text beginning with `<` (HTML, JSX, diff snippets, `<file>` references). The message renders empty with no indication data was dropped.
- Safe modification: Filter by part metadata (e.g. synthetic/summary flags), not by a leading character.

**Session grouping uses `Date.now()` as a fallback:**
- Files: `src/server/normalize.ts:90-92`, `src/server/normalize.ts:267-289`, `src/components/desk/app.tsx:790-805`
- Why fragile: Missing timestamps are replaced with "now", so sessions jump groups between reloads; the grouping logic is duplicated on client and server (`groupSessionsByDate` vs `groupByDate`) and can drift. Labels are `MMM D` without a year, so older sessions collide.
- Safe modification: Keep the server as the only grouping authority and return `groups` from every session endpoint.

**No timeout on any OpenCode HTTP call:**
- Files: `src/server/opencode-client.ts:377-410`, `src/server/runtime.ts:196-207`
- Why fragile: `fetch` has no `AbortSignal.timeout`. A half-open TCP connection to OpenCode makes `probe`/`getStatus`/`attach` hang indefinitely, which hangs `GET /api/status`, `bootstrap`, and the whole `connect()` promise (guarded by `this.connecting`, so no retry is possible until it settles).
- Safe modification: Add a per-request timeout (e.g. 10 s for reads, 30 s for prompts) and surface a retryable error.

**SSE disconnect is not observed:**
- Files: `src/server/http.ts:46-65`, `src/server/api.ts:375-392`
- Why fragile: The adapter never listens for `req`/`res` `close`, so when a browser goes away mid-stream the runtime listener stays subscribed until the next event causes a write failure — at which point the error is swallowed (`catch { /* client disconnected */ }`). Repeated reconnects can accumulate listeners in `ControllerRuntime.listeners`.
- Safe modification: Subscribe on `start`, unsubscribe on `req.on("close")`, and end the stream explicitly.

**`state.json` corruption silently resets everything:**
- Files: `src/server/state.ts:52-60`
- Why fragile: Any read/parse error returns `EMPTY_STATE` — losing project bookmarks, the stored password, *and* `ownedServerPassword`, which orphans a running OpenCode server the controller can no longer authenticate to.
- Safe modification: Back up the unreadable file (`state.json.bad-<ts>`) before falling back, and surface a warning in `/api/diagnostics`.

**`startup.sh` and `scripts/preview.mjs` are sandbox-specific:**
- Files: `startup.sh`, `scripts/preview.mjs`
- Why fragile: `startup.sh` hardcodes `/workspace` and appends to `/tmp/app-startup.log`; `preview.mjs` reads `/proc` and kills port owners, so it is Linux-only and will never work on macOS/Windows.
- Safe modification: Keep them out of the shipped package (`pack-selfhost` copies them) or gate them on the sandbox environment.

---

## Scaling Limits

**Single controller process, single OpenCode child:**
- Current capacity: One `ControllerRuntime` singleton (`src/server/runtime.ts:352-357`), one OpenCode server on 127.0.0.1:4096, one global event subscription loop (`src/server/runtime.ts:258-289`).
- Limit: All browsers share the same active project and the same status; a second tab switching projects changes the first tab's project. One slow/hung OpenCode request blocks `/api/status` and `bootstrap` for every client.
- Scaling path: This is intentional for a local desk; if multi-tab becomes a requirement, move project selection into the URL/session rather than process state.

**No pagination anywhere:**
- Current capacity: `listSessions` fetches all root sessions (`src/server/opencode-client.ts:70-77`); `openSession` fetches the entire message history (`src/server/api.ts:184-198`).
- Limit: Long-lived projects with thousands of sessions/messages produce multi-MB responses and slow first paint; the client also keeps every message in memory and copies the array per delta.
- Scaling path: Add `limit`/`cursor` to `/api/sessions` and `/api/sessions/:id/messages`, and virtualize the thread.

**Unbounded in-memory listener set:**
- Current capacity: `ControllerRuntime.listeners` is a plain `Set` with no cap (`src/server/runtime.ts:53`, `src/server/runtime.ts:66-77`).
- Limit: Each leaked SSE connection (see "SSE disconnect is not observed") adds a permanent listener and a per-event serialization cost.
- Scaling path: Cap concurrent streams, log subscriber counts in `/api/diagnostics`, and guarantee unsubscribe on socket close.

---

## Dependencies at Risk

**Beta/bleeding-edge production toolchain:**
- Risk: `nitro: 3.0.260610-beta` (`package.json` devDependencies) is the production build server (`vite.config.ts:218-224`); `vite ^8.2.0`, `@tanstack/react-start ^1.168.0`, `@tanstack/react-router ^1.170.0`, and React 19 are all fast-moving. A beta build tool can break deploys without notice.
- Impact: The published Docker/Vercel output depends on a beta; `vite.config.ts` already carries `@ts-expect-error` for two JS plugins.
- Migration plan: Pin exact versions for the build toolchain and upgrade deliberately; drop Nitro entirely if the Vercel deploy target is not used by this project.

**`overrides: { "nf3": "0.3.17" }`:**
- Risk: An exact pin on an obscure transitive package, with no comment explaining why it is needed.
- Impact: Unknown provenance; the override silently disappears if the parent dependency drops `nf3`.
- Migration plan: Document the reason in `package.json` or remove once the parent upgrades.

**~30 unused runtime dependencies:**
- Risk: `recharts`, `react-hook-form`, `@hookform/resolvers`, `@tanstack/react-query`, `@tanstack/react-table`, `cmdk`, `vaul`, `date-fns`, `react-day-picker`, `react-resizable-panels`, and 24 of the 29 `@radix-ui/react-*` packages have zero imports in `src/`, `server/`, or `scripts/` (verified by grep). `playwright ^1.62.0` is used only by the orphaned `scripts/browser-smoke.mjs`, and `pg` is imported by `scripts/migrate.mjs` without being declared.
- Impact: Install size, audit surface, and `npm ci` time in the Docker build; every transitive advisory becomes "our" advisory for code that never ships.
- Migration plan: Remove unused packages in one commit, re-run `npm run typecheck` and `npm test`; keep `zod`, `sonner`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `@tanstack/react-router`, `@tanstack/react-start`, `@radix-ui/react-slot`.

**`sideEffects: false` on an app package:**
- Risk: `package.json` declares `"sideEffects": false` while the app imports CSS (`src/routes/__root.tsx:4`) and mounts global listeners. Bundlers that honour the flag may tree-shake side-effect-only imports.
- Impact: Latent "styles missing in production build" bug if the bundler configuration changes.
- Migration plan: Set `"sideEffects": ["**/*.css"]` or remove the field (it has no benefit for a private app).

---

## Missing Critical Features

**No CI for tests, typecheck, or lint:**
- Problem: `.github/workflows/` contains only `publish-image.yml`. Nothing runs `npm test`, `npm run typecheck`, or `npm run lint` on push or PR.
- Blocks: The two lint errors and the stale root installer test can sit in `main` indefinitely; regressions in `src/server/` are caught only if someone runs tests locally.
- Files: `.github/workflows/publish-image.yml`, `package.json`

**No frontend/E2E tests despite Playwright being installed:**
- Problem: There is no component test runner (no jsdom/testing-library) and no npm script for `scripts/browser-smoke.mjs`. The only UI test is `src/components/autonomous-drink.test.ts` (pure scheduler logic).
- Blocks: Refactoring `src/components/desk/app.tsx` (824 lines) safely.
- Files: `package.json`, `src/components/desk/app.tsx`

**No graceful shutdown:**
- Problem: No signal handling anywhere; a spawned OpenCode server outlives the controller (see Known Bugs).
- Blocks: Clean container stop/start; safe `paddy update` while a server is running.
- Files: `src/server/runtime.ts`, `bin/paddy.mjs`

**No structured logging or request observability:**
- Problem: The server has no request logging; only the Vite plugin logs failures (`vite.config.ts:167`, `vite.config.ts:181`). `/api/diagnostics` returns controller version, status, project count, and active id only (`src/server/api.ts:206-218`) — no subscriber count, no OpenCode latency, no child pid, no last-error history.
- Blocks: Diagnosing "the desk is stuck" reports from users.
- Files: `src/server/api.ts:206-218`, `src/server/runtime.ts`

**No accessibility gating for the mascot animation:**
- Problem: `prefers-reduced-motion` is honoured in CSS (`src/styles.css:83`, `src/styles.css:325`) but the sprite loop swaps `img.src` on rAF regardless (`src/components/paddy-mascot.tsx:59-94`), and the autonomous drink scheduler keeps running (`src/components/use-autonomous-drink.ts`).
- Blocks: Comfortable use for motion-sensitive users; also violates the intent of the existing CSS rule.
- Files: `src/components/paddy-mascot.tsx`, `src/components/use-autonomous-drink.ts`, `src/styles.css`

**No OpenCode response validation:**
- Problem: `zod` is a dependency but is used only by the template preview bridge. Every OpenCode response is cast (`as OpenCodeSession`, `as Record<string, unknown>`) with `Array.isArray` checks.
- Blocks: Detecting upstream contract changes; a malformed payload currently surfaces as `undefined` fields deep in the UI.
- Files: `src/server/opencode-client.ts`, `src/server/normalize.ts`, `src/lib/preview-host-bridge.ts`

---

## Test Coverage Gaps

**`src/server/runtime.ts` — untested:**
- What's not tested: binary detection, `connect()` idempotence, `freePort` fallback, spawn failure, 600 ms readiness timer, exit listener, reconnect backoff, `disconnect()`, `ownedPassword` re-attach.
- Files: `src/server/runtime.ts`
- Risk: The most consequential code in the app can regress silently; `api.test.ts` injects a fake `runtime.client` and never exercises the real lifecycle.
- Priority: High

**`src/server/http.ts` — untested:**
- What's not tested: socket-address auth, query/cookie token handling, `Set-Cookie` emission, origin rejection, SSE streaming and disconnect, body buffering.
- Files: `src/server/http.ts`
- Risk: `security.test.ts` tests `authorizePeer` in isolation; the adapter that wires it to real sockets has no test, so the DNS-rebinding/proxy bypass path is invisible to CI.
- Priority: High

**`src/components/desk/*` — untested (1,388 lines):**
- What's not tested: `applyEvent` reduction, optimistic message reconciliation, session switching, permission replies, settings save paths, error surfaces.
- Files: `src/components/desk/app.tsx`, `src/components/desk/settings.tsx`
- Risk: The duplicate-message and password-wipe bugs above would both be caught by a single component test each.
- Priority: High

**`src/lib/desk/client.ts` — untested:**
- What's not tested: `request()` error mapping, `initialTokenPath` token forwarding, every endpoint's shape.
- Files: `src/lib/desk/client.ts`
- Risk: The client and server type definitions are duplicated by hand (`ConnectionStatus`, `SessionSummary`, `ChatMessage`, `DeskEvent` appear in both `src/server/normalize.ts` and `src/lib/desk/client.ts`) and can drift without a failing test.
- Priority: Medium

**~1,700 lines of script tests are not run by `npm test`:**
- What's not tested in the default run: `scripts/brand-check.test.mjs`, `scripts/browser-smoke-verdict.test.mjs`, `scripts/check-auth-invariant.test.mjs`, `scripts/grok-pwa-plugin.test.mjs`, `scripts/link-cli.test.mjs`, `scripts/migration-plan.test.mjs`, `scripts/preview.test.mjs`, `scripts/sign-out-plan.test.mjs`, `scripts/with-app-env.test.mjs`, `scripts/write-atomic.test.mjs`.
- Files: `package.json` (`"test"` script), `scripts/*.test.mjs`
- Risk: These tests protect code that is either orphaned or load-bearing-but-unguarded (`with-app-env.mjs` runs every dev/build/preview); none of them gate a merge.
- Priority: Medium (delete the tests with their dead modules; wire the rest into `npm test`)

**`install.sh` / `install.ps1` behaviour is shallowly tested:**
- What's not tested: checksum verification (absent), PATH/profile mutation, `/usr/local/bin` copy, `--ref`/`--repo` validation edge cases, Node install path.
- Files: `scripts/install.sh.test.mjs`, `install.sh`
- Risk: The installer is the primary distribution path and mutates the user's shell profile and `~/.local`.
- Priority: Medium

**No test asserts `npm run lint` or `npm run typecheck` pass:**
- What's not tested: the repo's own gates.
- Files: `package.json`, `.github/workflows/`
- Risk: `lint` is currently failing on `main`; `typecheck` passes (verified 2026-10-29).
- Priority: High

---

## Verification Notes

Commands run during this analysis (2026-10-29, working tree clean at `d358aee`):

- `npx tsc --noEmit` — **passes** (no output).
- `npx eslint .` — **fails**: 2 errors (`bin/paddy.mjs:152` unreachable code, `src/server/api.ts:74` `prefer-const`), 7 warnings.
- `npm test` — **passes**: 36 tests, 0 failures (covers `security`, `opencode-client`, `api`, `normalize`, `state`, `autonomous-drink`, and `scripts/install.sh.test.mjs`).
- `node --test install.sh.test.mjs` (root copy, not part of `npm test`) — **fails**: stale expectations for `paddy gateway`, `--no-onboard`, and the `Sláinte🍀` banner.
- Grep checks: zero `SIGINT`/`SIGTERM`/`process.on` handlers under `src/`, `server/`, `bin/`; zero imports of 30 declared dependencies; `src/lib/db.ts`, `src/lib/auth/`, `migrations/`, and `index.html` do not exist.
- Not run: `npm run build`, `npm run dev`, Docker image build (would validate the `COPY index.html*` pattern at `Dockerfile:40`, which matches no file in the repo and may fail a fresh build), and any live OpenCode contract check.

---

*Concerns audit: 2026-10-29*
