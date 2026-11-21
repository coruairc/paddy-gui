# Roadmap: Paddy

## Overview

Paddy already works; this milestone makes it trustworthy. Six phases take the app from "runs on my machine" to "can be tested, installed, and trusted on any path". The order is deliberate: the auth bypass and the core-loop defects are fixed first, because until those are true no other testing means much. Then the app-builder scaffolding and the documentation that describes a product that does not exist are removed, which is what lets lint and the test suite become real gates. With those gates green, the install and container paths are repaired and validated, and finally the whole loop is exercised end-to-end on local, container, and LAN-with-token paths and written down.

**Milestone:** v1.0 Hardening (Phases 1-6)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Controller Auth Hardening** - Token auth cannot be bypassed by loopback trust, a spoofed `Host`, or a cross-origin request (completed 2026-11-21)
- [ ] **Phase 2: Core Loop Correctness** - Messages, settings saves, and process exit behave without duplicates, data loss, or orphans
- [ ] **Phase 3: Repository Cleanup and Honest Docs** - Delete the app-builder scaffolding, unused dependencies, and documentation for features that do not exist
- [ ] **Phase 4: Trustworthy Quality Gates** - Lint passes, the full suite runs, and CI enforces both on every push and pull request
- [ ] **Phase 5: Install and Persist** - Containers keep state across restarts and the Linux/Windows installers produce a working `paddy` command
- [ ] **Phase 6: End-to-End Verification** - The whole loop is exercised on local, container, and LAN-with-token paths and recorded in an acceptance checklist

## Phase Details

### Phase 1: Controller Auth Hardening
**Goal**: As an operator exposing Paddy beyond loopback, I want the controller to require a token on every API route and reject cross-origin requests, so that no anonymous or DNS-rebinding request can bypass auth.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. On a non-loopback bind, every `/api` route — including `/api/bootstrap` and `/api/events` — refuses an anonymous request, regardless of the `Host` header.
  2. A request that arrives on a loopback socket carrying `Host: evil.example` and a matching `Origin` is rejected; the DNS-rebinding path no longer authenticates.
  3. A request carrying a cross-origin `Origin` or `Referer` is rejected, while the same-origin browser desk keeps loading and chatting normally.
  4. With a valid token a LAN client reaches the API and drives a session; the path allowlist and secret redaction still hold — no out-of-allowlist path is readable and no stored password appears in any response.
  5. `npm test` contains a test that fails if the loopback/`Host` bypass is reintroduced.
**Plans**: 1/1 plans complete
Plans:
- [x] 01-01-PLAN.md — Close the loopback/Host auth bypass (security.ts + http.ts + tests)

### Phase 2: Core Loop Correctness
**Goal**: A user can drive one OpenCode session from first message to finished run without duplicate turns, a wiped password, or an orphaned server.
**Mode:** mvp
**Depends on**: Phase 1 (the loop is exercised against a controller that can be trusted on any bind)
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05
**Success Criteria** (what must be TRUE):
  1. Sending a message shows it exactly once — the optimistic bubble is reconciled with the server echo, and a reload does not bring a second copy back.
  2. Settings → Connection → Save with the password field left blank keeps the stored password working; entering a new password replaces it.
  3. Ctrl+C, `docker stop`, and Settings → Reset terminate the spawned `opencode serve` child — no `opencode` process survives the controller.
  4. Stop, retry, and resume-after-browser-restart still work on the same session after these fixes.
  5. A permission prompt can be allowed or denied inline and the run continues or aborts accordingly.
**Plans**: 3/4 plans executed
**UI hint**: yes
Plans:
- [x] 02-01-PLAN.md — Reconcile optimistic message bubble (LOOP-01)
- [x] 02-02-PLAN.md — Password save preserves stored password (LOOP-02)
- [x] 02-03-PLAN.md — Process exit kills spawned child (LOOP-03)
- [ ] 02-04-PLAN.md — Inline permission prompts and session resume (LOOP-04/05)

