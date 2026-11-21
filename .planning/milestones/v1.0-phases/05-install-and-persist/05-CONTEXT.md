# Phase 5: Install and Persist - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Paddy installs from a clean checkout on Linux and Windows and a container keeps its state across restarts. Covers PKG-01..PKG-04.

</domain>

<decisions>
## Implementation Decisions

### the agent's Discretion
All implementation choices are at the agent's discretion — infrastructure/packaging phase. Container state at documented path; install.sh checksum verification; working paddy command on Linux/Windows.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- bin/paddy.mjs, install.sh, install.ps1, docker-compose.yml, Dockerfile, startup.sh.
- src/server/state.ts (OPENCODE_WEB_HOME).

### Established Patterns
- State file atomic 0600; dir 0700.

### Integration Points
- PADDY_HOME (wrapper) vs OPENCODE_WEB_HOME (controller).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
