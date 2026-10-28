---
'@objectstack/objectql': patch
---

fix(objectql): a predicate update or delete (`multi: true` with a filter) recomputes the parent roll-up summaries its matched rows name (#26950)

Clause-②: no — no write is refused and no key, value or shape changes: a stored roll-up that a predicate write used to leave stale is now recomputed, as the same write done record by record recomputes it.
Metadata-protocol: none

- **Before.** `engine.update(object, data, { where, multi: true })` and `engine.delete(object, { where, multi: true })`, which a flow's `update_record` / `delete_record` node with `multi: true` and a filter reaches, recomputed no `summary` roll-up. The parent's count, sum, min, max or average kept its old value until some by-id write on one of its children recomputed it. A bulk step that deleted or reassigned line items left the order totals wrong, with no error.
- **Now.** When a roll-up aggregates the object, the predicate write reads the foreign-key columns those roll-ups name off the rows it matches, before it writes, through the same row-scoped query, and recomputes every parent they name after the write: for a delete the old parents, for an update the old and the new ones, so a reparent recomputes both. A recompute failure surfaces as the by-id write's does (`SummaryRecomputeError`: the rows were written, the roll-up may be stale).
- **Unchanged.** An object no roll-up aggregates reads no extra row: its predicate write is still one bulk driver call. Where the write already reads its matched rows (per-row hooks, per-row validation, the referential walk of a predicate delete), that read carries the foreign keys and no second read is made.
