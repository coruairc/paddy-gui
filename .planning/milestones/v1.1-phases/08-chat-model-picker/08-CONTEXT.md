# Phase 8: Chat Model Picker - Context

**Gathered:** 2026-11-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 delivers the model-picker vertical: one light models data path (`OpenCodeClient.listModels()` → `GET /api/models` → `api.models()`), a hand-built keyboard-first picker in the chat header grouped by provider with live filtering and the MODEL-03 metadata, persistence through Phase 7's `deskModel`, per-session application on send (already present), resume seeding from `Session.Info.model`, and SSE reconciliation of `session.model.selected` so the header never drifts from what runs. It does NOT build slash commands (Phase 9), model variant selection (MODEL-04, deferred), a connected-provider badge, or any change to Settings' provider-credential sections beyond not regressing them.

</domain>

<decisions>
## Implementation Decisions

### Model Catalog Data Path
- The picker catalog comes from a new `GET /api/models` controller route backed by a dedicated `OpenCodeClient.listModels()` call to OpenCode's `GET /api/model` (`location[directory]` from the active project); `getProviders()` is not reused and the browser never calls OpenCode. — **Reversibility:** costly — the URL and payload are the browser/controller contract consumed by `api.models()`, the picker, route tests and Phase 10 verification; replacing them is a coordinated cross-layer change.
- `GET /api/models` returns `{ models, default }` where each model is a server-side whitelist projection `{ key, id, providerID, name, status, context, released, enabled, tools, variantCount }`; raw `Model.Info` `headers`/`settings`/`body`/`package`/`compatibility` never leave the controller, and `redactSecrets` still runs at the boundary. — **Reversibility:** costly — the browser mirrors this type by hand in `client.ts`, and the projection is the control that keeps account-shaped identifiers out of the browser; widening it requires a coordinated type, test and leak-surface review.
- The identity key is `providerID/id` using the catalog entry `id` with first-slash split; it is simultaneously the picker key, the persisted `deskModel` value and the `Model.Ref.id` sent on the wire, and `modelID` is never the key. — **Reversibility:** costly — persisted `deskModel` values in `~/.paddy/state.json` and OpenCode session `Model.Ref.id` values already carry this identity; changing it would strand saved selections and could silently run a different speed tier.
- Disconnected `GET /api/models` answers 200 `{ models: [], default: '' }`, matching the `/vcs` and `/agents` degrade precedent.
- The catalog is fetched when the picker opens and cached for 30 seconds; there is no bootstrap-time fetch and no `model.updated`/`models-dev.refreshed` subscription this phase.

### Selection, Persistence, Trust
- A selection persists through the existing `PATCH /api/settings` with body key `deskModel`, landing in `AppState.deskModel` and `~/.paddy/state.json`; bootstrap reads it back as `deskModel`/`model`, and no new persistence route or OpenCode global-config write is added. — **Reversibility:** costly — Phase 7's state field, its `state.test.ts`/`api.test.ts` fixtures, Settings' `setDeskDefault` and the persisted-state contract all bind the `deskModel` wire key; changing it is a coordinated two-surface change.
- Persistence is written immediately on selection (optimistic in-memory pick plus `api.settings`), not deferred to send; a failed write keeps the pick for the current turn but shows an inline note that it will not survive reload. Preference auto-selected in the non-interactive run.
- If the persisted `deskModel` is absent from the fetched catalog, the header falls back to OpenCode's default and shows a subtle unavailable-model note; the fallback is not auto-written to state until the user picks or sends. Preference auto-selected in the non-interactive run.
- The model is applied to a session only on send, using the existing `sendMessage` POST `/api/session/{id}/model` before `/prompt`; selecting in the picker performs no eager model POST.
- A failed model POST aborts the send before `/prompt` (existing behavior): the draft is restored, the optimistic message removed, and the session is never prompted on a different model.

