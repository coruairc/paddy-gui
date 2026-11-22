---
phase: "07"
slug: "v2-hardening-foundation"
status: securing_verified
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-11-22"
audited: "2026-11-22"
---

# Phase 07 — Security

> Retroactive threat-mitigation audit for v2 Hardening Foundation.
> Verdict: **SECURED** — 6/6 threats closed, 0 open. One threat is a documented accepted risk (T-7-02).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → controller `PATCH /api/settings` | Untrusted JSON body crosses `readBody`/`safeJson`; `deskModel` guarded by `typeof === "string"` | Non-secret GUI metadata (model id, appearance, connection URL/username, optional password the user already knows) |
| controller → browser (`publicState`, read routes) | Every OpenCode payload crosses `redactSecrets` before leaving the controller | Provider/agent/MCP/config data, potentially credential-shaped fields; persisted secrets must never cross |
| controller → state file | Atomic write of GUI metadata at `~/.paddy/state.json` | `connectionPassword` / `ownedServerPassword` (must never be serialized to browser) |
| browser → controller (dead write route) | Former `PATCH /api/config` confused-deputy surface | Removed end-to-end in 07-03 |
| test → ambient local network | Runtime spawn test previously attached to whatever held port 4096 | Hermetic via injectable probe + env scrub |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-7-01 | Tampering | `redactSecrets` string branch (`src/server/security.ts`) | high | mitigate | Whole-string equality only (`node === needle`, security.ts:168); substring `split(needle).join(...)` splice removed; `length >= 4` needle filter (security.ts:160) and `SECRET_KEY` key redaction (security.ts:156,174-176) intact; byte-identical fixture tests at unit and route level | closed |
| T-7-02 | Information Disclosure | Prose-embedded secrets after exact-match switch | medium | accept | Locked D-04 tradeoff: prose that embeds a secret is no longer needle-scrubbed. Exact secret values still redacted; dedicated credential fields still key-redacted. Documented in code (security.ts:163-167), pinned by surviving-prose assertion (security.test.ts:96-99), and in Accepted Risks Log below | closed (accepted) |
| T-7-03 | Information Disclosure | State file / `publicState` projection | medium | mitigate | `publicState` omits `connectionPassword` and `ownedServerPassword` (state.ts:107-117) and exposes only `hasConnectionPassword` + non-secret `deskModel`; atomic write `mode 0600`, dir `0700` (state.ts:64-70); inverse secrecy assertions in state.test.ts:20-27, 48-52 | closed |
| T-7-04 | Tampering | Dead `PATCH /api/config` write route (confused-deputy surface) | high | mitigate | Chain deleted end-to-end: `updateConfig`, `patchConfig`, browser `api.patchConfig`, route dispatch, mock, and test all gone (`grep -rn 'updateConfig\|patchConfig' src/` → 0, exit 1); unknown method falls to `json(404, { error: "Not found" })` (api.ts:55); inverse regression `PATCH /api/config is gone` asserts 404 (api.test.ts:164-168) | closed |
| T-7-05 | Spoofing | Runtime spawn test attaching to arbitrary local server | medium | mitigate | `ProbeImpl` seam (runtime.ts:35,41,66) with production default (runtime.ts:78); both call sites route through `probeImpl` (runtime.ts:149,241), no direct `await this.probe(`; spawn test injects down-probe, asserts it was used with the loopback endpoint, and scrubs `OPENCODE_URL`/`OPENCODE_SERVER_PASSWORD`/`OPENCODE_SERVER_USERNAME` (runtime.test.ts:118-169) | closed |
| T-7-SC | Tampering | npm/pip/cargo installs (supply chain) | high | mitigate | Zero-install phase: no commits touched `package.json` or `package-lock.json` across the phase range (`git log 2a6ca95^..HEAD -- package.json package-lock.json` → empty); no new source files or dependencies introduced | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `block_on: high` count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-7-01 | T-7-02 | Whole-string equality removes substring needle replacement so identifier-shaped payloads (e.g. `alibaba-token-plan`) survive byte-identical. Residual consequence: a secret embedded inside prose in an OpenCode payload would no longer be needle-scrubbed. Risk is bounded: (1) exact secret values are still redacted, (2) credential-shaped keys still hit `SECRET_KEY` redaction for dedicated fields, (3) needle sources are unchanged (`connectionPassword` + `OPENCODE_SERVER_PASSWORD`), (4) OpenCode payloads structurally carry credentials in dedicated fields, not incidental prose. Locked decision D-04 in `07-CONTEXT.md`. | Phase 07 owner (locked D-04) | 2026-11-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Verification Evidence

