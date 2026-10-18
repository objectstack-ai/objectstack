---
'@objectstack/driver-turso': patch
---

fix(driver-turso): a Turso remote database enforces the `storage.notNull` a field declares, on the tables and columns its schema sync creates

Clause-②: no

**What was wrong.** On a Turso database reached over the remote transport (`libsql://…`, the transport hosted environments use), schema sync created every declared column nullable. A field declared `storage: { notNull: true }` was not enforced there: an insert that left it empty was stored. The same declaration on a local SQLite file (`file:`) has always produced a `NOT NULL` column. The drift report, which compares the database with the declarations through the shared differ, also read each such column as destructive `tighten_not_null` drift on a database the remote sync had just created.

**What changes.** The remote face's `CREATE TABLE` and `ALTER TABLE … ADD COLUMN` add `NOT NULL` to a column whose field declares `storage.notNull`, wherever the local face adds it: on every field type, multi-value fields included, and never for `required` alone. On a remote database synced after this release, an insert that leaves such a field empty is refused by the database, and the drift report names no `tighten_not_null` for it.

**What does not change.**

- A column that already exists is not touched. A remote database synced by an earlier release keeps its nullable columns, and its drift report still names them `tighten_not_null`; no data at rest is migrated. So the remote face still declares its drift-report caveat (reworded to say this), and the `OS_ARTIFACT_URL` boot gate still does not act on a remote report.
- Adding a `storage.notNull` field to a remote table that already holds rows is refused by SQLite (`Cannot add a NOT NULL column with default value NULL`), as it is on a local SQLite file, and that object's schema sync fails loudly. The remote error now names the refused statement. One case still differs: when the field also declares a literal `defaultValue`, the local face creates the column with that DEFAULT and accepts it, while the remote face emits no declared column DEFAULT and refuses it.
