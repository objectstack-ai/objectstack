---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

fix(driver-sql,driver-turso): a `NOW()`-defaulted field added to a SQLite table that already holds rows no longer fails the object's schema sync

Clause-②: no
Metadata-protocol: none

SQLite refuses a non-constant DEFAULT on `ALTER TABLE … ADD COLUMN` once the table holds a row, so adding a `datetime`, `date` or `time` field declaring `defaultValue: 'NOW()'` to a populated table failed the whole sync (`Cannot add a column with non-constant default`). Both the local face and the Turso remote face now handle that case the same way. The column is added nullable with no DEFAULT. The same sync then fills the existing rows in one statement, with the instant the DEFAULT would have given them. The drift report lists what is still owed: `set_column_default`, plus `tighten_not_null` when the field declares `storage.notNull`. On the local face, `os migrate apply` (the SQLite table rebuild) then gives the column its `NOW()` DEFAULT and the declared NOT NULL. On the Turso remote face both entries are reported as needing a table rebuild, which that transport does not yet run.

The drift report now also lists `set_column_default` for any SQLite column whose field declares `NOW()` but which has no DEFAULT. That includes columns an earlier release left without one.
