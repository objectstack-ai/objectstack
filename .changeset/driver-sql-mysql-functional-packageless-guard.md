---
'@objectstack/driver-sql': patch
---

fix(driver-sql): on an upgraded MySQL 8 database the widening arm reads the package-less guard's functional key part as the partial unique it is, so the old, narrower unique key retires as it does on PostgreSQL

Clause-②: no
Metadata-protocol: none

`metadata-protocol` builds each package-less guard on MySQL 8.0.13+ as a UNIQUE index over one functional key part, `(CASE WHEN <package column> IS NULL THEN <the driver's hash-shadow digest of the key columns> END)`. `os migrate plan` and the dev `autoMigrate: 'safe'` sync read that key part as an unknown expression, never as the guard the widening arm waits for, so on a database upgraded from a release that had the narrower key they kept that key and offered nothing.

- FROM kept TO retired, on an upgraded MySQL 8 database, once the guard stands: `sys_user_permission_set`'s `(user_id, permission_set, organization_id)`, `sys_connector_connection`'s `(organization_id, connector_name)` and `sys_metadata_activation`'s `(metadata_type, name)` are each one `replace_unique_index`, categorized `safe`, created before it is dropped, applied by the next sync that runs safe drift or by `os migrate apply` with no `--allow-destructive`. Who sees it: a user can hold two packages' permission sets of one name in one organization, and an organization can connect two packages' connector instances of one name, where the old key refused the second. A second row naming no package is still refused, by the guard. Measured on MySQL 8.0.46 for all three tables.
- The guard is recognised strictly: the whole expression must be that `CASE WHEN <column> IS NULL THEN … END` over exactly the driver's own digest (`UNHEX(SHA2(CONCAT(<key columns> joined by 0x1f), 256))`, plain columns) of the narrower key's columns in key order, scoped by the one nullable column the wider key gained. Any other functional index (another function, hash, separator or scope, a NULL-safe part, an `ELSE`) is not a guard, and the narrower key stays kept beside it.
- Unchanged: MariaDB (its guard is a row-scoped generated column, already read as a guard), SQLite and PostgreSQL; a narrower key carried by a #11627 hash shadow is still kept whatever the guard; MySQL before 8.0.13 builds no guard and keeps the old key.
