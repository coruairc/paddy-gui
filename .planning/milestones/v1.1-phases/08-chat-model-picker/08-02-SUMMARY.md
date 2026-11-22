---
phase: 08-chat-model-picker
plan: 02
subsystem: ui
tags: [combobox, wai-aria, keyboard, tailwind, model-metadata]

requires:
  - phase: 08-01
    provides: catalog route, picker component shell, pure model helpers
provides:
  - Full APG combobox keyboard map (Arrow/Home/End/Enter/Esc/Tab) with aria-activedescendant
  - Focus lifecycle (input on open, trigger on close, composer or trigger on select)
  - Two-line metadata rows with status badges, default/selected markers
  - Deterministic popup state precedence and explicit panels (offline/error/loading/empty/no-match)
  - Outside pointer-down dismissal and a mounted search row in no-match
affects: [08-03, phase-10]

actuals:
  tokens: 4300
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Single activeIndex over the flattened filtered list; option ids derived from modelSlug(key)"
    - "State precedence expressed as one ordered expression, exposed via data-model-picker-state"

key-files:
  created: []
  modified:
    - src/components/desk/models.ts
    - src/components/desk/models.test.ts
    - src/components/desk/model-picker.tsx
    - src/components/desk/app.tsx

key-decisions:
  - "No wrap-around in keyboard navigation; ArrowUp from -1 lands on the last option"
  - "The search row stays mounted in no-match so Clear filter can refocus the same input"
  - "Stale state is gated on catalogLoaded: a reload never shows a warn icon before the catalog arrives"

patterns-established:
  - "Pure navigation helpers keep keyboard logic unit-testable without DOM tooling"

requirements-completed: [MODEL-01, MODEL-02, MODEL-03]

coverage:
  - id: D1
    description: "Keyboard navigation helpers clamp correctly across group boundaries"
    requirement: MODEL-01
    verification:
      - kind: unit
        ref: "src/components/desk/models.test.ts#nextActiveIndex clamps without wrapping and handles empty lists"
        status: pass
      - kind: unit
        ref: "src/components/desk/models.test.ts#flattenGroups walks the visible order across group boundaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "Search input owns focus and aria-activedescendant; Arrow/Home/End move one option; Enter applies; Esc/Tab close to the trigger"
    requirement: MODEL-01
    verification: []
    human_judgment: true
    rationale: "Real-browser ARIA/focus behavior; the repo bans jsdom/RTL. Covered by the phase UAT and Phase 10 keyboard checklist."
  - id: D3
    description: "Every row shows two lines with status, context window and release date, plus default/selected markers"
    requirement: MODEL-03
    verification: []
    human_judgment: true
    rationale: "Visual legibility and badge rendering need a browser; the projection fields are server-tested."
  - id: D4
    description: "Popup state precedence is deterministic and every state renders an explicit panel with Retry or Clear filter"
    requirement: MODEL-01
    verification: []
    human_judgment: true
    rationale: "Rendered panels and retry-copy behavior require the browser; precedence logic is expressed in one expression and reviewed."
  - id: D5
    description: "Outside pointer-down closes without stealing focus; no-match keeps the search input mounted"
    requirement: MODEL-01
    verification: []
    human_judgment: true
    rationale: "Pointer/focus interaction is browser-only."
  - id: D6
    description: "A cached reopen renders the list without a loading flash; a forced retry refetches"
    requirement: MODEL-02
    verification: []
    human_judgment: true
    rationale: "Cache lifecycle is wired in app.tsx; behavior is observable in the live desk UAT."

duration: 25 min
completed: 2026-11-22
status: complete
---

# Phase 8 Plan 02: Chat Model Picker Summary

**The picker is now a full hand-built APG combobox: search owns focus, Arrow/Home/End/Enter/Esc/Tab behave per the UI contract, rows carry status · context · release metadata, and every empty/offline/error/no-match state is explicit**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files:** 4 modified

## Accomplishments
- Added `flattenGroups` and clamped `nextActiveIndex` with node:test coverage
- Implemented the keyboard map, `aria-activedescendant`, scroll-into-view, and focus lifecycle
- Rendered two-line metadata rows with Alpha/Beta/Deprecated badges and Default/selected markers
- Locked deterministic state precedence and outside pointer-down dismissal

## Task Commits

1. **Navigation helpers + tests** — `5cd503a` (feat)
2. **Keyboard combobox + states** — `0ae766b` (feat)

## Deviations from Plan

None. Manual keyboard/focus checks are recorded as Phase 10 UAT scope per the plan.

## Issues Encountered
None.

## Next Phase Readiness
- 08-03 can rely on `resolveActiveModel`/`modelForSend` and the stable component contract for SSE reconciliation and resume seeding.

---
*Phase: 08-chat-model-picker*
*Completed: 2026-11-22*
