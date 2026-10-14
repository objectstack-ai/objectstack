---
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': minor
'@objectstack/metadata': minor
'@objectstack/platform-objects': minor
'@objectstack/spec': minor
---

feat(metadata-core,metadata-protocol,metadata,platform-objects,spec)!: `sys_view_definition` retires as inert (ADR-0131 D13)

Clause-②: no (narrowing)

<!-- adr-0087: registered sys-view-definition-retired -->

**BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N` like every other stage.

`sys_view_definition` was declared for runtime-authored shared and personal views (ADR-0017) and never used for them: no framework code writes or reads its rows, and the Studio console's view doors write the ADR-0005 `view` overlay in `sys_metadata` through the metadata API. ADR-0131 D13 retires it. A runtime-authored view is a `view` metadata item, written through `PUT /api/v1/meta/view/<name>` (the client's `meta.saveItem` for type `view`); nothing about that path changes.

**What moves for consumers.**

- **The object.** FROM `import { SysViewDefinitionObject } from '@objectstack/metadata-core'` (or from `@objectstack/platform-objects`, or its `/metadata` subpath) TO nothing: delete the import. Neither `MetadataPlugin` nor the metadata protocol assembly registers the object any more, so the generic data door no longer serves it.
- **The migration exports** of `@objectstack/metadata-protocol`. FROM `ensureViewDefinitionActiveIndex`, `resolveIndexExec`, `buildActiveIndexSql`, `VIEW_DEFINITION_TABLE`, `VIEW_ACTIVE_INDEX_NAME`, `VIEW_ACTIVE_PROBE_INDEX_NAME`, `VIEW_ACTIVE_INDEX_COLUMNS`, `EnsureViewIndexLogger`, `EnsureViewIndexStatus` and `EnsureViewIndexResult` TO nothing: delete the import. `classifyIndexFailure` and the `IndexExec` type are still exported, unchanged, from the shared index-migration module.
- **The name.** `PLATFORM_OBJECTS_BY_PACKAGE['metadata-core']` (`@objectstack/spec/system`) lists four objects, and `isPlatformProvidedObjectName` answers `false` for `sys_view_definition`. A stack that names it (a lookup target, a flow trigger, a permission entry, a platform-global declaration) is now flagged as naming an unknown object: remove the reference.
- **`os migrate duplicates`.** `runtimeIndexPreflight` carries three entries (the two `sys_metadata` overlay indexes and `sys_setting`'s row identity), with no `idx_sys_view_def_active` entry. A serving boot no longer runs the active-row index migration for the table, and no longer logs its `sys_view_definition active-row index` lines.
- **Translations.** The platform translation bundles no longer carry `sys_view_definition` keys.

**Existing databases.** Schema sync is additive and never drops a table, so a database an earlier release provisioned keeps `sys_view_definition`, with any rows a caller wrote through the generic data door; nothing reads them. `os migrate apply --allow-destructive` does not drop it either, because it reconciles declared objects only (measured on one database: it dropped an orphaned column of a declared table and left this table and its row in place). On a project with a host config, `os migrate plan` lists it among the platform-prefixed tables nothing declares. Export any row worth keeping; dropping the table is the operator's call, by hand: `DROP TABLE sys_view_definition`.
