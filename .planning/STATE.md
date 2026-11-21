---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: 1
current_phase_name: Controller Auth Hardening
status: verifying
stopped_at: Completed 01-01-PLAN.md
last_updated: "2026-11-21T17:09:00.809Z"
last_activity: 2026-11-03
last_activity_desc: Roadmap created from 25 v1 requirements (6 phases)
state_head: ef45d104f6abd0f3ac34f1ccaf8863b164a22f1f
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 1
  completed_plans: 1
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-03)

**Core value:** A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.
**Current focus:** Phase 1 — Controller Auth Hardening

## Current Position

Phase: 1 of 6 (Controller Auth Hardening)
Plan: 1 of 1 in current phase
Status: Phase complete — ready for verification
Last activity: 2026-11-03 — Roadmap created from 25 v1 requirements (6 phases)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 1 P01 | 20min | 3 tasks | 5 files |

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

Last session: 2026-11-21T17:09:00.787Z
Stopped at: Completed 01-01-PLAN.md
Resume file: None
