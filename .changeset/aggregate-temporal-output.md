---
"@objectstack/driver-sql": patch
"@objectstack/service-analytics": patch
---

fix(driver-sql,analytics): stop `aggregate()` / `distinct()` leaking SQLite's raw epoch storage (#3797)

Both returned `await builder` directly, without the `formatOutput` pass every
`find()` row gets. On SQLite — the one dialect where a `Field.datetime` is
stored as INTEGER epoch milliseconds rather than a native timestamp — that raw
storage form went straight to the caller:

| call | before | after |
| --- | --- | --- |
| `find()` | `"2026-01-10T09:00:00.000Z"` | unchanged |
| `distinct('closed_at')` | `[1768035600000]` | `["2026-01-10T09:00:00.000Z"]` |
| `aggregate()` `max(closed_at)` | `1768035600000` | `"2026-01-10T09:00:00.000Z"` |
| `aggregate()` `groupBy: ['closed_at']` | key `1768035600000` | key `"2026-01-10T09:00:00.000Z"` |

Same root cause as #3773, different exit. `Field.date` was never affected — it
is ISO TEXT on every dialect, so its storage form already equals its
presentation.

The visible surfaces were a `_max`/`_min` measure over a datetime (a "last
closed" KPI tile rendered `1768035600000`) and a `groupBy` on a raw datetime
dimension, which also disagreed with the in-memory `applyInMemoryAggregation`
fallback — that one consumes already-formatted `find()` rows, so the same
dataset changed key type depending on which path served it.

Which columns hold an instant is now recorded while the statement is built,
because that is the only point where a column name and its meaning are both
known: a `min()` lands under its alias and never under the field name, while a
date-BUCKETED column lands under the field name but holds a label (`'2026-01'`)
rather than an instant. Matching on names afterwards gets both backwards.

`distinct()` additionally re-deduplicates after presenting: SQL `DISTINCT`
compares STORED values, and one SQLite datetime column holds both INTEGER and
TEXT forms, so two rows recording the same instant survived as two and then
presented identically. It has no in-repo callers today; this keeps it honest
rather than leaving a second convention in the driver.

**`cross-object-rebucket` was fixed alongside it, because presenting min/max
correctly is what exposed it.** `recombine()` coerced every operand with
`Number()`, which silently depended on receiving an epoch: handed the ISO string
the driver now returns it produced `NaN`, and on Postgres/MySQL (where knex
returns a `Date`) it had always flattened the value back to an epoch integer one
layer above the driver. `min`/`max` now order by the instant and return the
winning value in the shape it arrived in; `sum`/`count` stay numeric.
