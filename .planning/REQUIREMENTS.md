# Requirements: Paddy

**Defined:** 2026-11-03
**Core Value:** A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.

## v1 Requirements

Requirements for this milestone. Each maps to exactly one roadmap phase.

### Security

- [ ] **SEC-01**: User on a non-loopback bind must present a valid token to reach any `/api` route, regardless of the `Host` header
- [ ] **SEC-02**: A request whose `Host` header names a host other than the bound address is not treated as local
- [ ] **SEC-03**: Requests carrying a cross-origin `Origin` or `Referer` are rejected by the controller
- [ ] **SEC-04**: Path allowlist and redaction still apply after the auth changes — no regression in `src/server/security.ts`

### Packaging

- [ ] **PKG-01**: A container started from the image or `docker-compose.yml` persists state across restarts at the documented path
- [ ] **PKG-02**: `install.sh` verifies the checksum of any downloaded Node tarball and aborts on mismatch
- [ ] **PKG-03**: `install.sh` installs a working `paddy` command on `PATH` from a clean checkout
- [ ] **PKG-04**: `install.ps1` installs a working `paddy` command on `PATH` on Windows

### Core Loop

- [ ] **LOOP-01**: A sent message appears exactly once in the thread, reconciled with the server echo
- [ ] **LOOP-02**: Settings → Connection "Save" preserves an already-stored password when the field is left blank
- [ ] **LOOP-03**: Exiting Paddy terminates the spawned `opencode serve` child, leaving no orphan process
- [ ] **LOOP-04**: Stop, retry, and session resume still work after the loop fixes
- [ ] **LOOP-05**: Permission prompts can be allowed or denied inline and the run continues or aborts accordingly

### Quality

- [ ] **QUAL-01**: `npm run lint` passes on a clean checkout
- [ ] **QUAL-02**: CI runs lint and the full test suite on push and pull request
- [ ] **QUAL-03**: `npm test` executes every test file in the repo, including the `scripts/*.test.mjs` suites
- [ ] **QUAL-04**: The stale committed test is fixed or removed; the suite is green

### Cleanup

- [ ] **CLN-01**: App-builder template scaffolding is removed and the build no longer references it
- [ ] **CLN-02**: `SELFHOST.md` and `selfhost.env.example` describe only shipped behavior, or are deleted
- [ ] **CLN-03**: Unused heavy dependencies are removed without breaking build, lint, or tests
- [ ] **CLN-04**: `README.md` install and run instructions match what the code actually does

### Verification

- [ ] **VER-01**: The full loop is exercised end-to-end on a local run
- [ ] **VER-02**: The full loop is exercised end-to-end from the container image
- [ ] **VER-03**: The full loop is exercised end-to-end on a LAN bind with a token
- [ ] **VER-04**: A written acceptance checklist records the results of the three runs above

## v2 Requirements

Deferred to a future milestone. Tracked but not in this roadmap.

### Automation

- **AUTO-01**: Playwright browser smoke tests run in CI
- **AUTO-02**: Automated upgrade path from `~/.config/opencode-web` state

### Experience

- **UX-01**: Theme customization beyond light/dark
- **UX-02**: Multiple concurrent desks or windows

## Out of Scope

| Feature | Reason |
|---------|--------|
| Reimplementing the agent, tools, or shell execution | OpenCode owns all of it; Paddy is the interface |
| Multi-user accounts, hosted SaaS, team workspaces | Single-operator local desk by design |
| Scraping CLI output instead of the HTTP API | The controller talks to `opencode serve` only |
| Integration with the Paddy/OpenClaw agent runtime | This repo is explicitly standalone |
| Storing sessions, messages, models, or file state in Paddy | OpenCode remains the authority |
| Replacing `node:test` with Jest or Vitest | Stack change outside this milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 1 | Pending |
| SEC-04 | Phase 1 | Pending |
| PKG-01 | Phase 5 | Pending |
| PKG-02 | Phase 5 | Pending |
| PKG-03 | Phase 5 | Pending |
| PKG-04 | Phase 5 | Pending |
| LOOP-01 | Phase 2 | Pending |
| LOOP-02 | Phase 2 | Pending |
| LOOP-03 | Phase 2 | Pending |
| LOOP-04 | Phase 2 | Pending |
| LOOP-05 | Phase 2 | Pending |
| QUAL-01 | Phase 4 | Pending |
| QUAL-02 | Phase 4 | Pending |
| QUAL-03 | Phase 4 | Pending |
| QUAL-04 | Phase 4 | Pending |
| CLN-01 | Phase 3 | Pending |
| CLN-02 | Phase 3 | Pending |
| CLN-03 | Phase 3 | Pending |
| CLN-04 | Phase 3 | Pending |
| VER-01 | Phase 6 | Pending |
| VER-02 | Phase 6 | Pending |
| VER-03 | Phase 6 | Pending |
| VER-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-03*
*Last updated: 2026-11-03 after roadmap creation*
