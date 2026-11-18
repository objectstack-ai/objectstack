---
'@objectstack/driver-sql': patch
'@objectstack/cli': patch
---

fix(driver-sql): boot converges legacy text `'true'` / `'false'` in a SQLite boolean column to `1` / `0`, so boolean filters, sorts and groups find those rows

Clause-②: yes (widening: `@objectstack/driver-sql` exports `PendingSchemaWorkKind` from its index, and the CLI consumes it, so the union gains one published value, `normalize_boolean_storage`; boolean filters, sorts and groupBy on SQLite now answer legacy text rows as their boolean)
Metadata-protocol: none

Before the engine stored the boolean a reading spells, a door that sent the text `'true'` / `'false'` (the console's inline grid) left that text in a SQLite `Field.boolean` or `Field.toggle` column. Since the previous release those rows read back as the right boolean, but every comparison ran against the raw text: `won = false` missed a stored `'false'`, `won = true` missed a stored `'true'`, `$in`, `$ne` and `$nin` answered wrongly, ORDER BY sorted the text after every integer, and an aggregate groupBy presented a text `'false'` as `true`.

Schema sync now converges those cells at boot, the fourth storage convergence beside the datetime, time and JSON backfills (`backfillCanonicalBooleans`):

- **SQLite only.** Postgres, MSSQL, MySQL and Oracle coerce or refuse the text, so no other dialect can hold such a row.
- **One guarded `UPDATE` per column**: `'true'` becomes `1` and `'false'` becomes `0`, and nothing else is written. A second boot converts 0 rows.
- **Other text is never rewritten.** A value such as `'yes'` or `'TRUE'` names no boolean the driver can read without guessing; it is counted and logged at `warn`, and boolean filters keep missing it until the value is corrected at the source.
- **The record** is an `info` line per table and field with the rows converted and up to five of their ids. There is no down step: a text row already reads as its integer, so an undo would only restore the form the filters miss.
- **Dry run.** Under `os migrate plan` the step is listed in place as `normalize_boolean_storage`, with its row count, and nothing is written; `os migrate apply` runs it after the confirmation. `OS_SKIP_SCHEMA_SYNC=1` skips it, as it skips every other schema-sync step.

`os migrate plan`'s summary line now reads `N column(s) to converge in place` instead of `N temporal column(s) …`, because a boolean column is counted there too.
