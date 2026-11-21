---
phase: 02-core-loop-correctness
plan: 02
subsystem: controller-settings
tags: [loop-02, password, settings, reset]
requires:
  - 02-01
provides:
  - password preserve/replace/clear semantics in updateSettings
  - reset clears ownedServerPassword and disconnects child
  - hasConnectionPassword threaded into SettingsPanel
affects:
  - src/server/api.ts
  - src/components/desk/settings.tsx
  - src/components/desk/app.tsx
tech-stack:
  added: []
  patterns:
    - explicit clear flag (clearConnectionPassword) instead of blank-string wipe
key-files:
  created: []
  modified:
    - src/server/api.ts
    - src/components/desk/settings.tsx
    - src/components/desk/app.tsx
    - src/server/api.test.ts
    - src/server/runtime.ts
decisions:
  - Blank/absent connectionPassword preserves stored password; only non-blank replaces; clearConnectionPassword===true deletes.
  - Reset now calls runtime.disconnect() to stop spawned child and clears ownedServerPassword.
  - Guarded client.disconnect with optional chaining for test mocks and robustness.
metrics:
  duration: 0
  completed: 2026-11-21
status: complete
actuals:
  tokens: 2433
  tasks: 3
  commits: 3
plan_head_before: 5e2812748cd7cb3bd6ad91b1ceb6496ded89a92b
plan_head_after: b70677b68b844d4e7f3bfd23aa297ced6906c7af
---

# Phase 02 Plan 02: Core Loop Correctness — Password Preserve/Replace/Clear Summary

**One-liner:** Settings → Connection Save no longer wipes a stored password; blank preserves, non-empty replaces, explicit clear deletes; Reset stops the spawned child and clears ownedServerPassword.

## Completed Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Server-side password preserve/replace/clear and reset handoff | 3c92300 | src/server/api.ts, src/server/runtime.ts |
| 2 | Connection form placeholder, clear-password button, hasConnectionPassword wiring | ef79e7c | src/components/desk/settings.tsx, src/components/desk/app.tsx |
| 3 | Extend api.test.ts with password preserve/replace/clear cases | b70677b | src/server/api.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Guarded runtime.client.disconnect call**
- **Found during:** Task 3 (reset test)
- **Issue:** Test mock client lacked `disconnect`; calling it threw, causing 500.
- **Fix:** Changed `this.client?.disconnect()` to `this.client?.disconnect?.()` in runtime.disconnect (and attach).
- **Files modified:** src/server/runtime.ts
- **Commit:** 3c92300

## Verification

- `node --experimental-strip-types --test src/server/api.test.ts` exits 0 (12 tests)
- `npm test` exits 0 (60 tests)
- `npx tsc --noEmit` exits 0

## Self-Check: PASSED
