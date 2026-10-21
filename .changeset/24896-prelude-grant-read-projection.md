---
'@objectstack/core': patch
---

fix(core): the authorization prelude's grant read names the columns it decides on, so no formula on `sys_user_permission_set` is computed in every request a grant holder makes

Clause-②: no (a read's projection: every resolved authz answer is unchanged and pinned so; no accept set, served shape or export moves)

`resolveAuthzContext` reads the principal's `sys_user_permission_set` grants on every authenticated request. That read named no columns, so the engine computed every formula field the grant table declares for it, the record title included, though the resolver reads none of them. A title that reads through a lookup (the person's name, one hop through `user_id`) would have cost each request by a principal holding a direct grant one more `sys_user` read and one more round trip: 9 reads in 5 round trips instead of 8 in 4. The read now names exactly the four columns the resolver decides on: `permission_set`, `organization_id`, `valid_from` and `valid_until`. The resolved authorization context is unchanged for every grant state (active, expired, not yet valid, organization-owned, deployment-wide, and the Default Organization's `admin_full_access` grant), and a grant holder's prelude stays at 8 reads in 4 round trips whatever display formula the grant table declares.
