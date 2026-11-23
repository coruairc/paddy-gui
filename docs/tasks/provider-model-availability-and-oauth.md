# Task: provider model availability + subscription sign-in

## Goal

In Settings → Providers:

1. Let users explicitly add/remove OpenCode-listed chat models from the
   composer model picker without changing the current desk default.
2. Make OpenCode-advertised OAuth subscription methods usable from the GUI,
   including the live methods for ChatGPT, SuperGrok, and GitHub Copilot.
3. Show both configured and not-yet-configured OpenCode-supported providers,
   with a Configured / Not configured tab filter.

## Baseline

- Base SHA: `c546d0b` (main, in sync with origin)
- `git status --short` before delegation: clean

## Observed facts

- Live OpenCode 2.3.2: `/api/providers` reports 15 providers and 1,255
  provider-listed models. `/api/models` reports 717 chat models. 560 models
  with `enabled: true` are in the provider data but not the chat catalog;
  e.g. provider `opencode-go` has `gemini-4-neon` while the picker catalog
  uses other provider IDs for some aliases. User asked for explicit Add to
  chat-picker availability, not “Use as desk default.”
- Provider-card model rows currently have a native select and
  “Use as desk default” (`src/components/desk/settings.tsx:381-400`). No
  Add-to-picker action exists.
- `GET /api/models` projects only `client.listModels()` (`src/server/api.ts:
  375-419`), so provider-listed models absent from that catalog cannot appear
  in the picker.
- `AppState` persists GUI metadata in `~/.paddy/state.json`; `deskModel` is
  already global to the local Paddy controller. OpenCode remains authoritative
  for its own provider/model catalog and credentials.
- `getProviderAuth()` currently reduces integration methods to `{type,label}`
  (`src/server/opencode-client.ts:425-445`), discarding method IDs and forms;
  the Providers UI merely prints these descriptions (`settings.tsx:355-361`).
- Live auth methods from `/api/providers`:
  - `openai`: OAuth “Sign in with ChatGPT” (plus legacy Codex methods)
  - `xai`: OAuth “SuperGrok Subscription”
  - `github-copilot`: OAuth “Login with GitHub Copilot”
- User clarification: Settings → Providers must have Configured and Not
  configured tabs; the current `/api/provider`-backed set is not the complete
  list of options.
- OpenCode 2.3.2 `/api/provider` is documented as “active AI providers”.
  `/api/integration` separately provides OpenCode's supported integration
  methods, but does not include the complete display/model catalog. OpenCode
  itself uses models.dev for provider metadata.
- The user explicitly approved the controller fetching
  `https://models.dev/api.json` to populate the Not configured tab. Official
  models.dev API documentation confirms `/api.json?type=all` returns the
  provider-keyed catalog. Treat this as display/model metadata only; never
  contact provider API URLs from the fetched catalog.
- Verified installed OpenCode 2.3.2 wire contract from its embedded schema
  and UI flow:
  - `POST /api/integration/:integrationID/connect/oauth`,
    body `{ methodID, answer?, label? }` → `{ data: { attemptID, url,
    instructions, mode: "auto"|"code", paste, time } }`.
  - `GET /api/integration/:integrationID/connect/oauth/:attemptID` →
    `{ data: { status: "pending"|"complete"|"failed"|"expired", ... } }`.
  - `POST /api/integration/:integrationID/connect/oauth/:attemptID/complete`,
    body `{ code? }` → 204.
  - `DELETE /api/integration/:integrationID/connect/oauth/:attemptID` →
    204 cancel.
  The OpenCode desktop flow opens the authorization URL, polls status, uses
  `code` mode for manually entered codes, and supports a pasted redirect URL
  for `paste` attempts. Do not invent alternate upstream endpoints/payloads.

## Part A — Add provider-listed models to the picker

- AC-A1: Each provider-listed chat model absent from `/api/models` has an
  explicit “Add to chat” action in Settings → Providers. When added, it
  appears in the composer model picker with correct provider/model key and
  display metadata. It does NOT change `deskModel` or the current session
  model.
- AC-A2: Models already in the picker show “In chat” (or equivalent), not a
  duplicate Add action. Added rows offer a reversible “Remove” action; removing
  a model does not reset the current default/session model, but the existing
  stale-model behavior applies if that model was selected.
- AC-A3: Persist the user’s curated availability list in Paddy’s existing
  local state (global to the local controller, consistent with `deskModel`);
  older state files silently upgrade. OpenCode config is not rewritten.
- AC-A4: Server only accepts additions for an actual model listed by the
  connected OpenCode provider catalog and of chat type; reject unknown,
  non-chat, or explicitly disabled entries. Store canonical
  `providerID/modelID` keys, dedupe, bound list size, and never accept
  browser-supplied display metadata as authority. Picker response derives
  name/context/status from OpenCode data, not the browser.
- AC-A5: Models in the ordinary `/api/models` catalog remain available with
  unchanged behavior. Merge curated provider models by canonical key without
  duplicates. If an added model disappears from the provider catalog, omit it
  from the live picker response but preserve or safely prune its saved key
  (implementer choice; document behavior).
- AC-A6: “Add”/“Remove” affordances work without selecting the model as
  default. Existing “Use as desk default” remains and continues to persist
  `deskModel` separately.

## Part B — OAuth sign-in for subscription providers

- AC-B1: Preserve auth method `id`, `type`, `label`, and any required form
  schema through the controller to the browser, while still stripping
  credentials/tokens. Do not expose OAuth access/refresh tokens.
