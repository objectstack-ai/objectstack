---
'@objectstack/driver-sql': minor
---

feat(driver-sql): a field's declared `renamedFrom` carries the old column's values to the new key in the schema sync

Clause-②: no
Metadata-protocol: semantic

A field `b` declaring `renamedFrom: ['a']` is now carried from `a` when the table has a column for `a`, none for `b`, and the object no longer declares `a`: the schema sync renames the column (one transaction on PostgreSQL and SQLite, one atomic `ALTER TABLE` on MySQL), values, indexes and constraints with it, before any additive DDL. It runs wherever the sync runs (a boot on a new artifact, `os start` / `os dev`, `os migrate apply`, a package install), and a second sync finds `b` and no `a` and does nothing. The carry is logged by name; an index named for the old key is retired once the one named for the new key stands.

A declaration the carry cannot honour throws `DeclaredRenameRefusal` before any DDL on that table, naming the field, the old key and the reason: a platform column (`id`, an audit timestamp, the tenant column, a hash shadow), a key the object still declares, a key two fields claim, both columns present, two old columns present, a destructive type change, a MySQL hash-shadow unique that cannot follow, or a dialect that renames no column. `previewDeferredSchemaWork` lists a carry as `rename_columns` (with `renames`) and a refusal as `refuse_table`. New exports: `DeclaredRenameRefusal`, `planDeclaredRenames`, `renderDeclaredRenameRefusal` and their types.
