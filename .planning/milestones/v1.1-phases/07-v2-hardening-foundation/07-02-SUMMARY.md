---
phase: 07-v2-hardening-foundation
plan: 02
subsystem: api
tags: [deskModel, persistence, state-file, bootstrap, node-test, silent-upgrade]

requires:
  - phase: 07-01
    provides: hardened redaction boundary and hermetic test gate the touched suites run under
  - phase: v1.0 shipped
    provides: atomic 0600 state writes, normalizeState/publicState projection, PATCH /api/settings
provides:
  - AppState.deskModel (empty string means unset) with silent upgrade of old state files
  - publicState exposes deskModel while both passwords stay excluded
  - updateSettings accepts any string deskModel before persist (no model-list validation)
  - bootstrap seeds model from deskModel with OpenCode config model as fallback
  - reset clears deskModel; Bootstrap mirror type carries deskModel for Phase 8
affects: [08-chat-model-picker, 09-slash-command-palette]

actuals:
  tokens: 1882
  tasks: 2
  commits: 2
  plan_head_before: a82dc70ed247abd5c8543a45336b1b68f51d9bab
  plan_head_after: e9e9b3ca42c4d290d0512b44040801ae012aefbf

tech-stack:
  added: []
  patterns:
    - "Field-by-field normalizeState guard gives new state fields a silent upgrade path (no migration script, no version bump)"
    - "Persisted desk default wins over OpenCode config derivation in bootstrap; the raw field stays exposed alongside model"

key-files:
  created: []
  modified:
    - src/server/state.ts
    - src/server/state.test.ts
    - src/server/api.ts
    - src/server/api.test.ts
    - src/lib/desk/client.ts

key-decisions:
  - "deskModel accepts any string — no model-list validation; OpenCode stays authoritative and Phase 8 reconciles on send/resume"
  - "bootstrap keeps both model (precedence-seeded) and deskModel (raw) in the response so Phase 8 can distinguish persisted vs derived"
  - "reset clears deskModel alongside the other GUI metadata (RESEARCH Open Question 2 recommendation adopted)"
  - "State field added with normalizeState typeof guard only — old files upgrade on first load, writeState re-normalizes on next persist"

patterns-established:
  - "New AppState fields land as a four-site edit: AppState type, EMPTY_STATE, normalizeState guard, publicState projection"
  - "Desk-default persistence rides the existing PATCH /api/settings route; no new route, no migration script"

requirements-completed: [V2-02]

coverage:
  - id: D1
    description: "deskModel persists in Paddy state through the atomic 0600 write, and old state files without the field upgrade silently to empty string"
    requirement: "V2-02"
    verification:
      - kind: unit
        ref: "src/server/state.test.ts#deskModel upgrades silently and round-trips"
        status: pass
    human_judgment: false
  - id: D2
    description: "publicState exposes deskModel while connectionPassword and ownedServerPassword stay off the browser projection"
    requirement: "V2-02"
    verification:
      - kind: unit
        ref: "src/server/state.test.ts#deskModel upgrades silently and round-trips"
        status: pass
    human_judgment: false
  - id: D3
    description: "PATCH /api/settings persists a desk default and GET /api/bootstrap seeds model from it, falling back to the OpenCode config model when unset"
    requirement: "V2-02"
    verification:
      - kind: integration
        ref: "src/server/api.test.ts#desk default model persists through settings and bootstrap"
        status: pass
      - kind: integration
        ref: "src/server/api.test.ts#bootstrap falls back to OpenCode config model when deskModel is unset"
        status: pass
    human_judgment: false
  - id: D4
    description: "Non-string deskModel values are ignored at the settings boundary and reset clears deskModel"
    requirement: "V2-02"
    verification:
      - kind: integration
        ref: "src/server/api.test.ts#non-string deskModel is ignored"
        status: pass
      - kind: integration
        ref: "src/server/api.test.ts#reset clears passwords and deskModel"
        status: pass
    human_judgment: false
  - id: D5
    description: "Browser Bootstrap mirror type carries deskModel so Phase 8's picker reads the same source of truth"
    requirement: "V2-02"
    verification:
      - kind: other
        ref: "flock -w 900 /tmp/team-build.lock npm run typecheck"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-21
status: complete
---

# Phase 7 Plan 2: deskModel Persistence Summary

