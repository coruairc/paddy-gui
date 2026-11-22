# Milestones

## v1.0 v1.0 (Shipped: 2026-11-21)

**Phases completed:** 6 phases, 9 plans, 9 tasks

**Key accomplishments:**
- Closed the controller auth bypass: locality now requires a loopback bind AND a loopback Host header, cross-origin Origin/Referer is rejected with 403 before auth, and token comparison uses timingSafeEqual.
- Settings → Connection Save no longer wipes a stored password; blank preserves, non-empty replaces, explicit clear deletes; Reset stops the spawned child and clears ownedServerPassword.
- Detached spawn with process-group kill (SIGTERM→5s→SIGKILL), injectable runtime seam, guarded exit handler, async disconnect, and Vite signal handlers
- Inline permission card with allow/deny/question input, deny-abort handling, and browser-restart session resume with loading state

---

## v1.1 OpenCode v2 Desk (Shipped: 2026-11-22)

**Phases completed:** 4 phases, 9 plans

**Key accomplishments:**
- Made the quality gate hermetic: injectable probe seam + env scrub, green with and without a live server on port 4096.
- Exact-match redaction so identifier-shaped provider/model payloads survive byte-identically at unit and route level.
- Added a durable `deskModel` default with silent state upgrade, bootstrap precedence, and honest Settings read-only sections.
- Shipped a provider-grouped, keyboard-first model picker whose pick is exactly the model that runs, reconciled live across tabs.
- Shipped a server-sourced slash-command palette with args-only dispatch, expanded-message echo reconciliation, in-thread errors, and live `command.updated` invalidation.
- Closed the milestone with live two-tab end-to-end verification and clean gates in both a live and an isolated environment.

**Archived:** `.planning/milestones/v1.1-ROADMAP.md`, `v1.1-REQUIREMENTS.md`, `v1.1-MILESTONE-AUDIT.md`, `v1.1-phases/`

