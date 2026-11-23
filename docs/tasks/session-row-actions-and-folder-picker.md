# Task: session-row actions + project folder picker

## Goal

Two UI changes:
(A) Retry / Rename / Archive move from the chat header to per-session icon
    buttons on the session rows in the left sidebar.
(B) The Add project dialog gains a "finder": a directory browser pane backed by
    a new read-only controller endpoint, so projects are picked by browsing,
    not by typing paths.

## Baseline

- Base SHA: `2615272` (main, local-only; origin at e4606a1)
- `git status --short` before delegation: **clean**

## Current state (orchestrator analysis)

- Header trio at `app.tsx:1135-1168`: text links Retry / Rename / Archive,
  `hidden sm:flex` (invisible below sm breakpoint), only when a session is
  active. **Rename uses `window.prompt`** (`app.tsx:1139`) — the repo's
  documented anti-pattern; this task removes the last prompt() in the app.
- Retry: `retry()` re-runs the last turn of the ACTIVE session; the client API
  already takes an id: `api.retry(id)` (`client.ts:188`). Rename:
  `api.renameSession(id, title)`. Archive: `archiveUndo.archive({id, title})`
  with the undo-notice flow (notice region, focus-to-Undo, per-session failure
  display) — all session-id based, so per-row actions are native.
- Session rows at `app.tsx:1042-1054`: plain `h-9` buttons with a truncated
  title span. Sessions list state: `groups` (label + items), `sessions`.
- AddProjectDialog at `app.tsx:1590+`: path input (id `add-project-path`),
  optional name, inline role=alert validation, focus trap, returns the project
  to `addProjectTo` → `api.addProject(path, name)`.
- Server: `api.ts` routes table at the top; `validateWorkspacePath(path)`
  (no allowlist) resolves + stats + realpaths an absolute existing dir —
  reuse it for the listing endpoint's path argument.

## Part A — session row actions

- AC-A1: Each session row shows Retry, Rename, Archive as icon buttons
  (lucide, `aria-label` with the session title, e.g. "Archive '<title>'").
  Revealed on row hover/focus-within; always visible on the active row and on
  coarse pointers (`@media (pointer: coarse)` or equivalent) so touch users can
  reach them. Rows keep their h-9 compactness (icon size-3.5/4).
- AC-A2: Actions operate on THAT session, not the active one: retry calls
  `api.retry(item.id)`; rename uses an inline edit (no window.prompt): clicking
  Rename turns the title into an input, Enter saves via
  `api.renameSession(item.id, trimmed)`, Escape cancels, focus returns to the
  row's Rename button; archive reuses `archiveUndo.archive` + the existing
  notice/failure flow, and the current open-chat teardown logic
  (`app.tsx:1150-1157`) is preserved for the case where the archived session
  is the open one.
- AC-A3: The header trio is REMOVED (that is the point: the actions live on
  the rows). The header keeps the model picker, Live/Offline, settings gear.
- AC-A4: Keyboard: row remains a single stop for opening; the three icons are
  tab-reachable and announced. No focus traps; Escape in rename returns focus
  to the rename trigger.
- AC-A5: Rename on the ACTIVE session updates the header title too (existing
  refreshSessions / sessions state flows must cover it — verify).

## Part B — folder picker ("finder")

### New API contract (do not deviate)

- Route: `GET /api/fs/dirs` with optional query `path`.
  - No `path` → list the controller-side home dir (`os.homedir()`).
  - `path` must be absolute and an existing directory; validate with the
    existing `validateWorkspacePath` (no allowlist) — invalid/missing →
    `json(400, { error })`, same shape as other routes.
  - Response 200: `{ path, parent, entries: [{ name, path }], truncated }`
    where entries are DIRECTORIES ONLY (no files), excluding names starting
    with `.`, sorted by name (localeCompare), each entry's `path` is the
    absolute child dir. `parent` is the absolute parent dir (null at `/`).
    Cap entries at 500 with `truncated: true`.
  - Unreadable directory (EACCES) → `json(400, { error: "Cannot read that folder" })`.
  - This endpoint is read-only directory NAMES on a loopback-authorized
    controller, consistent with addProject accepting any absolute dir.
- Client: `api.fsDirs: (path?: string) => request<{ path; parent; entries: { name; path }[]; truncated }>("/api/fs/dirs" + query)` in `client.ts`, typed.

### Dialog

- AC-B1: AddProjectDialog gains a browser pane ABOVE the path input: current
  folder path (breadcrumb or truncatable line), parent ("..") button, list of
  subfolders (name only, chevron), scrollable, loading/error states per the
  repo's StatePanel-ish patterns. Initial load lists the home dir.
- AC-B2: Clicking a subfolder navigates (fetch its entries); "Use this folder"
  (or clicking the current-path row) fills the path input with that absolute
  path — then the existing Add flow (validation, submit) is unchanged. The
  manual path input REMAINS for pasting/hidden dirs.
- AC-B3: The dialog stays one focus-trapped surface: browser pane is inside
  the trap; Escape still closes (unless a request is in flight, per existing
  behavior); keyboard can reach folder rows and Use-this-folder.
- AC-B4: Server route added to `api.ts` route table + `opencode-client` ONLY
  if needed (listing should live in `api.ts` directly using node:fs, not via
  the OpenCode client — OpenCode is not involved). No new dependencies.

## Non-goals

- No changes to the archive-undo notice system beyond wiring.
- No file listing (directories only), no file contents, no writes.
- No native OS dialog (browsers cannot open one) — the browser pane IS the finder.

## Verification

- AC-V1: `npm run typecheck`, `npm run lint`, `npm test` pass; new pure logic
  (if any) has node:test coverage in already-listed suites.
- AC-V2: Live Playwright on the running dev server (127.0.0.1:8080, do not
  start/kill): (A) rows show icons on hover + active row; rename inline flow
  (Enter/Escape, focus return, header title sync); archive shows the undo
  notice and removes the row; retry on a non-active session calls the right id
  (assert the request payload/session id — safe: retry a session that has no
  turns to re-run, or assert the API is called with the row's id via a stubbed
  route); touch/coarse-pointer visibility via emulation. (B) open Add project
  → home dir listed → navigate two levels → Use this folder → Add → project
  created + active; unreadable/missing paths show inline errors. Clean up ALL
  QA artifacts; leave user state as found.

## Owners

- Implementer: frontend
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented (SessionRow with hover/active/coarse-reveal icon actions,
  inline rename replacing the last window.prompt, per-row retry/rename/archive
  with open-chat teardown preserved; header trio removed. AddProjectDialog
  folder pane backed by new GET /api/fs/dirs — read-only directory listing,
  dot-entries skipped, 500 cap + truncated, validateWorkspacePath gate,
  EACCES → fixed-string 400. api.fsDirs typed client method. 6 red-first
  server tests.)
- [x] Reviewed (PASS_WITH_NOTES, no findings; endpoint security assessed:
  read-only, same authorizePeer/origin boundary, no file reads, no errno leak.
  Declared risks accepted: tab-heavy hidden row icons, title truncation with
  actions visible, archive-failure notice ordering, symlinked dirs omitted,
  whole-dir readdir before slicing to 500. Dev-server stale-transform quirk
  noted: touch client.ts mtime resolved it.)
- [x] Committed