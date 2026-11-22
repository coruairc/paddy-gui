---
phase: "7"
slug: "v2-hardening-foundation"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-21"
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test + node:assert/strict (Node 22+; `--experimental-strip-types` for TS) |
| **Config file** | none — script-defined in `package.json` (`test` script) |
| **Quick run command** | `node --experimental-strip-types --test src/server/runtime.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run the touched suite(s), e.g. `node --experimental-strip-types --test src/server/security.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite green in BOTH environments (live server on 4096 + `unshare -Urn sh -c 'ip link set lo up && npm test'`), plus `npm run typecheck` and `npm run lint`
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Revised at planning (2026-11-21) to match the committed plan set: test edits are coupled to their
> semantic changes in the SAME task (RESEARCH Pitfalls 1-2), the redaction tracer leads (TRACER_MODE),
> and waves are sequential per the team single-working-tree rule. Every task carries automated verify
> (Nyquist Dimension 8) — no standalone Wave 0 is needed.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | V2-03 | T-7-01, T-7-02 | Identifier payloads byte-identical (unit + GET /api/providers route); exact secrets/keys still redacted; needle boundaries pinned | unit (tracer, red-first) | `node --experimental-strip-types --test src/server/security.test.ts src/server/api.test.ts` | ✅ (rewrite test:84-92 + new regressions in the same task as the semantic change — Pitfall 1) | ⬜ pending |
| 7-01-02 | 01 | 1 | V2-01 | T-7-05 | Spawn test hermetic via injected probe (both call sites) + three-var env scrub | unit | `node --experimental-strip-types --test src/server/runtime.test.ts` | ✅ (fix test:118-150 in place) | ⬜ pending |
| 7-02-01 | 02 | 2 | V2-02 | T-7-03 | Old state upgrades silently; deskModel round-trips; publicState exposes it, passwords stay secret | unit | `node --experimental-strip-types --test src/server/state.test.ts` | ✅ (new case in existing file) | ⬜ pending |
| 7-02-02 | 02 | 2 | V2-02 | T-7-03 | deskModel accepted via PATCH /settings; bootstrap precedence + config fallback; non-string ignored; reset clears | unit | `node --experimental-strip-types --test src/server/api.test.ts src/server/state.test.ts` | ✅ (new cases in existing file) | ⬜ pending |
| 7-03-01 | 03 | 3 | V2-02 | T-7-04 | Settings Save persists via deskModel with real error surfacing; Agents/Permissions read-only; no 404s | typecheck + lint + UAT | `npm run typecheck` + `npm run lint` + end-of-phase human-check | ✅ (no DOM tooling per project constraint; human-check embedded in task verify) | ⬜ pending |
| 7-03-02 | 03 | 3 | V2-02 | T-7-04 | Dead chain deleted end-to-end; PATCH /api/config → 404 regression guards reintroduction | unit | `node --experimental-strip-types --test src/server/api.test.ts src/server/opencode-client.test.ts` | ✅ (replace test:138-143 + delete mock:58 in the same task as route deletion — Pitfall 2) | ⬜ pending |
| 7-03-03 | 03 | 3 | V2-01, V2-02, V2-03 | T-7-05 | Full gate green with live server on 4096 AND in isolated netns; typecheck + lint green | suite | `npm test` + `unshare -Urn sh -c 'ip link set lo up && npm test'` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All gaps are new/edited cases in **existing** co-located files — no new files, no framework install.
Each gap is owned by the implementation task that changes its semantics (same-task coupling, RESEARCH
Pitfalls 1-2), so there is no standalone Wave 0 — the tracer (7-01-01) starts red-first:

- [ ] `src/server/security.test.ts` — rewrite test:84-92 to exact-match contract; add `alibaba-token-plan` regression + boundary cases — owned by 7-01-01 (V2-03)
- [ ] `src/server/api.test.ts` — identifier route round-trip (7-01-01, V2-03); deskModel round-trip/fallback/non-string/reset cases (7-02-02, V2-02); delete mock:58 + replace test:138-143 with 404 regression (7-03-02, V2-02)
- [ ] `src/server/state.test.ts` — deskModel upgrade/round-trip/publicState case (+ `writeFileSync` import) — owned by 7-02-01 (V2-02)
- [ ] `src/server/runtime.test.ts` — fix spawn test (probe injection + env scrub) — owned by 7-01-02 (V2-01)
- [ ] Manual UAT checklist: Settings model save → reload → persists; controller restart → persists; Agents/Permissions show data read-only with note; no Settings action errors — embedded as `<human-check>` in 7-03-01, harvested at end-of-phase (V2-02 UI half)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings model Save → reload → persists; controller restart → persists | V2-02 | No DOM test tooling (project constraint: no jsdom/RTL) | Save a model default in Settings, reload the browser, restart the controller, confirm the value survives |
| Agents/Permissions show data read-only with explanatory note; no Settings action 404s | V2-02 | Same | Open both sections, confirm data renders, no Save button (or disabled with note), no error notes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
