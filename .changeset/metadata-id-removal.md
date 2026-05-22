---
"@objectstack/platform-objects": minor
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/metadata": patch
---

Remove `sys_metadata_history.metadata_id` column.

The column was originally a `Field.lookup` FK into `sys_metadata.id`,
then downgraded to plain `text` during the M1 history-writes work so
that DELETE tombstones could keep an orphaned ref. After M1 we
concluded the column carries no business value:

- Audit-time joins use `(organization_id, type, name, version)`,
  which is already a UNIQUE composite key.
- The physical row id is a database-internal detail with no logical
  identity — it cannot follow an item through delete + recreate.
- No code reader was ever added.

This release removes the column outright:

- Dropped `metadata_id` from `SysMetadataHistoryObject`
  (`@objectstack/platform-objects`).
- Dropped `metadataId` from `MetadataHistoryRecordSchema`
  (`@objectstack/spec`).
- `SysMetadataRepository.put`/`delete` no longer write the column.
- Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
  `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
  (no parent-row lookup needed).
- `MetadataHistoryCleanup` `maxVersions` policy groups by
  `(type, name)` instead of `metadata_id`.

**Migration**: Drop the column from existing `sys_metadata_history`
tables in a follow-up SQL migration. Existing history rows remain
queryable since `(organization_id, type, name, version)` is already
the canonical lookup key. No consumer code should be reading
`metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

See ADR-0008 §14 for the full rationale.
