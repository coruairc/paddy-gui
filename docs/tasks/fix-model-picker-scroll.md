# Task: fix-model-picker-scroll — model picker list cannot be scrolled

## Goal

The model picker popup (top-right of the desk header) must be scrollable when the
model catalog is taller than the available viewport. Today the list is clipped and
unreachable.

## Baseline

- Base SHA: `0426aed` (main, in sync with origin/main)
- `git status --short` before delegation: **clean** (no pre-existing edits)

## Scope

- `src/components/desk/model-picker.tsx` — the popup/listbox layout only.
- Focused test additions only if they fit the repo's plain-logic test convention
  (no component-render tooling exists; do not add any).

## Non-goals

- No changes to model filtering/grouping logic (`models.ts`), keyboard semantics,
  ARIA structure, or any other component.
- No dependency changes. No refactors.

## Root cause (orchestrator analysis, verify before fixing)

- Popup wrapper (`model-picker.tsx:227`) uses `overflow-hidden`.
- The `role="listbox"` container (`model-picker.tsx:288`) has no max-height and no
  `overflow-y-auto`, so long lists extend past the viewport and are clipped.
- Sticky provider headers (`sticky top-0`, line 315) imply a scroll container was
  intended.

## Acceptance criteria

- AC-1: With a catalog taller than the viewport, the listbox scrolls (wheel/touch)
  and every model is reachable; the popup never extends below the viewport.
- AC-2: The filter input and any stale-model notice stay fixed/visible while the
  list scrolls (they live outside the scroll container).
- AC-3: Sticky provider group headers still stick within the scroll container.
- AC-4: Keyboard navigation (`scrollToIndex` → `scrollIntoView({block:"nearest"})`)
  keeps the active row visible inside the new scroll container.
- AC-5: offline / error / loading / empty / no-match states render unchanged.
- AC-6: `npm run typecheck` and `npm run lint` pass; existing `npm test` suites pass.

## Decisions

- Max-height must be viewport-aware (picker opens downward from the header), e.g.
  a `min(…rem, calc(100vh - …rem))` cap; exact value implementer's choice.
- Keep semantic Tailwind tokens; follow existing className style.

## Owners

- Implementer: frontend
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented
- [x] Reviewed (PASS_WITH_NOTES: dvh assumption documented; live DOM check script kept out of repo; no automated regression test possible without component-render tooling)
- [x] Committed