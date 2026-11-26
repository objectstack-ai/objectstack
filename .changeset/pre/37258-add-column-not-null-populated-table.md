---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a `storage.notNull` field added to an object whose table already holds rows no longer fails that object's schema sync

Clause-②: no
Metadata-protocol: none

The additive schema sync emitted `ALTER TABLE … ADD COLUMN … NOT NULL` with no DEFAULT. Every existing row would hold NULL in the new column, so SQLite (`Cannot add a NOT NULL column with default value NULL`) and Postgres (`column … contains null values`) refused it, the object's whole sync failed, and the object became unwritable on upgrade.

The column is now added nullable when the table already holds a row and the field declares no literal or `NOW()` default those rows can take. The drift report names it as `tighten_not_null`, and `os migrate apply --allow-destructive` imposes the constraint after the backfill, which is the path the `storage.notNull` description promises. A column added to an empty table, or one whose declared default fills the existing rows, is still added `NOT NULL`. `required` is unaffected: the engine still refuses a write that omits the field.
