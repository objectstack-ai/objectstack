---
"@objectstack/driver-sql": minor
"@objectstack/spec": patch
"@objectstack/cli": patch
---

feat(driver-sql)!: make index drift visible to `os migrate plan` — no more silent DDL at boot (#3728)

The #3696 unique-scope migration converged **in place**: `syncTableIndexes` ran a
`DROP` + `CREATE UNIQUE INDEX` during `initObjects`, in every environment,
leaving one log line behind. `os migrate plan` showed nothing, because
`detectManagedDrift` was column-only — `ManagedDriftOp` had no index dimension at
all. An operator who wanted to review the DDL before it reached their database
had no way to, and a managed schema was being auto-altered in production, which
the #2186 contract explicitly forbids.

Index drift is now a first-class dimension, reconciled through the same path as
column drift:

- **`syncTableIndexes` is additive only.** It creates indexes; it never drops or
  rewrites one. `dropLegacyGlobalUniques` is gone.
- **New `DriftOp` variants** — `replace_unique_index` (safe: retire the legacy
  platform-wide unique in favour of the tenant composite), `create_index` (safe),
  `recreate_index` (needs-confirm; destructive when it tightens to `UNIQUE`), and
  `drop_index` (destructive).
- **`detectManagedDrift` reports them**, `os migrate plan` renders them (index
  ops display as `table [index_name]`), and `os migrate apply` executes them.
  Index DDL is portable, so it applies directly on every dialect — no SQLite
  table rebuild.
- **`replace_unique_index` creates before it drops**, so uniqueness is never
  unenforced mid-migration and a failed create leaves the schema untouched.
- **Declared `indexes[]` drift is covered too**: an index metadata declares but
  the database lacks, and one whose definition no longer matches the declaration
  (the additive sync skips those by name, so they could never self-heal).
- **Orphan detection is limited to ObjectStack's own generated naming**
  (`uniq_…` / `idx_…`, plus the pre-#3696 `<table>_<column>_unique` knex
  spelling). A hand-rolled operational index is never reported as drift and
  `--allow-destructive` will not delete it.

**Behaviour change.** Boot no longer rewrites the index unconditionally. Dev
(`autoMigrate: 'safe'`, what `os dev` / `os serve` use) still self-heals on
restart, so local workflows are unchanged. Production now **warns** with an
actionable `os migrate` hint and leaves the schema alone — the deployment stays
on the legacy global unique (multi-tenant inserts still collide) until someone
runs `os migrate apply`. That is the deliberate trade: a visible, pre-inspectable
migration instead of an invisible one.

Also fixed: `managedObjectIndexes` was never cleared when an object dropped its
`indexes[]`, so drift detection kept expecting an index nobody declared.

`SchemaDiffEntryKind` gains `index_mismatch` and `unmapped_index`.
