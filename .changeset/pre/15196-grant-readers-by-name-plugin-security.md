---
"@objectstack/plugin-security": patch
---

The permission-set grant readers in `@objectstack/plugin-security` read which set a grant holds from its name column, `sys_user_permission_set.permission_set` (ADR-0131 D4)

Clause-②: no

- **What reads the name now.** The explain engine's dropped-grant provenance (`buildContextForUser`: an expired grant, or a grant of a deactivated set), the platform-admin bootstrap's existing-holder check (`bootstrapPlatformAdmin`, and the seed-ownership claim's `findExistingPlatformAdmin`), the organization-admin reconcile (`reconcileOrgAdminGrant`, `backfillOrgAdminGrants`) and the delegated-administration gate's judgement of a stored grant it is asked to change or delete. Each reads the grant's `permission_set` instead of its `permission_set_id`. Deactivation is still read from the `sys_permission_set` row, now found by that name: the grant's own organization's row, else the organization-less one. The authorization resolver in `@objectstack/core` still reads the id, and nobody's resolved permissions change.
- **A grant whose name is empty.** A grant written before the name column existed has no name until the one-time backfill names it at `kernel:bootstrapped`, and the backfill leaves a grant unnamed when its id names no set row or another organization's set row. Such a grant grants nothing through these readers. Explain reports nothing for it. The organization-admin reconcile still finds it through its id when it revokes the grant or checks for a duplicate before inserting one. The delegated-administration gate refuses a delegate's change to it; a tenant administrator is not affected. The platform-admin bootstrap does not promote a second administrator while an unscoped grant on the `admin_full_access` row is still unnamed. It returns `reason: 'admin_grant_unnamed'` without an `adminUserId`, logs a warning, and the next boot reads the grant by its name.
- **Within the organization-admin reconcile,** a pair that already holds the organization-admin set by name, through any organization's copy of it, gets no second grant.
- The earlier release notes for the name column said no reader used it yet. That is no longer true of the readers listed above.
- **Nothing to migrate.**
