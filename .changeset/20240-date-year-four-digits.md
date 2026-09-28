---
"@objectstack/core": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
---

fix(core,objectql)!: a number or `Date` compared against a `date` field spells its year with four digits, and one whose UTC year falls outside 0..9999 is refused `INVALID_FILTER` / 400, as its ISO string already was (#20240)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a query-time refusal of a comparand VALUE on a `date` field: no authorable key, spelling or stored shape moves, `packages/spec` is untouched, and a stored row keeps the form it has. What is refused is a number or `Date` whose day has no `YYYY-MM-DD` form, and which in-range day the caller meant is not something a ledger entry can decide. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a comparand value (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a filter on a `date` field accepts. A number or `Date` whose UTC calendar day falls in a year below 0 or above 9999 used to answer 200 with the wrong rows, or a 500 on PostgreSQL; it now answers `INVALID_FILTER` / 400. It ships as `minor` under the launch-window convention for accept-set narrowings.

`temporalStorageForm(value, 'date')` in `@objectstack/core` spelled the year of a `Date` or an epoch-millisecond number unpadded: `999-06-15`, `10000-01-01`, `-1-01-01`. The ISO string and the bare day of the same instant spelled `0999-06-15`, and as text an unpadded year sorts as no day does. Measured through `engine.find` / `engine.aggregate` and `POST /data/:object/query` (the two doors agree), on a `date` field holding six 2026 days and 0999-06-15, `$gt` / `$lt` / `$eq`:

| position | comparand | before: memory · SQLite · PostgreSQL | now, on all three |
|:--|:--|:--|:--|
| `where` | a number (or, in-process, a `Date`) for 0999-06-15 | 0/7/0 · 0/7/0 · 6/0/1 | 6/0/1 |
| per-aggregation `filter` | the same | 0/7/0 on all three | 6/0/1 |
| `having` on `max(date)` | the same | no group / every group / no group | the three 2026 groups / none / the 0999 group |
| `where` | a number (or `Date`) for 10000-01-01 | 6/1/0 · 6/1/0 · 0/7/0 | `INVALID_FILTER` / 400 |
| `where` | a number (or `Date`) for -1-01-01 | 7/0/0 · 7/0/0 · `DATABASE_ERROR` (500) | `INVALID_FILTER` / 400 |
| per-aggregation `filter` | either of those two | 6/1/0 and 7/0/0 on all three | `INVALID_FILTER` / 400 |
| `where`, per-aggregation `filter` | the ISO string of either | `INVALID_FILTER` / 400 | unchanged |

What changes:

- The rule pads a year from 0 to 999 to four digits, for a `Date` and a number alike, so a number, its `Date` and its ISO string spell one day. `driver-sql` (`toDateOnly`, `temporalFilterValue`), `driver-memory` (`coerceTemporalValue`) and the engine's per-aggregation `filter` and `having` all call it.
- `isUninterpretableTemporalComparand('date', value)` is now also true for a finite number or a valid `Date` whose UTC year is below 0 or above 9999, a finite number past the `Date` range (±8.64e15) included. The engine's temporal-comparand door refuses such a comparand on `where` for every verb (`find`, `findOne`, `count`, `aggregate`, `update`, `delete`), in both the object and the array spelling, and in a per-aggregation `filter`, before any driver read. `IObjectQLEngine.judgeFilter` runs the same door.
- The write path: `create()` / `update()` on `driver-memory` or SQLite, given a year-0..999 number or `Date` for a `date` field, now stores `0999-06-15` where it stored `999-06-15`; `engine.insert` of such a `Date` does the same. PostgreSQL and MySQL already stored a three-digit year's day, but not a shorter one: under its default `DateStyle` (`ISO, MDY`) PostgreSQL stored the unpadded `9-03-04` as 2004-09-03 and refused `99-03-04` (`22008`), and MySQL 8.0 stored `99-03-04` as 1999-03-04. All three dialects now store the day. A year outside 0..9999 keeps the spelling it had on the write and read paths; no ordered form is invented for it.

**Who is affected.** A caller that compares a `date` field with an epoch-millisecond number or a `Date` in a year below 0 or above 9999. No writer that stores or queries such a day has been measured; the reach is the public query door.

**Fix.** Compare against a `YYYY-MM-DD` day, or a number or `Date` whose UTC calendar day falls in a four-digit year.

**Unchanged**, measured identical before and after on memory, SQLite and PostgreSQL through the engine and REST: every `datetime` and `time` cell, the same numbers included (#20264, in the same release, then narrows the range to 0001..9999 on `date` and `datetime` alike: year 0 is refused too, and so is a `datetime` number, `Date` or string outside it, and the padding covers 0001..0999); every string comparand on a `date` field; every number and `Date` in the years 1000 to 9999; `NaN`, ±Infinity and an Invalid Date, which name no year and are not judged; and every read-path presentation on those three. On MySQL, measured at the driver door, a stored year from 100 to 999 now reads back padded (`0999-06-15`, where it read `999-06-15`); a stored year below 100 read back a century late (`0009-03-04` as `1909-03-04`, mysql2's `Date.UTC` reading of a `DATE`), which this change does not touch and #20280, in the same release, corrects by reading a MySQL `DATE` as its text. `having` reaches the same door in the same release (#20263), so a number or `Date` outside 0..9999 is refused there too. `service-analytics`' raw-SQL decline reads a time dimension by the `datetime` rule, so its answer does not move. `driver-mongodb` keeps its own copy of the `date` rule and is not changed here.
