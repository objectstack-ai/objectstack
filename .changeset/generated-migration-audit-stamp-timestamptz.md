---
"@objectstack/cli": patch
---

`os generate migration --format sql` gives every timestamp column the time zone the platform actually stores.

The SQL format spelled its two audit-stamp columns — and every declared `datetime` field — as bare `TIMESTAMP`. In PostgreSQL that is `timestamp WITHOUT time zone`, while both of the other producers of the same columns yield `timestamptz`: `driver-sql`'s `createAuditTimestampColumn` and this CLI's own TypeScript migration format both build them with knex's `table.timestamp`, and `createColumn`'s `datetime` arm states the zone-aware column as a decision rather than an accident — "Postgres deliberately keeps `table.timestamp` → `timestamptz`".

Driven, not compiled: all three producers were run against a live PostgreSQL 16.13 and their columns read back out of `information_schema.columns`. Only the SQL format came back zone-naive, and the consequence is a data defect rather than a cosmetic type difference. A zone-naive column stores the wall clock of whatever session wrote the row and keeps nothing to recover the offset from, and `DEFAULT now()` is folded into that session's `TimeZone` on the way in. Two defaulted rows inserted **six milliseconds apart**, one under `TimeZone='UTC'` and one under `Asia/Tokyo`, were recorded **nine hours apart** in the generated table and 3 ms apart in the driver's own:

```
sqlgen (timestamp)    a_utc    2026-09-05 22:31:28.309421
sqlgen (timestamp)    b_tokyo  2026-09-06 07:31:28.315458      <- +9h, same instant
tsgen  (timestamptz)  a_utc    2026-09-05 22:31:28.31332+00
tsgen  (timestamptz)  b_tokyo  2026-09-05 22:31:28.316401+00
```

The whole temporal class was enumerated in that same run and `datetime` is its only divergent member: `date` is `DATE` and `time` is `TIME` on all three producers, so neither moves.

Two things this deliberately does not change. The audit columns' **nullability** stays as it is: the driver leaves both nullable and both generators say `NOT NULL`, nothing fails either way, and the driver's own audit DDL is dialect-branched in a way a Postgres-flavoured generated migration does not reproduce — so which side moves is a ruling, recorded in `generate-builtin-id-column.pin.test.ts` and still open. The `DEFAULT now()` spelling stays too: it is the same instant as the driver's `CURRENT_TIMESTAMP` (both are `transaction_timestamp()`) and only reads differently in the catalog.

Scope for an existing project: already-generated migration files are checked-in artifacts and are not rewritten, and no deployed column is altered — a table created from an older generated migration keeps `timestamp without time zone` until its owner migrates it. What changes is what the next generated migration says.
