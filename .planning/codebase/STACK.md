---
last_mapped_commit: d358aee016758bde70bd5b2782a5b1ebf27b6aba
last_mapped_at: 2026-10-29
---
# Technology Stack

**Analysis Date:** 2026-10-29

## Languages

**Primary:**
- TypeScript 5.9 (declared `^5.7.0`) — all application code in `src/` and `server/`; strict mode, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit`, `allowImportingTsExtensions`. Config: `tsconfig.json`.
- TSX / React — UI in `src/components/` and `src/routes/`.

**Secondary:**
- JavaScript ESM (`.mjs`) — build/tooling scripts in `scripts/`, CLI wrapper `bin/paddy.mjs`, plain-ESM shared modules such as `scripts/grok-pwa-shared.mjs`.
- Shell / PowerShell — installers `install.sh`, `install.ps1`, `startup.sh`.
- CSS — Tailwind v4 entry `src/styles.css` using the `@theme` directive.

## Runtime

**Environment:**
- Node.js 22+ required. Enforced in `bin/paddy.mjs:142` (`nodeMajor < 22` exits) and by `install.sh` (installs `latest-v22.x` when missing). README states "Node.js 22+".
- Local dev machine used for this analysis: Node v26.12.1, npm 12.2.1.
- Container runtime: `node:24-bookworm-slim` (`Dockerfile:12`).
- Vercel functions runtime: `nodejs24.x` (`.vercel/output/nitro.json`).
- No `engines` field in `package.json` — the version floor is enforced only by the wrapper/installer.

**Package Manager:**
- npm, lockfile version 3 (`package-lock.json`, committed).
- `package.json` has `"type": "module"` and a `postinstall` hook that runs `scripts/link-cli.mjs` to symlink the `paddy` CLI into `~/.local/bin` (override with `PADDY_BIN_DIR`).
- npm override: `"nf3": "0.3.17"` (`package.json:11`).

## Frameworks

**Core:**
- React 19.2 — UI (`src/components/desk/app.tsx`, `src/components/desk/settings.tsx`).
- TanStack Start 1.168 — full-stack SSR framework, wired via `tanstackStart()` in `vite.config.ts:215`.
- TanStack Router 1.170 — file-based routing from `src/routes/`, generated tree `src/routeTree.gen.ts`, router factory `src/router.tsx`.
- Vite 8.2 — dev server and bundler (`vite.config.ts`).
- Nitro 3.0.260610-beta — server build target, only added for `command === "build" || isPreview`, preset `vercel`, `serverDir: "./server"` (`vite.config.ts:216-226`).
- Tailwind CSS 4.3 with `@tailwindcss/vite`; design tokens defined in `src/styles.css` (`@theme`, `[data-theme="light"]`).

**UI:**
- `class-variance-authority` + `clsx` + `tailwind-merge` — variant styling and `cn()` helper (`src/lib/utils.ts`).
- `lucide-react` — icons (`src/components/desk/app.tsx`, `src/components/desk/settings.tsx`).
- `sonner` — toasts (`src/routes/__root.tsx`).
- `@radix-ui/react-slot` — used only by `src/components/ui/button.tsx`.
- `zod` 4.5 — runtime validation of the preview postMessage envelope (`src/lib/preview-host-bridge.ts`).

**Testing:**
- Built-in `node:test` runner, no Jest/Vitest. `npm test` runs `node --test scripts/install.sh.test.mjs` plus `node --experimental-strip-types --test` over six TS suites (`package.json:24`).
- Playwright 1.63 (`chromium`) for manual browser QA scripts: `scripts/browser-smoke.mjs`, `scripts/preview-thumbnail.mjs`. Not wired into `npm test` or any npm script.

**Build/Dev:**
- `vite` (dev/build/preview), `nitro` (server output), `lightningcss`.
- `@vitejs/plugin-react` for Fast Refresh.
- Custom Vite plugins defined in-repo: `opencodeControllerPlugin`, `appEnvPlugin`, `grokPwaPlugin`, `pgliteBootstrapPlugin`, `authPopupPlugin` (`vite.config.ts`).
- `scripts/with-app-env.mjs` wraps `dev`, `build`, `build:dev`, `preview` so `.grok/app-env.json` is merged into the environment before Vite starts.

## Key Dependencies

**Critical:**
- `@tanstack/react-start` / `@tanstack/react-router` — app shell, SSR, routing.
- `react` / `react-dom` 19.2 — rendering.
- `vite` 8.2 + `nitro` — dev server and production build.
- `tailwindcss` 4.3 + `@tailwindcss/vite` — all styling.
- `zod` 4.5 — the only runtime validation library actually imported.
- `sonner`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge` — UI primitives.

