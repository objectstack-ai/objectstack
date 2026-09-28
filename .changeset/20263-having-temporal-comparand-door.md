---
"@objectstack/objectql": minor
---

fix(objectql)!: `having` on `engine.aggregate` takes the temporal-comparand door `where` and the per-aggregation `filter` take, so a comparand its aggregated column cannot read is refused `INVALID_FILTER` / 400 instead of keeping no group or every group (#20263)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) this change adds no transition to migrate. Each refused comparand is one the column's own storage rule cannot read: `having` compared it as written and kept no group or every group, while the same bound in a `where` was already refused by the same door. There is no accepted spelling a refused comparand can be mechanically rewritten to: which day, instant or wall clock the author meant is an authoring decision, and the refusal names what the column takes. `having` is a request-only key that no metadata type stores, so there is no stored document for `objectstack migrate meta` to rewrite. The table below records the answer each comparand had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what `having` accepts on `engine.aggregate`, and on the REST aggregate query (`POST /data/:object/query`) that forwards it there. A comparand the aggregated column's storage rule cannot read used to answer 200; it is now refused with `INVALID_FILTER` / 400, once per query, before any driver is asked for a row, on both the native `driver.aggregate()` path and the in-memory fallback, on an empty and on a populated object. It ships as `minor` under the launch-window convention for accept-set narrowings.

Measured through `engine.aggregate` and `POST /data/:object/query`, on `driver-memory`, `driver-sql` on SQLite and `driver-sql` on PostgreSQL 16, on both paths, with `groupBy` customer over four groups. The three drivers gave the same answer in every cell:

| `having` | before | now | its `where` twin |
|:--|:--|:--|:--|
| `{ last_placed: { $lt: 'not-a-date' } }`, `last_placed` = `max(placed_on)` of a `date` field | 200, every group | 400 | 400 |
| the same under `$gt` | 200, no group | 400 | 400 |
| `'+010000-01-01T00:00:00.000Z'` on the same column, `$gt` | 200, every group | 400 | 400 |
| the number for 10000-01-01 on the same column, `$gt` (and its `Date`, in-process) | 200, every group | 400 | 400 |
| `'not-a-date'` on `min` of a `datetime` field or `max` of a `time` field, `$lt` | 200, every group | 400 | 400 |
| `'not-a-date'` on a groupBy key that is a `date` or `datetime` field or on a `day` bucket, `'noon'` on one that is a `time` field, `$gt` | 200, no group | 400 | 400 |
| the number for 10000-01-01 on a `day` bucket, `$gt` | 200, every group | 400 | 400 |

Each one read the object once before; each is now refused with no read.

What is judged:

- The same walk and the same predicate, `isUninterpretableTemporalComparand` in `@objectstack/core`, that the door runs on `where` and on each per-aggregation `filter`. A change to that rule reaches `having` with it.
- The kind is the aggregated column's class, the one the `addDays` rule already reads: `min` / `max` of a `date`, `datetime` or `time` field keeps that kind, a groupBy projection of such a field takes its kind, and a `day` bucket is a `date`. `count`, `count_distinct`, `sum` and `avg`, a `week` / `month` / `quarter` / `year` bucket, and every other column are not temporal, so they are not judged.
- Every comparison and set operator's comparand, each `$in` / `$nin` member and `$between` endpoint, and the implicit-equality slot, under `$and`, `$or` and `$not`. As on `where`, a `{placeholder}` string, the empty string, `null` and a `{ $field }` reference are not judged. `having` resolves placeholders from the same release (#20334), after this door, so the refusal's remedy on a `date` or `datetime` column is the `where` refusal's and names them, e.g. `{30_days_ago}` / `{current_month_start}`.
- The text operators (`$contains`, `$notContains`, `$startsWith`, `$endsWith`, `$icontains`) are not judged. On `where` the text-operator declared-type door answers them first, and that door does not front `having`.
- The door runs after every other `having` door, so a clause one of them refuses (an unknown operator, a key naming no column, a comparand of no comparable type, an `addDays` pair, an array in the equality slot) keeps that refusal and its words.

The refusal follows the `where` door's words. It names the `having` path, the column, what the column aggregates and its kind, and the comparand, for example: `` `having` on 'last_placed' (max(placed_on), a date column) compares against "not-a-date" at having.last_placed.$lt ``. Like the `where` refusal, it names the column's kind, and otherwise only what the query carries.

**Who is affected.** `having` is a request-only key (`QuerySchema.having`, `EngineAggregateOptions.having`), and no metadata type stores it. Every `having` in this repository's docs and published skills compares a numeric aggregation alias, which is not judged. Callers of `engine.aggregate` and of the REST aggregate query in a deployment were NOT measured.

**Fix.** Compare a `date` column with a `YYYY-MM-DD` day, a `datetime` column with an ISO-8601 instant, a bare day or epoch milliseconds, either one with a relative-date placeholder the resolver knows (`{30_days_ago}`, `{current_month_start}`; `having` resolves them from the same release, #20334), and a `time` column with an `HH:MM` or `HH:MM:SS` wall clock.

**Unchanged**, measured identical before and after on the three drivers, both paths and both doors: every `where` and per-aggregation `filter` answer; every `having` on a temporal column whose comparand the rule reads (a `YYYY-MM-DD` day, an ISO instant, an epoch-millisecond number or string, an in-range `Date`, a zone-naive instant, a wall clock, an extended-year instant on a `datetime` column, which that rule reads, until #20264, in the same release, refuses a `datetime` year outside 0001..9999 through the same predicate); `{today}`-style placeholders, known or not; the empty and the whitespace-only string; `null`, `$exists`, `$in` / `$nin`, `$between`, `$not` / `$or` / `$and` and `{ $field }` references; `$contains` and `$startsWith`; every `count` / `sum` / `avg` column, a string comparand included; a `month` bucket; and every existing `having` refusal, in its words.
