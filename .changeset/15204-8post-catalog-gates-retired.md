---
'@objectstack/plugin-security': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/metadata-protocol': patch
---

fix(plugin-security): the data-door write gates of the retired catalog row objects are removed, the boot report names positions that bind a permission set nobody serves, and the texts that still named the retired objects and modules are corrected (ADR-0131 D3/D4, C3 stage 8-post)

Clause-②: no

Stage 8 retired the `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability` row objects, so no write to them reaches the engine. This change removes what only guarded those writes. No export of any package's entry changes, and no request that reaches the server is answered differently.

- **`@objectstack/plugin-security`.**
  - Three of the security middleware's gates on those objects are gone: the package-provenance gate on `sys_permission_set`, the platform/package row gate on `sys_position` and `sys_capability`, and the curated capability-name gate on `sys_capability`. The delegated-administration gate no longer judges `sys_position_permission_set` bindings or `sys_permission_set` authoring; it still governs `sys_user_position` assignments, `sys_user_permission_set` grants and `sys_member`. The rules those gates carried still hold where the catalog now lives: `everyone` and `guest` are code-declared positions an environment cannot overlay, and a capability cannot be created or overlaid through the metadata door at all. The audience-anchor binding gate on `sys_position_permission_set` stays for now, unchanged; an accepted ADR still names it, and it leaves with that record's correction.
  - The walled data-door refusal for those objects is deleted. Stage 8 already left it unwired, and no composition registers the objects it judged; the metadata door's walled refusal is unchanged.
  - The internal duplicate-name refusal class that only the retired permission-set data door raised is removed.
  - The packaged-permission-set lock's refusal no longer has a "choose a different name" variant: only the retired data door's create raised it. The metadata door's refusal text is unchanged, and the published signatures keep their `operation` parameter.
  - The boot's catalog reference report lists one more finding, per position: a position definition whose `permissionSets` names a set the security catalog does not resolve, usually because the package that declared the set is uninstalled or disabled. A holder of such a position is granted nothing through that name. The line clears by itself at the next boot after the package is installed again. It is logged at `error` once per boot, like the report's other lines.
- **`@objectstack/platform-objects`** and **`@objectstack/plugin-security`** object metadata: the descriptions of `sys_invitation.positions`, `sys_user_position` (object and `position`), and `sys_audience_binding_suggestion`'s permission-set name no longer name the retired objects. The translated texts follow.
- **`@objectstack/spec`**: the `projectionApplied` and `materializeApplied` descriptions on the metadata save, publish and batch-publish responses give a current example (`datasource`, `flow`) instead of `permission` → `sys_permission_set`. `EvalUser.positions` describes the positions assigned through `sys_user_position`. `PermissionSet.description`'s doc comment no longer names the deleted projection. The `name` describes of `PositionSchema` and `PermissionSetSchema` say a name is unique within the security catalog the environment serves (ADR-0131 D3: there is no organization-level catalog), replacing "unique per organization", which read the retired rows' index. The error-code ledger drops `@objectstack/plugin-security`'s `UNIQUE_VIOLATION` row, which named the removed refusal; `UNIQUE_VIOLATION` stays registered by its other emitters.
- **`@objectstack/core`**: the doc comments of `positionDefinitionFromRow` and `permissionSetDefinitionFromRow` no longer describe the deleted boot backfills as current.
- **`@objectstack/metadata-protocol`**: the doc comments of the publish materializer, mutation projector and uninstall cleanup registries give current examples (`flow`, `datasource`, the grant revocation) instead of `permission` → `sys_permission_set`.
