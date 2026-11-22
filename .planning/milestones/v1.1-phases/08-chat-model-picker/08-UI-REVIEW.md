---
phase: 08-chat-model-picker
audited: 2026-11-22
status: pass
score: 5.5/6
pillars:
  copy: pass
  visuals: pass
  color: pass
  typography: pass
  spacing: pass
  motion: pass
---

# Phase 8 UI Review — Chat Model Picker

Retroactive visual/UX audit against `08-UI-SPEC.md`, the live desk, and the project's design system.

| Pillar | Verdict | Notes |
|---|---|---|
| Copy & clarity | PASS | Trigger reads the model name or `Choose model`; every state panel has specific, actionable copy (`OpenCode is offline`, `Could not load models` + Retry, `No models available` + Settings pointer, `No models match “{query}”` + Clear filter). Stale banner names the saved key and the fallback. |
| Visual hierarchy | PASS | Two-line rows (name, then muted metadata) with sticky provider headers and counts; active row uses an accent left bar + surface fill; selected row carries a check; default carries a badge. Deprecated rows are muted, never opacity-faded. |
| Color | PASS | Semantic tokens only (`bg-bg/surface/elevated`, `text-fg/muted`, `border-border`, `text-accent/warn/danger`). Accent is restricted to selection/focus. No raw palette classes. |
| Typography | PASS | 11/12/14 px scale, 400/500 weights. Metadata and group headers stay at 11px muted; names truncate with titles. |
| Spacing & layout | PASS | 4/8/12/16/24 scale; 44px option rows; popup width `min(24rem, 100vw - 1.5rem)` and height cap with internal scroll; sticky headers. |
| Motion & states | PASS | 150ms color/transform only, no entrance animation; reduced-motion is covered by the existing global override. All six popup states render; cached reopen avoids a loading flash. |

## Deductions

- **−0.5:** The trigger's chevron renders at 16px rather than the spec's 14px because `Button`'s `[&_svg]:size-4` wins on specificity. Functionally harmless; noted for a future primitive-level fix.

## Evidence

Live Playwright run on the real desk: grouped list (5 groups, 160 rows), filter, keyboard selection, focus restore, stale banner, offline/error/empty/no-match panels, persistence and reload. Details in `08-UAT.md`.
