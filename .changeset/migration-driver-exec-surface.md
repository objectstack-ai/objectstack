---
"@objectstack/metadata": patch
---

fix(metadata): every migration in `@objectstack/metadata/migrations` refused every driver this repo ships (#14023)

All four helpers exported from `@objectstack/metadata/migrations` guarded on —
and drove through — `driver.raw(sql, bindings?)`. **No data driver in this repo
defines `raw`.** `SqlDriver` keeps its knex handle `protected` and declares no
`raw` member, and `SqliteWasmDriver` inherits that; the only `raw(` member
anywhere outside a test double is an HTTP harness in `packages/verify` whose
signature is `(path, init)`. So an operator who passed their platform driver was
refused by all four:

```
migrateSysNotificationToEvent({ driver, data })  ->  { status: 'error', migrated: 0 }
```

The failure was quiet in the shape that matters. `migrateSysNotificationToEvent`
*returns* `{ status: 'error' }` rather than throwing, and the message blamed the
caller's driver for lacking a method instead of saying the migration had not
run — so someone following the ADR-0030 cut-over runbook, which names this call
as the supported way to preserve users' existing bell notifications, would read
it as a problem with their own driver.

It was not only an operator-facing path. `DatabaseLoader` calls
`migrateProjectIdToEnvironmentId(driver)` on bootstrap with a real driver, at
two call sites, each wrapped in a catch — so the v5.0 `project_id` ->
`environment_id` forward migration threw and was swallowed on every boot.

The four helpers now resolve their raw-SQL entry point through one shared
resolver (`src/migrations/driver-exec.ts`) that tries `execute` first and falls
back to `raw`. `execute` goes first because it is the surface the contract
declares: `IDataDriver` (`@objectstack/spec/contracts`) declares
`execute(command, parameters?, options?)` **non-optionally**, with bound
parameters as the second positional argument — exactly the shape `raw(sql,
bindings?)` was being called in — and has never declared `raw`. `raw` is kept as
a fallback so a host or third-party driver that does define it keeps working;
nothing that worked before stops working, and the refusal now fires only for a
driver offering neither surface.

Two sibling directories already resolved both surfaces instead of assuming one,
in opposite orders (`metadata-protocol`'s `partial-index-probe` tries `raw`
first, its `seed-tenancy-backfill` tries `execute` first, and `protocol.ts`'s
`ensureOverlayIndex` is a third). One operation with three implementations and
two behaviours resolves to the declaration-bound side, which is why this
directory adopts `execute`-first uniformly rather than copying either precedent.

The refusal message now names both surfaces. It keeps the properties pinned
after the doubled-sentence defect: the remedy is stated exactly once, the
sentences stay separated, and a conforming driver is still named.

Tests: every pre-existing case in this directory built its own double carrying a
`raw` method — including the case asserting the guard fires — so the suite
pinned the guard's wording while never exercising a driver the platform ships.
Swapping `raw` for `execute` in the helpers and in the doubles would have moved
that hole rather than closed it. A new `real-driver-exec-surface.test.ts` drives
all four migrations through a real `SqliteWasmDriver` against real in-process
SQLite, asserting the physical schema rather than the returned status, and pins
the surface reality the file exists for: the real driver has no `raw` and does
have `execute`.
