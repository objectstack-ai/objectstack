---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an organization administrator's refused assignment write answers the same for a row it cannot read as for a missing one

Clause-②: no
Metadata-protocol: none

An organization administrator (`organization_admin` or `organization_admin_no_bypass`) removes an assignment row (`sys_user_position` or `sys_user_permission_set`) by id. The delegated-administration gate (ADR-0090 D12) now asks the administrator's own read, in its own context, whether that row is there to remove.

- **The removal of a row the administrator cannot read** is answered exactly as the removal of an id that names no row is: the read door's `404 RECORD_NOT_FOUND` for that object and id.
- **A row the administrator can read** is judged on the stored row. A refusal names the organization boundary, and names the row's organization, position or permission set only when the administrator's own read returns that value as stored.
- **Unchanged.** An edit in place of a row it reads is refused as before, every removal that was admitted is still admitted, and a tenant-level administrator is judged as before.
