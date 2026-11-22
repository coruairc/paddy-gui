# Phase 7: v2 Hardening Foundation - Research

**Researched:** 2026-11-21
**Domain:** Controller hardening — hermetic test gate (DI probe seam), dead-route deletion + desk-model persistence, exact-match secret redaction
**Confidence:** HIGH (all findings verified by reading source at HEAD `acfc44e` this session; environment probed live)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Hermetic Test Gate (V2-01)
- Add an injectable `probe` seam to `ControllerRuntimeOptions` — third application of the existing DI pattern (`spawn`/`kill`/`sleep` are already injected). The failing `spawn uses detached:true` test injects a probe that reports "down" so connect always takes the spawn path, never attaching to whatever holds port 4096.
- Scrub `OPENCODE_URL` / `OPENCODE_SERVER_PASSWORD` in the runtime test setup so no ambient environment can redirect the probe.
- Scope is the failing spawn test plus the seam; the other 79 tests stay untouched.
- Prove both environments: run `npm test` once with a live OpenCode on port 4096 and once with nothing listening.

#### Settings 404 Cleanup (V2-02)
- Agents/Permissions Settings sections become read-only with an explanatory note (research recommendation; resolves the open STATE.md decision). v2 has no remote write for agents/permissions — show the data honestly instead of a Save that 404s.
- Delete the dead `updateConfig` chain end-to-end: `opencode-client.updateConfig()` → `PATCH /api/config` route → browser `api.patchConfig` → all three Settings call sites. Delete, not try/catch (research).
- Settings → model default Save migrates to the new `deskModel` persistence via the existing `updateSettings` route, so Settings keeps working and Phase 8's picker shares one source of truth.
- Keep the existing inline `note` error pattern in Settings — no new toast infrastructure.

#### deskModel Persistence (V2-02)
- `AppState.deskModel: string` — full `provider/model` id, `""` = unset; matches the existing `model` string state in `app.tsx`/`settings.tsx`. Update `EMPTY_STATE`, `normalizeState`, `publicState`.
- Old state files upgrade silently in `normalizeState` (missing/invalid → `""`), same pattern as every other field — no migration script, no version bump.
- API surface: extend existing `updateSettings` + `bootstrap`/`publicState` with `deskModel` — no new route.
- Accept any string; the controller does not validate against the model list. OpenCode is authoritative; Phase 8 reconciles on send/resume.

#### Redaction Hardening (V2-03)
- Exact whole-string needle matching: a string node is replaced only when it equals a needle; key-based `SECRET_KEY` field redaction stays unchanged. This eliminates identifier corruption (e.g. provider id `alibaba-token-plan` becoming `alibaba-[redacted]-plan`).
- Regression proof: an exact-match round-trip test where a registered needle is a substring of `alibaba-token-plan` and the payload must survive byte-identical; the test fails if substring replacement is reintroduced.
- Tests land in both `security.test.ts` (unit) and `api.test.ts` (route-level round-trip) — fixtures before any new model/command routes in Phases 8–9.
- Keep the existing needle `length >= 4` filter; no behavior change beyond the matching strategy.

### the agent's Discretion
- Internal implementation details of the probe seam signature, test fixture mechanics, and the read-only note wording are at the agent's discretion within the decisions above.

### Deferred Ideas (OUT OF SCOPE)
- Model picker UI, `session.model.selected` reconciliation, session-resume seeding — Phase 8.
- Slash command palette and `command.updated` invalidation — Phase 9.
- Model variant selection (MODEL-04) — v2 milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| V2-01 | `npm test` green in a clean environment — spawn test passes whether or not a live server holds port 4096 (probe seam injection, no hardcoded endpoint in the test path) | Probe seam design (§Architecture Patterns P1) with both call sites identified (`runtime.ts:145`, `:237`); exact failure mechanism reproduced live this session (4096 occupied → unauthenticated probe → 401 → `"auth"` branch → spawn never called); env scrub list; two-environment proof commands incl. verified `unshare -Urn` netns method (§Validation Architecture) |
| V2-02 | No Settings action 404s — dead `updateConfig` chain removed, desk default persists in `~/.paddy/state.json`, Agents/Permissions read-only or fixed | Complete 9-item deletion list verified at HEAD (§Dead-Chain Deletion List); `deskModel` field design across state/api/client/settings (§P3); read-only conversion map for both sections; silent old-state upgrade via existing `normalizeState` pattern |
| V2-03 | Exact-match redaction needles with byte-identical round-trip regression test so identifier-shaped payloads are never corrupted | Corruption site quoted (`security.ts:165`); exact-match replacement design (§P2); canonical `alibaba-token-plan` fixtures for both test files; **critical:** existing `security.test.ts:84-92` encodes substring semantics and must be rewritten (§Pitfall 1); key-based redaction edge case for provider-id-keyed maps documented (§Pitfall 4) |
</phase_requirements>

## Summary

Phase 7 is three surgical hardening changes to an already well-shaped codebase, all verified at HEAD `acfc44e` this session. (1) The runtime's `probe()` is the only un-injected side effect in `ControllerRuntime` — `spawn`/`sleep`/`kill` already have DI seams. The failing test `spawn uses detached:true` (`runtime.test.ts:118-150`) calls `connect()` with a real probe against hardcoded `http://127.0.0.1:4096`; on this machine a live OpenCode v2.3.2 holds that port and answers 401 unauthenticated, so the probe returns `"auth"`, connect takes the authRequired branch, and spawn is never invoked. Adding a fourth `probe?: ProbeImpl` seam and injecting `async () => "down"` makes the test deterministic in any environment. (2) The dead `PATCH /api/config` write chain (v2 has no remote global-config write) spans exactly 9 locations across 6 files; deleting it and migrating the model-default Save to a new `AppState.deskModel` field via the existing `PATCH /api/settings` route gives the desk a durable model default. (3) `redactSecrets` substring needle replacement (`security.ts:165`) is the confirmed corruption site for identifier-shaped payloads; switching to whole-string equality fixes it, but **breaks one existing test that asserts substring scrubbing** — that test must be rewritten to encode the new contract.

Zero new dependencies. Every change lands in existing files using established patterns (DI seams, `{ok}` validation unions, field-by-field `normalizeState`, co-located `node:test` suites, inline `note` UI feedback). The only new "surface" is one state field and one options property.

**Primary recommendation:** Execute in order — probe seam + test fix first (it is the gate), then redaction exact-match + regression fixtures (before any Phase 8/9 route exists), then dead-chain deletion + `deskModel` persistence + read-only Settings. Run the full suite in both environments (live-server host and `unshare -Urn` netns) as the exit proof.

## Project Constraints (from AGENTS.md)

Directives the planner must verify compliance with:

