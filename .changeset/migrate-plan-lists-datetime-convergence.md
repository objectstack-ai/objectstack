---
"@objectstack/driver-sql": minor
"@objectstack/cli": patch
---

fix(cli,driver-sql): `os migrate plan` lists the datetime storage convergence (#3954)

The datetime canonicalisation (#3912/#3942) added two steps to `initObjects`'
physical path: a row-rewriting backfill on SQLite and a `TIMESTAMP` →
`DATETIME(3)` column rebuild on MySQL. Both already respected the DDL deferral,
so `plan` performed neither and `apply` performed both — the behaviour was never
wrong. The reporting was.

`PendingSchemaWork` could only express `create_table` / `add_columns`, so an
operator saw a plan listing two added columns, confirmed it, and `apply`
additionally rewrote every row of a datetime column — or took a metadata lock to
rebuild one on a large table. The plan promises to show what apply will do.

- `PendingSchemaWork.kind` gains `normalize_datetime_storage` and
  `widen_datetime_columns`, plus an optional `rows` carrying how much data the
  step touches: row-writes for the backfill, the table's size for the rebuild —
  the number that decides "now" versus "in a maintenance window".
- `previewDeferredSchemaWork()` measures both without performing either, reusing
  the exact predicate each migration uses (the backfill's whole `WHERE`, the
  widening's own `information_schema` filter) so the plan and the apply cannot
  name different sets. A probe that cannot run is swallowed to "unlisted", never
  to a failed plan.
- The CLI renders them under their own heading rather than folding them into the
  additive section, whose "created when you apply" framing carries an implicit
  promise that the work is never data-losing. `summarizePendingSchemaWork` — the
  line read just before typing `y` — never omits in-place work.
