---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': minor
'@objectstack/metadata': minor
'@objectstack/rest': minor
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/plugin-security': minor
'@objectstack/service-datasource': minor
'@objectstack/platform-objects': minor
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
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
- `isLegacyOrganizationRow(row)` (`@objectstack/metadata-core`) → `readLegacyOrganizationRows(driver, table?)`. The row-value test read a key the engine no longer returns, so it is removed. The new read answers from the physical column, through the table's driver (`engine.getDriverForObject`): id → organization, empty on a migrated or fresh database. A seam that cannot answer is refused (`LegacyOrganizationRowsUnreadable`), never read as "none".
- An existing database → run `os migrate organization-ownership` (review its plan), then `os migrate organization-ownership --apply`. The ceremony promotes or reports the legacy organization rows, then drops the physical column. Until it has run, the v18 runtime refuses to start against the database.

The indexes are re-keyed with the column:

- The overlay unique key is (`type`, `name`, `package_id`, `bundle_member`): the declared `idx_sys_metadata_overlay_active` and the runtime partial indexes of the same names. Removing the organization TIGHTENS uniqueness. On a database the ceremony has not cleared, two legacy organizations' rows, or an organization's row and the environment's, can share a key. There the runtime index migration keeps the previous index and names the duplicates (ADR-0120 D4); it never drops a row. `os migrate duplicates` and the boot report group by the same key.
- `sys_metadata_history` is unique on (`event_seq`) and on (`type`, `name`, `version`). Its other indexes, and those of `sys_metadata_audit` and `sys_metadata_commit`, lose their organization prefix.
- `idx_sys_metadata_org_type` is gone.

What else changes:

- The boot line `[metadata_org_scoped_unserved]` is gone with the column it read. A database still holding legacy organization rows is refused at boot instead, until the ceremony has run.
- The package uninstall no longer removes a legacy organization's row of the package's name: no row carries an organization.
- Who reads the family through the generic data door (`/data/sys_metadata_*`), before → after:
  - `sys_metadata_audit`, `sys_metadata_history`, `sys_metadata_commit`, **under a wall** (`isolated` / `group`): before, the tenant wall filtered each caller to its own organization's rows, and an `organization_admin` read its organization's. With the column gone the wall has nothing to filter on, so without a gate that admin would read every organization's trail, history bodies and commit ranges. After: each requires `studio.access` (`requiredPermissions`, the #22107 precedent). The capability is platform-scoped, so an `organization_admin` holding it by role does not exist, and that admin is refused.
  - The same three, **under `single`**: before, any caller whose grant covered the table (a read wildcard) read it. After: `studio.access` is required there too. A Studio author (the platform admin among them) reads as before; a plain member is refused.
  - Every `/meta` door serving these rows admits `studio.access`: `/meta/:type/:name/history` and `/audit` admit `studio.access`, `setup.access` or `manage_metadata`; `/packages/:id/commits` admits `studio.access` or `setup.access`. `requiredPermissions` is an AND-gate and cannot name an any-of set, and `setup.access` is held by organization admins, so it could not be the gate. A caller holding only `setup.access` or only `manage_metadata` therefore still reads these rows through `/meta`, but not through the data door.
  - `sys_metadata` stays ungated, before and after: its rows are what `/meta` already serves to every organization.
- On a database the ceremony has not migrated (which `os serve` refuses, but every `os migrate` boot opens, the ceremony's own among them), the legacy organization rows are still told apart, off the physical column:
  - boot hydration, the `/meta` list, by-name and draft-preview reads and the authored hook and action binders leave them out;
  - the metadata repository's write never resolves to one: before, a save of an address that only a legacy organization's row held rewrote that row in place (measured on the ceremony's template promotion). Now the write targets the environment's row, and with none it creates one, which the re-keyed unique index refuses beside the organization's row until the ceremony settles it;
  - `os migrate meta --stored` reports such a row `skipped` and never re-saves it;
  - `os migrate security-catalog-overlays` neither lists nor deletes it;
  - a commit recorded in a legacy organization's layer is still refused by the revert;
  - the runtime-datasource reads and the packaged permission-set overlay reading leave them out.
- `SqlDriver.listPhysicalColumns(object, options?)` (new, read-only): a table's physical column names, from the catalog, joining `options.transaction`. `TursoDriver`'s remote face answers it from the remote catalog. Every boot asks whether the family still carries the retired column, and it asks this way, not through `execute()`. So `os migrate plan` keeps its "a plan writes nothing" line on a migrated or fresh database. The legacy rows themselves are read with a raw statement only where the column exists.
- `GET /forms/:slug` and `POST /forms/:slug/submit` no longer read the Default Organization's legacy layer. Every metadata read is now environment → code. The doors judge each candidate against the environment's view list, which holds one item per package of a view name. So a withdrawal in one package still closes that name's form in every package. On a deployment with no organization this closes more than before, which is the fail-closed direction. A withdrawal saved only at the organization layer is carried onto the environment by the ceremony's `metadata-promotion` step, which the runtime requires before it starts.
- The protocol's `getMetaItems` drops its undocumented `legacyFormOrganizationId` request key. It was never in the spec's `GetMetaItemsRequest`, and only those doors passed it. A caller that still passes it now gets the environment's list.
