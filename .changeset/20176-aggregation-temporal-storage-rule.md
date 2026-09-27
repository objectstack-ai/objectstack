---
"@objectstack/core": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
---

fix(objectql,core): a per-aggregation `filter` and `having` on `engine.aggregate` read a temporal comparand by the column's storage rule, the rule `where` already applies — one function, `temporalStorageForm`, now exported by `@objectstack/core` and shared by both drivers (#20176)

A per-aggregation `filter` (`aggregations[i].filter`) and `having` are evaluated by the engine itself, over the rows (or aggregated rows) a driver returns. Both compared a temporal comparand exactly as written, while the same condition as a `where` is put into the column's storage form by the driver first. So they counted differently. Measured through `engine.aggregate` and through `POST /data/:object/query`, on `driver-memory` and `driver-sql`, over six rows:

| in `aggregations[i].filter` (or `having`) | before | now, and the `where` twin |
|:--|:--|:--|
| an ISO instant on a `date` field, `{ placed_on: { $gte: '2026-02-01T00:00:00.000Z' } }` | 1 | 3 |
| the same instant under `$eq` | 0 | 2 |
| a bare day as the upper bound of a `datetime`, `{ opened_at: { $lte: '2026-02-01' } }`, or as a `$between` max | 2 | 3 |
| an epoch-millisecond bound on a `datetime` | 0 | 3 |
| a `Date` carrying a time of day on a `date` field, `$gte` / `$lt` / `$eq` (in-process only) | 1 / 5 / 0 | 3 / 3 / 2 |
| a `Date` on a `time` field (in-process only) | 0 | 3 |
| `having` on `max` of a `date` field with an ISO-instant bound | kept one group | keeps the two groups whose day is on or after it |

The same holds for `$ne`, `$in` / `$nin` members, `$between` endpoints, implicit equality, an offset instant (`'…T18:00:00+08:00'`), an epoch-millisecond string, a zone-naive `'2026-02-01T10:00'`, and a short wall clock (`'11:00'`) or an ISO instant on a `time` field. On a `having` column, the class comes from the query, as the `addDays` rule already reads it: `min` / `max` take the class of the field they read, a `groupBy` projection takes its field's, and a `day` date bucket is a `date`.

What the rule does, now in one place:

- A comparand, and the row's value, are put into the column's storage form: canonical UTC ISO text for `datetime`, `YYYY-MM-DD` for `date`, and `HH:MM:SS` (`.fff` only when non-zero) for `time`.
- A bare `YYYY-MM-DD` used as the upper bound of a `datetime` (`$lte`, a `$between` max) means that whole day, as it does in a `where` (ADR-0053 D-D). On a `date` or `time` column it is not widened.
- A value the rule cannot read is compared as written, and so is every non-temporal column, presence tests (`$exists`, `$null`), the text operators and a `{ $field }` reference.
- An object whose declared fields the engine cannot see keeps the previous comparison.

`@objectstack/core` exports the rule as `temporalStorageForm(value, kind)`, `kind` being `'datetime' | 'date' | 'time'`. `driver-sql` (`canonicalUtcDatetime`, `toDateOnly`, `canonicalTimeOfDay`) and `driver-memory` (`coerceTemporalValue`) each carried a copy of it; both now call it. The copies agreed on every shape measured when they were lifted, so no `where`, write or read answer of either driver changes. MySQL still binds a `datetime` in its own literal spelling.

`@objectstack/objectql`'s `applyInMemoryAggregation(rows, ast, timezone?, fields?)` takes the object's declared field map as an optional fourth argument, and a per-aggregation `filter` reads a temporal comparand by the rule only when it is given. Called without it, the function answers as before.

Not changed, measured identical before and after on both drivers: every `where` answer, every refusal a per-aggregation `filter` or `having` gives, and every per-aggregation `filter` and `having` cell whose column is not temporal.
