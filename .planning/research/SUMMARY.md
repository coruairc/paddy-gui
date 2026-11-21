# Project Research Summary

**Project:** Paddy — v1.1 milestone (chat-header model picker, slash-command palette, v2 hardening)
**Domain:** Local web UI ("desk") driving a locally-running `opencode serve` v2 over HTTP/SSE
**Researched:** 2026-11-21
**Confidence:** MEDIUM-HIGH overall (repo-read facts HIGH; v2 command endpoints MEDIUM pending live capture)

## Executive Summary

Paddy v1.1 is two UI affordances plus two hardening fixes, added to a single-process, two-half architecture that research confirms is already shaped for them. The controller (Node, `src/server/*`) is the security boundary and the only OpenCode adapter; the browser (React/TanStack Start, no `node:*` imports) sees only `/api` JSON + SSE. Critically, research found the **server half of the model picker already exists**: `opencode-client.ts` already POSTs `/api/session/{id}/model` before prompting on every send, and `app.tsx` already holds `model` state. MODEL-01/02 are mostly a UI + persistence problem. Slash commands need the full four-layer addition (`opencode-client` method → `api.ts` route → `client.ts` method → UI), and the milestone context's claim that the controller "already speaks" the command endpoints is **wrong** — zero command methods exist today.

The recommended approach is **zero new dependencies**. Both widgets are hand-built WAI-ARIA APG comboboxes (~150 lines each) using React state, Tailwind semantic tokens, and pure `.ts` helper modules kept DOM-free for `node:test`. All libraries considered (cmdk, radix-select, fuse.js, TanStack Query, jsdom/RTL) are rejected as constraint violations or wrong-shape. The desk-model default persists as one new `AppState.deskModel` field in `~/.paddy/state.json` (v2 removed remote global-config writes — `PATCH /api/config` → 404 — which is the V2-02 bug), and the dead `updateConfig` chain gets deleted rather than try/caught.

The key risks are, in order: (1) **`redactSecrets` corruption** — its substring needle replacement previously mangled provider ids like `alibaba-token-plan` in this very repo, and v1.1 routes identifier-shaped payloads (model ids, command names) through that boundary for the first time; regression fixtures are required before any new route. (2) **Model authority drift** — the header showing model X while the session runs Y; mitigated by `session.model.selected` SSE reconciliation landing *with* the picker, not after. (3) **Environment-dependent tests** — the currently red `runtime.test.ts` probe on port 4096 must be fixed first, or every later phase's "npm test green" gate is meaningless.

## Key Findings

### Recommended Stack

**Headline: zero new packages — runtime or dev.** All work is new code modules against existing seams. Detailed rationale in [STACK.md](./STACK.md).

**Core technologies (all already installed):**
- **React 19.2** — both widgets are plain controlled components (select-only combobox + editable combobox per WAI-ARIA APG); no headless library needed
- **OpenCode v2 HTTP API (v2.3.2 local)** — `GET /api/model` (`Model.Info[]`, groupable by `providerID`), `GET /api/command` (`Command.Info = {name, description?}`), `POST /api/session/{id}/command` (`{name, text}` → 204), `POST /api/session/{id}/model` (`Model.Ref`, already implemented)
- **`~/.paddy/state.json` via `src/server/state.ts`** — one new `deskModel` field; atomic 0600 writes already exist; v2 has no global-config write so Paddy state is the only correct home
- **`node:test` + `node:mock/timers`** — constraint-mandated runner; built-in `mock.fn()` and fake timers cover the V2-01 hermetic-test needs with zero deps
- **Playwright 1.63 (devDep, present)** — extend the existing smoke script for keyboard-path QA; not wired into `npm test`

**Explicitly rejected:** Jest/Vitest, state libraries, cmdk/radix-select/headlessui, `@floating-ui` positioning, virtualization, fuzzy matching (fuse.js), client-side command registries, re-scraping the CLI. Each is either a constraint violation or solves a problem a local desk app doesn't have.

