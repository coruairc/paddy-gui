---
phase: 07-v2-hardening-foundation
plan: 01
subsystem: testing
tags: [redaction, dependency-injection, node-test, security, hermetic-tests]

requires:
  - phase: v1.0 shipped
    provides: redactSecrets security boundary, ControllerRuntime third DI seams (spawn/sleep/kill)
provides:
  - Whole-string equality matching in redactSecrets (identifier payloads survive byte-identical)
  - Byte-identical regression fixtures at unit and GET /api/providers route level
  - ProbeImpl fourth DI seam on ControllerRuntime (connectInner + waitUntilReady)
  - Hermetic spawn test (injected down-probe + three-var env scrub)
affects: [phase-08-model-picker, phase-09-command-palette, phase-10-e2e]

actuals:
  tokens: 4200
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Fourth DI seam on ControllerRuntime mirrors spawn/sleep/kill (inject, default to private method)"
    - "Test hermeticity via env save/delete/restore inside the existing try/finally"

key-files:
  created: []
  modified:
    - src/server/security.ts
    - src/server/security.test.ts
    - src/server/api.test.ts
    - src/server/runtime.ts
    - src/server/runtime.test.ts

key-decisions:
  - "redactSecrets matches needles by whole-string equality only; prose-embedded secrets are no longer substring-scrubbed (locked D-04 tradeoff)"
  - "Probe seam returns ok/auth/down and is consumed by BOTH connectInner and waitUntilReady"
  - "No attach-branch test and no fetch/client-factory seam this phase (scope guard)"

patterns-established:
  - "Injectable seam: option in ControllerRuntimeOptions + private readonly field + default wrapper"
  - "Byte-identical fixtures assert deepEqual AND JSON.stringify equality"

requirements-completed: [V2-03, V2-01]

coverage:
  - id: D1
    description: "Identifier-shaped payloads (alibaba-token-plan) round-trip redactSecrets byte-identical while exact secrets and credential keys stay redacted"
    requirement: V2-03
    verification:
      - kind: unit
        ref: "src/server/security.test.ts#identifier payloads round-trip byte-identical through redaction"
        status: pass
      - kind: unit
        ref: "src/server/security.test.ts#exact needle values are still redacted"
        status: pass
      - kind: unit
        ref: "src/server/security.test.ts#needle length filter and whole-string equality boundaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "Identifier payload survives the GET /api/providers boundary byte-identical in all[].id and connected[]"
    requirement: V2-03
    verification:
      - kind: integration
        ref: "src/server/api.test.ts#identifier payloads survive the providers route byte-identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "Runtime spawn test is hermetic: injected down-probe forces the spawn path regardless of a live server on 4096, with ambient env scrubbed"
    requirement: V2-01
    verification:
      - kind: unit
        ref: "src/server/runtime.test.ts#spawn uses detached:true"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both probe call sites route through the injectable seam; production default unchanged"
    requirement: V2-01
    verification:
      - kind: other
        ref: "grep -c 'await this\\.probe(' src/server/runtime.ts == 0; ProbeImpl references == 3"
        status: pass
    human_judgment: false

duration: 28min
completed: 2026-11-21
status: complete
---

# Phase 7: v2 Hardening Foundation — Plan 01 Summary

**Exact-match redaction plus a hermetic spawn test, so identifier payloads survive the security boundary byte-identically and the quality gate passes with or without a live server on port 4096**

## Performance

- **Duration:** ~28 min across two sessions (paused mid-Task 2, closed out 2026-11-21)
- **Started:** 2026-11-21T22:46Z
- **Completed:** 2026-11-21T23:40Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced the substring splice in `redactSecrets` with whole-string needle equality; `alibaba-token-plan` now round-trips byte-identically at unit and route level
- Rewrote the old substring-contract test instead of deleting it, asserting the locked prose-survival tradeoff
- Added the fourth DI seam (`ProbeImpl`) and routed both probe call sites through it
- Made the spawn test deterministic on a machine where a live OpenCode holds 4096

## Task Commits

1. **Task 1: Exact-match redaction end-to-end** — `25074a3` (feat)
2. **Task 2: Injectable probe seam + hermetic spawn test** — `92a44b7` (wip, completed in place)
3. **Plan close-out** — summary/tracking commit (docs)

## Files Created/Modified
- `src/server/security.ts` — string branch now returns `[redacted]` only on whole-string needle equality
- `src/server/security.test.ts` — rewritten contract test + three new regression tests
- `src/server/api.test.ts` — providers-route byte-identical regression, extended mock
- `src/server/runtime.ts` — `ProbeImpl` type, `probe?` option, `probeImpl` field, both call sites
- `src/server/runtime.test.ts` — down-probe injection + three-var env scrub

## Decisions Made
- Whole-string equality only; prose-embedded secrets survive (locked D-04)
- Keep the `length >= 4` needle filter and SECRET_KEY key redaction byte-identical

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Resumed from a paused WIP rather than re-executing**
- **Found during:** Safe-resume gate at phase re-entry
- **Issue:** Plan 07-01 had two commits and no SUMMARY.md; the prior session paused mid-Task 2
- **Fix:** Verified Task 2's WIP against every acceptance criterion (7/7 runtime tests, 33/33 security+api tests, all negative gates) and closed out with this SUMMARY instead of re-running
- **Files modified:** SUMMARY + tracking only
- **Verification:** Test suites green; `split(needle)` == 0; `await this.probe(` == 0; `ProbeImpl` == 3
- **Committed in:** plan close-out commit

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change; the paused work was already complete and correct.

## Issues Encountered
- The previous executor's halt message could not be delivered; reconciled from git + tests as the workflow prescribes.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Redaction semantics are frozen before Phases 8/9 route identifier-shaped model and command payloads
- Wave 2 (07-02 `deskModel`) can proceed

---
*Phase: 07-v2-hardening-foundation*
*Completed: 2026-11-21*
