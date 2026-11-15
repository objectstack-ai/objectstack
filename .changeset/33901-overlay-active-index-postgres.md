---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

fix(metadata-protocol): on PostgreSQL the `sys_metadata` ACTIVE overlay key becomes the partial NULL-safe unique index, as on SQLite, instead of the declared NULL-distinct constraint

Clause-②: no
Metadata-protocol: none

On PostgreSQL the declared `idx_sys_metadata_overlay_active` is a UNIQUE constraint over `(type, name, package_id, bundle_member)`. `bundle_member` is NULL on nearly every row, so this constraint enforced nothing. Two ACTIVE overlays for one `(type, name, package)` could both be stored, and which one a metadata read returned was undefined. The runtime migration that replaces the constraint ran `DROP INDEX` on it. PostgreSQL refuses that (2BP01), so every process printed one `[sql-driver] DATABASE_ERROR … (2BP01)` line at its first `sys_metadata` read, kept the constraint and reported nothing else.

The migration now gets the dialect and a seam that returns rows, so it takes the PostgreSQL path the `sys_setting` and `sys_notification_preference` identity migrations already take. That path frees the name with `ALTER TABLE … DROP CONSTRAINT`, builds `UNIQUE (type, name, COALESCE(package_id, ''), COALESCE(bundle_member, '')) WHERE state = 'active'`, and checks the result by reading the index definition back. The 2BP01 line no longer appears.

If the database already holds two ACTIVE rows for one key, the old constraint stays and no row is deleted. One `[metadata-protocol] cannot rebuild 'idx_sys_metadata_overlay_active'` line is printed at `error`. It names the key that is not enforced, gives the query that lists the blocking rows and points to `os migrate duplicates`. Resolve the duplicates and restart, and the next boot builds the index. If the name cannot be freed at all, the line says the existing index is unchanged. The step never reports success it did not get.
