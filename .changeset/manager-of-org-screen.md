---
"@objectstack/plugin-sharing": patch
---

fix(sharing): honour the declared `organizationId` in `managerOf` (#10231)

`ITeamGraphService.managerOf(userId, organizationId?)` declares an organization
parameter. `TeamGraphService.managerOf` spelled it `_organizationId` and
discarded it, and the `BusinessUnitGraphService` standalone fallback read
`sys_user` the same unscreened way — a declared-but-unenforced parameter on a
security seam, while `expandRoleUsers` on the same class applied
`organization_id` to its own read.

Both now apply the screen #10153 landed for the identical column
(`sys_user.manager_id`) on the approvals side: a manager who is **provably**
outside the caller's organization — membership rows exist for him, none of
them in that organization — is dropped. The read is `sys_member`, because
`sys_user` is the global better-auth identity table and carries no
`organization_id` at all; filtering the `sys_user` read on a column that does
not exist would match nothing and silently return `null` for every lookup.

The screen is fail-open on an ABSENT tenancy fact (no membership rows, or the
membership read failed) and issues no query at all when no organization is in
play, so callers that pass nothing — which is how the parameter is used today —
are byte-identical to before. The manager cache key is now organization-
qualified; a user-keyed cache would have served one screened `null` to every
unscoped reader behind it.