### Reconciliation & Resume
- Reconciliation uses one additive `GuiEvent`/`DeskEvent` variant, `{ type: 'model-selected', sessionId, model }`, normalized from `session.model.selected` (ignore `previous`) and fanned out by the existing runtime event loop to every tab; not a thread message and not polling. — **Reversibility:** costly — this event name and shape are a mirrored controller/browser contract in `normalize.ts` and `client.ts`, and `app.tsx`'s reducer plus Phase 10's two-tab check depend on it.
- Only the active session's `model-selected` event moves the header: an explicit `event.sessionId === sessionRef.current` check runs before the generic session gate, and other sessions never change it.
- Resume seeds the header from the session's own `Session.Info.model` surfaced as optional `SessionSummary.model` (`providerID/id`), not from the persisted desk default; the desk default applies only when the session has no model. Preference auto-selected in the non-interactive run (also the ROADMAP criterion 2 requirement).
- `variant` is ignored everywhere, including the server-normalized `'default'`; the desk key stays `providerID/id` and no variant is sent.
- Model switches are silent in the thread: `model-switched` bookkeeping messages stay filtered out of `toChatMessages`; a transcript line is deferred polish. Preference auto-selected in the non-interactive run.

### Picker Experience
- The trigger sits in the chat header showing the active model's display name (truncated key as fallback), immediately left of the Live/Offline indicator, and stays visible whenever a project is selected — no session required, and not hidden at narrow widths. Preference auto-selected in the non-interactive run.
- The popup is a hand-built APG combobox: the trigger opens a search input plus grouped listbox, Arrow/Home/End navigate, Enter selects, Esc closes and restores trigger focus, and typing filters live; a selection closes the popup and returns focus to the composer. Preference auto-selected in the non-interactive run.
- Models are grouped by provider (humanized label, raw id as the key), groups sorted alphabetically, and models sorted alphabetically by name inside each group; the active model and OpenCode's default are marked; there is no MRU ordering this phase. Preference auto-selected in the non-interactive run.
- Each row is two lines: the model name, then a muted `status · context window · release date` line; non-active statuses get a small badge and deprecated rows are muted; no cost or capability icons. Preference auto-selected in the non-interactive run.
- Every catalog entry is listed regardless of provider credentials — no connected/disconnected badge and no extra `/api/provider` lookup this phase; an unusable pick fails at prompt time with OpenCode's own error. Preference auto-selected in the non-interactive run.
- Popup states are explicit: offline explains that OpenCode must be connected while the header keeps its last known label; no matches says so with the query; a load failure offers retry; never a silent empty popup. Preference auto-selected in the non-interactive run.

### Decided autonomously
- [Model Catalog Data Path] Q: "What does GET /api/models answer while OpenCode is disconnected?" → Selected: "200 `{ models: [], default: '' }`, matching the /vcs and /agents degrade precedent" — one branch in one route plus a test; no contract changes.
- [Model Catalog Data Path] Q: "When is the catalog fetched?" → Selected: "on picker open, cached for 30 seconds; no bootstrap fetch and no invalidation-event subscription" — the TTL is local to the picker and changing it touches one constant.
- [Selection, Persistence, Trust] Q: "Is the model applied eagerly when selected?" → Selected: "no; application stays on send through the existing sendMessage model POST before /prompt" — no new call site; reverting means adding one call in the select handler.
- [Selection, Persistence, Trust] Q: "What happens when the model POST fails during send?" → Selected: "abort before /prompt, restore the draft and remove the optimistic message; never fall back to another model" — the behavior is one ordering inside sendMessage plus the existing catch in submit().
- [Reconciliation & Resume] Q: "Which sessions' model events update the header?" → Selected: "only the active session, via an explicit event.sessionId === sessionRef.current check before the generic gate" — a single predicate in the reducer.
- [Reconciliation & Resume] Q: "How is variant handled?" → Selected: "ignored everywhere, including the normalized 'default'; the key stays providerID/id" — no variant code is written, so enabling it later is purely additive.

