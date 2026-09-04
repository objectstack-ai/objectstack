---
"@objectstack/driver-sql": minor
---

feat(driver-sql): compile the `addDays` offset of a `{ $field }` reference on every dialect

`{ completed_at: { $lte: { $field: 'due_date', addDays: { $field: 'grace_days' } } } }`
now compiles to `completed_at <= due_date + grace_days days` on SQLite, PostgreSQL and
MySQL (`driver-sqlite-wasm` inherits the compiler unchanged); a literal (`addDays: 5`,
`addDays: -3`) binds as a parameter where the column would be. The offset rides the
cross-field arm and its four rulings — the offset column is a same-table, declared,
non-tenant numeric column — and adds two of its own: day arithmetic applies only between
two `date` columns or two `datetime` columns, and a fractional offset value is truncated
toward zero. Everything else is refused with `INVALID_FILTER` (400), operands withheld from
the caller and named in the server log.

The NULL semantics are written into the predicate rather than left to three-valued logic:
`COALESCE(offset, 0)` for a NULL offset column, and `referenced IS NOT NULL AND …` so a NULL
referenced column is false — not NULL — for every operator including `$ne`, and stays false
under `$not`. SQLite adds days on the driver's canonical text form (`date(col, 'N days')` /
`strftime('%Y-%m-%dT%H:%M:%fZ', col, 'N days')`), so a shifted value is byte-identical to a
stored one and the comparison stays a plain text compare.

The shared cross-field conformance corpus gains an offset fixture with literal, column,
negative, NULL-offset, NULL-base and `$not`-wrapped rows, held to the same ids on the SQL
path and the in-memory evaluator; both driver suites run it, and the live PG + MySQL job
runs it per dialect.
