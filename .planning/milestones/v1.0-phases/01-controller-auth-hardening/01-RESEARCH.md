# Phase 1: Controller Auth Hardening - Research

**Researched:** 2026-11-21
**Domain:** Controller HTTP auth boundary (loopback trust, DNS rebinding, cross-origin)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Loopback peers are allowed without a token even when OPENCODE_WEB_TOKEN is set (local dev stays simple; token only gates non-loopback peers).
- Container/docker local detection uses bind host loopback + Host header loopback (today's shortcut, but Host-validated).
- DNS rebinding: a loopback peer whose Host is not a loopback host is rejected (requires token, attacker can't present it).
- Non-loopback bind never allows anonymous loopback peers (per SEC-01).
- Validate Referer in addition to Origin when Origin is absent; reject cross-origin Referer.
- Origin check applies to all requests, including trusted-local.
- Allowed origins: same-origin only (no configurable allowlist).
- Missing both Origin and Referer (non-browser clients): allowed, rely on auth/token.
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

## Summary

The bypass lives in two places: `src/server/http.ts` computes `localOnly` from the spoofable `Host` header, and `src/server/security.ts` `authorizePeer` trusts any loopback socket peer without a token regardless of `Host`. A DNS-rebinding page sets `Host: evil.example` (matching its `Origin`), passes the origin check, and is treated as local because the socket peer is 127.0.0.1. The fix must make locality depend on the **bind host** plus a **loopback `Host` header**, and require a token on every non-loopback bind.

The recommended approach: (1) move the locality decision into `authorizePeer`, keyed on `bindHost` (loopback only) AND a loopback `Host` header, so a loopback peer with a non-loopback `Host` is rejected and requires the token; (2) on a non-loopback bind, never grant anonymous access even to loopback peers; (3) extend `originAllowed` to also validate `Referer` when `Origin` is absent, rejecting cross-origin referers; (4) swap string token comparison for `crypto.timingSafeEqual`; (5) keep the query-token → HttpOnly cookie exchange and its attributes.

Path allowlist (`validateWorkspacePath`) and redaction (`redactSecrets`) are untouched (SEC-04).

**Primary recommendation:** Key anonymous trust on `bindHost` (loopback) + loopback `Host` header, never on the socket peer or `Host` alone; validate `Origin`/`Referer` before auth; use `timingSafeEqual` for token compare.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | Non-loopback bind: valid token on every `/api` route regardless of `Host` | `authorizePeer` grants no anonymous trust when `bindHost` is non-loopback |
| SEC-02 | `Host` naming a non-bound host is not treated as local | Locality requires loopback `Host` header; DNS rebinding host rejected |
| SEC-03 | Cross-origin `Origin`/`Referer` rejected | `originAllowed` extended to Referer; runs before auth on all requests |
| SEC-04 | Path allowlist + redaction unchanged | `validateWorkspacePath`, `redactSecrets` not modified |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token auth decision | API / Backend (controller) | — | `authorizePeer` in `src/server/security.ts` |
| Origin/Referer validation | API / Backend (controller) | — | `originAllowed` in `src/server/security.ts` |
| Socket peer / bind host read | Node adapter | — | `handleNode` in `src/server/http.ts` |
| Path allowlist | API / Backend (controller) | — | `validateWorkspacePath` unchanged |
| Secret redaction | API / Backend (controller) | — | `redactSecrets` unchanged |

## Standard Stack

No new dependencies. Uses `node:crypto.timingSafeEqual` (built-in) and existing `node:http`/`node:fs`.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node built-in crypto | Node 22+ | `timingSafeEqual` | No dependency; constant-time compare |

## Architecture Patterns

### Recommended Project Structure
Unchanged. Edits confined to `src/server/security.ts`, `src/server/http.ts`, and tests.

### Pattern 1: Locality keyed on bind host + Host header

**What:** Anonymous (no-token) trust is granted only when the controller is bound to a loopback address AND the request's `Host` header names a loopback host. The socket peer alone never grants trust; a non-loopback bind never grants anonymous trust.

**When to use:** Every `/api` request through `handleNode`.

**Example:**
```typescript
// src/server/security.ts
import { timingSafeEqual } from "node:crypto";

export function isLoopbackHost(value: string | null | undefined): boolean {
  if (!value) return false;
  const first = value.split(",")[0]?.trim() ?? "";
  let hostname = first;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end >= 0 ? hostname.slice(1, end) : hostname;
  } else {
    const idx = hostname.lastIndexOf(":");
    if (idx > 0) hostname = hostname.slice(0, idx);
  }
  const h = hostname.trim().replace(/^::ffff:/, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

export function authorizePeer(input: {
  remoteAddress?: string | null;
  host?: string | null;        // Host header
  bindHost?: string | null;    // OPENCODE_WEB_HOST
  authorization?: string | null;
  token?: string | null;
  localOnly?: boolean;         // legacy container shortcut
}): { ok: true } | { ok: false; status: 401; error: string } {
  const bindLoopback = input.bindHost == null ? true : isLoopbackAddress(input.bindHost);
  const hostLoopback = input.host == null ? true : isLoopbackHost(input.host);
  const peerLoopback = isLoopbackAddress(input.remoteAddress);
  // Anonymous trust: loopback bind + loopback Host, and either a loopback peer
  // or an explicitly-enabled container-local shortcut. A non-loopback bind
  // never grants anonymous trust (SEC-01).
  const trusted =
    bindLoopback && hostLoopback && (peerLoopback || input.localOnly === true);

  if (trusted) return { ok: true };

  const expected = input.token?.trim() ?? "";
  if (!expected) {
    return { ok: false, status: 401, error: "Remote access is disabled. Set OPENCODE_WEB_TOKEN and connect with that token." };
  }
  const presented = bearerToken(input.authorization);
  if (!presented) return { ok: false, status: 401, error: "Unauthorized" };
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
```

### Pattern 2: Origin + Referer validation

**What:** Reject cross-origin browser requests using `Origin` when present, else `Referer` when present; allow when both are absent (non-browser clients); same-origin only.

**Example:**
```typescript
// src/server/security.ts
export function originAllowed(
  origin: string | null | undefined,
  host: string | null | undefined,
  referer?: string | null | undefined,
): boolean {
  const expected = (host ?? "").split(",")[0]?.trim() ?? "";
  if (!expected) return false;

  const check = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.host === expected;
    } catch {
      return false;
    }
  };

  if (origin) return check(origin);
  if (referer) return check(referer);
  return true; // non-browser client: rely on auth/token
}
```

### Pattern 3: http.ts wiring

```typescript
// src/server/http.ts
const remote = req.socket.remoteAddress;
const host = header(req, "host") ?? "127.0.0.1";
// Origin/Referer check FIRST -> 403 for cross-origin regardless of token
if (!originAllowed(header(req, "origin"), host, header(req, "referer"))) {
  sendJson(res, 403, { error: "Cross-origin request rejected" });
  return;
}
const auth = authorizePeer({
  remoteAddress: remote,
  host,
  bindHost: process.env.OPENCODE_WEB_HOST,
  authorization: header(req, "authorization") ?? (queryToken ? `Bearer ${queryToken}` : cookieToken ? `Bearer ${cookieToken}` : null),
  token: process.env.OPENCODE_WEB_TOKEN,
});
if (!auth.ok) { sendJson(res, auth.status, { error: auth.error }); return; }
// cookie exchange (unchanged attributes, constant-time compare)
if (queryToken) {
  const expected = process.env.OPENCODE_WEB_TOKEN?.trim() ?? "";
  const a = Buffer.from(queryToken, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (expected && a.length === b.length && timingSafeEqual(a, b)) {
    res.setHeader("set-cookie", "paddy_token=" + encodeURIComponent(queryToken) + "; HttpOnly; SameSite=Strict; Path=/");
  }
}
```

Note: move `isLocalHost` usage replaced by `isLoopbackHost` imported from security.ts.

### Anti-Patterns to Avoid
- **Trusting the socket peer alone** — a loopback peer can be reached via DNS rebinding; always require loopback `Host`.
- **Deriving `localOnly` from the `Host` header without bind-host check** — non-loopback bind would still trust spoofed hosts.
- **String token comparison (`!==`)** — timing side channel; use `timingSafeEqual`.
- **Skipping origin check for "trusted local"** — decision says origin applies to all.
- **Allowing configurable origin allowlist** — out of scope; same-origin only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constant-time compare | Custom XOR loop | `node:crypto.timingSafeEqual` | Standard, tested |
| Host parsing | Regex guesswork | Small `isLoopbackHost` helper | Handles IPv6 brackets + port |

## Common Pitfalls

### Pitfall 1: `timingSafeEqual` throws on length mismatch
**What goes wrong:** Calling with unequal-length buffers throws `RangeError`.
**How to avoid:** Compare `.length` first (length leak is acceptable for v1).

### Pitfall 2: Forgetting bind-host gating for loopback peers
**What goes wrong:** A loopback bind with a spoofed `Host: evil.example` still trusted.
**How to avoid:** `bindLoopback && hostLoopback` both required.

### Pitfall 3: Origin check after auth
**What goes wrong:** Cross-origin request with a valid token passes auth then fails origin with 403 anyway — but ordering affects status code for anonymous cross-origin (401 vs 403). Decision: 403 for cross-origin, so origin check first.

### Pitfall 4: Cookie attributes
**What goes wrong:** Adding `Secure` breaks http LAN; omitting `SameSite=Strict` reopens CSRF.
**How to avoid:** Keep exactly `HttpOnly; SameSite=Strict; Path=/`.

### Pitfall 5: Breaking existing security.test.ts signatures
**What goes wrong:** Changing `originAllowed` arg order breaks tests.
**How to avoid:** Keep `(origin, host, referer?)` — referer optional third.

## Code Examples

### Constant-time token compare (verified pattern)
```typescript
import { timingSafeEqual } from "node:crypto";
const a = Buffer.from(presented, "utf8");
const b = Buffer.from(expected, "utf8");
if (a.length !== b.length || !timingSafeEqual(a, b)) { /* reject */ }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Peer-based loopback trust | Bind-host + Host-header locality | Phase 1 | Closes DNS rebinding |
| String `!==` token compare | `timingSafeEqual` | Phase 1 | Removes timing side channel |
| Origin-only CSRF check | Origin + Referer | Phase 1 | Covers fetch/XHR-less navigations |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `node:crypto.timingSafeEqual` available in Node 22+ | Standard Stack | Low — verified in environment |
| A2 | No Secure cookie needed (http LAN) | Pitfall 4 | Medium — HTTPS deployments would need Secure; out of scope |

## Open Questions

1. **Should origin check use the bind host instead of the Host header?**
   - What we know: Host header is attacker-controllable but origin comparison is host-to-host; DNS rebinding handled by auth host check.
   - What's unclear: none.
   - Recommendation: keep Host header (existing behavior), rely on auth for DNS rebinding.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v26.12.1 | — |
| node:test | tests | ✓ | built-in | — |
| timingSafeEqual | auth | ✓ | built-in | — |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in) |
| Config file | none |
| Quick run command | `node --experimental-strip-types --test src/server/security.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Non-loopback bind requires token on all routes | unit + integration | `node --experimental-strip-types --test src/server/security.test.ts` | ❌ Wave 0 (extend) |
| SEC-02 | Non-loopback Host not trusted | unit | security.test.ts | ❌ Wave 0 (extend) |
| SEC-03 | Cross-origin Origin/Referer rejected | unit | security.test.ts | ❌ Wave 0 (extend) |
| SEC-04 | Path allowlist + redaction unchanged | unit | security.test.ts (existing) | ✅ |

### Sampling Rate
- **Per task commit:** `node --experimental-strip-types --test src/server/security.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Extend `src/server/security.test.ts`: DNS rebinding (`authorizePeer` with `host: "evil.example"` → not ok), Referer cross-origin cases, constant-time (no crash), non-loopback bind anonymous rejection.
- [ ] Add `src/server/http.test.ts`: socket-level coverage using a real `http` server on 127.0.0.1 with spoofed `Host`/`Origin`/`Referer` headers; assert status codes 401/403/200.
- [ ] Register `src/server/http.test.ts` in `package.json` test script.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer token + HttpOnly cookie |
| V3 Session Management | partial | SameSite=Strict cookie |
| V4 Access Control | yes | Path allowlist unchanged |
| V5 Input Validation | yes | `validateWorkspacePath`, `safeJson` |
| V6 Cryptography | yes | `timingSafeEqual` (never hand-roll) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DNS rebinding | Spoofing | bind-host + loopback Host gate |
| Cross-origin CSRF | Tampering | Origin/Referer same-origin check |
| Timing side channel | Information disclosure | `timingSafeEqual` |
| Token in query log | Information disclosure | Accepted (v1); cookie exchange reduces repeat |

## Sources

### Primary (HIGH confidence)
- `src/server/security.ts` (read this session) — authorizePeer, originAllowed
- `src/server/http.ts` (read this session) — handleNode, localOnly
- `.planning/phases/01-controller-auth-hardening/01-CONTEXT.md` (read this session) — locked decisions

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONCERNS.md` — DNS rebinding concern

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — built-in crypto, verified
- Architecture: HIGH — code read this session
- Pitfalls: HIGH — derived from code + context

**Research date:** 2026-11-21
**Valid until:** 2026-12-21 (30 days)