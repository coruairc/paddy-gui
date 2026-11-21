# Paddy v1.0 Acceptance Checklist

**Milestone:** v1.0 Hardening
**Date:** 2026-11-21
**Environment:** Linux (Node 22+), automated gates run locally.

## Automated gates (all paths)

- [x] `npm run lint` exits 0 (0 errors, 6 warnings) — PASS
- [x] `npm run typecheck` exits 0 — PASS
- [x] `npm test` — 91 tests, 0 failures — PASS
- [x] `npm run build` succeeds (client + SSR) — PASS

## VER-01: Local run loop

- [x] Pick a project (add project bookmark) — covered by api.test project routes
- [x] Send a message; appears exactly once — LOOP-01 reconciliation (messages.test.ts) — PASS
- [x] Watch reads/edits/commands stream — normalize.test.ts + event frames — PASS
- [x] Approve a permission inline — LOOP-05 PermissionCard — PASS (automated)
- [x] Inspect diff — toDiffFile tested
- [x] Stop and retry — LOOP-04 — PASS (automated)
- [x] Reload and resume — LOOP-04 localStorage resume — PASS (automated)
- [ ] Browser smoke on real loopback bind — manual UAT (deferred)

## VER-02: Container run

- [x] State path documented and configured: OPENCODE_WEB_HOME=/state, compose maps ./paddy-data:/state
- [x] docker-compose.yml and Dockerfile updated
- [ ] Full container loop + restart persistence — manual (docker not available in this environment) — deferred to operator

## VER-03: LAN bind with token

- [x] Non-loopback bind requires token on every /api route — SEC-01 (http.test.ts) — PASS
- [x] Anonymous/cross-origin requests refused — SEC-02/SEC-03 — PASS
- [x] Valid token reaches API and drives session — SEC-04 — PASS (automated)
- [ ] Live LAN smoke — manual (deferred)

## VER-04: Evidence recorded

- [x] This checklist records date, environment, steps, results
- [x] Automated items marked PASS; manual items explicitly filed as deferred

## Deferred manual items

- Browser desk smoke (local, container, LAN) — requires a running browser and, for container, a Docker daemon. Automated coverage (http.test.ts, security.test.ts, messages.test.ts) exercises the controller logic.
