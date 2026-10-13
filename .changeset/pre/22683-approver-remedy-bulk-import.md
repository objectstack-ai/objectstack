---
'@objectstack/lint': patch
---

`os lint`'s `approval-approvers-may-resolve-empty` hint no longer tells an author that the admin bulk import does not write `sys_user.manager_id`; it names the import's `manager_id` column as a working route, beside Set Manager and the admin endpoint

Clause-②: no

On a node whose approvers are all `{ type: 'manager' }`, the hint listed the routes that populate `sys_user.manager_id` and said of one of them: "its admin bulk import does not write it either". That has been false since the import admitted the column. `POST /api/v1/auth/admin/import-users` reads a `manager_id` column whose cell holds the manager's email address, or phone number where phone sign-in is enabled. The manager can be someone in the same file or an existing user. The import links each row once every row in the file exists, through the same derivation as `POST /api/v1/auth/admin/set-user-manager`, and reports each outcome on the row's `manager` result. A link it cannot make never fails the user it imported. The old clause sent an author with a whole file of reports away from that route.

The hint now names the bulk import's `manager_id` column among the routes that work on this platform, ahead of the clause that hands SCIM and directory sync to the deployment, and names Set Manager (Setup → Users) beside the endpoint it posts to. Nothing else about the rule moves: it fires on the same shape, at `info`, and a seeded manager chain remains the one silencer.
