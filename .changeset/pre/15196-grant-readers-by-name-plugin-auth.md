---
"@objectstack/plugin-auth": patch
---

The permission-set grant readers in `@objectstack/plugin-auth` read which set a grant holds from its name column, `sys_user_permission_set.permission_set` (ADR-0131 D4)

Clause-②: no

- **What reads the name now.** The last-administrator guard (`registerLastAdminGuard`) counts a grant-anchored platform administrator from an unscoped, in-window grant whose `permission_set` is `admin_full_access`, provided the `admin_full_access` row of that name is active. The default-organization bootstrap (`ensureDefaultOrganization`) finds the platform administrator by the same grant name. The self-registration grant checks by name whether the new user already holds the declared set. None of them reads `permission_set_id` for this any more.
- **The guard treats `permission_set` as a standing column.** A write that clears the name on the last administrator's grant is refused like any other revocation. A write that re-points `permission_set_id` without a name is treated as taking the standing away, because the platform derives the new name only after the guard runs. A write that only repeats the grant's own id keeps the standing.
- **A grant whose name is empty.** A grant written before the name column existed has no name until `@objectstack/plugin-security`'s one-time backfill names it at `kernel:bootstrapped`. The guard does not count such a grant as an administrator. When no administrator is counted, such a grant, if unscoped and in-window, is evidence that the environment is not a fresh install, so the write is refused instead of the bootstrap window opening. The default-organization bootstrap answers `no_admin` for it and binds no owner; that answer records no decision, so a later trigger binds once the grant has its name.
- **Nothing to migrate.**
