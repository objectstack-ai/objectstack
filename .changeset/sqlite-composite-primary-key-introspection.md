---
"@objectstack/driver-sql": patch
---

SQLite introspection now reports every member of a composite primary key, in
declared key order. `SqlDriver.introspectPrimaryKeys` filtered
`PRAGMA table_info` rows on `row.pk === 1`, but SQLite does not report `pk` as
a boolean — it is the column's **1-based position within the primary key**
(`0` = not part of the key, `1` = first key column, `2` = second, and so on).
The filter therefore kept only the first member of a composite key and silently
dropped the rest.

Measured on in-memory SQLite, table declared `primary key (order_id, line_no)`:

| signal | reported | reports instead |
| --- | --- | --- |
| `table.primaryKeys` | `['order_id']` | `['order_id', 'line_no']` |
| `column.isPrimary` for `line_no` | `false` | `true` |

Both signals were wrong together and for the same reason: `introspectSchema`
derives `col.isPrimary` from `primaryKeys`, so a consumer could not recover the
dropped member by cross-checking the two. Fixing the list repairs the flag with
it.

The rows are now also ordered by the `pk` ordinal rather than taken in
`table_info` row order (which is *column* order). The two differ whenever a key
is declared out of column sequence — a table with columns
`(carrier_code, shipment_id, leg_seq)` and `primary key (shipment_id,
carrier_code)` now reports `['shipment_id', 'carrier_code']` — and
`primaryKeys` is consumed as an addressing / upsert-conflict-target key, where
the order is load-bearing.

Consumers affected: the federated-object codegen and the persisted
`external_catalog` (ADR-0015) recorded a partial addressing/upsert key, and
schema-drift comparison against a declared composite key read as drift on the
dropped member. `SqliteWasmDriver` and `TursoDriver` extend `SqlDriver` and
override neither method, so they inherit the repair. The Postgres and MySQL
arms did not have this defect and are unchanged.
