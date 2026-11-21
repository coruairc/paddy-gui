---
gsd_state_version: "1.0"
milestone: v1.1
milestone_name: OpenCode v2 Desk
status: planning
last_updated: "2026-11-21T20:57:28.875Z"
last_activity: 2026-11-21
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-03)

**Core value:** A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.
**Current focus:** Phase 1 — Controller Auth Hardening

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-11-21 — Milestone v1.1 started


## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 1 | - | - |
| 2 | 4 | - | - |
| 3 | 4 | - | - |
| 4 | 1 | - | - |
| 5 | 1 | - | - |
| 6 | 1 | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 1 P01 | 20min | 3 tasks | 5 files |
| Phase 2 P01 | 15m | 3 tasks | 6 files |
| Phase 02 P02 | 0 | 3 tasks | 5 files |
| Phase 02 P03 | 15 | 3 tasks | 4 files |
| Phase 2 P04 | 15 | 3 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Security and core-loop defects are sequenced first — nothing else can be tested with confidence until they are fixed.
- [Roadmap]: Cleanup precedes quality gates because `npm run lint` and the test wiring only settle after the app-builder scaffolding and its orphaned tests are gone.
- [Roadmap]: Packaging follows cleanup because the container's dead `PADDY_HOME` volume depends on the one state-directory variable chosen during documentation cleanup.
- [Roadmap]: Verification is a final phase, but every earlier phase carries its own observable success criteria.
- [Phase 1]: Anonymous trust requires loopback bind AND loopback Host header
- [Phase 1]: Non-loopback bind never grants anonymous access
- [Phase 1]: Origin check runs before auth and returns 403 for cross-origin
- [Phase 1]: Referer validated when Origin absent
- [Phase 1]: Token comparison uses timingSafeEqual
- [Phase 1]: Container shortcut now Host-validated
- [Phase 2]: Reconcile optimistic user bubble by (role+text+created proximity) and drop temp id (LOOP-01)
- [Phase 02]: Blank/absent connectionPassword preserves stored password; only non-blank replaces; clearConnectionPassword===true deletes (LOOP-02)
- [Phase 02]: Reset calls runtime.disconnect() to stop spawned child and clears ownedServerPassword (LOOP-02/LOOP-03 handoff)
- [Phase 02]: LOOP-03: detached spawn with process-group kill and injectable seam
- [Phase 2]: LOOP-04/05: inline PermissionCard with allow/deny; deny aborts and records denial line; question via inline Input; session resume via localStorage

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: `src/server/http.ts` has no test today, so the auth change must add socket-level coverage — `security.test.ts` alone does not exercise the bypass path.
- Phase 2: `src/server/runtime.ts` (spawn/exit lifecycle) has zero direct tests; the child-termination fix needs an injectable spawn/probe seam.
- Phase 2: `reset` also leaves the child running and the `ownedServerPassword` persisted — the same fix path as LOOP-03.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Automation | AUTO-01 Playwright smoke tests in CI | v2 | 2026-11-03 | v1.0 |
| Automation | AUTO-02 Automated `~/.config/opencode-web` upgrade path | v2 | 2026-11-03 | v1.0 |
| Experience | UX-01 Theme customization beyond light/dark | v2 | 2026-11-03 | v1.0 |
| Experience | UX-02 Multiple concurrent desks or windows | v2 | 2026-11-03 | v1.0 |

## Session Continuity

Last session: 2026-11-21T17:34:03.086Z
Stopped at: Phase 6 complete — all phases complete
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
