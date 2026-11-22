---
phase: 09-slash-command-palette
created: "2026-11-22"
status: approved
design_system: none
---

# Phase 9 — UI Design Contract: Slash Command Palette

Binding visual and interaction contract. Where this file and a plan disagree, this file wins on markup detail. Semantic Tailwind tokens only; no raw palette classes; light and dark both supported.

## Design System

| Token group | Values |
|---|---|
| Spacing | 4 / 8 / 12 / 16 / 24 / 32; 44px minimum row height |
| Type | 11px metadata, 12px labels, 14px body; weights 400 / 500 only |
| Color | `bg-bg` canvas, `bg-surface` hover/active fill, `bg-elevated` palette shell, `text-fg` primary, `text-muted` secondary, `border-border` dividers, `text-accent` selection/focus, `text-danger` errors, `text-warn` warnings |
| Radius/shadow | `rounded-xl` palette, `rounded-md` rows, `shadow-[var(--shadow-border-hover)]` shell |
| Icons | lucide 16px (`Search`, `Terminal`, `CornerDownLeft`, `AlertCircle`, `SearchX`, `Boxes`, `Loader`) |

No new dependencies, no component library, no portal.

## 1. Trigger and placement

- The palette is **composer-anchored**: it opens above the composer textarea when the draft begins with `/`.
- It is inline in the composer column (absolutely positioned over the thread), `bottom-full mb-2`, width matching the composer (`max-w-2xl`), `z-40`.
- No separate trigger button. The composer remains the entry point, matching the TUI muscle memory.
- The palette never covers the send button; the composer stays visible and interactive for the draft.

## 2. Palette shell

```
absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-xl
border border-border bg-elevated shadow-[var(--shadow-border-hover)]
focus-within:ring-2 focus-within:ring-accent/40
```

- `id="command-palette"`, no `role="dialog"`, no focus trap.
- Height cap `max-h-[min(22rem,50dvh)]`, internal scroll with `scrollbar-thin` and `overscroll-contain`.
- Renders exactly one of: **list**, **loading**, **offline**, **error**, **empty**, **no-match**.

## 3. Search row (list / no-match)

- `flex items-center gap-2 border-b border-border px-3 py-2`.
- `Search` icon 14px `text-muted aria-hidden`.
- The **composer textarea itself remains the combobox**: no second input. The palette reads the composer's `/…` text as its filter query. This avoids focus fights and keeps the draft alive.
  - Therefore the listbox is controlled by `aria-controls="command-listbox"` on the composer textarea while open, with `aria-activedescendant` set by the composer's keydown handler (see §6).
- A muted hint line shows the active query: `Commands matching “{query}”` with the query clipped at 40 characters.
- `sr-only` announcer `role="status" aria-live="polite"`: `{n} commands` / `1 command` / `No commands match`.

## 4. Grouping and ordering

- Flat list, alphabetical by command name (the v2 API carries no namespace).
- No grouping headers this phase; the name is the primary identifier and the description is the secondary line.

## 5. Command row

- `<div role="option" tabIndex={-1} id="command-option-{slug}" aria-selected={active}>`.
- Base: `flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 border-l-2 border-transparent px-3 py-2 transition-colors`.
- Line 1: `flex min-w-0 items-center gap-2` → `Terminal` icon 14px `text-muted aria-hidden`, then `/name` in `font-mono text-sm text-fg truncate`.
- Line 2: description `truncate text-[11px] text-muted` (fallback: `No description`).
- Active (`data-active="true"`): `bg-surface border-accent`.
- Hover: `bg-surface` (CSS only).
- Ghost/completion row is shown when `/name` exactly matches a command: `Press Enter to run /name` with `CornerDownLeft` icon 14px, and a muted `with args: /name arg1 arg2`. Selecting it dispatches.
- Rows are never disabled.

## 6. Keyboard contract (composer owns keys while open)

| Key | Behavior |
|---|---|
| ArrowDown / ArrowUp | Move active row one step, clamped, no wrap; scroll into view |
| Home / End | First / last row |
| Enter | Dispatch the active command with the current args (or, when exactly `/name` is typed, dispatch that command) |
| Tab | Complete the highlighted `/name ` into the composer, keep palette open for args |
| Escape | Close the palette, keep the draft, focus the composer |
| Any character | Recompute the query and reset the active row to the first match |
| Backspace past `/` | Close the palette; the draft remains ordinary text |

- Enter is only intercepted when the palette is open and a command is active; otherwise it sends the message as today.
- Shift+Enter always inserts a newline.
- The composer draft is never cleared by opening, closing, completing, or escaping the palette.

## 7. Dispatch feedback

