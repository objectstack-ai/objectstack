---
"@objectstack/core": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/service-analytics": patch
---

fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
lower bound and was silently wrong for an upper one: the dashboard date-range
filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
`datetime` column every row created after 00:00 of the `to` day vanished from
the result — no error, the chart renders, the numbers are just smaller. The
default configuration hit it: the filter's default field is `created_at`
(a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

The translation is operator-sensitive and half-open, applied at every
comparison emitter:

- `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
  bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
  in the column's storage form; `$between [min, max]` with a bare-day max
  decomposes to `>= min AND < next-day(max)`. Both the plain and the
  legacy-repair (mixed-storage) column paths, both `where` spellings.
- `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
  instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
- The `/analytics/sql` rendering and the dataset preview evaluator apply the
  same rule, so the echoed SQL and drafted numbers reproduce execution.

`@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
`Date`s and impossible days are never widened).

Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
(`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
(instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
those). No authored metadata changes: a dashboard's existing
`{ $gte, $lte }` window now simply includes its final day.
