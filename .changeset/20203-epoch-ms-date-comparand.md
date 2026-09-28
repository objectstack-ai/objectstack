---
"@objectstack/core": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
"@objectstack/objectql": patch
---

fix(core): an epoch-millisecond number compared against a `date` field is read as the UTC calendar day of its instant, by every driver and at every position that compares it (#20203)

Clause-②: no — no key, export or operator moves, and no comparand that was accepted is now refused: a number was already an accepted comparand on every `date` position, and its answer moves to the storage rule's reading.

`temporalStorageForm(value, 'date')` in `@objectstack/core` returned a finite number unchanged, so each face compared it by its own type rules and they disagreed. Over six rows, with `1769940000000` (2026-02-01T10:00:00.000Z) against a `date` field:

| face | `$gt` | `$lt` | `$eq` | `$in` (with a Jan 10 member) | `$between` (from Jan 2) |
|:--|:--|:--|:--|:--|:--|
| `where` on `driver-memory` | 0 | 0 | 0 | 0 | 0 |
| `where` on `driver-sql`, SQLite | 6 | 0 | 0 | 0 | 0 |
| `where` on `driver-sql`, PostgreSQL | `DATABASE_ERROR`, a 500 at REST | the same | the same | the same | the same |
| a per-aggregation `filter` on `engine.aggregate` | 0 | 0 | 0 | 0 | 6 |
| **now, on every face above** | **1** | **3** | **2** | **3** | **5** |

The same holds through `engine.find` and `POST /data/:object/query`, and for `$gte`, `$lte`, `$ne`, `$nin` and implicit equality. PostgreSQL's server refused the bound number itself (`22008`, date/time field value out of range), on an empty table too. `having` over `max` of a `date` field kept no group for `$gt`, `$eq` or `$in`; it now keeps the groups whose day compares.

A finite number is now read as the `datetime` rule already reads it, as epoch milliseconds. It takes the UTC calendar day of that instant: the day `new Date(value)` names, through the same conversion a `Date` takes. So a number and its `Date` always answer alike. A time of day is dropped, never rounded, a negative number is a day before 1970, and a fraction truncates toward zero as the `Date` constructor does. `driver-sql` (`toDateOnly`, `temporalFilterValue`), `driver-memory` (`coerceTemporalValue`) and the engine's per-aggregation `filter` and `having` all call this rule, so they now agree.

The rule is shared by the drivers' write and read paths too:

- `create()` / `update()` on either driver, given a number for a `date` field, stores its UTC day. Before, `driver-memory` and SQLite stored the number, and PostgreSQL refused the statement. The engine and REST write doors refuse a number on a `date` field before a driver sees it (`VALIDATION_FAILED`), as before.
- A number already stored in a SQLite `date` column is read back as its UTC day by `find()`, a `groupBy` key and `distinct()`. Only a direct driver write could have put one there.

Not changed, measured identical before and after: `NaN`, ±Infinity, a number outside the `Date` range (past ±8.64e15), a bigint, an epoch-millisecond string, every `Date` and every string on a `date` field (#20240, in the same release, then pads a `Date`'s or a number's year 0..999 to four digits and refuses one whose year falls outside 0..9999, a number past the `Date` range included; #20264, in the same release, narrows that to 0001..9999, so year 0 is refused rather than padded), and every `datetime` and `time` reading. `driver-mongodb` keeps its own copy of the `date` rule and is not changed here.
