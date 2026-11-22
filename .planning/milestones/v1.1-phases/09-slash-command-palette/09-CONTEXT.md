# Phase 9: Slash Command Palette - Context

**Gathered:** 2026-11-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver OpenCode commands in the composer: a leading `/` opens a server-sourced, filterable palette; choosing a command (or typing `/name args`) dispatches it in the active session; the expanded user message and any errors are visible in the thread; and `command.updated` refreshes the palette without a reload. No client-side registry, no argument autocomplete, no global Cmd+K palette, no attachments, no `delivery` steering.

</domain>

<decisions>
## Implementation Decisions

### Command Catalog Data Path
- Dedicated `listCommands()` adapter method calling OpenCode `GET /api/command`; Paddy exposes `GET /api/commands` to the browser — **Reversibility:** costly — new public browser URL contract and mirrored type.
- Catalog entries are projected to `{ name, description }` only; no client-side registry or hardcoded list.
- Fetched on palette open, with a short cache, and invalidated by the `command.updated` event. Zero new dependencies; the palette is a hand-built WAI-ARIA APG combobox.
- A connected-but-empty catalog renders an explicit empty panel; a cold-start empty response is retried once on first open before reporting "no commands" (research Pitfall 2).

### Dispatch and Parsing
- Parsing is pure and leading-slash-only: `/name args` at the start of the draft is a command; any other slash position is ordinary prompt text. Unknown `/name` is never silently sent as a prompt.
- Dispatch route is `POST /api/sessions/{id}/command` → OpenCode `POST /api/session/{id}/command` with exactly `{ name, text }`.
- `text` is the args remainder only, never the leading `/name` — **Reversibility:** one-way — OpenCode embeds `text` verbatim as `$ARGUMENTS`; sending the full input produces double-command garbage (live-verified).
- Zero-arg commands send `text: ""`; the Paddy route accepts empty text (unlike the prompt route).
- Server error bodies (`_tag`-discriminated JSON) flow through the existing `OpenCodeError`/`errorResult` machinery; no new error plumbing.
- Unknown or failing commands surface as a persistent in-thread system message, not a toast — **Reversibility:** costly — establishes the desk's error-in-thread contract.

### Echo and Event Reconciliation
- One additive SSE variant `{ type: "commands-updated" }` from `command.updated` (`data: {}`), with a short debounce before refetch — **Reversibility:** costly — mirrors the `GuiEvent`/`DeskEvent` contract.
- On dispatch, the composer inserts the user echo; when the server's expanded user message arrives (`session.inbox.enqueued`), it replaces the raw `/name args` echo rather than adding a second bubble (research Pitfall 1/3 — also fixes the pre-existing stuck pending echo).
- Async command failures (`session.execution.failed`) become an in-thread system message only for the command turn that dispatched them, via a dispatch ref; normal prompt failures keep today's behavior.

### Palette Experience
- The palette opens above the composer when the draft starts with `/`, shows name + description, filters live, and is fully keyboard driven (Arrow/Home/End/Enter/Esc/Tab).
- Opening or closing the palette never discards the composer draft; Escape returns focus to the composer with the draft intact.
- Only a leading `/` triggers the palette. A space after `/name` keeps the palette available for that command's args but does not re-open a name list.
- Selection fills or dispatches? Selection dispatches the command immediately when the highlighted command has no args typed; if args are present, Enter dispatches with them. Escape closes without dispatch.

### Decided autonomously
- [Data Path] Q: "Cache the catalog across opens?" → Selected: "yes, short TTL, invalidated by command.updated" — a pure client cache, cheap to undo.
- [Palette] Q: "Group commands by source/namespace?" → Selected: "no grouping; flat filtered list" — the v2 API carries no namespace, and regrouping is a render change.
- [Parsing] Q: "Support escaped `\/`?" → Selected: "no escaping this phase" — reversible parser scope; mid-text slashes already stay prompts.
- [Errors] Q: "Reuse the server message verbatim?" → Selected: "yes" — consistent wording and cheap to change later.
- [Empty state] Q: "Retry once on cold-start empty?" → Selected: "yes, then show the empty panel" — one extra request is cheap.

### the agent's Discretion
- Exact debounce interval for `command.updated`, palette dimensions, and row line-clamp are the implementation's discretion within the UI contract.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Button`, `Input`, `Badge` primitives and the semantic Tailwind tokens from `src/styles.css`.
- `ModelPicker`'s pure-helper + APG combobox pattern (Phase 8) is the closest analog for palette keyboard/focus handling.
- Existing `submit()`/`send()` path, SSE `applyEvent`, and the `messages.ts` pure reducer helpers.

### Established Patterns
- Four-layer path: adapter → normalized/projected route → `api.*` mirror → UI.
- One additive event variant through `GuiEvent` → `DeskEvent` → `applyEvent`.
- Projection-then-redaction at the server boundary; redaction fixtures precede new routes.

### Integration Points
- `src/server/opencode-client.ts` (listCommands/runCommand), `src/server/api.ts` (GET /api/commands, POST /api/sessions/:id/command), `src/server/normalize.ts` (commands-updated + inbox echo), `src/lib/desk/client.ts`, `src/components/desk/app.tsx` composer, and a new kebab-case palette component.

</code_context>

<specifics>
## Specific Ideas

- Live-verified: `command.updated` carries `data: {}` and fires in bursts — debounce is required.
- Live-verified: `text` is args-only; `/name` inside `text` becomes literal arguments.
- Live-verified error bodies: `{"_tag":"CommandNotFoundError","command":"X","message":"Command not found: X"}` at 404; `CommandExecutionError` at 500.
- Live-verified delivery: user messages arrive via `session.inbox.enqueued`; there is no `session.message.*` event in v2.3.2.

</specifics>

<deferred>
## Deferred Ideas

- Per-argument autocomplete (no schema in the v2 API).
- Global Cmd+K palette.
- Command attachments and `delivery`/steering controls.
- Mapping all execution failures (not just command turns) to in-thread system messages.

</deferred>
