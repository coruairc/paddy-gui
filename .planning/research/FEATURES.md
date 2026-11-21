# Feature Research: v1.1 Chat-Header Model Picker & Slash Commands

**Domain:** Local web UI ("desk") driving an OpenCode agent session — model selection + command invocation UX
**Researched:** 2026-11-21
**Confidence:** MEDIUM-HIGH (API contract verified against two vendor primary sources; UX patterns cross-verified across Slack + Discord official docs and widely-observed ChatGPT/Claude/Cursor behavior)

**Scope:** Only the two NEW v1.1 capabilities — (1) chat-header/composer model picker, (2) slash-command palette and execution. Everything already shipped in v1.0 (project picking, streaming chat, permissions, diffs, session resume, Settings panels, auth) is treated as existing dependency surface, not re-researched.

---

## Ground Truth: What OpenCode v2 Actually Offers (drives every feature decision)

Verified against `https://opencode.ai/docs/api` and the official OpenAPI 3.1 document (`https://opencode.ai/docs/openapi.json`), cross-checked with `.planning/V2-MIGRATION-SPEC.md`:

| API | Contract | Feature implication |
|---|---|---|
| `GET /api/command?location[directory]=X` | `{location, data: Command.Info[]}`; `Command.Info = {name: string, description?: string}` (description **optional**) | Palette can show name + one-line description. **No argument schema exists** — per-argument autocomplete hints are impossible without reimplementing OpenCode. |
| `POST /api/session/{id}/command` | Body `{name, text}` (both required; `text` = everything after the first space). Returns **204 No Content** — no message body on success. Errors: 404 `CommandNotFoundError {_tag, command, message}`, 500 `CommandExecutionError {_tag, command, message}`, 400 InvalidRequest. | Success is silent; the expanded prompt arrives via SSE session events or a message refresh. Errors carry a ready-made `message` — must be rendered **in the thread**, not as a transport error toast. |
| `POST /api/session/{id}/model` | Body `{model: Model.Ref {id, providerID, variant?}}` → 204 | One-shot model switch per session; safe to call on picker selection AND on send. |
| `GET /api/model?location[directory]=X` | `{data: Model.Info[]}` — has `id, modelID, providerID, name, family, status (active/beta/alpha/deprecated), enabled, limit {context, output}, cost[], time.released`, ordered by release date | Everything needed for provider grouping, status badges, and "newest first" ordering comes free. |
| SSE events | `command.updated` (command registry reload — hot-reload when command files change), `session.model.selected`, `model.updated`, `session.execution.failed` | Commands and models can be kept live without polling; `session.model.selected` lets the header picker stay truthful when a command pins a different model. |

Command semantics (official commands doc): names may be nested (`/team/review`), `$ARGUMENTS`/`$1..$n` templating is resolved server-side, a command may pin its own agent/model (which overrides the session model), and the registry hot-reloads. **Paddy never needs to parse templates** — it passes `{name, text}` and OpenCode does the rest.

---

## Feature Landscape

### Table Stakes (Users Expect These)

#### A. Chat-Header Model Picker

| Feature | Why Expected | Complexity | Notes / Paddy dependencies |
|---------|--------------|------------|-------|
| Picker affordance in the chat header (or composer chrome), showing the **active model name** persistently | Every chat UI (ChatGPT, Claude, Cursor) surfaces the current model one click away; burying it in Settings is the v1.0 pain point | MEDIUM | New header widget in `app.tsx` header row (replacing nothing; sits next to Live/Retry/Rename/Archive). Data already flows: `RuntimeModel`/providers from bootstrap + Settings fetch. |
| Models **grouped by provider** with group headers | Long flat lists are unusable; ChatGPT groups by capability, Cursor by provider — grouping is universal | LOW | `Model.Info.providerID` is the group key; Settings already groups this way (`models?: Record<string, RuntimeModel>` per provider). Render group headers; a native `<select>`+`<optgroup>` cannot carry per-model metadata — use a custom popup. |
| Selection **persists across reloads** (sticky desk default) | Users expect their model choice to survive a page refresh / browser restart; re-picking every reload reads as broken | MEDIUM | v2 has **no remote global-config write** (`PATCH /api/config` → 404) → persist as Paddy state (`state.ts` gains a `deskModel` field, exposed via `publicState`). This is exactly V2-02 — same work item, one phase. |
| Selecting applies to the **next send**, mid-conversation | Switching models mid-session is standard; restart-the-chat is not acceptable | LOW | `api.send(id, text, model, agent)` already POSTs `/api/session/{id}/model` before prompting (`opencode-client.ts:195-197`). Picker selection just updates the same `model` state — zero controller change for the apply-on-send path. |
| Session resume shows the session's **actual** model | "Close browser, resume later" is a validated v1.0 requirement; the picker must reflect the session, not a stale guess | MEDIUM | `Session.Info` carries `model?: {id, providerID}`; on session load, seed the picker from the session, falling back to the persisted desk default. |
| Keyboard parity: Enter/Space to select, ↑/↓ to move, Escape to close without losing focus | Table stakes for every dropdown/palette since Raycast/Linear normalized it | MEDIUM | Custom popup in the composer/header; keep the logic (open/close/highlight index) in a pure, DOM-free module so it stays testable under `node:test` (repo has no jsdom/RTL). |
| Degrade gracefully when offline / disconnected | v1.0 desk already models connection state; a picker that 500s when OpenCode is down is a trust violation | LOW | Reuse last-known model list from bootstrap; disable the picker with a "Reconnect" hint when `status.connected` is false. Existing error-bar pattern applies. |

