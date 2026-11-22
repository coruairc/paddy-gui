# Pause Handoff — 2026-11-22 (post-v1.1 desk polish)

**Milestone:** v1.1 OpenCode v2 Desk (phases 7–10) is complete. After it, post-milestone
desk work landed as reviewed PRs (outside GSD phases). Resume with OpenCode + GSD.

## State at pause

| Item | State |
|------|-------|
| main | `6bdb796` (PR #21 merge). Typecheck OK, lint 0 errors / 5 old warnings, 261 TS + 23 script tests, build OK |
| PR #22 `fe/archive-notice-a11y` | Open, **awaiting Reviewer**. Head includes `3af2622` plus this handoff doc commit. 271 TS + 23 script tests, build OK |
| Other open branches | None |

## Merged since v1.1 (all Reviewer-approved)

| PR | Merge | What |
|----|-------|------|
| #16 | `008047d` | Files changed per turn + inspector Changes tab; shiki Monokai highlighting (lazy); diff/session routes mask secrets, 5 MB cap, `^msg_` ids |
| #17 | `96a1c6c` | Green user chat bubbles (`--color-bubble*` tokens, AA contrast both themes) |
| #18 | `4f1e173` | 32 MiB streamed upstream cap; mask configured passwords ≥4 chars; mobile footer count; per-turn cache |
| #19 | `5f1bcda` | Diff cache/expansion keyed by session+turn; retryable stream resets; `filesError`; union-of-ranges masking |
| #20 | `b5ca228` | Changes tab state owned by session (no stale files after archive); zero counts hidden; work preview; no shell scroll band |
| #21 | `6bdb796` | Archive Undo notice (PATCH `archived:false`); `~N files touched` → net `Files changed (N)`; `relative` shell root |

## Resume

1. Check Reviewer's verdict on PR #22 (report will be `/workspace/paddy-gui-review/REVIEW-pr22-*.md` on the bot box, or the PR comments). If approved, `gh pr merge 22 --merge` and delete the branch.
2. Verify main: `npm run typecheck && npm run lint && npm test && npm run build`.
3. Start the next milestone with GSD (`/gsd-new-milestone` or plan from the Deferred list below).

## Known open items (all LOW / deferred)

- **DOM/render tests:** repo has no jsdom/RTL setup. App wiring (archive notice handlers, Changes panel wiring, focus moves) is covered only by pure-helper tests + browser checks. Reviewer's PR #21 F1 asks for render tests — decide whether to add a DOM test setup (new dev dependency).
- **AUTO-01:** Playwright smoke tests in CI (would cover the above).
- Restored chat jumps to top of sidebar (server bumps `time.updated`) — server behaviour, left alone.
- Mobile footer uses the snapshot "~N files touched" count, not the net diff count.
- Live-turn behaviour with a real paid model call not exercised in browser tests (mock OpenCode 2.3.2 used).
- `npm audit`: 17 advisories, unchanged from before this work.

## Rules (team)

- Commit only files you changed, by name; never `git add -A`. No force push, no tags.
- Nothing merges to main without Reviewer review.
- Never commit or log API keys/passwords.