- AC-B2: For OAuth methods, show a “Sign in” button. Start auth through a
  same-origin Paddy controller route; controller proxies the exact
  OpenCode integration OAuth routes above. Validate provider/integration and
  method ID against OpenCode’s listed auth methods before starting.
- AC-B3: Render OpenCode’s authorization URL/instructions in an accessible
  in-app flow with explicit “Open sign-in” and “Copy link” actions (do not
  rely on an unsolicited `window.open` after an awaited fetch). Poll attempt
  status while pending; support `mode:"code"` and `paste:true` completion
  with an in-app input as described by OpenCode; support cancel and cleanup.
- AC-B4: On complete, refresh provider/auth/model data and show a success
  state. On failed/expired/start/status/complete errors, show a useful
  non-secret error and allow retry. Do not log or persist authorization codes,
  URLs with sensitive parameters, or tokens.
- AC-B5: At minimum the live advertised methods above are discoverable and
  invokable; do not hardcode those three providers if generic OAuth metadata
  supports them. Key-based auth remains unchanged.
- AC-B6: Controller routes enforce existing peer/origin authorization through
  `handleNode`; route methods are bounded by the listed integration/method and
  an active OpenCode connection. Cancel active OAuth attempts on dialog
  teardown where feasible.

## Part C — Configured / Not configured provider catalog

- AC-C1: Settings → Providers shows two accessible tabs: “Configured” and
  “Not configured”, with counts. Configured is backed by OpenCode's active
  `/api/provider` list. Not configured is built from models.dev catalog
  providers that are also present in OpenCode's `/api/integration` inventory
  and are not already active. Do not label arbitrary models.dev entries as
  OpenCode-supported when OpenCode has no corresponding integration.
- AC-C2: Controller fetches `https://models.dev/api.json?type=all` only from
  the controller; cache in memory with a bounded TTL (e.g. 24h), request
  timeout (e.g. 5s), and response byte cap. On failure, configured providers
  continue working and the Not configured tab shows a retryable catalog error;
  do not fail the entire Providers page. Do not persist this catalog or fetch
  it from browser code.
- AC-C3: Project only safe metadata needed for UI (provider ID/name/docs,
  model IDs/names/types, counts); ignore provider API base URLs and any
  credential-shaped fields even though the source is public. No calls are made
  to individual provider URLs. Search/filter applies across both tabs.
- AC-C4: For a not-configured provider, show the supported OpenCode auth
  methods from the existing integration inventory. OAuth/key methods can be
  connected using the Part B / existing key flow. If no usable auth method is
  available, show a clear “Configure in OpenCode” explanation rather than an
  inert button. Successful connection triggers the existing refresh path and
  moves that provider to Configured.
- AC-C5: Models from an unconfigured catalog entry cannot be added to the
  chat picker until OpenCode reports the provider active and its provider
  catalog validates the model. Show “Connect to load models”; do not imply
  catalog metadata alone guarantees model availability.
- AC-C6: No separate Models section (user explicitly chose a Providers-page
  Configured / Not configured filter).

## Non-goals

- No OpenCode configuration writes, model-default changes, credential storage
  in Paddy, or new auth-provider implementation.
- No custom provider/model entry editor; only models OpenCode itself lists.
- No support for command/external auth flows unless required by one of the
  named subscription methods’ actual advertised metadata.
- The only new outbound destination is the user-approved
  `https://models.dev/api.json?type=all` request from the controller. OAuth
  destinations are supplied by OpenCode’s integration response; do not
  hardcode provider URLs. No provider inference requests, new dependencies, or
  browser-origin fetches.

## Ownership / sequencing

The work crosses controller state/API and Settings UI. Implement serially in
one working tree: backend state/catalog/OAuth proxy first, then frontend UI
against those contracts; after the backend baseline was delivered, the
frontend work began. For Part C's newly clarified catalog tabs, finish the
current frontend work, then extend the backend catalog contract in a separate
serial round, then complete the frontend tabs against that contract. Do not
run parallel implementers.

## Verification

- AC-V1: Red-first node:test coverage for model-add validation, dedupe/merge,
  state upgrade, OAuth method filtering and route proxy payload/order.
- AC-V2: `npm run typecheck`, `npm run lint`, `npm test` pass; use
  `flock -w 900 /tmp/team-build.lock` for every heavy run.
- AC-V3: Live local verification with the existing OpenCode service:
  add an enabled provider-listed model absent from `/api/models`, verify it
  appears in the picker while the desk default is unchanged, remove it and
  verify it disappears. Do not incur a paid model call.
- AC-V4: OAuth UI tests use mocked upstream attempts; do NOT complete real
  ChatGPT/Grok/Copilot sign-in without the user explicitly asking to connect
  an account. Verify method discovery and the start/poll/cancel UI with mocked
  or locally intercepted OAuth responses; do not change existing provider
  connections.
- AC-V5: No credentials in browser response, logs, tests, or committed state;
  no user provider/model/default/session state left changed.
- AC-V6: Catalog parsing/cache tests use fixtures (no live network in tests):
  bounded provider/model projection, filtering to OpenCode integration IDs,
  cache TTL/failed-fetch behavior. Live check confirms Configured and Not
  configured tabs, search in each, and that a provider moves tabs after a
  mocked/controlled auth completion. The controller’s actual models.dev fetch
  may be exercised once under the explicitly approved host; do not trigger
  calls to provider API hosts.

## Status

- [ ] Implemented
- [ ] Reviewed
- [ ] Committed
