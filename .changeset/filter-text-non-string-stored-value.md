---
"@objectstack/spec": minor
---

`FILTER_TEXT_CASES` declares what a text operator answers over a stored value that is NOT a string, and the fixture gains its first non-string column.

Measured before this row existed, one filter over one numeric column answered four ways across the platform: `driver-memory`'s reference matcher said NO to `$contains` and to `$notContains` for the same row; its live mingo path, `formula`, objectql's `having`, `driver-mongodb` and the analytics face type-gated (`$contains` NO, `$notContains` YES); the SQLite family coerced the number to text in its storage class's spelling (REAL renders `5` as `'5.0'`); and live Postgres refused at query time with SQLSTATE 42883 — a 500.

The maintainer ruled the cell on 2026-09-05 (option A, type-gate): a stored value that is not a string never satisfies a positive text operator (`$contains` / `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) and satisfies `$notContains` — complementarity holds, on every face. Coercion was refused on the measurement; a declared-type door that refuses the filter before any backend runs is deferred to its own decision card, not rejected.

- `FilterTextRow` is now `{ id, name, score }` — `score` is a NUMBER on every row (a `0` among them), chosen so a coercing backend answers a visibly non-empty set and a truthiness guard drops a row.
- Five new evaluated rows over `score`: the four positive operators the table can carry answer `[]`, `$notContains` answers all nine. (`$like` / `$ilike` follow the same rule and are pinned on the faces that answer them — the table is a driver's enrolment and `driver-mongodb` refuses those two.)
- `NON_TEXT_STORED_VALUE_TYPES` (`field-value.zod.ts`) — the numeric and boolean value classes, i.e. the declared field types whose stored value is never text — is the list the SQL faces classify a column by at compile time, since they cannot read the value. Temporal types are deliberately absent: their stored form is a dialect question (ADR-0053) the row does not decide.

Every suite that materialises the fixture adds the column (SQL `initObjects` DDL included).
