---
'@objectstack/core': minor
'@objectstack/driver-sql': patch
'@objectstack/service-analytics': patch
---

fix: the analytics native-SQL path aggregates with the engine's own aggregate policies, so one query answers one number whichever strategy serves it: `sum` / `avg` accumulate in double, a PostgreSQL boolean aggregand is cast, and an all-NULL `sum` answers `0`. The operand policies move from `@objectstack/driver-sql` to `@objectstack/core` (#21042)

Clause-②: yes (widening)

**New exports.** `@objectstack/core` exports the aggregate operand policies, moved here from `@objectstack/driver-sql`, where they were module-private. The driver now imports them and emits byte-identical statements.

- `AGGREGATE_ACCUMULATION`: what each declared aggregate function accumulates in on PostgreSQL and MySQL. `avg` accumulates in double; `sum` accumulates in double over a fractional column; the counts, `min` and `max` take the column as stored.
- `aggregandColumnClass(shape)`: the one column-class predicate those policies read, over a column's declared `{ type, multiple }`. It answers `'fractional'`, `'integral'`, `'boolean'`, or `undefined` for every other column, a multi-valued one included. The type `AggregandColumnClass` names the three classes.
- `POSTGRES_BOOLEAN_AGGREGAND_CAST`: the functions whose boolean aggregand is cast to `int` on PostgreSQL. These are `sum`, `avg`, `min` and `max`; the two counts are never cast.
- `doubleAccumulationOperand(operand, dialect)`: the column's text, parsed as a double, spelled for `'postgres'` or `'mysql'`.
- `aggregandOperandSql(func, columnClass, dialect, operand)`: the operand an aggregate wraps, with the cast inside the double operand. The type `AggregandSqlDialect` names its dialects (`'sqlite'`, `'postgres'`, `'mysql'`, `'unknown'`).

**What changed.** `POST /api/v1/analytics/query` and `POST /api/v1/analytics/dataset/query` served by `NativeSQLStrategy` (the default on a SQL driver) skipped three policies `SqlDriver.aggregate()` applies. So the ObjectQL strategy and `engine.aggregate` answered differently for the same query. Measured on SQLite and PostgreSQL 16.13:

- On PostgreSQL, `sum` / `avg` over an exact-decimal column, and `avg` over an integer one, added exact decimals. For example, `0.1 + 0.2` answered `0.3` and `11 / 9` answered `1.222222222222222`, where the engine answers `0.30000000000000004` and `1.2222222222222223`. The native statement now accumulates in double, as the driver does.
- On PostgreSQL, `sum` / `avg` / `min` / `max` over a boolean field answered `500` (`function sum(boolean) does not exist`). The native statement now casts the boolean aggregand to `int`, as the driver does, and answers the numbers the engine answers.
- On every dialect, a group whose aggregand is NULL in every row, and a measure-scoped `sum` that admits no row, answered `sum` `null` at the cube door. The strategy now folds a `null` answer to `emptyGroupValueFor` (`@objectstack/spec`) for every measure, so that `sum` answers `0`. `avg`, `min` and `max` over nothing stay `null`. The dataset door already answered `0`.

This is no narrowing: each answer moves to the value the platform already declared for the same query.

**What did not move.** `@objectstack/driver-sql`'s statements and answers are unchanged: a move-proof test compiles each aggregate function over each column class on SQLite, PostgreSQL and MySQL, and the statements equal the ones captured before the move. SQLite's native statement is unchanged, because neither operand policy applies there. A host that relays no field declarations to the analytics service, or names no SQL dialect, gets today's native arithmetic.
