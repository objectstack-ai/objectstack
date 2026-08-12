---
'@objectstack/plugin-sharing': patch
---

Refuse deletion of a platform-global sharing rule to org-scoped callers (#7795)

`SharingRuleService.deleteRule` now requires **platform** authority to delete a
sharing rule whose `organization_id` is `null` — a row seeded from declared
metadata that belongs to no organization. A caller holding only the org-scoped
`manage_sharing` capability is refused with `PERMISSION_DENIED`, which the REST
layer answers as **403**; the `manage_platform_settings` capability, the
built-in `platform_admin` position, and system contexts are all still permitted.

Why: such a rule's criteria query runs unscoped, so deleting it purged **every**
tenant's `sys_record_share` grants under it — a cross-tenant destructive act
authorized by a capability declared `scope: 'org'`. Two measured facts made it
worse: the boot seeder re-creates the rule on the next restart under a *new* id,
so the delete was a revocation wearing removal's clothes rather than a removal;
and the safe lever was unavailable while the destructive one was not — an org
admin's `active: false` creates a second, org-stamped row and leaves the shared
rule running, so deletion was the only lever an org admin had over it.

Deliberately **403, not 404**: the row is intentionally visible — listing,
reading and evaluating platform-global rules stay open to org admins, exactly as
shipped — so answering "no such rule" would contradict a read the same caller
can perform one call earlier. Nothing on the read/evaluate surface changes.
