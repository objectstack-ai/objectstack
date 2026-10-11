---
'@objectstack/plugin-security': minor
---

feat(plugin-security): the boot no longer writes `sys_position` rows — the built-in and declared position seeders and the `everyone` baseline junction writer are deleted

Clause-②: no

`SecurityPlugin` no longer seeds a `sys_position` row for the six built-in positions (`platform_admin`, `org_owner`, `org_admin`, `org_member`, `everyone`, `guest`) or for a position a stack declares, and no longer writes a `sys_position_permission_set` row binding the baseline sets to `everyone`. Positions are served by the security catalog (ADR-0131 D2): the built-ins are this plugin's declarations, a stack's positions are registry items, and `everyone`'s baseline — the app's default set and `member_default`, minus any set the high-privilege check refuses — is that anchor's declared `permissionSets`. `GET /api/v1/meta/position` lists all of them, and assigning a declared position needs no row.

No authorization decision changes: since the resolver reads position definitions, no grant reads a `sys_position` or `sys_position_permission_set` row, and a fresh database and an existing one grant every principal the same. On a database that was already seeded, the existing rows stay as they are; they are no longer refreshed at boot.

FROM → TO:

- FROM reading the built-in or declared positions from `sys_position` → TO the security catalog read (`createSecurityCatalogReader`) or `GET /api/v1/meta/position`.
- FROM the `everyone` → baseline `sys_position_permission_set` rows → TO the `everyone` definition's `permissionSets`.
