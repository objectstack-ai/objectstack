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
backfill runs. Four consequences to know before creating new tables:

- `rating` is an INTEGER column, and the two server dialects dispose of a fractional star count
  DIFFERENTLY — do not read one answer for both. PostgreSQL REFUSES `4.5` outright, where a
  `real` column accepted it. MySQL does NOT refuse: it ROUNDS, and `4.5` becomes `5` with no
  error, which is a silent alteration and the reason to declare a `slider` (in the exact-decimal
  set) for anything that wants fractional values. SQLite refuses nothing either: it stores `4.5`
  as a REAL in an INTEGER-affinity column, unchanged from today.
- An exact-decimal column is bounded where a float is not, in BOTH directions. It keeps 30
  fractional digits: a magnitude whose significant digits run past the 30th decimal place loses
  the tail silently — `1.2345678901234567e-15` stores as `0.000000000000001234567890123457`, so
  the loss begins around |x| < 1e-13 and is total below 1e-30 — and magnitudes at or above 1e35
  are REFUSED, where `real` kept about seven significant digits out to ~1e38. A refusal is loud;
  the rounding it replaces was not.
- Reads are bounded by the wire contract, not by the column. `find()` hands back a JS number
  (`z.number().finite()`), so a value that was never a JS double does not survive the round trip
  exactly — `1234567890123456.123` reads back `1234567890123456`, and 2^53+1 reads back 2^53.
  The fidelity this buys is an exact COLUMN read through a double: values written by this
  platform round-trip exactly, and SQL-side writers, `summary` roll-ups computed in SQL and any
  magnitude at or above 2^53 are bounded by the read seam. Widening that is a wire-contract
  change and is not in this release.
- A generated migration no longer emits `NOT NULL` for a field marked only `required: true`.
  Declare `storage: { notNull: true }` for a physical constraint — which is what the platform's
  own table has always done since ADR-0113, and what `os migrate meta` deliberately does NOT
  supply on your behalf (the conversion that stamped it was withdrawn by maintainer ruling on
  2026-09-08). A source author who wants the column they had must write that block themselves;
  `required: true` keeps its own meaning, the write-time contract the record validator enforces.

SQLite emits byte-identical DDL for the six exact-decimal members: knex compiles both
`table.decimal(name, p, s)` and `table.float(name)` to the same `float` column there.

<!-- adr-0087: not-required (no-migration-prescription) Claimed on a POSITIVE argument, not on the detector finding nothing — the failure mode this gate's own docblock names (#8277). Stated plainly: bullet 4 (the `NOT NULL` one) IS a prescription, and it is a prescription for a SOURCE AUTHOR, not for a metadata upgrader, which is the distinction ADR-0087's D8 addendum says this category cannot mechanically tell apart. The ledger serves `objectstack migrate meta`; the only ledger entry this change could carry is the `field-required-notnull-explicit` conversion, and that conversion was WITHDRAWN by maintainer ruling on 2026-09-08 (decision batch #85, #16693/#16890) on the ground that stamping `storage.notNull` wherever `required: true` appears is the implication ADR-0113 abolished — `packages/spec/src/conversions/registry.ts` now carries a tombstone saying re-adding one is the mistake it exists to stop. So `registered` is FORBIDDEN here, not merely unnecessary. The other four are closed on facts: the bumped packages publish (not `unpublished`); no id pre-dates the base (not `already-registered`); no named symbol is a non-metadata runtime interface (not `runtime-interface-only`); and `type-surface-only` fails its predicate 2, since this diff adds a module under `packages/spec/**`. The numeric half prescribes nothing at all — no spec key, no export and no config field is removed or renamed, existing sources parse and publish unchanged, and existing columns are untouched by the ruling that authorized this (「不考虑现有数据」). ⚠️ The residual is declared rather than hidden: the vocabulary has no category for a source-author prescription the ledger must not carry, which is D8's blind spot reached from a second direction; raised for the maintainer in the PR report rather than resolved by dropping the BREAKING banner. -->
