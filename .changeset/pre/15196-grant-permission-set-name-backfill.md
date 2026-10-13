---
"@objectstack/plugin-security": patch
---

Grants written before `sys_user_permission_set.permission_set` existed now get their permission set's name, once, at boot (ADR-0131 D4)

Clause-②: no

- **What happens on the first boot after upgrading.** At `kernel:bootstrapped`, `@objectstack/plugin-security` fills `permission_set` on every grant that has no name yet. The name is the `name` of the `sys_permission_set` row that the grant's `permission_set_id` points at. The set row is read inside the grant's own organization: a grant of an organization may name that organization's set or an organization-less one, and an organization-less grant may name only an organization-less set. Each name is checked in the security catalog before it is written. Only the name column is written: no id changes, no grant is moved and no row is deleted. No principal's grants change, because readers still resolve grants from `permission_set_id`.
- **What is left unnamed, and reported in the boot log by count and grant id.** A grant whose id names no set row (`warn`). A grant whose id names another organization's set row (`warn`); nothing about that organization is logged. A grant whose set row carries a name the security catalog does not hold at that boot (`error`): register the permission set definition, or re-point the grant.
- **It runs once.** When the pass has nothing left that a later boot could decide differently, it records its verdict in `sys_migration` under the id `adr-0131-grant-permission-set-name-backfill`, and later boots skip it. A grant the catalog could not verify, or a write that did not land, leaves the verdict unrecorded, so the next boot tries again. Without a `sys_migration` table (no `PlatformObjectsPlugin` in the composition) the pass still runs on every boot, and renames nothing it already named.
- **Nothing to migrate.** No configuration is needed.
