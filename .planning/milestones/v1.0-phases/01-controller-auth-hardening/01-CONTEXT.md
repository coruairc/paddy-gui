# Phase 1: Controller Auth Hardening - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning

<domain>
## Phase Boundary

The controller can be exposed beyond loopback without a token bypass — auth no longer depends on the socket peer or the `Host` header alone. Covers SEC-01..SEC-04: non-loopback bind requires token on every route; Host header cannot grant locality; cross-origin Origin/Referer rejected; path allowlist and redaction unchanged.

</domain>

<decisions>
## Implementation Decisions

### Locality and bind model
- Loopback peers are allowed without a token even when OPENCODE_WEB_TOKEN is set (local dev stays simple; token only gates non-loopback peers).
- Container/docker local detection uses bind host loopback + Host header loopback (today's shortcut, but Host-validated).
- DNS rebinding: a loopback peer whose Host is not a loopback host is rejected (requires token, attacker can't present it).
- Non-loopback bind never allows anonymous loopback peers (per SEC-01).

### Origin and Referer validation
- Validate Referer in addition to Origin when Origin is absent; reject cross-origin Referer.
- Origin check applies to all requests, including trusted-local.
- Allowed origins: same-origin only (no configurable allowlist).
- Missing both Origin and Referer (non-browser clients): allowed, rely on auth/token.

### Token transport and cookie
- Keep query-token → HttpOnly cookie exchange on first load (LAN first-load flow).
- Cookie attributes: HttpOnly; SameSite=Strict; Path=/ (no Secure, http local).
- Constant-time token comparison using timingSafeEqual.
- Token allowed in query for all routes (keep simple).

### the agent's Discretion
- Error responses: 401 for missing/bad token, 403 for cross-origin.
- Logging: no token values; minimal status-only.
- Rate limiting: out of scope for v1.
- /api/status requires auth on non-loopback bind (per SEC-01).
- Any "You decide" not otherwise captured.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- src/server/security.ts: authorizePeer, originAllowed, isLoopbackAddress, bearerToken, redactSecrets.
- src/server/http.ts: handleNode adapter with localOnly shortcut and query-token cookie exchange.

### Established Patterns
- Auth returns {ok} discriminated union; http.ts maps to sendJson.
- originAllowed compares origin host to request host.

### Integration Points
- vite.config.ts mounts handleNode on /api; tests construct runtime with temp state.
- security.test.ts covers authorizePeer/originAllowed.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
