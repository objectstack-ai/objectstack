---
'@objectstack/spec': minor
'@objectstack/driver-sql': minor
'@objectstack/cli': minor
'@objectstack/metadata-protocol': minor
'@objectstack/lint': minor
'@objectstack/service-analytics': minor
'@objectstack/objectql': minor
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
backfill runs. Four consequences to know before creating new tables:

- `rating` is an INTEGER column, and what that means **differs by dialect** — measured on
  PostgreSQL 16.13 and MySQL 8.0.46 through the driver's own write door, and pinned by
  `sql-driver-16318-numeric-representation-dialects.test.ts` in the live matrix:
  **PostgreSQL REFUSES** a fractional star count (`4.5` and `4.4` both raise `22P02`), while
  **MySQL SILENTLY ROUNDS** it half-away-from-zero (`4.5` is stored as `5`, `4.4` as `4`) and
  `SHOW WARNINGS` comes back EMPTY in strict mode — not a Note, not a truncation warning.
  ⚠️ So on MySQL this table does not end the silent-alteration class for `rating`; it moves it
  from a float's rounding to an integer's. A field that wants fractional values is a `slider`,
  which is in the exact-decimal set. SQLite is unaffected either way: it stores `4.5` as a REAL
  in an INTEGER-affinity column and refuses nothing.
- An exact-decimal column keeps **at most 30 fractional digits**, which is where the loss
  begins — not "below 1e-30". A JS double carries about 17 significant digits, so a value with
  13 or more leading zeros after the point loses its trailing digits silently: measured,
  `1.2345678901234567e-15` stores as `0.000000000000001234567890123457` on both servers (MySQL
  already differs in the last digit at `1e-13`), and only below 1e-30 does a value round to
  zero. Magnitudes at or above 1e35 are REFUSED, where `real` kept about seven significant
  digits out to ~1e38. A refusal is loud; the rounding it replaces was not.
- The **read seam is a JS double**, so the fidelity gained is exact-column-through-a-double, not
  end-to-end exactness. `find()` returns a `number`, so a 30-scale decimal, a `summary` summed
  in SQL, or any magnitude at or above 2^53 is exact in the COLUMN and approximate in the row
  you read back. That is not new as a wire limit — `valueSchemaFor` gives the whole class
  `z.number().finite()` — but it bounds the word "exact" and is stated here rather than implied.
  The read-side coercion that makes this work runs on every dialect now (it was SQLite-only on a
  premise this change falsified) and is **scoped to the field types this table decides**: a
  driver-alias column (`integer` / `int` / `float`, the spelling an EXTERNAL or introspected
  object gets) is left exactly as it read before, so a pre-existing PostgreSQL `bigint` is not
  rounded above 2^53 by this change.
- A generated migration takes the physical `NOT NULL` from `storage.notNull` alone, so a field
  marked only `required: true` now generates a NULLABLE column — the same answer
  `SqlDriver.createColumn` has given at every protocol floor since ADR-0113, and the answer
  #16693 measured and then ruled on: `required` is the write-time contract, and a column reaches
  `notNullable()` because its author wrote `storage: { notNull: true }` and for no other reason.
  The generators were the outlier, not the platform.

SQLite emits byte-identical DDL for the six exact-decimal members: knex compiles both
`table.decimal(name, p, s)` and `table.float(name)` to the same `float` column there.

<!-- adr-0087: not-required (no-migration-prescription) Argued positively rather than rested on the detector, because a reader must be able to check it. (1) Nothing authorable moves: no spec key, export, config field or object property is removed, renamed, retired or tombstoned, and `required` keeps its full protocol-17 meaning. Every existing source parses, validates and publishes byte-identically, so `objectstack migrate meta` has nothing to rewrite. (2) The one conversion that would perform the `required: true` -> `storage.notNull` edit existed and was WITHDRAWN by maintainer ruling on 2026-09-08 (#16693, decision batch 85, option A); `packages/spec/src/conversions/registry.ts` carries that withdrawal at HEAD and says re-adding it is the mistake the comment exists to stop, because stamping the constraint wherever `required: true` appears is the implication ADR-0113 abolished and a conversion cannot be what decides a column constraint. Registering here would land exactly the entry that ruling removed. (3) That same ruling records the migration answer for this change in as many words: no migration is owed to anyone, and existing columns are left exactly as they are. What changes is a PRODUCER'S OUTPUT for NEW tables. -->
