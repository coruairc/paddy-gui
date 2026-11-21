# Phase 2: Core Loop Correctness - Research

**Researched:** 2026-11-21
**Domain:** Message reconciliation, connection password persistence, spawned-process lifecycle, inline permission prompts, session resume
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Keep optimistic user bubble with temp id; reconcile by matching (role + text + created proximity) on server echo; drop temp id.
- Optimistic bubble shows while request in flight; remove on error; keep on success until echo arrives.
- Disable submit while working; ignore duplicate send.
- Settings → Connection Save with blank password field preserves stored password.
- Non-empty field replaces; empty keeps; show placeholder "•••• (stored)".
- Server enforces: only update connectionPassword when provided non-empty.
- Explicit "Clear password" action deletes stored password.
- On controller exit (SIGINT/SIGTERM/docker stop), kill spawned opencode serve.
- Kill: SIGTERM, wait 5s, then SIGKILL.
- Settings → Reset also kills spawned child, clears ownedPassword.
- Spawn with detached + kill process group for orphan prevention.
- Permission prompt: inline card in thread with Allow/Deny.
- On deny: abort run; show denial in thread.
- After browser restart: reattach to session id; reload messages.
- Stop → retry on same session works; no duplicate turns.

### the agent's Discretion
- Any additional implementation details.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOOP-01 | A sent message appears exactly once in the thread, reconciled with the server echo | Optimistic bubble + `mergeMessage` reconciliation by (role + text + created proximity); duplicate-submit guard; pending flag on `ChatMessage` |
| LOOP-02 | Settings → Connection "Save" preserves an already-stored password when the field is left blank | `updateSettings` only writes `connectionPassword` when provided non-empty; explicit clear flag; `hasConnectionPassword` drives placeholder |
| LOOP-03 | Exiting Paddy terminates the spawned `opencode serve` child, leaving no orphan process | `detached: true` spawn, process-group kill, SIGTERM→5s→SIGKILL, signal handlers, clear `ownedServerPassword` |
| LOOP-04 | Stop, retry, and session resume still work after the loop fixes | `abort`/`retry` unchanged; retry must not re-append an optimistic bubble; resume loads server messages as source of truth |
| LOOP-05 | Permission prompts can be allowed or denied inline and the run continues or aborts accordingly | Inline `PermissionCard` with pending state; reply route already present; deny records a system line and aborts |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Optimistic message bubble + reconciliation | Browser / Client (React) | — | `src/components/desk/app.tsx` owns message state; server is source of truth |
| Duplicate-submit guard | Browser / Client | — | `submit()` early-returns while `working` or a pending bubble exists |
| Password preserve/clear semantics | API / Backend (controller) | Browser UI | `updateSettings` in `src/server/api.ts` is the enforcement point; UI mirrors with placeholder |
| Spawned child lifecycle + orphan prevention | API / Backend (controller) | OS process group | `ControllerRuntime` in `src/server/runtime.ts` owns `child` |
| Signal handling on exit | Node process (Vite dev server) | `bin/paddy.mjs` | Registered in `opencodeControllerPlugin` configureServer |
| Inline permission prompt | Browser / Client | API / Backend | Card renders in thread; reply goes through `/api/permissions/:id/reply` |
| Session resume after restart | Browser / Client (localStorage) | API / Backend | Client stores last session id; server messages are authoritative |
| Spawn seam for tests | API / Backend | — | Injected into `ControllerRuntime` constructor |

## Standard Stack

No new dependencies. Everything uses Node built-ins and the existing React/TanStack stack.

| Library / Module | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| `node:child_process` (`spawn`) | Node 22+ | Spawn `opencode serve` detached | Already used; `detached: true` enables process-group kill |
| `node:process` signals | Node 22+ | SIGINT/SIGTERM/SIGHUP handlers | Standard graceful shutdown |
| React `useState`/`useRef` | 19.2 | Pending bubble + prompt pending state | Established pattern in this repo |
| `node:test` | built-in | Runtime + reducer tests | Project constraint (no Jest/Vitest) |

