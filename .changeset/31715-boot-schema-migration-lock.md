---
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/cli': patch
---

fix(objectql): a server boot's schema sync takes the same schema-migration lock as `os migrate apply`, so replicas starting together create each table once

Clause-②: no
Metadata-protocol: none

Several servers booting against one Postgres or MySQL database at the same time (replicas of one deployment, or several `OS_MIGRATE_AND_EXIT=1` jobs) each read the same missing tables and each created them. Postgres then refused one of the duplicate `CREATE TABLE` statements with a `pg_type` unique-key collision, and the boot that lost logged `Schema sync FAILED` for that object while still exiting 0. The boot's schema sync now takes the schema-migration lock that `os migrate apply` takes (one name, `objectstack:schema-migrate`, and one Postgres key), on the default datasource's database, and releases it as soon as the sync is done. It is never held while the server runs. A boot that finds another migration running prints one line saying it waits, then finds the tables already there.

On a single node nothing changes: the lock is uncontended and prints nothing, and SQLite (with Turso and WASM SQLite) takes no lock at all. A boot with `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` takes none either, since it runs no DDL. A waiting boot gives up after half of the engine plugin's start budget (60 s by default), changes nothing and fails the boot with a message naming the lock; start it again once the other migration has finished.

The lock now lives in `@objectstack/objectql` (`acquireSchemaMigrationLock`, `SCHEMA_MIGRATION_LOCK_NAME`), so the engine's boot can take it; `@objectstack/cli` keeps importing it from there. `SqlDriver` gains a read-only `schemaDdlDeferred` getter, which tells the engine's boot that `os migrate plan` / `apply` is holding the driver's DDL back and will take the lock itself.
