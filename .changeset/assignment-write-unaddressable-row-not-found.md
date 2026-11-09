---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an assignment write the administrator cannot address answers not-found, as a read does; a refusal names only values the caller can read

Clause-②: no
Metadata-protocol: none

An organization administrator or a delegated administrator (a caller holding an `adminScope`, an organization administrator who holds one included) updates or removes an assignment row (`sys_user_position` or `sys_user_permission_set`) by id.

- **A row the caller cannot read, and an id that names no row,** now answer `404 RECORD_NOT_FOUND`: the read door's answer for that object and id, which is what a by-id write of any other object already answers. Both used to answer `403 PERMISSION_DENIED` ("the assignment row … could not be read"). An organization administrator's edit in place is asked the same question first, so an edit of a row it reads is still refused as an edit.
- **A caller the read door refuses outright** (no read grant on the table) still gets that read refusal.
- **A refusal names a value only when the caller can read it.** A delegated administrator's `DELEGATION_SCOPE_VIOLATION` names the row's position, business unit, holder or permission set only when the caller's own read returns that column at its stored value, or when the caller wrote the value itself. Otherwise the sentence is the same without the value (for example "the assignment's position distributes a permission set which is not in the scope's allowlist"), and `details` leaves the value out. The verdict does not change: it is still taken on the stored row.
- **Unchanged.** A row the caller reads keeps its verdict and its guidance. Inserts and tenant-level administrators are judged as before, and every write that was admitted is still admitted.

For clients: a by-id update or delete of an assignment row that is gone now answers `404`, as it does on every other object.
