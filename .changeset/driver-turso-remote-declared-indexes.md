---
'@objectstack/driver-turso': patch
---

fix(driver-turso): remote mode materializes every declared object-level index, not only field-level `unique` (#17609)

## What was wrong

In remote mode (`libsql://` / `https://`), `TursoDriver` provisions tables through `RemoteTransport`, and the only index DDL that path could emit came from field-level `unique`. An object's declared `indexes: [...]` — unique or not — had no consumer there, so no remote database ever carried one. The local face (`SqlDriver`) created all of them, so nothing failed and no local test noticed: on a remote tenant database `sys_notification_delivery` (five declared indexes) and `sys_job_queue` (three) held only their primary-key autoindex, and the delivery claim query answered every poll with a full table scan (`SCAN sys_notification_delivery` + `USE TEMP B-TREE FOR ORDER BY`).

## What changes

- Remote mode now creates **every** declared index: field-level `unique` plus the object's own `indexes`, unique and non-unique, including `unique: 'organization'` with its NULL-safe `COALESCE(<tenant>, '__global__')` key part. Names and keys come from the same shared normalizers `SqlDriver` and the drift differ use (`uniqueIndexesFromFields`, `normalizeDeclaredIndex`, `buildIndexName`), so both faces land the same index set — pinned by a new local/remote parity suite that compares `sqlite_master` on both.
- New tables get their indexes in the same batch as `CREATE TABLE`.
- **Existing tables are retrofitted on the next schema sync** with `CREATE [UNIQUE] INDEX IF NOT EXISTS`. No row is read-modified or rewritten.
- An index the retrofit cannot create is reported once at `error`, naming the index, the table and the database's own cause. A declared `unique` index over rows that already violate it is **not** forced and no data is repaired: de-duplicate the key's values and re-run schema sync.
- Steady-state cost goes down: a sync now reads the existing index names once (one statement, folded into the column-probe batch it already sends) and issues no index DDL when every declared index exists. Before, every boot re-sent one `CREATE UNIQUE INDEX IF NOT EXISTS` per field-level unique index on an existing table.

## Upgrading

Nothing to change in metadata or configuration. The first kernel build after upgrading creates the missing indexes on each existing remote database — on a large table that one build pays the index build time. Watch the boot log for `could not create the declared` lines at `error`: each names an index that is still absent and why.