- **Node 22+, TypeScript strict** (`tsconfig.json` `strict: true`, `noEmit`, `allowImportingTsExtensions`); server code uses relative imports with explicit `.ts` extensions; browser code uses `@/` alias and must never import `src/server/*`.
- **`node:test` only** — no Jest/Vitest/jsdom/RTL; logic stays in plain `.ts` modules so it is unit-testable without DOM tooling.
- **Zero new dependencies** (milestone constraint, STATE.md) — no `package.json`/lockfile edits this phase.
- **Controller is the security boundary** — browser never touches shell/fs; secrets redacted via `redactSecrets(...)` before any response leaves the controller; state files atomic 0600/dir 0700.
- **OpenCode is authoritative** for sessions/models/providers; Paddy state is GUI metadata only.
- **Conventions:** kebab-case files; named exports; `type` aliases over `interface`; string unions not enums; validation returns `{ ok }` unions (never throws); domain errors only as `OpenCodeError(status, message, retryable)` mapped once in `handleApi`; DI for side effects, never module mocking; co-located tests mirroring source basename; Prettier double quotes/semicolons/trailing commas/width 100; Tailwind semantic tokens (`text-muted`, `text-ok`, `text-danger`, `bg-elevated`, `border-border`).
- **GSD workflow enforcement** — this research is part of `/gsd-plan-phase`; execution goes through `/gsd-execute-phase`.
- **Team rules:** heavy test runs under `flock -w 900 /tmp/team-build.lock`; no commits until reviewer PASS (code changes); secrets never echoed (existence checks only). *Executor deviation 2026-11-22:* during 07-03 the lock was held 70+ min by an unrelated foreign `cargo test` gate, so that plan's verify commands were run directly and recorded as the amended lock-free variants (see 07-03-SUMMARY.md). The shared-lock rule itself still stands.
- **Doc drift warning:** `.planning/codebase/STACK.md` (baked into AGENTS.md) is stale vs HEAD — it claims zod 4.5 and six TS suites; HEAD `package.json` has **no zod** and **nine** TS suites in `npm test`. Trust HEAD, not the codebase docs. [VERIFIED: package.json:22-66]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Probe seam (V2-01) | API / Backend (`src/server/runtime.ts`) | — | Connection lifecycle is controller-owned; tests inject at the same layer |
| Hermetic test gate (V2-01) | Test layer (`src/server/runtime.test.ts`) | — | DI injection + env scrub live in the test; production flow unchanged |
| Dead-chain deletion (V2-02) | API / Backend + Browser client | — | Remove route (`api.ts`), adapter method (`opencode-client.ts`), browser method (`client.ts`), UI call sites (`settings.tsx`) — all four layers of the dead path |
| deskModel persistence (V2-02) | Database / Storage (`src/server/state.ts` → `~/.paddy/state.json`) | API / Backend (`updateSettings`/`bootstrap`) | Paddy state is the only correct home — v2 has no remote global-config write [CITED: .planning/REQUIREMENTS.md:63 "v2 has no remote global-config write (`PATCH /api/config` → 404)"] |
| Read-only Agents/Permissions (V2-02) | Browser / Client (`settings.tsx`) | — | Presentation honesty; read paths (`GET /api/agents`, `GET /api/config`) already work and stay |
| Exact-match redaction (V2-03) | API / Backend (`src/server/security.ts`) | — | Output boundary owned by controller; applies to every redacted response |
| Regression fixtures (V2-03) | Test layer (`security.test.ts`, `api.test.ts`) | — | Unit + route-level round-trip, co-located per convention |

## Standard Stack

**Zero new packages.** Everything below is already installed and verified at HEAD.

### Core (existing, in use this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` + `node:assert/strict` | built into Node v26.13.1 (floor: 22+) | All tests | Project-mandated runner [VERIFIED: package.json:22] |
| TypeScript | `^5.7.0` declared; strict, `--experimental-strip-types` at test time | All source | Existing config [VERIFIED: package.json:63, :22] |
| React | `^19.2.0` | Settings UI edits | Existing UI stack [VERIFIED: package.json:40] |
| Tailwind CSS | `^4.3.0` | Read-only note styling (semantic tokens) | Existing styling [VERIFIED: package.json:44] |

### Supporting
None added. No HTTP client, no validation library, no state library — `fetch`, hand-rolled `{ok}` unions, and `useState` are the established patterns.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DI probe seam | Module mocking / port override env | Rejected: project convention is DI, never module mocking; env override still leaves a real network call |
| Exact-match needles | Per-route redaction opt-out | Rejected: locked decision is exact-match globally; opt-outs leak complexity into every future route |
| `deskModel` in Paddy state | Write OpenCode global config | Impossible: v2 has no remote global-config write (the V2-02 bug itself) |

**Installation:** none. `package.json` and `package-lock.json` must not change this phase.

**Version verification:** no packages to verify (zero installs). Runtime probed live: Node v26.13.1, npm 12.2.3, OpenCode v2.3.2 at `~/.opencode/bin/opencode`. [VERIFIED: shell probe this session]

## Package Legitimacy Audit

This phase installs **zero external packages** — the audit is not applicable. No registry lookups were needed; no `package.json` dependency changes are permitted by the milestone constraint.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | No installs this phase |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
V2-01 (test gate):
  runtime.test.ts "spawn uses detached:true"
    → new ControllerRuntime({ stateFile, spawn: fake, sleep: noop, kill: noop,
                              probe: async () => "down" })   ← NEW seam
    → connect() → connectInner()
        → detectBinary() (fake OPENCODE_BIN, already in test)
        → explicit URL? (state.connectionUrl="" + scrubbed OPENCODE_URL) → no
        → probeImpl("http://127.0.0.1:4096", creds) → "down"  ← injected, no network
        → freePort(4096) (real bind; ephemeral fallback if occupied — hermetic)
        → spawnImpl(binary, ["serve",...], { detached: true, ... }) → recorded
        → waitUntilReady → probeImpl → "down" ×20 (noop sleep) → not ready
    → assert spawnCalls[0].opts.detached === true  ✓ in ANY environment

V2-02 (persistence + cleanup):
  Settings ProviderCard "Use as desk default"
    → onModelChange(fullModel)            (instant UI)
    → api.settings({ deskModel })         ← MIGRATED from api.patchConfig
    → PATCH /api/settings → updateSettings → state.deskModel → persist()
    → ~/.paddy/state.json (atomic 0600)
  Reload: GET /api/bootstrap → model = state.deskModel || OpenCode config model
    → app.tsx setModel(data.model)        (unchanged line, new precedence)
  DEAD (deleted): api.patchConfig → PATCH /api/config → client.updateConfig
    → OpenCode PATCH /api/config (404 in v2)
  Agents/Permissions: GET paths stay; Save buttons removed; read-only + note

V2-03 (redaction):
  OpenCode response → api.ts boundary → redactSecrets(payload, secretNeedles)
    string node:  OLD: contains needle → split/join (corrupts ids)
                  NEW: equals needle   → "[redacted]" (ids survive)
    object key:   SECRET_KEY regex → "[redacted]"  (UNCHANGED)
    → browser receives byte-identical identifiers
