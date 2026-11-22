# Paddy

## What This Is

Paddy is a local web interface for OpenCode. The browser is the desk; OpenCode does the work. A single Node process serves the React UI and a controller that talks to a locally-running `opencode serve` over HTTP and SSE.

The browser never runs shell commands and never reads the filesystem — the controller is the security boundary. Paddy does not reimplement the agent and does not scrape CLI output.

## Core Value

A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.

Everything else — settings depth, theming, packaging — is secondary to that loop working and being trustworthy.

## Current Milestone: v1.1 OpenCode v2 Desk

**Goal:** Restore and extend desk parity with OpenCode v2 — a model picker in the chat UI, working slash commands, and a hardened v2 foundation.

**Target features:**
- Model picker in the chat header/composer (not only Settings), grouped by provider, applied per-session on send
- Slash commands: `/` offers OpenCode commands; `/name args` runs in-session; errors surface in the thread
- v2 hardening: hermetic test suite, no global-config 404s

**Key context:** The controller was already migrated to the OpenCode v2 API (commit `9a08c1b`); that migration is the foundation, not a milestone phase. The v2 contract is grounded in `.planning/V2-MIGRATION-SPEC.md`.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. v1.0 shipped 2026-11-21; v2 API migration shipped as foundation for v1.1. -->

- ✓ Pick a local project and chat in that directory — existing
- ✓ Watch the agent work: reads, edits, and command runs surface in the thread — existing
- ✓ Allow or deny permission prompts inline in the conversation — v1.0 Phase 2
- ✓ See changed files and diffs for a run — existing
- ✓ Stop a run, then retry it — v1.0 Phase 2
- ✓ Close the browser and resume the same OpenCode session later — v1.0 Phase 2
- ✓ Configure providers, models, agents, and MCP from Settings — existing
- ✓ Controller-as-security-boundary: browser has no shell or filesystem access — v1.0 Phase 1
- ✓ GUI state confined to `~/.paddy/state.json`, overridable via `PADDY_HOME` — existing
- ✓ One-command install from source (`install.sh`, `install.ps1`) and a container image — v1.0 Phase 5
- ✓ Token auth cannot be bypassed via loopback trust or a spoofed `Host` header — v1.0 Phase 1
- ✓ The documented container/Compose path actually persists state — v1.0 Phase 5
- ✓ App-builder template scaffolding removed from the build — v1.0 Phase 3
- ✓ Documentation describes only the product that exists — v1.0 Phase 3
- ✓ `install.sh` verifies the checksum of any downloaded Node tarball — v1.0 Phase 5
- ✓ Tests and lint run in CI; `npm run lint` passes — v1.0 Phase 4
- ✓ Exiting Paddy terminates the spawned `opencode serve` child — v1.0 Phase 2
- ✓ A sent user message reconciles with the server echo — v1.0 Phase 2
- ✓ Settings → Connection "Save" preserves an already-stored password — v1.0 Phase 2
- ✓ Unused heavy dependencies removed from `package.json` — v1.0 Phase 3
- ✓ The full loop is exercised end-to-end on local, container, and LAN-with-token paths — v1.0 Phase 6
- ✓ Controller talks to OpenCode v2 (v2.3.2) over its `/api` surface — v1.1 foundation (`9a08c1b`)

### Active

<!-- Current scope. Building toward these. All are hypotheses until shipped and validated. -->

- [ ] MODEL-01: The desk offers a model picker in the chat header/composer (not only Settings), listing OpenCode v2 models grouped by provider
- [ ] MODEL-02: Selecting a model sets the desk default applied per-session on send (`POST /api/session/{id}/model`) and persists across reloads
- [ ] CMD-01: The desk lists OpenCode commands (`GET /api/command`) and offers them when the user types `/` in the composer
- [ ] CMD-02: Submitting `/name args` runs the command via `POST /api/session/{id}/command`; command errors surface in the thread
- [ ] V2-01: `npm test` is green in a clean environment (runtime.test.ts spawn test must not depend on a live server on port 4096)
- [ ] V2-02: Resolve the v2 `PATCH /api/config` 404: drop global-config writes and persist the desk model in Paddy state, so Settings saves never 404

### Out of Scope

- Reimplementing the agent, tools, or shell execution — OpenCode owns all of it; Paddy is the interface
- Multi-user accounts, hosted SaaS, or team workspaces — this is a single-operator local desk
- Scraping CLI output instead of the HTTP API — the controller talks to `opencode serve` only
- Integration with the Paddy/OpenClaw agent runtime — this repo is explicitly standalone
- Scoping sessions, messages, models, or file state in Paddy — OpenCode remains the authority
- TUI parity beyond commands (interactive TUI panes) — the desk is a web UI, not a terminal emulator
- Multi-desk model profiles — one desk default, applied per-session, is enough for v1.1
- New credential/provider key-entry UX — v2 `/api/credential` exposes raw keys; keep them redacted, no new key UI this milestone

