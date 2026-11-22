# Phase 8: Chat Model Picker - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.
>
> **Autonomous run.** This was a non-interactive smart-discuss run with no user present. Hard-to-reverse technical questions took the research recommendation (live-captured OpenCode v2.3.2 contract); reversible technical questions were decided autonomously and listed at the bottom; product/UX preference questions were auto-selected against the ROADMAP success criteria and the project's "no surprises / trust" core value. Every preference choice below can be changed by editing `08-CONTEXT.md` (or re-running discuss) before planning starts.

**Date:** 2026-11-22
**Phase:** 8-Chat Model Picker
**Areas discussed:** Model Catalog Data Path, Selection, Persistence, Trust, Reconciliation & Resume, Picker Experience

---

## Model Catalog Data Path

| Option | Description | Selected |
|--------|-------------|----------|
| New `GET /api/models` backed by a dedicated `listModels()` | One light call to OpenCode's flat `GET /api/model`, project-scoped, projected server-side, independently testable | ✓ |
| Reuse `getProviders()` | No new route, but a 4-request fan-out and a Settings-shaped composite that collapses the 23 entries where `id` differs from `modelID` | |
| Browser calls OpenCode directly | Avoids a controller route, but breaks the security boundary and the Basic-auth model | |

**User's choice:** Recommended answer accepted (autonomous run): dedicated route and adapter method.
**Notes:** Live capture showed 272 entries across 10 providers; `getProviders` keys by `modelID` and silently merges speed tiers, so it is unsafe for selection.

| Option | Description | Selected |
|--------|-------------|----------|
| Flat projected `{ models, default }` | Whitelisted `DeskModel` fields only; account-shaped `headers`/`settings`/`body` never cross the boundary; flat array avoids key-based redaction traps | ✓ |
| Raw `Model.Info` passthrough | Fewer server lines, but ships org/account identifiers and open-ended provider config to the browser | |
| Nested by provider | Slightly simpler client grouping, but a provider-keyed object is where key-based redaction can clobber `alibaba-token-plan` | |

**User's choice:** Recommended answer accepted (autonomous run): flat projected array plus a default key.
**Notes:** `redactSecrets` still runs at the route boundary as belt-and-braces.

| Option | Description | Selected |
|--------|-------------|----------|
| `providerID/id` (entry `id`) | Unique per catalog entry, survives speed tiers, first-slash split handles poolside ids containing `/`; matches `Model.Ref.id` semantics | ✓ |
| `providerID/modelID` | Normalizes duplicate tiers away, but makes "Fast"/"Ultrafast" indistinguishable and sends the wrong wire ref | |
| `providerID/name` slug | Human-friendly, but names are display labels and can change | |

**User's choice:** Recommended answer accepted (autonomous run): entry `id` is the key.
**Notes:** The persisted `deskModel`, the picker key, the React key and the wire ref must all be the same string.

---

## Selection, Persistence, Trust

| Option | Description | Selected |
|--------|-------------|----------|
| `PATCH /api/settings` with body key `deskModel` | Uses Phase 7's landed persistence and the same write Settings already uses; one source of truth | ✓ |
| `PATCH /api/settings` with body key `model` | Matches the older milestone sketch, but diverges from Phase 7's executed code, tests and Settings call site | |
| New select/persist route | Explicit intent, but duplicates an existing sanctioned write path and adds a route to secure | |

**User's choice:** Recommended answer accepted (autonomous run): keep the `deskModel` wire key.
**Notes:** Phase 7 landed `AppState.deskModel`, `updateSettings({ deskModel })` and `bootstrap` preference; the picker adds no persistence machinery.

| Option | Description | Selected |
|--------|-------------|----------|
| Persist immediately on selection | The choice survives an immediate reload; one extra tiny PATCH per pick; failure can be surfaced inline | ✓ |
| Persist on next send | Fewer writes, but a reload between picking and sending silently loses the choice | |
| Persist on popup close | Batches changes, but Esc/cancel semantics become ambiguous and a crash loses the pick | |

