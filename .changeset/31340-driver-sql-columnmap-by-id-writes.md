---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `update()`, `delete()` and `bulkDelete()` find their row through `external.columnMap` on every dialect

Clause-②: no
Metadata-protocol: none

A federated object whose `external.columnMap` maps its key to a remote column (`CUST_NO: 'id'`) could be created and read, but not updated or deleted by id. The payload was already mapped, but the by-id doors wrote `WHERE "id" = ?` whatever the map said. On a remote table without an `id` column the statement failed. On a remote table that also has its own `id` column, which is not the mapped key, it matched rows by that other column: an update answered `null` or a delete removed a row nobody named.

The three doors now match the key's mapped column, the column the insert read-back already used. An object without a `columnMap`, and every rotation shard, compiles the statement it compiled before.
