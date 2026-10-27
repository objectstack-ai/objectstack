---
'@objectstack/objectql': patch
---

fix(objectql)!: inside one bulk create, a child rule that reads a parent summary counts the earlier rows of the same batch its rules admitted, so a batch is judged as its rows would be one by one (#25579)

Clause-②: no (narrowing) — a bulk create (`insert(array)`, `insertMany`, and the doors on them: `createManyData`, `insertManyData`, the import's batched creates) refuses a row whose rule reads a parent `summary` that the earlier admitted rows of the same batch move past the rule's limit, which it admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: an existing validation rule is now enforced on the rows of one bulk create the way it is already enforced one write at a time. The refusal is the rule's own VALIDATION_FAILED, worded by its author, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the bulk insert (`@objectstack/objectql`), served by every bulk create door.

- **Before.** A bulk insert read the related rows its rules read through a reference once, before any row of the batch was written, and recomputed parent summaries once, after. So "each supplier has at most one primary contact" (a `count` summary filtered on `{ is_primary: true }`, and the child rule `record.is_primary == true && record.supplier.primary_contact_count > 0`) refused a second primary contact written on its own, but admitted two primary contacts for one supplier in one import: both rows read `0`.
- **Now.** Each row's rules read the parent summary as it stands after the earlier rows of the same batch that the rules admitted. The batch's admitted rows are accumulated in memory per summary and per parent; ⛔ nothing is re-read from the database per row. In the card's import, one contact is created and the other row reports the rule's error. A multi-row insert preview (`validate` with an array, mode `insert`) answers the same way.
- **Unchanged.** Which rows land and how a refusal is reported stay each door's own: `insertMany` / `insertManyData` (the import) report the refused row and write the rest; `insert(array)` / `createManyData` refuse the whole batch. A row the rules refuse is not counted. A single write reads the stored summary as before. The summary written after the batch is the same recompute as before.
- **Which summaries accumulate.** `count`, and `sum` / `min` / `max` over number values, with the summary's `filter` evaluated on the new row. An `avg` summary, a `sum` / `min` / `max` that meets a value that is not a number, and a summary whose `filter` reads a dotted path through another reference keep reading the stored value, as before.
- **Not covered.** Concurrent writes: two writes in flight at the same time each read the summary they started from (批量等于逐条，并发不保证).
- **Who sees it.** An app whose child rule reads a parent summary and that bulk-creates children: a batch that broke the rule was admitted whole before, and now its offending rows are refused.

**The remedy.** None needed for a rule that meant what it says. A batch that must land whole has to satisfy the rule row by row, in order.
