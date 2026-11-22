---
phase: "8"
slug: "chat-model-picker"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-22"
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test + node:assert/strict (Node 22+; `--experimental-strip-types` for TS) |
| **Config file** | none — script-defined in `package.json` (`test` script). **`package.json` is LOCKED this phase**, so `src/components/desk/models.test.ts` is invoked explicitly, never registered in the script. |
| **Quick run command** | `node --experimental-strip-types --test src/components/desk/models.test.ts` (or the touched server suite) |
| **Full suite command** | `npm test` + `node --experimental-strip-types --test src/components/desk/models.test.ts` |
| **Estimated runtime** | ~35 seconds |

---

## Sampling Rate

- **After every task commit:** Run the task's touched suite(s) — `node --experimental-strip-types --test <file>` (< 5s each)
- **After every plan wave:** `npm test` + `node --experimental-strip-types --test src/components/desk/models.test.ts` + `npm run typecheck` + `npm run lint`
- **Before `/gsd-verify-work`:** Full suite green, plus a live-desk UAT of the picker (keyboard, focus, stale/empty/offline states) since the repo bans jsdom/RTL
- **Max feedback latency:** 35 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | MODEL-01, MODEL-02, MODEL-03 | T-8-01..04, T-8-SC | End-to-end one path: open popup → `listModels`/`GET /api/models` → `api.models()` → pick → header label + persisted `deskModel`; projection whitelist; degraded empty; abort-before-`/prompt` | unit (tracer) + typecheck | `npm run typecheck && node --experimental-strip-types --test src/server/opencode-client.test.ts src/server/api.test.ts` | ✅ extend existing suites | ⬜ pending |
| 8-01-02 | 01 | 1 | MODEL-01, MODEL-03 | T-8-01, T-8-02 | Pure grouping/filter/label/key math (first-slash key, duplicate-modelID distinctness, stale resolution) | unit (pure, red-first) | `node --experimental-strip-types --test src/components/desk/models.test.ts && npm run typecheck` | ❌ new file — invoked explicitly (manifest locked) | ⬜ pending |
| 8-01-03 | 01 | 1 | MODEL-01, MODEL-02, MODEL-03 | T-8-02, T-8-03 | Redaction round-trip preserves `key`; null fields degrade; failed model POST aborts send | unit | `node --experimental-strip-types --test src/server/api.test.ts src/server/opencode-client.test.ts && npm test` | ✅ | ⬜ pending |
| 8-02-01 | 02 | 2 | MODEL-01, MODEL-02, MODEL-03 | T-8-05, T-8-06, T-8-SC | Keyboard-only path: search → filter → Arrow → Enter applies; `aria-activedescendant`; focus lifecycle; outside pointer-down | unit (pure) + typecheck + lint | `node --experimental-strip-types --test src/components/desk/models.test.ts && npm run typecheck && npm run lint` | ✅ models.test.ts (from 08-01) | ⬜ pending |
| 8-02-02 | 02 | 2 | MODEL-01, MODEL-03 | T-8-05, T-8-SC | Metadata rows (status · context · release), status badges, active/default markers | unit (pure) + typecheck + lint | `npm run typecheck && npm run lint && node --experimental-strip-types --test src/components/desk/models.test.ts` | ✅ | ⬜ pending |
| 8-02-03 | 02 | 2 | MODEL-01, MODEL-02, MODEL-03 | T-8-06, T-8-07, T-8-SC | Exclusive state precedence (offline > error > first-load loading > empty/no-match > list), retry, cache lifecycle, announcements | unit + suite | `npm run typecheck && npm run lint && npm test` | ✅ | ⬜ pending |
| 8-03-01 | 03 | 3 | MODEL-02 | T-8-08, T-8-09, T-8-SC | Raw `session.model.selected` → normalized `model-selected`; active-session-only application | unit (live frames) + typecheck | `node --experimental-strip-types --test src/server/normalize.test.ts && npm run typecheck` | ✅ | ⬜ pending |
| 8-03-02 | 03 | 3 | MODEL-02 | T-8-08, T-8-SC | Resume seeds from `Session.Info.model` (providerID/id, ignores variant) | unit + suite | `node --experimental-strip-types --test src/server/normalize.test.ts && npm run typecheck && npm test` | ✅ | ⬜ pending |
| 8-03-03 | 03 | 3 | MODEL-02 | T-8-09, T-8-10, T-8-SC | Project-switch guard removal; phase gate green | gate | `npm test && npm run typecheck && npm run lint && node --experimental-strip-types --test src/components/desk/models.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All server gaps are new cases in **existing** co-located suites. One new pure module/suite is created in Wave 1 and invoked explicitly because the manifest is locked:

- [ ] `src/components/desk/models.ts` + `models.test.ts` — pure helpers (grouping, filter, key parse, stale resolution, reducer helpers) — owned by 8-01-02 (MODEL-01/02/03)
- [ ] `src/server/api.test.ts` — `/api/models` projection, redaction round-trip, degrade-to-empty — owned by 8-01-01/03
- [ ] `src/server/opencode-client.test.ts` — `listModels()` URL/`location[directory]`/`{data}` unwrap + abort-before-`/prompt` — owned by 8-01-01/03
- [ ] `src/server/normalize.test.ts` — `model-selected` normalization + resume seed — owned by 8-03-01/02
- [ ] `package.json` **must not change**; `models.test.ts` is an explicit command in every verify that needs it
- [ ] Manual UAT checklist: header trigger opens the picker; grouping/filter/keyboard/Enter/Escape/Tab; focus returns to trigger; empty/offline/error/stale states; save persists across reload — harvested at end-of-phase

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Keyboard path and focus lifecycle with a screen reader | MODEL-01 | Repo bans component-render tooling (no jsdom/RTL); ARIA behavior needs a real browser | Tab to the trigger, open with Enter/Space/ArrowDown, type to filter, Arrow/Home/End, Enter applies, Escape closes and returns focus, Tab closes to trigger |
| Popup visual states and metadata legibility | MODEL-03 | Visual honesty in both themes | Open the picker on a live desk in dark and light themes; confirm two-line metadata, status badges, active/default markers, and the stale/empty/offline/error panels |
| Picked model actually runs; two tabs agree | MODEL-02 (VER-05/06) | Cross-process/live behavior | Pick a model, send a message, confirm the OpenCode session model; switch externally and confirm both tabs reconcile — deferred to Phase 10 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 35s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