**Version verification:** No packages added; `npm view` not applicable. Existing lockfile unchanged.

## Package Legitimacy Audit

No external packages are introduced by this phase. All changes use existing dependencies and Node built-ins.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| (none) | — | — | — |

## Architecture Patterns

### Pattern 1: Optimistic message bubble + reconciliation (LOOP-01)

**What:** Append a bubble with a temp id on submit, mark it `pending: true`, and reconcile it with the server-echoed user message instead of appending a second bubble.

**When to use:** Every `submit()` that creates a user turn.

**Files:** `src/components/desk/app.tsx`, `src/server/normalize.ts`, `src/lib/desk/client.ts`.

**Changes:**

1. Extend `ChatMessage` in both `src/server/normalize.ts` and `src/lib/desk/client.ts`:
   ```typescript
   export type ChatMessage = {
     id: string;
     role: "user" | "assistant" | "system";
     text: string;
     created: number;
     error?: string;
     activity: ActivityItem[];
     pending?: boolean;
   };
   ```
   `[VERIFIED: src/server/normalize.ts:18-25]` and `[VERIFIED: src/lib/desk/client.ts:62-69]` — current unions are `"user" | "assistant"`; `"system"` is added for denial lines.

2. `submit()` (app.tsx) becomes:
   ```typescript
   async function submit() {
     const text = draft.trim();
     if (!text || working) return;
     if (messages.some((m) => m.pending)) return; // duplicate guard
     if (!project) { setError("Add a project before starting a chat."); return; }
     setDraft("");
     setError(null);
     setStick(true);
     setSettingsOpen(false);
     let id = sessionId;
     if (!id) {
       const created = await api.createSession();
       id = created.session.id;
       setSessionId(id);
       setSessions((current) => upsertSession(current, created.session));
     }
     const tempId = `local_${Date.now()}`;
     setMessages((current) => [
       ...current,
       { id: tempId, role: "user", text, created: Date.now(), activity: [], pending: true },
     ]);
     setWorking(true);
     try {
       await api.send(id, text, model || undefined, agent || undefined);
     } catch (err) {
       setMessages((current) => current.filter((m) => m.id !== tempId));
       setDraft(text);
       setWorking(false);
       setError(err instanceof Error ? err.message : "Could not send that");
     }
   }
   ```
   The optimistic bubble is kept on success until the server echo arrives; on error it is removed and the draft restored. `[CITED: 02-UI-SPEC.md §Optimistic message bubble]`.

3. Reconciliation in `mergeMessage` (`src/components/desk/app.tsx`):
   ```typescript
   function mergeMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
     // Exact id match (assistant turns, or already-reconciled user turns).
     if (list.some((item) => item.id === message.id)) {
       return list.map((item) =>
         item.id === message.id
           ? { ...item, text: message.text || item.text, error: message.error ?? item.error, activity: message.activity.length ? message.activity : item.activity, pending: false }
           : item,
       );
     }
     // Reconcile an optimistic user bubble with the server echo.
     if (message.role === "user") {
       const tempIndex = list.findIndex(
         (item) =>
           item.pending &&
           item.role === "user" &&
           item.text === message.text &&
           Math.abs(item.created - message.created) < 5000,
       );
       if (tempIndex >= 0) {
         const next = [...list];
         next[tempIndex] = { ...message, pending: false };
         return next;
       }
     }
     return [...list, message];
   }
   ```
   This drops the temp id and clears `pending` on the first matching echo. `[CITED: 02-UI-SPEC.md §Reconciliation]`.

4. Disable submit while working or while a pending bubble exists:
   ```tsx
   <Button type="submit" size="icon" disabled={working || !draft.trim() || messages.some((m) => m.pending)} …>
   ```
   and the textarea `onKeyDown` Enter handler should also bail when `working` or a pending bubble exists. `[CITED: 02-UI-SPEC.md §Duplicate submit guard]`.

