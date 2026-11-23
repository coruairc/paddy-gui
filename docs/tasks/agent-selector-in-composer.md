# Task: move the Agent selector into the composer

## Goal

The Agent selector moves out of the sidebar footer into a small dropdown
inside the message composer (the "Message Paddy" box), the way modern chat
UIs put model/agent controls next to the input.

## Baseline

- Dispatch base: whatever SHA is current when this task starts (expected: the
  committed result of session-row-actions-and-folder-picker). Record it.
- `git status --short` before delegation: **clean**

## Current state (orchestrator analysis, verify before starting)

- Sidebar footer block at `app.tsx:1059-1066`: `<label>Agent</label>` + a
  native `<select id="desk-agent">` (options built from payload ids via
  `agents.ts` helpers, default row value "" labelled from the payload's build
  entry). This whole block is REMOVED by this task.
- Send semantics: `agent || undefined` at `app.tsx:944` — "" sends no agent
  param (OpenCode default agent). Keep exactly.
- Agent payload: `/api/agents` → `{ id, name, ... }[]` (79 entries);
  `src/components/desk/agents.ts` already exports `agentOptions`,
  `agentChoices`, `defaultAgentName`, `DEFAULT_AGENT_ID` — reuse them.
- Composer: rounded-2xl elevated box at `app.tsx:1419-1502` — `flex items-end
  gap-2 p-2` containing the textarea (data-composer) and the Send/Stop
  button. Below the box: modelNote line and the "Enter to send…" hint.
- Repo popover precedents (follow one): `model-picker.tsx` (full combobox:
  trigger + absolute popup, focus return, outside-click close, keyboard nav,
  max-h + overflow-y-auto listbox, sticky headers) and `command-palette.tsx`.
  The agent list is flat (79, deduped by id) — a simpler flat listbox suffices.

## Scope

- `src/components/desk/app.tsx` — remove the sidebar Agent block; add the
  composer agent dropdown.
- Optional small kebab-case component module for the dropdown (e.g.
  `agent-picker.tsx`) + pure helpers only if warranted; tests only in
  already-listed suites.
- No server changes. No dependency changes.

## Non-goals

- No changes to send semantics, model picking, command palette, or agents.ts
  behavior (id mapping, dedupe, default row).
- No sidebar redesign beyond removing the Agent block (Settings button stays).

## Acceptance criteria

- AC-1: The sidebar footer no longer has the Agent label/select. The Settings
  button and everything else in that block is unchanged.
- AC-2: A compact agent trigger (icon + current agent's display name,
  aria-haspopup="listbox", aria-expanded) sits inside the composer box —
  left of the textarea or as a small footer row inside the box; it must not
  shrink the textarea's usable width materially on mobile (verify at 390px).
- AC-3: Clicking opens a small flat listbox popup: scrollable (max-h +
  overflow-y-auto + overscroll-contain — the picker-scroll lesson), options
  are agent display names, values are ids, default row first (labelled from
  the payload's default agent), current selection marked, keyboard nav
  (ArrowUp/Down/Home/End + Enter selects, Escape closes and returns focus to
  the trigger), outside-click closes, aria-activedescendant wired.
- AC-4: Selection updates `agent` state exactly as the old select did
  ("" default preserved; chosen id sent via `agent || undefined`); reopening
  the popup highlights the current choice.
- AC-5: The composer box keeps its focus/keyboard flows: typing, Enter to
  send, Shift+Enter newline, command palette all unaffected; the trigger is
  one tab stop that does not trap focus when closed.
- AC-6: `npm run typecheck`, `npm run lint`, `npm test` pass.
- AC-7: Live Playwright (127.0.0.1:8080, do not start/kill): trigger visible
  and usable at 1280 and 390 widths; popup opens/closes via click and Escape;
  selecting General sets the composer state and a subsequent send includes
  agent id (assert request payload or stub); default row first and labelled
  Build; scroll through the full list reaches the last agent. Leave user
  state as found.

## Owners

- Implementer: frontend (queued — dispatch only after
  session-row-actions-and-folder-picker is committed)
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented (base 64aa55f; new agent-picker.tsx — compact composer
  dropdown, fixed viewport-clamped popup, flat listbox with default row first,
  ids as values, full keyboard nav; agents.ts gains agentRows with 2 tests;
  sidebar Agent block removed; composer gains an agent footer row. Send
  semantics proven live via stubbed payloads: general → agent:"general",
  default → no agent key.)
- [x] Reviewed (PASS_WITH_NOTES, no findings. Declared risks accepted:
  popup placement recomputed on open/resize only (shell never scrolls),
  390px popup overlap of sidebar area stays inside viewport, footer row
  +~32px height, Tab closes without preventDefault. Noted: stale agent id
  after project switch falls back to the default label while send still
  sends the stale id — pre-existing select behavior showed blank instead.)
- [x] Committed