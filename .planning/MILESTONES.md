# Milestones

## v1.0 v1.0 (Shipped: 2026-11-21)

**Phases completed:** 6 phases, 9 plans, 9 tasks

**Key accomplishments:**
- Closed the controller auth bypass: locality now requires a loopback bind AND a loopback Host header, cross-origin Origin/Referer is rejected with 403 before auth, and token comparison uses timingSafeEqual.
- Settings → Connection Save no longer wipes a stored password; blank preserves, non-empty replaces, explicit clear deletes; Reset stops the spawned child and clears ownedServerPassword.
- Detached spawn with process-group kill (SIGTERM→5s→SIGKILL), injectable runtime seam, guarded exit handler, async disconnect, and Vite signal handlers
- Inline permission card with allow/deny/question input, deny-abort handling, and browser-restart session resume with loading state

---
