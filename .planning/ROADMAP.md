# Roadmap: Paddy

## Overview

v1.0 shipped a trustworthy desk; the controller now talks OpenCode v2 (commit `9a08c1b`). v1.1 restores and extends desk parity with the v2 API: a model picker in the chat UI, working slash commands, and a hardened v2 foundation. The order is deliberate: first the hermetic test fix (the quality gate every later phase verifies against, currently red whenever a live server holds port 4096), the durable home for the desk model default (v2 has no remote global-config write), and redaction hardening (identifier-shaped payloads flow through the new routes for the first time). Only then do the two feature verticals land — each as data path before UI, per the four-layer pattern — and finally the cross-feature trust properties (picked model is what runs; two tabs agree) are verified together in the live desk.

**Milestone:** v1.1 OpenCode v2 Desk (Phases 7-10)

## Milestones

- ✅ **v1.0 Hardening** - Phases 1-6 (shipped 2026-11-21; archived in `.planning/milestones/`)
- 🚧 **v1.1 OpenCode v2 Desk** - Phases 7-10 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (7, 8, 9, 10): v1.1 milestone work, continuing from v1.0's Phase 6
- Decimal phases (7.1, 7.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 7: v2 Hardening Foundation** - Hermetic tests, a durable desk-model default, honest Settings saves, and redaction that never corrupts identifiers — the foundation every later phase builds on (completed 2026-11-22)
- [ ] **Phase 8: Chat Model Picker** - A provider-grouped, keyboard-driven model picker in the chat header/composer whose choice actually runs, persists, and never drifts from the session
- [ ] **Phase 9: Slash Command Palette** - OpenCode commands discoverable and runnable from the composer, with outcomes and errors surfacing in the thread
- [ ] **Phase 10: v1.1 End-to-End Verification** - Model switch and command execution verified live and across tabs, so the milestone's trust properties hold together, not just per-feature

## Phase Details

### Phase 7: v2 Hardening Foundation
**Goal**: The quality gate is trustworthy and the desk has a durable home for its model default, before any feature is built on them — `npm test` green in a clean environment, no Settings action 404s, and identifiers survive redaction byte-identically.
**Depends on**: Nothing (first phase of v1.1; builds on the shipped v1.0 and the v2 API migration `9a08c1b`)
**Requirements**: V2-01, V2-02, V2-03
**Success Criteria** (what must be TRUE):
  1. `npm test` is green both on a machine running a live OpenCode on port 4096 and on one with nothing listening — the runtime spawn test no longer attaches to whatever server holds the port (injectable probe seam, no hardcoded endpoint in the test path).
  2. No Settings action 404s or silently fails: the dead `updateConfig`/`PATCH /api/config` chain is deleted, and the Agents/Permissions sections are honestly read-only or fixed.
  3. The desk's default model persists in Paddy state (`~/.paddy/state.json`, new `deskModel` field) across browser reloads and controller restarts, and an existing state file upgrades silently on first load.
  4. An identifier-shaped payload (e.g. provider ID `alibaba-token-plan`) round-trips through the API byte-identical, proven by an exact-match redaction regression test that fails if substring replacement is reintroduced.
**Plans**: 3/3 plans complete

Plans:
**Wave 1**
- [x] 07-01-PLAN.md — Exact-match redaction tracer + byte-identical regressions; hermetic probe seam + spawn test fix (V2-03, V2-01)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 07-02-PLAN.md — deskModel persistence: state field + silent upgrade, settings/bootstrap surface, browser mirror (V2-02)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 07-03-PLAN.md — Honest Settings (deskModel Save, read-only Agents/Permissions), dead-chain deletion + 404 regression, both-environment gate (V2-02, V2-01, V2-03)

### Phase 8: Chat Model Picker
**Goal**: Users can see and switch the model that will run their session, right from the chat UI — grouped by provider, keyboard-driven, informed by metadata — and trust that what the header shows is what actually runs.
**Depends on**: Phase 7 (persisted `deskModel` target, hermetic test gate, hardened redaction)
**Requirements**: MODEL-01, MODEL-02, MODEL-03
**Success Criteria** (what must be TRUE):
  1. User can open a model picker from the chat header/composer (not only Settings) and see OpenCode v2 models grouped by provider, with live filtering, full keyboard control, and the always-visible active model.
  2. Selecting a model sets the desk default; the next message sent in the session actually runs on that model (applied per-session on send), the choice persists across reloads, and session resume seeds from the session's actual model.
  3. When the session's model changes (via `session.model.selected` SSE or resume), the header reconciles so it never shows a model the session is not running; a failed model switch aborts the send rather than running the wrong model.
  4. The picker surfaces model metadata OpenCode already provides (status, context window, release date) so the user can choose informed.
**Plans**: 2/3 plans executed
**Wave 1**
- [x] 08-01-PLAN.md — Model catalog data path + header trigger tracer: listModels/getDefaultModel, projected `/api/models`, `DeskModel` + `api.models()`, pure `models.ts` helpers, pick persists `deskModel` (MODEL-01, MODEL-02, MODEL-03)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 08-02-PLAN.md — Keyboard-first APG combobox: live filtering, Arrow/Home/End/Enter/Esc, metadata rows and status badges, explicit loading/offline/error/empty/no-match panels (MODEL-01, MODEL-02, MODEL-03)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 08-03-PLAN.md — Reconciliation and resume: `session.model.selected` → `model-selected` event, active-session-only header update, resume seeding, project-switch guard removal (MODEL-02)
**UI hint**: yes

### Phase 9: Slash Command Palette
**Goal**: Users can discover and run OpenCode commands in the desk the way they would in the TUI — a leading `/` offers the server's commands, `/name args` runs in-session, and outcomes and errors are visible in the thread.
**Depends on**: Phase 8 (feature verticals land sequentially to keep review surface one-feature-wide; both build on Phase 7's foundation and SSE invalidation patterns)
**Requirements**: CMD-01, CMD-02, CMD-03
**Success Criteria** (what must be TRUE):
  1. Typing a leading `/` in the composer opens a filterable, keyboard-first palette of OpenCode commands (name + description) sourced from `GET /api/command` — never a client-side registry.
  2. Submitting `/name args` runs the command via `POST /api/session/{id}/command` and its outcome is visible in the thread; unknown or failing commands surface their error as a persistent in-thread system message, not a transient toast.
  3. When OpenCode emits `command.updated` while the desk is open, the palette reflects the new command list without a page reload.
  4. Only a leading `/` triggers command dispatch — mid-text slashes are ordinary prompts, unknown `/name` never silently becomes prompt text, and the composer draft survives palette open/close.
**Plans**: TBD
**UI hint**: yes

### Phase 10: v1.1 End-to-End Verification
**Goal**: The v1.1 features are verified together in the live desk, so the milestone's trust properties hold in combination — the picked model is what runs, and every open tab agrees.
**Depends on**: Phase 9 (all v1.1 features landed)
**Requirements**: VER-05, VER-06
**Success Criteria** (what must be TRUE):
  1. In a live run against local OpenCode v2.3.2, a model picked in the chat header is the model that actually runs the next message, and `/name args` produces visible results in the thread.
  2. Two open tabs agree on the active model after a switch, and command outcomes fan out to both via SSE without a reload.
  3. The full v1.1 loop passes the quality gates in a clean environment: `npm test`, `npm run lint`, and `tsc --noEmit` all green, with no `node:*` imports in the browser bundle.
  4. Verification evidence is recorded (VERIFICATION.md / phase checklist) so milestone completion can be audited later.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10 (decimal insertions, if any, appear between their surrounding integers)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. v2 Hardening Foundation | 3/3 | Complete    | 2026-11-22 |
| 8. Chat Model Picker | 2/3 | In Progress | - |
| 9. Slash Command Palette | 0/? | Not started | - |
| 10. v1.1 End-to-End Verification | 0/? | Not started | - |
