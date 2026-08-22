---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `introspectPrimaryKeys` returns the Postgres and MySQL composite key in DECLARED KEY ORDER (#11101)

`SqlDriver.introspectPrimaryKeys` ordered its result on exactly one of its three
dialect arms. #10997 repaired SQLite (completeness *and* key ordering, by sorting
on the `PRAGMA table_info` ordinal); the Postgres and MySQL arms returned the key
in unspecified row order.

- **Postgres**: `a.attnum = ANY(i.indkey)` is a *membership* test. `i.indkey` is
  an `int2vector` holding the key's attnums **in key order**, but `ANY()` reads
  the vector as a set and discards the position, and the query carried no
  `ORDER BY`. It now joins the **ordinality** of `indkey`
  (`unnest(i.indkey) WITH ORDINALITY`) and orders by that ordinal.
- **MySQL**: `KEY_COLUMN_USAGE.ORDINAL_POSITION` *is* the key ordinal and was
  selected by neither the projection nor an order clause. It now carries
  `ORDER BY ORDINAL_POSITION`.

Both arms were measured returning **column order** — the key reversed — against
live servers before the fix: PostgreSQL 16.13 and MySQL 8.0.46, on a table
declared `(carrier_code, shipment_id, leg_seq)` with
`PRIMARY KEY (shipment_id, carrier_code)`. The MySQL result is worth naming
explicitly, because the received wisdom is the opposite: InnoDB did **not**
return ordinal order for an out-of-sequence key.

Why the order is load-bearing rather than cosmetic: `primaryKeys` is consumed as
an **addressing / upsert-conflict-target** key — federated-object codegen, the
persisted `external_catalog` under ADR-0015, and schema-drift comparison against
a declared key. For those consumers a key in the wrong order is a *different*
key. Until now the same table introspected through different dialects could
disagree, since SQLite reported declared key order and the other two did not; all
three now agree.

Covered by `sql-driver-primary-key-order-dialects.test.ts`, which runs the same
DDL on all three dialects and asserts the exact ordered array. Its live Postgres
and MySQL cells execute in the `Temporal Conformance (live PG + MySQL)` CI job
(a required check) and are reported as named skips elsewhere.
