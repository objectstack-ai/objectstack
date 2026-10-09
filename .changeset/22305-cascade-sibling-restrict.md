---
'@objectstack/objectql': patch
---

Deleting a record no longer fails because of a record that the same delete removes. Before this fix, when a record's delete cascaded to two kinds of children, and one child held a required lookup to the other, the delete could answer `409 DELETE_RESTRICTED` naming the child that holds the lookup. Whether it did depended on which object was registered first. A measured example: an account cascades to its contacts and to its contracts, and each contract has a required lookup to a contact. With the contacts registered first, deleting the account was refused, naming a contract that the same delete was about to remove. With the contracts registered first, the same delete succeeded.

Clause-②: no

A by-id cascade delete now collects, before any refusal is judged, every record it will delete across its cascading relations, the root record included. A `restrict` raised by a record in that set against another record in the set is no longer a refusal. That covers an authored `deleteBehavior: 'restrict'` and a required lookup whose `set_null` cannot clear it. A `set_null` writes nothing to a record in the set, so that record's hooks and audit rows show the delete without an earlier update. A refusal from a record outside the set is unchanged. It still answers `409 DELETE_RESTRICTED` and names the dependent object, and on a single datasource the whole delete still rolls back. The refusal now counts only rows outside the set.

The cascade also no longer re-enters a record it is already deleting. A cycle in the data, such as two rows that cascade to each other, now deletes both rows. Before, the walk re-entered the same rows without end. A row that two cascade paths reach is deleted once, instead of the second path answering `404`.

The cost is one more read for each cascading relation of each record the cascade deletes: the set is collected by a read-only walk before the existing walk deletes. No key, export or error code changes.
