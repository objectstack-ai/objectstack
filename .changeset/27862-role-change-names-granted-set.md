---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth): a role change that grants an org-admin permission set says which set it granted (#27862)

Clause-②: no
Metadata-protocol: none

Raising a member to `admin` or `owner` grants an org-admin permission set as a side effect (`organization_admin`, or `organization_admin_no_bypass` on a wall-less posture). The role change used to answer the member row alone, so the console toasted "Member role updated" and the administrator later found a set on the user that nobody visibly assigned.

- **Now.** When the role change left the member holding an org-admin set they did not hold before it, `POST /api/v1/auth/organization/update-member-role` answers two more members beside the member row: `outcome: 'permission_set_granted'` and `grantedPermissionSet: { name, label }`, the label read from the security catalog. The `sys_member` actions Change Role and Make Owner show it: "Member role updated. The new role also granted the permission set Organization Administrator (no record bypass)."
- **Unchanged.** A role change that grants nothing (admin to owner keeps the set already held, a demotion revokes it) and a refusal answer exactly as before. The member row's own columns are untouched. What is granted does not change: the grant is still written by `plugin-security`'s reconciler alone, and the new hooks only read.
- **Fails toward silence.** A grant read that fails leaves the answer as the route wrote it, without the line.
