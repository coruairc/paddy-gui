---
phase: 08-chat-model-picker
audited: 2026-11-22
status: secured
threats_open: 0
asvs_level: 1
block_on: high
---

# Phase 8 Security Audit — Chat Model Picker

## Scope

New read surface `GET /api/models`, the browser-facing catalog projection, the additive `model-selected` SSE variant, and the persistence/reconciliation paths that decide which model runs.

## Threat Register Verification

| Threat ID | Category | Severity | Disposition | Evidence |
|---|---|---|---|---|
| T-8-01 | Information disclosure | high | mitigate | `listModels` projects exactly ten fields (key, id, providerID, name, status, context, released, enabled, tools, variantCount). Raw `headers`/`settings`/`body`/`package`/`compatibility` never cross. `api.test.ts` asserts the key set and scans the JSON for forbidden fields. |
| T-8-02 | Tampering | high | mitigate | Project → redact → assemble: identifiers travel as `modelKey` through `redactSecrets` and are renamed to `key` only afterwards. `api.test.ts#model keys and default survive redaction with a registered needle` registers `token` (a substring of `alibaba-token-plan`) and asserts every key and the default survive byte-identically, with no `modelKey` leak. |
| T-8-03 | Elevation of privilege | medium | mitigate | The route accepts no path/query parameter; `location[directory]` comes only from `activeProject(runtime)`. |
| T-8-04 | Repudiation / integrity | high | mitigate | Catalog-membership resolution is gated on `catalogLoaded`; `modelForSend` sends the effective key only when stale and the persisted key otherwise. Unit tests cover both branches. |
| T-8-05 | Tampering | medium | mitigate | DOM ids use `modelSlug` (`[^A-Za-z0-9_-] → _`); keys are `providerID/id`, so ids are unique and `aria-activedescendant` resolves to one element. Live UAT confirmed `activeOptionExists: 1`. |
| T-8-06 | Spoofing / integrity | high | mitigate | Stale persisted key falls back to OpenCode's default with a warn icon, `aria-describedby`, and a banner; no state write. Live UAT verified the stale state and that a pre-load reload shows a plain label with no warn. |
| T-8-07 | Information disclosure | low | accept | Rendered catalog strings are already projected/redacted server-side; React escapes text nodes. |
| T-8-08 | Repudiation / integrity | high | mitigate | `resolveHeaderModel` gates on the active session id; positive and negative unit tests; the reducer sets state only on a non-null result. |
| T-8-09 | Tampering | medium | mitigate | `normalizeEvent` requires non-empty `sessionID`, `id`, and `providerID`; partial payloads return `null`; `previous` and `variant` are never read. Tests cover each missing field. |
| T-8-10 | Elevation of privilege | medium | mitigate | Resume and reconciliation write nothing to `deskModel`; `modelSource` keeps session truth immune to catalog fallback; the `chooseProject` config re-read is removed and grep-gated. |
| T-8-SC | Tampering | high | mitigate | Zero new dependencies; `package.json`/`package-lock.json` unchanged across the phase. |

## Residual Risks

None open. The accepted low-severity T-8-07 is bounded to already-projected, React-escaped display strings.

**threats_open:** 0 — SECURED
