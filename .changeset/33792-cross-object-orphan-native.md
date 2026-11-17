---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the native SQL strategy evaluates a cross-object `where` leaf on an existing parent, so a detail row with no parent is not selected, as on the engine path and `/data`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is an aggregate over a cross-object filter, which now leaves out the detail rows with no parent, as the engine path and the /data nested-relation filter already did: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a reader of an analytics answer served by the native SQL strategy (a cube or dataset query with no bucketed time dimension, on a SQL datasource) that reads a related object's field through a relationship path (`'order.status'`) in any of the three filter positions one compile serves: the query's `where`, a measure's own `filter` (its conditional aggregate) and the dataset's own `filter`:

- FROM: a detail row whose relation field is empty, or names no existing record, was selected by `$ne`, `$nin`, `$notContains`, `$null: true`, `$eq: null`, `$exists: false` and `$empty: true` on the related field, because the `LEFT JOIN` read every related column of such a row as NULL. So the same widget answered a different total once a time bucket sent it to the engine path. TO: such a leaf is evaluated on an existing parent (the last hop's `id = id` is conjoined to it, through every hop of the path: TRUE for an existing parent, UNKNOWN for none, so a `$not` cannot flip it), and outside `$not` no such row is selected by those operators. Under one `$not` the native answer is the one it gave before. Under two, `{ $not: { $not: { 'order.status': { $null: true } } } }`, the two negations now cancel and the answer is the un-negated condition's, so such a row is no longer selected there either, where it was before. The native, engine and `/data` answers agree on those operators.

**Not moved.** A parent that exists with no value in the field still satisfies `$ne`, `$nin`, `$notContains` and `$null: true`. A positive operator (`$eq` a value, `$in`, `$gt`, `$contains`, …) selected no such row before either, and its statement is unchanged. A leaf on the base relation field itself (`{ order: { $null: true } }`) reads no join and is unchanged. One native-path answer still selects such a row, unchanged by this release: under one `$not`, any condition a missing value does not satisfy, such as a comparison with a value (`{ $not: { 'order.status': 'open' } }`) or a presence test (`$null: false`, `$exists: true`, `$ne: null`, `$empty: false`), a shape the engine path refuses; write `$ne` / `$nin` inside the condition instead.

The fix for an author who wants the rows with an empty relation: OR the base relation field in, `{ $or: [{ 'order.status': { $ne: 'open' } }, { order: { $null: true } }] }`. A row naming a record that no longer exists is not brought back by it, on either path.
