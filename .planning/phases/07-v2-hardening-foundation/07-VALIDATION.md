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
- **After every plan wave:** Run `flock -w 900 /tmp/team-build.lock npm test`
- **Before `/gsd-verify-work`:** Full suite green in BOTH environments (live server on 4096 + `unshare -Urn sh -c 'ip link set lo up && npm test'`), plus `npm run typecheck` and `npm run lint`
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 0 | V2-03 | T-7-01 | Identifier payloads byte-identical; exact secrets still redacted | unit | `node --experimental-strip-types --test src/server/security.test.ts` | ✅ (rewrite test:84-92 + new regression) | ⬜ pending |
| 7-01-02 | 01 | 0 | V2-02 | T-7-04 | PATCH /api/config → 404; deskModel round-trip; identifier route round-trip | unit | `node --experimental-strip-types --test src/server/api.test.ts` | ✅ (replace test:138-143, add cases) | ⬜ pending |
| 7-01-03 | 01 | 0 | V2-02 | — | Old state upgrades silently; deskModel persists; publicState exposes it | unit | `node --experimental-strip-types --test src/server/state.test.ts` | ✅ (new cases) | ⬜ pending |
| 7-02-01 | 02 | 1 | V2-01 | T-7-05 | Spawn test hermetic via injected probe + env scrub | unit | `node --experimental-strip-types --test src/server/runtime.test.ts` | ✅ (fix test:118-150) | ⬜ pending |
| 7-02-02 | 02 | 1 | V2-02 | T-7-04 | Dead chain deleted; Settings read-only sections typecheck | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 7-03-01 | 03 | 2 | V2-01 | T-7-05 | Full gate green with live server AND in isolated netns | suite | `flock -w 900 /tmp/team-build.lock npm test` + `unshare -Urn sh -c 'ip link set lo up && npm test'` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All gaps are new/edited cases in **existing** co-located files — no new files, no framework install:

- [ ] `src/server/runtime.test.ts` — fix spawn test (probe injection + env scrub) — covers V2-01
- [ ] `src/server/security.test.ts` — rewrite test:84-92 to exact-match contract; add `alibaba-token-plan` regression — covers V2-03
- [ ] `src/server/api.test.ts` — delete mock:58 + test:138-143; add 404 regression, deskModel round-trip, identifier route round-trip — covers V2-02/V2-03
- [ ] `src/server/state.test.ts` — deskModel upgrade/round-trip/publicState case — covers V2-02

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
