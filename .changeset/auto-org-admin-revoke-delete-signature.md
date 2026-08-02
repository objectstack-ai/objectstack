---
"@objectstack/plugin-security": minor
---

fix(plugin-security): the org-admin auto-grant can actually revoke — demoted admins really do lose tenant admin (#4640)

`auto-org-admin-grant`'s only delete channel called
`ql.delete(object, id, { context })`. The engine's signature is two arguments —
`delete(object, options?: EngineDeleteOptions)` — so the id landed in the option
bag, `rejectUnknownEngineOptions` read its character indices (`'0'`, `'1'`, …)
as unknown option keys and threw, and `tryDelete`'s `catch` swallowed it. The
system context in the discarded third argument went with it.

That wrapper is the module's **only** delete channel, so all three revoke paths
were silent no-ops for the module's entire life:

1. **Demotion and member removal did not take the capability back.**
   `organization/update-member-role` moving someone from `owner`/`admin` back to
   `member` reconciled, deleted nothing, and returned
   `{ action: 'skipped', reason: 'delete_failed' }` while the
   `sys_user_permission_set` row stayed put. That row carries wildcard
   `viewAllRecords`/`modifyAllRecords` → `isTenantAdmin()`, so the demoted user
   remained a **tenant admin**.
2. **The ADR-0105 D4 superseded-variant convergence never converged.** A posture
   change left the old `organization_admin` / `organization_admin_no_bypass` row
   in force — on a wall-less deployment, that is the unbounded variant.
3. **The `kernel:ready` orphan sweep never swept** (membership deleted, grant
   left behind).

The call now matches every other `ql.delete` call site in the repo:
`ql.delete(object, { where: { id }, context: SYSTEM_CTX })`.

## ⚠️ Behaviour change: people will lose tenant admin on upgrade — that is the fix working

Existing deployments have accumulated `sys_user_permission_set` rows that should
have been revoked when someone was demoted or removed from an organization.
After this release the `kernel:ready` backfill reconciles them, and every one of
those grants is deleted on the first boot. Concretely, on upgrade:

- users demoted from `owner`/`admin` to `member` at any point in the past
  **stop being tenant admins**;
- users whose membership was deleted lose their orphaned org-scoped grant;
- deployments that changed `tenancy.posture` converge on the posture's variant
  instead of keeping both.

Nobody loses access they were *supposed* to have: the grade that qualified them
was already taken away, and only the capability row outlived it. If a specific
person should keep blanket visibility, grant it deliberately —
`admin_full_access` or an explicitly authored permission set — rather than
through a better-auth membership grade. Expect `[security] revoked org-admin
capability` lines in the boot log naming each one.

Failed revokes are no longer silent either: a delete the datastore rejects logs
`[security] org-admin grant revoke FAILED — capability still in force`, and a
reconcile that found grant rows and removed none logs that it left them behind.
A capability the platform decided to withdraw and could not is exactly the
outcome that must reach an operator.
