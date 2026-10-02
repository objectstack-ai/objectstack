---
'@objectstack/service-analytics': patch
---

The analytics native-SQL path judges a comparand against a declared number field by the platform's number-comparand rule, the one the data engine's `where` already applies

Clause-②: no

- **What changed.** A comparand against a `number`, `currency`, `percent`, `rating`, `slider`, `progress` or `summary` column is judged by `numberComparandDoorVerdict` from `@objectstack/spec/data` before the native statement compiles. This covers the query's `where` (including the dataset query's `runtimeFilter`, which is merged into it), each measure's own `filter` and a dataset's own `filter`. The rule runs in the same pass as the boolean rule.
  - A numeric string (`'12'`, `'1e3'`) is bound as the number it names, which is what the engine binds.
  - Anything else the rule refuses (a string with no numeric reading such as `'abc'`, `''` or `'+5'`, a boolean, or a list where one number belongs) is refused `INVALID_FILTER` / 400 with the rule's own message, before any statement runs.
  - A relationship-path member is judged at the related object's declared column.
- **Before.** The native strategy bound the comparand as written. So `{ amount: 'abc' }` counted no rows on SQLite and answered a 500 on PostgreSQL, `{ amount: true }` bound `1` and answered 200, and `{ amount: { $lte: '9999-12-31' } }` counted every row. The engine-aggregate strategy refused all three with 400.
- **What you may notice.** An analytics query or dataset that compared a number field with a non-numeric value now refuses instead of answering. Write a number, or a string of exactly that number's JSON spelling (`'12'`).
- **Unchanged.** A number, `null` (the null test), a `{ $field }` reference, a column that is not a number or a boolean, and a host that relays no declared field types (nothing is judged without one).