**Infrastructure:**
- No HTTP client library; `fetch` and `node:http` only (`src/server/opencode-client.ts`, `src/server/http.ts`).
- No database client, ORM, or auth library is installed.
- No state-management or data-fetching library in use (no Redux, Zustand, TanStack Query in code).

**Declared but unused (template residue — do not build on these):**
- `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `cmdk`, `vaul`, `date-fns`, `react-day-picker`, `react-resizable-panels`.
- 18 of the 20 `@radix-ui/react-*` packages; only `@radix-ui/react-slot` is imported.
- `eslint-plugin-prettier` is installed but not registered in `eslint.config.mjs` (only `eslint-config-prettier` is used).

## Configuration

**Environment:**
- Runtime env vars read by code: `OPENCODE_WEB_HOST`, `OPENCODE_WEB_TOKEN`, `OPENCODE_WEB_HOME`, `OPENCODE_URL`, `OPENCODE_BIN`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `PADDY_HOME`, `PADDY_BIN_DIR`.
- Build-time / platform env vars: `VITE_PUBLIC_HOSTNAME`, `VITE_OG_SERVICE_URL`, `VITE_AUTH_ENABLED`, `VITE_PROJECT_ID`, `X_CREATOR`, `X_CREATOR_ID`, `GROK_PROJECT_ID`.
- `DATABASE_URL` is read only by `scripts/migrate.mjs`, which is not part of any npm script.
- `.grok/app-env.json` currently sets `VITE_AUTH_ENABLED: "false"` and `deploy.database: true`; only `VITE_`-prefixed string keys are honored by `scripts/with-app-env.mjs`, so `deploy.database` is inert.
- `.env` files: none present. `selfhost.env.example` documents provider keys and channel tokens that the current code does not read (see INTEGRATIONS.md).
- `config.json` (git-ignored) holds OpenCode project config, currently `{"model": "perplexity-agent/deepseek/deepseek-v4-flash-0731"}`.
- Secrets location: `~/.paddy/state.json` (mode 0600) stores the OpenCode connection password; `OPENCODE_WEB_TOKEN` comes from the process environment.

**Build:**
- `vite.config.ts` — dev server `127.0.0.1:8080` (`strictPort`), preview `127.0.0.1:8081`, `resolve.tsconfigPaths: true`.
- `tsconfig.json` — path alias `@/*` → `./src/*`, `allowJs` + `checkJs` for `scripts/migration-plan.mjs`.
- `eslint.config.mjs` — flat config: `@eslint/js` recommended, `typescript-eslint` recommended, React Hooks and React Refresh plugins; ignores `dist`, `.output`, `.vercel`, `.nitro`, `src/routeTree.gen.ts`.
- `.prettierrc` — double quotes, semicolons, trailing commas `all`, `printWidth: 100`.
- `.dockerignore`, `Dockerfile`, `docker-compose.yml` — container build and local compose run.
- `.vercel/output/` — committed prebuilt Nitro/Vercel output (`config.json`, `nitro.json`).

## Platform Requirements

**Development:**
- Node.js 22+, npm.
- OpenCode installed on `PATH`, at `~/.opencode/bin/opencode`, `/usr/local/bin/opencode`, or `/usr/bin/opencode` (detection in `src/server/runtime.ts:80-98`).
- No native build toolchain needed for the app itself; `lightningcss` provides the CSS transform.

**Production:**
- Primary target: a single local Node process serving the desk on loopback, spawning/attaching to `opencode serve` on `127.0.0.1:4096`.
- Container target: `ghcr.io/coruairc/paddy-gui:latest`, published on loopback `127.0.0.1:8080`, state volume at `/state` (`docker-compose.yml`).
- Secondary deploy target: Vercel via Nitro preset `vercel` (`.vercel/output/`, `server/middleware/grok-pwa.ts`). The controller/OpenCode integration is local-process oriented; the deployed target only exercises the static/SSR shell and platform PWA/OG chrome.

## Notable Stack Gaps

- `scripts/migrate.mjs` imports `pg`, which is not in `package.json` or the lockfile. The script is never invoked by `npm run build`, so the import is unreachable in practice.
- `vite.config.ts:34-53` defines a PGLite bootstrap plugin, but there is no `src/lib/db.ts` and no `migrations/` directory — the plugin's `hasGlobbedMigrations` guard makes it a no-op.
- `scripts/migration-plan.mjs` and its tests exist solely for that unused database path.
- No test script entry for Playwright smoke/brand checks; they must be run manually with `node scripts/browser-smoke.mjs`.

---

*Stack analysis: 2026-10-29*
