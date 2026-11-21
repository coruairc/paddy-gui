# Phase 3: Repository Cleanup and Honest Docs - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning

<domain>
## Phase Boundary

The repository contains only Paddy — no app-builder subsystems in the build, no dependencies nothing imports, and no documentation for commands or variables that do not exist. Covers CLN-01..CLN-04.

</domain>

<decisions>
## Implementation Decisions

### the agent's Discretion
All implementation choices are at the agent's discretion — pure infrastructure/cleanup phase. Delete Grok/PWA/preview/PGlite plugins and template subsystems; remove unused heavy deps; rewrite SELFHOST.md/README.md/selfhost.env.example to describe only shipped behavior.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- vite.config.ts plugins: opencodeControllerPlugin, appEnvPlugin, grokPwaPlugin, pgliteBootstrapPlugin, authPopupPlugin.
- scripts: preview.mjs, write-atomic.mjs, migration-plan.mjs, etc.
- server/middleware/grok-pwa.ts.

### Established Patterns
- kebab-case files; node:test; TypeScript strict.

### Integration Points
- package.json deps; tsconfig; eslint config.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
