---
'@objectstack/driver-turso': patch
---

fix(driver-turso): on a Turso remote database, a `storage.notNull` field added to an object whose table already holds rows no longer fails that object's schema sync

Clause-②: no
Metadata-protocol: none

The remote transport's additive schema sync (`syncSchema` and `syncSchemasBatch`) emitted `ALTER TABLE … ADD COLUMN … NOT NULL` with no DEFAULT. Every existing row would hold NULL in the new column, so libSQL refused it (`Cannot add a NOT NULL column with default value NULL`), the object's whole sync failed, and the object became unwritable on upgrade. The local face has added such a column nullable since the `@objectstack/driver-sql` fix for the same case.

The remote face now gives the same answer. When the table already holds a row and the field declares no literal or `NOW()` default, the column is added nullable and the drift report names it as `tighten_not_null`, which is the path the `storage.notNull` description promises ("a destructive migration gated by the schema-drift ceremony"). This transport still cannot apply a tightening itself: `os migrate apply --allow-destructive` names it as not applied, because it needs the SQLite table rebuild the remote face does not run. A column added to an empty table, or created with the table, is still added `NOT NULL`. So is a field that declares a literal or `NOW()` default, which this face still refuses on a populated table, because it emits no declared column DEFAULT. `required` is unaffected: the engine still refuses a write that omits the field. The sync sends one extra read per sync, and only when an existing table is about to gain a `storage.notNull` column.
