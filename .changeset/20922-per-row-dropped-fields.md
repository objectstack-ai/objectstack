---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

The dry run and the partial-success batch insert now say which row lost which field. `ObjectQL.validate` (and `validateData`, which relays it) answers `droppedFields` on each accepted row of `results`, and `ObjectQL.insertMany` (and `insertManyData`, which passes it through) answers `droppedFields` on each `ok` outcome: the caller-supplied fields the engine legally strips from that row, one `DroppedFieldsEvent` per reason, in the engine's own reason vocabulary (`computed` for a `formula` value, `readonly` for a static `readonly` or runtime-owned field). The key is absent when nothing was taken from the row.

- **Recorded at the strips, never inferred from the union.** Each strip records what it takes from each row as it runs. A `beforeInsert` hook that assigns a protected key on one row keeps it there, so that row is not named, while a sibling row that supplied the same key and lost it is.
- **A row the write does not complete carries none.** A preview row the verdict refuses, and an `ok: false` outcome, carry no `droppedFields`: a drop means the write completed without the field.
- **The dry run and the commit agree.** On `insert` mode the preview runs the same strips the write runs, so a row's preview drops and its outcome drops are the same list. One gap is unchanged: the preview runs no hooks, so a key a `beforeInsert` hook assigns is reported by the preview and kept by the write. An `update`-mode preview does not run the `readonlyWhen` or primary-key strips, which judge a prior record the preview does not read.
- **Unchanged:** the `onFieldsDropped` listener on `insert`, `insertMany` and `validate` still reports the batch-level union, one event per reason, naming no row. So does `insertManyData`'s top-level `droppedFields`. `insert(object, rows[])` still returns the records, with no per-row slot. `strictReadonlyWrites` still refuses the whole batch before any outcome is built.

Graded `minor` in both packages: each widens a published method's declared answer with a new optional key (`InsertManyRowOutcome` gains `droppedFields`, and so does each outcome of `insertManyData`'s return type), which is an additive widening of the public surface. Nothing is removed, renamed or refused. The keys on the wire, `ValidateDataResponseSchema.results[].droppedFields` and `ImportRowResultSchema.droppedFields`, were already declared in `@objectstack/spec`.
