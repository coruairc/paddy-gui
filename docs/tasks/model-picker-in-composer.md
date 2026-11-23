# Task: move the model picker into the composer

## Goal

The model picker gets the agent-picker treatment: the top-right header trigger
is REMOVED and the model selection becomes a compact dropdown in the composer
footer row, beside the agent picker. Same mental model as ChatGPT: model and
agent controls live at the input.

## Baseline

- Dispatch base: the committed SHA current when this task starts (expected:
  the result of bubble-actions-and-row-delete). Record it.
- `git status --short` before delegation: **clean**

## Current state (orchestrator analysis — verify before starting; line numbers
have shifted with recent commits, locate by content)

- `src/components/desk/model-picker.tsx`: full combobox — trigger Button
  (`max-w-[14rem]`, aria-haspopup/aria-expanded/aria-controls, stale
  AlertCircle + sr-only stale notice), popup (`absolute top-full right-0`,
  `w-[min(24rem,calc(100vw-1.5rem))]`, overflow-hidden wrapper), filter input,
  provider groups with sticky headers, states
  offline/error/loading/empty/no-match, keyboard nav with
  aria-activedescendant, `scrollbar-thin max-h-[min(28rem,calc(100dvh-10rem))]
  overflow-y-auto overscroll-contain scroll-pt-9` listbox (the scroll-fixed
  classes), OptionRow with Default/Disabled/selected badges. The POPUP BODY is
  mature and battle-tested — reuse it; what changes is placement, trigger
  presentation, and popup direction/positioning.
- Header usage (app.tsx, `pickerOpen` state, `chooseModel(key)`,
  `setPickerOpen(false)` on select): remove the header mount; keep
  Live/Offline indicator and session title in the header.
- Composer footer row (from the agent-picker task): contains AgentPicker;
  gains the model trigger beside it. `modelNote` line already renders under
  the composer (modelSaveFailure) — unchanged.
- Model state plumbing is independent of mount location: `model`,
  `modelSource` ("desk" | "session"), `chooseModel` (PATCH settings
  deskModel + optimistic setModel), `resolveHeaderModel` on
  `model-selected` events, `active.isStale` notice, catalog
  loading/error/retry. None of that changes.
- The agent picker (`agent-picker.tsx`) established the composer-dropdown
  pattern: FIXED viewport-clamped popup rect (recomputed on open + resize),
  scroll-local list, Escape/outside-click close with focus return. The model
  popup needs the same treatment — but CRITICALLY it must open UPWARD (the
  composer is at the bottom of the viewport; the header popup opened DOWN).

## Acceptance criteria

- AC-1: The header no longer mounts the model picker (no trigger in the
  header). Header keeps the title and Live/Offline indicator.
- AC-2: A compact model trigger (icon + current model name, truncated,
  chevron; aria-haspopup="listbox", aria-expanded) sits in the composer
  footer row beside the agent trigger, visually consistent with it (same
  height/typography family).
- AC-3: The popup body is the EXISTING ModelPicker list (filter, provider
  groups, sticky headers, badges, states, keyboard nav) — not a rewrite —
  mounted with fixed, viewport-clamped positioning that opens UPWARD from
  the composer row (clamp to viewport; recomputed on open + resize; never
  clipped by the viewport edge; no page-scroll shifts because the shell does
  not scroll). List scrolling stays list-local (existing max-h/overflow
  classes, adjusted if the upward space budget differs).
- AC-4: Selection semantics unchanged: chooseModel(key) + setPickerOpen
  closed on select; stale-model notice (AlertCircle + sr-only text + popup
  stale row) still appears; session model events still update the trigger
  label; modelNote failure line still renders.
- AC-5: Composer flows intact: Enter/Shift+Enter, / command palette, agent
  picker, Add-project dialog, Send/Stop — no interference; both composer
  popups never render simultaneously (opening one closes the other).
- AC-6: The model and agent triggers align in the footer row at 1280 and
  390 widths; popup never creates horizontal scroll; textarea width
  unchanged.
- AC-7: `npm run typecheck`, `npm run lint`, `npm test` pass (no new
  dependencies; pure-helper tests only if warranted).
- AC-8: Live Playwright (127.0.0.1:8080, do not start/kill): trigger label
  matches current model; popup opens upward inside the viewport at both
  widths; filter + group scroll + keyboard select work; selection updates
  trigger + persists (deskModel PATCH observed or state evidence); stale
  notice path exercised if feasible via state manipulation or code
  argument; opening model closes agent and vice versa; header mount gone;
  QA state cleaned up, user state as found.

## Non-goals

- No changes to model CATALOG loading, chooseModel persistence, or
  ModelPicker list internals beyond mount/positioning.
- No header redesign beyond removing the picker mount. No dependency changes.

## Owners

- Implementer: frontend (queued — dispatch only after
  bubble-actions-and-row-delete is committed)
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented (base b1fa663; ran in parallel with the backend
  inspector-max task per user direction — disjoint files. Compact composer
  trigger + fixed upward viewport-clamped popup; popup body reused verbatim;
  AgentPicker gains optional controlled open/onOpenChange for exclusivity;
  header mount removed. Live: PATCH deskModel observed on keyboard select,
  upward popup at 1280/390, exclusivity both directions, stale path via route
  interception, composer flows intact, model restored + state as found.)
- [x] Reviewed (PASS_WITH_NOTES, no findings — scoped diff review excluding
  the parallel panel-size work. Declared risks accepted: first paint shows
  the model key until first open (old header behaviour); 390px label
  truncation with full name in tooltip/aria; popup maxHeight 200px floor on
  very short viewports; picker mounted with no project selected — reviewer
  judged sane; AgentPicker uncontrolled default unchanged.)
- [x] Committed