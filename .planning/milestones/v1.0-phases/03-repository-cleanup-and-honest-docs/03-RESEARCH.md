# Phase 3: Repository Cleanup and Honest Docs - Research

**Researched:** 2026-11-21
**Domain:** Repository hygiene — removing app-builder template scaffolding, unused dependencies, and dishonest documentation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at the agent's discretion — pure infrastructure/cleanup phase. Delete Grok/PWA/preview/PGlite plugins and template subsystems; remove unused heavy deps; rewrite SELFHOST.md/README.md/selfhost.env.example to describe only shipped behavior.

### the agent's Discretion
All implementation choices are at the agent's discretion.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLN-01 | App-builder template scaffolding is removed and the build no longer references it | Delete list in Architecture Patterns; rewrite `vite.config.ts` to keep only `opencodeControllerPlugin`, `tailwindcss`, `tanstackStart`, `viteReact` |
| CLN-02 | `SELFHOST.md` and `selfhost.env.example` describe only shipped behavior, or are deleted | Recommend deleting both (no code reads them); remove `pack-selfhost.mjs` and Dockerfile `COPY SELFHOST*` |
| CLN-03 | Unused heavy dependencies are removed without breaking build, lint, or tests | Removal list verified by grep in Standard Stack / Don't Hand-Roll |
| CLN-04 | `README.md` install and run instructions match what the code actually does | Rewrite against `bin/paddy.mjs` and `src/server/state.ts` (state dir via `OPENCODE_WEB_HOME`) |
</phase_requirements>

## Summary

The repository is a fork of a hosted app-builder template. Roughly 3,500 lines of Grok/PWA/preview/PGlite/auth-popup/migration/brand-check machinery are still wired into `vite.config.ts` and `src/routes/__root.tsx`, and `package.json` carries ~30 dependencies that nothing in `src/`, `server/`, or `scripts/` imports. The cleanup is mechanical: delete the template files, simplify the Vite config and npm scripts, drop the unused dependencies, and rewrite the two dishonest docs (`SELFHOST.md` describes an entirely different product; `README.md` advertises `paddy gateway/chat/models/doctor` commands that `bin/paddy.mjs` does not implement).

The single biggest risk is over-deleting a script that `npm test` or the Docker build still references (`scripts/link-cli.mjs` is needed by `postinstall`; `install.sh` is documented). Everything else in `scripts/` that is app-builder scaffolding can be deleted safely, and its co-located `*.test.mjs` must be deleted at the same time so the test list stays consistent. `zod` becomes unused once `src/lib/preview-host-bridge.ts` is deleted; removing it is optional but consistent with the "no dependency nothing imports" goal.

**Primary recommendation:** Delete the whole app-builder subsystem in one commit, rewrite `vite.config.ts` to a four-plugin list, simplify npm scripts to call Vite directly, then drop unused dependencies and rewrite docs. Verify with `npm run typecheck`, `npm run build`, `npm test`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Browser desk UI | Browser / Client | — | React components, no node imports |
| `/api` controller | API / Backend | — | `src/server/http.ts` + `api.ts`, the security boundary |
| OpenCode lifecycle | API / Backend | — | `src/server/runtime.ts` spawns/attaches `opencode serve` |
| State persistence | Database / Storage | — | `~/.paddy/state.json` via `src/server/state.ts` |
| PWA/OG chrome (removed) | CDN / Static | — | Was injected by deleted `grokPwaPlugin`; not Paddy |

## Standard Stack

### Core (kept)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` / `react-dom` | ^19.2.0 | UI rendering | [VERIFIED: package.json:62,64] |
| `@tanstack/react-start` | ^1.168.0 | SSR + dev server | [VERIFIED: package.json:54] |
| `@tanstack/react-router` | ^1.170.0 | File-based routing | [VERIFIED: package.json:53] |
| `vite` | ^8.2.0 | Dev/build | [VERIFIED: package.json:93] |
| `tailwindcss` + `@tailwindcss/vite` | ^4.3.0 | Styling | [VERIFIED: package.json:51,70] |
| `typescript` | ^5.7.0 | Type checking | [VERIFIED: package.json:91] |

