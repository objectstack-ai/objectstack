---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': minor
'@objectstack/metadata': minor
'@objectstack/spec': minor
'@objectstack/cli': patch
---

feat(metadata-core,metadata-protocol)!: the `sys_metadata` family declares no organization column — `sys_metadata`, `sys_metadata_audit`, `sys_metadata_commit` and `sys_metadata_history` (ADR-0131 D6/D7)

Clause-②: yes (narrowing)

<!-- adr-0087: registered sys-metadata-organization-column-retired, sys-metadata-audit-organization-column-retired, sys-metadata-commit-organization-column-retired, sys-metadata-history-organization-column-retired -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.

Metadata is the environment's (ADR-0131 D6). The four tables of the metadata family no longer declare `organization_id`, and each sets `systemFields.tenant: false`, so the engine injects none back. The engine refuses an undeclared field, so nothing reads or writes the column any more.

FROM → TO:

- An authored filter, list-view column, report grouping, formula or seed key naming `organization_id` on one of the four tables → delete it; no organization owns a row. The field resolver answers it as an unknown field.
- `new SysMetadataRepository({ engine, organizationId, orgLabel })` → `new SysMetadataRepository({ engine, orgLabel })`. The `organizationId` option is gone: every repository reads and writes the environment's rows.
- `DatabaseLoader`'s `organizationId` option (and so `MetadataManager.setDatabaseDriver` / `setDataEngine`'s `organizationId` argument) → accepted and ignored, like `environmentId`: no write stamps it and no read filters on it. Drop the argument.
- An existing database → run `os migrate organization-ownership` (review its plan), then `os migrate organization-ownership --apply`. The ceremony promotes or reports the legacy organization rows, then drops the physical column. Until it has run, the v18 runtime refuses to start against the database.

The indexes are re-keyed with the column:

- The overlay unique key is (`type`, `name`, `package_id`, `bundle_member`): the declared `idx_sys_metadata_overlay_active` and the runtime partial indexes of the same names. Removing the organization TIGHTENS uniqueness. On a database the ceremony has not cleared, two legacy organizations' rows, or an organization's row and the environment's, can share a key. There the runtime index migration keeps the previous index and names the duplicates (ADR-0120 D4); it never drops a row. `os migrate duplicates` and the boot report group by the same key.
- `sys_metadata_history` is unique on (`event_seq`) and on (`type`, `name`, `version`). Its other indexes, and those of `sys_metadata_audit` and `sys_metadata_commit`, lose their organization prefix.
- `idx_sys_metadata_org_type` is gone.

What else changes:

- The boot line `[metadata_org_scoped_unserved]` is gone with the column it read. A database still holding legacy organization rows is refused at boot instead, until the ceremony has run.
- The package uninstall no longer removes a legacy organization's row of the package's name: no row carries an organization.
