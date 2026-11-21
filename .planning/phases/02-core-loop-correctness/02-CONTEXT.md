# Phase 2: Core Loop Correctness - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can drive one OpenCode session from first message to finished run without duplicate turns, a wiped password, or an orphaned server. Covers LOOP-01..LOOP-05. UI hint: yes.

</domain>

<decisions>
## Implementation Decisions

### Message reconciliation (LOOP-01)
- Keep optimistic user bubble with temp id; reconcile by matching (role + text + created proximity) on server echo; drop temp id.
- Optimistic bubble shows while request in flight; remove on error; keep on success until echo arrives.
- Disable submit while working; ignore duplicate send.

### Password save semantics (LOOP-02)
- Settings → Connection Save with blank password field preserves stored password.
- Non-empty field replaces; empty keeps; show placeholder "•••• (stored)".
- Server enforces: only update connectionPassword when provided non-empty.
- Explicit "Clear password" action deletes stored password.

### Process exit and cleanup (LOOP-03)
- On controller exit (SIGINT/SIGTERM/docker stop), kill spawned opencode serve.
- Kill: SIGTERM, wait 5s, then SIGKILL.
- Settings → Reset also kills spawned child, clears ownedPassword.
- Spawn with detached + kill process group for orphan prevention.

### Permission prompts and session resume (LOOP-04/05)
- Permission prompt: inline card in thread with Allow/Deny.
- On deny: abort run; show denial in thread.
- After browser restart: reattach to session id; reload messages.
- Stop → retry on same session works; no duplicate turns.

### the agent's Discretion
- Any additional implementation details.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- src/components/desk/app.tsx: submit(), mergeMessage, appendDelta, upsertActivity.
- src/server/runtime.ts: spawnServer, disconnect, child process.
- src/server/state.ts: connectionPassword, ownedServerPassword.
- src/components/desk/settings.tsx: connection save.

### Established Patterns
- React useState functional updaters; useRef mirroring.
- runtime persists on mutation.

### Integration Points
- api.settings() in client; handleApi settings route.
- bin/paddy.mjs / process signals for exit.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
