---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an organization administrator's assignment removal is judged on the stored row, and its refusal names only values the caller can read

Clause-②: no
Metadata-protocol: none

An organization administrator (`organization_admin` or `organization_admin_no_bypass`) removes an assignment row (`sys_user_position` or `sys_user_permission_set`) by id. Once its own read returns the row, the delegated-administration gate (ADR-0090 D12) judges the removal on the stored row, as it judges a delegated administrator's write.

- **The verdict is the stored row's.** A field rule or a masking rule on the row's `position` or `permission_set` does not change it: the removal of a row inside the organization boundary is admitted, and the removal of a row outside it is refused.
- **A refusal names a value only when the caller can read it.** The row's organization, its position and the sets that position carries, or its permission set are named only when the caller's own read returned that column at its stored value. Otherwise the sentence leaves the value out, for example "the assignment's position is not inside the organization boundary", and `details` leaves it out too.
- **Unchanged.** A row the caller cannot read, and an id that names no row, still answer the read door's `404 RECORD_NOT_FOUND`. An edit in place is refused as before. Inserts, tenant-level administrators and delegated administrators are judged as before.