### Supporting (kept)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | ^0.510.0 | Icons | [VERIFIED: src/components/desk/app.tsx] |
| `sonner` | ^2.0.7 | Toasts | [VERIFIED: src/routes/__root.tsx] |
| `class-variance-authority`, `clsx`, `tailwind-merge` | various | Styling helpers | [VERIFIED: src/components/ui/button.tsx] |
| `@radix-ui/react-slot` | ^1.2.4 | `Slot` primitive | [VERIFIED: src/components/ui/button.tsx:1] |
| `zod` | ^4.4.0 | Runtime validation | Only used by deleted preview bridge — remove or keep for future use [VERIFIED: grep shows sole use in src/lib/preview-host-bridge.ts] |

### Removed (unused heavy dependencies)

Verified by grep across `src/`, `server/`, `scripts/` — zero imports after the template deletion:

| Package | Why remove |
|---------|------------|
| `@hookform/resolvers`, `react-hook-form` | No form library usage |
| `@tanstack/react-query`, `@tanstack/react-table` | No data-fetching/table usage |
| `recharts`, `cmdk`, `vaul`, `date-fns`, `react-day-picker`, `react-resizable-panels` | No charts/command palette/drawers/dates/panels |
| `tw-animate-css` | No animation CSS import |
| 18 of 19 `@radix-ui/react-*` (all except `react-slot`) | Only `Slot` is imported |
| `playwright` | Only used by deleted `scripts/browser-smoke.mjs` |
| `nitro` | Only used for deleted Grok PWA middleware / Vercel target |
| `eslint-plugin-prettier` | Not registered in `eslint.config.mjs` |
| `pg` | Not declared but imported by deleted `scripts/migrate.mjs` (moot after deletion) |
| `zod` (optional) | Sole consumer deleted; keep only if planned for future validation |

**Installation after cleanup:** no new packages; run `npm install` to prune.

## Package Legitimacy Audit

No external packages are added in this phase. Removals are of already-installed, registry-published packages; no legitimacy gate applies. (Removed packages were originally installed as part of the template; their removal cannot introduce a supply-chain risk.)

## Architecture Patterns

### Recommended `vite.config.ts` after cleanup

```ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function bindHost(): string { /* unchanged */ }

export default defineConfig(({ command, isPreview }) => ({
  server: { host: bindHost(), port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    opencodeControllerPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}));
```

Note: `opencodeControllerPlugin` is defined locally in `vite.config.ts` and must stay. Drop the `readdirSync`/`hasGlobbedMigrations`/`pgliteBootstrapPlugin`/`authPopupPlugin`/`appEnvPlugin`/`grokPwaPlugin` imports and factories, and the Nitro block.

### Files to delete

**`src/`**
- `src/components/preview-host-bridge.tsx`
- `src/lib/preview-host-bridge.ts`
- `src/lib/preview-embedder-origin.ts`
- `src/lib/env.server.ts`
- `src/lib/og/site.json` (and `src/lib/og/` if empty)

**`src/routes/__root.tsx`** — edit, not delete: remove `PreviewHostBridge` import/usage and the `/__grok/manifest.webmanifest` + apple-touch-icon links.

**`server/`**
- `server/middleware/grok-pwa.ts` (and `server/middleware/` if empty)
- `server/virtual-grok-og-identity.d.ts`

**`scripts/`** (all app-builder scaffolding; delete with their `*.test.mjs`)
- `grok-pwa-plugin.mjs`, `grok-pwa-plugin.test.mjs`
- `grok-pwa-shared.mjs`, `grok-pwa-shared.d.mts`
- `app-env-plugin.mjs`
- `with-app-env.mjs`, `with-app-env.test.mjs`
- `migration-plan.mjs`, `migration-plan.test.mjs`
- `migrate.mjs`
- `check-auth-invariant.mjs`, `check-auth-invariant.test.mjs`
- `brand-check.mjs`, `brand-check.test.mjs`
- `write-atomic.mjs`, `write-atomic.test.mjs`
- `sign-out-plan.mjs`, `sign-out-plan.test.mjs`
- `preview.mjs`, `preview.test.mjs`
- `preview-thumbnail.mjs`
- `browser-smoke.mjs`, `browser-smoke-verdict.mjs`, `browser-smoke-verdict.test.mjs`
- `browser-guard.mjs`
- `pack-selfhost.mjs`
- `install-page.html`