5. `retry()` must not append an optimistic bubble; it reuses the existing session and re-sends the last user text. It should set `working` true and rely on the existing user turn. `[CITED: 02-UI-SPEC.md §Stop / retry / resume]`.

6. Pending dot styling: same bubble as a confirmed user bubble plus a 6px accent dot with `pulse-live` at the trailing edge, opacity 0.7. `[CITED: 02-UI-SPEC.md §Optimistic message bubble]`.

7. StrictMode purity fix (CONCERNS #perf): `applyEvent` currently calls `setFiles`/`setMessages`/`setWorking` inside `setSessionId` updaters. Read `sessionRef.current` outside the updater and branch there. This prevents double application under React 19 StrictMode. `[VERIFIED: src/components/desk/app.tsx:95-115]`.

8. Server echo text: `normalizeEvent` emits a `message` event for `message.updated` using `toChatMessage({ info, parts: [] })`, which yields empty text. For reconciliation by text to work, `normalizeEvent` must forward any `parts` present on the event (`props.parts` or `props.message?.parts`) into `toChatMessage`, and for `message.part.updated` with `part.type === "text"` and `part.text`, emit a `message` event carrying that text. Otherwise reconciliation falls back to role + created proximity and keeps the temp text. Marked as an implementation detail to verify against a live server. `[ASSUMED: OpenCode event payload includes parts on message.updated; not verified this session]`.

### Pattern 2: Password save semantics (LOOP-02)

**What:** Blank password field preserves the stored password; non-empty replaces; an explicit clear action deletes it.

**Files:** `src/server/api.ts` (`updateSettings`, `reset`), `src/components/desk/settings.tsx` (`Connection`), `src/server/state.ts` (`publicState`).

**Server logic (`updateSettings`):**
```typescript
async function updateSettings(runtime, request) {
  const body = await readBody(request);
  if (body.appearance === "light" || body.appearance === "dark") runtime.state.appearance = body.appearance;
  if (typeof body.connectionUrl === "string") runtime.state.connectionUrl = body.connectionUrl.trim();
  if (typeof body.connectionUsername === "string" && body.connectionUsername.trim()) {
    runtime.state.connectionUsername = body.connectionUsername.trim();
  }
  if (body.clearConnectionPassword === true) {
    runtime.state.connectionPassword = "";
  } else if (typeof body.connectionPassword === "string" && body.connectionPassword.trim() !== "") {
    runtime.state.connectionPassword = body.connectionPassword;
  }
  // preserve when absent or blank
  runtime.persist();
  return json(200, publicState(runtime.state));
}
```
`[VERIFIED: src/server/api.ts:155-165]` — current code assigns `connectionPassword` unconditionally; this is the fix. `clearConnectionPassword` is the explicit clear channel because a blank field now means "keep". `[CITED: 02-CONTEXT.md §Password save semantics]`.

**UI (`Connection` component):**
- Initialize `password` state to `""`.
- Placeholder: `hasConnectionPassword ? "•••• (stored)" : "Server password"`.
- Save sends `{ connectionUrl, connectionUsername, connectionPassword: password }` (blank preserved server-side). On success clear field and show "Saved. Reconnect to apply." in `text-ok`.
- "Clear password" button shown only when `hasConnectionPassword`. Confirm "Clear the stored OpenCode password?" then call `api.settings({ clearConnectionPassword: true })` and show "Password cleared." in `text-ok`.
- Need pass `hasConnectionPassword` into `SettingsPanel` (from `boot.hasConnectionPassword` or a status fetch). `[CITED: 02-UI-SPEC.md §Settings → Connection form]`.
- `hasConnectionPassword` is already in `publicState` (`src/server/state.ts:103-112`).

**Reset (`reset` in api.ts):** must also clear `ownedServerPassword` and stop the child (see Pattern 3). Currently clears `connectionPassword` but not `ownedServerPassword`. `[VERIFIED: src/server/api.ts:112-120]`.

### Pattern 3: Process exit and cleanup (LOOP-03)

**What:** Spawn detached, track the child, kill the whole process group on exit/reset, SIGTERM→5s→SIGKILL, and clear `ownedServerPassword`.

**Files:** `src/server/runtime.ts`, `src/server/api.ts` (`reset`), `vite.config.ts` (`opencodeControllerPlugin`).

**Spawn change (`spawnServer`):**
```typescript
private spawnServer(binary, port, username, password) {
  if (this.child && !this.child.killed) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const child = this.spawnImpl(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      detached: true,
      env: { ...process.env, OPENCODE_SERVER_USERNAME: username, OPENCODE_SERVER_PASSWORD: password },
      stdio: "ignore",
    });
    this.child = child;
    const timer = setTimeout(() => resolvePromise(), 600);
    child.once("error", (err) => { clearTimeout(timer); reject(err); });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      this.ownedPassword = "";
      this.state.ownedServerPassword = "";
      this.persist();
      this.setStatus({ connected: false, healthy: false, startedByController: false, error: `OpenCode exited (${code ?? signal ?? "signal"})` });
    });
    // Detach so the controller is not blocked; child runs in its own group.
    child.unref();
  });
}
```
`[VERIFIED: src/server/runtime.ts:227-254]` — current spawn uses `stdio: "ignore"` without `detached`; the `exit` listener stays registered and overwrites status after `disconnect()` kills the child (CONCERNS). The fix: guard the exit handler with `if (this.child !== child) return;` and only update status when not intentionally stopping.

**Kill helper:**
```typescript
private async killChild(): Promise<void> {
  const child = this.child;
  if (!child || child.killed) { this.child = null; return; }
  this.child = null; // prevent exit handler from racing
  const pid = child.pid;
  const killGroup = (signal: NodeJS.Signals) => {
    if (pid && pid > 1) {
      try { process.kill(-pid, signal); return; } catch { /* fall through */ }
    }
    try { child.kill(signal); } catch { /* already gone */ }
  };
  killGroup("SIGTERM");
  const exited = await waitForExit(child, 5000);
  if (!exited) killGroup("SIGKILL");
  await waitForExit(child, 5000).catch(() => {});
}
```
Use `detached: true` so `child.pid` is the process-group leader and `process.kill(-pid)` reaches grandchildren (`opencode serve` may spawn). `[CITED: scripts/preview.mjs killPid pattern for group kill]`.

**`disconnect()`:**
```typescript
async disconnect() {
  this.loopAbort?.abort();
  this.client?.disconnect();
  this.client = null;
  await this.killChild();
  this.ownedPassword = "";
  this.state.ownedServerPassword = "";
  this.persist();
  return this.setStatus({ connected: false, healthy: false, startedByController: false, error: undefined });
}
```

**Injectable spawn seam for tests:**
```typescript
export type SpawnImpl = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;

export type ControllerRuntimeOptions = {
  stateFile?: string;
  spawn?: SpawnImpl;
  sleep?: (ms: number) => Promise<void>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
};

constructor(options: ControllerRuntimeOptions | string = {}) {
  const opts = typeof options === "string" ? { stateFile: options } : options;
  this.stateFile = opts.stateFile ?? stateFilePath();
  this.state = readState(this.stateFile);
  this.ownedPassword = this.state.ownedServerPassword || "";
  this.spawnImpl = opts.spawn ?? spawn;
  this.sleepImpl = opts.sleep ?? sleep;
  this.killImpl = opts.kill ?? process.kill.bind(process);
}
```
Tests inject a fake `spawn` that returns an EventEmitter-like child with `pid`, `killed`, and `kill`, plus a fake `sleep` that resolves immediately, so spawn timing and exit handling are deterministic. `[CITED: CONCERNS.md §runtime.ts untested — "Add runtime.test.ts with an injected spawn/probe seam"]`.

**Signal handlers:** Register in `opencodeControllerPlugin().configureServer` (and `configurePreviewServer`):
```typescript
configureServer(server) {
  mount(server.middlewares);
  const runtime = getRuntime();
  const shutdown = () => { void runtime.disconnect().finally(() => process.exit(0)); };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, shutdown);
  }
}
```
Also handle `beforeExit`. For Docker, `docker stop` sends SIGTERM to PID 1; the Vite process receives it. `[CITED: CONCERNS.md §No graceful shutdown]`.

**Reset route (`reset` in api.ts):** call `await runtime.disconnect()` before clearing state, then clear `ownedServerPassword`, then persist. Show confirmation dialog already in UI. `[VERIFIED: src/components/desk/settings.tsx:104-113]` reset button.

**Exit handler guard:** only update status when `this.child === child` at entry; set `this.child = null` first in `killChild` so the spawned child's natural exit during shutdown does not overwrite the disconnected status.

### Pattern 4: Permission prompts and deny (LOOP-04/05)

**What:** Inline card with pending state; deny aborts the run and records a denial line.

**Files:** `src/components/desk/app.tsx` (`PermissionCard`, `reply`), `src/server/api.ts` (`replyPermission`), `src/server/normalize.ts`.

**UI (`PermissionCard`):** Convert to stateful component:
```typescript
function PermissionCard({ prompt, onReply }) {
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState("");
  const handle = async (decision, message?) => {
    setPending(true);
    try { await onReply(decision, message); }
    catch { toast.error("Could not reply. Try again."); setPending(false); }
  };
  // buttons disabled={pending}; label becomes "…" while pending
  // question kind: inline Input instead of window.prompt; empty submit no-op
}
```
`[CITED: 02-UI-SPEC.md §Permission prompt card]`.

**`reply()` in app.tsx:**
```typescript
async function reply(prompt, decision, message?) {
  try {
    await api.reply(prompt.id, decision, { sessionId: prompt.sessionId, kind: prompt.kind, message });
    setPrompts((current) => current.filter((p) => p.id !== prompt.id));
    if (decision === "reject") {
      setMessages((current) => [...current, { id: `sys_${Date.now()}`, role: "system", text: "Permission denied — run aborted.", created: Date.now(), activity: [] }]);
      setWorking(false);
      if (prompt.sessionId) void api.abort(prompt.sessionId).catch(() => {});
    }
  } catch (err) {
    toast.error("Could not reply. Try again.");
    throw err; // card re-enables
  }
}
```
On deny, append a muted system line and abort. `[CITED: 02-UI-SPEC.md §Permission deny]`. The card is removed from `prompts` on success (`permission-cleared` echo or direct filter).

**Question kind:** Replace `window.prompt` with an inline single-line `Input` + submit on Enter; empty submit is a no-op. `[CITED: 02-UI-SPEC.md §Permission prompt card]`.

**Server (`replyPermission`):** Already routes permission vs question. On `reject` for a question, calls `rejectQuestion`. For permission, calls `replyPermission(..., "reject", sessionId)`. No change needed except ensuring `sessionId` is forwarded (already is). `[VERIFIED: src/server/api.ts:350-369]`.

**PermissionCard accessibility:** `<article aria-labelledby={titleId}>`, buttons with focus rings. `[CITED: 02-UI-SPEC.md §Permission prompt card]`.

### Pattern 5: Session resume (LOOP-04)

**What:** Persist the last active session id client-side; on bootstrap reattach and reload messages; server is source of truth.

**Files:** `src/components/desk/app.tsx`, `src/lib/desk/client.ts`.

**Implementation:**
- On `openSession`/`newChat`/`submit` (when a session is created), write `localStorage.setItem("paddy:lastSession", id)` (and per-project key `paddy:lastSession:${activeProjectId}`).
- In the bootstrap `useEffect`, after `setBoot`, if a stored session id exists and the project matches, call `openSession(id)` (which fetches messages + diff) and show "Loading session…" spinner until first message arrives. `[CITED: 02-UI-SPEC.md §Resume after browser restart]`.
- Add a `loadingSession` boolean state; render a centered spinner with "Loading session…" while true and no messages. `[CITED: 02-UI-SPEC.md §loading thread]`.
- No duplicate turns: `openSession` replaces `messages` with server messages (`setMessages(data.messages)`), so the optimistic bubble from a previous tab is gone. `[VERIFIED: src/components/desk/app.tsx:205-219]`.
- `retry()` and `stop()` remain as-is; retry re-sends the last user text and relies on server-side deletion of the last assistant message (`api.ts:248-263`). `[VERIFIED: src/server/api.ts:248-263]`.

### Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process-group kill | Custom recursive child traversal | `detached: true` + `process.kill(-pid)` | OS-level, handles grandchildren |
| SIGTERM→SIGKILL escalation | Ad-hoc setTimeout chains | Small `killChild` helper with a `waitForExit` poll | Testable, matches `scripts/preview.mjs` pattern |
| Constant-time token compare | XOR loop | `node:crypto.timingSafeEqual` | Already used |
| Optimistic id mapping | Global id registry | Text+time heuristic in `mergeMessage` | Matches CONTEXT decision; no server change needed |
| Session resume storage | New server state field | `localStorage` | No server state churn; server stays source of truth for messages |

## Common Pitfalls

### Pitfall 1: `child.kill()` only signals the direct child
**What goes wrong:** `opencode serve` may spawn grandchildren; signaling only the direct child orphans them.
**How to avoid:** Spawn with `detached: true` and signal `-pid` (process group). Fall back to `child.kill` if group signal fails (e.g., already exited).
**Warning signs:** `pgrep -f "opencode serve"` after controller exit.

### Pitfall 2: Exit handler overwrites status after intentional disconnect
**What goes wrong:** The child's natural exit fires the `exit` listener, clobbering the disconnected status set by `disconnect()`.
**How to avoid:** Set `this.child = null` before killing; guard the exit handler with `if (this.child !== child) return;`.
**Warning signs:** Status flips to "OpenCode exited" right after a clean disconnect/reset.

### Pitfall 3: Duplicate optimistic bubbles on StrictMode double-invoke
**What goes wrong:** `applyEvent` mutates state inside `setSessionId` updaters, which React 19 StrictMode runs twice.
**How to avoid:** Move side effects outside updaters; read `sessionRef.current` for the branch condition.
**Warning signs:** Doubled text deltas or duplicate activity rows in dev.

### Pitfall 4: Reconciliation never matches because server echo has no text
**What goes wrong:** If `message.updated` carries no `parts`, the echo's text is `""` and the text heuristic fails.
**How to avoid:** Forward `parts` from the event when present; fall back to role + created proximity for user messages and keep the temp text.
**Warning signs:** User message appears twice after send.

### Pitfall 5: Clearing password via blank field ambiguity
**What goes wrong:** A blank field could mean "keep" or "clear"; conflating them makes clear impossible.
**How to avoid:** Blank/absent means keep; an explicit `clearConnectionPassword: true` flag means clear. Never treat empty string as clear.
**Warning signs:** "Clear password" button accidentally wipes on save.

### Pitfall 6: `process.kill(-pid)` throws ESRCH/EPERM
**What goes wrong:** Signaling a dead or foreign process group throws.
**How to avoid:** Wrap in try/catch and fall back to `child.kill`.

### Pitfall 7: Signal handlers registered multiple times
**What goes wrong:** `configureServer` may run more than once (preview + dev) or tests import the module.
**How to avoid:** Register with `process.once` and only in the Vite plugin path, not in `ControllerRuntime` constructor or test code.

### Pitfall 8: Retry re-appending an optimistic bubble
**What goes wrong:** If `retry()` calls `submit()`-style append, the thread shows the user turn twice.
**How to avoid:** `retry()` sets `working` true and calls `api.retry` without touching `messages`.

## Code Examples

### Reconciliation reducer (verified pattern)
```typescript
// src/components/desk/app.tsx
function mergeMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((item) => item.id === message.id)) {
    return list.map((item) =>
      item.id === message.id
        ? { ...item, text: message.text || item.text, error: message.error ?? item.error, activity: message.activity.length ? message.activity : item.activity, pending: false }
        : item,
    );
  }
  if (message.role === "user") {
    const idx = list.findIndex(
      (item) => item.pending && item.role === "user" && item.text === message.text && Math.abs(item.created - message.created) < 5000,
    );
    if (idx >= 0) {
      const next = [...list];
      next[idx] = { ...message, pending: false };
      return next;
    }
  }
  return [...list, message];
}
```

### Server password preserve (verified pattern)
```typescript
// src/server/api.ts
if (body.clearConnectionPassword === true) {
  runtime.state.connectionPassword = "";
} else if (typeof body.connectionPassword === "string" && body.connectionPassword.trim() !== "") {
  runtime.state.connectionPassword = body.connectionPassword;
}
```

### Detached spawn + group kill (verified pattern)
```typescript
// src/server/runtime.ts
const child = this.spawnImpl(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  detached: true,
  env: { ...process.env, OPENCODE_SERVER_USERNAME: username, OPENCODE_SERVER_PASSWORD: password },
  stdio: "ignore",
});
child.unref();
// kill:
try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Append-only optimistic bubble | Reconcile by (role + text + created) | Phase 2 | No duplicate user turns |
| Blank save wipes password | Preserve unless non-empty or explicit clear | Phase 2 | Stored password survives save |
| `child.kill()` direct only | Process-group kill + escalation | Phase 2 | No orphaned `opencode serve` |
| `window.prompt` for answers | Inline input in permission card | Phase 2 | Testable, accessible |

**Deprecated/outdated:**
- `window.prompt` for permission answers (replaced by inline input).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenCode's `message.updated` event includes parts or text usable for reconciliation | Pattern 1 item 8 | Medium — fallback to created-proximity matching keeps temp text |
| A2 | `opencode serve` runs as process-group leader when spawned with `detached: true` | Pattern 3 | Low — fallback to direct `child.kill` |
| A3 | `localStorage` is acceptable for persisting last session id (no server state needed) | Pattern 5 | Low — could move to AppState if multi-tab consistency required |
| A4 | OpenCode permission reply with "reject" aborts the run server-side | Pattern 4 | Medium — code also calls `api.abort` defensively |

## Open Questions

1. **Does OpenCode abort the run on a permission "reject" reply, or must Paddy call abort?**
   - What we know: `replyPermission` forwards `reply: "reject"`.
   - What's unclear: whether OpenCode stops the session automatically.
   - Recommendation: call `api.abort(sessionId)` after a deny (defensive), then append the denial line.

2. **Should last-session persistence live in AppState instead of localStorage?**
   - What we know: UI spec says "if a stored session id exists" without specifying storage.
   - What's unclear: multi-tab consistency requirements.
   - Recommendation: use `localStorage` keyed by project; revisit if multi-tab becomes a requirement.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime + tests | ✓ | v26.12.1 (floor 22) | — |
| `node:test` | tests | ✓ | built-in | — |
| `node:child_process` | spawn | ✓ | built-in | — |
| `opencode` binary | runtime | ✓ | v2.3.2 | error state "not installed" |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in) |
| Config file | none |
| Quick run command | `node --experimental-strip-types --test src/server/api.test.ts src/server/runtime.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOOP-01 | Optimistic bubble reconciles; no duplicate on send | unit (reducer) | `node --experimental-strip-types --test src/components/desk/messages.test.ts` | ❌ Wave 0 |
| LOOP-01 | Duplicate submit ignored while working/pending | unit | messages.test.ts | ❌ Wave 0 |
| LOOP-02 | Blank password preserves stored password | unit (api) | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ (extend) |
| LOOP-02 | Non-empty replaces; clear flag deletes | unit (api) | api.test.ts | ✅ (extend) |
| LOOP-03 | Spawn uses detached + group kill on disconnect | unit (runtime) | `node --experimental-strip-types --test src/server/runtime.test.ts` | ❌ Wave 0 |
| LOOP-03 | SIGTERM→5s→SIGKILL escalation | unit (runtime) | runtime.test.ts | ❌ Wave 0 |
| LOOP-04 | Stop/retry/resume work; retry no duplicate bubble | unit + manual | api.test.ts + manual | partial |
| LOOP-05 | Permission allow/deny inline; deny aborts | unit (api) | api.test.ts | ✅ (extend) |

### Sampling Rate
- **Per task commit:** `node --experimental-strip-types --test src/server/api.test.ts src/server/runtime.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Extract pure message helpers (`mergeMessage`, `appendDelta`, `upsertActivity`, reconciliation) into `src/components/desk/messages.ts` and add `src/components/desk/messages.test.ts`.
- [ ] Add `src/server/runtime.test.ts` with injected spawn/sleep/kill seam covering spawn, exit, disconnect group-kill, reset, ownedPassword clearing.
- [ ] Extend `src/server/api.test.ts` with password preserve/replace/clear cases and permission deny case.
- [ ] Register new test files in `package.json` `test` script.
- [ ] Add `pending?: boolean` and `"system"` role to `ChatMessage` in both `src/server/normalize.ts` and `src/lib/desk/client.ts`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | existing token/cookie |
| V3 Session Management | partial | HttpOnly SameSite=Strict cookie (unchanged) |
| V4 Access Control | yes | Path allowlist unchanged |
| V5 Input Validation | yes | `safeJson`, `validateWorkspacePath`, body checks |
| V6 Cryptography | no new | — |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Orphaned privileged child process | Elevation of privilege | Process-group kill + signal handlers |
| Password wipe via blank save | Information disclosure (lockout) | Preserve-unless-non-empty rule |
| Duplicate turn injection | Tampering | Reconciliation + duplicate-submit guard |
| Permission bypass via stale card | Elevation of privilege | Card removed on `permission-cleared`; reply validated server-side |

## Sources

### Primary (HIGH confidence)
- `src/components/desk/app.tsx` (read this session) — submit, mergeMessage, applyEvent, reply
- `src/components/desk/settings.tsx` (read this session) — Connection save
- `src/server/runtime.ts` (read this session) — spawnServer, disconnect, child
- `src/server/api.ts` (read this session) — updateSettings, reset, replyPermission, retry
- `src/server/state.ts` (read this session) — publicState, ownedServerPassword
- `src/server/normalize.ts` (read this session) — ChatMessage, normalizeEvent
- `src/lib/desk/client.ts` (read this session) — ChatMessage, api.reply
- `.planning/phases/02-core-loop-correctness/02-CONTEXT.md` (read this session)
- `.planning/phases/02-core-loop-correctness/02-UI-SPEC.md` (read this session)

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONCERNS.md` — orphan/spawn, duplicate message, password wipe concerns
- `scripts/preview.mjs` — process-group kill pattern

### Tertiary (LOW confidence)
- A1–A4 in Assumptions Log (event payload shape, group leader, storage choice, reject semantics)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies
- Architecture: HIGH — code read this session
- Pitfalls: HIGH — derived from code + CONCERNS.md

**Research date:** 2026-11-21
**Valid until:** 2026-12-21 (30 days)