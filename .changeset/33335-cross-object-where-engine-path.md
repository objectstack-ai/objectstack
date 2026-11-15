---
'@objectstack/service-analytics': patch
---

feat(service-analytics): the engine-aggregate path filters on a related record's field — a one-hop dotted `where` leaf (`'order.status'`) is served as the engine's nested-relation condition instead of refused (#33335)

Clause-②: yes (widening) — `ObjectQLStrategy` serves a query shape it refused with `400 INVALID_FIELD` ("cannot evaluate a cross-object filter … the engine cannot join in an aggregate"): a one-hop dotted member in the caller's `where` (a dataset query's `runtimeFilter`, a dashboard global filter, a widget filter). No authorable schema, export or wire shape changes, and every other answer is unchanged.
Metadata-protocol: none

A dashboard over detail rows can now leave out the rows of a cancelled parent on every deployment, where before only a query the native-SQL strategy served could (a SQL datasource, with no bucketed date dimension, no federated object, and no engine-enforced read gate on any object it reads).

**What a served leaf means.** `{ 'order.status': { $ne: 'cancelled' } }` reaches the engine as `{ order: { status: { $ne: 'cancelled' } } }`, the nested-relation condition the engine already serves in `where`: it reads the related object as the caller (its row-level security and field permissions apply) and keeps the base rows whose relationship points at a record that read returned.

- A row with no related record, or one the caller cannot read, is not selected, whatever the operator (`$ne` and `$nin` included). To keep such rows, OR in the relationship itself: `{ $or: [{ 'order.status': { $ne: 'cancelled' } }, { order: { $null: true } }] }`.
- No matching related record selects no row, never the unfiltered set.
- A related field the caller cannot read is refused `403 PERMISSION_DENIED`; more than 1,000 matching related records are refused `400 INVALID_FILTER`, never truncated.
- Leaves on one relationship in one conjunction are one condition (one related record satisfies all of them).
- The `/analytics/sql` echo refuses such a query `400 INVALID_FILTER`, as it does the authored nested-relation form; `/analytics/query` returns its rows.

**Still refused (`400 INVALID_FIELD`, `param: 'where'`)**, each with its reason and the native-SQL route in the message: a path of two or more relationships, a related-field leaf under `$not` (write `$ne` / `$nin` inside the leaf), a related field compared with a `{ $field }` reference, and a relationship the cube joins onto a different object than the field declares. A cross-object measure, and a related field in a dataset's own `filter` or a measure's own `filter`, stay refused as before.
