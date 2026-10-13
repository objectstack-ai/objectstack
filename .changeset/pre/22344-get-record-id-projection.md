---
'@objectstack/service-automation': patch
---

fix(service-automation): a `get_record` whose `fields` leave out `id` answers the row's id as its `id` output on the SQL drivers

Clause-②: no

- **What was wrong.** On its single-row branch (no `limit` above 1) a `get_record` node answers `output: { record, id, object }`, and a later node reads that `id` as `{read.id}` (for a node whose id is `read`). The node handed the author's `fields` to the engine unchanged, and the SQL drivers return exactly the columns a projection names. So a `get_record` with `fields: ['title']` read a row with no `id` column, and `{read.id}` was empty with no error. A later `update_record` filtering on it was refused for a filter condition that resolved to nothing, and any other reference read nothing.
- **What it does now.** That branch names `id` in the projection it hands the engine, so `{read.id}` is the row's id whatever `fields` names, on every driver. The record the node serves, and binds to its `outputVariable`, carries that `id` beside the columns the author named, so the variable's `id` reads the same value. The stored-metadata tables (`sys_metadata`, `sys_metadata_history`) are read the same way: the served row is the named columns plus `id`.
- **Unchanged.** A `get_record` with no `fields`, or an empty list, still reads the whole row. A projection that already names `id` is handed over as written. The multi-row branch (`limit` above 1) answers `records` only and is untouched.
