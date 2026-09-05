---
"@objectstack/service-analytics": patch
---

Analytics `$icontains` no longer compiles a `translate()` call on SQLite and MySQL, where that function does not exist and the statement failed to parse.

`$icontains` folds ASCII case on both sides of the comparison (#4706 Q1 = A). All three of this package's SQL compilers — the query's own `where` (`NativeSQLStrategy.buildFilterClause`), the ADR-0021 D-C read scope (`compileScopedFilterToSql`) and the `ObjectQLStrategy` echo of that statement — spelled that fold as `translate(col, 'ABC…', 'abc…')` on **every** dialect. `translate()` is PostgreSQL/Oracle; SQLite has none. Measured on sql.js 1.14.1 (SQLite 3.49.1, the engine `driver-sqlite-wasm` runs), `SELECT translate('ABC','ABC','abc')` answers `no such function: translate` — so this was not a filter that returned the wrong rows, it was a statement the engine refused. On a SQLite datasource, an analytics `where` carrying `$icontains` and an **RLS read scope** carrying it were both unusable.

The fold is now chosen per dialect, on the same construct table the case-exact text family already used, reached through one `fold` flag:

- **SQLite** — `lower(col) GLOB lower(?)`. SQLite's `lower()` is ASCII-only (measured: `lower('CAFÉ')` is `cafÉ`), so this is the ruled fold rather than an approximation of it, and it runs.
- **PostgreSQL** and the `unknown` residue (a host that wires no dialect hook) — `translate()`, **unchanged**. These arms were never broken, so the emitted SQL and its bound parameters are byte-identical to before.
- **MySQL** — the nested-`REPLACE` fold over `CAST(… AS BINARY)`, matching what `driver-sql` emits for the same operator. Asserted as text only; no MySQL server is provisionable in the container that wrote this, so that cell is a declared skip, not a claimed pass.

`$icontains` and the case-sensitive `$contains` family remain two separate constructs on every dialect — collapsing them would give `$contains` back the case fold #4706 Q2 = A took away from it. A host that answers no dialect keeps exactly the behaviour it had.
