---
"@objectstack/service-analytics": minor
---

The three SQL compilers in this package — the RLS read-scope lowering (`compileScopedFilterToSql`), `NativeSQLStrategy`'s own `where` and the `ObjectQLStrategy` SQL echo — compile a text operator over a column whose declared type stores no text to the contract's declared answer.

`compileScopedFilterToSql(filter, alias, options?)` takes a new optional `nonTextColumn(field)` predicate; when it answers `true`, a positive text operator compiles to `1 = 0` and `$notContains` to `1 = 1` instead of a `LIKE` that coerces on SQLite (`5` renders `'5.0'`) and is refused at query time on Postgres (SQLSTATE 42883 — a 500 on a read scope the platform accepted). The service answers the predicate from the field metadata hook it already holds (`sourceFieldMeta`), exposed to strategies as `DatasetScopedStrategyContext.declaredFieldType`, and the two strategies pass it for the read scope and for the query's own text filters, so a query and its RLS scope answer one cell one way and the echo prints the statement that ran (`FILTER_TEXT_CASES`' `score` rows, maintainer ruling 2026-09-05). A host that wires no field metadata keeps the `LIKE` it always got, and every comparand refusal still runs ahead of the constant.
