---
phase: 01-controller-auth-hardening
verified: 2026-11-21T18:30:00Z
status: passed
score: 5/5 must-haves verified
covered_files:
  - .planning/phases/01-controller-auth-hardening/01-01-PLAN.md
  - .planning/phases/01-controller-auth-hardening/01-01-SUMMARY.md
  - package.json
  - src/server/http.test.ts
  - src/server/http.ts
  - src/server/security.test.ts
  - src/server/security.ts
covered_digest: "v4:sha256:1f4531c12d9d4f2317f2d2289dcb3bdd62ac687f5da3e370b3c945cfd2223fc5"
behavior_unverified: 0
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Reformat Phase 1 goal into a User Story"
    expected: "ROADMAP.md Phase 1 goal reads 'As a [role], I want to [capability], so that [outcome].' so MVP-mode verification can produce a User Flow Coverage section"
    why_human: "Phase 1 has mode: mvp but its goal is a capability statement, not a User Story; gsd_run query user-story.validate returns valid=false. Run /gsd-mvp-phase 1 to set a proper goal, then re-run verification."
  - test: "Same-origin browser desk smoke"
    expected: "With a loopback bind and no token, opening the desk in a browser loads the project list and a sent message streams back normally; with a cross-origin Origin the request is rejected but the desk itself still works same-origin"
    why_human: "Automated http.test.ts covers status codes, but the full browser load + chat loop on a real bind is a runtime/UAT check not exercised by node:test."
---

# Phase 1: Controller Auth Hardening — Verification Report

**Phase Goal:** The controller can be exposed beyond loopback without a token bypass — auth no longer depends on the socket peer or the `Host` header alone.
**Verified:** 2026-11-21
**Status:** human_needed
**Re-verification:** No — initial verification

## MVP Mode Discrepancy (BLOCKING for MVP-mode User Flow Coverage)

Phase 1 has `**Mode:** mvp` in ROADMAP.md, but its goal is **not** in User Story format.
`gsd_run query user-story.validate` returns `valid: false` with:

- Story must start with "As a [user role]," (role must be non-empty).
- Story must include ", I want to [capability]," (capability must be non-empty).
- Story must include ", so that [outcome]." (outcome must be non-empty).

Per `verify-mvp-mode.md`, the verifier refuses to fabricate a "User Flow Coverage" section against a non-User-Story goal. **No `## User Flow Coverage` section is produced.** Technical checks below still run against the ROADMAP success criteria (the phase contract).

**Action required:** run `/gsd-mvp-phase 1` to set a proper User Story goal, then re-run verification. This is recorded as a human-verification item above; it does not invalidate the technical results below.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On a non-loopback bind, every `/api` route refuses an anonymous request regardless of `Host` (SEC-01) | ✓ VERIFIED | `authorizePeer`: `bindLoopback && hostLoopback && …`; non-loopback bind never trusted; `http.test.ts` "non-loopback bind requires a token" → 401 without token, 200 with Bearer |
| 2 | Loopback peer carrying `Host: evil.example` with matching Origin is rejected; DNS-rebinding no longer authenticates (SEC-02) | ✓ VERIFIED | `isLoopbackHost` requires loopback host; `security.test.ts` "DNS rebinding is rejected for loopback peers"; `http.test.ts` "DNS rebinding is rejected" → 401 |
| 3 | Cross-origin `Origin`/`Referer` rejected with 403; same-origin desk keeps loading (SEC-03) | ✓ VERIFIED (automated) | `originAllowed(origin, host, referer)` checks Origin then Referer; origin check runs first in `handleNode` → 403; `http.test.ts` cross-origin Origin & Referer → 403, same-origin → 200. Full browser loop = human item |
| 4 | With valid token a LAN client reaches the API; path allowlist and redaction unchanged (SEC-04) | ✓ VERIFIED | `http.test.ts` Bearer → 200 on `/api/projects`; `security.test.ts` "invalid workspaces never pass the allowlist", "secrets are stripped…" still green |
| 5 | `npm test` contains a test that fails if the loopback/`Host` bypass is reintroduced | ✓ VERIFIED | `src/server/security.test.ts` + `src/server/http.test.ts` registered in `package.json` test script; 48 tests pass |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/security.ts` | `authorizePeer` keyed on bindHost + loopback Host; `isLoopbackHost`; `timingSafeEqual`; `originAllowed` with Referer | ✓ VERIFIED | All present; `timingSafeEqual` imported from `node:crypto`; `isLoopbackHost` exported; `bindHost`/`referer` wired |
| `src/server/http.ts` | Origin check first (403), `authorizePeer` with bindHost, constant-time cookie exchange, Host-validated container shortcut | ✓ VERIFIED | Origin check at lines 19-23 before auth; `localOnly` Host-validated at line 33; `timingSafeEqual` at line 43; cookie attrs `HttpOnly; SameSite=Strict; Path=/` |
| `src/server/http.test.ts` | socket-level auth gating, DNS rebinding, cross-origin, cookie exchange | ✓ VERIFIED | File exists; covers 401/403/200; DNS rebinding `Host: evil.example`; Referer cross-origin; cookie attrs |
| `src/server/security.test.ts` | updated auth contract incl. DNS rebinding, non-loopback bind, Referer | ✓ VERIFIED | DNS rebinding, non-loopback bind (bindHost 0.0.0.0), container shortcut host, Referer cases present |
| `package.json` | test script includes `src/server/http.test.ts` | ✓ VERIFIED | Present immediately after `security.test.ts` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/server/http.ts` | `src/server/security.ts` | `authorizePeer`, `originAllowed`, `isLoopbackAddress`, `isLoopbackHost` | ✓ WIRED | Imported at line 9 and all four used |
| `package.json` | `src/server/http.test.ts` | test script enumeration | ✓ WIRED | Entry present in `test` script |

