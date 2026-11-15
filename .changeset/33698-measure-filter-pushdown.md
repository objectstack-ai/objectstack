---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

feat(spec, objectql, driver-sql, driver-turso): a per-measure aggregation filter runs in SQL on driver-sql, behind one declared driver capability (#33698)

Clause-②: yes (widening: one optional DriverCapabilities bit)
Metadata-protocol: added

**The capability.** `DriverCapabilities` (`@objectstack/spec/data`) gains one optional boolean, `aggregationFilter`: the driver's `aggregate()` evaluates a per-measure `aggregations[].filter` itself, with the answers the engine's in-memory aggregation gives. Absence means `false`. A driver that declares nothing keeps exactly the path it had.

**What runs where.**

- `engine.aggregate` sends an aggregate whose measures carry a `filter` to `driver.aggregate` only when the driver declares `aggregationFilter: true` and has the method. Every other driver keeps the in-memory path: `find()` for the scoped rows, then the filter and the aggregate in the engine. A non-UTC timezone with a date bucket still forces the in-memory path, as before.
- `driver-sql` declares the bit and compiles each filtered measure as a conditional aggregate, the predicate from the same where compiler a `where` uses: `sum(CASE WHEN (pred) THEN amount END)`, the same for `avg`, `min`, `max`; `count(CASE WHEN (pred) THEN 1 END)` for a count of rows (no `ELSE 0`, which `count` would count); `count(CASE WHEN (pred) THEN field END)` for a count of a field; `count(distinct CASE WHEN (pred) THEN field END)` for `count_distinct`. A group the filter empties answers `0` for `sum` and the counts and `null` for `avg`, `min` and `max`, as before. The tenant wall and the read scope stay on the statement's own `where`, so a measure filter only narrows inside them. `SqliteWasmDriver` inherits the compile.
- `driver-turso` turns the bit off in remote mode, where the remote transport refuses the key; local and embedded-replica modes inherit driver-sql's compile.
- A direct `SqlDriver#aggregate` call with a measure filter now answers the filtered numbers instead of refusing `NOT_IMPLEMENTED` / 501. The 501 remains only for a compiled predicate the driver cannot isolate, which no tested dialect produces.

**What answers differently in memory.** A measure filter, a `having` clause and the in-memory `where` that plugin drivers use all go through one engine evaluator. In that evaluator a column holding no value (SQL NULL) now fails `$gt`, `$gte`, `$lt`, `$lte` and `$between`, as SQL does and as the spec says (null is not ordered). Before, NULL counted as `0` for numbers, so "count where amount ≤ 0" also counted every row with no amount, and `$between` matched a NULL column for any bounds. A `having` on an empty group's `avg`, `min` or `max` (which is `null`) likewise no longer passes an ordering test. `$eq`, `$ne`, `$in`, `$nin`, `$exists`, `$null`, `$empty` and a `null` comparand answer as before.

**A measure filter the `where` compiler refuses now refuses on driver-sql.** Because driver-sql compiles a measure filter with the same where compiler, a filter that compiler refuses answers the same `400 INVALID_FILTER` its `where` twin answers. The recorded case is a `{ $field }` comparison between columns of different classes on an object with no audit fields (`created_at` against an image field): before, the engine evaluated it in memory and answered `200`; on driver-sql it now answers `400 INVALID_FILTER`, as `where` always did. A driver without the bit still evaluates it in memory and answers `200`.

**Declared latitude.** Ordering a non-temporal text column (`$gt` / `$lt` / `$between` on text) follows the database collation, as it always has for a `where`. On a database whose collation is not code-point order (measured: PostgreSQL with an ICU `en-US` collation), such a measure filter can select other rows in SQL than in memory. Every other operator agreed on SQLite and PostgreSQL 16. MySQL was not measured.
