# Task: fix-projects-and-agents — add-project dialog; dedupe Build agent

## Goal

Two GUI defects: (1) projects cannot be added via the GUI — the flow uses
`window.prompt`, which is suppressed in some contexts and is a documented repo
anti-pattern; (2) the sidebar Agent select shows "Build" twice.

## Baseline

- Base SHA: `f0d7422` (main, pushed; in sync with origin)
- `git status --short` before delegation: **clean**

## Orchestrator evidence (live, this session)

- `POST /api/projects` works server-side: fresh dir → 201 + project created;
  existing path → 200 + reuse. `DELETE /api/projects/:id` works. Active-project
  side effects restored after testing.
- The add flow in the GUI: `app.tsx:746-759` `addProject()` uses
  `window.prompt("Absolute path to the project")` (repo anti-pattern:
  "window.prompt for product flows"). When prompt() is blocked/suppressed the
  button appears dead.
- Agent duplicate: `app.tsx:1033` hardcodes `<option value="">Build</option>`
  (default = send without agent param, `app.tsx:916` `agent || undefined`), AND
  the fetched list contains "Build" as its first entry → two "Build" rows.
- Live payload from `/api/agents` (79 agents, names: `Build, General, Explore,
  Compaction, Title, Summary, Plan, orchestrator, architect, backend, frontend,
  reviewer, …`): **no duplicates inside the payload itself**. `agentNames()`
  (`app.tsx:1756-1758`) maps names without dedupe.
- Open question for the implementer: fetched names are display-cased ("Build");
  `api.send` passes the chosen name as the agent identifier to OpenCode.
  Verify OpenCode accepts the payload `name` as the agent id (check the server
  send route + `opencode-client.ts`, and OpenCode's `/api/agent` shape). If
  OpenCode needs a different identifier (e.g. lowercase), normalize; if the
  payload name is already the correct identifier, prove it.

## Scope

- `src/components/desk/app.tsx` — the add-project flow and the agent select.
- Optional small pure helpers (kebab-case module, node:test) if logic warrants.
- No server changes unless the agent-identifier investigation proves a server
  bug — in that case STOP and report instead of widening the change.

## Non-goals

- No changes to the server addProject route (verified working), the settings
  Agents section, session flows, or unrelated components.
- No dependency changes. No redesign of the sidebar.

## Acceptance criteria

### A. Add project via GUI

- AC-A1: A proper in-app dialog (or inline panel) replaces `window.prompt`:
  absolute-path input (+ optional name), submit, cancel. Adding a project via
  the GUI works in a normal tab end-to-end (live check).
- AC-A2: Dialog a11y follows repo patterns (cf. archive-notice work, permission
  cards): Escape closes, focus moves into the dialog, focus returns to the "+"
  trigger; no background scroll issues.
- AC-A3: Server validation errors (400, e.g. relative/nonexistent path) render
  inside the dialog, not the global error bar; duplicate path → server 200
  reuse → selects the existing project as today.
- AC-A4: The existing wiring is preserved: on success `setProjects` merge +
  `chooseProject` (and the `newChat`/`ensureSession` path at `app.tsx:841`
  that also calls `addProject()`).

### B. Agent list

- AC-B1: "Build" appears exactly once in the sidebar Agent select; every other
  agent appears once.
- AC-B2: Default semantics preserved: the no-agent default (value "") remains
  reachable — selecting "Build" sends without an agent param (OpenCode's
  default agent) or with the correct identifier per the investigation; the
  initial state still sends without an agent.
- AC-B3: The agent-identifier question is answered with evidence (code path +
  live check); if a normalize fix was needed, it is applied and tested.
- AC-B4: `agentNames` gains dedupe (defensive, cheap) with a unit test in an
  already-listed suite.

### Both

- AC-C1: `npm run typecheck`, `npm run lint`, `npm test` pass.
- AC-C2: Live verification against the running dev server (127.0.0.1:8080) via
  Playwright: add a real temp project via the new dialog, see it selected, then
  remove it (leave user state as found); agent dropdown shows "Build" once.

## Owners

- Implementer: frontend
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented (AddProjectDialog replaces window.prompt — focus trap, Escape,
  focus return, inline role=alert validation, both callers wired, promise
  re-open safe; agent select built from payload id/name, default row labelled,
  hardcoded duplicate removed, agentNames → agentOptions with id-aware dedupe.
  AC-B3 verdict: OpenCode wire contract requires Agent.ID, not display name —
  Paddy previously sent the display name and the turn failed with
  AgentNotFoundError; now sends id, live-verified general → "OK".)
- [x] Reviewed (PASS_WITH_NOTES, no findings; live Playwright reported not
  reproduced — code-verified; noted: Build row still means send-no-agent by
  design; /api/agents can return [] for a fresh project until OpenCode knows
  the directory — pre-existing; no abort on in-flight add — declared)
- [x] Committed