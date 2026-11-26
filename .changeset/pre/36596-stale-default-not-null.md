---
'@objectstack/driver-sql': patch
---

fix(driver-sql): removing a field's default stores NULL on MySQL 8, and never leaves a NOT NULL column refusing writes

Clause-②: no
Metadata-protocol: none

#36245 made schema sync drop a column DEFAULT the field no longer declares. On MySQL 8 the drop left the column with no default at all, so an insert that omitted the field was refused ("Field … doesn't have a default value") where Postgres and SQLite store NULL. On a nullable column MySQL now sets the default to NULL instead, so an unset insert stores NULL on all three databases.

On a NOT NULL column the drop no longer travels alone, because the database would then refuse every insert that omits the field. When the field does not hold the column NOT NULL (no `storage.notNull` and not `required`, or `storage: { notNull: false }` in words), the drop is reported together with relaxing the column, both `needs_confirm`: `os migrate apply` applies them, and so do the publish of the object and the managed install of its package when the field declares `storage: { notNull: false }`. Afterwards an unset insert stores NULL. Dev auto-reconcile applies neither, as before for a relax. When the field still holds the column NOT NULL (`storage: { notNull: true }` or `required`), the column is left alone and the stale default is reported as `destructive`, which no automatic path applies. No metadata key, value or default changes.
