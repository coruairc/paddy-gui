# Paddy

## What This Is

Paddy is a local web interface for OpenCode. The browser is the desk; OpenCode does the work. A single Node process serves the React UI and a controller that talks to a locally-running `opencode serve` over HTTP and SSE.

The browser never runs shell commands and never reads the filesystem — the controller is the security boundary. Paddy does not reimplement the agent and does not scrape CLI output.

## Core Value

A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.

Everything else — settings depth, theming, packaging — is secondary to that loop working and being trustworthy.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from the existing codebase during onboarding (see `.planning/codebase/`). -->

- ✓ Pick a local project and chat in that directory — existing
- ✓ Watch the agent work: reads, edits, and command runs surface in the thread — existing
- ✓ Allow or deny permission prompts inline in the conversation — existing
- ✓ See changed files and diffs for a run — existing
- ✓ Stop a run, then retry it — existing
- ✓ Close the browser and resume the same OpenCode session later — existing
- ✓ Configure providers, models, agents, and MCP from Settings — existing
- ✓ Controller-as-security-boundary: browser has no shell or filesystem access — existing
- ✓ GUI state confined to `~/.paddy/state.json`, overridable via `PADDY_HOME` — existing
- ✓ One-command install from source (`install.sh`, `install.ps1`) and a container image — existing

### Active

<!-- Current scope. Building toward these. All are hypotheses until shipped and validated. -->

- [ ] Token auth cannot be bypassed via loopback trust or a spoofed `Host` header (DNS rebinding, reverse proxy)
- [ ] The documented container/Compose path actually persists state (fix the dead `PADDY_HOME` volume)
- [ ] Remove the ~3,500 lines of app-builder template scaffolding that is still wired into the build
- [ ] Documentation describes only the product that exists (`SELFHOST.md`, `selfhost.env.example`)
- [ ] `install.sh` verifies the checksum of any downloaded Node tarball
- [ ] Tests and lint run in CI; `npm run lint` passes; the stale committed test is fixed or removed
- [ ] Exiting Paddy terminates the spawned `opencode serve` child instead of orphaning it
- [ ] A sent user message reconciles with the server echo instead of appearing twice
- [ ] Settings → Connection "Save" preserves an already-stored password
- [ ] Unused heavy dependencies (~37 packages) are removed from `package.json`
- [ ] The full loop is exercised end-to-end on local, container, and LAN-with-token paths

### Out of Scope

- Reimplementing the agent, tools, or shell execution — OpenCode owns all of it; Paddy is the interface
- Multi-user accounts, hosted SaaS, or team workspaces — this is a single-operator local desk
- Scraping CLI output instead of the HTTP API — the controller talks to `opencode serve` only
- Integration with the Paddy/OpenClaw agent runtime — this repo is explicitly standalone
- Scoping sessions, messages, models, or file state in Paddy — OpenCode remains the authority

## Context

**Technical environment.** Node.js 22+ (enforced in `bin/paddy.mjs:142` and by `install.sh`, but no `engines` field). TypeScript 5.9 strict, React 19.2, TanStack Start 1.168 + Router 1.170, Vite 8.2, Tailwind 4.3, Nitro 3 beta for the Vercel build. Tests use the built-in `node:test` runner with `node:assert/strict`; there is no Jest or Vitest.

**Architecture.** Single process, two halves: the React/SSR UI in `src/` and the controller in `src/server/`. The controller is mounted as Vite middleware in dev/preview and as Nitro middleware in a build. `src/server/opencode-client.ts` is the only adapter to OpenCode; `src/server/runtime.ts` supervises the child process and fans out events; `src/server/normalize.ts` maps OpenCode events into GUI shapes.

**Known state at onboarding.** The codebase map (`.planning/codebase/`, mapped 2026-10-29 at `d358aee`) records ten open concerns: five High (auth bypass, dead Docker volume, dead template scaffolding, stale `SELFHOST.md`, unverified installer download) and five Medium (no CI, orphaned child process, duplicate chat bubbles, password-wiping Save, unused dependencies).

**Prior work.** No ADR/PRD/SPEC/RFC documents exist in the repo, so no external decision record constrains this milestone.

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
| Close the auth bypass by not trusting loopback or `Host` for `localOnly` | A spoofed `Host` defeats the current check; LAN mode cannot be trusted until this is fixed | — Pending |
| Delete the app-builder scaffolding rather than leave it dormant | Dead code wired into the build is a maintenance and review hazard | — Pending |

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
*Last updated: 2026-11-03 after initialization*
