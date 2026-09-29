---
'@objectstack/objectql': patch
---

fix(objectql): the engine's rows path adds `sum` / `avg` with compensated summation, as SQLite does

Clause-②: no

`engine.aggregate` answers a `sum` / `avg` on one of two paths: the driver's own aggregate, or
the rows path (`applyInMemoryAggregation`), which aggregates `find()` rows in JavaScript and is
taken for a per-aggregation `filter`, a non-UTC date bucket, or a driver without native
aggregation. SQLite 3.43 and later adds with Kahan-Babuska-Neumaier compensation; the rows path
added naively. So on SQLite one query answered two doubles depending on the path. A `number`
column holding `0.1`, `0.2` and `0.3` in one group:

| | `sum` | `avg` | `having { s: { $eq: 0.6 } }` |
|:--|:--|:--|:--|
| SQLite native | `0.6` | `0.19999999999999998` | keeps the group |
| rows path, before | `0.6000000000000001` | `0.20000000000000004` | keeps no group |
| rows path, after | `0.6` | `0.19999999999999998` | keeps the group |

The rows path now adds with the same compensation, transcribed from SQLite's own, so on SQLite
both paths answer the same double, through `engine.aggregate` and
`POST /api/v1/data/:object/query` alike. It is also the more accurate sum: `1e16 + 1 - 1e16` is
`1`, where the naive fold answered `0`.

Unchanged: two addends (the compensated `a + b` is the naive one, so `0.1 + 0.2` is still
`0.30000000000000004`), integers whose running total stays within 2^53, a non-finite total,
`null` and non-numeric cells, and the empty group (`sum` `0`, `avg` `null`). The answer is still a
JS number.

**Residual, stated.** PostgreSQL and MySQL add `sum` / `avg` natively in double without
compensation, and that arithmetic is the database's own. So over three or more fractions their
native path can still differ from the rows path in the last place (`0.1 + 0.2 + 0.3`: native
`0.6000000000000001`, rows path `0.6`). The `@objectstack/driver-sql` entry for the double
accumulation states the same residual: the difference is no longer SQLite's native path against
every other face; it is PostgreSQL / MySQL native against SQLite and the rows path. The
in-memory driver (`@objectstack/driver-memory`) still adds naively in its own `aggregate`, so on
that driver the two paths can now differ in the same last place. An exact `$eq` on a fractional
sum compares doubles: compare with a range.
