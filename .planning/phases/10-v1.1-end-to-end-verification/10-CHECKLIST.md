# Phase 10 — v1.1 End-to-End Verification Checklist

**Date:** 2026-11-22
**Environment:** `opencode serve` v2.3.2 on `127.0.0.1:4096` (generated password), `npm run dev` on `127.0.0.1:8080`, Paddy repo as the active project, Playwright chromium.

## 1. A picked model is the model that runs

| Step | Observed |
|---|---|
| Picked in the header (filter `deepseek`, first row) | `alibaba-token-plan/deepseek-v4-flash-0731` |
| Trigger label | `DeepSeek V4 Flash 0731` |
| `/api/bootstrap` after pick | `deskModel = "alibaba-token-plan/deepseek-v4-flash-0731"` |
| Session summary after sending `ping` | `session.model = "alibaba-token-plan/deepseek-v4-flash-0731"` |
| OpenCode's own session record | `{ id: "deepseek-v4-flash-0731", providerID: "alibaba-token-plan", variant: "default" }` |

Result: **PASS** — the picked key is the applied session model on both sides of the boundary.

## 2. Two tabs agree after an external switch

| Step | Observed |
|---|---|
| Both tabs' labels before switch | `DeepSeek V4 Flash 0731` / `DeepSeek V4 Flash 0731` |
| External `POST /api/session/{id}/model` to `opencode/tidepool-alpha-free` | 204 |
| Tab A label after SSE | `Tidepool Alpha Free` |
| Tab B label after SSE (no reload) | `Tidepool Alpha Free` |
| OpenCode session record | `{ id: "tidepool-alpha-free", providerID: "opencode", variant: "default" }` |

Result: **PASS** — both tabs converge on the same model with no reload.

## 3. Command outcomes fan out to both tabs

| Step | Observed |
|---|---|
| `/e2e-echo hello` in tab A | Expanded user message present in tab A: 1 |
| Same message in tab B (SSE, no reload) | 1 |
| Duplicate bubbles | 0 |
| `/does-not-exist` in tab A | In-thread `Command not found: does-not-exist`; draft restored; no prompt dispatched |

Result: **PASS**.

## 4. Clean-environment gates

| Gate | Result |
|---|---|
| `npm test` (live listener on 4096) | script 20/20, TS 110/110, exit 0 |
| `unshare -Urn sh -c 'ip link set lo up && npm test'` | script 20/20, TS 110/110, exit 0 |
| `npm run lint` | exit 0, 0 errors, 5 pre-existing warnings |
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| Non-test `node:*` imports in `src/components`, `src/lib/desk`, `src/routes`, `src/router.tsx` | 0 (only `*.test.ts` files import `node:test`) |

Result: **PASS**.

## Cleanup

The temporary `.opencode/command/e2e-echo.md` was removed; the OpenCode server, dev server, and Playwright browser were stopped; ports 4096 and 8080 are free.

## Deferred

None — this checklist closes the two Phase 8 deferrals (two-tab agreement and live resume/reconciliation) and the Phase 9 cross-process invalidation claim.
