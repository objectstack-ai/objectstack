---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an organization administrator's update by id is refused before the row is looked up, whatever the id names

Clause-②: no
Metadata-protocol: none

An organization administrator (`organization_admin` or `organization_admin_no_bypass`, holding no `adminScope`) updates an assignment row (`sys_user_position` or `sys_user_permission_set`) by id. An edit in place is never part of that administrator's right, so the write is refused before the row is looked up: `403 PERMISSION_DENIED`, with the same sentence and details for a row, for a row the administrator cannot read, and for an id that names no row.

Unchanged: a removal by id of a row the administrator cannot read, or of an id that names no row, answers the read door's `404 RECORD_NOT_FOUND`. An administrator who also holds an `adminScope` is judged by that scope.