| Check | Command / Location | Result |
|-------|--------------------|--------|
| No substring splice | `grep -rn 'split(needle)' src/server` | 0 matches |
| Exact-match + 3/4-char boundary + exact-value redaction | `node --experimental-strip-types --test src/server/security.test.ts` | pass |
| Identifier payload byte-identical at route boundary | `api.test.ts` "identifier payloads survive the providers route byte-identical" | pass |
| `PATCH /api/config` removed | `grep -rn 'updateConfig\|patchConfig' src/` (exit 1) + api.test.ts:164 | 0 matches; 404 asserted |
| `GET /api/config` retained and redacted | api.ts:45 dispatch, api.ts:293 `redactSecrets(getConfig(...))`; api.test.ts "GET /api/config still reads the OpenCode config" | pass |
| Passwords excluded from browser projection | state.ts:107-117; state.test.ts:20-27, 48-52 | pass |
| State file/dir modes | state.ts:64-70 (`writeFileSync` 0600, `mkdirSync`/`chmodSync` 0700) | present in code |
| Probe seam, no direct probe call | runtime.ts:35,41,66,78,149,241; `grep 'await this.probe('` | 0 direct calls |
| Spawn-test hermeticity | runtime.test.ts:118-169 (injected down-probe, env scrub, probe-use assertion) | pass |
| Peer/origin auth unchanged | `git diff d9fdccc..HEAD -- src/server/http.ts` empty; security.ts diff touches only `redactSecrets` string branch (auth helpers unchanged) | unchanged |
| Manifest untouched | `git log 2a6ca95^..HEAD -- package.json package-lock.json` | empty |
| Targeted suites | `node --experimental-strip-types --test security/api/runtime/state tests` | 47/47 pass (api 22/22) |
| Both-environment gate | `npm test` with live 4096 listener and `unshare -Urn ... npm test` (07-03-SUMMARY) | 88/88 TS, 20/20 script, exit 0 |

### Observations (non-blocking, not threat regressions)

- **IN-03 residual:** the spawn test still calls `freePort(4096)`, which performs a short-lived loopback bind even though the injected probe removes the HTTP call. This does not reopen T-7-05 (the test cannot attach to an arbitrary server) but means the test requires loopback availability. Documented in `07-REVIEW.md` IN-03; informational.
- **IN-02 residual:** unanchored `SECRET_KEY` can still rewrite identifier-*keyed* maps (e.g. a model id containing `token`). This is the explicitly locked "key-based redaction stays unchanged" behavior (D-04) and is outside this phase's declared threat vector; informational.
- **IN-01 residual:** the spawn test uses a fixed `/tmp/fake-opencode-bin` path, so concurrent suite runs could race on that artifact. Not a security regression; informational.
- **Test fix validated:** `dbbf86b` restored the missing `readOpenCode /config` branch, added the GET config regression, seeded the Agents model field, and added the injected-probe assertion — closing 07-REVIEW CR-01, WR-01, WR-02.

### Unregistered Threat Flags

None. No `## Threat Flags` section exists in the plan summaries, and no new attack surface appeared without a threat mapping. The restored `GET /api/config` read path is a retained read path explicitly covered by the 07-03 prohibition ("GET read paths must not be deleted"); it redacts its payload with `redactSecrets` and is regression-tested.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-22 | 6 | 6 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: securing_verified` set in frontmatter

**Approval:** verified 2026-11-22
