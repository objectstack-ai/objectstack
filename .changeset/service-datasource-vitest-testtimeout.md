---
"@objectstack/service-datasource": patch
---

fix(service-datasource): give this package's vitest run a 60s `testTimeout` — close the #4856 coverage hole that let the merge queue evict unrelated PRs (#6044)

`packages/services/service-datasource` had no `vitest.config.ts` at all, so
every case ran under vitest's **5000ms** default. #4856 fixed this class of
flake by setting per-package timeouts in each package's own `vitest.config.ts`
— a structure that cannot reach a package with no config file to carry it.

The cases that build a REAL driver pay a one-time `@objectstack/driver-sql`
(knex) import inside the first case that reaches it. In
`datasource-pool-support.test.ts` the pool rejections throw before that import,
so "sqlite WITHOUT a pool still builds exactly as before" is the first case
through it: measured idle it runs ~1.1s while its neighbours run 0-2ms (the
postgres/mysql cases ride the module cache at 31/82ms). ~4.6x headroom against
5000ms holds on a PR branch and not on a merge-queue runner building several
PRs' batches at once — the observed signature: intermittent reds only in queue
full builds, evicting PRs that never touched this package (#5999 twice, #5973
once, 2026-08-06).

`testTimeout: 60_000` reuses #4856's value rather than inventing a new number,
set at the config layer so future cases are covered on arrival. Isolation was
reviewed rather than assumed (the #6044 triage forbade a timeout-only closure):
the flaky case builds `:memory:`, unprobed on the production path, never opens
a connection or loads the native addon, and every factory-door case destroys
its knex handle; the boot and wizard doors run on per-case fakes. No temp
files, no ports, no shared mutable state across cases — the red was load
variance on a real one-time import, not a leak.

No runtime, schema or public API change — test configuration only.
