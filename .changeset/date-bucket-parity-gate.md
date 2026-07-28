---
"@objectstack/verify": minor
---

feat(verify): `checkDateBucketParity` — pin the seam between pushed-down and in-memory date bucketing

A driver that advertises `supports.queryDateGranularity[g]` is telling
`engine.aggregate` it may push `dateGranularity: g` down as SQL instead of
fetching rows and bucketing them in JS. The two are then not two features but
one feature with two implementations, and the engine picks between them per
query — a granularity the driver advertises goes down as SQL, one it does not
goes to `applyInMemoryAggregation`, and a non-UTC timezone forces the in-memory
path regardless. A dashboard can cross that seam mid-drill-down.

Nothing checked that they agree. That is how #3773 shipped: SQLite stores a
`Field.datetime` as INTEGER epoch milliseconds, `strftime` read the bare integer
as a Julian day number, and every row bucketed as NULL — a trend chart collapsed
into a single bar while every gate stayed green. The driver's own bucket suites
build their fixtures with `knex.schema.createTable` + `t.string(...)`, which is
ISO TEXT — the half `strftime` parses natively — and the engine never
second-guesses a granularity a driver claims to support.

`checkDateBucketParity(driver)` rounds a fixture through the driver and, for
every granularity it advertises, compares its pushed-down result against the
REAL `applyInMemoryAggregation` over the driver's own `find()` rows. Both
temporal storage forms are probed under one object (`Field.datetime` and
`Field.date` naming the same calendar days), so a storage-form leak shows up as
the two columns bucketing differently even when each is internally consistent.
A granularity the driver does not advertise is skipped, never faulted.

It follows `checkReadCoercion`: human-readable problems (empty = conformant), no
test-runner dependency, driver taken structurally — so an out-of-tree driver
runs the identical contract against itself. That matters most for cloud's
`driver-turso`, which is remote SQLite with exactly the epoch storage that broke
here.

Wired up in `packages/qa/dogfood/test/date-bucket-parity-conformance.test.ts`
against driver-sql and driver-sqlite-wasm, with negative controls that pin what
the checker can detect. Verified against the real regression, not just fakes:
reverting the #3773 fix turns the gate red on both drivers with a diagnostic
naming the collapsed bucket.

The three test files that hand-copy `bucketDateValue` (driver-sql cannot depend
on objectql) now say what their `⚠️ Keep in sync` comments cannot enforce — a
copy that stops tracking its original leaves the copy and the SQL agreeing with
each other while both are wrong — and point at the executable check. The same
pointer is on `bucketDateValue` itself, which is where an edit would start the
drift.
