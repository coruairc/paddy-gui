---
last_mapped_commit: d358aee016758bde70bd5b2782a5b1ebf27b6aba
last_mapped_at: 2026-10-29
---
# Coding Conventions

**Analysis Date:** 2026-10-29

## Naming Patterns

**Files:**
- kebab-case for every source file, including React components: `src/components/paddy-mascot.tsx`, `src/components/preview-host-bridge.tsx`, `src/server/opencode-client.ts`, `scripts/write-atomic.mjs`.
- UI primitives are single lowercase words under `src/components/ui/`: `button.tsx`, `input.tsx`, `badge.tsx`.
- Hooks live in their own file prefixed `use-`: `src/components/use-autonomous-drink.ts` exports `useAutonomousDrink`.
- Tests are co-located and mirror the source basename: `src/server/api.ts` → `src/server/api.test.ts`, `scripts/preview.mjs` → `scripts/preview.test.mjs`.
- TanStack Start routes use framework names: `src/routes/__root.tsx`, `src/routes/index.tsx`. `src/routeTree.gen.ts` is generated — never edit it (also ignored by ESLint).

**Functions:**
- camelCase, verb-first: `handleApi`, `validateWorkspacePath`, `redactSecrets`, `groupSessionsByDate`, `summarizeSession`.
- Boolean predicates start with `is`/`has`/`looksLike`/`can`: `isLoopbackAddress`, `isMigrationFile`, `hasGlobbedMigrations`, `looksLikePreviewProcess`, `originAllowed`.
- Argument parsers are `parseX` and return a result object, never throw: `parsePreviewArgs`, `parsePid`, `parsePgid`, `parseListenerInodes`, `parseWriteAtomicArgs`, `parseBrandCheckArgs`.
- Shape converters are `toX` / `normalizeX` / `publicX`: `toChatMessage`, `toDiffFile`, `normalizeEvent`, `normalizeState`, `publicState`.
- Error message helpers are `xError`/`xResult`: `errorResult` (`src/server/api.ts`), `errorMessage` (`src/lib/error-component.tsx`), `stagingError` (`scripts/write-atomic.mjs`).

**Variables:**
- camelCase locals. Short map/filter callback names are normal: `item`, `entry`, `current`, `node`, `part`.
- Module-level constants are SCREAMING_SNAKE_CASE: `EMPTY_STATE`, `CONTROLLER_VERSION`, `DEFAULT_DRINK_CONFIG`, `TEMPLATE_ROOT`, `MAX_CARD_BYTES`, `OG_PENDING_REL_PATH`, `SECRET_KEY`, `TOOL_LABELS`, `LOOPBACK_HOSTS`.
- Numeric literals use `_` separators for readability: `86_400_000`, `30_000`, `1_000_000` (`src/lib/utils.ts`, `src/components/autonomous-drink.ts`).
- Booleans exposed to the browser are named as facts, not flags: `hasConnectionPassword` in `publicState` (`src/server/state.ts`).
- Private class members use the `private` keyword, never `#` fields: `private child`, `private listeners` (`src/server/runtime.ts`), `private readonly fetchImpl` (`src/server/opencode-client.ts`).

**Types:**
- `export type X = { ... }` is the default (≈39 `type` aliases vs ≈10 `interface` declarations). Reserve `interface` for public contract objects with per-field doc comments: `AutonomousConfig`, `AutonomousClock`, `AutonomousHooks`, `AutonomousController` (`src/components/autonomous-drink.ts`), `UseAutonomousDrinkOptions` (`src/components/use-autonomous-drink.ts`).
- Discriminated unions carry a literal `type` field: `GuiEvent` (`src/server/normalize.ts`), `DeskEvent` (`src/lib/desk/client.ts`), `PathCheck` (`src/server/security.ts`), `ApiResult` (`src/server/api.ts`).
- String unions replace enums: `"dark" | "light"`, `"once" | "always" | "reject"`, `"idle" | "drink"`.
- `as const` arrays derive union members: `const SECTIONS = [...] as const; type Section = (typeof SECTIONS)[number];` (`src/components/desk/settings.tsx`).
- Optional fields use `?`, not `| undefined`: `binary?: string`, `error?: string` (`src/server/runtime.ts`).
- `unknown` plus narrowing is preferred over `any`, even though `@typescript-eslint/no-explicit-any` is off.

## Code Style

**Formatting:**
- Prettier is the only formatter. `.prettierrc`: `semi: true`, `singleQuote: false` (double quotes), `trailingComma: "all"`, `printWidth: 100`. No `.editorconfig`, no `.prettierignore`.
- `npm run format` → `prettier --write .`

