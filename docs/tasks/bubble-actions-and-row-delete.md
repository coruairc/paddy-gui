# Task: bubble hover actions (copy/retry) + row Delete

## Goal

ChatGPT-style message actions and a destructive row action:
(A) Copy + Retry appear as hover actions on the chat bubbles; Retry (a resend
    of the last message) moves OFF the session rows ONTO the last user bubble.
(B) The session rows gain Delete beside Rename/Archive.

## Baseline

- Dispatch base: the committed SHA current when this task starts (expected:
  the result of agent-selector-in-composer). Record it.
- `git status --short` before delegation: **clean**

## Current state (orchestrator analysis — line numbers are from 64aa55f and
will have shifted; locate by content)

- MessageView (`app.tsx:2007+`): user bubble at `:2013-2026` (green bubble,
  pending dot, timestamp), assistant bubble at `:2028-2066` (grey reply
  bubble, Markdown, error line). MessageView receives ONLY `message` and
  renders from the transcript at `app.tsx:1231` `messages.map`.
- SessionRow (`app.tsx:1606+`): Rename / Archive icons; a per-row
  `retrySession` exists and calls `api.retry(item.id)` — REMOVE the row Retry
  in this task (it becomes the bubble action).
- `api.deleteSession(id)` exists (`client.ts:199`, DELETE /api/sessions/:id —
  server route verified in earlier QA). The `session-deleted` SSE handling
  already removes the row, forgets storage, tears down the open chat if it
  was deleted (`app.tsx` applyEvent session-deleted branch), and
  `archiveUndo.forget(id)` covers notice interactions.
- Reveal patterns established in 64aa55f: `group` + `group-hover`/
  `group-focus-within` opacity + always-on for the active row and
  `[@media(pointer:coarse)]`.

## Part A — bubble actions

- AC-A1: Copy icon button on every user and assistant bubble (not system
  messages): revealed on bubble hover/focus-within, always visible on coarse
  pointers; copies `message.text` via the Clipboard API; transient feedback
  (icon → check for ~1.5 s); `aria-label="Copy message"`; clipboard failure →
  `toast.error` (repo already uses sonner).
- AC-A2: Retry (RotateCcw icon, `aria-label="Resend last message"`) appears
  ONLY on the most recent non-pending USER message of the open chat — the
  user's model: "retry is just a resend of the last message". Calls the same
  retry flow as before (`api.retry(openId)` semantics — reuse the existing
  per-session retry path). Disabled (or hidden) while `working`; never on
  pending/optimistic echoes.
- AC-A3: The Retry action is REMOVED from SessionRow (rows keep only
  Rename/Archive + the new Delete). The old header retry() for the open chat
  remains whatever the composer/header currently offers — do not duplicate
  controls; one retry surface: the bubble.
- AC-A4: MessageView needs new props from the transcript render site
  (`app.tsx:1231`): whether this message is retryable (last user message of
  the open session) and handlers. Keep MessageView a pure presentational
  component; compute last-user logic at the render site (a small pure helper
  is welcome, e.g. in messages.ts with a node:test).
- AC-A5: Bubbles' existing layout, contrast-guarded classes, timestamps,
  pending dot, and the reply-bubble styles are unchanged; actions do not
  shift bubble width when revealed (overlay or reserved space — implementer's
  choice, no layout jump).
- AC-A6: Edit (Pencil icon, `aria-label="Edit message"`) appears ONLY on the
  most recent non-pending USER message, beside Retry and Copy. Clicking turns
  the bubble into an inline editable textarea pre-filled with the message
  text; Enter submits, Escape cancels (bubble restored, focus returned to the
  Edit button). Eligibility identical to Retry (last user message of the open
  chat, never while `working`).
- AC-A7: Edit semantics (user's words: "retry(resend) copy and edit" —
  ChatGPT-style). New controller route `POST /api/sessions/:id/edit` with
  body `{ text }`, mirroring the established retry route
  (`api.ts:324-339` pattern): list messages; 400 "Nothing to edit" if no last
  user message; best-effort delete of the last assistant message (same
  try/catch comment as retry); REQUIRED delete of the last USER message —
  on delete failure return an error and DO NOT send (a failed edit must not
  duplicate the prompt); then `sendMessage` with the new text; 202 `{ok:true}`.
  Browser client gains `api.editMessage(id, text)`. Server test for the route
  in the existing api.test.ts patterns (red-first).
- AC-A8: Transcript correctness after an edit: the edited pair must not linger
  as stale bubbles. After a successful edit the UI removes the old user
  message and its following assistant reply locally and runs the normal send
  flow for the new text (optimistic echo + SSE merge), OR refetches the
  session — implementer's choice, verified live: exactly one user bubble
  with the edited text, a fresh assistant reply arrives, no duplicates.
  SSE events for deleted messages are dropped by the normalizer (unknown
  types return null) — the UI must not rely on them.

