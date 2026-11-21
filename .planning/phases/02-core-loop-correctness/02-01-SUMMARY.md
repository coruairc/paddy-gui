---
phase: 02-core-loop-correctness
plan: 01
subsystem: desk-ui
tags: [loop-01, reconciliation, optimistic-bubble, normalize]
requires: []
provides:
  - pure message reducers in src/components/desk/messages.ts
  - ChatMessage.pending and system role (client + server)
  - normalizeEvent parts forwarding + text emission
affects: [app.tsx, normalize.ts, client.ts]
tech-stack:
  added: []
  patterns: [optimistic reconciliation, duplicate-submit guard, StrictMode-safe applyEvent]
key-files:
  created:
    - src/components/desk/messages.ts
    - src/components/desk/messages.test.ts
  modified:
    - src/components/desk/app.tsx
    - src/server/normalize.ts
    - src/lib/desk/client.ts
    - package.json
decisions:
  - Reconcile optimistic user bubble by (role + text + created proximity < 5000ms); drop temp id
  - Duplicate submit guarded by working flag and pending bubble presence
  - applyEvent side effects run outside setSessionId updaters reading sessionRef.current
metrics:
  duration: ~15m
  completed: 2026-11-21
  tasks: 3
  files: 6
status: complete
actuals:
  tokens: 4300
  tasks: 3
  commits: 1
plan_head_before: ff1bc05e7a3c038cad4ee4a46d7c0314625ce8a4
plan_head_after: 832c8de
---

# Phase 2 Plan 01: Core Loop Correctness (LOOP-01) Summary

Extracted pure message reducers and reconciled the optimistic user bubble end-to-end, with duplicate-submit protection, draft restoration on error, pending dot styling, StrictMode-safe applyEvent, and normalize parts forwarding.

## Accomplishments

- Created `src/components/desk/messages.ts` exporting `appendDelta`, `upsertActivity`, `upsertSession`, `mergeMessage`, `hasPendingBubble`.
- `mergeMessage` reconciles an optimistic pending user bubble with the server-echoed user message by (role + text + created within 5s), dropping the temp id and clearing `pending`.
- `submit()` now appends a single `pending: true` bubble with temp id `local_${Date.now()}`, guards against duplicate submits, and restores the draft on error.
- Submit button and Enter-to-send disabled while `working` or a pending bubble exists.
- Pending user bubble renders a 6px accent dot (`pulse-live`, opacity 0.7).
- `applyEvent` side effects read `sessionRef.current` directly outside `setSessionId` updaters (StrictMode safe).
- `normalizeEvent` forwards parts on `message.updated` and emits a `message` event with text on text parts (with role hint).
- `ChatMessage` gains `pending?` and `system` role in both server and client types.
- Registered `messages.test.ts` in npm test script.

## Deviations from Plan

None - plan executed as written.

## Verification

- `node --experimental-strip-types --test src/components/desk/messages.test.ts`: 7 pass.
- `npm test`: 55 pass, 0 fail.
- `npx tsc --noEmit`: exit 0.

## Self-Check: PASSED

- FOUND: src/components/desk/messages.ts
- FOUND: src/components/desk/messages.test.ts
- FOUND: commit 832c8de