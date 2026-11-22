---
phase: 08-chat-model-picker
verified: 2026-11-22T04:40:00Z
status: passed
score: 18/18 must-haves verified
covered_files:
  [
    ".planning/phases/08-chat-model-picker/08-01-PLAN.md",
    ".planning/phases/08-chat-model-picker/08-01-SUMMARY.md",
    ".planning/phases/08-chat-model-picker/08-02-PLAN.md",
    ".planning/phases/08-chat-model-picker/08-02-SUMMARY.md",
    ".planning/phases/08-chat-model-picker/08-03-PLAN.md",
    ".planning/phases/08-chat-model-picker/08-03-SUMMARY.md",
    ".planning/phases/08-chat-model-picker/08-CONTEXT.md",
    ".planning/phases/08-chat-model-picker/08-RESEARCH.md",
    ".planning/phases/08-chat-model-picker/08-UI-SPEC.md",
    "src/components/desk/app.tsx",
    "src/components/desk/model-picker.tsx",
    "src/components/desk/models.ts",
    "src/lib/desk/client.ts",
    "src/server/api.ts",
    "src/server/normalize.ts",
    "src/server/opencode-client.ts"
  ]
covered_digest: "v4:sha256:5999e8c4d7112fa9aa9063dbf98a9ef3c6b7a14e62355dcb967fb1ba1d97b76d"
behavior_unverified: 0
overrides_applied: 0
---

# Phase 8: Chat Model Picker Verification Report

**Phase Goal:** Users can see and switch the model that will run their session, right from the chat UI — grouped by provider, keyboard-driven, informed by metadata — and trust that what the header shows is what actually runs.

**Verified:** 2026-11-22
**Status:** passed

## Goal Achievement

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| 1 | Picker opens from the chat header, models grouped by provider, live filtering, full keyboard, always-visible active model | ✓ VERIFIED | `ModelPicker` rendered as the first header-right child when a project is selected; live UAT saw 5 provider groups / 160 options, filter input focused, Arrow/Home/End/Enter/Esc/Tab handling, `aria-activedescendant`, 30s cache. |
| 2 | Selecting sets the desk default, next send runs on it, persists across reloads, resume seeds from the session's own model | ✓ VERIFIED | `PATCH /api/settings { deskModel }` persists; `/api/bootstrap` returns it; `modelForSend` applies the effective key on send; `summarizeSession` projects `Session.Info.model` and `openSession` seeds it without writing state. UAT confirmed persistence across reload. |
| 3 | Header reconciles on `session.model.selected` and resume; a failed switch aborts the send | ✓ VERIFIED | `normalizeEvent` maps the live frames to one additive variant; `resolveHeaderModel` gates on the active session; `resolveActiveSource` keeps session truth; `sendMessage` test proves `/prompt` is never issued after a 400 model switch. |
| 4 | Picker surfaces status, context window, release date | ✓ VERIFIED | Projection carries `status`/`context`/`released`; rows render them with unknown fallbacks and status badges; route test pins the fields. |

## Must-have truths (from the three plans)

| Truth | Status | Evidence |
|---|---|---|
| `/api/models` flat projected catalog + one default, 200 empty while disconnected | ✓ | `api.test.ts#model catalog projects…`, `#…degrades…` |
| Browser entry carries only ten whitelisted fields | ✓ | `api.test.ts` key-set assertion; forbidden-key scan |
| Keys are `providerID/<entry id>` and survive redaction byte-identically | ✓ | project→redact→assemble in `api.ts`; `#model keys and default survive redaction…` |
| First-slash key parse; duplicate modelID tiers distinct | ✓ | `models.test.ts#parseModelKey…`, `#duplicate modelID…` |
| A pick updates the header and persists via `deskModel`; failed write is an inline note | ✓ | Live UAT; `chooseModel` catch writes `modelNote`, not the global error |
| Loaded catalog lacking the persisted key → header shows and sends the default; pre-load leaves it | ✓ | `resolveActiveModel` + `modelForSend` tests; `catalogLoaded` gate |
| Grouping/filtering/labels/slug/stale resolution are pure and tested | ✓ | `models.test.ts` 17/17 |
| APG combobox keyboard map, focus lifecycle, outside pointer-down | ✓ | Live UAT (focus, Arrow, Enter, Esc, focus restore); implementation per UI-SPEC §8.7–8.9 |
| Rows show name + status · context · release with badges; deprecated muted | ✓ | `OptionRow`; `formatTokens`; live render |
| Trigger always shows effective model, enabled, `Choose model`, stale icon only after load | ✓ | Live UAT stale and offline checks |
| Deterministic state precedence; cached reopen renders list; Retry keeps error | ✓ | Live UAT error/offline/empty/no-match; `loadModels` finally/cache |
| One listbox; no-match keeps search mounted | ✓ | UAT `listboxCount: 1`, `popupHasRole: null`, `searchMounted: true` |
| `session.model.selected` normalizes; partial payloads dropped | ✓ | `normalize.test.ts` two tests |
| Only the active session moves the header | ✓ | `resolveHeaderModel` positive + negatives |
| Session-sourced model never replaced by catalog fallback | ✓ | `resolveActiveSource` test |
| Resume seeds from the session model and ignores variant | ✓ | `summarizeSession` tests; `openSession` seeding |
| Project switch no longer re-reads config/setModel | ✓ | Grep gates return 0 |
| Malformed event payloads dropped | ✓ | `normalize.test.ts#partial model-selected payloads are dropped` |

**Score:** 18/18 verified (0 present-but-unverified).

## Test evidence

- `npm test` — 20/20 script stage, 98/98 TS stage.
- `node --experimental-strip-types --test src/components/desk/models.test.ts` — 17/17.
- `npm run typecheck` — exit 0.
- `npm run lint` — 0 errors, 5 pre-existing warnings.
- Both-environment gate (live 4096 and `unshare -Urn` netns) remains green from Phase 7; no test-path changes were introduced this phase.

## Requirement traceability

| Requirement | Status | Plans |
|---|---|---|
| MODEL-01 | Complete | 08-01, 08-02 |
| MODEL-02 | Complete | 08-01, 08-02, 08-03 |
| MODEL-03 | Complete | 08-01, 08-02 |

## Human verification

All browser-observable behavior was exercised live and is recorded in `08-UAT.md`. Two cross-process properties (two-tab agreement after an external switch; live resume of a session whose model differs) are explicitly deferred to Phase 10's end-to-end verification, which is scoped to them (VER-05/VER-06).

## Gaps Summary

No gaps.

---

_Verified: 2026-11-22_
_Verifier: the agent_


## Re-verification at HEAD (2026-11-22)

Phase 9 extended the same shared files (`app.tsx`, `normalize.ts`, `api.ts`, `client.ts`). Re-ran the `npm test` suite (20/20 + 110/110(the `test` script as it stood then; it did not yet run `models.test.ts`/`commands.test.ts`, 22 more tests wired in later by e30da3f), the model-picker UAT-relevant tests, typecheck, and lint at HEAD: all green; the Phase 8 must-haves remain covered. `covered_digest` refreshed for the same covered set.