- On dispatch: the palette closes, the draft is cleared, and the user echo shows `/name args` immediately (pending bubble).
- When the server's expanded user message arrives, it **replaces** the pending echo in place (no duplicate bubble).
- Success needs no extra chrome; the thread shows the expanded message and the agent's work.
- Failure: a persistent in-thread **system message** with `AlertCircle` 14px `text-danger`, the server's message verbatim (e.g. `Command not found: does-not-exist`), and `font-mono` styling for the command name. No toast.

## 8. State panels

Common shell: `flex flex-col items-center gap-2 px-4 py-8 text-center`. Heading `text-xs font-medium text-fg`; body `text-[11px] text-muted max-w-[34ch]`.

| State | Visual | Copy |
|---|---|---|
| Loading | `Loader` spinning 16px + heading | `Loading commands…` |
| Offline | `AlertCircle` 16px `text-muted` | `OpenCode is offline` / `Reconnect from the header to load commands.` |
| Error | `AlertCircle` 16px `text-danger` | `Could not load commands` + `line-clamp-2` detail + `Retry` outline button (reads `Retrying…`, disabled, while in flight) |
| Empty (connected) | `Boxes` 16px `text-muted` | `No commands available` / `OpenCode returned no commands. Add command files in your project, then reopen.` |
| No match | `SearchX` 16px `text-muted` | `No commands match “{query}”` + `Clear` outline button (resets the composer draft to `/` and refocuses) |

Precedence: **offline → error → first-load loading → empty → no-match → list**. Never a blank panel.

## 9. Copywriting contract

| Element | Copy |
|---|---|
| Query hint | `Commands matching “{query}”` |
| Ghost row | `Press Enter to run /{name}` |
| Args hint | `with args: /{name} …` |
| Unknown command | server message verbatim |
| Async failure | server message verbatim, prefixed `Command failed: ` only if the server gives no message |
| Announcer | `{n} commands` / `1 command` / `No commands match` |
| Empty | `No commands available` |
| Error | `Could not load commands` |
| Offline | `OpenCode is offline` |

## 10. Responsive and motion

- Palette width is clamped to the composer width; at `max-sm` it uses the full composer width with `mx-1`.
- Height cap `min(22rem, 50dvh)`; list scrolls internally.
- No entrance animation. Color transitions 150ms; the global `prefers-reduced-motion` override neutralizes them.
- No layout shift in the composer when the palette opens (it is absolutely positioned).

## 11. Non-visual hooks (for Playwright / Phase 10)

`data-command-palette`, `data-command-palette-state="list|loading|offline|error|empty|no-match"`, `data-command-option="{name}"`, `data-active="true|false"`, `data-command-echo` on the pending bubble.

## 12. ARIA contract

| Element | Attributes |
|---|---|
| Composer textarea (while open) | `role="combobox"`, `aria-expanded="true"`, `aria-controls="command-listbox"`, `aria-activedescendant={activeOptionId}`, `aria-autocomplete="list"`, `aria-label="Message Paddy"` retained |
| Composer textarea (closed) | no combobox role; plain textarea as today |
| Listbox | `role="listbox" id="command-listbox" aria-label="Commands"` |
| Option | `role="option" id="command-option-{slug}" aria-selected={active}` |
| Announcer | `role="status" aria-live="polite"` |
| Palette shell | no role |

`{slug}` = command name with every character outside `[A-Za-z0-9_-]` replaced by `_`.

## 13. UI Considerations

| Category | Element | Status | Resolution |
|---|---|---|---|
| empty | catalog (0 commands) | covered | Explicit empty panel; one cold-start retry before showing it |
| empty | filtered results | covered | No-match panel with the clipped query and Clear |
| loading | catalog fetch | covered | Loading panel; composer keeps its text |
| error | fetch failure | covered | Error panel + Retry, stays visible while retrying |
| error | command dispatch failure | covered | Persistent in-thread system message with the server text |
| offline | disconnected | covered | Offline panel, no list |
| populated | command list | covered | Flat alphabetical rows, name + description, active bar |
| partial | missing description | covered | `No description` fallback |
| overflow | many commands | covered | Internal scroll with capped height |
| overflow | long names/descriptions | covered | `truncate` + `title` |
| focus | composer/palette | covered | Composer owns focus throughout; Esc closes and refocuses; focus never trapped |
| reduced-motion | transitions | covered | No entrance animation; global reduced-motion override |
| contrast | metadata and errors | covered | `text-muted` and `text-danger` on `bg-elevated` meet AA |
| long-text | query in no-match | covered | Clipped at 40 chars with ellipsis |
| keyboard | full nav + dispatch | backstop | Manual/Playwright checklist at Phase 10 |
| backstop | aria-activedescendant | backstop | Manual/Playwright check (no jsdom/RTL) |