**Keep:** `install.sh` (tested), `install.sh.test.mjs`, `link-cli.mjs`, `link-cli.test.mjs`. `startup.sh` references `preview.mjs` — delete it too or update; recommend delete (sandbox-only).

**Docs / config**
- Delete `SELFHOST.md`, `selfhost.env.example`.
- Rewrite `README.md` (see below).
- Edit `tsconfig.json`: remove stale comment referencing `src/lib/db.ts`; drop `allowJs`/`checkJs` if no JS remains in `src/` (verify first).
- Edit `eslint.config.mjs`: update comment "TanStack Start app-builder template".
- Edit `Dockerfile`: remove `COPY SELFHOST* ./`.
- Remove `.grok/app-env.json` (and `.grok/` if empty) since `with-app-env` is gone.

### `package.json` scripts after cleanup

```json
"dev": "vite dev --host 127.0.0.1 --port 8080",
"build": "vite build",
"build:dev": "vite build --mode development",
"preview": "vite preview",
"paddy": "node bin/paddy.mjs",
"postinstall": "node scripts/link-cli.mjs",
"typecheck": "tsc --noEmit",
"test": "node --test scripts/install.sh.test.mjs && node --experimental-strip-types --test src/server/security.test.ts src/server/http.test.ts src/server/opencode-client.test.ts src/server/api.test.ts src/server/runtime.test.ts src/server/normalize.test.ts src/server/state.test.ts src/components/autonomous-drink.test.ts src/components/desk/messages.test.ts",
"lint": "eslint .",
"format": "prettier --write ."
```

Drop `preview:restart` and `preview:stop`.

### Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OG/PWA head injection | Custom middleware | — (deleted) | Not needed for a local desk |
| PGLite migrations | Bootstrap plugin | — (deleted) | No database in Paddy |
| App-env flag carrier | `with-app-env.mjs` wrapper | Direct `vite` invocation | Removes a build indirection |

### Common Pitfalls

- **Pitfall 1: Leaving a dangling import.** After deleting files, `vite.config.ts`, `__root.tsx`, and `Dockerfile` still reference them. Grep for each deleted basename before committing.
- **Pitfall 2: npm test list drift.** `npm test` names test files explicitly; deleting a script test without editing the script breaks the run. Here the deleted tests are not in the `test` script except via glob? They are not listed, so removal is safe — but verify `npm test` still green.
- **Pitfall 3: `.grok/app-env.json` tracked file.** It is tracked despite `.grok/` being gitignored for other contents. Remove it in the same commit to avoid a dangling reference.
- **Pitfall 4: README over-claiming.** `bin/paddy.mjs` implements only `start`, `update`, `uninstall`, `doctor`, `help`, `--version`. Do not document `gateway`, `chat`, `models`, `config`, `channels`, `skills`, `memory`, `approve`, `configure`, `pairing`, `agent`. Document `npm run dev` as the direct dev path.
- **Pitfall 5: State directory.** `src/server/state.ts` uses `OPENCODE_WEB_HOME` (default `~/.paddy`, with `~/.config/opencode-web` reused by `bin/paddy.mjs` when `~/.paddy` is absent). Document `OPENCODE_WEB_HOME` as the state-directory variable (and `PADDY_HOME` as the wrapper-level override).
- **Pitfall 6: `sideEffects: false`.** `src/routes/__root.tsx` imports CSS. Consider changing to `"sideEffects": ["**/*.css"]` to avoid tree-shaking (optional, low risk).

### Code Examples

**`src/routes/__root.tsx` head after cleanup (excerpt):**

```tsx
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

// remove PreviewHostBridge import and <PreviewHostBridge />
// remove manifest/apple-touch-icon links that pointed at /__grok/*
```

