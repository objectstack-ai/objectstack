---
"@objectstack/driver-mongodb": patch
"@objectstack/spec": patch
---

fix(driver-mongodb): take a structured `GroupByNode`, and answer `count` /
`count_distinct` the way every other backend does (#6850, part of #6814)

`driver-mongodb` is now enrolled in the shared `AGGREGATION_CASES` standard
(`@objectstack/spec/data`), and clearing that cell fixed three divergences — all
three of the kind that ANSWER rather than fail, which is why none of them ever
surfaced as an error.

**1. A structured `groupBy` node had no lowering at all (#6850).**
`GroupByNodeSchema` declares a union: a bare field name, or
`{ field, dateGranularity?, alias? }`. The pipeline builder annotated `groupBy`
as `string[]` and did `groupId[field] = '$' + field`, so a structured node — an
object in that loop — stringified: the `$group._id` key became the literal
`"[object Object]"` and its value the field path `"$[object Object]"`, which
matches nothing. The aggregation did not refuse and did not throw. It returned
rows grouped by a nonexistent path, under a column named `[object Object]`.
`MongoDBDriver.aggregate` passed the value through an `any` cast, which is why
the declared union never met that annotation at `tsc`.

Both sides now spell the declared type, so the next drift between them is a
compile error. The `$group._id` keys on `alias ?? field` and its value is the
FIELD path — the projected column is renamed, the grouping does not move, which
is the rule #6401 converged the three SQL faces onto and the one
`in-memory-aggregation.ts` has always applied. The bare-string spelling emits
exactly what it emitted before.

**2. `count_distinct` counted NULL as a distinct value (#6814).** The lowering
collects a `$addToSet` and sizes it; `$addToSet` keeps an explicit `null`, so a
nullable column answered one HIGHER than `COUNT(DISTINCT col)` — 3 where the
standard says 2. The sizing now excludes null, which is what
`COUNT(DISTINCT col)` computes on SQLite, PostgreSQL and MySQL alike and what
`objectql`'s in-memory fallback already computed.

**3. `count(col)` counted ROWS, not values.** Measured while writing the suite
and named by neither issue: the `count` arm ignored `field` entirely and emitted
`{ $sum: 1 }` for both spellings, so `count(stage)` came back 6 — the answer
`count(*)` already has — where the standard says 4. `count(col)` now counts
non-null values, and a missing field is counted as null, the SQL reading.

**A `dateGranularity` node is now REFUSED rather than silently ignored**, with
`NOT_IMPLEMENTED` / 501 in the ADR-0112 envelope — the same refusal, first
sentence for first sentence, that `driver-sql` and `driver-turso`'s remote
transport give for a granularity they cannot bucket (#6212). This driver
publishes no `supports.queryDateGranularity`, so the engine buckets every
granularity in memory and never pushes a bucketed node down; the refusal fires
only for a caller that reached the builder directly, which previously got a
`"[object Object]"` grouping instead. A native `$dateTrunc` lowering is
buildable and is not ruled out — it needs the engine's bucket LABELS, a
published capability record and `date-bucket-parity.test.ts`, so it is its own
change. A `groupBy` entry that is neither half of the union is refused with
`INVALID_QUERY` / 400.

The suite that holds all of this is server-free (`mongodb-aggregation-
translation.test.ts`): this package's real-mongod suites are opt-in since #5517,
so it drives the EMITTED pipeline through a strict in-process evaluator that
refuses every shape it does not model. It holds the lowering to the shared
table; it does not answer "does MongoDB agree?", which is a real-mongod half's
question and is recorded as still open on #6814.

`driver-memory`'s half of #6814 is untouched — it remains under the #5499
investment freeze, and its `AGGREGATION_CASES` DEBT row stands.
