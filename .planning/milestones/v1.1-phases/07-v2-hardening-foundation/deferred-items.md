# Deferred Items — Phase 7 (v2 Hardening Foundation)

Out-of-scope discoveries logged by executors; not fixed in this phase (scope boundary rule).

## Deferred Items

- `prettier --check` fails at HEAD across src/server/security.ts, src/server/security.test.ts, src/server/api.test.ts (long lines > printWidth 100). Verified pre-existing at HEAD. Running `--write` would be a broad reformat and would break 07-01's byte-identical SECRET_KEY/filter acceptance criteria. ESLint (the enforced gate) is clean.
  status: acknowledged
  - status: pending
  - logged by: 07-01 executor
  - date: 2026-11-21
