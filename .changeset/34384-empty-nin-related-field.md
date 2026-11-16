---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: on the native SQL strategy, an empty `$nin` on a related field no longer selects a detail row with no parent, as on the engine path and `/data`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is an aggregate over a cross-object filter written with an empty $nin, which now leaves out the detail rows with no parent, as the engine path and the /data nested-relation filter already did: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a reader of an analytics answer served by the native SQL strategy (a cube or dataset query with no bucketed time dimension, on a SQL datasource) whose filter reads a related object's field through a relationship path with an empty list, `{ 'order.status': { $nin: [] } }`, in any of the three filter positions one compile serves: the query's `where`, a measure's own `filter` and the dataset's own `filter`:

- FROM: the empty `$nin` folded to the constant TRUE (`1 = 1`), so it selected every detail row, including one whose relation field is empty or names no existing record. The same widget answered a different total once a time bucket sent it to the engine path, which leaves such rows out.
- TO: it is evaluated on an existing parent, like every other operator on a related field: the last hop's `id = id` (TRUE for an existing parent, UNKNOWN for none) takes the place of the constant, through every hop of the path. It selects every detail row whose related record exists, including one whose field has no value. The native, engine and `/data` answers agree.

**Not moved.** An empty `$nin` on the queried object's own field is still the constant TRUE, and its statement is unchanged. An empty `$in` selects no row on either path, as before. Under `$not` an empty `$nin` on a related field selected no row and still selects none.

The fix for an author who wants the rows with an empty relation: OR the base relation field in, `{ $or: [{ 'order.status': { $nin: [] } }, { order: { $null: true } }] }`. A row naming a record that no longer exists is not brought back by it, on either path.
