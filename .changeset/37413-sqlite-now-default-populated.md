---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

fix(driver-sql,driver-turso): a `NOW()`-defaulted field added to a SQLite table that already holds rows no longer fails the object's schema sync

Clause-②: yes (widening)
Metadata-protocol: none

SQLite refuses a non-constant DEFAULT on `ALTER TABLE … ADD COLUMN` once the table holds a row. So adding a field that declares `defaultValue: 'NOW()'` (`datetime`, `date`, `time` or any scalar type) to a populated table used to fail the whole sync with `Cannot add a column with non-constant default`. Both the local face and the Turso remote face now give the same answer:

- The column is added nullable and with no DEFAULT.
- In the same transaction, one statement fills the existing rows that hold NULL with the sync instant, the value the DEFAULT would have given. This holds on every door: the managed table, a rotation shard, and the remote `syncSchema` and `syncSchemasBatch`.
- The drift report then lists what is still owed: `set_column_default`, plus `tighten_not_null` when the field declares `storage.notNull`.

The drift report now lists `set_column_default` for **any** SQLite column whose field declares `NOW()` but which has no DEFAULT. That includes columns created before this release. On a local SQLite database the entry is `safe`, so it is applied unattended by a full table rebuild:

- at dev boot under `autoMigrate: 'safe'`;
- when the object is published;
- at an artifact-pinned boot.

The rebuild rewrites no stored value.

`tighten_not_null` is `destructive`, and two consequences follow:

- Plain `os migrate apply` does not apply it; `os migrate apply --allow-destructive` does.
- While that entry stands, an artifact-pinned boot of a local SQLite database is refused, even though the sync has filled every row.

On the Turso remote face, neither entry is applied by `os migrate apply` or by any boot: both need a table rebuild, which that face does not run yet. They stay listed by `os migrate plan`.

New `@objectstack/driver-sql` exports, so both faces share one source:

- `declaresSqliteNowColumnDefault(field)`: whether a field's SQLite column DEFAULT is the `NOW()` expression.
- `sqliteNowBackfillSql(table, added)`: the NULL-only fill statement.
- `quoteSqliteIdentifier(name)`: the SQLite identifier spelling that both faces write.
