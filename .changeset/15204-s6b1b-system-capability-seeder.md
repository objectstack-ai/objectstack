---
'@objectstack/plugin-security': minor
---

feat(plugin-security): the boot no longer writes `sys_capability` rows for the platform's curated capabilities

Clause-②: no

The curated and derived-default capability seeder (`bootstrapSystemCapabilities`) is deleted. On a fresh database the boot writes no `sys_capability` row for the nine curated platform capabilities (`manage_users`, `manage_org_users`, `manage_metadata`, `manage_platform_settings`, `setup.access`, `setup.write`, `studio.access`, `manage_sharing`, `view_all_audit_log`), and none for a name a permission set grants in `systemPermissions` without declaring it. The curated capabilities are served by the registry: `GET /api/v1/meta/capability` lists them and `GET /api/v1/meta/capability/:name` answers each one's definition, as before. Declare a capability your package grants with `defineCapability` (`stack.capabilities`); a declared capability is still seeded as a package row.

No authorization decision changes: a grant is still resolved by the capability name in `systemPermissions`, and no runtime check reads a `sys_capability` row. On a database that was already seeded, the existing rows stay as they are; they are no longer refreshed at boot.
