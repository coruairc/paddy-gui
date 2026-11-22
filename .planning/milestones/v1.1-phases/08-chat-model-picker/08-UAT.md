---
status: passed
phase: 08-chat-model-picker
source: [08-VERIFICATION.md]
started: 2026-11-22T04:10:00Z
updated: 2026-11-22T04:35:00Z
audit_acknowledged:
  milestone: v1.1
  at: 2026-11-22
  gap_snapshot: "passed::scenarios=0"
---

# Phase 8 UAT — Chat Model Picker

Executed with Playwright (chromium headless-shell) against `npm run dev` plus a locally started `opencode serve` v2.3.2 on `127.0.0.1:4096`, with the Paddy repo registered as the active project. Servers were stopped and ports were free afterwards.

## Tests

### 1. Picker opens from the header and lists the real catalog grouped by provider
expected: Trigger shows the active model; clicking opens a listbox with provider groups and model rows.
result: pass
evidence: |
  `[data-model-picker-trigger]` rendered with label `alibaba-token-plan/qwen4-max-preview`.
  Opening produced `data-model-picker-state="list"`, exactly one `role="listbox"`, 160 options
  across 5 provider groups, and the popup shell had no role.

### 2. Live filtering, keyboard navigation, and selection
expected: Filter input owns focus, typing filters, ArrowDown sets `aria-activedescendant`, Enter applies, Escape closes and restores trigger focus.
result: pass
evidence: |
  `filterFocused: true`; filtering "gemini" reduced the list to 10 options; ArrowDown set
  `aria-activedescendant` to an existing option id; Enter selected
  `alibaba-token-plan-cn/deepseek-v4.1-flash`, closed the popup, changed the trigger label to
  "DeepSeek V4.1 Flash", and persisted `deskModel` to the same key. Escape closed the popup with
  focus back on the trigger.

### 3. Persistence across reload
expected: After a pick, the saved desk default is what `/api/bootstrap` returns and the header still reflects it after reload.
result: pass
evidence: |
  `/api/bootstrap` returned `deskModel = "alibaba-token-plan-cn/deepseek-v4.1-flash"` after the
  pick and after a full reload; the trigger label matched.

### 4. Stale persisted key
expected: A persisted key absent from the catalog falls back to OpenCode's default, with a warn icon, `aria-describedby`, and a stale banner.
result: pass
evidence: |
  With `deskModel = "openai/does-not-exist"`, the trigger had `aria-describedby="model-picker-stale"`,
  a warn icon, and the popup showed the "is not in this catalog" banner.

### 5. Offline, error, empty, and no-match panels
expected: Each state renders an explicit panel with the contracted copy and a working action.
result: pass
evidence: |
  Disconnect while open → state `offline`, "OpenCode is offline". Forced 500 on `/api/models` →
  state `error`, "Could not load models", Retry button. Forced empty catalog → state `empty`,
  "No models available". Query "zzzzzzzz" → state `no-match`, "No models match", search input
  still mounted; Clear filter restored the list and refocused the input.

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Deferred to Phase 10

- Cross-process two-tab agreement after an external (TUI) model switch.
- Resume of a session whose stored model differs from the desk default, observed live.

## Gaps

None.