### Data-Flow Trace (Level 4)

N/A — phase touches no rendering/dynamic-data artifacts; all changes are in the controller auth boundary.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npm test` | 48 tests, 0 fail | ✓ PASS |
| Typecheck | `npm run typecheck` | exit 0, no errors | ✓ PASS |
| Lint (phase files) | `npm run lint` | no errors in `security.ts`/`http.ts`/tests; 2 pre-existing errors elsewhere (bin/paddy.mjs, api.ts) — out of phase scope (Phase 4) | ✓ PASS (phase scope) |
| Security unit suite | `node --experimental-strip-types --test src/server/security.test.ts` | pass | ✓ PASS |
| HTTP adapter suite | `node --experimental-strip-types --test src/server/http.test.ts` | pass | ✓ PASS |

### Anti-Patterns Found

None in phase-modified files. `return null` occurrences in `security.ts`/`http.ts` are legitimate null-returning helpers (`bearerToken`, `header`, `cookie`), not stubs.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEC-01 | 01-01 | Non-loopback bind requires valid token on every `/api` route | ✓ SATISFIED | `authorizePeer` no anonymous trust on non-loopback bind; http.test 401/200 |
| SEC-02 | 01-01 | Host naming non-bound host not treated as local | ✓ SATISFIED | `isLoopbackHost` + DNS rebinding tests |
| SEC-03 | 01-01 | Cross-origin Origin/Referer rejected | ✓ SATISFIED | `originAllowed` + 403 tests |
| SEC-04 | 01-01 | Path allowlist + redaction unchanged | ✓ SATISFIED | `validateWorkspacePath`/`redactSecrets` untouched; tests green |

### Human Verification Required

1. **Reformat Phase 1 goal into a User Story**
   - **Test:** Run `/gsd-mvp-phase 1` and set a goal like "As an operator exposing Paddy beyond loopback, I want the controller to require a token on every API route, so that no anonymous or cross-origin request can bypass auth."
   - **Expected:** ROADMAP.md Phase 1 goal validates via `gsd_run query user-story.validate` (valid=true); re-run verification to produce the User Flow Coverage section.
   - **Why human:** Phase mode is mvp but the goal is a capability statement; only a human can author the user story.

2. **Same-origin browser desk smoke**
   - **Test:** Bind on loopback with no token; open the desk in a browser; load project list; send a message and confirm it streams back; then confirm a cross-origin Origin is rejected while same-origin keeps working.
   - **Expected:** Desk loads and chats normally on same-origin; cross-origin request returns 403.
   - **Why human:** node:test cannot exercise a real browser/transport loop.

### Gaps Summary

No technical gaps. All 5 must-haves verified, SEC-01..SEC-04 satisfied, full suite green (48 tests), typecheck clean. The only open item is the MVP-mode goal-format discrepancy (human action) and the browser smoke (human UAT).

---

_Verified: 2026-11-21_
_Verifier: the agent (gsd-verifier)_