## Part B — row Delete

- AC-B1: A Trash icon appears after Archive on every session row (same reveal
  rules as the other row actions; `aria-label="Delete '<title>'"`).
- AC-B2: Delete is DESTRUCTIVE with no undo → two-step inline confirm, no
  window.confirm: first click swaps the button to a danger "Delete?" state
  for ~4 s (Escape/blur/click-away resets), second click calls
  `api.deleteSession(item.id)`. After success: `refreshSessions()` for
  immediate row removal (the SSE `session-deleted` event also fires — the
  existing branch already handles storage/notice/teardown; ensure no double
  handling breaks either path).
- AC-B3: Deleting the OPEN chat must land on the same teardown state as
  archive-of-open (Console header, cleared transcript) — verify the
  session-deleted branch covers the API-initiated delete too (it should: the
  SSE event is the driver).

## Verification

- AC-V1: `npm run typecheck`, `npm run lint`, `npm test` pass; new pure logic
  (e.g. last-user/retryable decision) covered by node:test in already-listed
  suites.
- AC-V2: Live Playwright (127.0.0.1:8080, do not start/kill): Copy on both
  bubble kinds with clipboard assert + transient check; Retry visible only on
  the last user bubble, absent on pending echoes, disabled/hidden while
  working; row Retry gone; Edit flow end-to-end on a throwaway session —
  edit the last prompt to a new text, assert the transcript shows exactly the
  edited bubble and a regenerated reply, no stale/duplicate bubbles; Edit
  failure path (stub the route to 500) leaves the original bubble intact;
  Delete two-step on a throwaway session (cancel resets, confirm deletes,
  row disappears, deleting the open chat lands on Console); coarse-pointer
  visibility; cleanup ALL QA artifacts, user state as found.

## Non-goals

- No changes to archive-undo, the existing retry route, or the composer work
  from the previous task. Edit ONLY on the last user message (no
  branching/editing of older messages — OpenCode sessions are linear; say so
  in the UI if relevant, e.g. aria-label wording). No edits-on-assistant
  bubbles. No dependency changes. The edit route is the ONLY new server
  surface; reuse `deleteMessage`/`sendMessage` from the existing client.

## Owners

- Implementer: frontend (queued — dispatch only after
  agent-selector-in-composer is committed)
- Reviewer: reviewer (gate before any commit)

## Round 2 — Edit reworked on session.revert (user-approved decision)

Round 1 finding: OpenCode v2.3.2 has NO message-delete route (embedded API
schema shows only `session.message.get`; `deleteMessage` → 404). The delete-
based edit route fails safe (503 + no send) but its success path is blocked.
The installed schema DOES expose `session.revert.stage`/`session.revert.commit`
(decision: revert-based edit, approved by the user 23 Nov).

- AC-A7 is AMENDED: `POST /api/sessions/:id/edit` keeps its browser contract
  (`{ text }`) but the internals use the revert API: revert the session to
  before the last user message, then `sendMessage` with the edited text.
  New OpenCodeClient methods for the revert wire (investigate the exact
  stage/commit payload semantics from the installed binary and/or a
  throwaway QA session probe before implementing). Revert failure → 503
  with reason, NO send; nothing to edit → 400. deleteMessage is no longer
  used by the edit route (retry keeps its pre-existing best-effort call).
- AC-A8 becomes fully verifiable: live Edit success — exactly one edited
  user bubble, regenerated reply, no stale/duplicate bubbles.
- Server tests reworked red-first against the revert-based route (mock the
  revert endpoints like other api.test.ts patterns).

## Status

- [x] Implemented (round 1: Copy/Retry/bubble actions, row Delete, edit route
  delete-based — 312 tests pass; Edit success blocked by missing wire API)
- [x] Round 2: revert-based edit (wire extracted from the installed binary —
  stage POST /api/session/:id/revert/stage {messageID}, commit → 204,
  DELETE → 204; semantics proven by OpenCode's own desktop-client
  projection (id >= to splice); live Edit success verified end-to-end:
  OLD → NEW, old pair excised, exactly one edited bubble + fresh reply)
- [x] Reviewed (combined PASS_WITH_NOTES, no findings; all ACs met.
  Noted risks accepted: edit is not transactional (send failure after
  commit leaves a stale transcript until refetch — approved ordering);
  busy 409 → 503 no send; file-snapshot rollback on edit unverified
  (product note); clear best-effort; deleteChat mirrors SSE teardown
  locally but skips command-ref clearing; edit/retry send {text} only —
  the composer's current model/agent are NOT applied to the regenerated
  turn, matching the pre-existing retry shape.)
- [x] Committed