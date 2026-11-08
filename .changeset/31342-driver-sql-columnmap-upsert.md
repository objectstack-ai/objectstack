---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `upsert()` resolves its conflict target and its read-back through `external.columnMap` on every dialect

Clause-②: no
Metadata-protocol: none

A federated object whose `external.columnMap` maps its key to a remote column (`CUST_NO: 'id'`) could not be upserted correctly. The payload was mapped, but the conflict target stayed the field names: the default target compiled `ON CONFLICT ("id")`, and an explicit `conflictKeys` naming the key did the same. On SQLite, PostgreSQL and MySQL alike, on a remote table without an `id` column every upsert failed. On a remote table that also has its own `id` column, which is not the mapped key, the conflict target was that other column: an upsert of an existing key raised a primary-key violation instead of merging, and the read-back of an inserted row matched that other column and answered a different row.

The conflict target, the MySQL pre-flight and identity probes, and the read-back now name the mapped columns. Refusals still name the fields the caller passed. An object without a `columnMap` compiles the statement it compiled before.
