---
status: passed
phase: 07-v2-hardening-foundation
source: [07-VERIFICATION.md]
started: 2026-11-22T01:30:00Z
updated: 2026-11-22T02:05:00Z
---

# Phase 7 UAT — v2 Hardening Foundation

Executed autonomously with Playwright (chromium headless-shell 153) against `npm run dev` + a locally started `opencode serve` v2.3.2 on `127.0.0.1:4096`, plus two concurrent `npm test` runs. Servers were stopped and ports were free afterwards.

## Tests

### 1. Settings model default round-trip (save → reload → controller restart)
expected: Inline note "Desk default model saved." with no error; the saved model is still the desk default after a browser reload and after a controller restart.
result: pass
evidence: |
  Settings → Providers → model selected → "Use as desk default" produced the inline note
  "Desk default model saved." with no error text. `/api/bootstrap` returned
  `model = "alibaba-token-plan/qwen4-max-preview"` before and after a full page reload.
  Killing and restarting `npm run dev` returned the same `model` and `deskModel` from
  `~/.paddy/state.json`, proving controller-restart persistence.

### 2. Read-only Agents and Permissions sections
expected: No Save buttons; prompt/model and permission values render read-only with the explanatory notes; no "Not found" or error note.
result: pass
evidence: |
  Permissions rendered the read-only note plus five keys (edit, bash, webfetch, doom_loop,
  external_directory) with OpenCode's real `ask` values. No Save button and no
  "Not found"/error text (this exercises the restored `GET /api/config` branch, CR-01).
  Agents rendered the honest read-only note, a `textarea[readonly]`, and no Save control.

### 3. Two concurrent `npm test` invocations
expected: Both exit 0 with 20/20 script-stage and 89/89 TS-stage passes; neither run's fake binary or state file is removed by the other.
result: pass
evidence: |
  Two `npm test` invocations launched simultaneously: both exit 0, each reporting
  `tests 89 / pass 89 / fail 0` and `tests 20 / pass 20 / fail 0`; zero `✖` lines in
  either log.

### 4. Forced Settings save failure shows the error inline
expected: An inline error appears instead of the "Desk default model saved." note.
result: pass
evidence: |
  With `PATCH /api/settings` intercepted to return 500 `{"error":"forced test failure"}`,
  clicking the desk-default Save rendered the error inline ("forced test failure") and did
  NOT render the success note — the silently-positive catch is gone.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None.
