# Stack Research

**Domain:** v1.1 features for Paddy (local OpenCode web desk): chat-header model picker, slash-command composer palette, v2 hardening
**Researched:** 2026-11-21
**Confidence:** MEDIUM — the core recommendation ("add nothing") follows from direct codebase inspection (local, verifiable) plus the milestone constraints; the OpenCode v2 wire shapes are corroborated across three independent sources (official OpenAPI document, the repo's live-captured V2-MIGRATION-SPEC, and the already-implemented model endpoints in `src/server/opencode-client.ts`). Note: the GSD classify-confidence seam returned `LOW` for all web-sourced digests in this environment (it cannot verify provider provenance without package metadata), so web-derived claims below are tagged with their corroboration basis rather than presented as sole-source authority.

## Recommended Stack

**Headline: zero new dependencies — runtime or dev.** Everything the model picker, slash-command palette, and v2 hardening need is already installed or built into the platform. The work is new code modules against existing seams, not new libraries.

### Core Technologies (already installed — no `npm install` needed)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 19.2 | Both widgets are plain controlled components | The picker is a **select-only combobox** and the palette is an **editable combobox with list autocomplete** per the WAI-ARIA APG — a `<button>`/`<textarea>` + conditional listbox + `useState`/`useRef`/`useId` is the complete toolkit. No headless-ui/radix-select needed for two widgets |
| Tailwind CSS | 4.3 | All picker/palette styling | Existing semantic tokens (`bg-elevated`, `border-border`, `text-muted`, `text-accent`) already define the visual language; no new CSS dependencies or component stylesheets |
| OpenCode v2 HTTP API | v2.3.2 (local server) | Data source for models and commands | `GET /api/model` returns `Model.Info[]` (fields: `id`, `modelID`, `providerID`, `name`, `status`, `enabled`, `limit`) — groupable by `providerID` as-is. `GET /api/command` returns `Command.Info[]` = `{name, description?}`. `POST /api/session/{id}/command` takes `{name, text}` (+ optional attachments), returns 204. `POST /api/session/{id}/model` takes `{model: Model.Ref}` = `{id, providerID, variant?}` — exactly what `opencode-client.ts:196` already sends |
| `~/.paddy/state.json` persistence (`src/server/state.ts`) | existing | Persisted desk model choice (V2-02) | One new `AppState` field (`deskModel`) + `normalizeState`/`publicState` projection. Atomic `0600` writes already exist; no storage library is warranted for one JSON field, and v2 has no remote global-config write (`PATCH /api/config` → 404) so Paddy state is the only correct home |
| `node:test` + `node:assert/strict` | Node 22 built-in | All unit tests for the new logic | Constraint-mandated. Keep picker/palette logic in plain `.ts` helper modules (repo convention, cf. `autonomous-drink.ts`) so `node --experimental-strip-types --test` covers grouping, filtering, and keyboard-reducer functions without jsdom |
| `node:test` built-in mock (`node:test` `mock` / `t.mock`, `node:mock/timers`) | Node 22 built-in | V2-01 hermetic tests | Node's test runner ships `mock.fn()` and fake timers (`node:mock/timers` with `setTimeout`/`setInterval`) since Node 20/22 — enough to stub the port probe and clock in `runtime.test.ts` without adding sinon/sinon-like or testdouble. **Zero-dep answer to the hermetic-suite requirement** |
| Playwright | 1.63 (devDependency, present) | Browser-level verification of picker/palette keyboard behavior | Already used for `scripts/browser-smoke.mjs`. Extend the smoke script to open the picker, arrow through options, and run a `/` command — this is the only place DOM interaction can be verified without adding jsdom/RTL |

### Supporting Libraries (new code modules, not packages)

| Module | Purpose | When to Use |
|---------|---------|-------------|
| `src/server/opencode-client.ts` — add `listCommands(dir)` + `runCommand(dir, id, name, text)` | The only place OpenCode's HTTP surface may be known (repo invariant) | **Required.** ⚠️ The milestone context says the controller "already speaks" `/api/command` and `/api/session/{id}/command` — it does not. `grep` over `opencode-client.ts` finds zero command methods; only `/api/model`, `/api/model/default`, `/api/session/{id}/model`, `/api/session/{id}/prompt` exist. The two command endpoints must be added |
| `src/server/api.ts` — `GET /api/commands` passthrough + command-run route; `settings` PATCH for `deskModel` | Route table entries following the existing handler pattern (`{status, body}` `ApiResult`) | Commands list can ride the existing `location[directory]` scoping and `redactSecrets` boundary unchanged. The desk-model persistence belongs on the existing `PATCH /api/settings` route (already writes Paddy state) rather than a new route |
| `src/server/normalize.ts` — map `Session.Message.ModelSelected` (v2 message type) to a system line | Model switches should be visible in the thread | V2-MIGRATION-SPEC already reserves this mapping ("model-switched … map to system") |
| `src/lib/desk/client.ts` — `api.commands()`, `api.runCommand()`, `settings` body extension; `CommandInfo` browser type | Browser half of the duplicated-type contract (by design) | Mirror `Command.Info = {name, description?}`; browser never imports server modules |
| Pure helper module (e.g. `src/components/desk/command-palette.ts` or `picker-logic.ts`) — `groupModelsByProvider()`, `filterCommands(query, commands)`, `nextIndex(key, current, length)` | All testable logic outside React | The repo's stated convention: "keep logic in plain `.ts` modules … so it stays unit-testable". `nextIndex` implements APG arrow/Home/End wrap behavior as a pure function |
| `src/components/desk/model-picker.tsx` | Chat-header select-only combobox | APG pattern: trigger button (`aria-haspopup="listbox"`, `aria-expanded`), popup `role="listbox"` with `role="option"` items + `aria-selected`, grouped under non-interactive provider headings, DOM focus stays on the trigger with `aria-activedescendant` pointing at the highlighted option |
| Composer palette (extend `app.tsx` composer, or a sibling component) | `/`-triggered editable combobox | Opens when the composer text starts with `/` and the cursor is in the first word; ArrowUp/Down + Home/End move the highlight, Enter runs the highlighted command, Escape closes the palette without clearing text (manual-selection semantics), Tab closes and continues typing. While the palette is open the composer's existing `onKeyDown` handler must delegate these keys to the palette |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `npm test` (node:test) | New suites: extend `opencode-client.test.ts` (command methods, v2 shapes), `state.test.ts` (`deskModel` normalization + publicState omission rules), plus a new pure-logic suite for grouping/filtering/`nextIndex` | Follow the fixture style already used for model endpoints (`{data: ...}` envelope, Basic auth, injectable `fetch`) |
| `npx tsc --noEmit` | New duplicated types (browser `CommandInfo`) must stay in sync manually | The client/server type duplication is a deliberate architectural constraint — no shared type package |
| Playwright smoke extension | Manual keyboard-path QA | Not wired into `npm test`; run `node scripts/browser-smoke.mjs` style scripts by hand, as today |

## Installation

```bash
# Nothing. Zero new packages.
# All additions are new source modules under src/ and src/server/.

# Optional, already available:
# node scripts/browser-smoke.mjs   (Playwright, manual QA of keyboard paths)
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hand-built APG combobox (~150 lines across two components) | `cmdk` 1.1.1 (npm latest, MIT, ~5KB, 13.2k★) | Almost never here. The inline `Command` component is dependency-light, but `Command.Dialog` — the main draw — composes Radix Dialog, and cmdk's runtime deps pull in 4 Radix packages (`@radix-ui/react-id`, `@radix-ui/react-dialog`, `@radix-ui/react-primitive`, `@radix-ui/react-compose-refs`). Paddy's palette must anchor **inline above the composer textarea**, not in a modal, which is cmdk's weakest configuration. Revisit only if a future milestone wants a global ⌘K modal palette — and treat that as the stack-change decision it is |
| Hand-built listbox + `aria-activedescendant` | `@radix-ui/react-select` or `@radix-ui/react-popover` | Only if the picker grows needs beyond a simple grouped list (typeahead with deletion, combobox filtering of hundreds of models). Two Radix widgets installed (`switch`, `tabs`, `tooltip`, …) already cover real cases; a select is not one. Keep the boundary deliberate: every component-lib add is a stack decision |
| `useState` + fetch-on-connect (existing desk pattern) | TanStack Query (installed-era dep, no longer in `package.json`) | Never in this milestone — constraint. Commands (`GET /api/command`) and models (via `api.providers()`) are fetched once per connect and held in local state, exactly like sessions/providers today |
| Plain case-insensitive substring match (`name.includes(query)`) | `fuse.js` 7.5.0 (Apache-2.0, zero deps, ~6KB) | Only if command lists grow past a few hundred entries or users demand fuzzy matching. For <100 short command names, substring matching is deterministic, trivially unit-testable under `node:test`, and predictable for users — fuzzy rank ordering is neither |
| `node:test` + `node:mock/timers` | jsdom + @testing-library/react for component tests | Only if the repo later decides DOM-level unit tests are worth a dev-dependency bump — that is an explicit stack change outside this milestone. Until then: pure helpers for logic, Playwright for DOM truth |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Jest / Vitest | Explicit milestone constraint; would also invalidate the `node --experimental-strip-types --test` invocation wired into `npm test` | `node:test` with `mock.fn()` and `node:mock/timers` |
| State libraries (Zustand, Redux, Jotai) | Explicit constraint; both widgets need one `useState` for open/highlight and one derived list — a store would be pure overhead | Local `useState`/`useRef`, following `app.tsx`'s existing functional-updater style |
| Component libraries (cmdk, headlessui, radix-select/popover, downshift) | Constraint + wrong shape: the palette is composer-anchored, not modal; the picker is one grouped list. Each library drags 1–5 transitive packages into a bundle that today has none of them | Two small hand-built components implementing the APG combobox/listbox contract |
| `@floating-ui/react-dom` for popup positioning | The picker popup anchors inside the chat header's relative container and the palette anchors above the composer — fixed local positions. Viewport-flip logic solves a problem a local desk app doesn't have | Absolute positioning within a `relative` parent + `max-height` + `overflow-y: auto` |
| Virtualization (react-window etc.) | Model lists may reach a few hundred entries across providers — a scrolling `max-height` listbox handles that fine at 60fps; measured jank is the only trigger to reconsider | Plain scrollable listbox; add virtualization only if a real profile shows paint cost |
| Re-scraping the OpenCode CLI or inventing command semantics client-side | Commands are server-defined prompt templates (`Config.CommandEncoded.template`); the browser cannot know their list without `GET /api/command` | Controller passthrough: `opencode-client.ts` → `api.ts` → `client.ts` |
| Persisting the desk model via `PATCH /api/config` on OpenCode | v2 removed remote global-config writes (`PATCH /api/config` → 404; `/api/experimental/config` accepts only `{shell}`) — this is the V2-02 bug being fixed | `deskModel` field in `~/.paddy/state.json`, applied per-session on send via `POST /api/session/{id}/model` |

## Stack Patterns by Variant

**Model picker (select-only combobox):**
- Trigger = a header button showing the current model's short name; popup = provider-grouped listbox
- Group by `Model.Info.providerID`; filter to `enabled !== false` and `status !== "deprecated"`; render `name` with `modelID` as muted detail; sort providers alphabetically, models by name
- Keyboard: Enter/Space/Down Arrow opens; ArrowUp/Down move highlight (wrapping is optional per APG — pick non-wrapping to match native select feel); Enter selects; Escape/Tab/Outside-click closes without change
- Selection sets the desk default (persisted via settings → `state.deskModel`); it is applied per-session on send — `api.send` already threads `model` and `opencode-client.sendMessage` already POSTs `/api/session/{id}/model` before prompting

**Slash-command palette (editable combobox, `aria-autocomplete="list"`, manual selection):**
- Open condition: composer value starts with `/` and the caret is within the first whitespace-delimited token; query = the token minus the leading `/`
- Filtering: `command.name.toLowerCase().includes(query)` — exact, testable
- Enter with a highlighted option runs `POST /api/session/{id}/command` with `{name, text}` where `text` is the remainder after the command token (args); Enter with no palette passes through to normal send; Escape closes the palette first, then (second press) would clear — preserve typed text per manual-selection semantics
- Errors: synchronous failures (404 `CommandNotFoundError`, 500 `CommandExecutionError`) already map through `OpenCodeError` → `errorResult` → the desk's existing error state; in-flight failures surface as `session.execution.failed` events, which the existing normalizer turns into thread error messages — CMD-02 needs no new error channel

**Hermetic v2 tests (V2-01):**
- `runtime.test.ts` "spawn uses detached:true" must stop attaching to whatever holds port 4096: inject/override the port-probe and spawn target (env var or constructor injection, matching the repo's injectable-dependency convention), stub with `mock.fn()`; no live server required

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| cmdk 1.1.1 (rejected) | React 19 ✓ | Peer range `react ^18 \|\| ^19` — compatibility was never the blocker; deps and shape were |
| OpenCode public OpenAPI (docs, 2026-11) | Installed server v2.3.2 — **verify** | The published `/docs/openapi.json` (doc version 0.0.1) describes a **newer** OpenCode than the installed v2.3.2. `Command.Info {name, description}` and the `{name, text}` run body are from that doc; the repo's V2-MIGRATION-SPEC does not cover commands. **Before planning the command phase, capture the command endpoints from the local server's own `/openapi.json`** (auth: Basic `opencode:<ownedServerPassword>` — read via the controller, never echo it). Model endpoints, by contrast, are already implemented and running against v2.3.2, so their shapes are confirmed |
| `node:mock/timers` | Node 22+ ✓ (since 20.x) | Safe under the enforced Node 22 floor; no flags needed |
| Playwright 1.63 (devDep) | Existing smoke scripts | Extending the script adds no dependency and no CI wiring change |

## Integration Map (where each feature lands)

| Concern | File | Change |
|---------|------|--------|
| List commands | `src/server/opencode-client.ts` | NEW `listCommands(dir)` → `GET /api/command` (unwrap `{data}`) |
| Run command | `src/server/opencode-client.ts` | NEW `runCommand(dir, id, name, text)` → `POST /api/session/{id}/command` |
| Command routes | `src/server/api.ts` | NEW `GET /api/commands`, `POST /api/sessions/:id/command` (existing error mapping) |
| Desk model persistence | `src/server/state.ts` + `api.ts` settings route | `AppState.deskModel: {id, providerID} \| null`; normalize + project in `publicState`; written via existing `PATCH /api/settings` |
| Model-switch thread lines | `src/server/normalize.ts` | `Session.Message.ModelSelected` → system message (spec-reserved mapping) |
| Browser API | `src/lib/desk/client.ts` | `api.commands()`, `api.runCommand(id, name, text)`, `CommandInfo` type, settings body carries `deskModel` |
| Picker UI | `src/components/desk/model-picker.tsx` (new) | APG select-only combobox; mounted in the chat header in `app.tsx` |
| Palette UI | `app.tsx` composer + pure helpers | `/`-token detection, filtering, key delegation, run-on-Enter |
| Tests | `opencode-client.test.ts`, `state.test.ts`, `api.test.ts`, new pure-logic suite | v2 envelope fixtures; `deskModel` normalization; `nextIndex`/`filterCommands`/`groupModelsByProvider` |

**Boundary invariants preserved:** all `node:*` access stays in `src/server/*`; the browser sees only `/api` JSON + SSE; OpenCode stays authoritative for the model and command lists; Paddy stores only the chosen default.

## Sources

- **OpenCode official API docs + OpenAPI 3.1 document** — https://opencode.ai/docs/server/ and https://opencode.ai/docs/openapi.json (fetched 2026-11-21). Confirms `/api/command` (list), `POST /api/session/{sessionID}/command` (`{name, text}` body, 204, CommandExecutionError 500), `GET /api/model` (`Model.Info` full field set incl. `enabled`/`status`/`providerID`), `POST /api/session/{sessionID}/model` (`Model.Ref`). Command routes are flagged **Experimental** upstream. Corroboration: high (matches implemented code for model endpoints), but the doc targets a newer server than v2.3.2 — tag commands MEDIUM until captured from the local `/openapi.json`
- **`.planning/V2-MIGRATION-SPEC.md`** (repo, live-captured from v2.3.2) — v2 envelope, `location` scoping, event names, no-global-config-write fact; basis for V2-02's per-session model path
- **`.planning/PROJECT.md`** (repo) — milestone requirements MODEL-01/02, CMD-01/02, V2-01/02 and the no-new-heavyweight-deps constraints
- **Codebase inspection** (direct, 2026-11-21): `package.json` (post-v1.0 dependency set), `src/server/opencode-client.ts`, `src/server/state.ts`, `src/lib/desk/client.ts`, `src/components/desk/app.tsx` — established the `/api/command` client-method gap, the existing per-session model POST, and the providers-grouping data path
- **WAI-ARIA Authoring Practices Guide — Combobox Pattern** — https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ (W3C primary source, fetched 2026-11-21): keyboard interaction, `aria-activedescendant`, roles/states for both widget variants
- **cmdk** — npm registry (latest = 1.1.1, deps: 4 Radix packages) + https://github.com/pacocoursey/cmdk README (fetched 2026-11-21): composition and dependency footprint used for the rejection rationale
- **fuse.js** — npm registry (latest = 7.5.0, Apache-2.0, zero deps): size/scope basis for rejection
- GSD classify-confidence seam returned LOW for all web-derived digests in this environment (no package metadata available to the seam); web claims above are therefore stated with their corroboration basis, and the central recommendation rests on local code + constraints, not on web sources

---
*Stack research for: Paddy v1.1 — model picker, slash commands, v2 hardening*
*Researched: 2026-11-21*