#### B. Slash-Command Palette & Execution

| Feature | Why Expected | Complexity | Notes / Paddy dependencies |
|---------|--------------|------------|-------|
| Typing `/` as the **first character** of the composer opens an inline palette above/near the composer | Slack, Discord, OpenCode's own TUI — the trigger is muscle memory | MEDIUM | Composer is a plain `<textarea>` in `app.tsx` (`draft` state, Enter-to-send). Palette = absolutely-positioned list anchored to the composer; trigger condition is a pure function of `draft` (`draft.startsWith("/")`) — unit-testable. |
| Each entry shows **name + description** | Slack and Discord both render description under the command name; OpenCode `Command.Info` exists precisely for "command lists and discovery" | LOW | `Command.Info.description` is optional — render blank gracefully (many commands have none). |
| **Live filtering** as the user types past `/` | Every autocomplete since Slack does this | LOW | Pure function `filterCommands(commands, query)` — prefix/substring match on name (+description). No fuzzy ranking needed. |
| Full keyboard control: ↑/↓ select, **Tab or Enter completes** the name, Escape dismisses, typing continues filtering | Universal (Slack/Discord/Raycast); mouse-only palettes are considered broken | MEDIUM | Requires intercepting keys in the composer's `onKeyDown` **before** the existing Enter-to-send handler — the two features collide and must be disambiguated (see PITFALLS.md handoff). |
| Submitting `/name args` splits at the **first space**; args pass through as a single blob | Slack's canonical `command`/`text` split; matches OpenCode `$ARGUMENTS` semantics exactly | LOW | Pure function `parseCommandInput(draft)` → `{kind: "command", name, text} \| {kind: "text"}` — perfect `node:test` target. |
| Command runs **in-session** via `POST /api/session/{id}/command` | The milestone requirement; also the only correct route — faking it by sending `/name` as prompt text is not the v2 contract | MEDIUM | New 4-layer threading per repo convention: `opencode-client.ts` method → `api.ts` route → `client.ts` method → composer submit fork. |
| **Command errors surface in the thread** | Slack best practice: errors are conversation content, not transport failures. 404/500 bodies carry `{command, message}` ready to render | MEDIUM | `ChatMessage` already supports `role: "system"` + `error`; render a system-style bubble ("Command `/foo` failed: message"). **Do not** route through the transient error bar — errors must persist in the transcript. |
| Success produces the expanded prompt in the thread | The user typed `/review src/auth.ts`; they expect to see what was submitted | MEDIUM | 204 returns nothing → the expanded user message arrives via SSE (`session.*` events already handled by `applyEvent`) or an explicit message refresh. The v1.0 "sent message reconciles with server echo" pattern is the model to follow — do **not** synthesize the expanded text client-side (Paddy doesn't know the template). |
| Command list loads **per project** and refreshes on reconnect | Commands are location-scoped (`location[directory]`); project switching changes the list | LOW | Fetch alongside bootstrap/session load; `command.updated` SSE event → refetch (registry hot-reloads when the user edits command files). Cheap and keeps OpenCode authoritative. |
| Unknown command: inline "no matching command" hint, submit does not silently send garbage | Slack blocks unknown commands with a visible hint | LOW | If filtered list is empty and draft starts with `/`, show hint above composer. **Decision needed:** block submit or send as plain text (see Anti-Features). |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Header picker stays truthful via `session.model.selected` SSE event | OpenCode remains the source of truth even when a **command pins a different model** than the desk picked — the header visibly updates. Trust property aligned with Paddy's core value ("no surprises") | MEDIUM | `normalizeEvent` returns null for unknown events today; add one mapping. Small, high-trust payoff. |
| Model metadata in the picker: status badge (deprecated/beta), context-window size, newest-first | `Model.Info` ships `status`, `limit.context`, `time.released` free; ChatGPT/Claude show capability hints and users increasingly check context size before long sessions | LOW-MED | Render-only once data is threaded; ordering by release date comes pre-sorted from the API. |
| Recently-used ordering (MRU) in both pickers | Raycast/Linear pattern; with 50+ models across providers, MRU beats scrolling | LOW | Store a small `recentModels: string[]` in Paddy state; same persistence work as the desk default. |
| Nested-command grouping (`/team/…`) in the palette | Names contain `/` separators; grouping by prefix mirrors OpenCode's file layout and reads cleaner | LOW | Pure string manipulation on `Command.Info.name`. |
| Empty-composer placeholder hint ("Type `/` for commands") | Discovery: users who never opened the TUI don't know commands exist | LOW | Placeholder string on the textarea. |
| Variant selection (`provider/model#variant`) | Model.Ref accepts `variant`; reasoning-effort variants are a real OpenCode feature | MEDIUM | Defer unless trivial — variants surface as separate Model.Info entries in some providers; verify before building. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Client-side command registry (reading `.opencode/commands/*.md` from the controller) | "It would let us show templates/arguments" | Violates the authority constraint — OpenCode owns command discovery and hot-reloads the registry; a Paddy-side copy drifts instantly. Also new filesystem surface for the controller | `GET /api/command` + `command.updated` refresh. Always. |
| Per-argument autocomplete hints (`$1`, `$2` schemas) | Discord-style argument autocomplete | `Command.Info` carries **no argument schema**. Building it means parsing template files = reimplementing OpenCode. Slack's own answer is a static "usage hint" string, which the API doesn't expose either | Render commands with name + description; the user types free-form args (matches `$ARGUMENTS`). Revisit only if OpenCode ever exposes argument metadata. |
| Adding `cmdk` (or any headless-menu library) | "Battle-tested command menu" | New dependency in a milestone that forbids stack changes; repo conventions demand DOM-free pure logic testable under `node:test`; the palette is ~150 lines of bespoke React | Small custom popup; keep filter/parse/highlight logic in pure modules. |
| Fuzzy multi-token ranking in filters | Raycast feel | Scope creep; plain substring matching is the table-stakes bar; ranking is invisible polish at <100 entries | Prefix + substring match, MRU first. |
| Global Cmd+K command palette (app-level actions) | Modern desk convention | Different feature than **OpenCode slash commands**; conflating them confuses "commands the agent runs" with "commands Paddy runs" | Keep `/` = OpenCode commands only. A Paddy-action palette is a future milestone candidate. |
| Sending `/name args` as a plain prompt and letting the server interpret it | Simplicity — one code path | The v2 API separates prompt from command; relying on slash-interpretation inside prompt text is unverified and ambiguous when a user legitimately wants to send text starting with `/` | Explicit `POST /command` fork in submit. If the user's draft starts with `/` but no command matches, prompt them (block or send-as-text — decide in SPEC). |
| Persisting the desk model into OpenCode global config | "The model should follow the project" | v2 has no remote global-config write (`PATCH /api/config` → 404) — this is the exact bug V2-02 removes | Persist `deskModel` in `~/.paddy/state.json`; apply per-session on send. |
| Multi-desk model profiles (per-project or per-tab defaults) | Power users | Explicitly out of scope per PROJECT.md ("one desk default, applied per session, is enough for v1.1") | One sticky desk default + per-session session model. |

---

## Feature Dependencies

```
[Header model picker]
    ├──requires──> [Grouped model data: GET /api/model / providers bootstrap]  (exists — Settings flow)
    ├──requires──> [Per-session model apply: POST /api/session/{id}/model]     (exists — send path; expose on selection)
    ├──requires──> [Persisted desk default: state.ts deskModel field]          (new — shared with V2-02)
    └──enhances──> [session.model.selected SSE mapping]                        (new, small)

[Slash palette + execution]
    ├──requires──> [GET /api/command client method + api.ts route + client.ts method]   (new — 4-layer pattern)
    ├──requires──> [Composer draft state + onKeyDown interception]                     (exists — app.tsx composer)
    ├──requires──> [Submit fork: parseCommandInput → POST /command vs prompt]          (new)
    ├──requires──> [Error rendering in thread: system ChatMessage with error]          (exists — MessageView system role)
    ├──requires──> [Success path: SSE session events / message refresh after 204]      (exists — applyEvent; verify echo)
    └──enhances──> [command.updated SSE → command list refresh]                        (new, small)

[Persisted desk default] ──shared-foundation──> [V2-02: drop global-config writes]
[Header picker MRU]      ──enhances──> [Persisted desk default (same state file)]
```

### Dependency Notes

- **Model picker → existing model plumbing is nearly complete:** `app.tsx` already holds `model` state, seeds it from bootstrap/config, and `api.send` applies it per-session on send (`opencode-client.ts` POSTs `/api/session/{id}/model` before prompting). The picker is mostly a *UI surface + persistence* problem, not a controller problem.
- **Slash commands need the full 4-layer addition** (client method → route → browser method → UI), per the repo's documented OpenCode path coupling.
- **V2-02 and the picker's persistence are the same work:** dropping global-config writes and persisting the desk model in Paddy state land in one phase; sequencing them separately would duplicate the state-schema change.
- **Keyboard handling conflict:** the palette's ↑/↓/Tab/Escape interception and the composer's existing Enter-to-send (`app.tsx:589-598`) share one `onKeyDown`; the palette must consume keys first while open. This is the main place the two new features collide with existing code.
- **Error-in-thread depends on the system message channel:** `ChatMessage` supports `role: "system"` and `error` already — command errors are a new producer of an existing shape, not a new shape.

---

## MVP Definition

### Launch With (v1.1)

- [ ] Model picker in the chat header: grouped by provider, shows active model, click + keyboard, applies per-session on send — *the headline MODEL-01 requirement; existing plumbing makes this cheap*
- [ ] Persisted desk default in `~/.paddy/state.json`, reused across reloads, replacing global-config writes — *MODEL-02 + V2-02; state compatibility (`~/.config/opencode-web`) is a hard constraint*
- [ ] Session resume seeds the picker from the session's actual model — *protects the validated v1.0 resume requirement*
- [ ] Slash palette on leading `/`: name + description, live filter, ↑/↓/Tab/Enter/Escape — *CMD-01*
- [ ] `/name args` execution via `POST /api/session/{id}/command`, success content arriving through SSE/refresh — *CMD-02*
- [ ] Command errors (404 unknown / 500 execution failure) rendered as persistent system messages in the thread — *CMD-02's error half; Slack's documented best practice*
- [ ] Command list fetched per project and refreshed on `command.updated` — *keeps OpenCode authoritative; low cost*

### Add After Validation (v1.x)

- [ ] MRU ordering in both pickers — *once users report scrolling fatigue*
- [ ] Model status badges / context-window display — *data is already in Model.Info; render polish*
- [ ] `session.model.selected` → header sync — *first user report of "header showed the wrong model after a command ran"*
- [ ] Empty-state "Type `/` for commands" placeholder — *discovery feedback*
- [ ] Nested command name grouping — *only once projects actually have nested command dirs*

### Future Consideration (v2+)

- [ ] Model search box inside the picker — *only if real projects exceed ~30 models*
- [ ] Variant (reasoning-effort) selection UI — *needs verification of how variants appear in `GET /api/model`*
- [ ] Agent picker in the header (v2 splits model/agent/prompt per session) — *adjacent, same pattern, separate milestone*
- [ ] Paddy-action command palette (Cmd+K) — *distinct from OpenCode commands; needs its own milestone*
- [ ] Argument hints — *blocked until OpenCode exposes argument schema in the API*

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Header model picker (grouped, keyboard, active display) | HIGH | MEDIUM | P1 |
| Persisted desk default (state.ts, V2-02) | HIGH | MEDIUM | P1 |
| Session-resume model seeding | HIGH | LOW | P1 |
| Slash palette trigger + filter + keyboard | HIGH | MEDIUM | P1 |
| `/name args` execution (4-layer + submit fork) | HIGH | MEDIUM | P1 |
| Command errors in thread | HIGH | LOW | P1 |
| Per-project command fetch + `command.updated` refresh | MEDIUM | LOW | P1 |
| MRU ordering (pickers) | MEDIUM | LOW | P2 |
| Model metadata badges | MEDIUM | LOW | P2 |
| `session.model.selected` header sync | MEDIUM | LOW | P2 |
| Nested command grouping | LOW | LOW | P3 |
| Placeholder slash hint | MEDIUM | LOW | P2 |
| Variant picker | LOW | MEDIUM | P3 |

---

## Competitor / Precedent Feature Analysis

| Aspect | ChatGPT | Claude (web) | Cursor | Slack / Discord | OpenCode TUI | Paddy v1.1 plan |
|---|---|---|---|---|---|---|
| Model picker placement | Top-of-chat header dropdown | Header-right selector | Composer chrome dropdown + Tab-to-cycle | n/a | Model switch in its own menu | Chat header, next to session title |
| Grouping | Capability tiers | Model families | Provider | n/a | Flat list | **Provider groups** (data-model fit) |
| Persistence | Sticky for new chats | Per-conversation + default | Per-chat, remembered | n/a | Config file | Sticky desk default in Paddy state + per-session |
| Mid-session switch | Yes | Yes | Yes | n/a | Yes | Yes (`POST /session/{id}/model`) |
| Command trigger | n/a | n/a | `@`-files, `/` in some surfaces | `/` first char → inline palette | `/` in input → list | `/` first char → inline palette above composer |
| Entry content | n/a | n/a | Name + type | Name + description + usage hint | Name (+ description) | Name + description (API max) |
| Argument model | n/a | n/a | Free-form | Single text blob after command | `$ARGUMENTS` / positional | Single `text` blob (API contract) |
| Error surfacing | n/a | n/a | Inline in thread | Message in channel (documented best practice) | In-thread | **System message in thread** |
| Registry ownership | Server | Server | Server | Server (app registry) | Server (command files) | **OpenCode via `GET /api/command`** — never mirrored |

---

## Sources

- OpenCode API reference — `https://opencode.ai/docs/api` (178 operations incl. `GET /api/command`, `POST /api/session/{sessionID}/command`, `POST /api/session/{sessionID}/model`, `GET /api/model`) — **confidence: HIGH** (vendor primary source)
- OpenCode OpenAPI 3.1 document — `https://opencode.ai/docs/openapi.json` (exact request/response/error schemas: `Command.Info`, `CommandNotFoundErrorEncoded`, `CommandExecutionErrorEncoded`, `Model.Info`, `Model.Ref`) — **confidence: HIGH** (vendor primary source, cross-checked against the API reference page; both fetched 2026-11-21)
- OpenCode Commands guide — `https://opencode.ai/docs/commands/` (command files, frontmatter fields, `$ARGUMENTS`/positional templating, fallback append, shell blocks, precedence, hot reload) — **confidence: HIGH** (vendor primary source)
- Slack: Implementing slash commands — `https://docs.slack.dev/interactivity/implementing-slash-commands` (command/text split at first space, description + usage hint in autocomplete, errors-as-messages best practice) — **confidence: MEDIUM** (vendor doc, cross-verified with Discord)
- Discord: Interactions reference — `https://docs.discord.com/developers/docs/interactions/receiving-and-responding` (autocomplete interaction model, 25-choice cap, focused-option re-query) — **confidence: MEDIUM** (vendor doc)
- ChatGPT / Claude / Cursor model-picker behavior — widely observed product behavior (sticky defaults, per-conversation override, composer placement, grouping) — **confidence: MEDIUM** (no single authoritative doc; consistent across three independent products)
- Local grounding: `src/components/desk/app.tsx` (model state, composer, Enter-to-send), `src/lib/desk/client.ts` (`api.send`, `RuntimeModel`), `src/server/opencode-client.ts` (model POST on send), `src/server/state.ts` (persistence), `.planning/V2-MIGRATION-SPEC.md`, `.planning/PROJECT.md` — **confidence: HIGH** (read from the repo at HEAD)

**Verification notes:** WebSearch was unavailable (HTTP 402) — searches fell back to direct fetches of vendor documentation, which for this domain (a single dependency's API contract) is the stronger source class anyway. Negative claims ("no argument schema", "no global-config write") were checked against the OpenAPI document and the live v2.3.2 behavior recorded in V2-MIGRATION-SPEC.md, not inferred. UX-pattern claims for ChatGPT/Claude/Cursor rely on domain knowledge and could not be re-verified against live pages — they are consistent with each other and with the documented Slack/Discord contracts, and none of them gates a controller-level decision.

**Gaps for phase-specific research:** (1) whether reasoning-effort variants appear as distinct `Model.Info` entries or require `variant` in `Model.Ref` — verify against a live `GET /api/model` during the picker phase; (2) exact SSE shape of the expanded user message after a successful `POST /command` (204 body is empty) — verify with a live run before finalizing the success path; (3) preferred behavior when submitting an unmatched `/draft`: block with hint vs send-as-text — a product decision to settle in the phase SPEC.

---
*Feature research for: Paddy v1.1 — model picker & slash commands*
*Researched: 2026-11-21*
