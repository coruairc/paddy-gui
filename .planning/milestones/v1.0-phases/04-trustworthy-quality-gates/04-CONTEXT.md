# Phase 4: Trustworthy Quality Gates - Context

**Gathered:** 2026-11-21
**Status:** Ready for planning

<domain>
## Phase Boundary

A contributor can open a pull request and have lint, typecheck, and the full test suite run and pass without local guesswork. Covers QUAL-01..QUAL-04.

</domain>

<decisions>
## Implementation Decisions

### the agent's Discretion
All implementation choices are at the agent's discretion — pure infrastructure/quality phase. Fix lint errors, wire full test suite, add CI.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- eslint.config.mjs, tsconfig.json, package.json scripts.
- bin/paddy.mjs (unreachable code error).
- src/server/api.ts (prefer-const).

### Established Patterns
- node:test runner; lint via eslint.

### Integration Points
- GitHub Actions (new .github/workflows/ci.yml).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
