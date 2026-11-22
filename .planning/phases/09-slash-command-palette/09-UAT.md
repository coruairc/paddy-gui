---
status: passed
phase: 09-slash-command-palette
source: [09-VERIFICATION.md]
started: 2026-11-22T06:20:00Z
updated: 2026-11-22T06:50:00Z
---

# Phase 9 UAT — Slash Command Palette

Playwright against `npm run dev` + a locally started `opencode serve` v2.3.2, with the Paddy repo as the active project and temporary command files under `.opencode/command/` (removed afterwards). Servers stopped; ports free.

## Tests

### 1. Leading `/` opens the server-sourced palette
expected: Palette opens above the composer with the full command catalog; the composer is the combobox.
result: pass
evidence: `#command-palette` visible with `data-command-palette-state="list"`, 85 options, exactly one `role="listbox"`, composer `role="combobox"`.

### 2. Filter and keyboard navigation
expected: Filtering narrows the list; ArrowDown sets `aria-activedescendant`; Escape closes and keeps the draft.
result: pass
evidence: `/echo-test` narrowed to 1 option; ArrowDown set `command-option-echo-test`; Escape closed the palette with the draft still `/echo-test`.

### 3. Dispatch and expanded echo
expected: Enter runs `/echo-test hello world`; the thread shows exactly one user bubble with the server's expanded text.
result: pass
evidence: one user bubble: `Repeat exactly the following arguments and nothing else: hello world`; no duplicate; the local echo was replaced.

### 4. Unknown command surfaces in-thread
expected: A persistent system message with the server text; the draft survives; never a prompt.
result: pass
evidence: system message `Command not found: does-not-exist` appeared in the thread and the draft was restored.

### 5. `command.updated` refreshes without reload
expected: Adding a command file while the desk is open makes it appear in the palette.
result: pass
evidence: wrote `.opencode/command/hot-added.md` while the page was open; `hot-added` appeared in the option list without a reload.

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None.
