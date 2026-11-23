# Task: raise the inspector (right panel) max width

## Goal

The right-side inspector can only be dragged to 800px; the user wants to pull
it further. Raise the hard cap while keeping the chat-column guard intact.

## Baseline

- Dispatch base: the committed SHA current when this task starts (expected:
  the result of model-picker-in-composer). Record it.
- `git status --short` before delegation: **clean**

## Current state (orchestrator analysis)

- `src/components/desk/panel-size.ts:15-18` — `PANEL_LIMITS.right = { min: 280,
  default: 352, max: 800 }`. The 800 cap is what the user is hitting.
- The real protection is separate: `maxPanelWidth("right", viewport, left)`
  (panel-size.ts:41-46) also subtracts `CHAT_MIN_WIDTH = 420` and the left
  panel's width, so the chat column can never be crushed regardless of the
  cap. Stored widths parse/clamp against limits (parseStoredWidth /
  writePanelWidth), so existing saved widths (≤800) remain valid — no
  migration needed.
- `src/components/desk/panel-size.test.ts` covers these helpers; any assertion
  pinning right.max = 800 must be updated with the change.

## Change

- Raise `PANEL_LIMITS.right.max` from 800 to **1200**. One constant. Rationale:
  the chat-min guard is the real safety; 1200 lets big-viewport users give the
  inspector most of the screen while still bounding a runaway drag. Do not
  touch min/default, the left panel, CHAT_MIN_WIDTH, or any other helper.
- Update any affected panel-size tests.

## Acceptance criteria

- AC-1: `PANEL_LIMITS.right.max === 1200`; left panel limits unchanged;
  CHAT_MIN_WIDTH unchanged.
- AC-2: On a 1920px viewport with a 240px left panel, the inspector can be
  dragged to 1200 (room = 1920−240−420 = 1260 ≥ 1200). On smaller viewports
  the existing room logic still binds (e.g. 1280px → max 620) — verified via
  the pure helpers, no browser needed for the math.
- AC-3: `npm run typecheck`, `npm run lint`, `npm test` pass.
- AC-4: Live sanity check (127.0.0.1:8080, do not start/kill): drag/keyboard
  (End key) reaches the new max on a wide viewport; the chat column never
  goes below its minimum; the panel resets to default via the existing reset.
  Leave user state as found.

## Non-goals

- No changes to use-panel-widths.ts logic, ResizeHandle, storage keys, or the
  left panel. No dependency changes.

## Owners

- Implementer: backend (user-directed; queued — dispatch only after the
  model-picker task commits, per the single-implementer rule)
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented (backend agent, run in parallel with the model-picker task
  per user direction — disjoint files; PANEL_LIMITS.right.max 800 → 1200,
  one constant; 2 red-first tests pinning the cap, the room math, and the
  stored-width round-trip. Live drag deliberately not exercised to avoid
  writing the user's localStorage mid-parallel-run — wiring verified via
  the complete static chain instead.)
- [x] Reviewed (PASS, no findings; reviewer confirmed no residual 800 clamp
  anywhere in use-panel-widths.ts or resize-handle.tsx; stored widths ≤800
  stay valid; CHAT_MIN_WIDTH guard still binds on small viewports)
- [x] Committed