**User's choice:** Auto-selected in the non-interactive autonomous run: persist immediately.
**Notes:** Best satisfies success criterion 2 ("choice persists across reloads") and the no-surprises value. Change by editing `08-CONTEXT.md` before planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to OpenCode's default with a subtle note | Header always shows something runnable; no silent dead turn; nothing is written to state until the user acts | ✓ |
| Keep showing the stale key | Preserves the user's old intent, but the header then advertises a model the session cannot run | |
| Block sending until the user re-picks | Strong guarantee, but turns a harmless stale value into a hard stop | |

**User's choice:** Auto-selected in the non-interactive autonomous run: fall back with a note.
**Notes:** The model POST accepts arbitrary refs (live-verified 204), so validation must come from catalog membership, not from the server's response.

---

## Reconciliation & Resume

| Option | Description | Selected |
|--------|-------------|----------|
| Additive `model-selected` SSE event variant | Reaches every tab through the existing fan-out, updates the header directly, testable from live frames | ✓ |
| Map `model-switched` to a thread system message only | No union change, but the header would still drift when the model changes externally | |
| Poll the session for its model | No new event, but adds a timer, latency and duplicate authority | |

**User's choice:** Recommended answer accepted (autonomous run): one additive `GuiEvent`/`DeskEvent` variant.
**Notes:** The milestone architecture's "no union changes" claim held for commands only; MODEL-02's header reconciliation requires this deviation.

| Option | Description | Selected |
|--------|-------------|----------|
| Session truth (`Session.Info.model`) seeds resume | Header reflects what the session actually runs; matches criterion 2 | ✓ |
| Persisted desk default seeds resume | One consistent default, but lies whenever the session was switched elsewhere | |
| Last SSE event seeds resume | Same as session truth when present, but a cold open has no event | |

**User's choice:** Auto-selected in the non-interactive autonomous run: session truth.
**Notes:** Surfaced as optional `SessionSummary.model`; the desk default remains the fallback for a session with no model. Change by editing `08-CONTEXT.md` before planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Switches stay silent in the thread | Header is the single source of truth; transcript stays about the conversation | ✓ |
| Append a system line per switch | Visible history, but adds bookkeeping noise and a second place that can drift | |

**User's choice:** Auto-selected in the non-interactive autonomous run: silent.
**Notes:** `model-switched` messages stay filtered out of `toChatMessages`; a transcript line is deferred polish. Change by editing `08-CONTEXT.md` before planning.

---

## Picker Experience

| Option | Description | Selected |
|--------|-------------|----------|
| Header trigger with the active model name | Always visible beside Live/Offline, no session required, matches "from the chat header" in the requirement | ✓ |
| Composer footer chip | Close to the send action, but easy to miss and competes with the draft hint line | |
| Both header and composer | Maximum discoverability, but two controls to keep in sync and more visual weight | |

**User's choice:** Auto-selected in the non-interactive autonomous run: header trigger.
**Notes:** Best satisfies "always-visible active model". Change by editing `08-CONTEXT.md` before planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Editable combobox popup (search input + grouped listbox) | Live filtering and full keyboard in one APG pattern; hand-built, no dependency | ✓ |
| Select-only listbox with type-ahead | Simpler markup, but type-ahead is not the same as visible live filtering | |
| Modal dialog picker | More room for metadata, but heavier than a header affordance and disruptive | |

**User's choice:** Auto-selected in the non-interactive autonomous run: editable combobox popup.
**Notes:** Arrow/Home/End navigate, Enter selects, Esc closes and restores trigger focus, selection returns focus to the composer. Change by editing `08-CONTEXT.md` before planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Provider-grouped, alphabetical within group | Matches the requirement's "grouped by provider"; predictable scan order | ✓ |
| Flat MRU list | Fast for repeat picks, but hides provider structure and adds state not in this phase | |
| Provider-grouped with MRU first | Best of both, but needs recency storage and ordering rules now | |

**User's choice:** Auto-selected in the non-interactive autonomous run: provider-grouped alphabetical.
**Notes:** Provider labels are humanized ids (`alibaba-token-plan` → "Alibaba Token Plan"), raw id remains the key; active and OpenCode-default markers only. MRU is deferred.

