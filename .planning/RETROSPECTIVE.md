# Retrospective

## Milestone: v1.1 — OpenCode v2 Desk

**Shipped:** 2026-11-22
**Phases:** 4 | **Plans:** 9

### What Was Built

- Hermetic quality gate with an injectable probe seam and env scrub.
- Exact-match redaction with byte-identical identifier fixtures.
- Durable `deskModel` default with silent state upgrade and bootstrap precedence.
- Provider-grouped, keyboard-first model picker reconciled live across tabs.
- Server-sourced slash-command palette with args-only dispatch, in-thread errors, and live invalidation.
- Live two-tab end-to-end verification of both trust properties.

### What Worked

- Planning the data path before the UI kept each phase's review surface narrow.
- Pure helper modules (`models.ts`, `commands.ts`, `messages.ts`) made trust-critical logic testable under `node:test` without DOM tooling.
- Live contract research (captured from v2.3.2) prevented invented endpoints and settled `text`/inbox semantics before planning.
- Code review caught two real defects (the `/config` handler gap and the command catalog not loading on open) that unit tests alone missed.

### What Was Inefficient / Problems Encountered

- The fixed `/tmp` fake-binary path still risks parallel-run contention (noted, not fixed).
- OpenCode's command registry scan is lazy; hot-added commands were not instantly visible in the first probe.
- Shared-file edits by later phases stale earlier verification fingerprints; re-verification at HEAD was needed before the audit.
- The milestone-complete CLI expects versioned milestone headings that this ROADMAP format does not use, so archival was performed with the same documented steps manually.

### Patterns Established

- Project → redact → assemble for identifier fields crossing `redactSecrets`.
- Composer owns the combobox; palettes are pure presenters.
- Session truth vs desk preference is modelled explicitly (`modelSource`) so catalog fallback cannot misrepresent what runs.
- One additive SSE variant per new invalidation source, with debounced refetch.

### Key Lessons

- Verify the *wiring* of trust properties live: both defects found this milestone were "the code exists but the path never runs".
- Keep fingerprint-covered source lists narrow, or accept re-verification at HEAD.
- Treat the server as authoritative for command existence and expansion; the client only previews.

### Cost Observations

- Model mix: single-agent orchestration with targeted subagents.
- Sessions: 1 autonomous run spanning phases 7-10.
- Notable: parallel plan execution was disabled (single worktree), so sequential waves were the dominant cost.
