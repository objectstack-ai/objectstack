---
'@objectstack/core': minor
'@objectstack/objectql': patch
'@objectstack/driver-memory': patch
'@objectstack/service-analytics': patch
---

fix: `sum` / `avg` answer the same double on every face the platform owns, added with one compensated fold that `@objectstack/core` now exports as `compensatedSum` (#20544)

Clause-②: yes

**New export.** `@objectstack/core` exports `compensatedSum(nums)`: the sum of
`nums`, added in order with Kahan-Babuska-Neumaier compensation, which is the
summation SQLite (3.43 and later) uses for its own `sum` and `avg`. It moved
here from `@objectstack/objectql`'s rows path (`in-memory-aggregation.ts`),
which now imports it instead of keeping a private copy.

**What changed.** Three folds still added a group's values naively, and now call
the same function:

- `@objectstack/driver-memory`'s `aggregate()` and `find()` with aggregations,
  the path `engine.aggregate` takes on an in-memory datasource;
- `@objectstack/driver-memory`'s analytics face (`MemoryAnalyticsService`),
  whose `sum` / `avg` measures are now a `$group` `$accumulator` in place of
  mingo's `$sum` / `$avg`;
- `@objectstack/service-analytics`' draft preview.

Over a `number` column holding `0.1`, `0.2` and `0.3`, each of them answered
`0.6000000000000001` / `0.20000000000000004`. They now answer `0.6` /
`0.19999999999999998`, as SQLite and the engine's rows path do. Over
`1e16, 1, -1e16` they answered `0` and now answer `1`. On driver-memory,
`engine.aggregate` gave two answers depending on its path: `having { s: { $eq:
0.6 } }` kept the group on the rows path and dropped it on the native path. It
now keeps it on both.

**What did not move.** Two addends, integers whose running total stays within
2^53, and a non-finite total give the same answer as before. Which values count
as addends did not change either: booleans as 1 / 0, and nulls and non-numeric
strings left out, as each face already had it. `count`, `min` and `max` are
untouched. The analytics face's pipeline dump (`result.sql`) now renders the
accumulator's functions by name, so a `sum` measure and an `avg` measure still
dump differently.

**Residual.** PostgreSQL and MySQL add their doubles natively without
compensation, and the platform does not wrap that arithmetic. So over three or
more fractions their native path can still differ from these faces in the last
place. An exact `$eq` on a fractional sum compares doubles; compare with a range.
