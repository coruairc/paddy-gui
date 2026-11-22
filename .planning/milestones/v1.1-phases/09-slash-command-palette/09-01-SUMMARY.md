---
phase: 09-slash-command-palette
plan: 01
subsystem: ui
tags: [slash-commands, palette, combobox, opencode]

requires:
  - phase: 08-chat-model-picker
    provides: pure-helper + APG component pattern, composer wiring
provides:
  - OpenCodeClient.listCommands / runCommand
  - GET /api/commands projected catalog and POST /api/sessions/:id/command
  - DeskCommand mirror, api.commands()/api.runCommand()
  - Pure parseCommandInput/filterCommands/commandSlug/nextCommandIndex
  - Composer-anchored command palette with list and state panels
affects: [09-02, phase-10]

actuals:
  tokens: 5200
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Composer owns the combobox; the palette is a pure presenter"
    - "Server-authoritative dispatch: only { name, text } with args-only text"

key-files:
  created:
    - src/components/desk/commands.ts
    - src/components/desk/commands.test.ts
    - src/components/desk/command-palette.tsx
  modified:
    - src/server/opencode-client.ts
    - src/server/api.ts
    - src/lib/desk/client.ts
    - src/components/desk/app.tsx
    - src/server/api.test.ts
    - src/server/opencode-client.test.ts

key-decisions:
  - "text is the args remainder only — the leading /name never reaches OpenCode's $ARGUMENTS"
  - "Only a leading slash opens the palette; mid-text slashes stay prompt text"
  - "Failed dispatch keeps a persistent in-thread system message and restores the draft"

patterns-established:
  - "Palette state precedence expressed as one ordered expression"

requirements-completed: [CMD-01, CMD-02]

coverage:
  - id: D1
    description: "Server-sourced command catalog projected to name/description, empty while disconnected"
    requirement: CMD-01
    verification:
      - kind: unit
        ref: "src/server/api.test.ts#command catalog projects name and description only"
        status: pass
      - kind: unit
        ref: "src/server/api.test.ts#command catalog degrades while disconnected"
        status: pass
    human_judgment: false
  - id: D2
    description: "Adapter uses GET /api/command with directory scope and POST /api/session/{id}/command with {name,text}"
    requirement: CMD-02
    verification:
      - kind: unit
        ref: "src/server/opencode-client.test.ts#listCommands scopes by directory and unwraps the envelope"
        status: pass
      - kind: unit
        ref: "src/server/opencode-client.test.ts#runCommand posts name and args text to the session command route"
        status: pass
    human_judgment: false
  - id: D3
    description: "Leading-slash parsing, filtering and navigation are pure and tested"
    requirement: CMD-01
    verification:
      - kind: unit
        ref: "src/components/desk/commands.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Empty args accepted; missing name rejected; OpenCode 404 message surfaces unchanged"
    requirement: CMD-02
    verification:
      - kind: unit
        ref: "src/server/api.test.ts#command dispatch forwards args and accepts empty text"
        status: pass
      - kind: unit
        ref: "src/server/api.test.ts#command errors surface their server message"
        status: pass
    human_judgment: false
  - id: D5
    description: "Typing / opens the palette, selection completes or dispatches, draft survives"
    requirement: CMD-01
    verification: []
    human_judgment: true
    rationale: "Browser interaction; covered by the phase UAT and Phase 10 keyboard checklist."

duration: 35 min
completed: 2026-11-22
status: complete
---

# Phase 9 Plan 01: Slash Command Palette Summary

**The command path runs end-to-end: OpenCode's catalog feeds a composer-anchored palette, and `/name args` dispatches through a dedicated route with args-only text**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files:** 9 (3 new)

## Accomplishments
- Added `listCommands`/`runCommand` and the two Paddy routes
- Projected the catalog to `{ name, description }` and degraded safely offline
- Built pure parsing/filtering helpers with 5 node:test cases
- Wired a leading-`/` palette with dispatch, echo, and in-thread failure

## Task Commits

1. **Command path tracer + helpers + tests** — `feat(09-01)`

## Deviations from Plan

None. The palette's full keyboard/state polish lands in 09-02 as planned.

## Issues Encountered
None.

## Next Phase Readiness
- 09-02 adds `command.updated` invalidation, inbox echo reconciliation, and async failure surfacing.

---
*Phase: 09-slash-command-palette*
*Completed: 2026-11-22*
