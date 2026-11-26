---
'@objectstack/driver-turso': patch
'@objectstack/driver-sql': patch
---

fix(driver-turso): the remote face gives a declared field's column the DEFAULT the local face gives it

Clause-②: yes (widening)
Metadata-protocol: none (no key or value an author can write changes, and `defaultValue` means what it meant: the remote face now writes the column DEFAULT the local face already writes for the same declaration)

- **A `storage.notNull` field with a literal `defaultValue`, added to a table that already holds rows, now syncs on a hosted Turso/libSQL environment.** The remote face emitted no column DEFAULT for any field, so SQLite refused `ADD COLUMN … NOT NULL` there (`Cannot add a NOT NULL column with default value NULL`), and that object's whole sync failed through `syncSchema` and `syncSchemasBatch`; the local face accepted the same declaration. Both faces now add the column NOT NULL with the DEFAULT, and the existing rows take it.
- **A fresh remote table carries the same column DEFAULTs as a fresh local one**, on `CREATE TABLE` and on `ADD COLUMN`, for every field that declares a literal or `NOW()` default, nullable fields included. A multi-value column, a runtime token other than `NOW()` (such as `current_user`) and an object default get none, as on the local face. The shared drift differ reads a remote column as no drift.
- **A nullable field with a literal `defaultValue`, added to a remote table that already holds rows, now fills those rows with the default**, as on the local face; before, they read NULL.
- **Known limit: the remote face cannot change a column DEFAULT once it has written one.** If an author later edits or removes a literal `defaultValue`, the drift differ reports it (`set_column_default` / `drop_column_default`), but on the remote face both need a table rebuild, which the remote transport does not run. The column keeps the old DEFAULT, so an insert that omits the field stores the old value, and the finding stays reported. Tracked in #37430.
- **Not changed: a `NOW()` default on a column added to a table that already holds rows.** SQLite refuses a non-constant DEFAULT on that statement, so the remote face leaves it out and keeps its earlier answer: a nullable field is added with no DEFAULT, and a `storage.notNull` field is still refused. The local face currently refuses both; that defect is tracked separately.
- New `@objectstack/driver-sql` exports for drivers that write SQLite DDL as text: `emitsDeclaredColumnDefault` (which fields get a column DEFAULT), `sqliteDeclaredColumnDefaultSql` (that DEFAULT's SQLite text, or `null`) and `sqliteNowColumnDefaultSql` (the SQLite `NOW()` expression for a column type, the one the knex path uses).
