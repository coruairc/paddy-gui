---
phase: "9"
slug: "slash-command-palette"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-22"
---

# Phase 9 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | node:test + node:assert/strict (`--experimental-strip-types`) |
| Config file | none — `package.json` test script is LOCKED; new suites invoked explicitly |
| Quick run command | `node --experimental-strip-types --test src/components/desk/commands.test.ts` |
| Full suite command | `npm test` + `node --experimental-strip-types --test src/components/desk/commands.test.ts` |
| Estimated runtime | ~35 seconds |

## Sampling Rate

- **After every task commit:** touched suite(s)
- **After every plan wave:** `npm test` + commands suite + `npm run typecheck` + `npm run lint`
- **Before `/gsd-verify-work`:** full suite green plus a live-desk UAT (palette, dispatch, error, invalidation)
- **Max feedback latency:** 35 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Automated Command | Status |
|---|---|---|---|---|---|
| 9-01-01 | 01 | 1 | CMD-01, CMD-02 | `npm run typecheck && node --experimental-strip-types --test src/server/api.test.ts src/server/opencode-client.test.ts` | ⬜ pending |
| 9-01-02 | 01 | 1 | CMD-01 | `node --experimental-strip-types --test src/components/desk/commands.test.ts && npm run typecheck` | ⬜ pending |
| 9-01-03 | 01 | 1 | CMD-02 | `node --experimental-strip-types --test src/server/api.test.ts src/server/opencode-client.test.ts && npm test` | ⬜ pending |
| 9-02-01 | 02 | 2 | CMD-03 | `node --experimental-strip-types --test src/server/normalize.test.ts && npm run typecheck` | ⬜ pending |
| 9-02-02 | 02 | 2 | CMD-02 | `node --experimental-strip-types --test src/server/normalize.test.ts src/components/desk/messages.test.ts && npm run typecheck && npm test` | ⬜ pending |
| 9-02-03 | 02 | 2 | CMD-01/02/03 | `npm test && npm run typecheck && npm run lint && node --experimental-strip-types --test src/components/desk/commands.test.ts` | ⬜ pending |

## Wave 0 Requirements

- `src/components/desk/commands.ts` + `commands.test.ts` (new; explicit invocation)
- Extend `src/server/api.test.ts`, `src/server/opencode-client.test.ts`, `src/server/normalize.test.ts`, `src/components/desk/messages.test.ts`
- `package.json` must not change

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Palette keyboard/focus and state panels | CMD-01 | No jsdom/RTL | Live desk: `/` open, filter, Arrow/Home/End, Tab, Enter, Esc, offline/empty/error/no-match |
| Command edit reflects without reload | CMD-03 | Cross-process watcher | Edit `.opencode/command/*.md` while the desk is open; reopen the palette |
| Expanded message replaces the echo | CMD-02 | Live SSE sequence | Run `/echo hello`; confirm one bubble with the expanded text |

## Validation Sign-Off

- [ ] All tasks have automated verify
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
