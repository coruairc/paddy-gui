---
phase: 08-chat-model-picker
plan: 03
subsystem: ui
tags: [sse, reconciliation, resume, model-selected, trust]

requires:
  - phase: 08-01
    provides: catalog, picker, resolveActiveModel/modelForSend
  - phase: 08-02
    provides: header trigger, keyboard picker, stale gating
provides:
  - GuiEvent/DeskEvent model-selected variant normalized from session.model.selected
  - Active-session-only header reconciliation via pure resolveHeaderModel
  - Session-sourced model precedence (resolveActiveSource) immune to catalog fallback
  - Resume seeding from Session.Info.model without a state write
  - Project switch no longer overwrites the persisted desk default
affects: [phase-10]

actuals:
  tokens: 2600
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "One additive SSE variant carried through the existing runtime fan-out"
    - "Session truth vs desk preference modelled explicitly as modelSource"

key-files:
  created: []
  modified:
    - src/server/normalize.ts
    - src/server/normalize.test.ts
    - src/lib/desk/client.ts
    - src/components/desk/models.ts
    - src/components/desk/models.test.ts
    - src/components/desk/app.tsx

key-decisions:
  - "Only the active session's model-selected frame moves the header; previous/variant are never read"
  - "A session-sourced model is shown and sent verbatim even when absent from the catalog; stale only applies to the desk preference"
  - "Resume seeds from the session's own model and writes nothing to deskModel"

patterns-established:
  - "Pure decision helpers for trust-critical reducer branches (resolveHeaderModel/resolveActiveSource)"

requirements-completed: [MODEL-02]

coverage:
  - id: D1
    description: "session.model.selected normalizes into one additive variant and partial payloads are dropped"
    requirement: MODEL-02
    verification:
      - kind: unit
        ref: "src/server/normalize.test.ts#session.model.selected normalizes to one additive variant"
        status: pass
      - kind: unit
        ref: "src/server/normalize.test.ts#partial model-selected payloads are dropped"
        status: pass
    human_judgment: false
  - id: D2
    description: "Only the active session's switch moves the header"
    requirement: MODEL-02
    verification:
      - kind: unit
        ref: "src/components/desk/models.test.ts#resolveHeaderModel applies only the active session's switch"
        status: pass
    human_judgment: false
  - id: D3
    description: "A session-sourced model is never replaced by catalog fallback; a desk preference still goes stale"
    requirement: MODEL-02
    verification:
      - kind: unit
        ref: "src/components/desk/models.test.ts#resolveActiveSource keeps session truth over catalog fallback"
        status: pass
    human_judgment: false
  - id: D4
    description: "Resume projects the session's model without a variant and with missing fields omitted"
    requirement: MODEL-02
    verification:
      - kind: unit
        ref: "src/server/normalize.test.ts#session summaries project the session's own model without a variant"
        status: pass
    human_judgment: false
  - id: D5
    description: "Project switches no longer re-read project config over the desk model"
    requirement: MODEL-02
    verification:
      - kind: other
        ref: "grep gates: chooseProject has no api.config and no setModel"
        status: pass
    human_judgment: false
  - id: D6
    description: "A live external model switch updates the header and two tabs agree"
    requirement: MODEL-02
    verification: []
    human_judgment: true
    rationale: "Cross-process SSE behavior needs a live desk and OpenCode; deferred to Phase 10 (VER-05/VER-06)."

duration: 20 min
completed: 2026-11-22
status: complete
---

# Phase 8 Plan 03: Chat Model Picker Summary

**The header now reconciles against OpenCode's own model switches and session resume, so it never advertises a model the session is not running — and project switches stop overwriting the persisted desk default**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files:** 6 modified

## Accomplishments
- Added the `model-selected` event variant end-to-end (normalize → DeskEvent → applyEvent)
- Extracted `resolveHeaderModel` and `resolveActiveSource` with positive/negative tests
- Projected `SessionSummary.model` and seeded the header on resume without writing state
- Removed the `chooseProject` config re-read and grep-gated it

## Task Commits

1. **Reconciliation + resume + guard removal** — `c438ff8` (feat)

## Deviations from Plan

None. Live cross-process behavior is Phase 10 UAT scope per the plan.

## Issues Encountered
None.

## Next Phase Readiness
- Phase 8 is ready for code review, verification, and the phase-level live UAT.

---
*Phase: 08-chat-model-picker*
*Completed: 2026-11-22*
