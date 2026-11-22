---
phase: 08-chat-model-picker
reviewed: 2026-11-22
status: clean
depth: standard
findings:
  critical: 0
  warning: 0
  info: 3
---

# Phase 8 Code Review — Chat Model Picker

Reviewed the phase source diff (`src/server/opencode-client.ts`, `src/server/api.ts`, `src/server/normalize.ts`, `src/lib/desk/client.ts`, `src/components/desk/models.ts`, `src/components/desk/model-picker.tsx`, `src/components/desk/app.tsx`) plus the test additions.

## Verdict

No Critical or Warning findings remain. Two issues were found during review and fixed before close-out:

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| CR-8-01 | Warning | The filter input was not focused on open when the catalog had not loaded yet — the open effect ran while the popup rendered the loading panel, so the input mounted later with no focus. | Added an effect keyed on `[open, state]` that focuses the input as soon as the list/no-match state renders. Live Playwright check now reports `filterFocused: true`. |
| CR-8-02 | Warning | A Settings → Providers save set `model` but left `modelSource` at `"session"`, so a session-sourced model kept being treated as session truth after a desk-side change. | `onModelChange` now sets `modelSource` to `"desk"`. |

## Informational

- **IN-8-01:** `OptionRow` computes its flat index with `flat.findIndex` per row; with ~272 entries this is O(n²) but measured fine in the live catalog (160 rows). A key→index Map is the obvious optimization if the list grows.
- **IN-8-02:** After a reload the header shows the persisted key until the catalog is fetched on first open. This is the locked pre-load behavior (a raw-key label, no stale warn); the display name appears once the catalog loads.
- **IN-8-03:** `onMouseMove` updates `activeIndex` on every pointer move over a row; this intentionally keeps hover and keyboard-active visuals unified, at the cost of a state update per move.

## Verification run during review

- `npm test` — 20/20 script stage, 98/98 TS stage.
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 5 pre-existing warnings.
- `node --experimental-strip-types --test src/components/desk/models.test.ts` — 17/17.
- Live desk checks (Playwright) — picker open/filter/keyboard/select/persist, stale banner, offline, error, empty, no-match, focus restore.