**`deskModel` lives end-to-end in Paddy state: Settings saves it, bootstrap reloads it with config fallback, and pre-existing state files upgrade silently.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-11-21T22:49:27Z
- **Completed:** 2026-11-21T23:09:35Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `AppState.deskModel` added with `EMPTY_STATE` default and a `typeof`-guarded `normalizeState` path, so old `~/.paddy/state.json` files upgrade silently on first load — no migration script, no schema version bump.
- `publicState` now exposes `deskModel` while `connectionPassword`/`ownedServerPassword` remain off the browser projection (inverse secrecy assertion still pins it).
- `PATCH /api/settings` accepts any string `deskModel` and persists it through the existing atomic 0600 write; non-strings are ignored, and no model-list validation was added.
- `GET /api/bootstrap` seeds `model` from the saved desk default and falls back to the OpenCode project-config model; both `model` and the raw `deskModel` are returned.
- `reset` clears `deskModel` alongside the other GUI metadata, and the browser `Bootstrap` mirror type carries `deskModel` for Phase 8's picker.

## Task Commits

Each task was committed atomically:

1. **Task 1: deskModel state field with silent upgrade** - `5160e08` (feat)
2. **Task 2: deskModel through updateSettings, bootstrap precedence, and the browser mirror** - `e9e9b3c` (feat)

**Plan metadata:** `docs(07-02): complete deskModel persistence plan` (this commit)

_Note: TDD tasks were committed once per task after the RED→GREEN cycle completed and all task gates passed._

## Files Created/Modified
- `src/server/state.ts` - `AppState.deskModel`, `EMPTY_STATE.deskModel`, normalizeState typeof guard, publicState exposure
- `src/server/state.test.ts` - "deskModel upgrades silently and round-trips" (old-file upgrade, invalid type, round-trip, exposure, password secrecy); `writeFileSync` import
- `src/server/api.ts` - updateSettings deskModel acceptance, bootstrap model precedence, reset deskModel clear
- `src/server/api.test.ts` - deskModel persistence/bootstrap-precedence, config fallback, non-string rejection tests; reset test renamed to "reset clears passwords and deskModel"
- `src/lib/desk/client.ts` - `Bootstrap.deskModel: string` mirror

## Decisions Made
- Any string is accepted for `deskModel`; the controller never validates against the model list (locked D-03 — OpenCode is authoritative, Phase 8 reconciles on send/resume).
- bootstrap keeps both `model` and `deskModel`: `model` is precedence-seeded so `app.tsx` reload seeding works unchanged, `deskModel` is the raw persisted field Phase 8 will write.
- `reset` clears `deskModel` (RESEARCH Open Question 2 resolution, adopted as planned).

## Deviations from Plan

None - plan executed exactly as written. The dead config-write chain, `app.tsx` chooseProject guard, and Settings UI migration were left untouched per the plan boundary and remain 07-03's scope.

## Issues Encountered
- `flock -w 900 /tmp/team-build.lock npm run typecheck` produced no captured stdout on the first run; re-run with output redirected to a file confirmed `EXIT=0` with the expected `tsc --noEmit` banner. No lock timeout occurred.
- `prettier --check` flags all touched files, but untouched files (`security.ts`, `runtime.ts`, `normalize.ts`) fail the same check — pre-existing repo-wide formatting drift, out of scope per the deviation scope boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- V2-02 persistence half is complete: the `deskModel` target Settings Save and Phase 8's picker will read/write is durable and reload-visible.
- 07-03 still owns the Settings Save migration, the read-only Agents/Permissions conversion, and the dead `updateConfig`/`PATCH /api/config` deletion (with its 404 regression). V2-02 stays open in REQUIREMENTS.md until 07-03 finishes (shared-ID gate).

---
*Phase: 07-v2-hardening-foundation*
*Completed: 2026-11-21*

## Self-Check: PASSED

- All five planned files exist on disk; no file outside `files_modified` was touched (`git diff --name-only` from the plan ledger base lists exactly those five).
- Task commits `5160e08` and `e9e9b3c` are ancestors of HEAD.
- Negative count gates re-run at close-out: `state.ts` deskModel = 4 (≥4), `api.ts` state.deskModel = 3 (≥3), `client.ts` deskModel = 1 (≥1).
- Touched suites green (state 3/3, api 21/21), full `npm test` green (88 TS tests + 20 installer tests), `npm run typecheck` exit 0.

