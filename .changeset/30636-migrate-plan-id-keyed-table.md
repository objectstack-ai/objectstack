---
'@objectstack/driver-sql': patch
'@objectstack/cli': patch
---

fix(driver-sql,cli): `os migrate plan` previews a `_id`-keyed table as apply treats it, and one refused table no longer stops `os migrate apply`

Clause-②: no
Metadata-protocol: none

An existing table keyed by `_id` with no `id` column is the one shape schema sync does not adopt by adding columns: it rebuilds it while it is empty and, since #30562, refuses it while it holds rows. `os migrate plan` listed it as a harmless `add_columns` step. The plan now lists it as `apply` treats it: a `rebuild_table` entry (in place) when the table is empty, and a `refuse_table` entry when it holds rows, naming the table, the `_id` column and the row count, with the refusal's own text (`refusal`, rendered by the same renderer the sync throws through). `isRefusedSchemaWork` is exported beside `isInPlaceSchemaWork`.

`os migrate apply` used to hand every held-back object to one sync call, so one refused table stopped the batch: the tables after it got no DDL and the list of performed work was lost with the error. The refused table is now left out of that call and reported on its own: every other table gets its DDL, the run names the refused table with the refusal text, and ends PARTIAL with exit 1 (`--json`: `refused` beside `created`, `message: "partial"`).
