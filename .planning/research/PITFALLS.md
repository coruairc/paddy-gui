# Pitfalls Research

**Domain:** Adding a chat-header model picker, slash-command palette, and v2 test/config hardening to Paddy (local web UI over the OpenCode v2 HTTP/SSE API)
**Researched:** 2026-11-21
**Confidence:** MEDIUM — API-contract facts are cross-verified between the official OpenCode v2 API reference (opencode.ai/docs/server) and the repo's curated `.planning/V2-MIGRATION-SPEC.md` (captured from the live v2.3.2 `/openapi.json`). General UX/testing pitfalls are established practice, not freshly fetched (websearch was unavailable this run, HTTP 402). The classify-confidence seam rates single-source webfetch LOW; the curated-spec cross-check is what raises these to MEDIUM.

## Critical Pitfalls

### Pitfall 1: Optimistic model switch drifts from the session's actual model

**What goes wrong:**
The desk shows model X in the header while the OpenCode session actually runs model Y. The user believes they switched, sends an expensive prompt to the wrong model, and loses trust in the desk — exactly the "no surprises" failure PROJECT.md calls out as the core value.

**Why it happens:**
`POST /api/session/{id}/model` is a separate call from `POST /api/session/{id}/prompt`. Teams set local React state the moment the dropdown closes, then fire-and-forget the model POST. OpenCode v2 emits a `session.model.selected` event **and** appends a `Session.Message.ModelSelected` message to the thread — both are reconciliation signals most integrations ignore. The switch can also fail silently: v2 has `SessionBusyErrorEncoded` and `UnsupportedModelErrorEncoded` shapes, so a model switch issued while the session is mid-run, or for a model the provider rejects, 404s/400s without the UI noticing.