### Phase 3: Repository Cleanup and Honest Docs
**Goal**: The repository contains only Paddy — no app-builder subsystems in the build, no dependencies nothing imports, and no documentation for commands or variables that do not exist.
**Mode:** mvp
**Depends on**: Phase 2 (the loop must be verified before the scaffolding around it is deleted)
**Requirements**: CLN-01, CLN-02, CLN-03, CLN-04
**Success Criteria** (what must be TRUE):
  1. `vite.config.ts` mounts no Grok/PWA/preview/PGlite plugins, and dev, build, and preview still start and serve the desk.
  2. The template subsystems are gone from `src/`, `server/`, and `scripts/`, and `npm run typecheck` and `npm test` pass with them removed.
  3. `SELFHOST.md` and `selfhost.env.example` are either deleted or describe only the commands (`start`, `update`, `uninstall`, `doctor`, `help`, `--version`) and variables the code actually implements.
  4. `README.md` install and run instructions match `bin/paddy.mjs` and `src/server/state.ts`, including one documented state-directory variable.
  5. The unused heavy dependencies are gone from `package.json`, and install, build, lint, and test still pass afterwards.
**Plans**: TBD

### Phase 4: Trustworthy Quality Gates
**Goal**: A contributor can open a pull request and have lint, typecheck, and the full test suite run and pass without local guesswork.
**Mode:** mvp
**Depends on**: Phase 3 (lint and the test wiring only settle once the scaffolding and its orphaned tests are gone)
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):
  1. `npm run lint` exits 0 on a clean checkout.
  2. `npm test` executes every test file in the repo, including the `scripts/*.test.mjs` suites, and reports the full count with no silently skipped files.
  3. The stale root `install.sh.test.mjs` is removed or passing, and the suite is green.
  4. Pushing a commit or opening a pull request runs lint, typecheck, and the full suite in CI, and a deliberately broken change turns the check red.
**Plans**: TBD

### Phase 5: Install and Persist
**Goal**: Paddy installs from a clean checkout on Linux and Windows and a container keeps its state across restarts.
**Mode:** mvp
**Depends on**: Phase 3 (state-directory variable naming), Phase 4 (the gates validate the changes)
**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04
**Success Criteria** (what must be TRUE):
  1. `docker compose up`, add a project and a password, `docker compose down` then `up` again — the project, appearance, and password are still there, stored at the documented path.
  2. `install.sh` compares the downloaded Node tarball against the published `SHASUMS256.txt` and aborts with a non-zero exit and no partial install on a mismatch.
  3. From a clean checkout on Linux, `install.sh` leaves a `paddy` command on `PATH` that starts the desk.
  4. On a Windows host, `install.ps1` leaves a `paddy` command on `PATH` that starts the desk without a `which`/`npm` spawn failure.
**Plans**: TBD

### Phase 6: End-to-End Verification
**Goal**: The full loop is proven on all three delivery paths and the evidence is written down where the next reader can find it.
**Mode:** mvp
**Depends on**: Phases 1-5
**Requirements**: VER-01, VER-02, VER-03, VER-04
**Success Criteria** (what must be TRUE):
  1. On a local run the loop completes: pick a project, send a message, watch reads/edits/commands, approve a permission, inspect the diff, stop and retry, reload and resume — all recorded as passing.
  2. The same loop completes from the container image, with state surviving a container restart.
  3. The same loop completes on a LAN bind with a token, while an unauthenticated or cross-origin request is refused.
  4. A written acceptance checklist in the repo records each run's date, environment, steps, and result, with every item either PASS or an explicitly filed defect.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Controller Auth Hardening | 1/1 | Complete    | 2026-11-21 |
| 2. Core Loop Correctness | 3/4 | In Progress | - |
| 3. Repository Cleanup and Honest Docs | 0/TBD | Not started | - |
| 4. Trustworthy Quality Gates | 0/TBD | Not started | - |
| 5. Install and Persist | 0/TBD | Not started | - |
| 6. End-to-End Verification | 0/TBD | Not started | - |
