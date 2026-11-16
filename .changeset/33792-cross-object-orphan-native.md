---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the native SQL strategy evaluates a cross-object `where` leaf on an existing parent, so a detail row with no parent is not selected, as on the engine path and `/data`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is an aggregate over a cross-object filter, which now leaves out the detail rows with no parent, as the engine path and the /data nested-relation filter already did: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a reader of an analytics answer served by the native SQL strategy (a cube or dataset query with no bucketed time dimension, on a SQL datasource) whose `where` reads a related object's field through a relationship path (`'order.status'`):

- FROM: a detail row whose relation field is empty, or names no existing record, was selected by `$ne`, `$nin`, `$notContains`, `$null: true`, `$eq: null` and `$empty: true` on the related field, because the `LEFT JOIN` read every related column of such a row as NULL. So the same widget answered a different total once a time bucket sent it to the engine path. TO: such a leaf is evaluated on an existing parent (the last hop's `id IS NOT NULL` is conjoined to it, through every hop of the path), and no such row is selected, whatever the operator. The native, engine and `/data` answers agree.

**Not moved.** A parent that exists with no value in the field still satisfies `$ne`, `$nin`, `$notContains` and `$null: true`. A positive operator (`$eq` a value, `$in`, `$gt`, `$contains`, …) selected no such row before either, and its statement is unchanged. A leaf on the base relation field itself (`{ order: { $null: true } }`) reads no join and is unchanged.

The fix for an author who wants those rows: OR the base relation field in, `{ $or: [{ 'order.status': { $ne: 'open' } }, { order: { $null: true } }] }`.