```

### Recommended Project Structure

No new files. All changes in existing files:

```
src/server/
├── runtime.ts          # + ProbeImpl type, probe? option, probeImpl field, 2 call sites
├── runtime.test.ts     # spawn test: inject probe, scrub env (other tests untouched)
├── security.ts         # redactSecrets: exact-match string branch only
├── security.test.ts    # rewrite substring test + add alibaba-token-plan regression
├── state.ts            # + deskModel in AppState/EMPTY_STATE/normalizeState/publicState
├── state.test.ts       # + deskModel upgrade/round-trip/public tests
├── api.ts              # - patchConfig route+handler; updateSettings +deskModel;
│                       #   bootstrap model precedence
├── api.test.ts         # - updateConfig mock, - config-forward test; + 404 regression,
│                       #   + deskModel round-trip, + identifier round-trip
└── opencode-client.ts  # - updateConfig method
src/lib/desk/
└── client.ts           # - api.patchConfig; Bootstrap type + deskModel: string
src/components/desk/
├── settings.tsx        # setDeskDefault → api.settings; Agents/Permissions read-only
└── app.tsx             # (optional discretion) chooseProject model-override guard
```

### Pattern 1: Injectable Probe Seam (V2-01)

**What:** Fourth DI seam on `ControllerRuntime`, identical shape to the existing three.
**When to use:** Any test that calls `connect()`; production default unchanged.

Existing seams, quoted verbatim [VERIFIED: src/server/runtime.ts:32-40]:
```typescript
export type SpawnImpl = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
export type SleepImpl = (ms: number) => Promise<void>;
export type KillImpl = (pid: number, signal: NodeJS.Signals) => void;
export type ControllerRuntimeOptions = {
  stateFile?: string;
  spawn?: SpawnImpl;
  sleep?: SleepImpl;
  kill?: KillImpl;
};
```

The private probe being wrapped, quoted verbatim [VERIFIED: src/server/runtime.ts:224]:
```typescript
private async probe(url: string, auth: { username: string; password: string }): Promise<"ok" | "auth" | "down"> {
```

**Proposed implementation** (new values are design, not repo claims):
```typescript
export type ProbeImpl = (
  url: string,
  auth: { username: string; password: string },
) => Promise<"ok" | "auth" | "down">;
// add to ControllerRuntimeOptions:  probe?: ProbeImpl;
// constructor (next to spawnImpl/sleepImpl/killImpl assignments, runtime.ts:72-74):
this.probeImpl = opts.probe ?? ((url, auth) => this.probe(url, auth));
```

**Both call sites must route through the seam** — this is the easy-to-miss part:
1. `connectInner()` [VERIFIED: src/server/runtime.ts:145-146]:
```typescript
const probed = await this.probe("http://127.0.0.1:4096", this.credentials());
if (probed === "ok") return this.attach("http://127.0.0.1:4096", this.credentials(), false);
```
2. `waitUntilReady()` [VERIFIED: src/server/runtime.ts:235-240]:
```typescript
private async waitUntilReady(url: string, auth: { username: string; password: string }): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const probed = await this.probe(url, auth);
      if (probed === "ok") return true;
      await this.sleepImpl(250);
```
Replace `this.probe(` with `this.probeImpl(` at both sites; keep the private method as the default impl. With an injected `"down"` probe, `waitUntilReady` loops 20× with the injected no-op sleep and returns false — connect resolves with the "did not become ready" status, spawn already recorded. This matches the test's existing intent comment `"make child never ready so connect resolves quickly-ish"` [VERIFIED: src/server/runtime.test.ts:122].

**Test injection** (inside the existing test, extending the options object at `runtime.test.ts:123-131`):
```typescript
probe: async () => "down",
```
**Env scrub** — extend the existing `OPENCODE_BIN` save/restore (`runtime.test.ts:132-147`) to also save/delete/restore `OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD`, and `OPENCODE_SERVER_USERNAME`. Why each matters (all quoted from HEAD):
- `OPENCODE_URL` short-circuits to attach before any probe [VERIFIED: src/server/runtime.ts:141-143]: `const explicit = (this.state.connectionUrl || process.env.OPENCODE_URL || "").trim();` / `if (explicit) { return this.attach(explicit, this.credentials(), false); }`
- `OPENCODE_SERVER_PASSWORD` feeds `credentials()` [VERIFIED: src/server/runtime.ts:185]: `password: this.state.connectionPassword || process.env.OPENCODE_SERVER_PASSWORD || this.ownedPassword || "",` — an ambient password can flip `"down"` to `"ok"`/`"auth"` on a real probe.
- `OPENCODE_SERVER_USERNAME` [VERIFIED: src/server/runtime.ts:184] — scrub for symmetry (locked list names URL + password; username is discretionary hardening).
- `OPENCODE_BIN` is already handled by the test (fake executable written to tmpdir, `runtime.test.ts:132-136`).

**Observed failure mechanism at HEAD (this session):** port 4096 OPEN on this machine; live OpenCode v2.3.2 answers `GET /api/info` unauthenticated with **401**; ambient `OPENCODE_SERVER_PASSWORD`/`OPENCODE_URL`/`OPENCODE_BIN` all unset in the test shell. So the real probe returns `"auth"` → `connectInner` takes the authRequired branch (`runtime.ts:147-156`) → spawn never called → `assert.ok(spawnCalls.length > 0, "spawn invoked")` (`runtime.test.ts:148`) fails. On a machine with an *unauthenticated* live server the probe returns `"ok"` → attach branch → same failure. The injected `"down"` probe defeats both. [VERIFIED: shell probes + code read this session]

**Actual failing output at HEAD** (ran `node --experimental-strip-types --test src/server/runtime.test.ts` this session — 7 tests, 6 pass, 1 fail):
```text
✖ spawn uses detached:true (34.819136ms)
  AssertionError [ERR_ASSERTION]: spawn invoked
      at TestContext.<anonymous> (file:///home/cein_orourke/Projects/paddy-gui/src/server/runtime.test.ts:148:1)
    actual: false, expected: true, operator: '=='
ℹ tests 7  ℹ pass 6  ℹ fail 1
```
[VERIFIED: test run this session, live-server environment]

### Pattern 2: Exact-Match Redaction (V2-03)

**What:** Replace substring split/join with whole-string equality; everything else unchanged.
**When to use:** The single string branch of `redactSecrets`.

Current corruption site, quoted verbatim [VERIFIED: src/server/security.ts:159-167]:
```typescript
export function redactSecrets<T>(value: T, extra: readonly string[] = []): T {
  const needles = extra.filter((item) => item && item.length >= 4);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      let out = node;
      for (const needle of needles) {
        if (out.includes(needle)) out = out.split(needle).join("[redacted]");
      }
      return out;
    }
```

Key-based redaction stays untouched, quoted verbatim [VERIFIED: src/server/security.ts:156, 173-175]:
```typescript
const SECRET_KEY = /(^key$|api[_-]?key|token|password|secret|authorization|credential|private[_-]?key)/i;
```
```typescript
if (SECRET_KEY.test(key)) {
  out[key] = child ? "[redacted]" : child;
  continue;
}
```

**Proposed replacement** for the string branch only:
```typescript
if (typeof node === "string") {
  return needles.some((needle) => node === needle) ? "[redacted]" : node;
}
```
Keep the `length >= 4` filter line exactly as-is (locked). Needle sources unchanged [VERIFIED: src/server/api.ts:417-419]:
```typescript
function secretNeedles(runtime: ControllerRuntime): string[] {
  return [runtime.state.connectionPassword, process.env.OPENCODE_SERVER_PASSWORD ?? ""].filter(Boolean);
}
```
All six `redactSecrets` call sites in `api.ts` (lines 101, 286, 288, 289, 310, 340) keep working unchanged; line 310 disappears with the dead `patchConfig` handler. [VERIFIED: grep + read this session]

**Locked tradeoff to encode in tests:** prose that *embeds* a secret (e.g. an error message quoting a password) is no longer scrubbed by needles — only exact secret values and credential-shaped keys are redacted. This is the accepted cost of identifier integrity; key-based redaction still covers dedicated credential fields.

### Pattern 3: deskModel Persistence (V2-02)

**What:** One new state field through the existing four-layer path; no new route.
**When to use:** Settings model-default Save now; Phase 8 picker reads/writes the same field.

Existing shape to extend, quoted verbatim [VERIFIED: src/server/state.ts:21-33, 35-43]:
```typescript
export type AppState = {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  appearance: Appearance;
  /** Optional override. Empty means discover/start the local OpenCode server. */
  connectionUrl: string;
  connectionUsername: string;
  /** Never serialized to the browser. */
  connectionPassword: string;
  /** Password this controller generated for a server it spawned, kept so a
   *  controller restart can re-attach to the still-running server. */
  ownedServerPassword: string;
};

export const EMPTY_STATE: AppState = {
  projects: [],
  activeProjectId: null,
  appearance: "dark",
  connectionUrl: "",
  connectionUsername: "opencode",
  connectionPassword: "",
  ownedServerPassword: "",
};
```

Silent-upgrade pattern to copy, quoted verbatim [VERIFIED: src/server/state.ts:92, 97-99]:
```typescript
connectionUrl: typeof input?.connectionUrl === "string" ? input.connectionUrl : "",
```
```typescript
connectionPassword: typeof input?.connectionPassword === "string" ? input.connectionPassword : "",
ownedServerPassword:
  typeof input?.ownedServerPassword === "string" ? input.ownedServerPassword : "",
```

**Proposed additions** (new field — design):
- `AppState`: `deskModel: string;` (doc comment: desk default `provider/model`, `""` = unset).
- `EMPTY_STATE`: `deskModel: "",`
- `normalizeState`: `deskModel: typeof input?.deskModel === "string" ? input.deskModel : "",`
- `publicState` [VERIFIED: src/server/state.ts:103-112 — currently returns projects/activeProjectId/appearance/connectionUrl/connectionUsername/hasConnectionPassword]: add `deskModel: state.deskModel,`. It is not a secret; expose it. `ownedServerPassword`/`connectionPassword` remain excluded.

`updateSettings` to extend, quoted verbatim [VERIFIED: src/server/api.ts:157-168]:
```typescript
async function updateSettings(runtime: ControllerRuntime, request: Request): Promise<ApiResult> {
  const body = await readBody(request);
  if (body.appearance === "light" || body.appearance === "dark") runtime.state.appearance = body.appearance;
  if (typeof body.connectionUrl === "string") runtime.state.connectionUrl = body.connectionUrl.trim();
```
**Proposed line** (accept any string — locked, no model-list validation): `if (typeof body.deskModel === "string") runtime.state.deskModel = body.deskModel;` before `runtime.persist()`. Response is already `publicState(runtime.state)` → carries `deskModel` automatically.

`bootstrap` precedence, quoted verbatim [VERIFIED: src/server/api.ts:89-97]:
```typescript
return {
    status,
    ...publicState(runtime.state),
    sessions,
    groups: groupSessionsByDate(sessions.filter((item) => !item.archived)),
    model,
    agent,
    controllerVersion: CONTROLLER_VERSION,
  };
```
**Proposed:** before the return, `if (runtime.state.deskModel) model = runtime.state.deskModel;` — persisted desk default wins; OpenCode project-config model (derived at `api.ts:82-87` via `getConfig`) remains the fallback for fresh installs. The `...publicState` spread simultaneously exposes the raw `deskModel` field for Phase 8. This keeps `app.tsx:125` (`setModel(data.model)`) working unchanged on reload. [VERIFIED: src/components/desk/app.tsx:125]

Browser mirror, quoted verbatim [VERIFIED: src/lib/desk/client.ts:170, 175-186]:
```typescript
settings: (body: Record<string, unknown>) => request("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
```
```typescript
export type Bootstrap = {
  status: ConnectionStatus;
  projects: Project[];
  activeProjectId: string | null;
  appearance: "dark" | "light";
  connectionUrl: string;
  hasConnectionPassword: boolean;
  sessions: SessionSummary[];
  groups: { label: string; items: SessionSummary[] }[];
  model: string;
  controllerVersion: string;
};
```
`api.settings` needs **no signature change** (generic body). Add `deskModel: string;` to `Bootstrap`. (Note: `Bootstrap` already omits `connectionUsername` which `publicState` returns — pre-existing mirror gap, out of scope; do not "fix" beyond `deskModel`.)

### Pattern 4: Read-Only Settings Sections (V2-02)

**What:** Keep the working GET paths; remove the Save controls that 404; explain honestly.
**When to use:** Agents (`settings.tsx:397-445`) and Permissions (`settings.tsx:447-481`).

Current dead Save sites, quoted verbatim [VERIFIED: src/components/desk/settings.tsx:437, 475]:
```typescript
void api.patchConfig({ agent: { [name]: agent } }).then(() => setNote("Agent saved.")).catch((err: Error) => setNote(err.message));
```
```typescript
<Button onClick={() => void api.patchConfig({ permission: values }).then(() => setNote("Permissions saved.")).catch((err: Error) => setNote(err.message))}>
```

Conversion map (wording is discretion; structure is locked read-only):
- **Agents:** keep `api.agents()` load + agent selector for browsing; render `prompt` and `model` as read-only (e.g. `readOnly` textarea / disabled input, or static `<pre>`/text); delete the Save button block (`settings.tsx:431-441`); replace the misleading header line quoted verbatim [VERIFIED: src/components/desk/settings.tsx:417]: `Only fields OpenCode already supports are shown. Saving writes the agent block back through OpenCode config.` → honest note, e.g. "Agents are defined in OpenCode configuration and shown here read-only. Edit them in your OpenCode config." Keep `note` state for load errors.
- **Permissions:** keep `api.config()` load (`settings.tsx:451-461`); render each value (`ask`/`allow`/`deny`) as static text or disabled select; delete the Save button (`settings.tsx:475-477`); add explanatory note, e.g. "Permission defaults come from OpenCode configuration and are read-only here." The existing line [VERIFIED: src/components/desk/settings.tsx:464] `These are OpenCode's permission defaults. Live prompts still appear in the chat and are never auto-approved.` remains true — keep it.
- Style with existing semantic tokens (`text-muted`, `text-subtle`); inline `note` pattern only — no toasts (locked).

### Anti-Patterns to Avoid
- **try/catch around the dead chain instead of deletion:** locked decision is delete end-to-end; a caught 404 still ships dead code and a lying Save button.
- **New persistence route for deskModel:** `PATCH /api/settings` already exists and is the sanctioned desk-state write path.
- **Validating deskModel against the model list:** locked — accept any string; OpenCode is authoritative; Phase 8 reconciles.
- **Module mocking in tests:** project convention is DI; the probe seam exists precisely to avoid mocks.
- **Editing `src/routeTree.gen.ts` or adding router routes:** no routing changes this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test isolation from port 4096 | Port-override env vars, retry loops, test-only URL flags | Fourth DI seam (`probe?: ProbeImpl`) | Pattern already proven by spawn/sleep/kill; zero production behavior change |
| "Nothing listening" test environment | Stopping the user's live OpenCode; Docker | `unshare -Urn sh -c 'ip link set lo up && npm test'` | Verified working this session; isolated netns, loopback up, port 4096 free |
| State upgrade for deskModel | Migration script, schema version field | Existing `normalizeState` field-by-field rebuild | Every other field already upgrades silently this way |
| Secret redaction | New sanitizer library / per-route filters | Exact-match tweak inside existing `redactSecrets` | One-line semantic change; boundary stays single |
| Settings feedback | Toast system | Existing inline `note`/`error` state | Locked; pattern present in every Settings section |

**Key insight:** This phase's risk is not missing machinery — it is *over-building*. Every fix is a few lines inside an existing, tested pattern. The planner should reject any task that adds a file, route, dependency, or abstraction beyond the seam + field.

## Dead-Chain Deletion List (V2-02, complete at HEAD)

Repo-wide grep for `updateConfig|patchConfig` returns exactly these 9 code locations (plus the test below). All verified by read this session at `acfc44e`:

| # | File:Lines | Item | Action |
|---|-----------|------|--------|
| 1 | `src/server/opencode-client.ts:271-282` | `async updateConfig(patch, directory?)` → `PATCH /api/config` | Delete method |
| 2 | `src/server/api.ts:48` | `if (request.method === "PATCH" && route === "/config") return await patchConfig(runtime, request);` | Delete route line |
| 3 | `src/server/api.ts:303-311` | `async function patchConfig(...)` handler | Delete handler |
| 4 | `src/lib/desk/client.ts:150-151` | `patchConfig: (patch, scope?) => request("/api/config", { method: "PATCH", ... })` | Delete method |
| 5 | `src/components/desk/settings.tsx:314` | `await api.patchConfig({ model: fullModel });` in `setDeskDefault` | **Migrate** to `api.settings({ deskModel: fullModel })` (Pattern 3) |
| 6 | `src/components/desk/settings.tsx:437` | Agents Save → `api.patchConfig({ agent: ... })` | Delete with read-only conversion |
| 7 | `src/components/desk/settings.tsx:475` | Permissions Save → `api.patchConfig({ permission: values })` | Delete with read-only conversion |
| 8 | `src/server/api.test.ts:58` | mock `updateConfig: async (patch: Record<string, unknown>) => patch,` | Delete mock line |
| 9 | `src/server/api.test.ts:138-143` | test `"config changes are forwarded, not reimplemented"` (asserts PATCH /api/config → 200) | **Replace** with 404 regression: `PATCH /api/config` → `status 404` |

Also update the stale comment block at `settings.tsx:308-311` ("best-effort persist to OpenCode config (ignored when unsupported)") — persistence is now real and local. `GET /api/config` (`api.config`, `client.ts:149`) and `client.getConfig` (`opencode-client.ts:254-269`) are **live read paths — keep them** (bootstrap and Permissions section depend on them). [VERIFIED: grep + reads this session]

## Runtime State Inventory

This phase adds a state-schema field (silent upgrade) and deletes a dead route — inventory completed conservatively:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.paddy/state.json` (and legacy `~/.config/opencode-web/state.json` when `OPENCODE_WEB_HOME` points there — `stateFilePath` honors it [VERIFIED: src/server/state.ts:45-49]: `const override = env.OPENCODE_WEB_HOME?.trim();` / `const root = override || join(home, ".paddy");`). Existing files lack `deskModel`. | **Code edit only** — `normalizeState` maps missing/invalid → `""` on first load; `writeState` re-normalizes on next persist. No data migration, no script. `deskModel` is brand-new, so no legacy `[redacted]` contamination can exist in it. |
| Live service config | None — OpenCode global config is deliberately NOT written (the dead chain existed because v2 has no such write). No n8n/Datadog-style external config embeds the removed route. | None |
| OS-registered state | None — no scheduled tasks, launchd/systemd units, or pm2 registrations reference `patchConfig`, `updateConfig`, or `deskModel` (repo grep; CLI wrapper `bin/paddy.mjs` only starts the dev server). | None |
| Secrets/env vars | `OPENCODE_URL`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_BIN`, `OPENCODE_WEB_HOME`, `OPENCODE_WEB_TOKEN` — all read paths unchanged; no key renames. Test env scrub is test-local save/restore. | None |
| Build artifacts | None — no package rename, no new routes (`routeTree.gen.ts` untouched), no compiled artifacts carry the deleted symbols. | None |

## Common Pitfalls

### Pitfall 1: The existing redaction test asserts the OLD substring semantics — it WILL fail
**What goes wrong:** After switching to exact-match, `security.test.ts` test `"secrets are stripped from objects and strings"` fails: its fixture `note: "token sk-live-secret leaked"` only survives scrubbing under substring replacement. Quoted verbatim [VERIFIED: src/server/security.test.ts:84-92]:
```typescript
test("secrets are stripped from objects and strings", () => {
  const redacted = redactSecrets(
    { provider: { apiKey: "sk-live-secret", name: "openai" }, note: "token sk-live-secret leaked" },
    ["sk-live-secret"],
  );
  assert.equal(redacted.provider.apiKey, "[redacted]");
  assert.equal(redacted.note.includes("sk-live-secret"), false);
  assert.equal(JSON.stringify(redacted).includes("sk-live-secret"), false);
});
```
**Why it happens:** The test encodes prose-scrubbing, which the locked exact-match decision deliberately drops.
**How to avoid:** Rewrite this test in the same task as the semantic change: keep the `apiKey` key-redaction assertion; add an exact-equality case (string === needle → `"[redacted]"`); assert the prose case now survives (documents the locked tradeoff). Do not delete the test outright — replace its contract.
**Warning signs:** `npm test` red in `security.test.ts` immediately after the redaction edit.

### Pitfall 2: The api.test.ts config-forward test must be replaced, not just unmocked
**What goes wrong:** Deleting the route but keeping test `"config changes are forwarded, not reimplemented"` (`api.test.ts:138-143`) leaves a test asserting 200 from a route that now 404s.
**How to avoid:** Replace it with the inverse regression: `PATCH /api/config` with a patch body → `assert.equal(result.status, 404)`. This proves the chain is gone and guards against reintroduction. Delete the `updateConfig` mock line (`api.test.ts:58`) in the same task.
**Warning signs:** TypeScript error on the mock (method no longer on client) or a 404-vs-200 assertion failure.

### Pitfall 3: Missing the second probe call site (waitUntilReady)
**What goes wrong:** Routing only `connectInner:145` through the seam leaves `waitUntilReady:237` calling the real probe. With a live server on the spawned port (or 4096 fallback), the "never ready" test intent breaks and the test can attach or hang.
**How to avoid:** Replace both call sites; keep the private method as default. Grep `this.probe(` after the edit — zero direct calls should remain outside the default wrapper.
**Warning signs:** Test passes with nothing listening but is slow/flaky with a live server.

### Pitfall 4: SECRET_KEY still redacts VALUES under credential-shaped KEYS — provider-id-keyed maps
**What goes wrong:** Exact-match fixes string *values*, but key-based redaction (locked unchanged) still replaces values whose *key* matches `SECRET_KEY`. A map keyed by provider id `alibaba-token-plan` contains "token" → its values become `"[redacted]"`. This already happens today: `getProviders` returns `default` keyed by providerID [VERIFIED: src/server/opencode-client.ts:314-322], and the UI defends against it, quoted verbatim [VERIFIED: src/components/desk/settings.tsx:252]:
```typescript
const providerDefault = defaultModel === "[redacted]" ? "" : defaultModel;
```
The codebase documents the same hazard, quoted verbatim [VERIFIED: src/server/api.ts:281-285]:
```typescript
// Redact the provider list (it can carry headers/settings), but NOT the auth
// map: its keys are provider IDs (e.g. "alibaba-token-plan"), and key-based
// redaction would clobber any ID containing "token"/"key"/"secret" into a
// string, breaking `authMethods.some(...)`. getProviderAuth already strips
```
**How to avoid:** Route-level regression fixtures must assert survival of identifier **values in arrays/fields** (`all[].id`, `connected[]`, `providerID` fields) — not values under provider-id keys. Note for Phase 8: the dedicated models route should return `Model.Info[]`-style arrays with `providerID` fields, never a map keyed by provider id.
**Warning signs:** A fixture asserting `default["alibaba-token-plan"]` survives will fail even after the fix — that is correct, locked behavior; fix the fixture, not the redactor.

### Pitfall 5: Ambient environment redirects the probe even with the seam misapplied
**What goes wrong:** `OPENCODE_URL` set → attach before probe; ambient `OPENCODE_SERVER_PASSWORD` → real probe auth flips. The seam alone is not enough if a future test forgets injection.
**How to avoid:** Scrub all three env vars in the spawn test (Pattern 1). This machine currently has them unset [VERIFIED: existence-only shell check this session], but CI/other dev machines may not — the test must not depend on that.
**Warning signs:** Test green locally, red on another machine.

### Pitfall 6: bootstrap `model` vs `deskModel` confusion
**What goes wrong:** bootstrap already returns `model` (OpenCode project-config derivation, `api.ts:82-87`). Adding `deskModel` without precedence logic leaves reload seeding from OpenCode config — persistence invisible to the user (criterion 3 fails).
**How to avoid:** Apply the precedence line in bootstrap (Pattern 3): persisted `deskModel` wins when non-empty; config model is fallback. Keep both fields in the response — Phase 8 needs the distinction.
**Warning signs:** Save succeeds, state file contains `deskModel`, but reload shows the old model.

### Pitfall 7: chooseProject silently overrides the desk default
**What goes wrong:** `app.tsx:200` [VERIFIED: src/components/desk/app.tsx:200]: `if (typeof config.model === "string") setModel(config.model);` — switching projects re-seeds from project config, masking the persisted desk default.
**How to avoid:** Discretionary minimal guard: only apply when no desk default is active (e.g. `&& !model`). Full reconciliation is Phase 8's locked scope (`session.model.selected`); do not build it here. Leaving the line untouched still satisfies criterion 3 (reload/restart persistence) — the planner may defer this to Phase 8 with a note.
**Warning signs:** Desk default "resets" after project switch but survives reload.

### Pitfall 8: Over-scoping the attach-branch test
**What goes wrong:** Prior research (ARCHITECTURE.md step 3) suggests also asserting probe `"ok"` → attach. But `attach()` constructs a real `OpenCodeClient` with real `fetch` (`runtime.ts:194`) — there is no fetch/client-factory seam on the runtime. An attach-branch test would hit the network unless a second seam is added.
**How to avoid:** Skip it this phase. Locked scope is the spawn test + probe seam; adding a client-factory seam is scope creep. Document as a Phase 8+ option if attach coverage is wanted.
**Warning signs:** A task proposing `fetch` injection into `ControllerRuntime`.

## Code Examples

### Canonical V2-03 regression fixture (unit, security.test.ts)

Fixture identifier quoted verbatim from project requirements [CITED: .planning/REQUIREMENTS.md:26]: "provider IDs like `alibaba-token-plan`". Replacement token quoted verbatim [VERIFIED: src/server/security.ts:165]: `"[redacted]"`.

```typescript
// Proposed new test — needle "token" (length 5, passes the >= 4 filter) is a
// substring of the provider id. Old substring code produced
// "alibaba-[redacted]-plan"; exact-match must leave the payload byte-identical.
test("identifier payloads round-trip byte-identical through redaction", () => {
  const payload = {
    all: [{ id: "alibaba-token-plan", models: {} }],
    connected: ["alibaba-token-plan"],
  };
  const out = redactSecrets(payload, ["token"]);
  assert.deepEqual(out, payload);
  assert.equal(JSON.stringify(out), JSON.stringify(payload));
});

test("exact needle values are still redacted", () => {
  const out = redactSecrets({ a: "token", b: "alibaba-token-plan" }, ["token"]);
  assert.equal(out.a, "[redacted]");
  assert.equal(out.b, "alibaba-token-plan");
});
```
Reintroducing `out.split(needle).join(...)` fails the first test (`"alibaba-[redacted]-plan"` ≠ `"alibaba-token-plan"`).

### Route-level round-trip (api.test.ts)

Uses the existing `runtimeWithProject()` harness (fake client, connected status — no network). Set `runtime.state.connectionPassword = "token"` so `secretNeedles` registers it; extend the `getProviders` mock to return `{ all: [{ id: "alibaba-token-plan", models: {} }], connected: ["alibaba-token-plan"], default: {} }`; call `GET /api/providers`; assert `body.providers.all[0].id === "alibaba-token-plan"` and `body.providers.connected[0] === "alibaba-token-plan"` byte-identical. Do **not** assert survival of values under provider-id keys (Pitfall 4). The redaction boundary exercised is `api.ts:286` [VERIFIED: src/server/api.ts:286]:
```typescript
return json(200, { providers: redactSecrets(providers, secretNeedles(runtime)), auth });
```

### deskModel round-trip + silent upgrade (api.test.ts / state.test.ts)

```typescript
// api.test.ts — proposed
test("desk default model persists through settings and bootstrap", async () => {
  const { runtime } = runtimeWithProject();
  const saved = await call(runtime, "PATCH", "/api/settings", { deskModel: "alibaba-token-plan/model-a" });
  assert.equal(saved.status, 200);
  assert.equal((saved.body as { deskModel: string }).deskModel, "alibaba-token-plan/model-a");
  assert.equal(runtime.state.deskModel, "alibaba-token-plan/model-a");
  const boot = await call(runtime, "GET", "/api/bootstrap");
  assert.equal((boot.body as { model: string }).model, "alibaba-token-plan/model-a");
});

test("PATCH /api/config is gone", async () => {
  const { runtime } = runtimeWithProject();
  const result = await call(runtime, "PATCH", "/api/config", { patch: { model: "x/y" } });
  assert.equal(result.status, 404);
});
```
(`bootstrap` works offline in this harness: status is pre-set connected and `listSessions`/`getConfig` are mocked — `api.test.ts:20-28, 31-34, 57` [VERIFIED: src/server/api.test.ts:20-28].)

```typescript
// state.test.ts — proposed, mirrors the existing owned-password test pattern
test("deskModel upgrades silently and round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-state-"));
  const file = join(dir, "state.json");
  try {
    writeFileSync(file, JSON.stringify({ projects: [], appearance: "dark" })); // old file, no deskModel
    assert.equal(readState(file).deskModel, "");
    assert.equal(normalizeState({ deskModel: 42 } as any).deskModel, "");
    const state = { ...EMPTY_STATE, deskModel: "alibaba-token-plan/model-a" };
    writeState(file, state);
    assert.equal(readState(file).deskModel, "alibaba-token-plan/model-a");
    assert.equal(publicState(state).deskModel, "alibaba-token-plan/model-a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```
(`writeFileSync` import must be added to state.test.ts; existing imports quoted [VERIFIED: src/server/state.test.ts:3]: `import { mkdtempSync, rmSync } from "node:fs";`.)

### Settings save migration (settings.tsx setDeskDefault)

Current code quoted verbatim [VERIFIED: src/components/desk/settings.tsx:312-320]:
```typescript
onModelChange(fullModel);
try {
  await api.patchConfig({ model: fullModel });
  setNote("Desk default model saved in OpenCode.");
} catch {
  setNote("Desk default model set for this desk.");
} finally {
  setSavingModel(false);
}
```
**Proposed:** keep `onModelChange(fullModel)` first (instant UI); replace the try body with `await api.settings({ deskModel: fullModel }); setNote("Desk default model saved.");` and surface failures through the existing `error` state (`setError(err instanceof Error ? err.message : "Could not save the desk default model.")`) instead of the old silently-positive catch — persistence is now real, so a failed save must not claim success. Wording is discretion; inline note/error pattern is locked.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Desk default written to OpenCode global config (`PATCH /api/config`) | Desk default in Paddy state (`deskModel` via `PATCH /api/settings`) | v2 migration (`9a08c1b`); v2.3.2 has no remote global-config write [CITED: .planning/REQUIREMENTS.md:63] | Dead chain deleted this phase; Paddy state is the only correct home |
| Substring needle redaction | Exact whole-string needle redaction | This phase (V2-03) | Identifier payloads survive; prose-embedded secrets no longer needle-scrubbed (locked tradeoff) |
| Environment-dependent spawn test | DI probe seam + env scrub | This phase (V2-01) | `npm test` green with or without a live server on 4096 |

**Deprecated/outdated:**
- `opencode-client.updateConfig` / `api.patchConfig` / `PATCH /api/config` route: dead against v2 — deleted, not wrapped.
- `.planning/codebase/STACK.md` claims (zod, six suites): stale vs HEAD — do not plan from them.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Top-level `node:test` tests within one file run sequentially by default, making env save/restore inside the spawn test safe | Pattern 1 | LOW — even under concurrency, no other test in `runtime.test.ts` calls `connect()` or reads the scrubbed vars; the spawn test is the only connect caller [VERIFIED: full file read] |
| A2 | "Other 79 tests" (80 total) — count taken from CONTEXT.md. The runtime file's 7 tests (6 pass / 1 fail) were verified directly this session; the FULL suite was NOT RUN at research time (team build lock held by another session's long-running gate; the queued run confirmed a 900s lock timeout — exit 1, no test output — reported as NOT RUN per team rules, not retried) | Validation Architecture | LOW — count is cosmetic; the suite command is authoritative; executor's Wave 0 runs it |

All other claims are verified against HEAD source (read this session, line-cited), live environment probes, or cited project documents. No web research was performed (per orchestrator instruction; prior milestone research is the plan of record).

## Open Questions (RESOLVED)

1. **chooseProject model override (Pitfall 7)** (RESOLVED)
   - What we know: `app.tsx:200` re-seeds from project config on project switch; criterion 3 only requires reload/restart persistence.
   - What's unclear: whether to guard it now (`&& !model`) or leave it for Phase 8 reconciliation.
   - Recommendation: optional one-line guard as discretion; default to leaving it and noting Phase 8 ownership. Either satisfies the locked criteria.
   - **RESOLVED:** default adopted — the guard is LEFT for Phase 8 reconciliation (orchestrator direction); `app.tsx` is not modified this phase. Recorded in 07-03-PLAN.md `<objective>` ("the app.tsx:200 chooseProject guard is LEFT for Phase 8 reconciliation (RESEARCH Open Question 1 default; orchestrator direction)").
2. **Should `reset` clear deskModel?** (RESOLVED)
   - What we know: `reset` (`api.ts:112-122`) clears projects/appearance/connection fields; `deskModel` is GUI metadata like `appearance`.
   - What's unclear: CONTEXT does not mention reset.
   - Recommendation: add `runtime.state.deskModel = "";` to reset for consistency (one line, discretion). Existing reset test (`api.test.ts:203-211`) keeps passing; optionally extend it.
   - **RESOLVED:** recommendation adopted — reset clears `deskModel` (`runtime.state.deskModel = "";` beside the appearance reset). Recorded in 07-02-PLAN.md Task 2 action and must_haves truth ("reset clears deskModel alongside the other GUI metadata (discretion adopted per RESEARCH Open Question 2)"); the reset test is extended and renamed "reset clears passwords and deskModel".
3. **Attach-branch coverage** (RESOLVED) — resolved by Pitfall 8: skip this phase (needs a second seam); document for Phase 8+.
   - **RESOLVED:** recorded in 07-01-PLAN.md prohibition ("no attach-branch test and no fetch/client-factory seam on ControllerRuntime this phase") and Task 2 action (Pitfall 8 locked scope guard); consistent with D-01's locked scope (failing spawn test plus seam only).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v26.13.1 (floor 22+) | — |
| npm | test scripts | ✓ | 12.2.3 | — |
| OpenCode binary | live-server proof env | ✓ | v2.3.2 (`~/.opencode/bin/opencode`), live on 4096, 401 unauthenticated | netns proof covers the no-server env |
| `unshare` (user+net ns) | "nothing listening" proof | ✓ | `unshare -Urn` verified; `ip link set lo up` + bind 4096 OK inside ns | stop live server (disruptive — avoid) |
| `ip` | netns loopback up | ✓ | /usr/bin/ip | — |
| `flock` | team build lock | ✓ | lock contention observed at research time (another session building) | wait up to 900s; report NOT RUN on timeout |
| Disk space | heavy runs | ✓ | 981G free | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

**Two-environment proof commands (criterion 1):**
```bash
# Env A — live OpenCode holds 4096 (this machine, verified):
npm test
# Env B — nothing listening (isolated netns, verified working):
unshare -Urn sh -c 'ip link set lo up && npm test'
```
Note: inside the netns, loopback must be brought up first — `http.test.ts` binds an ephemeral loopback port (`server.listen(0, "127.0.0.1", ...)` [VERIFIED: src/server/http.test.ts:14]) and `freePort` binds 127.0.0.1; both fail with lo down.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node v26.13.1 built-in; `--experimental-strip-types` for TS) |
| Config file | none — script-defined in `package.json:22` [VERIFIED: package.json:22] |
| Quick run command | `node --experimental-strip-types --test src/server/runtime.test.ts` (< 5s) |
| Full suite command | `npm test` (3 script-stage `.mjs` suites + 9 TS suites) |

Full suite composition, quoted verbatim [VERIFIED: package.json:22]:
```
node --test scripts/install.sh.test.mjs scripts/link-cli.test.mjs scripts/with-app-env.test.mjs && node --experimental-strip-types --test src/server/security.test.ts src/server/http.test.ts src/server/opencode-client.test.ts src/server/api.test.ts src/server/runtime.test.ts src/server/normalize.test.ts src/server/state.test.ts src/components/autonomous-drink.test.ts src/components/desk/messages.test.ts
```
Script-stage suites are hermetic (install.sh `--help`/`--dry-run`/unknown-flag only; link-cli and with-app-env use temp dirs) [VERIFIED: file reads this session]. Of the TS suites, only the runtime spawn test touches the live environment (real probe + `freePort` bind); `http.test.ts` binds ephemeral loopback; all others are pure/fake-injected [VERIFIED: reads + greps this session].

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| V2-01 | spawn test passes with live server on 4096 | unit (DI) | `node --experimental-strip-types --test src/server/runtime.test.ts` | ✅ file exists; test verified RED at HEAD this session (output in Pattern 1) — fix in place |
| V2-01 | spawn test passes with nothing listening | unit (DI) + env proof | `unshare -Urn sh -c 'ip link set lo up && npm test'` | ✅ same test; netns command verified |
| V2-01 | full gate green both envs | suite | `npm test` (both commands above) | ✅ |
| V2-02 | PATCH /api/config → 404 (chain gone) | unit (route) | `node --experimental-strip-types --test src/server/api.test.ts` | ❌ Wave 0 — replaces deleted test at api.test.ts:138-143 |
| V2-02 | deskModel saves via PATCH /settings, returns in bootstrap, persists in state | unit (route + state) | `node --experimental-strip-types --test src/server/api.test.ts src/server/state.test.ts` | ❌ Wave 0 — new cases in existing files |
| V2-02 | old state file upgrades silently (missing/invalid → "") | unit | `node --experimental-strip-types --test src/server/state.test.ts` | ❌ Wave 0 — new case |
| V2-02 | Settings model Save works; Agents/Permissions read-only, no 404 | manual UAT + typecheck | `npm run typecheck` + end-of-phase human verify (no DOM test tooling per project constraint) | ❌ manual checklist |
| V2-03 | identifier payload byte-identical through redactSecrets | unit | `node --experimental-strip-types --test src/server/security.test.ts` | ❌ Wave 0 — new regression + rewrite of existing test:84-92 |
| V2-03 | identifier payload byte-identical through GET /api/providers | unit (route) | `node --experimental-strip-types --test src/server/api.test.ts` | ❌ Wave 0 — new case |
| V2-03 | exact secret values still redacted; key redaction unchanged | unit | `node --experimental-strip-types --test src/server/security.test.ts` | ❌ Wave 0 — rewritten existing test covers |

### Sampling Rate
- **Per task commit:** quick run of the touched suite(s), e.g. `node --experimental-strip-types --test src/server/security.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green in BOTH environments (live-server + netns) before `/gsd-verify-work`; plus `npm run typecheck` and `npm run lint`

### Wave 0 Gaps
All gaps are new/edited cases in **existing** co-located files — no new files, no framework install:
- [ ] `src/server/runtime.test.ts` — fix spawn test (probe injection + env scrub) — covers V2-01
- [ ] `src/server/security.test.ts` — rewrite test:84-92 to exact-match contract; add `alibaba-token-plan` regression — covers V2-03
- [ ] `src/server/api.test.ts` — delete mock:58 + test:138-143; add 404 regression, deskModel round-trip, identifier route round-trip — covers V2-02/V2-03
- [ ] `src/server/state.test.ts` — deskModel upgrade/round-trip/publicState case (+ `writeFileSync` import) — covers V2-02
- [ ] Manual UAT checklist: Settings model save → reload → persists; controller restart → persists; Agents/Permissions show data read-only with note; no Settings action errors — covers V2-02 UI half

## Security Domain

`security_enforcement: true`, ASVS level 1 (config.json). This phase shrinks attack surface (dead route removed) and changes one output-encoding behavior.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Existing loopback-peer + `OPENCODE_WEB_TOKEN` model untouched (`security.ts:44-78`) |
| V3 Session Management | no (unchanged) | Token→HttpOnly-cookie exchange untouched |
| V4 Access Control | yes (surface reduction) | Dead `PATCH /api/config` removed; workspace allowlist (`validateWorkspacePath`) untouched; no new routes |
| V5 Input Validation | yes | `readBody`/`safeJson` unchanged; `deskModel` guarded by `typeof === "string"` (accept-any-string is locked; OpenCode authoritative); redaction is output encoding, not input validation |
| V6 Cryptography | no (unchanged) | `timingSafeEqual`, `randomBytes` untouched; no new crypto |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Identifier corruption via redaction (prior incident: `alibaba-token-plan` → `alibaba-[redacted]-plan`) | Tampering | Exact-match needles + byte-identical regression fixtures in both test files (V2-03) |
| Secret leakage via prose after exact-match switch | Information disclosure | Locked tradeoff: dedicated credential fields still key-redacted (`SECRET_KEY` unchanged); exact secret values still redacted; needles unchanged (`connectionPassword` + env). Document in test contract |
| Secret leakage via state file | Information disclosure | Atomic 0600 writes / 0700 dir unchanged (`state.ts:60-71`); `deskModel` is non-secret GUI metadata; passwords still excluded from `publicState` |
| Dead write route as confused-deputy surface | Tampering | Route deleted end-to-end; 404 regression test guards reintroduction |
| Test attaching to arbitrary local server | Spoofing (test integrity) | Injectable probe + env scrub; no hardcoded endpoint reachable from the test path |

## Sources

### Primary (HIGH confidence — all read/probed this session at HEAD acfc44e)
- `src/server/runtime.ts` (full) — seams :32-40, constructor :65-75, connectInner :125-180, credentials :182-187, probe :224-233, waitUntilReady :235-242, spawnServer :244-281, freePort :410-425
- `src/server/runtime.test.ts` (full) — failing test :118-150, helpers :9-21, DI usage throughout
- `src/server/security.ts` (full) — SECRET_KEY :156, redactSecrets :159-184
- `src/server/security.test.ts` (full) — substring-dependent test :84-92
- `src/server/state.ts` (full) — AppState :21-33, EMPTY_STATE :35-43, stateFilePath :45-49, normalizeState :73-101, publicState :103-112
- `src/server/state.test.ts` (full), `src/server/api.ts` (full), `src/server/api.test.ts` (full), `src/server/opencode-client.ts` (full), `src/lib/desk/client.ts` (full), `src/components/desk/settings.tsx` (full), `src/components/desk/app.tsx` (bootstrap/chooseProject/SettingsPanel regions), `package.json` (full)
- Greps: `updateConfig|patchConfig` repo-wide (9 hits, all listed); `redactSecrets` call sites; network usage in all 9 TS suites; `publicState` consumers
- Live probes: port 4096 OPEN; `GET /api/info` unauthenticated → 401; ambient OPENCODE_* unset (existence-only); `unshare -Urn` + lo-up + bind-4096 verified; Node v26.13.1 / npm 12.2.3 / opencode v2.3.2; disk 981G free
- `.planning/phases/07-v2-hardening-foundation/07-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json` (read in full)

### Secondary (MEDIUM confidence — project documents, prior research)
- `.planning/research/SUMMARY.md`, `ARCHITECTURE.md`, `PITFALLS.md` — prior milestone research (plan of record); design cross-checked against HEAD, one deviation noted (Pitfall 8: attach-branch test needs a second seam)
- `.planning/V2-MIGRATION-SPEC.md` — live-captured v2.3.2 endpoint map (updateConfig row :37; getConfig row :36)
- `.planning/REQUIREMENTS.md:63` — "v2 has no remote global-config write (`PATCH /api/config` → 404)" (project authority; not re-probed live this session to avoid write attempts against the user's server)

### Tertiary (LOW confidence)
- None load-bearing. The failing spawn test was run directly this session (output pasted in Pattern 1). The FULL `npm test` suite was NOT RUN at research time — the team build lock was held by another session and the queued run confirmed a 900s lock timeout (exit 1, no test output); per team rules a lock timeout is reported as NOT RUN, not retried in a loop. The executor's Wave 0 must run the full suite in both environments as the V2-01 exit proof.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero installs; runtime versions probed live
- Architecture: HIGH — every integration point read at HEAD with line numbers; failure mechanism reproduced via live probes
- Pitfalls: HIGH — Pitfalls 1/2/4 derived from verbatim test/code reads; others from established project patterns

**Research date:** 2026-11-21
**Valid until:** 2026-12-21 (stable hardening scope; re-verify line numbers if HEAD moves before execution)