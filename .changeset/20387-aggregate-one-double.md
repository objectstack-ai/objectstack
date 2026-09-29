---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `sum` / `avg` accumulate in double on PostgreSQL and MySQL, as they do on SQLite and on the engine's rows path

Clause-②: no

`SqlDriver.aggregate` let PostgreSQL (`numeric`) and MySQL (`DECIMAL`) add exact decimals,
while SQLite and the engine's rows path add JS doubles. So a `number` column holding `0.1`
and `0.2` summed to `0.3` on the PostgreSQL and MySQL native paths and to
`0.30000000000000004` everywhere else, and `having { s: { $eq: 0.3 } }` kept the group on
those two faces only. `avg` over an integer column diverged too: MySQL rounds a decimal
average to 4 places (`avg` of 1, 2, 2 answered `1.6667`), and PostgreSQL's `numeric`
average rounds to 16 places before the answer becomes a double (`11 / 9` answered
`1.2222222222222222`, where every other face answers `1.2222222222222223`).

**The precision policy, applied to the arithmetic.** The policy already stated for the
answer's type (one JS double on every dialect, the loss beyond a double's precision declared)
now also decides how the answer is computed:

- `avg` accumulates in double on PostgreSQL and MySQL, over every declared numeric or
  boolean column.
- `sum` accumulates in double over a column that holds fractions: `number`, `currency`,
  `percent`, `slider`, `progress`, `summary`, and the driver's `float` alias.
- `sum` over an integer-valued column (`rating`, the `integer` / `int` aliases, a boolean)
  keeps the database's exact integer total, rounded once to the double.
- `count`, `count_distinct`, `min` and `max` are unchanged. SQLite is unchanged.

Each value added is the column's text parsed as a double: the value the SQL client hands
`find()`, and so the value the rows path adds. For the exact-decimal columns this equals a
plain cast. For a binary `real` / `FLOAT` column, which a table created before the
exact-decimal columns still has, a plain cast would add the widened binary value
(`0.30000000447034836` for `0.1 + 0.2`). MySQL's `CAST(… AS DOUBLE)` needs MySQL 8.0.17 or
later.

Route chosen: (a), accumulate in double on the native faces. The other route, (b), was to make
the rows path add exact decimals and round once. It was rejected because SQLite's native `sum`
adds the stored doubles (`0.30000000000000004`), so the rows path would then disagree with SQLite
for exactly `0.1 + 0.2`.

**Residual, stated.** On PostgreSQL and MySQL the double sums are added in row order, one after
another, without compensation. SQLite 3.43 and later adds with compensated summation, and since
#20489 so does the engine's rows path. So for a group of three or more fractions, the PostgreSQL
and MySQL native answer can still differ from SQLite's and the rows path's in the last place
(`0.1 + 0.2 + 0.3`: PostgreSQL / MySQL native `0.6000000000000001`, SQLite and the rows path
`0.6`). Before #20489, SQLite's own two paths differed there too. Two addends cannot differ.

A consumer that compared `sum` / `avg` over a fractional column with a decimal literal on
PostgreSQL or MySQL (`$eq: 0.3`) now gets the answer SQLite and the rows path already gave:
compare with a range, or with the double the arithmetic produces.
