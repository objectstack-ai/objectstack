---
'@objectstack/spec': minor
'@objectstack/driver-sql': minor
'@objectstack/cli': minor
---

One physical representation for the NUMERIC column family, read by every producer of DDL

`packages/spec` now states, per field type, what column a numeric field gets, and all three
producers read it: `SqlDriver.createColumn`, `os generate migration --format sql` and
`os generate migration --format typescript`. Measured on live PostgreSQL 16.13, one object
through all three producers, before and after:

```
             BEFORE                                  AFTER
             driver  sql gen        ts gen           all three
number       real    numeric(18,2)  numeric(8,2)     numeric(65,30)
currency     real    numeric(18,2)  numeric(8,2)     numeric(65,30)
percent      real    numeric(5,2)   numeric(8,2)     numeric(65,30)
slider       real    numeric(18,2)  numeric(8,2)     numeric(65,30)
summary      real    numeric(18,2)  numeric(8,2)     numeric(65,30)
progress     real    numeric(5,2)   numeric(8,2)     numeric(65,30)
rating       real    integer        integer          integer
```

7 of 7 columns diverged before, 0 of 7 after. Every arm of the old split lost data in its own
direction: `real` is IEEE-754 binary32, so a `currency` of `1234567.89` read back `1234567.9`;
`numeric(5,2)` and `numeric(18,2)` silently ROUND a legitimate `33.333` to `33.33` (round
half-up — executed, not inferred); `numeric(8,2)` refused `1234567.89` outright. `65,30` is
MySQL's documented `DECIMAL` maximum and therefore the portable one, and it is the only
candidate measured to lose nothing on a nine-value corpus.

Both migration formats also take the physical `NOT NULL` from `storage.notNull` and never from
`required`, which is where `SqlDriver.createColumn` has taken it since ADR-0113: `required` is
the write-time contract the record validator enforces, and binding the DDL to it made every
post-deploy tightening a destructive migration.

**BREAKING** — new columns only; no existing column is retyped, no migration is planned, and no
backfill runs. Three consequences to know before creating new tables:

- `rating` is an INTEGER column on PostgreSQL and MySQL, so a fractional star count is now
  REFUSED there where a `real` column accepted it. A field that wants fractional values is a
  `slider`, which is in the exact-decimal set. SQLite is unaffected: it stores `4.5` as a REAL
  in an INTEGER-affinity column and refuses nothing.
- An exact-decimal column is bounded where a float is not: magnitudes below 1e-30 round to zero
  and magnitudes at or above 1e35 are refused, where `real` kept about seven significant digits
  out to ~1e38. A refusal is loud; the rounding it replaces was not.
- A generated migration no longer emits `NOT NULL` for a field marked only `required: true`.
  Declare `storage: { notNull: true }` for a physical constraint — which is what the platform's
  own table has always done.

SQLite emits byte-identical DDL for the six exact-decimal members: knex compiles both
`table.decimal(name, p, s)` and `table.float(name)` to the same `float` column there.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes is removed or renamed — no spec key, no export, no config field. The change is the physical column a NEW table gets; existing sources parse and publish unchanged, and existing columns are untouched by the ruling that authorized this (「不考虑现有数据」). There is no FROM -> TO edit to prescribe. -->
