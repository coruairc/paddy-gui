# Requirements: Paddy

**Defined:** 2026-11-21
**Core Value:** A browser UI you can point at a real project and drive an OpenCode session through, start to finish, with no surprises.

## v1 Requirements

Requirements for milestone v1.1 (OpenCode v2 Desk). Each maps to exactly one roadmap phase. Every phase also carries its own observable success criteria (per-phase verification).

### Model Picker

- [x] **MODEL-01**: User can pick a model from the chat header/composer (not only Settings) via a popup grouped by provider, with live filtering, full keyboard control, and the always-visible active model
- [x] **MODEL-02**: The chosen desk default persists in Paddy state across browser reloads, seeds session resume, and the header reconciles against OpenCode's `session.model.selected` events so it never drifts from what actually runs
- [x] **MODEL-03**: The picker surfaces model metadata OpenCode already provides (status, context window, release date) so the user can choose informed

### Slash Commands

- [x] **CMD-01**: User typing `/` in the composer sees a filterable, keyboard-first palette of OpenCode commands (name + description) sourced from `GET /api/command`
- [x] **CMD-02**: Submitting `/name args` runs the command via `POST /api/session/{id}/command`; unknown or failing commands surface their error in the thread as a system message, not a transient toast
- [x] **CMD-03**: The command list refreshes when OpenCode emits `command.updated` while the desk is open

### v2 Hardening

- [x] **V2-01**: `npm test` is green in a clean environment — the runtime spawn test passes whether or not a live server holds port 4096 (probe seam injection, no hardcoded endpoint in the test path)
- [x] **V2-02**: No Settings action 404s — the dead `updateConfig` chain is removed, the desk default model persists in Paddy state (`~/.paddy/state.json`), and the Agents/Permissions sections are read-only or fixed rather than silently failing
- [x] **V2-03**: Secret redaction uses exact-match needles with a byte-identical round-trip regression test, so identifier-shaped payloads (provider IDs like `alibaba-token-plan`) flowing through new model/command routes are never corrupted

### Verification

- [ ] **VER-05**: Model switch and command execution are verified end-to-end in the live desk (picked model is what runs; `/name args` produces visible results)
- [ ] **VER-06**: Multi-tab trust check — two open tabs agree on the active model after a switch, and command outcomes fan out to both via SSE

## v2 Requirements

Deferred to a future milestone. Tracked but not in this roadmap.

### Automation

- **AUTO-01**: Playwright browser smoke tests run in CI
- **AUTO-02**: Automated upgrade path from `~/.config/opencode-web` state

### Experience

- **UX-01**: Theme customization beyond light/dark
- **UX-02**: Multiple concurrent desks or windows

### Model Depth (deferred from research)

- **MODEL-04**: Model variant selection (reasoning-effort etc.) if v2 represents variants as distinct entries or `Model.Ref.variant`

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| TUI parity beyond commands (interactive panes) | The desk is a web UI, not a terminal emulator |
| Multi-desk model profiles | One desk default applied per-session is sufficient for v1.1 |
| New credential/provider key-entry UX | v2 `/api/credential` exposes raw keys; keep redacted, no new key UI |
| Client-side command registry | Violates OpenCode authority — commands come only from the server |
| `cmdk`/Radix/fuse.js component or search libraries | Stack change; hand-built comboboxes fit the constraints |
| Global Cmd+K command palette | Scope is composer-anchored `/` commands only |
| Persisting the model into OpenCode global config | v2 has no remote global-config write (`PATCH /api/config` → 404) |
| Per-argument command autocomplete | The v2 command API has no argument schema; would mean reimplementing OpenCode |
| Sending `/name` as plain prompt text | Commands are a distinct dispatch; must not silently become prompts |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| V2-01 | Phase 7 | Complete |
| V2-02 | Phase 7 | Complete |
| V2-03 | Phase 7 | Complete |
| MODEL-01 | Phase 8 | Complete |
| MODEL-02 | Phase 8 | Complete |
| MODEL-03 | Phase 8 | Complete |
| CMD-01 | Phase 9 | Complete |
| CMD-02 | Phase 9 | Complete |
| CMD-03 | Phase 9 | Complete |
| VER-05 | Phase 10 | Pending |
| VER-06 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-21*
*Last updated: 2026-11-21 after milestone v1.1 scoping*
