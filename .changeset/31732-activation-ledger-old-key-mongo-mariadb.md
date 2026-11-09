---
'@objectstack/driver-mongodb': patch
'@objectstack/driver-sql': patch
'@objectstack/metadata-protocol': patch
---

fix(drivers): an upgraded MongoDB or MariaDB database retires the activation ledger's old `(metadata_type, name)` unique safely

Clause-②: no
Metadata-protocol: none

The activation ledger `sys_metadata_activation` became unique on `(metadata_type, package_id, name)` (ADR-0150 D4), with a separate index, `uniq_sys_metadata_activation_packageless`, keeping rows that name no package to one per `(metadata_type, name)`. On two kinds of upgraded database the old two-part unique stayed beside them and would refuse the first second-package row of a name. This release replaces it safely there. Fresh databases are unaffected.

- **MongoDB.** Who sees it: a deployment whose `sys_metadata_activation` collection was synced by an earlier release. Schema sync now drops `idx_metadata_type_name_unique` once the wider key and the package-less guard are confirmed present, and prints one `warn` line naming the collection, the old key and the new key. The rule is general but narrow: it drops only a unique this driver built itself (its own name and options), whose fields are an in-order part of an unnamed declared global unique, that no current declaration still asks for, and, when a gained field is not `required`, only beside a partial unique on the old fields over the rows where that field is null. The plain read index over the old fields stays: it refuses nothing and still serves lookups.
- **MariaDB.** MariaDB has no partial index and no functional key part, so until now the package-less guard was not built there and the old index had to stay. The guard is now a UNIQUE key over an INVISIBLE generated column, `uniq_sys_metadata_activation_packageless__hash`, holding a digest of `(metadata_type, name)` that is NULL for a packaged row (MariaDB 10.3 or later). INVISIBLE keeps the column out of every read. Who sees it: on the next boot of such a database, `os migrate plan` reports the old index as one `replace_unique_index`, category safe, and `os migrate apply` replaces it with no `--allow-destructive`. A second row naming no package is still refused, and two packages may each hold a row of one name. The SQL driver's drift check reads this guard as a partial unique, never as an orphan index or column to drop. A MariaDB database that already holds two package-less rows of one name keeps them and gets one `error` line with the query that lists them, as on the other dialects.