**How to avoid:**
Treat `POST .../model` as authoritative-on-ack only: apply the selection optimistically but reconcile against the `session.model.selected` SSE event and re-read `Session.Info.model` on the next session load. `normalizeEvent` should map `session.model.selected` to a GuiEvent that updates the session summary (the UI's `upsertSession` merge by id already supports this). On send, Paddy's client already sequences model-then-prompt (per the v2 migration spec's `sendMessage`); keep that ordering rather than trusting a cached "current model" — MODEL-02 says "applied per-session on send," which is precisely the sequencing pattern. Surface a non-blocking error if the model POST fails before the prompt goes out (abort the send, don't send to the fallback model silently).

**Warning signs:**
- Header model ≠ model shown in OpenCode's own session info after a reload.
- `ModelSelected` messages appear in the thread but the header doesn't change (or vice versa).
- Errors from `POST .../model` swallowed in a `.catch(() => undefined)`.

**Phase to address:**
Model-picker phase (MODEL-01/MODEL-02). The SSE reconciliation must land *with* the picker, not as a follow-up.

---

### Pitfall 2: Stale model and command caches (the list is a live thing)

**What goes wrong:**
The slash palette offers a command that was deleted (or was never valid for this location); the model picker shows a model the provider no longer serves. Executing a stale command returns `CommandNotFoundErrorEncoded`; picking a stale model fails on send. The desk feels broken even though OpenCode is fine.

**Why it happens:**
v2 fires `command.updated`, `model.updated`, and `models-dev.refreshed` events at runtime — providers refresh from the models-dev registry, custom commands reload when files change on disk. Integrations fetch `GET /api/model` / `GET /api/command` once at desk load (or worse, at Settings open) and cache forever. Both endpoints are also marked **experimental** in the v2 API surface, so shape drift across OpenCode versions is a second staleness axis.

**How to avoid:**
- Fetch the model list when the picker opens (with a short-lived cache, e.g. 30–60 s, and an in-flight de-dup so rapid open/close doesn't refetch), not once at bootstrap.
- Subscribe to `command.updated` / `model.updated` / `models-dev.refreshed` in `normalizeEvent` and emit a GuiEvent that invalidates the cached list (simplest: bump a version counter the picker checks, or drop the cache).
- Normalize defensively: unknown shapes → empty list + a warning state, never a crash (`getConfig` in the migration spec already models this "derive or return `{}`" approach).
- Because multiple tabs share one controller SSE fan-out, cache invalidation must be event-driven, not per-tab state — a second tab will otherwise hold a stale list the first tab just refreshed.

**Warning signs:**
- Palette shows commands that error with "command not found" on submit.
- Model list differs between the picker and OpenCode's own TUI on the same session.
- Tests mock `GET /api/command` with a fixture that never exercises the invalidation path.

**Phase to address:**
Model-picker phase and command phase each, for their own list; the `normalizeEvent` wiring for the three events should land in whichever phase comes first and be reused.

---

### Pitfall 3: redactSecrets corrupts provider/command data (the known regression)

**What goes wrong:**
Data returned to the browser is silently mangled: provider IDs like `alibaba-token-plan` become `alibaba-[redacted]-plan`, breaking model selection (the picker posts back a corrupted `providerID`), and command names/descriptions containing words like "token" or "key" get rewritten. This is not hypothetical — it previously corrupted provider auth data in this repo.

**Why it happens:**
`redactSecrets` (src/server/security.ts:159) does two aggressive things: (1) key-regex match — any key matching `/token|key|secret|password|authorization|credential/i` has its *value* replaced; (2) needle substring replacement — any string *containing* a secret needle (≥4 chars) gets the needle split-and-replaced everywhere. Model lists (`GET /api/model`, provider IDs), commands (`GET /api/command`), and `GET /api/credential` responses are all newly flowing through this boundary in v1.1. The `Model.Info`/provider surface is full of legitimate identifiers that look credential-shaped.

**How to avoid:**
- Never route identifier-shaped payloads (model ids, provider ids, command names) through `secretNeedles` needle replacement. Key-regex redaction of actual credential values (`GET /api/credential` entries) is correct; substring needle matching on structured identifier lists is not.
- Add regression tests before wiring new endpoints: a provider literally named `alibaba-token-plan` must round-trip unchanged through any response path that the model picker consumes; a model list containing a provider id with "token" in it must be byte-identical after redaction.
- Consider replacing substring needle replacement with exact-value matching (redact only strings that *equal* a known secret, not strings that *contain* a fragment). Substring mode is only needed for prose that embeds secrets — apply it to free-text fields, not to the whole tree.
- Keep the milestone's out-of-scope guard: no new credential key-entry UX; `/api/credential` data stays redacted.

**Warning signs:**
- `[redacted]` appearing inside model/provider ids, command names, or session titles in the browser.
- Model POST failing with unknown provider because the browser echoed a redacted id back.
- A new `api.ts` route that wraps its response in `redactSecrets(x, secretNeedles(runtime))` by copy-paste from an existing route.

**Phase to address:**
First controller-touching phase of v1.1 (the hardening phase if it lands first, otherwise the model-picker phase, since `GET /api/model` is the first new redacted route). The regression test belongs in `src/server/security.test.ts` / `api.test.ts` before any new route is written.

---

### Pitfall 4: Hermetic tests that depend on port 4096 being free (the current red test)

**What goes wrong:**
`npm test` is 79/80 — `runtime.test.ts` "spawn uses detached:true" fails whenever a real `opencode serve` is running, because `ControllerRuntime.connect()` probes the hard-coded `http://127.0.0.1:4096` (src/server/runtime.ts:145-146) and *attaches* to the live server instead of spawning. The test then asserts on spawn calls that never happened. Worse than the failure itself: the test is environment-dependent — it passes on a clean CI runner and fails on the developer's laptop, which erodes trust in the suite.

**Why it happens:**
The probe URL and port are baked into `connect()`. The test injects `OPENCODE_BIN` and a fake spawn but has no way to inject the probe target. The developer's machine is exactly the environment where a live server *should* exist — that's the attach-vs-spawn duality working as designed in production and as a bug in the test.

**How to avoid:**
- Make the probe base URL injectable in `ControllerRuntimeOptions` (it already accepts injected `sleep`, `kill`, `spawn` — follow that pattern; conventions call for injected env/side-effect dependencies).
- Point the test's probe at an ephemeral closed port (bind a listener, note the port, close it, then use it) so `probe` deterministically returns `"down"` and the spawn path runs.
- Alternatively inject a fake `probe` — but testing the real probe against a guaranteed-closed port is stronger.
- Audit the rest of `runtime.test.ts` (and any new tests added in v1.1) for the same class: no test may depend on the state of ports 4096/8080/8081 or `~/.paddy` on the machine. The new model/command route tests must use a fake `runtime.client` (the `api.test.ts` pattern), never a live OpenCode.
- `node:test` runs files concurrently by default — the new tests must also not collide with each other on shared temp dirs; keep using `mkdtempSync`.

**Warning signs:**
- Tests pass in CI but fail locally (or vice versa) with no code change.
- A test whose fixture is "whatever is listening on a fixed port."
- `PADDY_HOME` unset while running the suite (state leaking into the real `~/.paddy`).

**Phase to address:**
V2-01 hardening phase, before any feature phase adds more tests on top of a flaky base. This is the first thing to fix: every later phase's "npm test green" exit criterion is meaningless otherwise.

---

### Pitfall 5: Treating a slash command as a prompt (and mishandling its errors)

**What goes wrong:**
`/name args` gets sent to `POST /api/session/{id}/prompt` as literal text — the LLM receives "run the tests please" as chat instead of the command executing. Or the command *is* executed via `POST /api/session/{id}/command` but its failure (404 `CommandNotFoundErrorEncoded`, `CommandExecutionErrorEncoded`, session-busy) surfaces as a generic toast/one-line error that vanishes, leaving the user unsure whether anything happened.

**Why it happens:**
The composer has exactly one submit path today; the laziest integration routes everything through it. Command execution is a distinct endpoint with distinct error semantics (structured error envelopes, not message-thread errors). The thread is where users look for outcomes — errors that only reach a toast break the "no surprises" contract.

**How to avoid:**
- Split the send path in the client and the desk: parse the leading `/` client-side (exact, well-tested function — pure, unit-testable per repo convention), then dispatch to `POST /api/session/{id}/command` with the argument text; everything else goes to prompt as before.
- Command results and errors must surface *in the thread* (CMD-02): map `CommandExecutionErrorEncoded`/`CommandNotFoundErrorEncoded` into a system/error `ChatMessage` in the session, the same way assistant `error?.message` is mapped today. Do not invent a new error surface.
- Only a *leading* `/` with a name matching a listed command dispatches to the command route; unknown `/foo` should still go to the prompt (the model may legitimately be asked about slash syntax) — or be rejected in the palette but passed through on submit. Decide explicitly and test both.
- Guard the busy case: sending a command to a session mid-execution can conflict (`SessionBusyErrorEncoded` exists); reuse the existing `working`/`pending` composer disable rather than inventing a new one.
- Reconcile via SSE: command execution produces thread messages like any run; do not optimistically insert a fake "command ran" bubble beyond a pending marker, and let the echo replace it (the existing `pending`→echo merge pattern).

**Warning signs:**
- Assistant replies to a slash command with conversational text ("Sure, I can run the tests…").
- Command 404s render as an empty composer state or a transient toast.
- No unit test for the `/`-parser (leading slash, mid-text slash, `/` alone, args with spaces/quotes).

**Phase to address:**
Slash-command phase (CMD-01/CMD-02), with the parser and error-mapping as the first deliverable, palette second.

---

### Pitfall 6: Replacing the global-config write with a second source of truth for the model

**What goes wrong:**
V2-02 drops `PATCH /api/config` (it 404s in v2; only `PATCH /api/experimental/config` exists and accepts `{shell}`) and moves the desk default model into `~/.paddy/state.json`. If Settings/picker state then *drives* what model is used without checking what OpenCode says the session uses, Paddy has created a shadow model config that drifts from the authority — precisely the state-duplication mistake the "OpenCode remains the source of truth" constraint exists to prevent.

**Why it happens:**
The 404 pushes you toward local persistence, and local persistence invites local authority. The desk default is a *preference* ("what new sessions in this desk start with"), while the session's actual model is *state OpenCode owns* (`Session.Info.model`, settable via `POST .../model`).

**How to avoid:**
- Store only the *desk default* (a preference) in `state.json`. The session's current model always comes from `Session.Info.model` on load and `session.model.selected` events thereafter. Never write the model into Paddy state per send.
- On reload, derive the header's shown model from the session, falling back to the desk default only for a fresh session. If they differ, the session wins (show what will actually run).
- Settings saves that previously hit `updateConfig` must stop calling it entirely — remove the client method rather than leaving it dead (repo decision: delete dead scaffold, don't leave it dormant). "Settings saves never 404" means the *write path is gone*, not that the error is caught.
- Keep `getConfig` as a read (v2 `GET /api/config` works, returns config documents); do not attempt writes through it.

**Warning signs:**
- `state.json` gaining a `sessionModels` map keyed by session id (per-session state is OpenCode's, not Paddy's).
- The picker showing the desk default after a reload when the session was switched elsewhere.
- A try/catch around a still-present `updateConfig` call that "makes the 404 go away."

**Phase to address:**
V2-02 hardening phase — it must land *before* or *with* the model picker, otherwise the picker gets built against the wrong persistence target and has to be rewired.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Flat, unvirtualized model list in the picker | No windowing code | 10 providers × dozens of models each = hundreds of DOM nodes; open/close jank and scroll lag on the primary composer control | Never for the full list — filtering alone mitigates but doesn't remove the render cost on open |
| One shared fetch for models+commands at bootstrap | Fewer requests | Stale-list pitfall (Pitfall 2); no invalidation wiring | Acceptable only as an in-flight de-duped cache with event-driven invalidation |
| Parsing `/` inline in the submit handler | Ships CMD-02 fastest | Untestable dispatch logic, mid-text-slash bugs, duplicated between palette and submit | Never — extract a pure parser module (repo convention: testable pure helpers in plain `.ts`) |
| Leaving `updateConfig` on the client with a try/catch | "No more 404s" in the UI | Dead endpoint code + silent failure mode; next contributor reuses it | Never — repo already decided dead scaffold gets deleted |
| Testing the runtime probe against the real 4096 port | No injection plumbing | Environment-dependent suite (the current red test) | Never |
| Duplicating v2 wire types ad hoc in the picker/palette components | No changes to shared types | Browser/server type drift — the mirrored-types contract (`src/lib/desk/client.ts` ↔ `src/server/normalize.ts`) breaks silently | Never — add to the mirror, both sides, in the same change |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `POST /api/session/{id}/model` | Switching after sending the prompt, or assuming the switch implies the next prompt uses it | Switch *before* prompt (sequence in one client method, as the v2 spec's `sendMessage` already sketches); treat failures as send-blocking |
| `GET /api/model` | Assuming a stable shape; it's an **experimental** route | Defensive normalization (unknown shape → empty + warning), group by `providerID`, keep the `{data}` unwrap |
| `GET /api/command` | Treating it as a static global list | It's experimental and event-invalidated (`command.updated`); refetch on open + event-driven cache drop |
| `POST /api/session/{id}/command` | Reusing the prompt response handling; expecting a `userMessage` echo | Command execution has its own response and structured error shapes; reconcile thread state via SSE, not the POST response |
| `session.model.selected` / `ModelSelected` message | Ignoring both; treating model as desk-only state | Map both in `normalizeEvent`/`toChatMessage` (ModelSelected → system message, like `model-switched` is already listed in the spec's "minor" bucket — do not silently drop it if the header must track it) |
| `models-dev.refreshed` / `model.updated` | No subscriber | Add to the ignore-list *deliberately* or wire invalidation — an accidental `return null` is how staleness begins |
| `GET /api/credential` (out of milestone scope) | Exposing raw keys via the new redacted routes | Keep it redacted; no new key UI this milestone (explicit out-of-scope) |
| Basic auth on every new client method | Forgetting credentials on new fetches | All v2 calls go through the single `request()` in `opencode-client.ts` — no new fetch sites |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rendering all models at once in the picker | Frame drops when opening the header dropdown; input lag while typing to filter | Group by provider (collapsed sections), filter by query before render, cap initial render (e.g. render active provider's group expanded only) | ~100+ entries — the known scale here (10 providers, "hundreds of models") is already past it |
| Refetching the model list on every keystroke in the picker filter | Controller/OpenCode request storm | Debounce the *fetch* (or fetch once per open) and filter client-side — filtering is cheap, fetching is not | Immediately with hundreds of models |
| Command palette re-rendering the whole message list per keystroke | Whole desk re-renders while typing `/` | Isolate the palette's filter state in its own component; keep the composer's draft state out of the thread's render path | Long sessions (the thread is the heaviest subtree) |
| Per-send `state.json` atomic writes | Disk churn; write amplification on rapid model toggling | Persist the desk default on *change* (debounced or explicit), not on send; per-session model is not persisted at all | Multi-tab + rapid toggling |
| SSE fan-out doing deep JSON clones per subscriber per event | Growing lag during streaming sessions | Keep the existing fan-out shape (it already works); just don't add per-subscriber redaction/cloning on the new event types | New event types added naively to the fan-out |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Routing new list endpoints through `secretNeedles` substring redaction | Corrupted provider/command identifiers sent back to OpenCode (Pitfall 3 — prior incident in this repo) | Exact-match or key-based redaction only for identifier payloads; regression tests with `alibaba-token-plan`-shaped fixtures |
| Browser importing server types for model/command wire shapes | Breaks the process boundary (`node:*` imports in the browser bundle) — the controller-is-boundary invariant | Mirror types in `src/lib/desk/client.ts` by hand, as every existing feature does |
| Sending `/command` bodies unvalidated through the controller | Injection into OpenCode's command execution path (commands run agent-side machinery) | Validate in `api.ts` at the boundary (zod or the existing `{ok}` validators): command name against the fetched list, args as a bounded string; workspace/`location[directory]` scoping stays via the existing allowlist |
| Logging command args or model payloads with secrets embedded | Secret leakage into logs | Everything crossing the boundary already passes `redactSecrets` at the response layer — extend the same policy to any new log lines |
| Trusting the command list as an allowlist substitute | A listed command name isn't an authorization decision | The allowlist check is defense-in-depth for *args shape*, not auth; OpenCode's own permission system remains the gate |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Palette keyboard handling bolted on after the visual design | Arrow keys scroll the page behind the palette; Enter submits the composer instead of the highlighted command; Escape closes nothing | Build the combobox/listbox interaction first: ArrowUp/Down move the active option (and scroll it into view), Enter executes the active option, Escape closes and restores focus to the composer, Home/End jump; trap focus while open (WAI-ARIA combobox pattern) |
| Screen readers see a pretty div soup | The palette is invisible/unusable non-visually — a11y regressions in the primary input path | `role="combobox"` on the input + `aria-expanded`, `aria-activedescendant` (or roving `aria-activedescendant`-less focus), `role="listbox"/"option"` with `aria-selected`; announce "N commands available" |
| Model picker shows raw model ids only | `deepseek-v4.1-flash` vs `deepseek-v4.1` confusion; wrong model picked | Show provider group + model id + any variant, with the active session model marked; the working model known from the live server is `{id, providerID}` — display both fields |
| Command errors as toasts | User misses the failure, retries blind, blames the desk | Errors render in the thread (CMD-02) — a system-styled ChatMessage with the command name and error text |
| Losing composer draft when the palette opens/closes | Typed `/he` vanishes on Escape — rage | The palette is an overlay over the composer, not a replacement for it; draft state survives open/select/dismiss |
| Model switch with no feedback until next send | "Did it take?" — users re-open the picker to check | Optimistic header update + reconciliation event (Pitfall 1); transient "Switched to X" only if the event doesn't arrive promptly |

## "Looks Done But Isn't" Checklist

- [ ] **Model picker:** Often missing reconciliation with `session.model.selected` / `Session.Info.model` — verify: switch model in another OpenCode client (or the TUI), Paddy's header follows without reload.
- [ ] **Model picker:** Often missing persistence split — verify: reload the desk; a *new* session starts on the desk default, an *existing* session shows its own model.
- [ ] **Model picker:** Often missing send-ordering — verify: pick a model then immediately send; the assistant message's `model` field is the picked one.
- [ ] **Slash palette:** Often missing invalidation — verify: add/remove a command file while the desk is open; the palette updates without reload (via `command.updated`).
- [ ] **Slash execution:** Often missing error surfacing — verify: run an unknown command name and a failing command; both produce in-thread error messages, not toasts, and the composer recovers.
- [ ] **Slash execution:** Often missing the unknown-command path — verify: `/notacommand hello` behaves per the decided rule (prompt-passthrough), tested.
- [ ] **Redaction:** Often missing the regression fixture — verify: a provider id containing "token" round-trips through every new route byte-identical.
- [ ] **Hermetic tests:** Often missing the port-collision audit — verify: `npm test` green with OpenCode running on 4096 *and* with it stopped.
- [ ] **V2-02:** Often missing the dead-path removal — verify: `opencode-client.ts` has no `updateConfig`/PATCH-config call left; Settings save succeeds against a live v2.3.2 server.
- [ ] **Multi-tab:** Often missing the second-tab check — verify: two tabs, switch model in one; the other tab's header updates via the shared SSE fan-out.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Model authority drift (Pitfall 1) | MEDIUM | Add `session.model.selected` mapping + re-read `Session.Info.model` on load; header becomes derived state; no data migration needed |
| Stale caches (Pitfall 2) | LOW | Refetch-on-open + event invalidation; additive normalizeEvent cases |
| redactSecrets corruption (Pitfall 3) | HIGH if shipped | Corrupted ids flow back into OpenCode calls and possibly persisted state — switch to exact-match needles, add regression tests, audit `state.json` for `[redacted]` contamination |
| Port-dependent tests (Pitfall 4) | LOW | Inject probe URL; point at closed ephemeral port; single-file change |
| Command-as-prompt (Pitfall 5) | MEDIUM | Extract parser, split dispatch in client + api route; thread error mapping; palette unaffected |
| Shadow model config (Pitfall 6) | MEDIUM | Re-derive session model from OpenCode, demote `state.json` entry to desk default; delete `updateConfig`; one-time state migration (drop stale key) |

## Pitfall-to-Phase Mapping

Assumed v1.1 phase shape: **Phase 1 — v2 hardening** (V2-01/V2-02), **Phase 2 — model picker** (MODEL-01/MODEL-02), **Phase 3 — slash commands** (CMD-01/CMD-02), **Phase 4 — end-to-end verification**. Adjust mapping if the roadmap merges phases.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hermetic tests / port 4096 (Pitfall 4) | Phase 1 | `npm test` green with live server on 4096 and without; no fixed-port fixtures anywhere |
| Global-config 404 → desk-default-only state (Pitfall 6) | Phase 1 | Settings save against live v2.3.2 succeeds; no PATCH-config code remains; `state.json` holds only the desk default |
| redactSecrets regression (Pitfall 3) | Phase 1 (tests) + Phase 2 (routes) | Byte-identical round-trip fixture for provider/command ids in `security.test.ts`/`api.test.ts` |
| Model authority reconciliation (Pitfall 1) | Phase 2 | External-switch test: header follows `session.model.selected`; reload shows `Session.Info.model` |
| Stale model cache (Pitfall 2, models) | Phase 2 | `models-dev.refreshed`/`model.updated` invalidates; refetch on picker open |
| Large-list render perf | Phase 2 | Picker opens in <1 frame budget with full model list; filter is client-side |
| Palette a11y/keyboard | Phase 3 | Keyboard-only walkthrough (arrows/enter/escape/home/end) + screen-reader announcement; focus returns to composer on close |
| Command-as-prompt / error surfacing (Pitfall 5) | Phase 3 | Parser unit tests; unknown + failing command produce in-thread errors; verified against live v2.3.2 |
| Stale command list (Pitfall 2, commands) | Phase 3 | `command.updated` invalidates palette; refetch on open |
| Multi-tab fan-out of new events | Phase 4 (audit) | Two-tab manual check rides the existing end-to-end verification pattern |
| Browser/server type mirroring | Phases 2–3 (each change) | `tsc --noEmit` clean; no `node:*` in browser bundle imports of new modules |

## Sources

- OpenCode v2 API reference, opencode.ai/docs/server (webfetch, 2026-11-21): endpoint inventory (`GET /api/command`, `POST /api/session/{sessionID}/command`, `POST /api/session/{sessionID}/model`, `GET /api/model`, `PATCH /api/experimental/config`), error schemas (`CommandNotFoundErrorEncoded`, `CommandExecutionErrorEncoded`, `SessionBusyErrorEncoded`, `UnsupportedModelErrorEncoded`), event types (`session.model.selected`, `command.updated`, `model.updated`, `models-dev.refreshed`), message types (`Session.Message.ModelSelected`). Confidence: MEDIUM — official docs cross-verified against the curated spec below. (Seam note: single-source webfetch classifies LOW; the curated cross-check is what upgrades it.)
- `.planning/V2-MIGRATION-SPEC.md` (curated, captured from live v2.3.2 `/openapi.json`): v1→v2 contract, `{data}` envelope, `location[directory]` scoping, model-then-prompt sequencing in `sendMessage`, "minor message types" bucket. Confidence: HIGH (curated repo artifact).
- `src/server/security.ts` (`redactSecrets`, `SECRET_KEY` regex), `src/server/runtime.ts` (hard-coded 4096 probe at lines 145–146, injectable `sleep`/`kill`/`spawn`), `src/server/runtime.test.ts` (the failing "spawn uses detached:true" test), `src/components/desk/app.tsx` (optimistic `pending` message + echo merge, composer disable on `working`/`pending`). Confidence: HIGH (primary source code).
- WAI-ARIA combobox/listbox authoring practice and React large-list rendering guidance: established engineering practice, not freshly fetched this run (websearch returned HTTP 402). Confidence: MEDIUM.
- Known-context incident: redactSecrets key/needle matching previously corrupted provider auth data (keys like "alibaba-token-plan" contain "token"). Confidence: HIGH (project-supplied).

---
*Pitfalls research for: Paddy v1.1 — model picker, slash commands, v2 hardening*
*Researched: 2026-11-21*