| Option | Description | Selected |
|--------|-------------|----------|
| Two-line row with muted metadata | Name plus `status · context · release date`; informs without competing with selection | ✓ |
| Badges only for non-active status | Cleanest, but hides context and release date that MODEL-03 asks for | |
| Separate detail pane | Most information, but adds navigation and a second focus target | |

**User's choice:** Auto-selected in the non-interactive autonomous run: two-line rows.
**Notes:** Deprecated rows are muted; no cost or capability icons. Change by editing `08-CONTEXT.md` before planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Show every catalog entry | OpenCode TUI parity; the catalog lists all providers; an unusable pick fails honestly at prompt time | ✓ |
| Hide models from unconnected providers | Avoids doomed picks, but requires an extra provider/integration lookup and hides models the user may connect imminently | |
| Show all with a connected badge | Helpful signal, but adds a second data source and visual noise not required by MODEL-01/03 | |

**User's choice:** Auto-selected in the non-interactive autonomous run: show all entries.
**Notes:** No `/api/provider` or `/api/integration` call from the picker this phase. Change by editing `08-CONTEXT.md` before planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit offline / empty / error states | Header keeps the last label; popup explains offline, no-match or retry; never a silent blank panel | ✓ |
| Empty popup when offline | Least code, but looks broken and hides why | |
| Toast on load failure | Transient and easy to miss for a persistent state | |

**User's choice:** Auto-selected in the non-interactive autonomous run: explicit states.
**Notes:** Consistent with the repo's inline-note pattern rather than toast-only errors. Change by editing `08-CONTEXT.md` before planning.

---

## Decided autonomously

[auto] [Model Catalog Data Path] — Q: "What does GET /api/models answer while OpenCode is disconnected?" → Selected: "200 `{ models: [], default: '' }`, matching the /vcs and /agents degrade precedent" (reversible technical — decided autonomously: one branch in one route plus a test; no contract changes)
[auto] [Model Catalog Data Path] — Q: "When is the catalog fetched?" → Selected: "on picker open, cached for 30 seconds; no bootstrap fetch and no invalidation-event subscription" (reversible technical — decided autonomously: the TTL is local to the picker and changing it touches one constant)
[auto] [Selection, Persistence, Trust] — Q: "Is the model applied eagerly when selected?" → Selected: "no; application stays on send through the existing sendMessage model POST before /prompt" (reversible technical — decided autonomously: no new call site; reverting means adding one call in the select handler)
[auto] [Selection, Persistence, Trust] — Q: "What happens when the model POST fails during send?" → Selected: "abort before /prompt, restore the draft and remove the optimistic message; never fall back to another model" (reversible technical — decided autonomously: the behavior is one ordering inside sendMessage plus the existing catch in submit())
[auto] [Reconciliation & Resume] — Q: "Which sessions' model events update the header?" → Selected: "only the active session, via an explicit event.sessionId === sessionRef.current check before the generic gate" (reversible technical — decided autonomously: a single predicate in the reducer)
[auto] [Reconciliation & Resume] — Q: "How is variant handled?" → Selected: "ignored everywhere, including the normalized 'default'; the key stays providerID/id" (reversible technical — decided autonomously: no variant code is written, so enabling it later is purely additive)

## the agent's Discretion

No question was delegated to the agent in this run ("You decide" was not used). Internal implementation details — combobox markup, helper signatures, test fixture mechanics, humanized-label wording, and exact note copy — remain at the agent's discretion within the decisions recorded in CONTEXT.md.

## Deferred Ideas

- MODEL-04 variant selection (reasoning-effort), variant badges, and sending `Model.Ref.variant`.
- MRU ordering, a connected/unconnected provider badge, and cost display.
- Event-driven catalog invalidation via `model.updated` / `models-dev.refreshed` (refetch-on-open TTL covers it this phase).
- A thread-visible model-switch transcript line (P2 polish).
- Fixing Settings' stale `capabilities.{reasoning,attachment,toolcall}` display to v2's `tools`/`input[]` shape — Phase 10 note.
