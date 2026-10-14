---
'@objectstack/plugin-security': minor
'@objectstack/spec': patch
---

feat(plugin-security)!: the permission-set projection, its seed-name lookup and refusal sink are deleted (ADR-0131 D3, C3 stage 7a)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-export-retired @objectstack/plugin-security#permissionSetRowFields, @objectstack/plugin-security#permissionSetBodyFromRow, @objectstack/plugin-security#upsertEnvPermissionSet, @objectstack/plugin-security#projectPermissionMutation, @objectstack/plugin-security#registerPermissionSetProjection, @objectstack/plugin-security#createPermissionSetWriteThrough, @objectstack/plugin-security#reconcilePermissionSetProjection, @objectstack/plugin-security#PermissionSeedOutcome, @objectstack/plugin-security#ProjectionDeps, @objectstack/plugin-security#ProjectionReconcileOutcome, @objectstack/plugin-security#WriteThroughDeps) The retired names are runtime functions and types of the projector that mirrored a permission-set definition into a sys_permission_set row. No metadata moves: no spec key, authorable spelling or stored shape changes, and no stored row is rewritten. Stage 8 already stopped registering the projector and the data-door write-through, so nothing in a running deployment called them. -->

**BREAKING** (retired exports of `@objectstack/plugin-security`), graded `minor` on the v18 prerelease line.

Stage 8 stopped registering the `sys_permission_set` row object, the `permission` mutation projector and the data-door write-through. This change deletes the modules behind them: `permission-set-projection`, `seed-name-lookup` and `seed-refusal-sink`. A permission set is written through the metadata door alone (`PUT /api/v1/meta/permission/:name`), and the security catalog serves it by name.

What a consumer sees:

- FROM `createPermissionSetWriteThrough(deps)` TO nothing: no `sys_permission_set` data-door write exists to redirect. Write the set through the metadata door. Delete the call.
- FROM `registerPermissionSetProjection(protocol, deps)` TO nothing: no row mirrors a definition. Delete the call.
- FROM `reconcilePermissionSetProjection(...)` TO nothing: there is no projection to reconcile at boot. Delete the call.
- FROM `projectPermissionMutation(...)` TO nothing. Delete the call.
- FROM `upsertEnvPermissionSet(...)` TO `PUT /api/v1/meta/permission/:name`, or the metadata protocol's `saveMetaItem({ type: 'permission', name, item })`.
- FROM `permissionSetBodyFromRow(row)` TO `permissionSetDefinitionFromRow(row)` from `@objectstack/core`: the same mapping, for converting a stored `sys_permission_set` row into its definition.
- FROM `permissionSetRowFields(definition)` TO nothing: no row is written. Delete the call.
- FROM the types `PermissionSeedOutcome`, `ProjectionDeps`, `ProjectionReconcileOutcome` and `WriteThroughDeps` TO nothing. Delete the import.

Unchanged: the security catalog's echo of a metadata-door permission set or position on an environment kernel, which lives in its own module since #23308. The packaged-permission-set lock still refuses a metadata-door save of a set a code package ships (`403 NOT_OVERRIDABLE`), and the boot still reports environment overlays that shadow such a set. `OverlayDetectionOptions.logger` now asks only for `warn`, the one channel the reading reports on.

**`@objectstack/spec`** (patch): the `permission.tabPermissions` liveness entry no longer cites the deleted projection, and the liveness README's registered-but-unbound `permission-set-projection` proof row is retired with the invariant it described (no `@proof` tag carries it any more).