**README install/run skeleton (honest):**

```bash
npm install
npm run dev        # desk + controller at http://127.0.0.1:8080
npm run build
npm run preview
npm test
npm run typecheck

# or, after the installer:
paddy              # starts the desk
paddy update       # pull + reinstall
paddy uninstall    # remove wrapper only
paddy doctor       # print install/runtime info
paddy --version
```

Environment variables to document: `OPENCODE_WEB_HOST`, `OPENCODE_WEB_TOKEN`, `OPENCODE_WEB_HOME`, `OPENCODE_URL`, `OPENCODE_BIN`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `PADDY_HOME`, `PADDY_BIN_DIR`.

### State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| App-builder template with Grok PWA chrome | Plain Vite + TanStack Start | This phase | Smaller bundle, no outbound reference surface |
| 30 unused deps | Only imported deps | This phase | Faster install, smaller audit surface |

**Deprecated/outdated:**
- `SELFHOST.md` — describes a different product entirely; delete.
- `selfhost.env.example` — documents provider keys Paddy never reads; delete (OpenCode owns provider auth).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `zod` has no remaining import after preview-bridge deletion | Standard Stack | Low — keep it if a future phase wants validation |
| A2 | `.grok/` can be removed entirely | Architecture Patterns | Low — check for other tracked contents first |
| A3 | `startup.sh` is safe to delete | Files to delete | Low — sandbox-only, not referenced by Dockerfile |

## Open Questions

1. **Keep or delete `zod`?** No remaining import after cleanup. Recommend delete to honor "no unused deps"; keep if Phase 4+ plans validation. [VERIFIED: grep]
2. **Keep Nitro for Vercel?** README/container path does not use Vercel; committed `.vercel/output/` is stale. Recommend removing Nitro from the build; leave committed output for a follow-up. [ASSUMED]
3. **`sideEffects` field.** Recommend `"sideEffects": ["**/*.css"]` but optional. [ASSUMED]

## Environment Availability

No new external dependencies. Existing tools (Node 22+, npm) already required by `bin/paddy.mjs` and `install.sh`. No environment probe needed for this phase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in) |
| Config file | none |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLN-01 | Build references no template plugins | build + typecheck | `npm run build && npm run typecheck` | ✅ |
| CLN-02 | Docs describe shipped behavior | manual review | read `README.md` | manual |
| CLN-03 | Unused deps removed, tests green | test | `npm test` | ✅ |
| CLN-04 | README matches `bin/paddy.mjs` | manual review | read `README.md` vs `bin/paddy.mjs` | manual |

### Sampling Rate
- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run build && npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Remove deleted script tests from any documentation that lists them (`.planning/codebase/TESTING.md` is stale but not a gate).
- [ ] Ensure `npm test` still lists only surviving test files.

*(No new test files required — this phase deletes code and updates docs.)*

## Security Domain

No security-relevant changes. Existing controls in `src/server/security.ts` (peer auth, origin check, workspace allowlist, secret redaction) are untouched. ASVS categories V2/V3/V4/V6 not applicable to this phase; V5 (input validation) remains handled by `validateWorkspacePath` and `safeJson`.

### Known Threat Patterns for {stack}
No new threat patterns introduced by deletion. Removing the Grok PWA middleware eliminates an outbound-reference surface (`grok.com` extensions script injection) — a net security improvement.

## Sources

### Primary (HIGH confidence)
- `.planning/codebase/CONCERNS.md` — app-builder scaffolding file list and unused-dependency inventory
- `.planning/codebase/TESTING.md` — unrun test files list
- `vite.config.ts`, `package.json`, `tsconfig.json`, `eslint.config.mjs` — verified by Read this session
- `bin/paddy.mjs`, `src/server/state.ts` — verified by Read this session
- `src/`, `server/`, `scripts/` — import usage verified by grep this session

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` — phase success criteria

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against `package.json` and grep
- Architecture: HIGH — verified against source and codebase concerns doc
- Pitfalls: MEDIUM — derived from codebase concerns doc

**Research date:** 2026-11-21
**Valid until:** 2026-12-21
