---
"@objectstack/driver-sql": minor
---

A text operator over a column whose declared type stores no text (`Field.number` and its numeric siblings, `Field.boolean`) now compiles to the contract's declared answer on every dialect, instead of a dialect accident.

Before: `{ score: { $contains: '5' } }` over a numeric column compiled `col GLOB '*5*'` on SQLite and coerced the REAL in its storage class's spelling (`5` as `'5.0'`, so `$endsWith: '0'` matched every row), `col LIKE $1 ESCAPE $2` on Postgres and was refused at query time with SQLSTATE 42883 (`operator does not exist: real ~~ text` — a 500 for a filter the spec accepts), and `CAST(col AS BINARY) LIKE ?` on MySQL.

Now (`FILTER_TEXT_CASES`' `score` rows, maintainer ruling 2026-09-05): the positive operators (`$contains` / `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) compile to `1 = 0` and `$notContains` to `1 = 1` — the same row set as every JS face, decided from the declared type at compile time because the stored value is not visible until run time. Postgres: a 500 becomes a result. The gate reads the `numericFields` / `booleanFields` registries `initObjects` and `registerExternalObject` already fill; a table this driver was never told about keeps the `LIKE` / `GLOB` it always compiled, every comparand refusal still runs first, and the constants compose with the NULL-safe rules (`$notContains` admits a NULL row already) and the `$not` rewrite. Temporal columns are untouched: their stored value IS text on SQLite, so the contract declares nothing for them.

`driver-sqlite-wasm` and `driver-turso`'s local transport inherit this compiler.
