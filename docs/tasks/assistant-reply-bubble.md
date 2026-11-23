# Task: assistant-reply-bubble — OpenCode replies in a grey chat bubble

## Goal

Assistant ("Paddy") replies render inside a grey rounded bubble so the desk reads
like a chat. User prompts already have a green bubble; assistant replies are
currently plain Markdown on the desk background (`app.tsx` MessageView
assistant branch).

## Baseline

- Base SHA: `3d15757` (main; picker + real-time fixes committed)
- `git status --short` before delegation: **clean**

## Current state (orchestrator analysis)

- User bubble: `app.tsx:1556-1567` — `rounded-2xl rounded-br-md bg-bubble px-4 py-3
  selection:bg-black/30 selection:text-bubble-fg`, max-w `min(100%,36rem)`,
  right-aligned; tokens `--color-bubble/-fg/-muted` in `styles.css:13-15` (dark)
  and `:41-43` (light).
- Assistant branch: `app.tsx:1569-1601` — HelixMark avatar + "PADDY" label +
  activity rows + `<Markdown text={...} />` + error line, no bubble.
- `styles.contrast.test.ts` locks WCAG AA (>= 4.5:1) for bubble tokens in both
  themes, including the selected-text composite over the bubble. The user bubble
  also declares its own selection colours (regex-checked against app.tsx source).

## Scope

- `src/components/desk/app.tsx` — MessageView assistant branch layout only.
- `src/styles.css` — new theme tokens for the reply bubble (dark + light).
- `src/styles.contrast.test.ts` — extend the guard to the new tokens.
- Optional small pure helpers only if genuinely needed.

## Non-goals

- No changes to user bubbles, system messages, activity rows, permission cards,
  the composer, or any other component.
- No dependency changes. No Markdown renderer changes.

## Acceptance criteria

- AC-1: Assistant reply text renders inside a grey rounded bubble in BOTH
  themes; user/system/activity rendering is unchanged.
- AC-2: Chat-like shape: bubbles mirror the user bubble's corner treatment
  (e.g. `rounded-2xl rounded-bl-md`), stay left-aligned with the avatar outside
  the bubble, and have a max-width so long replies don't span the panel; short
  replies look natural.
- AC-3: Markdown inside the bubble stays correct: headings, lists, links,
  inline code, and block code render properly; code blocks scroll within the
  bubble instead of overflowing it or the panel.
- AC-4: New tokens (`--color-reply-bubble`, `-fg`, muted if used) defined for
  dark and light; light theme reads as a light grey; dark theme is a grey that
  still reads as a chat bubble against the dark bg.
- AC-5: `styles.contrast.test.ts` extended: reply text on the reply bubble is
  >= 4.5:1 in both themes; if the bubble declares its own selection colours,
  guard the selected-text composite like the user bubble test does.
- AC-6: The assistant error line stays visible (keep `text-danger` semantics;
  inside or under the bubble — implementer's choice, consistent).
- AC-7: `npm run typecheck`, `npm run lint`, `npm test` pass; live visual check
  in both themes (switch `data-theme`) with screenshot or DOM evidence; no
  regressions on long/short/code-heavy replies.

## Owners

- Implementer: frontend
- Reviewer: reviewer (gate before any commit)

## Status

- [x] Implemented (dark: #232326/#adc4a8, light: #e7e7e5/#18181b; error inside
  bubble; 16/16 contrast guard tests incl. selection composite and the
  prose --color-fg coupling; live DOM check both themes, code-block containment
  verified; -fg deliberately equals --color-fg because Markdown hard-codes
  text-fg — the test locks both on the bubble so they cannot drift)
- [x] Reviewed (PASS_WITH_NOTES, no findings; reviewer recomputed all ratios
  and confirmed the coupling; noted light-mode separation is fill-only since
  --shadow-border is not overridden for light — accepted, larger step than
  elevated-on-page; danger-on-bubble not yet in the contrast suite = follow-up
  candidate)
- [x] Committed