### the agent's Discretion
No question was delegated with "you decide" in this autonomous run. Internal details — the combobox markup, helper function signatures, test fixture mechanics, humanized-label wording, and exact note copy — remain at the agent's discretion within the decisions above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/desk/app.tsx` — `model` state (line 45), bootstrap seed (125), send path with abort/restore (307-313), header slot (437-460), `openSession` (218-238), `applyEvent` (58-113); Settings already shares `model`/`onModelChange` (467, 473).
- `src/lib/desk/client.ts` — `api.settings` (168) and `api.send` (138) already perform the writes; `Bootstrap.deskModel`/`model` (173-185); `SessionSummary` (42-52) and `DeskEvent` (82-94) are where the optional field and new variant land.
- `src/server/api.ts` — `splitModel` first-slash helper (406), `send()` model threading (240-252), `bootstrap` deskModel preference (88-90), `updateSettings` deskModel handling (169), `readOpenCode` degrade precedent (272-278), `redactSecrets` boundary.
- `src/server/opencode-client.ts` — `request()` with `{data}` unwrap and `locationQuery` (540-595), private `defaultModel` (524-530, prefers `modelID` — rework to `id`), `sendMessage` (189-204) already applies the model.
- `src/server/normalize.ts` — `summarizeSession` (93-107), `normalizeEvent` (157-362), `GuiEvent` (55-66); `src/components/desk/messages.ts` + `messages.test.ts` is the pure-helper test precedent.
- `src/components/desk/settings.tsx` — model-selection precedent and `api.settings({ deskModel })` write (302-320), substring filter precedent (265-268).
- `src/server/runtime.ts` — event loop fan-out already reaches every subscriber; no changes required for multi-tab.

### Established Patterns
- Four-layer feature path: OpenCode adapter → controller route → browser API method → UI, each layer tested before its consumer.
- Pure logic lives in plain `.ts` modules under `node:test`; no RTL/jsdom, no new test framework.
- Result-union validation; `OpenCodeError` thrown and mapped once in `handleApi`.
- Semantic Tailwind tokens, `lucide-react` icons, kebab-case files, named exports, injected side-effect dependencies.
- UI state is local React state with functional updaters; no state library.

### Integration Points
- `src/server/api.ts` route table (45-47) for `GET /models`; `src/lib/desk/client.ts` gains `api.models()` beside `api.providers()`.
- Header slot `app.tsx:437-460` for the trigger; new `src/components/desk/model-picker.tsx`, `models.ts`, `models.test.ts`.
- `summarizeSession`/`SessionSummary` for resume; `normalizeEvent`/`DeskEvent`/`applyEvent` for reconciliation.
- `package.json` test script for the new `models.test.ts` suite.
- Phase 7 `deskModel` persistence is landed at HEAD (`state.ts:34,45,103,115`; `api.ts:169`; `settings.tsx:313`).
- `08-RESEARCH.md` holds the live-captured fixtures: 272-model catalog, SSE frames, `id` vs `modelID` probes, `poolside` slash ids.

</code_context>

<specifics>
## Specific Ideas

- `08-RESEARCH.md` is the plan of record; every wire fact is live-captured from OpenCode v2.3.2 this milestone.
- Canonical fixtures: 23 entries where `id` differs from `modelID` (e.g. `openai/gpt-6.2-astra-fast` vs `gpt-6.2-astra`); `poolside/poolside/laguna-s-2.1` for slash-containing ids; `alibaba-token-plan` for the redaction round-trip.
- Trust property: the header must never show a model the session is not running. Invalid refs are prevented by construction (catalog-only selections plus a membership check), never by trusting the model POST's 204.
- The picker is a hand-built WAI-ARIA APG combobox; zero new packages, with all grouping/filtering/keyboard state logic outside the component where `node:test` can reach it.
- The picker lives in the chat header, not Settings-only; Settings remains the provider-credential surface and keeps its existing model-default control.

</specifics>

<deferred>
## Deferred Ideas

- MODEL-04 variant selection (reasoning-effort), variant badges, and sending `Model.Ref.variant` — v2 milestone.
- MRU ordering, a connected/unconnected provider badge, and cost display — polish beyond MODEL-01/03.
- Event-driven catalog invalidation via `model.updated` / `models-dev.refreshed` — refetch-on-open with a TTL covers staleness this phase.
- A thread-visible model-switch transcript line (P2 polish); switches stay silent in the transcript for now.
- Fixing Settings' stale `capabilities.{reasoning,attachment,toolcall}` display to v2's `tools`/`input[]` shape — Phase 10 note, out of scope here.

</deferred>
