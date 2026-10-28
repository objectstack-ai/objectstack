---
'@objectstack/objectql': patch
---

fix(objectql)!: a `deleteBehavior: 'restrict'` reference refuses the delete of the record it protects even when the referencing row would be cascade-deleted by that same delete (#26718)

Clause-②: no (narrowing) — a by-id delete (`delete` by id, `DELETE /api/v1/data/:object/:id`, and the bulk `deleteManyData` door, which deletes by id row by row) refuses with 409 `DELETE_RESTRICTED` where it succeeded: when a row the delete would cascade-delete only through the record it restricts holds an authored `restrict` reference to that record. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: an authored deleteBehavior restrict is now honoured on a row that also cascades from the record it protects. The refusal is the existing DELETE_RESTRICTED, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the by-id delete (`@objectstack/objectql`), served by every delete door that deletes by id.

- **Before.** A child holding a `master_detail` and a `deleteBehavior: 'restrict'` lookup to the same parent row: deleting the parent answered success, the cascade deleted the child, and the restrict was never asked. The same held for a grandchild under that parent holding the restrict. The delete collects every record its cascade removes first, and judged a `restrict` only against rows outside that set; the child is in the set by its own master_detail.
- **Now.** Before the first write, the delete judges every authored `restrict` (on a `lookup`, a `tree` or a `master_detail`) held by a row it would remove only because the record that restrict protects is removed. Such a row refuses the delete with the existing `409 DELETE_RESTRICTED`, naming the restricting object (`dependentObject`) and field, and nothing is deleted. The answer no longer depends on the order the two fields are declared in.
- **Unchanged.** A restrict held by a row outside the delete's cascade still refuses, as before. A row the cascade reaches through another record is still exempt: deleting an account still deletes a contract and the contact the contract restricts when both are details of that account. A required lookup's `set_null`, which is refused as `restrict` because it cannot be cleared, still steps aside for a row the cascade deletes. A plain `master_detail` with no restrict still cascades, and `set_null` still clears.
- **Who sees it.** An app with a detail that also restricts its own master (directly or from further down the cascade): deleting that master used to destroy the detail, and is now refused while the detail references it.

**The remedy.** Delete the restricting detail (or clear its restrict reference) first, then delete the parent. If the detail is meant to go with its parent, drop the `restrict` from the second reference.
