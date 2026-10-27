---
'@objectstack/core': patch
'@objectstack/objectql': patch
---

fix(core)!: the import dry run previews create rows in the commit's batches, so a batch-aware parent-summary rule refuses in the dry run the rows the commit refuses (#26684)

Clause-②: no (narrowing) — an import dry run (`POST /api/v1/data/:object/import` and the async import job with `dryRun: true`) answers invalid for a create row that a child rule reading a parent `summary` refuses once the earlier admitted rows of its batch are counted, which it answered valid before; and the insert preview (`validate` / `validateData`, mode `insert`) refuses a row whose caller-supplied reference names no row, which it answered valid before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the dry run now reports the verdicts the import's own write already gives on the same file. The refusals are the rule's own VALIDATION_FAILED, worded by its author, and the write's reference_not_found, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the import dry run (`@objectstack/core`) and the insert preview (`@objectstack/objectql`).

- **Before.** The dry run asked the engine about each create row alone, so after #25579 it answered both rows valid when a file held two primary contacts for one new supplier, while the import created one and refused the other. The insert preview judged a row's rules but not the write's reference check, so a row with a dangling reference previewed valid and was counted toward a later row's parent summary.
- **Now.** The dry run buffers its create rows as the import does and previews them through one multi-row `validate()` per import batch (200 rows, or a smaller `progressEvery`), in file order, so the engine counts the earlier rows of the batch exactly as on the write. Each row keeps its own verdict, message and position in the report. The insert preview runs the write's reference check after the rules, behind the same write-gate probe as its related reads, and counts a row only after it passes.
- **Unchanged.** Update rows are previewed one at a time, as before. A dry run writes nothing.
- **Not covered.** A dry run writes nothing between batches, so two rows that only conflict across a batch boundary both preview valid while the import refuses the second.
- **Who sees it.** An operator dry-running an import into an object whose child rule reads a parent summary: rows the import would refuse are now reported in the dry run.

**The remedy.** None needed: fix the rows the dry run now reports, as the import would have required.
