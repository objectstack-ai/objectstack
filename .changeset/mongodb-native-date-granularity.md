---
"@objectstack/driver-mongodb": patch
---

feat(driver-mongodb): bucket `dateGranularity` groupBy server-side, and publish `supports.queryDateGranularity` (#7580)

`driver-mongodb` now lowers a `dateGranularity`-bearing `groupBy` into the
aggregation pipeline and advertises the capability, so `engine.aggregate` pushes
a bucketed aggregate down to MongoDB instead of fetching every matching row and
bucketing it in JS.

**Answers do not change — where the work happens does.** `MongoDBDriver.supports`
published no `queryDateGranularity`, so the engine already bucketed every
granularity in memory and the results were correct. What was missing was the
index/server-side half: a year-over-year rollup shipped the whole result set to
the client first. #7550 refused a bucketed node at the builder rather than
implement or silently drop it; this replaces that refusal with the lowering it
described.

**All five granularities `DateGranularity` declares are advertised** — `day`,
`week`, `month`, `quarter`, `year`. The bucket LABELS are the engine's own
spellings (`'2024'`, `'2024-Q1'`, `'2024-01'`, `'2024-01-15'`, ISO `'2025-W01'`),
because the engine picks between the pushed-down and in-memory paths per query
and a drill-down can cross that seam. `week: true` where `driver-sql` on SQLite
carries `week: false`: MongoDB's `$dateToString` has both halves of the ISO-8601
week date (`%G`/`%V`), SQLite has neither.

**All three ADR-0053 storage forms are served.** This driver stores `datetime` as
a BSON `Date` but `date` and `time` as timezone-naive TEXT, so the lowering reads
the instant through `$convert … onError/onNull: null` — total, exactly like the
in-memory `bucketDateValue`, which puts null, missing and unparseable values in
one empty bucket. A `Field.time` column is a wall clock and not an instant: both
paths agree it has no bucket, rather than one of them inventing a day.

**Timezones are unchanged and stay engine-side.** `engine.aggregate` forces the
in-memory path for any non-UTC reference zone (ADR-0053 Phase 2 D2) and the AST
it hands a driver carries no `timezone`, so this bucketing is UTC by
construction.

The #7550 refusal is kept for a granularity outside the advertised record —
`NOT_IMPLEMENTED` / 501 in the ADR-0112 envelope, now naming what *is* bucketed
here — and it reads the same constant the capability record publishes, so the
two cannot drift.

⚠️ **Bound, stated because a green suite reads as more than it is.** Parity with
the engine's labels is proven through a strict in-process pipeline evaluator, not
against a live mongod: this environment cannot fetch a mongod binary (#5517). The
`$convert` / `$dateToString` / `$concat` / `$switch` semantics the lowering stands
on are documentation-derived. The bound is written into the suite header, onto
the published capability, and beside the lowering.
