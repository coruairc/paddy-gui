---
phase: 02-core-loop-correctness
plan: 03
subsystem: api
tags: [runtime, process-lifecycle, detached-spawn, signal-handlers, node-test]
requires:
  - phase: 02-01
    provides: message reconciliation and runtime baseline
  - phase: 02-02
    provides: password preserve/reset disconnect wiring
provides:
  - detached spawn of opencode serve with process-group kill (SIGTERM→5s→SIGKILL)
  - injectable ControllerRuntime seam (spawn/sleep/kill)
  - guarded exit handler preventing status clobber after disconnect
  - async disconnect clearing ownedPassword/ownedServerPassword
  - Vite signal handlers (SIGINT/SIGTERM/SIGHUP/beforeExit) calling runtime.disconnect()
  - runtime.test.ts coverage
affects: [core-loop, controller-lifecycle, tests]
actuals:
  tokens: 3921
  tasks: 3
  commits: 1
  plan_head_before: b614bce6cae151b9223cf57f1eeec270687bc890
  plan_head_after: 6bd7cfe98f65124f0cf5c302a5de5e7b106dbc09
tech-stack:
  added: []
  patterns:
    - "detached spawn + process-group kill with SIGTERM→5s→SIGKILL escalation"
    - "injectable spawn/sleep/kill seam for deterministic runtime tests"
    - "exit-handler guard (this.child !== child) to avoid status clobber"
key-files:
  created:
    - src/server/runtime.test.ts
  modified:
    - src/server/runtime.ts
    - vite.config.ts
    - package.json
key-decisions:
  - "Spawn with detached:true and signal -pid (process group) so grandchildren are reachable"
  - "killChild nulls this.child before signaling so the natural exit handler no-ops"
  - "Clear ownedPassword and state.ownedServerPassword in both disconnect and natural exit"
  - "Signal handlers registered only in the Vite plugin path (process.once), never in ControllerRuntime constructor"
patterns-established:
  - "ControllerRuntimeOptions | string constructor for backward-compatible seam injection"
  - "waitForExit helper polling via sleepImpl"
requirements-completed:
  - LOOP-03
coverage:
  - id: D1
    description: "Spawned opencode serve runs detached in its own process group"
    requirement: LOOP-03
    verification:
      - kind: unit
        ref: "src/server/runtime.test.ts#spawn uses detached:true"
        status: pass
    human_judgment: false
  - id: D2
    description: "disconnect kills process group SIGTERM then SIGKILL if not exited"
    requirement: LOOP-03
    verification:
      - kind: unit
        ref: "src/server/runtime.test.ts#disconnect kills process group SIGTERM then SIGKILL if not exited"
        status: pass
    human_judgment: false
  - id: D3
    description: "natural exit after disconnect does not clobber status"
    requirement: LOOP-03
    verification:
      - kind: unit
        ref: "src/server/runtime.test.ts#exit handler guard: natural exit after disconnect does not clobber status"
        status: pass
    human_judgment: false
  - id: D4
    description: "disconnect clears ownedPassword and ownedServerPassword"
    requirement: LOOP-03
    verification:
      - kind: unit
        ref: "src/server/runtime.test.ts#disconnect clears ownedPassword and ownedServerPassword"
        status: pass
    human_judgment: false
  - id: D5
    description: "reset route awaits disconnect and clears child"
    requirement: LOOP-03
    verification:
      - kind: unit
        ref: "src/server/runtime.test.ts#reset via api clears child"
        status: pass
    human_judgment: false
duration: 15min
completed: 2026-11-21
status: complete
---

# Phase 2 Plan 03: Core Loop Correctness (LOOP-03) Summary

**Detached spawn with process-group kill (SIGTERM→5s→SIGKILL), injectable runtime seam, guarded exit handler, async disconnect, and Vite signal handlers**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-11-21
- **Completed:** 2026-11-21
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- `ControllerRuntime` now spawns `opencode serve` with `detached: true` and `child.unref()`, enabling process-group signaling.
- `killChild()` signals `-pid` (SIGTERM, then SIGKILL after a 5s wait) with a direct-child fallback.
- Exit handler guarded by `this.child !== child` so an intentional disconnect is not clobbered by the child's natural exit.
- `disconnect()` is async and clears `ownedPassword`/`state.ownedServerPassword` before persisting.
- Constructor accepts `ControllerRuntimeOptions | string`, injecting `spawn`/`sleep`/`kill` seams while preserving the string state-file form.
- Vite plugin registers `process.once` handlers for SIGINT/SIGTERM/SIGHUP (and beforeExit) that call `runtime.disconnect()` then `process.exit(0)`.
- `reset` route already awaits `runtime.disconnect()` (verified) and clears owned password.
- Added `src/server/runtime.test.ts` (7 cases) and registered it in the test script; full suite green (67 tests).

## Task Commits

1. **Tasks 1-3: runtime lifecycle + signal handlers + tests** - `6bd7cfe` (feat)

## Files Created/Modified

- `src/server/runtime.ts` - detached spawn, killChild, seam, guarded exit, async disconnect
- `src/server/runtime.test.ts` - node:test coverage for lifecycle
- `vite.config.ts` - signal handlers in opencodeControllerPlugin
- `package.json` - registered runtime.test.ts

## Decisions Made

- Used `process.kill.bind(process)` as the default kill seam so injected tests can record calls.
- `waitForExit` resolves via an `exit` listener plus a sleep timeout, with immediate resolution when `exitCode`/`signalCode` is already set.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- LOOP-03 complete; runtime lifecycle covered by automated tests.
- Manual verification: Ctrl+C leaves no `opencode serve` process (pgrep check).

---
*Phase: 02-core-loop-correctness*
*Completed: 2026-11-21*