### Expected Features

Full landscape in [FEATURES.md](./FEATURES.md).

**Must have (table stakes, all P1):**
- Chat-header model picker: provider-grouped, active model shown, keyboard parity, applies per-session on send
- Persisted desk default in `~/.paddy/state.json` (this *is* V2-02 — one work item, not two)
- Session resume seeds the picker from the session's actual model (`Session.Info.model`), not a stale guess
- Slash palette on leading `/`: name + description, live substring filter, full keyboard control
- `/name args` execution via `POST /api/session/{id}/command` with submit fork in the composer
- **Command errors rendered in the thread** as persistent system messages (Slack's documented best practice) — never toasts
- Per-project command fetch + refresh on `command.updated` SSE

**Should have (differentiators, P2):** `session.model.selected` → header sync (trust property), MRU ordering, model status/context badges, "Type `/` for commands" placeholder.

**Defer (v2+):** variant/reasoning-effort picker (unverified data shape), model search box, agent picker, Cmd+K Paddy-action palette, argument hints (blocked — API exposes no argument schema).

**Anti-features (research is emphatic):** no client-side command registry (violates OpenCode authority), no per-argument autocomplete (API can't support it), no sending `/name` as prompt text, no persisting the desk model into OpenCode config, no per-session model state in Paddy.

### Architecture Approach

Research (HIGH confidence, repo-read) confirms the single-process structure is intact and additive: no new processes, services, or state stores; no `GuiEvent`/`DeskEvent` union changes. Every feature lands through the **four-layer pattern** (client method → api route → browser client method → UI state), built in layer order so each layer ships with tests before its consumer exists. Detailed integration map in [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major changes:**
1. `opencode-client.ts` — NEW `listModels()`, `listCommands()`, `runCommand()`; **DELETE** `updateConfig()` (dead `PATCH /api/config` target)
2. `api.ts` — NEW `GET /api/models`, `GET /api/commands`, `POST /api/sessions/{id}/command`; `updateSettings`/`bootstrap` gain `deskModel`; **DELETE** `patchConfig` route
3. `state.ts` — `AppState.deskModel` (+ normalize/public/EMPTY; old state files upgrade silently)
4. `runtime.ts` — injectable `probe` seam (third application of the existing DI pattern, fixes V2-01)
5. Browser: `client.ts` methods + mirrored types, `ModelPicker` / `CommandPalette` components, pure `commands.ts` parser/filter module, `app.tsx` header + composer interception
6. `settings.tsx` — drop all three `patchConfig` call sites; Agents/Permissions sections need a roadmap-level read-only decision

**Key patterns:** don't reuse `getProviders()` for the picker (4-request fan-out; use a dedicated light `listModels()` call); unknown leading `/name` → client-side system message, no roundtrip; only a *leading* `/` triggers the palette (mid-text slashes are ordinary prompts).

### Critical Pitfalls

Top 5 of 6 from [PITFALLS.md](./PITFALLS.md):

1. **`redactSecrets` corrupts identifier payloads** (prior incident in this repo) — provider ids like `alibaba-token-plan` became `alibaba-[redacted]-plan`. Regression fixtures (`security.test.ts`/`api.test.ts`) must land **before any new route**; consider exact-match needles for identifier payloads.
2. **Model authority drift** — header shows X, session runs Y. Fix: optimistic-apply + reconcile on `session.model.selected`, re-read `Session.Info.model` on load, abort send on model-POST failure.
3. **Hermetic test dependence on port 4096** — the currently red test. Fix: injectable `probe` seam + env scrub (`OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD`) + closed-ephemeral-port fixture.
4. **Stale model/command caches** — both endpoints are *experimental* and event-invalidated (`command.updated`, `model.updated`, `models-dev.refreshed`). Fix: refetch-on-open with short cache + event-driven invalidation via the shared SSE fan-out (multi-tab safe).
5. **Command-as-prompt and toast-swallowed errors** — dispatch `/name` to the command route with a pure parser; errors map to in-thread system messages (PermissionCard is the in-repo precedent).

## Implications for Roadmap

Suggested phase structure (matches the dependency-driven build order in ARCHITECTURE.md and the pitfall-to-phase mapping in PITFALLS.md):

### Phase 1: v2 Hardening Foundation (V2-01 + V2-02)
**Rationale:** The quality gate and persistence target must exist before the features built on them. `npm test` is currently red on any machine with a live OpenCode (V2-01), and the picker needs somewhere durable to write its selection (V2-02) — picker-first would ship a selection that resets on reload.
**Delivers:** Injected probe seam + green hermetic suite; `deskModel` state field with silent old-state upgrade; `patchConfig`/`updateConfig` chain deleted; Settings model-default call site migrated; redaction regression fixtures (`alibaba-token-plan` round-trip).
**Addresses:** V2-01, V2-02, MODEL-02 persistence half.
**Avoids:** Pitfalls 3, 4, 6. **Open decision for the roadmap:** Agents/Permissions save call sites (read-only vs remove — research recommends read-only with an explanatory note; minimal scope is the model call site only).

### Phase 2: Model Picker (MODEL-01 + MODEL-02)
**Rationale:** Server half already exists (per-session model POST on send); lands as models data path (four-layer, tests first) then picker UI. The persistence target from Phase 1 is already in place.
**Delivers:** `listModels()` + `GET /api/models` + `api.models()`; header `ModelPicker` (provider-grouped, keyboard, a11y via APG combobox); session-resume model seeding; `session.model.selected` SSE reconciliation (must land *with* the picker per Pitfall 1).
**Uses:** React 19 + Tailwind tokens; pure helper module for grouping/navigation logic.
**Avoids:** Pitfalls 1, 2 (models half), large-list render perf (group + filter before render).

### Phase 3: Slash Commands (CMD-01 + CMD-02)
**Rationale:** Independent of Phase 2 (could parallel, but sequential keeps review surface one-feature-wide). Needs the full four-layer addition since zero command methods exist — the milestone context's "already speaks" claim is wrong.
**Delivers:** `listCommands()`/`runCommand()` + `GET /api/commands` + `POST /api/sessions/{id}/command`; pure `commands.ts` parser/filter + tests; composer palette UI with keyboard interception and draft preservation; in-thread error surfacing; `command.updated` invalidation.
**Avoids:** Pitfalls 2 (commands half), 5, palette a11y/keyboard pitfalls.

### Phase 4: End-to-End Verification & Polish
**Rationale:** Cross-feature trust properties only observable together: multi-tab SSE fan-out, external-switch reconciliation, live-server command semantics.
**Delivers:** Live verification against v2.3.2 (Settings save, command run, model switch), two-tab checks, "looks done but isn't" checklist from PITFALLS.md, optional P2 polish (MRU, badges, placeholder hint).
**Avoids:** Multi-tab staleness, missed type-mirror drift (`tsc --noEmit` + no `node:*` in browser bundle).

### Phase Ordering Rationale

- **Dependencies:** V2-02 and the picker's persistence are the *same* state-schema change — sequencing them separately duplicates work. The hermetic-test fix is the gate every later phase's exit criterion runs through.
- **Grouping:** Phases 2 and 3 are feature-vertical pairs (data path + UI), each landing via the four-layer pattern in layer order. Steps 1+2 of the architecture build order can merge into Phase 1 if the roadmap prefers fewer, larger phases.
- **Pitfall avoidance:** The pitfall-to-phase mapping in PITFALLS.md matches this structure exactly; the redaction fixtures and probe seam land before any new routes/tests are written on top.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Slash Commands):** the command endpoints come from the *published* OpenAPI, which targets a **newer server than the installed v2.3.2** — command shapes are MEDIUM until captured from the local server's own `/openapi.json` (via the controller; never echo the password). Two live-verification items change one line each: `text` semantics (args-only vs full input) and zero-arg commands (`text: ""`). Recommend `/gsd-plan-phase --research-phase 3`.
- **Phase 2 (Model Picker):** one small live check — how reasoning-effort variants appear in `GET /api/model` (only if variant UI is attempted; otherwise defer). Light research at most.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Hardening):** root cause chain verified in code with line numbers; fix design already specified in ARCHITECTURE.md.
- **Phase 4 (Verification):** checklist already enumerated in PITFALLS.md; no unknowns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core "add nothing" recommendation rests on local code + constraints (verifiable); web-sourced digest confidence capped by environment (no package metadata for the seam) |
| Features | MEDIUM-HIGH | API contract verified against two vendor primary sources (OpenAPI 3.1 + API reference) + live-captured V2-MIGRATION-SPEC; UX patterns cross-verified Slack/Discord docs |
| Architecture | HIGH | Repo-read directly at HEAD, with line numbers; live-captured v2.3.2 spec; cross-verified against published OpenAPI. Single semantic gap: command `text` semantics |
| Pitfalls | MEDIUM | API facts cross-verified (docs + curated spec); the redactSecrets incident is project-supplied HIGH; general UX/testing pitfalls are established practice, not freshly fetched |

**Overall confidence:** MEDIUM-HIGH. The plan of record is safe to build; the command-endpoint shapes carry the residual uncertainty.

### Gaps to Address

- **Command endpoints vs local server:** published OpenAPI describes a newer OpenCode than installed v2.3.2 — capture `/openapi.json` from the local server before planning Phase 3.
- **`text` semantics on `POST /command`:** args-only (`"scaffold"`) or full input (`"/new scaffold"`) — live check during Phase 3; changes one line in `submit()`.
- **Zero-arg commands:** whether `text: ""` is accepted — same live check.
- **Unknown `/draft` behavior:** block with hint vs send-as-text — product decision to settle in the Phase 3 SPEC.
- **SSE shape of the expanded user message after a 204:** verify with a live run before finalizing the command success path; do not synthesize expanded text client-side.
- **Variant representation in `GET /api/model`:** verify only if variant UI is attempted (deferred by default).
- **Agents/Permissions save call sites:** roadmap-level decision (read-only recommended by research, removal also viable).

## Sources

### Primary (HIGH confidence)
- Codebase read directly at HEAD (2026-11-21): `src/server/{api,runtime,state,opencode-client,security}.ts`, `src/server/runtime.test.ts`, `src/lib/desk/client.ts`, `src/components/desk/{app,settings}.tsx` — integration points, DI seams, redaction behavior, the failing test
- `.planning/V2-MIGRATION-SPEC.md` — live-captured v2.3.2 contract (envelope, `location` scoping, event names, no-global-config-write)
- `.planning/PROJECT.md` — milestone requirements (MODEL-01/02, CMD-01/02, V2-01/02) and constraints

### Secondary (MEDIUM confidence)
- OpenCode official API reference + OpenAPI 3.1 document (opencode.ai/docs/server, opencode.ai/docs/openapi.json, fetched 2026-11-21) — command/model endpoints, error schemas, event types; targets a newer server than v2.3.2, so command shapes pending local capture
- OpenCode Commands guide — `$ARGUMENTS` templating, hot reload, precedence
- Slack / Discord official docs — command/text split, errors-as-messages best practice
- WAI-ARIA APG Combobox Pattern — keyboard/ARIA contract for both widgets

### Tertiary (LOW confidence, needs validation)
- ChatGPT/Claude/Cursor model-picker UX behavior — domain knowledge, consistent across three products, gates no controller decision
- cmdk / fuse.js registry metadata — rejection rationale only; sizes/deps cited but not load-bearing

---
*Research completed: 2026-11-21*
*Ready for roadmap: yes*
