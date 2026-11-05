---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a delegated administrator's refused assignment write answers the same for a row it cannot read as for a missing one

Clause-②: no
Metadata-protocol: none

A delegated administrator — a caller holding an `adminScope`, an organization administrator who holds one included — updates or removes an assignment row (`sys_user_position` or `sys_user_permission_set`) by id. The delegated-administration gate (ADR-0090 D12) now asks first whether the caller itself reads that row, in its own context.

- **A row the caller cannot read** is answered exactly as an id that names no row is: the read door's `404 RECORD_NOT_FOUND` for that object and id. Both are answered at the gate, before any later step judges the write.
- **A row the caller reads** keeps the verdict and the guidance it had: the gate judges the stored row, as before.
- **A caller the read door refuses outright** (no read grant on the table) is answered as before: the read refusal, for every id the gate refuses, and the writes it was admitted are still admitted.
- **Unchanged.** Inserts, tenant-level administrators, and organization administrators who hold no scope are judged as before.
