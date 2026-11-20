---
'@objectstack/objectql': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
---

fix(objectql): deleting an organization also deletes its units of measure, the one exemption from the `sys_unit` delete refusal

Clause-②: yes (widening)
Metadata-protocol: none

An organization that had ever created a unit of measure could not be deleted: the delete was refused with 409 `DELETE_RESTRICTED` naming `sys_unit`, and the units could not be removed first, because the engine refuses every delete of a unit (405 `ERR_UNIT_DELETE_REFUSED`). Now the organization delete's own cascade removes that organization's `sys_unit` rows, retired ones included, through the engine's delete path, after the delete has been admitted, so no unit row is left naming a deleted organization. `organizationOwnedRowCounts` (the question plugin-auth's organization delete asks first) and the engine's own refusal no longer count units as records the organization still owns.

**Declared behaviour change.** A delete door widens, in one place only. A delete of an organization that holds units and no other record now succeeds and removes the units; before, it was refused. An organization that owns any other record is still refused, and none of its units is removed. Every other delete of a unit is still refused with 405 `ERR_UNIT_DELETE_REFUSED`, by id and batched, for a user, a system writer and an automation run, including a delete issued by a hook while the organization's delete is running: the exemption is recognised from the engine's own cascade, never from anything a caller passes. Retire a unit (`retired: true`) to stop its use, as before.
