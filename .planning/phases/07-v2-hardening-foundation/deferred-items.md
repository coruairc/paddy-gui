# Deferred Items — Phase 7 (v2 Hardening Foundation)

Out-of-scope discoveries logged by executors; not fixed in this phase (scope boundary rule).

| # | Kind | File(s) | Description | Logged By | Date |
|---|------|---------|-------------|-----------|------|
| 1 | lint-warning (pre-existing) | src/server/security.ts, src/server/security.test.ts, src/server/api.test.ts (repo-wide) | `prettier --check` fails at HEAD on these files (long lines > printWidth 100: imports, assert calls, SECRET_KEY regex, PathCheck union). Verified pre-existing by checking HEAD copies. Repo is not prettier-formatted at the configured width; running `--write` would be a broad reformat and would break 07-01's byte-identical SECRET_KEY/filter acceptance criteria. ESLint (the enforced gate) is clean. | 07-01 executor | 2026-11-21 |
