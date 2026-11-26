---
'@objectstack/objectql': patch
---

fix(objectql): a system-context delete of a record with no organization now keeps it in the recycle bin instead of failing on `sys_recycle_bin.organization_id`

Clause-②: no
Metadata-protocol: none

A delete made under `{ isSystem: true }` (the context flows, hooks and admin tooling use) of a record that names no organization, such as a record of a `tenancy: { enabled: false }` object, wrote its recycle-bin entry with no organization. On a SQL store, where the bin's tenant column is NOT NULL, the delete failed with `NOT NULL constraint failed: sys_recycle_bin.organization_id` and the record stayed. On the memory store the delete succeeded but left an entry no organization owned.

The entry now takes the organization any system-context insert takes (ADR-0131 D9): the record's own, else the context's, else the organization the engine derives. Under the `single` posture that is the Default Organization, so the record lands in the bin and can be restored. Under a walled posture (`isolated`, `group`), where no owner can be derived, the delete is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` before the record is removed, as a system insert is. A caller that deletes there passes the organization on the context (`{ isSystem: true, tenantId: '...' }`).
