<!-- GSD:project-start source:PROJECT.md -->

## Project

**Paddy**

Paddy is a local web interface for OpenCode. The browser is the desk; OpenCode does the work. A single Node process serves the React UI and a controller that talks to a locally-running `opencode serve` over HTTP and SSE.

The browser never runs shell commands and never reads the filesystem — the controller is the security boundary. Paddy does not reimplement the agent and does not scrape CLI output.

**Core Value:** A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.

Everything else — settings depth, theming, packaging — is secondary to that loop working and being trustworthy.

### Constraints

- **Tech stack**: Node 22+, TypeScript, TanStack Start — the app ships as one process; no separate backend service or database may be introduced for this milestone
- **Compatibility**: existing installs keep state at `~/.config/opencode-web`; it must continue to be reused when present
- **Security**: the controller stays the only component with shell/filesystem access; the browser stays sandboxed from both
- **Authority**: OpenCode remains the source of truth for sessions, messages, models, and file changes
- **Test runner**: `node:test` only — adding Jest/Vitest would be a stack change outside this milestone

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5.9 (declared `^5.7.0`) — all application code in `src/` and `server/`; strict mode, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit`, `allowImportingTsExtensions`. Config: `tsconfig.json`.
- TSX / React — UI in `src/components/` and `src/routes/`.
- JavaScript ESM (`.mjs`) — build/tooling scripts in `scripts/`, CLI wrapper `bin/paddy.mjs`, plain-ESM shared modules such as `scripts/grok-pwa-shared.mjs`.
- Shell / PowerShell — installers `install.sh`, `install.ps1`, `startup.sh`.
- CSS — Tailwind v4 entry `src/styles.css` using the `@theme` directive.

## Runtime

- Node.js 22+ required. Enforced in `bin/paddy.mjs:142` (`nodeMajor < 22` exits) and by `install.sh` (installs `latest-v22.x` when missing). README states "Node.js 22+".
- Local dev machine used for this analysis: Node v26.12.1, npm 12.2.1.
- Container runtime: `node:24-bookworm-slim` (`Dockerfile:12`).
- Vercel functions runtime: `nodejs24.x` (`.vercel/output/nitro.json`).
- No `engines` field in `package.json` — the version floor is enforced only by the wrapper/installer.
- npm, lockfile version 3 (`package-lock.json`, committed).
- `package.json` has `"type": "module"` and a `postinstall` hook that runs `scripts/link-cli.mjs` to symlink the `paddy` CLI into `~/.local/bin` (override with `PADDY_BIN_DIR`).
- npm override: `"nf3": "0.3.17"` (`package.json:11`).

## Frameworks

- React 19.2 — UI (`src/components/desk/app.tsx`, `src/components/desk/settings.tsx`).
- TanStack Start 1.168 — full-stack SSR framework, wired via `tanstackStart()` in `vite.config.ts:215`.
- TanStack Router 1.170 — file-based routing from `src/routes/`, generated tree `src/routeTree.gen.ts`, router factory `src/router.tsx`.
- Vite 8.2 — dev server and bundler (`vite.config.ts`).
- Nitro 3.0.260610-beta — server build target, only added for `command === "build" || isPreview`, preset `vercel`, `serverDir: "./server"` (`vite.config.ts:216-226`).
- Tailwind CSS 4.3 with `@tailwindcss/vite`; design tokens defined in `src/styles.css` (`@theme`, `[data-theme="light"]`).
- `class-variance-authority` + `clsx` + `tailwind-merge` — variant styling and `cn()` helper (`src/lib/utils.ts`).
- `lucide-react` — icons (`src/components/desk/app.tsx`, `src/components/desk/settings.tsx`).
- `sonner` — toasts (`src/routes/__root.tsx`).
- `@radix-ui/react-slot` — used only by `src/components/ui/button.tsx`.
- `zod` 4.5 — runtime validation of the preview postMessage envelope (`src/lib/preview-host-bridge.ts`).
- Built-in `node:test` runner, no Jest/Vitest. `npm test` runs `node --test scripts/install.sh.test.mjs` plus `node --experimental-strip-types --test` over six TS suites (`package.json:24`).
- Playwright 1.63 (`chromium`) for manual browser QA scripts: `scripts/browser-smoke.mjs`, `scripts/preview-thumbnail.mjs`. Not wired into `npm test` or any npm script.
- `vite` (dev/build/preview), `nitro` (server output), `lightningcss`.
- `@vitejs/plugin-react` for Fast Refresh.
- Custom Vite plugins defined in-repo: `opencodeControllerPlugin`, `appEnvPlugin`, `grokPwaPlugin`, `pgliteBootstrapPlugin`, `authPopupPlugin` (`vite.config.ts`).
- `scripts/with-app-env.mjs` wraps `dev`, `build`, `build:dev`, `preview` so `.grok/app-env.json` is merged into the environment before Vite starts.

## Key Dependencies

- `@tanstack/react-start` / `@tanstack/react-router` — app shell, SSR, routing.
- `react` / `react-dom` 19.2 — rendering.
- `vite` 8.2 + `nitro` — dev server and production build.
- `tailwindcss` 4.3 + `@tailwindcss/vite` — all styling.
- `zod` 4.5 — the only runtime validation library actually imported.
- `sonner`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge` — UI primitives.
- No HTTP client library; `fetch` and `node:http` only (`src/server/opencode-client.ts`, `src/server/http.ts`).
- No database client, ORM, or auth library is installed.
- No state-management or data-fetching library in use (no Redux, Zustand, TanStack Query in code).
- `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `cmdk`, `vaul`, `date-fns`, `react-day-picker`, `react-resizable-panels`.
- 18 of the 20 `@radix-ui/react-*` packages; only `@radix-ui/react-slot` is imported.
- `eslint-plugin-prettier` is installed but not registered in `eslint.config.mjs` (only `eslint-config-prettier` is used).

## Configuration

- Runtime env vars read by code: `OPENCODE_WEB_HOST`, `OPENCODE_WEB_TOKEN`, `OPENCODE_WEB_HOME`, `OPENCODE_URL`, `OPENCODE_BIN`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `PADDY_HOME`, `PADDY_BIN_DIR`.
- Build-time / platform env vars: `VITE_PUBLIC_HOSTNAME`, `VITE_OG_SERVICE_URL`, `VITE_AUTH_ENABLED`, `VITE_PROJECT_ID`, `X_CREATOR`, `X_CREATOR_ID`, `GROK_PROJECT_ID`.
- `DATABASE_URL` is read only by `scripts/migrate.mjs`, which is not part of any npm script.
- `.grok/app-env.json` currently sets `VITE_AUTH_ENABLED: "false"` and `deploy.database: true`; only `VITE_`-prefixed string keys are honored by `scripts/with-app-env.mjs`, so `deploy.database` is inert.
- `.env` files: none present. `selfhost.env.example` documents provider keys and channel tokens that the current code does not read (see INTEGRATIONS.md).
- `config.json` (git-ignored) holds OpenCode project config, currently `{"model": "perplexity-agent/deepseek/deepseek-v4-flash-0731"}`.
- Secrets location: `~/.paddy/state.json` (mode 0600) stores the OpenCode connection password; `OPENCODE_WEB_TOKEN` comes from the process environment.
- `vite.config.ts` — dev server `127.0.0.1:8080` (`strictPort`), preview `127.0.0.1:8081`, `resolve.tsconfigPaths: true`.
- `tsconfig.json` — path alias `@/*` → `./src/*`, `allowJs` + `checkJs` for `scripts/migration-plan.mjs`.
- `eslint.config.mjs` — flat config: `@eslint/js` recommended, `typescript-eslint` recommended, React Hooks and React Refresh plugins; ignores `dist`, `.output`, `.vercel`, `.nitro`, `src/routeTree.gen.ts`.
- `.prettierrc` — double quotes, semicolons, trailing commas `all`, `printWidth: 100`.
- `.dockerignore`, `Dockerfile`, `docker-compose.yml` — container build and local compose run.
- `.vercel/output/` — committed prebuilt Nitro/Vercel output (`config.json`, `nitro.json`).

## Platform Requirements

- Node.js 22+, npm.
- OpenCode installed on `PATH`, at `~/.opencode/bin/opencode`, `/usr/local/bin/opencode`, or `/usr/bin/opencode` (detection in `src/server/runtime.ts:80-98`).
- No native build toolchain needed for the app itself; `lightningcss` provides the CSS transform.
- Primary target: a single local Node process serving the desk on loopback, spawning/attaching to `opencode serve` on `127.0.0.1:4096`.
- Container target: `ghcr.io/coruairc/paddy-gui:latest`, published on loopback `127.0.0.1:8080`, state volume at `/state` (`docker-compose.yml`).
- Secondary deploy target: Vercel via Nitro preset `vercel` (`.vercel/output/`, `server/middleware/grok-pwa.ts`). The controller/OpenCode integration is local-process oriented; the deployed target only exercises the static/SSR shell and platform PWA/OG chrome.

## Notable Stack Gaps

- `scripts/migrate.mjs` imports `pg`, which is not in `package.json` or the lockfile. The script is never invoked by `npm run build`, so the import is unreachable in practice.
- `vite.config.ts:34-53` defines a PGLite bootstrap plugin, but there is no `src/lib/db.ts` and no `migrations/` directory — the plugin's `hasGlobbedMigrations` guard makes it a no-op.
- `scripts/migration-plan.mjs` and its tests exist solely for that unused database path.
- No test script entry for Playwright smoke/brand checks; they must be run manually with `node scripts/browser-smoke.mjs`.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- kebab-case for every source file, including React components: `src/components/paddy-mascot.tsx`, `src/components/preview-host-bridge.tsx`, `src/server/opencode-client.ts`, `scripts/write-atomic.mjs`.
- UI primitives are single lowercase words under `src/components/ui/`: `button.tsx`, `input.tsx`, `badge.tsx`.
- Hooks live in their own file prefixed `use-`: `src/components/use-autonomous-drink.ts` exports `useAutonomousDrink`.
- Tests are co-located and mirror the source basename: `src/server/api.ts` → `src/server/api.test.ts`, `scripts/preview.mjs` → `scripts/preview.test.mjs`.
- TanStack Start routes use framework names: `src/routes/__root.tsx`, `src/routes/index.tsx`. `src/routeTree.gen.ts` is generated — never edit it (also ignored by ESLint).
- camelCase, verb-first: `handleApi`, `validateWorkspacePath`, `redactSecrets`, `groupSessionsByDate`, `summarizeSession`.
- Boolean predicates start with `is`/`has`/`looksLike`/`can`: `isLoopbackAddress`, `isMigrationFile`, `hasGlobbedMigrations`, `looksLikePreviewProcess`, `originAllowed`.
- Argument parsers are `parseX` and return a result object, never throw: `parsePreviewArgs`, `parsePid`, `parsePgid`, `parseListenerInodes`, `parseWriteAtomicArgs`, `parseBrandCheckArgs`.
- Shape converters are `toX` / `normalizeX` / `publicX`: `toChatMessage`, `toDiffFile`, `normalizeEvent`, `normalizeState`, `publicState`.
- Error message helpers are `xError`/`xResult`: `errorResult` (`src/server/api.ts`), `errorMessage` (`src/lib/error-component.tsx`), `stagingError` (`scripts/write-atomic.mjs`).
- camelCase locals. Short map/filter callback names are normal: `item`, `entry`, `current`, `node`, `part`.
- Module-level constants are SCREAMING_SNAKE_CASE: `EMPTY_STATE`, `CONTROLLER_VERSION`, `DEFAULT_DRINK_CONFIG`, `TEMPLATE_ROOT`, `MAX_CARD_BYTES`, `OG_PENDING_REL_PATH`, `SECRET_KEY`, `TOOL_LABELS`, `LOOPBACK_HOSTS`.
- Numeric literals use `_` separators for readability: `86_400_000`, `30_000`, `1_000_000` (`src/lib/utils.ts`, `src/components/autonomous-drink.ts`).
- Booleans exposed to the browser are named as facts, not flags: `hasConnectionPassword` in `publicState` (`src/server/state.ts`).
- Private class members use the `private` keyword, never `#` fields: `private child`, `private listeners` (`src/server/runtime.ts`), `private readonly fetchImpl` (`src/server/opencode-client.ts`).
- `export type X = { ... }` is the default (≈39 `type` aliases vs ≈10 `interface` declarations). Reserve `interface` for public contract objects with per-field doc comments: `AutonomousConfig`, `AutonomousClock`, `AutonomousHooks`, `AutonomousController` (`src/components/autonomous-drink.ts`), `UseAutonomousDrinkOptions` (`src/components/use-autonomous-drink.ts`).
- Discriminated unions carry a literal `type` field: `GuiEvent` (`src/server/normalize.ts`), `DeskEvent` (`src/lib/desk/client.ts`), `PathCheck` (`src/server/security.ts`), `ApiResult` (`src/server/api.ts`).
- String unions replace enums: `"dark" | "light"`, `"once" | "always" | "reject"`, `"idle" | "drink"`.
- `as const` arrays derive union members: `const SECTIONS = [...] as const; type Section = (typeof SECTIONS)[number];` (`src/components/desk/settings.tsx`).
- Optional fields use `?`, not `| undefined`: `binary?: string`, `error?: string` (`src/server/runtime.ts`).
- `unknown` plus narrowing is preferred over `any`, even though `@typescript-eslint/no-explicit-any` is off.

## Code Style

- Prettier is the only formatter. `.prettierrc`: `semi: true`, `singleQuote: false` (double quotes), `trailingComma: "all"`, `printWidth: 100`. No `.editorconfig`, no `.prettierignore`.
- `npm run format` → `prettier --write .`
- ESLint 9 flat config in `eslint.config.mjs`: `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-plugin-react-hooks` recommended + `react-refresh` + `eslint-config-prettier` last.
- Rules that matter when writing code:
- Ignores: `dist/**`, `.output/**`, `.vercel/**`, `.nitro/**`, `node_modules/**`, `src/routeTree.gen.ts`.
- `npm run lint` → `eslint .`
- `tsconfig.json` is `strict: true`, `noEmit: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `isolatedModules: true`, `allowImportingTsExtensions: true`, `allowJs` + `checkJs` on.
- `npm run typecheck` → `tsc --noEmit` over `src` and `server`.
- `src/lib/harness/setup-model-picker.test.mjs` is explicitly excluded in `tsconfig.json`.

## Import Organization

- `@/*` → `./src/*` (`tsconfig.json` `paths`, mirrored by Vite).
- Browser/client code uses `@/`. Server code under `src/server/` uses relative imports with explicit `.ts` extensions (`import { handleApi } from "./api.ts";`) because `allowImportingTsExtensions` is enabled and the files run under Node's type stripping.
- Type-only imports are inline: `import { clsx, type ClassValue } from "clsx";`, `import { normalizeEvent, type GuiEvent } from "./normalize.ts";`
- Plain ESM with `.mjs`. `// @ts-check` only where the module is consumed by checked TS (`scripts/migration-plan.mjs`, `scripts/sign-out-plan.mjs`).
- Testable pure helpers are exported and the CLI entry is guarded:

## Error Handling

- Domain errors are thrown as `OpenCodeError(status, message, retryable)` (`src/server/opencode-client.ts:46`) and caught once in `handleApi`, converted by `errorResult` into `{ status, body: { error, retryable } }` (`src/server/api.ts:419`). `status === 0` maps to 503.
- Validation does **not** throw; it returns a discriminated result: `{ ok: true, path } | { ok: false, error }` (`validateWorkspacePath`, `safeJson` in `src/server/security.ts`). Callers convert failures into `OpenCodeError(400, ...)` at the boundary (`readBody`, `requireProject`).
- Ignored failures use a bare `catch {}` with a comment explaining why:
- Best-effort side effects use `.catch(() => undefined)` (`src/server/api.ts:331`).
- Secrets are stripped at the boundary with `redactSecrets(...)` before any response leaves the controller (`src/server/api.ts:101`, `src/server/api.ts:332`).
- HTTP failures throw `Error(data.error || \`Request failed (${response.status})\`)` in the single `request<T>()` helper (`src/lib/desk/client.ts:105`).
- Components catch and narrow to a user-facing string, then set local state — never rethrow:
- Optional reads degrade silently: `api.config().catch(() => ({} as Record<string, unknown>))` (`src/components/desk/app.tsx:184`).
- Route-level crashes render `AppErrorComponent` via `errorMessage()` fallback (`src/lib/error-component.tsx`).

## Logging

- CLI scripts log with a bracketed script tag: ``console.log(`[preview] serving ${PREVIEW_URL} ...`)``, `[migrate]`, `[with-app-env]`, `[app-builder]`.
- Machine-readable script output is a JSON object: `console.error(JSON.stringify({ ok: false, error: args.error }, null, 2))` (`scripts/browser-smoke.mjs:25`), `console.log(JSON.stringify(verdict, null, 2))` (`:160`).
- The UI surfaces failures through a single `error` state rendered in the desk and through `sonner` `<Toaster />` mounted in `src/routes/__root.tsx` (no `toast.*` calls exist yet).

## Comments

- Every server module opens with a JSDoc block stating the invariant it protects, e.g. `src/server/security.ts:1-4` ("The browser is never trusted"), `src/server/api.ts:1-4`, `src/server/state.ts:1-5`, `src/server/http.ts:1-4`.
- Comments explain *why*, not *what*: `// A controller restart must not lose the password of a server it spawned,` (`src/server/runtime.ts:55`), `// pid 1 is the sandbox init, never a preview server.` (`scripts/preview.test.mjs:33`).
- Section dividers with box-drawing characters group related tests: `// ── Deployed ───────` (`scripts/sign-out-plan.test.mjs:111`).
- JSDoc on exported functions in `.mjs` helpers, often with `@param`/`@returns` in `@ts-check` files (`scripts/migration-plan.mjs`, `scripts/sign-out-plan.mjs`).
- JSDoc on exported TS functions when behavior is non-obvious: `authorizePeer`, `originAllowed`, `validateWorkspacePath`, `redactSecrets` (`src/server/security.ts`), `useAutonomousDrink` (`src/components/use-autonomous-drink.ts`).
- 93 top-of-block `/**` comments across `src`, `server`, `scripts`.
- Inline field docs inside interfaces are common: `/** Never serialized to the browser. */` (`src/server/state.ts:28`).

## Function Design

- Single primitive args where possible; an options object for >2 knobs: `new OpenCodeClient({ baseUrl, password, fetch })`, `useAutonomousDrink({ config, suspended })`.
- Injected side-effect dependencies rather than module mocking: `fetch` (`ClientOptions.fetch`), clock `{ setTimeout, clearTimeout, random }` (`AutonomousClock`).
- Env-derived config is injectable for tests: `stateFilePath(env = process.env, home = homedir())` (`src/server/state.ts:45`).
- Unused params are prefixed `_`.
- Validation returns `{ ok }` unions; mutation functions return the updated entity or `void`.
- Handlers return `Promise<ApiResult>` (`{ status, body, stream? }`) rather than writing to the response directly — the Node adapter (`handleNode`) owns I/O.
- Unsubscribe functions are returned from subscriptions: `subscribe(listener): () => void` (`src/server/runtime.ts:64`).

## Module Design

- Named exports only. One default export exists in the whole repo: `server/middleware/grok-pwa.ts:63`.
- UI primitives export the component and its variants at the bottom: `export { Button, buttonVariants };` (`src/components/ui/button.tsx:45`), `export { Input };` (`src/components/ui/input.tsx:20`).
- The browser API surface is a single object of thin functions: `export const api = { bootstrap, connect, addProject, ... }` (`src/lib/desk/client.ts:118-172`).

## React Patterns

- Function components, PascalCase, exported from kebab-case files. Small components take an inline props type literal; public panels use a named inline object type (`src/components/desk/settings.tsx:27-45`).
- Primitives use `React.forwardRef` + `displayName` + `cn()` (`src/components/ui/button.tsx`, `src/components/ui/input.tsx`).
- Variants use `class-variance-authority` `cva` with `defaultVariants`.
- Styling is Tailwind v4 utilities over CSS custom properties defined in `@theme` (`src/styles.css`): use semantic tokens `bg-bg`, `text-fg`, `text-muted`, `bg-elevated`, `border-border`, `text-accent`, `text-danger`, `text-ok`, `text-warn` — not raw palette classes.
- State: `useState` with functional updaters for list merges (`setSessions((current) => ...)`), `useCallback` for handlers passed down, `useRef` mirroring state to avoid stale closures (`sessionRef.current = sessionId`, `src/components/desk/app.tsx:51`).
- No `"use client"` directives (TanStack Start, not Next).
- No component-render test tooling (no jsdom/RTL); keep logic in plain `.ts` modules (e.g. `src/components/autonomous-drink.ts`) so it stays unit-testable.

## Security Conventions

- The browser is untrusted: authorize on socket address (`req.socket.remoteAddress`), never on a spoofable header (`src/server/http.ts:1-4`).
- Every workspace path crossing the API boundary goes through `validateWorkspacePath(path, allowlist)` (`src/server/api.ts:125`, `:393`).
- Anything credential-shaped is passed through `redactSecrets(value, secretNeedles(runtime))` before returning (`src/server/api.ts:101`, `:332`).
- State files are written atomically with `0600` and the directory `0700` (`src/server/state.ts:60-71`).

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

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

- **One process owns everything.** `vite.config.ts` mounts `src/server/http.ts` on every `/api*` request via `opencodeControllerPlugin()`. There is no `server/index.ts` HTTP server.
- **Controller is the security boundary.** The browser never reads files, runs shell, or sees the OpenCode password. Only `src/server/*` touches `node:fs`, `node:child_process`, and the OpenCode API.
- **OpenCode is the source of truth.** Sessions, messages, models, provider credentials, MCP, and permissions live in OpenCode. Paddy persists only bookmarks/appearance/passwords in `~/.paddy/state.json` (`src/server/state.ts:1-5`).
- **Events, not polling.** A single SSE subscription to OpenCode `/global/event` is normalized and fanned out to every browser subscriber (`src/server/runtime.ts:256-294`, `src/server/api.ts:371-384`).
- **Runtime singleton.** `getRuntime()` returns one `ControllerRuntime` per process (`src/server/runtime.ts:354-359`). Tests construct their own instance with a temp state file.
- **No shared type package.** Client types are mirrored in `src/lib/desk/client.ts`; server types in `src/server/normalize.ts`. The browser must not import server modules (they import `node:*`).

## Layers

- Purpose: Render the desk, reduce streamed events into message state, collect user intent.
- Location: `src/routes/`, `src/components/`, `src/lib/desk/client.ts`, `src/lib/utils.ts`, `src/styles.css`
- Contains: Route files, React components, Tailwind theme tokens, fetch wrapper.
- Depends on: `/api` only (HTTP + SSE). No `node:*` imports.
- Used by: the browser.
- Purpose: Translate Node HTTP ↔ Web `Request`/`Response`, enforce auth/origin, stream SSE.
- Location: `src/server/http.ts`
- Contains: `handleNode`, header/cookie helpers, JSON serialization, stream pump.
- Depends on: `security.ts`, `api.ts`, `runtime.ts`.
- Used by: `vite.config.ts` middleware (dev + preview) and tests (`src/server/api.test.ts`).
- Purpose: Route table, input validation, project allowlist enforcement, response shaping.
- Location: `src/server/api.ts`
- Contains: `handleApi` and per-route handlers.
- Depends on: `runtime.ts`, `normalize.ts`, `security.ts`, `state.ts`, `opencode-client.ts`.
- Used by: `http.ts`.
- Purpose: Own the OpenCode connection lifecycle (detect binary → probe → spawn → attach → reconnect with exponential backoff), hold subscribers.
- Location: `src/server/runtime.ts`
- Contains: `ControllerRuntime`, `ConnectionStatus`, `getRuntime()`.
- Depends on: `opencode-client.ts`, `normalize.ts`, `state.ts`.
- Used by: `api.ts`, `http.ts`.
- Purpose: The only place that knows OpenCode's HTTP surface (`/session`, `/config`, `/provider`, `/mcp`, `/permission`, `/question`, `/global/event`, …).
- Location: `src/server/opencode-client.ts`
- Contains: `OpenCodeClient`, `OpenCodeError`, OpenCode wire types.
- Depends on: global `fetch` only (injectable for tests).
- Used by: `runtime.ts`, `api.ts`.
- Purpose: Convert OpenCode part/event/session shapes into GUI shapes; build diffs and date groups.
- Location: `src/server/normalize.ts`
- Contains: `GuiEvent`, `ChatMessage`, `SessionSummary`, `DiffFile`, `PermissionPrompt`, `normalizeEvent`, `toChatMessage`, `toDiffFile`, `groupSessionsByDate`.
- Depends on: OpenCode wire types from `opencode-client.ts`.
- Used by: `runtime.ts`, `api.ts`.
- Purpose: Authorization, path allowlisting, secret redaction; atomic state file.
- Location: `src/server/security.ts`, `src/server/state.ts`
- Contains: `authorizePeer`, `originAllowed`, `validateWorkspacePath`, `redactSecrets`, `readState`/`writeState`/`publicState`.
- Depends on: `node:fs`, `node:path`.
- Used by: `http.ts`, `api.ts`, `runtime.ts`.

## Data Flow

### Primary bootstrap path (first paint)

### Live event path (agent working)

### Send / abort / retry

### Permission / question replies

- Browser: local React `useState`/`useRef` inside `DeskApp` (no Redux/Zustand/react-query in use, despite `@tanstack/react-query` being a dependency). Streaming state is reduced by pure helpers `appendDelta`, `upsertActivity`, `mergeMessage`, `upsertSession` (`src/components/desk/app.tsx:788-819`).
- Server: one mutable `AppState` object per runtime, persisted on every mutation via `runtime.persist()` (`src/server/state.ts:60-71`).
- OpenCode: authoritative for everything else.

## Key Abstractions

- Purpose: Lifecycle owner for the OpenCode connection + subscriber hub.
- Pattern: Module singleton with injectable state file for tests; serialized connect via a stored promise (`connecting`) to avoid double-spawn.
- Key invariant: `ownedServerPassword` survives restarts so a spawned server can be re-attached (`runtime.ts:52-58,144-148`).
- Purpose: Thin, typed-ish HTTP adapter; no invented endpoints.
- Pattern: Every method calls private `request()`, which builds query params, applies Basic auth, maps non-2xx to `OpenCodeError(status, message, retryable)` (`opencode-client.ts:350-385`). `fetch` is injectable for tests.
- Purpose: The contract between controller and UI. `DeskEvent` = `GuiEvent` + the `connection` variant.
- Pattern: Discriminated union on `type`; UI switch in `applyEvent`.
- Purpose: Separate what the controller stores from what the browser may see.
- Pattern: Explicit projection — `connectionPassword` and `ownedServerPassword` are omitted; only `hasConnectionPassword` is exposed.
- Purpose: A project must be an absolute, existing directory, and (for session routes) inside the configured allowlist after `realpath` resolution.
- Pattern: Resolve → stat → realpath → prefix check with `sep` to prevent `/foo` matching `/foobar`.
- Purpose: Strip credential-shaped keys and known secret values from anything returned by OpenCode or diagnostics.
- Pattern: Recursive walk with key regex + literal needle replacement.
- Purpose: Framework-agnostic idle↔drink state machine with injected clock/random for deterministic tests.
- Pattern: Dependency-injected timers; React wiring in `src/components/use-autonomous-drink.ts`; enablement flags in `src/components/paddy-animations.ts`.

## Entry Points

- Triggers: `paddy`, `paddy start|update|uninstall|doctor|--version`.
- Responsibilities: Validate Node ≥ 22, resolve state dir (`PADDY_HOME` → `~/.paddy` → `~/.config/opencode-web`), exec `npm run dev -- --host 127.0.0.1 --port 8080`.
- Triggers: `npm run dev`, `npm run preview` (via `scripts/with-app-env.mjs`).
- Responsibilities: Mount `/api` middleware, PWA plugin, TanStack Start, React, Tailwind. Binds 8080 (dev) / 8081 (preview); refuses non-loopback bind without `OPENCODE_WEB_TOKEN` (`vite.config.ts:193-201`).
- Triggers: SSR request and client hydration.
- Responsibilities: `createRouter({ routeTree, defaultErrorComponent: AppErrorComponent })`. Route tree is generated into `src/routeTree.gen.ts`.
- Triggers: `vite build` with `nitro({preset:"vercel", serverDir:"./server"})`.
- Responsibilities: `/__grok/manifest.webmanifest`, `?install=1` tutorial page, streaming `<head>` injection (PWA/OG tags).
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

### Business logic inside a monolithic component

### Re-implementing server helpers in the client

### Untyped passthrough of OpenCode payloads

### Dead scaffold wired into the build

### `window.prompt` for product flows

## Error Handling

- `OpenCodeError(status, message, retryable)` is the only thrown server error type; `errorResult` maps status `0 → 503` and includes `retryable` (`src/server/api.ts:419-425`, `src/server/opencode-client.ts:46-55`).
- `handleApi` wraps the entire route table in one `try/catch`; route handlers throw instead of returning errors (`src/server/api.ts:27-59`).
- `runtime.requireClient()` throws `OpenCodeError(503, …, retryable=true)` when disconnected (`src/server/runtime.ts:312-317`).
- Connection failures emit `{type:"connection", status}` with `error`; the UI shows a reconnect bar, or a password form when `authRequired` (`app.tsx:56-63,465-503`).
- The SSE loop reconnects with exponential backoff 500 ms → 15 s and re-emits healthy status on success (`src/server/runtime.ts:263-294`).
- Router-level render errors use `AppErrorComponent` (`src/lib/error-component.tsx`, wired in `src/router.tsx`).
- Client `request()` throws `Error(data.error || "Request failed (<status>)")`; callers set local `error` state (`src/lib/desk/client.ts:95-107`).

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
