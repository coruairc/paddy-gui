# Task: fix-realtime-events — chat only updates after a page reload

## Goal

The desk must apply chat updates live and recover from SSE interruptions without
a page reload: supervised EventSource reconnection plus catch-up of events missed
while disconnected.

## Baseline

- Base SHA: `0769900` (main; includes the reviewed model-picker scroll fix)
- `git status --short` before delegation: **clean**

## Orchestrator evidence (live, this session)

Server side is PROVEN HEALTHY — do not change server code:
- `curl -N /api/events` delivers the initial `connection` frame immediately.
- Session create/delete via the API fan out as `session` / `session-deleted` live.
- A real turn (model `alibaba-token-plan/qwen3.8-max`) delivered, live and in
  order: `model-selected`, user `message`, `status working`, `text-delta`,
  assistant `message`, `status idle`. OpenCode 2.3.2 vocabulary matches
  `normalize.ts`. (An earlier test with OpenCode's default model failed on
  OpenRouter credits — that captured turn was a red herring; disregard it.)

Browser-side defect (src/components/desk/app.tsx:324-373):
- The bootstrap effect runs once (`[applyEvent]`, stable) and creates
  `new EventSource("/api/events")`.
- `stream.addEventListener("error", ...)` closes the stream when
  `readyState === EventSource.CLOSED` — and NOTHING ever recreates it.
  Fatal SSE errors (wrong content-type during a dev-server restart, network
  stack reset, laptop sleep edge cases) therefore kill live updates permanently
  until a full page reload.
- `onerror` shows "Lost the desk connection. Reconnecting…" even when no
  reconnection will happen (CLOSED case) — dishonest banner.
- Even with native auto-reconnect (CONNECTING case), events missed during the
  gap are lost: there is no catch-up refetch of the open session on recovery.

## Reproduction recipe (Playwright, do NOT kill the shared dev server)

`page.route("**/api/events", route => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }))`
→ EventSource treats wrong content-type as fatal → CLOSED → current code never
recovers. Verify the defect, then verify the fix recovers (unroute/fulfill a real
SSE stream or let it pass through to the live server) and catches up.

## Scope

- `src/components/desk/app.tsx` — the SSE/bootstrap effect and recovery wiring.
- Optional new plain-logic helper module (kebab-case, e.g. `event-stream.ts`)
  with injected clock/timers, unit-tested with `node:test` — follow the
  `autonomous-drink.ts` / `use-autonomous-drink.ts` pattern. No component-render
  test tooling.

## Non-goals

- No server changes (`src/server/*` proven healthy). No dependency changes.
- No polling-while-connected fallback. No changes to unrelated components.
- Do not disturb scroll position, expanded turns, or inspector state on catch-up.

## Acceptance criteria

- AC-1: A fatal SSE close (CLOSED) is followed by supervised recreation with
  bounded backoff; the desk recovers live updates without a page reload.
- AC-2: After any disconnect gap, the open session's messages are caught up
  (refetch + merge by message id — no duplicates) and the session list refreshed.
- AC-3: The connection banner is honest: visible while disconnected/retrying,
  cleared on recovery; never claims "Reconnecting…" when no retry is scheduled.
- AC-4: Normal streaming unchanged: deltas append, activities upsert, no
  duplicate messages after catch-up, no effect re-run loops or reconnect storms.
- AC-5: Unmount cleanup closes streams and clears timers; project/session
  switches do not leak subscriptions.
- AC-6: `npm run typecheck`, `npm run lint`, `npm test` pass; new pure logic has
  node:test coverage (backoff scheduling, catch-up decision).

## Owners

- Implementer: frontend
- Reviewer: reviewer (gate before any commit)

## Review round 1 — FAIL (CODE_DEFECT), fixes required

- R1 HIGH: catch-up never clears `working` when the turn ended during the gap
  (missed idle is not replayed; connection frame doesn't help). Spinner sticks
  and submit() stays blocked — the original symptom survives. Fix: derive
  working from the caught-up snapshot (pure helper `workingAfterCatchUp`),
  settle turnTracker when inferring idle; only when sessionRef still matches.
- R2 MEDIUM: mergeMessages appends unknown ids (mis-order vs snapshot) and
  replaces live activity with stale snapshot status. Fix: snapshot order,
  longer-wins text overlay, activity merge by id without status regression,
  keep pending-echo settlement, append only live-only non-echo messages.
- R3 MEDIUM: api.sessions() catch-up write ignores a project switch in flight.
  Fix: capture activeProjectId at catchUp start; drop the write if it changed.
- R4 LOW: streamNotice hidden whenever `error` is set. Fix: show both, or give
  the SSE notice priority while a retry is outstanding.
- Optional hardening: close previous source inside connect() (local invariant).
- Regression tests required for R1/R2/R3 (pure helpers, node:test).

## Review round 2 — fixes implemented, verdict pending

Implementer resolved R1–R4 plus the connect() hardening:
- R1: `workingAfterCatchUp(messages)` + turnTracker settlement in catch-up
  (sessionRef-guarded). Live Playwright: mid-turn fatal close, turn finished in
  gap, recovery cleared Working and enabled Send — no reload.
- R2: `mergeMessages` rewritten — snapshot order, longer-wins text, activity
  merge by id with progress rank (no status regression), echo settlement kept.
- R3: `catchUpProjectMatches` guard; activeProjectIdRef written synchronously at
  all three project-change sites.
- R4: render priority auth form → SSE notice → generic error bar.
- Tests: 7 new regression tests (messages.test.ts 30 pass); full suite 286 pass;
  typecheck/lint exit 0. Live: {ok:true, eventsRequests:6, loads:1}.
- Declared risks: text-only turn may read idle until next delta; ref-based guard
  depends on paired writes; R4 code-inspection only; tests stay in
  messages.test.ts (package.json out of scope).

## Review round 2 — PASS_WITH_NOTES (ACCEPT)

All findings R1–R4 RESOLVED with file:line evidence; no new findings. Reviewer
re-ran typecheck (exit 0), lint (exit 0, 5 pre-existing warnings), npm test
(23 + 286 pass / 0 fail). Live Playwright reported-not-reproduced (script outside
reviewer workspace). Residual risks recorded as follow-ups:

- F1: `setWorking(stillWorking)` uses the raw snapshot; an idle frame landing
  during the openSession RTT can be overridden back to true with no later idle
  (narrow, not self-healing). Fix: only clear from the snapshot
  (`if (!stillWorking) setWorking(false)`), never force true over a live idle.
- F2: inferred idle does not refresh an already-open Changes tab (matches the
  non-goal; per-turn blocks still refetch). No action.
- F3: equal terminal rank prefers snapshot item (stale terminal can replace the
  other live terminal). Accepted; not the running regression.
- F4: split event-stream tests into event-stream.test.ts + package.json test
  script entry (edit-ask; needs user approval). Deferred.

## Status

- [x] Implemented (rounds 1 + 2)
- [x] Reviewed (round 1: FAIL; round 2: PASS_WITH_NOTES — ACCEPT)
- [x] Committed