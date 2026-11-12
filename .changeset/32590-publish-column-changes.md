---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(driver-sql,objectql,metadata-protocol): publishing a field change on a live object brings the table to the declaration — `date` → `datetime` keeps the time, and `storage: { notNull: false }` drops the NOT NULL

Clause-②: no
Metadata-protocol: none

Publishing a changed object used to update the metadata and leave its table as it was. Two changes the field-type table says pass cleanly did not:

- **`date` → `datetime` on a table with rows.** Every time of day written after the publish was lost. Postgres and MySQL kept the `date` column, and the SQLite driver kept the field registered as a date, so the read cut the value to its day. The publish now widens the column in place (Postgres `timestamptz`, MySQL `DATETIME(3)`; each stored day becomes midnight UTC), and the driver re-registers the field's type on every sync, so a value written afterwards reads back with its time on all three dialects.
- **`required: true` → `false` with `storage: { notNull: false }`.** The column kept its NOT NULL, so every create that omitted the field was refused by the database although the declaration said it was optional. The publish now relaxes the column.

How it works:

- **`@objectstack/driver-sql`.** A new `SqlDriver.applyPublishedColumnChanges(object)` applies the `safe` column drift (now including the new `widen_date_to_datetime` op, Postgres and MySQL only) plus one `needs_confirm` entry: a NOT NULL column whose field explicitly declares `storage: { notNull: false }`. That entry is now reported whatever `required` says, and its message names the declaration. It stays `needs_confirm`, so dev `autoMigrate: 'safe'` still never applies it at boot (ADR-0113 D5). A NOT NULL with no `storage.notNull` declared either way is left as it was. Index work is not touched. `syncSchema` and `initObjects` stay additive.
- **`@objectstack/objectql`.** A new `ObjectQL.applyPublishedColumnChanges(objectName)` calls that driver door. It skips a federated object or a driver without the door, and reports what was applied and what was not. `syncObjectSchema` is unchanged.
- **`@objectstack/metadata-protocol`.** Every door that publishes an object (`saveMetaItem` in publish mode, `publishMetaItem`, `publishPackageDrafts` and the others that run `ensureObjectStorage`) calls it after the storage sync. A change the datasource cannot apply, such as a table rebuild over the Turso remote transport, or a failure while applying the changes, is logged at `error` and returned as an `object-column-changes-not-applied` warning on the answer's `advisories`. The publish still succeeds.
- **`@objectstack/driver-turso`.** The remote face inherits the door, so it diffs the remote catalog and returns any entry needing a table rebuild as not applied.

A change the table says needs a migration (for example `number` → `text`) is still refused at the save with `409 DESTRUCTIVE_CHANGE`, as before.
