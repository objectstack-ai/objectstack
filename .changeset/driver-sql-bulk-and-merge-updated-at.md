---
"@objectstack/driver-sql": patch
---

`updateMany()` and `upsert()`'s merge branch now advance `updated_at` (#11176).

Two write doors were leaving "last modified" reading the row's previous value —
on **every** deployment, DDL-managed or not (which is what separates these from
#11067, whose defect needed `skipSchemaSync`):

- **`updateMany()` stamped nothing.** No `tablesWithTimestamps` consultation, no
  `updated_at`. `update()`, `bulkUpdate()` and `rotatedUpdateById()` all stamp;
  this door did not, so a bulk edit left every row it touched reading its
  creation time.
- **`upsert()`'s merge branch did not advance it on Postgres and MySQL.** The
  merge set is derived from the keys of the formatted payload, and
  `stampInsertTimestamps` — the only thing that put `updated_at` there — returns
  early on any non-SQLite dialect, because the column DEFAULT already stores a
  zone-aware instant on insert. A DEFAULT does not re-fire on the conflict path.
  **SQLite was accidentally correct; Postgres and MySQL were not.**

Measured on live PostgreSQL 16.13 and MySQL 8.0.46, through the driver's own
`initObjects`, with `update()` advancing the same column on the same table in
the same run as the contrast.

Nothing errored before this fix, which is why it went unnoticed: list-view
sorts, delta/incremental sync, cache invalidation and audit answers simply read
a stale `updated_at`. A bulk status change and a sync/import that upserts — the
common shape for connector and seed writes — are exactly the operations most
likely to be feeding a downstream delta consumer.

No accept-set change and no new rejection. Both doors keep #3493's opt-in
historical import (`preserveAudit` with an explicit `updated_at`) intact, and a
hand-migrated table that genuinely lacks the column keeps working: `updateMany`
reuses #11067's presumption-and-recovery machinery whole, and the upsert door
stamps only where the column has been OBSERVED, never on a presumption it has no
way to recover from. The SQL emitted for SQLite, and for any object with no
observed `updated_at` column, is unchanged.
