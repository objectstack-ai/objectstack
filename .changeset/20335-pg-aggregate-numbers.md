---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `count` / `count_distinct` / `sum` / `avg` answer JS numbers on PostgreSQL and MySQL, as they do on SQLite and on the engine's rows path

Clause-②: no

`SqlDriver.aggregate` handed the SQL client's answer straight through. node-postgres parses
`bigint` (`count`, and `sum` over an integer column) and `numeric` (`sum` / `avg` over the
numeric family's exact-decimal column, `avg` over an integer column) to strings, and mysql2
does the same for `DECIMAL` (`SUM` / `AVG`). So one grouped query answered

    { "n": "2", "total": "500.000000000000000000000000000000" }

on PostgreSQL's native path and `{ "n": 2, "total": 500 }` on SQLite and on the rows path of
every dialect. The engine's `having` compares values as they
arrive, so `having { n: { $in: [2] } }` kept no group on PostgreSQL alone, and
`having { total: { $in: [500, 20] } }` kept no group on PostgreSQL or MySQL, while a string
comparand such as `{ total: { $lt: 'not-a-date' } }` kept every group there and none anywhere
else.

Those four functions now answer a JS number on every dialect, through `SqlDriver.aggregate`,
`engine.aggregate` and `POST /api/v1/data/:object/query`. The presentation is keyed on the
aggregate function the query asked for; it only rewrites a string, so SQLite's answers are
byte-identical to before. `min` / `max` are unchanged: they answer a value of the column and
keep that column's presentation (a declared numeric field was already a number).
Non-aggregate reads (`find()`, `distinct()`) are unchanged, and no connection-level type
parser is touched.

**Precision policy.** The answer is one JS number (an IEEE-754 double) on every dialect. A
`sum` / `avg` whose exact value needs more than a double's 15 to 17 significant digits, or an
integer total at or above 2^53, is rounded to the nearest double. That is the same bound
`find()` already puts on a read of the same exact-decimal column, and the bound the rows path
has always had. A total that fits keeps its exact value (`500`, `30.75`, `0.375`). The answer
is never a string, including for large totals: an answer whose type depended on its size would
break the same `having` or chart for exactly those totals.

A consumer that read these values through `Number(...)` gets the same number it computed
before. A consumer that compared them as strings, or checked `typeof value === 'string'`,
now receives a number.
