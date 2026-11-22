---
phase: 08-chat-model-picker
plan: 01
subsystem: ui
tags: [opencode-models, projection, redaction, combobox, tailwind]

requires:
  - phase: 07-v2-hardening-foundation
    provides: deskModel persistence, exact-match redaction, hermetic gate
provides:
  - OpenCodeClient.listModels / getDefaultModel (v2 GET /api/model and /api/model/default)
  - GET /api/models projected + redacted catalog with providerID/<id> keys
  - DeskModel browser mirror and api.models()
  - Pure model helpers with node:test coverage (grouping, filter, key parse, stale resolution, send guard)
  - Header model-picker component with trigger, grouped list, filter and metadata rows
affects: [08-02, 08-03, phase-10]

actuals:
  tokens: 6100
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Project → redact → assemble: identifiers travel as modelKey through redactSecrets and are renamed to key afterwards"
    - "Pure helper modules under src/components/desk/*.ts so node:test can cover UI logic without jsdom"

key-files:
  created:
    - src/components/desk/models.ts
    - src/components/desk/models.test.ts
    - src/components/desk/model-picker.tsx
  modified:
    - src/server/opencode-client.ts
    - src/server/api.ts
    - src/lib/desk/client.ts
    - src/components/desk/app.tsx
    - src/server/api.test.ts
    - src/server/opencode-client.test.ts

key-decisions:
  - "The catalog is a ten-field whitelist projection; raw Model.Info headers/settings/body never cross the controller"
  - "Keys are providerID/<entry id> (first-slash split), built from entry id rather than modelID"
  - "Stale persisted keys are shown and sent as the effective default only after the catalog loads; an unfetched catalog never marks a model stale"

patterns-established:
  - "Projection-then-redaction order keeps identifier fields out of the credential key rule"
  - "Pure resolution helpers (resolveActiveModel/modelForSend) own trust decisions so they are unit-testable"

requirements-completed: [MODEL-01, MODEL-02, MODEL-03]

coverage:
  - id: D1
    description: "GET /api/models returns a ten-field projected catalog with providerID/<id> keys and one default, degrading to an empty payload when disconnected"
    requirement: MODEL-01
    verification:
      - kind: unit
        ref: "src/server/api.test.ts#model catalog projects a whitelisted, id-keyed payload"
        status: pass
      - kind: unit
        ref: "src/server/api.test.ts#model catalog degrades to an empty payload while disconnected"
        status: pass
    human_judgment: false
  - id: D2
    description: "Keys and default survive redaction byte-identically with a registered needle"
    requirement: MODEL-01
    verification:
      - kind: unit
        ref: "src/server/api.test.ts#model keys and default survive redaction with a registered needle"
        status: pass
    human_judgment: false
  - id: D3
    description: "Adapter listModels/getDefaultModel use v2 paths, directory scope and the data envelope"
    requirement: MODEL-01
    verification:
      - kind: unit
        ref: "src/server/opencode-client.test.ts#listModels scopes by directory and unwraps the envelope"
        status: pass
      - kind: unit
        ref: "src/server/opencode-client.test.ts#getDefaultModel tolerates a null payload"
        status: pass
    human_judgment: false
  - id: D4
    description: "Grouping, filtering, key parsing and stale resolution are pure and tested"
    requirement: MODEL-01
    verification:
      - kind: unit
        ref: "src/components/desk/models.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "A failed model switch aborts the send before /prompt"
    requirement: MODEL-02
    verification:
      - kind: unit
        ref: "src/server/opencode-client.test.ts#a rejected model switch aborts before the prompt is sent"
        status: pass
    human_judgment: false
  - id: D6
    description: "Header trigger shows the active model and opens a grouped, filterable catalog popup"
    requirement: MODEL-01
    verification: []
    human_judgment: true
    rationale: "Visual/interaction correctness needs a browser; the repo bans component-render tooling. Covered by the phase-end live-desk UAT and Phase 10."
  - id: D7
    description: "Selecting a model persists through PATCH /api/settings with deskModel and shows an inline warn note on failure"
    requirement: MODEL-02
    verification: []
    human_judgment: true
    rationale: "The rendered success/failure branch has no DOM test tooling; server persistence is already covered by Phase 7 tests."

duration: 45 min
completed: 2026-11-22
status: complete
---

# Phase 8 Plan 01: Chat Model Picker Summary

**OpenCode's model catalog now flows through a projected, redaction-safe `GET /api/models` into a header picker that groups by provider, filters live, and persists the pick through Phase 7's `deskModel`**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3
- **Files:** 9 (3 new)

## Accomplishments
- Added `listModels`/`getDefaultModel` adapter methods and the projected `GET /api/models` route with ten whitelisted fields
- Built the `DeskModel` browser mirror and `api.models()`, plus pure helpers (`models.ts`) with 13 node:test cases
- Wired the header trigger/popup in `app.tsx` with grouped provider sections, live filter, two-line metadata, and 30s cache
- Pinned trust properties: key/default survive redaction, disconnected degrades, failed model switch aborts before `/prompt`

## Task Commits

1. **Tracer slice** — `e3f3e66` (feat)
2. **Pure-helper tests (RED)** — `fb69add` (test)
3. **Grouping/filter/metadata (GREEN)** — `73dbc9f` (feat)
4. **Trust-guard tests** — `6e2fc52` (test)

## Deviations from Plan

None — plan executed as written. `package.json` was not modified; `models.test.ts` runs via explicit command.

## Issues Encountered
None.

## Next Phase Readiness
- 08-02 can expand the same component with full keyboard control, state panels, and accessibility.
- 08-03 can consume `resolveActiveModel`/`modelForSend` for SSE reconciliation and resume seeding.

---
*Phase: 08-chat-model-picker*
*Completed: 2026-11-22*
