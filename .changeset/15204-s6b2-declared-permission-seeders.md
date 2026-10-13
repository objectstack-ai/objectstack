---
'@objectstack/plugin-security': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/cloud-connection': patch
---

feat(plugin-security)!: no seeder or materializer writes a `sys_permission_set` row — the declared-permission seeder, the platform-default materialization and the `permission` publish materializer are deleted

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime change on a platform object's rows and on TypeScript surfaces, not on any metadata schema: no key of any spec schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The rows the retired seeders wrote stay in the table until a later ADR-0131 stage; nothing reads them for authorization. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.

`SecurityPlugin` no longer writes a `sys_permission_set` row for any permission set: not for the platform defaults (`admin_full_access`, `member_default`, …), not for a set a package declares, not for an organization's copy, and not on a metadata reload or an organization's creation. Permission sets are served by the security catalog (ADR-0131 D3), and since the grant names its set (`sys_user_permission_set.permission_set`), no grant path needs a row. A fresh database still promotes its first platform administrator, grants organization administrators and self-registered members, and grants every principal what it was granted before. On a database that was already seeded, the existing rows stay as they are; they are no longer refreshed at boot. Until a later stage retires the ADR-0094 projector, publishing a permission set (a package-door publish, or a writable base's direct publish) still has it write a projection row, `managed_by: 'admin'` with no `package_id` (a package-door publish wrote `managed_by: 'package'` before this release); no authorization path reads it, and uninstalling the package removes it.

- **Accepted package defaults follow every publish.** The `everyone` anchor is derived again after every landed `permission` mutation (publish, direct save or delete, through any door), so an accepted set whose new body no longer qualifies stops granting at once. Before this release the re-derivation ran only inside the publish materializer, and only when the published body carried an `isDefault` key.
- **`drift_status` and `drift_detail` are gone from `sys_permission_set`**, with the **Needs Attention** list view that listed them. Nothing computes them any more: the declared-versus-enforced diagnostic retired with the rows it compared. A Studio overlay that shadows a packaged set is still named at boot.
- **Uninstalling a package still revokes every grant of its permission sets** (ADR-0090 D5, "no ghost grants"). With no row standing for a package's set, both uninstall doors (`deletePackage` and `DELETE /api/v1/marketplace/install-local/:id`) capture the set names the package held just before they withdraw it from the registry, and the `security.package-permissions` cleanup revokes every `sys_user_permission_set` grant naming them. The withdrawal still runs before the cleanups. A grant naming such a set would otherwise survive the uninstall and be live again on reinstall. Grants written before the name column, and position bindings, are still reached through a legacy `sys_permission_set` row where an already-seeded database holds one.
- `bootstrapPlatformAdmin` no longer takes the `resync` option and no longer reports `seeded`, `resynced` or `resyncSkipped`. A refused read of the legacy `admin_full_access` row (the restrict-only reach to a grant written before the name column existed) withholds the promotion and says so once.

Added (additive, nothing an author writes changes):

- `@objectstack/metadata-protocol`: the optional `declared?: UninstallDeclared` argument of `UninstallCleanup` (and of `runUninstallCleanups`' request), the `UninstallDeclared` type, and `captureUninstallDeclared(registry, packageId, stored?)`, the one capture both doors call. A cleanup that ignores `declared` behaves as before.
- `@objectstack/objectql`: `SchemaRegistry.securityCatalogNamesHeldBy(packageId, type)`.
- `@objectstack/plugin-security`: `cleanupPackagePermissions` takes an optional fourth argument, the captured names.

Removed from `@objectstack/plugin-security`'s public exports, with no replacement:

- `bootstrapDeclaredPermissions`
- `normalizeManagedByVocab`
- `computePermissionSetDriftDiagnostics`, `persistPermissionSetDriftDiagnostics`, `runPermissionSetDriftDiagnostics`, and the types `PermissionSetDriftStatus`, `PermissionSetDriftDiagnostic`, `DriftDiagnosticsOptions`
- `CAPABILITY_DECLARATION_UNOWNED`, `CAPABILITY_PLATFORM_NAME_REFUSED`, `PERMISSION_SET_DECLARATION_UNOWNED`, `capabilityDeclarationUnownedDiagnostic`, `capabilityPlatformNameRefusedDiagnostic`, `permissionSetDeclarationUnownedDiagnostic`, `reportCapabilityDeclarationUnowned`, `reportCapabilityPlatformNameRefused`, `reportPermissionSetDeclarationUnowned`, and the types `CapabilityDeclarationUnownedDiagnostic`, `CapabilityPlatformNameRefusedDiagnostic`, `PermissionSetDeclarationUnownedDiagnostic`
