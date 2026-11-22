---
phase: 09-slash-command-palette
audited: 2026-11-22
status: secured
threats_open: 0
asvs_level: 1
block_on: high
---

# Phase 9 Security Audit — Slash Command Palette

## Scope

`GET /api/commands` (catalog projection), `POST /api/sessions/{id}/command` (browser-driven dispatch), the additive `commands-updated` SSE variant, and the `session.inbox.enqueued` user-message mapping.

## Threat Register Verification

| Threat ID | Category | Severity | Disposition | Evidence |
|---|---|---|---|---|
| T-9-01 | Information disclosure | medium | mitigate | `listCommands` projects only `{ name, description }`; nameless entries dropped; `redactSecrets` at the boundary; route test asserts the exact payload. |
| T-9-02 | Tampering | high | mitigate | The route requires a non-empty name; the session id is URL-encoded into the adapter path; only `{ name, text }` is sent; OpenCode remains authoritative for existence. Empty text is accepted by design. |
| T-9-03 | Elevation of privilege | medium | mitigate | The dispatch route is matched by the existing session-id regex and never touches the filesystem or a shell. |
| T-9-04 | Tampering | low | mitigate | `command.updated` payload is ignored; the browser treats it as invalidation and refetches the authoritative catalog (debounced). |
| T-9-05 | Spoofing / integrity | medium | mitigate | Inbox mapping requires `item.type === "user"`, a non-empty payload text, and ids from the envelope; partial/non-user payloads are dropped (tests). |
| T-9-06 | Repudiation | low | mitigate | Dispatch/async errors become persistent in-thread system messages carrying the server's message; no toast-only path. |
| T-9-SC | Tampering | high | mitigate | Zero new dependencies; `package.json`/`package-lock.json` unchanged across the phase. |

## Residual Risks

None open. The command catalog contains only display names and descriptions.

**threats_open:** 0 — SECURED
