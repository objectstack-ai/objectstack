---
'@objectstack/core': minor
'@objectstack/driver-sql': patch
'@objectstack/service-analytics': patch
---

fix: the analytics native-SQL path answers a measure its response declares `number` as a number on every dialect, presented by the one rule `driver-sql`'s `aggregate()` applies, which `@objectstack/core` now exports as `AGGREGATE_ANSWER_KIND` and `presentAsNumber` (#20889)

Clause-②: yes (widening)

**New exports.** `@objectstack/core` exports two names, moved here unchanged
from `@objectstack/driver-sql`, which now imports them instead of keeping them
private:

- `AGGREGATE_ANSWER_KIND`: what each declared aggregate function answers.
  `count`, `count_distinct`, `sum` and `avg` answer `'number'`; `min` and `max`
  answer `'column'`, a value of the aggregated column.
- `presentAsNumber(value)`: the `'number'` presentation. A string `Number()`
  reads as a number becomes that number. Any other value is returned as given:
  a number, `null`, a boolean, empty or blank text, or text that reads as NaN.

**What changed.** On PostgreSQL, `POST /api/v1/analytics/query` and
`POST /api/v1/analytics/dataset/query` answered through `NativeSQLStrategy`
returned count, count_distinct, sum, avg, and min / max over a numeric column
as strings, such as `count: "2"` and
`sum: "500.000000000000000000000000000000"`, while `fields[]` declared
`number`. A dataset's `row_count` did the same, and a measure-scoped count
mixed `"1"` with the number `0` in one column. SQLite answered numbers. The
strategy now presents each measure column by its declared aggregate function,
through the same table and presenter as `SqlDriver.aggregate()`. `min` / `max`
are presented only when their column is declared numeric, so `max` over a text
column, every dimension, and expression measures keep the value the database
returned.

**Precision.** The answer is one JS number, the policy `driver-sql`'s
`aggregate()` already applies. A total that needs more digits than a double
holds, such as `9007199254740993`, answers the nearest double
(`9007199254740992`), which is also what SQLite and the engine path answer.

**What did not move.** `@objectstack/driver-sql`'s behaviour is unchanged: its
`aggregate()` reads the same table, and its read presenter calls the same
function. The answers on SQLite are byte-identical. The arithmetic of the
analytics native statement did not change either. On PostgreSQL its `sum` and
`avg` still add exact decimals, so `0.1 + 0.2` answers `0.3` where the engine
path answers `0.30000000000000004`.