## Context

**Technical environment.** Node.js 22+ (enforced in `bin/paddy.mjs:142` and by `install.sh`, but no `engines` field). TypeScript 5.9 strict, React 19.2, TanStack Start 1.168 + Router 1.170, Vite 8.2, Tailwind 4.3, Nitro 3 beta for the Vercel build. Tests use the built-in `node:test` runner with `node:assert/strict`; there is no Jest or Vitest.

**Architecture.** Single process, two halves: the React/SSR UI in `src/` and the controller in `src/server/`. The controller is mounted as Vite middleware in dev/preview and as Nitro middleware in a build. `src/server/opencode-client.ts` is the only adapter to OpenCode; `src/server/runtime.ts` supervises the child process and fans out events; `src/server/normalize.ts` maps OpenCode events into GUI shapes.

**Known state at v1.1 start.** OpenCode on this machine is **v2.3.2**; its v1 HTTP surface is gone. The controller was migrated to the v2 `/api` surface (commit `9a08c1b`, untracked spec at `.planning/V2-MIGRATION-SPEC.md`): `/api` prefix, `{data}` envelope, `location[directory]` scoping, `/api/event` SSE, session-scoped permission/form replies, per-session model+agent+prompt split. v2 has **no remote global-config write** (`PATCH /api/config` → 404; `/api/experimental/config` only accepts `{shell}`). `npm test` is 79/80 — the one failure is `runtime.test.ts` "spawn uses detached:true", which attaches to whatever live server holds port 4096 instead of spawning (V2-01).

**Prior work.** v1.0 (6 phases) shipped 2026-11-21: auth hardening, core-loop correctness, repo cleanup, quality gates, install/persistence, end-to-end verification. No ADR/PRD/SPEC/RFC documents exist in the repo beyond the GSD `.planning/` artifacts and the untracked v2 migration spec.

## Constraints

- **Tech stack**: Node 22+, TypeScript, TanStack Start — the app ships as one process; no separate backend service or database may be introduced for this milestone
- **Compatibility**: existing installs keep state at `~/.config/opencode-web`; it must continue to be reused when present
- **Security**: the controller stays the only component with shell/filesystem access; the browser stays sandboxed from both
- **Authority**: OpenCode remains the source of truth for sessions, messages, models, and file changes
- **Test runner**: `node:test` only — adding Jest/Vitest would be a stack change outside this milestone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Talk to OpenCode over its HTTP/SSE API, never scrape CLI output | The CLI is not a stable interface; the API is what OpenCode itself exposes | ✓ Good |
| Keep only GUI metadata in `~/.paddy/state.json` | Avoid duplicating state OpenCode already owns, which would drift | ✓ Good |
| Treat the controller as the security boundary | The browser must never gain shell or filesystem access | ✓ Good |
| Close the auth bypass by not trusting loopback or `Host` for `localOnly` | A spoofed `Host` defeats the current check; LAN mode cannot be trusted until this is fixed | ✓ Good (v1.0) |
| Delete the app-builder scaffolding rather than leave it dormant | Dead code wired into the build is a maintenance and review hazard | ✓ Good |
| Migrate the controller to the OpenCode v2 `/api` surface in place (no compatibility shim) | OpenCode v2.3.2 removed the v1 endpoints; the v1 client got HTML fallbacks and constant offline flicker | ✓ Good |
| Apply the chosen model per-session on send instead of persisting it into OpenCode global config | v2 has no remote global-config write; per-session `POST /api/session/{id}/model` is the supported path | ✓ Good (v1.1) |

## Current State

**Shipped:** v1.1 OpenCode v2 Desk (2026-11-22)

- Hermetic quality gate (green with or without a live OpenCode on 4096)
- Exact-match secret redaction; identifier-shaped payloads survive byte-identically
- Durable `deskModel` default in Paddy state with silent upgrade
- Provider-grouped, keyboard-first model picker reconciled live across tabs
- Server-sourced slash-command palette with args-only dispatch and in-thread errors
- Verified end-to-end in the live desk, including two-tab agreement

## Next Milestone Goals

- Start the next milestone with `/gsd-new-milestone` (questioning → research → requirements → roadmap).
- Candidate areas from the deferred list: CI Playwright smoke tests, theme customization, concurrent desks, automated upgrade of `~/.config/opencode-web`.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-22 after v1.1 milestone completion*
