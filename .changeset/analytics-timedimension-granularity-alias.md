---
"@objectstack/driver-sql": patch
---

Fix a `500 DATABASE_ERROR` on any analytics cube query that buckets a measure by
a time-dimension granularity (`"count by month"` and every other
`timeDimensions[].granularity` shape).

An analytics measure is addressed on the wire as `<cube>.<measure>`, and that
dotted name is used verbatim as the driver-level aggregation `alias` — it is the
key the caller reads its own number back under. `driver-sql` bound the alias
through knex's `??` placeholder, which does not quote an identifier so much as
parse one: it splits the value on `.` into `table.column` and re-quotes each
segment. The statement therefore reached the database as
``count(*) as `showcase_delivery`.`count` `` — not valid SQL on any dialect — and
was refused before it ran.

The granularity was the router rather than the fault: `NativeSQLStrategy`
declines exactly on a granularity, so an un-bucketed cube query was served by the
native face (which already emitted the alias correctly) while a bucketed one fell
through to this door. Aliases are now emitted as a single dialect-quoted
identifier at every alias position on the aggregate and window-function builders;
column *references* still bind through `??` and may still be qualified.
