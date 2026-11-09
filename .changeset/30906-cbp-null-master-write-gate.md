---
'@objectstack/plugin-security': minor
'@objectstack/verify': minor
---

feat(security, verify): the `controlled_by_parent` write gate judges a detail row whose optional master is empty — its owner or Modify All on the detail writes it

Clause-②: yes
Metadata-protocol: semantic
Skills-docs: follow-up #30907

A `controlled_by_parent` object whose only `master_detail` is declared `required: false` (an optional master) could already be declared, and its rows that name no master were already read by their owner and by View All on the detail. Writing such a row was refused with `422 MISSING_REQUIRED_FIELD`. It is now judged:

- **Create.** An insert that names no master is admitted to anyone the detail's own `create` grant admits, and its creator becomes its owner. A batch is admitted the same way; every master its rows do name is still asked.
- **Update and delete.** A stored row that names no master is written by its owner (`owner_id` equal to the caller) and by a holder of `modifyAllRecords` on the detail, and refused `403 PERMISSION_DENIED` for everyone else, a holder of View All included. A row with no owner (a queue row), and every row of an object with no `owner_id` column, is Modify All's alone. The same rule judges each row a predicate update or delete (`multi: true`) selects, both principals of an on-behalf-of write, and `ISecurityService.checkControlledByParentWrite` (a refusal there is `deny` on the `master_chain` leg).
- **Setting a master** (none → M, M1 → M2) asks edit on the master the body names, as before. **Emptying one** (M → none) asks edit on the master the row leaves: the `sharing.controlledByParent.ownerMayEdit` opt-in, which lets an owner update a row with read on its master, does not cover a body that empties the master, so an owner who only reads the account cannot detach a contact and make it private.
- **Chains.** A master that is itself `controlled_by_parent` with an optional master of its own, and names none, ends the chain: writing its details asks the same rule of that row (its owner, or Modify All on its object).
- Ownership transfer is unchanged: a body that names another owner is still gated by `allowTransfer`.
- **`@objectstack/verify`.** The parent write reach family proves an optional-master detail in both cases: its records under a master, as every detail, and its records that name none, by the rule above (`ParentWriteReachReach.masters: 'none'`, with `masterRead: 'none'` and `unreadableDetails`).

A required master is unchanged: a row whose stored required master is empty still answers `422 MISSING_REQUIRED_FIELD`.
