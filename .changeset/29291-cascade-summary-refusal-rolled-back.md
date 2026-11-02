---
'@objectstack/objectql': patch
---

fix(objectql)!: a nested write's stale-roll-up refusal (`ERR_SUMMARY_RECOMPUTE`) never answers for a delete or a transaction that did not land

Clause-②: no (narrowing)
Metadata-protocol: none

Narrowing note: a delete or a transaction that answered success after rolling back now refuses (`!` in the title, full dogfood, seat contract review); claim amendment 6577647622 on #29291.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is added, removed, renamed or re-shaped, and no exported declaration is added, removed or narrowed. What narrows is one engine answer: a stale-roll-up refusal that used to leave a delete or a transaction which did not land now leaves it as a code-less error, and the remedy is the summary field's `summaryOperations` or a retry, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for one answer only. `ERR_SUMMARY_RECOMPUTE` means "this write is stored, only a parent roll-up recompute failed", and the data doors (REST, MCP) and the action, sandbox and flow writers answer it as the write's own success. Two engine units carried a nested write's refusal past the point where it stopped being true:

- **A cascade delete.** `delete()` removes a record's `master_detail` dependents through the public write path before its own row. When a dependent's delete raised the refusal (its roll-up into another parent could not be recomputed), the cascade stopped before the record was removed, and under the `'atomic'` plan the transaction rolled the dependent back too. The refusal still reached the caller, so `DELETE /api/v1/data/:object/:id` answered `200 { success: true }` for a record that is still stored. On a runtime that cannot roll back, the same delete removed the first dependent and left the record and the rest of its dependents.
- **A transaction that rolls back.** A `transaction()` (on the engine or on a scoped context, `ctx.api`) whose callback let the refusal escape rolled back every write in it, the refusing one included, and the refusal still told the caller it was stored.

**Now.** Both units answer an error with no `code` (an internal failure, a `500` at the data doors), whose message says what did not complete and names the stale summary; the original refusal is kept as `cause`. Nothing else changes: a dependent's own delete, a write outside any unit, a transaction that catches the refusal and commits, and a joined transaction whose owner decides all still read `ERR_SUMMARY_RECOMPUTE` carrying the written result.

**The remedy.** Fix the summary field's `summaryOperations` (the engine's warning names why the recompute was refused), then retry the delete or the transaction.
