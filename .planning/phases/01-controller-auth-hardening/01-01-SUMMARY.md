---
phase: 01-controller-auth-hardening
plan: 01
subsystem: auth
tags: [security, auth, dns-rebinding, origin, timing-safe, controller]

requires: []
provides:
  - "authorizePeer keyed on bindHost + loopback Host header"
  - "isLoopbackHost helper"
  - "originAllowed extended with Referer"
  - "timingSafeEqual token comparison"
  - "socket-level http adapter coverage"
affects: [controller-auth, security]

actuals:
  tokens: 4874
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "locality keyed on bind host + Host header"
    - "origin + referer same-origin check before auth"
    - "constant-time token compare"

key-files:
  created:
    - src/server/http.test.ts
  modified:
    - src/server/security.ts
    - src/server/http.ts
    - src/server/security.test.ts
    - package.json

key-decisions:
  - "Anonymous trust requires loopback bind AND loopback Host header; socket peer alone never grants trust"
  - "Non-loopback bind never grants anonymous access"
  - "Origin check runs before auth and returns 403 for cross-origin"
  - "Referer validated when Origin absent; both absent allowed for non-browser clients"
  - "Token comparison uses timingSafeEqual with length check"
  - "Container shortcut now Host-validated"

patterns-established:
  - "authorizePeer signature: (remoteAddress, host, bindHost, authorization, token, localOnly)"
  - "originAllowed signature: (origin, host, referer?)"

requirements-completed: [SEC-01, SEC-02, SEC-03, SEC-04]

coverage:
  - id: D1
    description: "Non-loopback bind requires a valid token on every /api route"
    requirement: SEC-01
    verification:
      - kind: unit
        ref: "src/server/http.test.ts#non-loopback bind requires a token"
        status: pass
    human_judgment: false
  - id: D2
    description: "DNS rebinding Host header no longer grants locality"
    requirement: SEC-02
    verification:
      - kind: unit
        ref: "src/server/security.test.ts#DNS rebinding is rejected for loopback peers"
        status: pass
      - kind: unit
        ref: "src/server/http.test.ts#DNS rebinding is rejected"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cross-origin Origin/Referer rejected with 403"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "src/server/http.test.ts#cross-origin via Origin is rejected"
        status: pass
      - kind: unit
        ref: "src/server/http.test.ts#cross-origin via Referer is rejected"
        status: pass
    human_judgment: false
  - id: D4
    description: "Path allowlist and redaction unchanged"
    requirement: SEC-04
    verification:
      - kind: unit
        ref: "src/server/security.test.ts#invalid workspaces never pass the allowlist"
        status: pass
      - kind: unit
        ref: "src/server/security.test.ts#secrets are stripped from objects and strings"
        status: pass
    human_judgment: false

metrics:
  duration: 20min
  completed: 2026-11-21
  status: complete
plan_head_before: cea1e657b3c09f28d5239b73a7003706dec556c0
plan_head_after: ef45d104f6abd0f3ac34f1ccaf8863b164a22f1f
---

# Phase 1 Plan 1: Controller Auth Hardening Summary

**Closed the controller auth bypass: locality now requires a loopback bind AND a loopback Host header, cross-origin Origin/Referer is rejected with 403 before auth, and token comparison uses timingSafeEqual.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-11-21T00:00:00Z
- **Completed:** 2026-11-21T00:20:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `authorizePeer` now grants anonymous trust only when `bindLoopback && hostLoopback && (peerLoopback || localOnly)`; non-loopback bind never anonymous.
- Added `isLoopbackHost` parsing Host header (port, IPv6 brackets, ::ffff:).
- `originAllowed` validates Origin then Referer, same-origin only, both absent allowed.
- `http.ts` runs origin check first (403), passes bindHost/host to authorizePeer, Host-validates container shortcut, uses timingSafeEqual for cookie exchange.
- Added `src/server/http.test.ts` socket-level coverage; registered in test suite.
- Full suite green (48 tests).

## Task Commits

1. **Task 1: Close the loopback/Host auth bypass** - `d9fdccc` (feat)
2. **Task 2: Add socket-level http adapter coverage** - `949ce07` (test)
3. **Task 3: Register the new test file** - `ef45d10` (chore)

## Files Created/Modified

- `src/server/security.ts` - authorizePeer rewrite, isLoopbackHost, originAllowed with Referer, timingSafeEqual
- `src/server/http.ts` - origin-first wiring, bindHost, Host-validated shortcut, constant-time cookie exchange
- `src/server/security.test.ts` - updated auth contract, DNS rebinding, non-loopback bind, Referer cases
- `src/server/http.test.ts` - socket-level auth gating coverage
- `package.json` - test script entry

## Decisions Made

- Followed locked decisions D-01..D-17 from CONTEXT.md.
- Empty host returns false in originAllowed (research pattern).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- Auth hardening complete; path allowlist and redaction unchanged (SEC-04).

## Self-Check: PASSED

---
*Phase: 01-controller-auth-hardening*
*Completed: 2026-11-21*