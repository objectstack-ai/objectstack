// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D13 (C5, stage S1) — a platform-object RETIREMENT, not a spec-key
// retirement: no authorable spec key moves, so nothing lands in
// RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair with (the
// scim-provider-object-retired shape). The writer/reader census behind the
// verdict is cited in the reason.
export const entry: SemanticMigration = {
  id: 'sys-view-definition-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the sys_view_definition platform object (SysViewDefinitionObject, exported by '
    + '@objectstack/metadata-core and re-exported by @objectstack/platform-objects and its '
    + 'metadata subpath), its registration by MetadataPlugin and by the metadata protocol '
    + 'assembly, its name in PLATFORM_OBJECTS_BY_PACKAGE (@objectstack/spec system constants), '
    + 'its kernel:ready active-row index migration and that migration\'s exports from '
    + '@objectstack/metadata-protocol (ensureViewDefinitionActiveIndex, resolveIndexExec, '
    + 'buildActiveIndexSql, VIEW_DEFINITION_TABLE, VIEW_ACTIVE_INDEX_NAME, '
    + 'VIEW_ACTIVE_PROBE_INDEX_NAME, VIEW_ACTIVE_INDEX_COLUMNS and the EnsureViewIndex types), '
    + 'and its idx_sys_view_def_active entry in the os migrate duplicates runtime-index pre-flight',
  replacement:
    'nothing replaces the table — a runtime-authored view is a `view` metadata item in '
    + '`sys_metadata`, written through `PUT /api/v1/meta/view/<name>` (the client\'s '
    + '`meta.saveItem` for type `view`), which is what every framework and Studio view door '
    + 'already does. Delete any import of the removed symbols; `classifyIndexFailure` and the '
    + '`IndexExec` type are still exported by `@objectstack/metadata-protocol`, from the '
    + 'shared index-migration module. A stack that names `sys_view_definition` (a lookup '
    + 'target, a flow trigger, a permission entry, a platform-global declaration) removes the '
    + 'reference: the name no longer resolves to a platform object',
  reason:
    'ADR-0131 D13: an object no framework code writes or reads is inert and retires. Census at '
    + 'commit 41d0d4038c of this repository\'s main branch, run with the glob pathspec over '
    + 'packages/**/src (41 files; control word sys_metadata 769) and repo-wide (65 files): no '
    + 'framework writer of the table\'s rows and no reader of them — the only statements that '
    + 'touched its rows were the active-row index migration\'s own presence and duplicate '
    + 'probes and the os migrate duplicates pre-flight\'s copy of the latter. The sibling Studio '
    + 'repository never referenced it (0 hits against 93 for sys_metadata, at its main branch '
    + 'and at the pinned console commit): its view create, update and list doors write the '
    + 'ADR-0005 view overlay through the metadata API. The only way a row could ever have '
    + 'reached the table was a caller using the generic data door on the object by name. '
    + 'Keeping it registered kept an API-enabled table, a boot-time index migration and a '
    + 'pre-flight probe alive for no consumer, and kept the name resolving as a real platform '
    + 'object for authored metadata that named it.',
  acceptanceCriteria:
    'No code imports SysViewDefinitionObject or the removed metadata-protocol exports (TS2305 '
    + 'after upgrade). isPlatformProvidedObjectName answers false for sys_view_definition, so a '
    + 'stack referencing the name is flagged as a probable typo rather than resolved. Neither '
    + 'MetadataPlugin nor the metadata protocol assembly registers the object, a serving boot '
    + 'issues no statement naming it, and os migrate duplicates reports three runtime-index '
    + 'pre-flight entries, none naming it. Existing databases: schema sync is additive and never '
    + 'drops a table, so a database an earlier release provisioned keeps sys_view_definition and '
    + 'any rows a caller wrote through the generic data door, and nothing reads them. os migrate '
    + 'apply --allow-destructive does not drop it either — it reconciles declared objects only '
    + '(measured: on one database it dropped an orphaned column of a declared table and left '
    + 'this table and its row in place). os migrate plan lists it among the platform-prefixed '
    + 'tables nothing declares when the project has a host config. Export any row worth keeping; '
    + 'dropping the table is the operator\'s call, by hand.',
};
