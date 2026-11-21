# Phase 7: v2 Hardening Foundation - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the trustworthy foundation every later v1.1 phase verifies against: a hermetic `npm test` gate (V2-01), removal of the dead v2 global-config write chain plus honest Settings behavior and a persisted desk-model default (V2-02), and exact-match secret redaction with a byte-identical round-trip regression test (V2-03). It does NOT build the model picker UI (Phase 8) or slash commands (Phase 9) — it only lands the `deskModel` persistence target they will read/write.

</domain>

<decisions>
## Implementation Decisions

### Hermetic Test Gate (V2-01)
- Add an injectable `probe` seam to `ControllerRuntimeOptions` — third application of the existing DI pattern (`spawn`/`kill`/`sleep` are already injected). The failing `spawn uses detached:true` test injects a probe that reports "down" so connect always takes the spawn path, never attaching to whatever holds port 4096.
- Scrub `OPENCODE_URL` / `OPENCODE_SERVER_PASSWORD` in the runtime test setup so no ambient environment can redirect the probe.
- Scope is the failing spawn test plus the seam; the other 79 tests stay untouched.
- Prove both environments: run `npm test` once with a live OpenCode on port 4096 and once with nothing listening.

### Settings 404 Cleanup (V2-02)
- Agents/Permissions Settings sections become read-only with an explanatory note (research recommendation; resolves the open STATE.md decision). v2 has no remote write for agents/permissions — show the data honestly instead of a Save that 404s.
- Delete the dead `updateConfig` chain end-to-end: `opencode-client.updateConfig()` → `PATCH /api/config` route → browser `api.patchConfig` → all three Settings call sites. Delete, not try/catch (research).
- Settings → model default Save migrates to the new `deskModel` persistence via the existing `updateSettings` route, so Settings keeps working and Phase 8's picker shares one source of truth.
- Keep the existing inline `note` error pattern in Settings — no new toast infrastructure.

### deskModel Persistence (V2-02)
- `AppState.deskModel: string` — full `provider/model` id, `""` = unset; matches the existing `model` string state in `app.tsx`/`settings.tsx`. Update `EMPTY_STATE`, `normalizeState`, `publicState`.
- Old state files upgrade silently in `normalizeState` (missing/invalid → `""`), same pattern as every other field — no migration script, no version bump.
- API surface: extend existing `updateSettings` + `bootstrap`/`publicState` with `deskModel` — no new route.
- Accept any string; the controller does not validate against the model list. OpenCode is authoritative; Phase 8 reconciles on send/resume.

### Redaction Hardening (V2-03)
- Exact whole-string needle matching: a string node is replaced only when it equals a needle; key-based `SECRET_KEY` field redaction stays unchanged. This eliminates identifier corruption (e.g. provider id `alibaba-token-plan` becoming `alibaba-[redacted]-plan`).
- Regression proof: an exact-match round-trip test where a registered needle is a substring of `alibaba-token-plan` and the payload must survive byte-identical; the test fails if substring replacement is reintroduced.
- Tests land in both `security.test.ts` (unit) and `api.test.ts` (route-level round-trip) — fixtures before any new model/command routes in Phases 8–9.
- Keep the existing needle `length >= 4` filter; no behavior change beyond the matching strategy.

### the agent's Discretion
- Internal implementation details of the probe seam signature, test fixture mechanics, and the read-only note wording are at the agent's discretion within the decisions above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/runtime.ts` — `ControllerRuntimeOptions` already injects `spawn`, `kill`, `sleep`; `probe()` is a private method at line ~224 hitting `http://127.0.0.1:4096` (line ~145). The seam is a natural fourth injection.
- `src/server/state.ts` — `normalizeState`/`publicState`/`EMPTY_STATE` pattern; atomic 0600 writes already exist; `stateFilePath` honors `OPENCODE_WEB_HOME`.
- `src/server/security.ts` — `redactSecrets(value, extra)` at line 159; substring replacement at line 165 (`out.split(needle).join("[redacted]")`) is the corruption site; `SECRET_KEY` regex at line 156 stays.
- `src/server/api.ts` — `secretNeedles(runtime)` at line 417; `updateConfig` route at ~line 309; `redactSecrets` applied at every boundary (lines 101, 286–289, 310, 340).
- `src/components/desk/settings.tsx` — three `api.patchConfig` call sites: model default (line 314), Agents save (line 437), Permissions save (line 475); inline `note` state pattern already used.
- `src/server/runtime.test.ts` — failing test at lines 118–150; `tempStateFile()` and `makeChild()` helpers; DI already used in every other runtime test.

### Established Patterns
- Dependency injection for side effects (fetch, spawn/kill/sleep, clock) — never module mocking.
- Validation returns `{ ok }` unions; errors thrown only as `OpenCodeError` and mapped once in `handleApi`.
- Tests co-located, `node:test` + `node:assert/strict` only; pure helpers exported for testability.
- State is GUI metadata only; OpenCode owns sessions/models/secrets.

### Integration Points
- `ControllerRuntime.connect()` probe path (runtime.ts ~133–160) — where the seam lands.
- `updateSettings` route + `bootstrap` response in api.ts — where `deskModel` flows to the browser.
- `src/lib/desk/client.ts` — mirrored types and `api.patchConfig` removal; `updateSettings` gains `deskModel`.
- `.planning/V2-MIGRATION-SPEC.md` — live-captured v2.3.2 contract confirming no global-config write.

</code_context>

<specifics>
## Specific Ideas

- Research SUMMARY.md is the plan of record: zero new dependencies; redaction fixtures land before any new route; the hermetic gate is the exit criterion every later phase runs through.
- The `alibaba-token-plan` provider id is the canonical regression fixture (prior incident in this repo).

</specifics>

<deferred>
## Deferred Ideas

- Model picker UI, `session.model.selected` reconciliation, session-resume seeding — Phase 8.
- Slash command palette and `command.updated` invalidation — Phase 9.
- Model variant selection (MODEL-04) — v2 milestone.

</deferred>
