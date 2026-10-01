---
'@objectstack/driver-turso': patch
'@objectstack/driver-sql': patch
---

An `upsert` keyed on a business column keeps the stored row's primary key on the Turso remote face, and both drivers answer the stored row.

Clause-②: no

**Remote face (`@objectstack/driver-turso`).** `upsert(object, data, ['email'])` on a remote (hosted) database used to replace the matched row's `id`: with the payload's `id` when it carried one, else with a freshly generated one. Every reference to the old id was left pointing at nothing, and no error was raised. The merge now leaves `id` and `created_at` alone, as the local and embedded-replica faces already do. It reads the columns to leave alone from the same list the local faces use, so `id`, `created_at` and the `auto_number` columns are kept on a merge on every face. An upsert on the primary key (no `conflictKeys`, or `['id']`) is unchanged, and an upsert that inserts still writes the payload's `id`, or a generated one.

**The answer (`@objectstack/driver-sql`, and the remote face).** On such a merge, `upsert` returned the payload instead of the stored row, so the answer carried the payload's `id` (or the generated one), an id no stored row has. It now returns the stored row: its own `id`, with the merged values. The row is read back by the conflict-key values. When a conflict key is empty in the payload, nothing can have matched it, so the row was inserted and it is read back by its `id`, as before.

To change a row's `id` on purpose, use `update()`. An `upsert` never changes it.