**Linting:**
- ESLint 9 flat config in `eslint.config.mjs`: `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-plugin-react-hooks` recommended + `react-refresh` + `eslint-config-prettier` last.
- Rules that matter when writing code:
  - `@typescript-eslint/no-unused-vars`: `warn`, with `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"` — prefix intentionally unused params with `_` (e.g. `(_dir: string, _id: string, patch)` in `src/server/api.test.ts`).
  - `@typescript-eslint/no-explicit-any`: `off`.
  - `react-refresh/only-export-components`: `warn` with `allowConstantExport: true` — component files should export components plus constants, not helper functions.
- Ignores: `dist/**`, `.output/**`, `.vercel/**`, `.nitro/**`, `node_modules/**`, `src/routeTree.gen.ts`.
- `npm run lint` → `eslint .`

**Type checking:**
- `tsconfig.json` is `strict: true`, `noEmit: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `isolatedModules: true`, `allowImportingTsExtensions: true`, `allowJs` + `checkJs` on.
- `npm run typecheck` → `tsc --noEmit` over `src` and `server`.
- `src/lib/harness/setup-model-picker.test.mjs` is explicitly excluded in `tsconfig.json`.

## Import Organization

**Order (observed):**
1. Node builtins with the `node:` prefix — `import { mkdtempSync } from "node:fs";`, `import test from "node:test";`
2. External packages — `react`, `lucide-react`, `@tanstack/react-router`, `sonner`
3. Internal `@/` aliases — `@/components/...`, `@/lib/...`
4. Relative imports — `./api.ts`, `./security.ts`

Example (`src/components/desk/app.tsx:1-21`): `react` → `lucide-react` → `@/components/*` → `@/lib/utils` → `@/lib/desk/client`.

**Path Aliases:**
- `@/*` → `./src/*` (`tsconfig.json` `paths`, mirrored by Vite).
- Browser/client code uses `@/`. Server code under `src/server/` uses relative imports with explicit `.ts` extensions (`import { handleApi } from "./api.ts";`) because `allowImportingTsExtensions` is enabled and the files run under Node's type stripping.
- Type-only imports are inline: `import { clsx, type ClassValue } from "clsx";`, `import { normalizeEvent, type GuiEvent } from "./normalize.ts";`

**Scripts (`scripts/*.mjs`):**
- Plain ESM with `.mjs`. `// @ts-check` only where the module is consumed by checked TS (`scripts/migration-plan.mjs`, `scripts/sign-out-plan.mjs`).
- Testable pure helpers are exported and the CLI entry is guarded:
  ```js
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // CLI body
  }
  ```
  (`scripts/preview.mjs:332`, `scripts/brand-check.mjs:196`). `scripts/check-auth-invariant.mjs:107` uses the shared `isMainModule()` from `scripts/with-app-env.mjs` instead — prefer that helper in new scripts.

## Error Handling

**Server (`src/server/*.ts`):**
- Domain errors are thrown as `OpenCodeError(status, message, retryable)` (`src/server/opencode-client.ts:46`) and caught once in `handleApi`, converted by `errorResult` into `{ status, body: { error, retryable } }` (`src/server/api.ts:419`). `status === 0` maps to 503.
- Validation does **not** throw; it returns a discriminated result: `{ ok: true, path } | { ok: false, error }` (`validateWorkspacePath`, `safeJson` in `src/server/security.ts`). Callers convert failures into `OpenCodeError(400, ...)` at the boundary (`readBody`, `requireProject`).
- Ignored failures use a bare `catch {}` with a comment explaining why:
  ```ts
  } catch {
    /* config is optional on first paint */
  }
  ```
  (`src/server/api.ts:85`), `/* try next */` (`src/server/runtime.ts:94`), `/* client disconnected */` (`src/server/http.ts:59`).
- Best-effort side effects use `.catch(() => undefined)` (`src/server/api.ts:331`).
- Secrets are stripped at the boundary with `redactSecrets(...)` before any response leaves the controller (`src/server/api.ts:101`, `src/server/api.ts:332`).

**Browser (`src/components`, `src/lib`):**
- HTTP failures throw `Error(data.error || \`Request failed (${response.status})\`)` in the single `request<T>()` helper (`src/lib/desk/client.ts:105`).
- Components catch and narrow to a user-facing string, then set local state — never rethrow:
  ```ts
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not add that project");
  }
  ```
  (`src/components/desk/app.tsx:199-201`; same shape at `:216`, `:243`, `:275`, `:293`).
- Optional reads degrade silently: `api.config().catch(() => ({} as Record<string, unknown>))` (`src/components/desk/app.tsx:184`).
- Route-level crashes render `AppErrorComponent` via `errorMessage()` fallback (`src/lib/error-component.tsx`).

## Logging

**Framework:** None. No logger dependency, no `console.*` calls in `src/` (only `vite.config.ts` uses `console.error`).

**Patterns:**
- CLI scripts log with a bracketed script tag: ``console.log(`[preview] serving ${PREVIEW_URL} ...`)``, `[migrate]`, `[with-app-env]`, `[app-builder]`.
- Machine-readable script output is a JSON object: `console.error(JSON.stringify({ ok: false, error: args.error }, null, 2))` (`scripts/browser-smoke.mjs:25`), `console.log(JSON.stringify(verdict, null, 2))` (`:160`).
- The UI surfaces failures through a single `error` state rendered in the desk and through `sonner` `<Toaster />` mounted in `src/routes/__root.tsx` (no `toast.*` calls exist yet).

## Comments

**When to Comment:**
- Every server module opens with a JSDoc block stating the invariant it protects, e.g. `src/server/security.ts:1-4` ("The browser is never trusted"), `src/server/api.ts:1-4`, `src/server/state.ts:1-5`, `src/server/http.ts:1-4`.
- Comments explain *why*, not *what*: `// A controller restart must not lose the password of a server it spawned,` (`src/server/runtime.ts:55`), `// pid 1 is the sandbox init, never a preview server.` (`scripts/preview.test.mjs:33`).
- Section dividers with box-drawing characters group related tests: `// ── Deployed ───────` (`scripts/sign-out-plan.test.mjs:111`).

**JSDoc/TSDoc:**
- JSDoc on exported functions in `.mjs` helpers, often with `@param`/`@returns` in `@ts-check` files (`scripts/migration-plan.mjs`, `scripts/sign-out-plan.mjs`).
- JSDoc on exported TS functions when behavior is non-obvious: `authorizePeer`, `originAllowed`, `validateWorkspacePath`, `redactSecrets` (`src/server/security.ts`), `useAutonomousDrink` (`src/components/use-autonomous-drink.ts`).
- 93 top-of-block `/**` comments across `src`, `server`, `scripts`.
- Inline field docs inside interfaces are common: `/** Never serialized to the browser. */` (`src/server/state.ts:28`).

## Function Design

**Size:** Small pure helpers; the router `handleApi` is a flat if-chain of one-line dispatches delegating to named handlers (`src/server/api.ts:23-60`). Large UI files are split by local sub-components in the same file (`src/components/desk/app.tsx` defines `MessageView`, `ActivityRow`, `PermissionCard`, `WorkList`, `ChangesList` at the bottom).

**Parameters:**
- Single primitive args where possible; an options object for >2 knobs: `new OpenCodeClient({ baseUrl, password, fetch })`, `useAutonomousDrink({ config, suspended })`.
- Injected side-effect dependencies rather than module mocking: `fetch` (`ClientOptions.fetch`), clock `{ setTimeout, clearTimeout, random }` (`AutonomousClock`).
- Env-derived config is injectable for tests: `stateFilePath(env = process.env, home = homedir())` (`src/server/state.ts:45`).
- Unused params are prefixed `_`.

**Return Values:**
- Validation returns `{ ok }` unions; mutation functions return the updated entity or `void`.
- Handlers return `Promise<ApiResult>` (`{ status, body, stream? }`) rather than writing to the response directly — the Node adapter (`handleNode`) owns I/O.
- Unsubscribe functions are returned from subscriptions: `subscribe(listener): () => void` (`src/server/runtime.ts:64`).

**Async:** `async`/`await` throughout; `.then` is not used. De-duplicate concurrent work with a cached promise (`private connecting: Promise<ConnectionStatus> | null`, `src/server/runtime.ts:50,100-106`).

## Module Design

**Exports:**
- Named exports only. One default export exists in the whole repo: `server/middleware/grok-pwa.ts:63`.
- UI primitives export the component and its variants at the bottom: `export { Button, buttonVariants };` (`src/components/ui/button.tsx:45`), `export { Input };` (`src/components/ui/input.tsx:20`).
- The browser API surface is a single object of thin functions: `export const api = { bootstrap, connect, addProject, ... }` (`src/lib/desk/client.ts:118-172`).

**Barrel Files:** None. Import the concrete module path (`@/lib/utils`, `@/components/ui/button`).

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

---

*Convention analysis: 2026-10-29*
