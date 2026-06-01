---
"@objectstack/driver-sql": minor
---

fix(driver-sql): materialize declared object-level indexes (#1459)

The SQL driver synced columns and field-level `unique`, but silently dropped
object-level declared `indexes` (`ObjectSchema.indexes: [{ fields, unique }]`).
As a result several documented multi-column UNIQUE / dedup guarantees were
never enforced at the DB level — a fresh `dev --fresh` sqlite DB showed only
primary-key autoindexes.

`initObjects` now materializes declared indexes (`syncDeclaredIndexes`) after
the table is created/altered:

- single- and multi-column indexes, including `UNIQUE`
- NULL-distinct semantics (the cross-dialect default), so multiple NULL rows
  stay insertable while non-NULL duplicates are rejected — matching the
  convergence-on-conflict pattern the messaging pipeline relies on
- idempotent: deterministic, length-bounded index names + per-dialect
  existing-index introspection (sqlite/pg/mysql); "already exists" races are
  absorbed
- indexes referencing a non-materialized (virtual `formula`) column are skipped
  with a warning instead of failing sync

The `indexes` driver capability flag is now `true`.
