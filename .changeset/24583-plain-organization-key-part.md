---
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/driver-memory': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
---

feat(driver-sql,driver-turso,driver-memory,objectql,metadata-protocol,cli): an organization-scoped unique index keys the plain organization column, and an index an earlier release built with `COALESCE(organization_id, '__global__')` is read as the same index on a certified database

Clause-②: yes (widening)

18.x step 7b-1 + 7b-2 (ADR-0131 D1: the tenant column is NOT NULL, so the NULL-organization bucket of ADR-0120 D3 has no rows left to hold).

- **New DDL is plain.** A field-level `unique: true` / `'organization'` on a tenant-scoped object, and a declared index with `unique: 'organization'`, now build `UNIQUE (organization_id, …)` instead of `UNIQUE (COALESCE(organization_id, '__global__'), …)`. Index names do not change. The same holds for the Turso remote face, the MySQL hash shadow (its generated column now hashes the plain column), the in-memory driver's unique enforcement, `os generate migration` (which now emits the organization composite it used to list as NOT EMITTED), and the `sys_setting` row-identity index (`COALESCE(user_id, '')` stays).
- **Existing indexes stay as they are.** Nothing is renamed, dropped or rebuilt by this release. The schema differ reads `COALESCE(<tenant>, …)` and the plain tenant column as one key part, in both directions, where the tenant column holds no NULL: the column is physically `NOT NULL`, or the database is certified (its organization-ownership birth marker, or the ownership ceremony's marker at the current shape generation). So `os migrate plan` and the boot report no `recreate_index` for those indexes. On an uncertified database with a nullable tenant column the two forms stay different constraints, as before.
- **What widens.** Where a tenant column is still nullable (an uncertified 17.x / 18.0 database, a rotation shard, a Turso remote table), a unique index created from now on does not constrain rows whose organization is NULL, exactly like a NULL in any other key part; in the in-memory driver a record with no organization is exempt from an organization-scoped unique. The unique duplicate pre-flight no longer reports groups of rows with a NULL key part, since the index never refuses them.
- **Who sees it.** A certified database or a fresh install sees nothing: every row carries its organization there. Nothing to do.
