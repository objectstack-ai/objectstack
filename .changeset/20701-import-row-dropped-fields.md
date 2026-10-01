---
'@objectstack/core': minor
'@objectstack/spec': patch
---

An import row now says which of its fields the write dropped, on the dry run and on the commit. A column mapped to a `formula` field, a static `readonly` field or a runtime-owned field is legally stripped by the engine: the row still succeeds, and the create door already reported the strip as `droppedFields`. The import row answered a bare `ok` / `created` on both halves, so a file whose formula column was ignored read exactly like a file that wrote it. `runImport` now copies the engine's own per-row report onto each `ok` row as `ImportRowResult.droppedFields`: from the `validateData` verdict on the dry run, from the row's `insertManyData` outcome, and from the `createData` / `updateData` response of a single-row write. The synchronous route, the async job's results and the job's dry run all carry it; no REST change was needed.

Clause-②: yes (widening)

- **Verbatim, in the engine's vocabulary.** The events are the engine's `DroppedFieldsEvent`s, one per reason (`computed`, `readonly`, `readonly_when`, `primary_key`). The import reads no reason and keeps no list of non-writable types, so a reason the engine adds later reaches the row unchanged. A reader that branches on `reason` must stay exhaustive.
- **Where the key is absent although something may have been dropped.** A create batched through `createManyData` (a protocol without `insertManyData`) is reported only as a batch-level union that names no row, so those rows carry no key. And a row the import would UPDATE is previewed in `update` mode, which runs no `readonlyWhen` or primary-key strip, so its dry run can name fewer fields than its commit. The `ImportRowResultSchema.droppedFields` describe now says both.
- **Unchanged:** `ok`, `action`, the counters, the failed rows and the async job's results cap. A clean row, a failed row and a skipped row carry no `droppedFields`.

`ImportProtocolLike.insertManyData`'s declared outcome now names the optional `droppedFields` it already answered with.
