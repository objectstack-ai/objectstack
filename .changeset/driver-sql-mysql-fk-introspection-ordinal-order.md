---
"@objectstack/driver-sql": patch
---

fix(driver-sql): order the MySQL `introspectForeignKeys` read by the key ordinal (#11379)

`SqlDriver.introspectForeignKeys`' MySQL arm read `information_schema.KEY_COLUMN_USAGE`
with no `ORDER BY`. `ORDINAL_POSITION` is the key ordinal and was selected by neither the
projection nor an order clause, so the row order of a composite foreign key's columns was
whatever the query plan happened to yield.

That order is load-bearing. `IntrospectedForeignKey` is a flat per-column record with no
ordinal field, so a composite key is expressed as **ordered sibling rows** — `(x, y)
references p (a, b)` is `x -> p.a` then `y -> p.b`, and there is nothing for a consumer to
recover the position from if the rows arrive permuted. The Postgres arm pins this with
`ORDER BY … k.ord`; the MySQL arm was leaving it to the optimizer.

This is a determinism fix rather than the repair of a wrong answer, and the measurement is
what distinguishes the two. On MySQL 8.0.46, a foreign key declared out of column sequence
— `foreign key (second_col, first_col) references ooo_parent (pa, pb)` — came back in key
order through this predicate with no `ORDER BY` at all. But on the same server, in the
same session, over the same view, the sibling `introspectPrimaryKeys` predicate
(`CONSTRAINT_NAME = 'PRIMARY'`) returned an out-of-sequence primary key in **column**
order — `carrier_code` at ordinal 2 ahead of `shipment_id` at ordinal 1. `KEY_COLUMN_USAGE`
therefore does not preserve the ordinal for free on this server: which of the two orders
you get is decided by the `WHERE` clause, and nothing declared that. The foreign-key
predicate was on the lucky side of a choice nobody made.

Consumers that read composite foreign keys through `introspectSchema` — federated-object
codegen, the persisted `external_catalog` (ADR-0015), and schema-drift comparison — now get
the declared key order from MySQL by construction rather than by plan choice.
