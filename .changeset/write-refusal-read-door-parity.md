---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a write refused for a caller who cannot read the object answers the same for a hidden row and a missing one

Clause-②: no
Metadata-protocol: none

The administration gate on the permission-assignment objects (`sys_user_permission_set`, `sys_user_position`, ADR-0090 D12) refuses a write before the object's grants are read, in words written for the write. For a by-id update or delete, a caller whose read of the object is refused now gets that read refusal from it instead — the answer its by-id read gives for every id — so a row and an id naming none answer the same status, code and sentence, with a version token (`If-Match`, `expectedVersion`) and without one.

- **Unchanged:** a caller who reads the object keeps the gate's own sentence (an organization administrator's "never edited in place", the administration hint for a holder of plain grants); a tenant-level administrator writes as before; an insert, a predicate write and a write the platform issues under the caller's context keep the gate's own refusal. Every answer is still a refusal: nothing that was refused is admitted, and nothing admitted is refused.
