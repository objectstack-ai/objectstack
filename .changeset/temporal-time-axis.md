---
"@objectstack/spec": minor
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
---

feat(spec,drivers): the temporal conformance matrix gains its `Field.time` axis — and `time` finally gets a storage form off SQL (ADR-0053 D-A3.2)

`@objectstack/spec/data` gains `TEMPORAL_TIME_ROWS` / `TEMPORAL_TIME_CASES`,
the wall-clock half of the shared matrix. A time gets its own table rather than
a third `kind` on the existing one because it shares no comparand vocabulary
with the other two: no relative token resolves to a wall clock, and the
bare-day whole-day rule (#3777) must **not** reach it — which the table now
asserts rather than assumes, since "the rule leaked into the wrong field type"
is exactly what a conformance matrix is for. The fixture is a business day
carrying the boundaries #3994 measured: both window edges, the pair straddling
the millisecond-suffix width change, midnight and `23:59:59.999`.

**The axis found a real gap on its first run.** ADR-0053 D-C gave `Field.time`
a canonical form on every SQL dialect, but `driver-memory` and
`driver-mongodb` were never extended — both declared
`TemporalFieldKind = 'datetime' | 'date'`, so a `time` column was never
classified and never coerced. It therefore held whatever each writer produced,
and both stores compare across types by bracket: a text bound matched no
`Date`-written row, in either direction, for every operator. Measured on
`driver-memory`, **8 of the 9 shared cases** returned only the text-written
half — a business-hours window answering `[d_mid, f_close]` instead of
`[c_open, d_mid, e_mid_ms, f_close]`. This is #4047's failure one field type
over, and it survived #4047 because that work extended `datetime` and `date`
without revisiting `time`. On mongo it was also a documentation failure: that
module's canon table has listed `time` as `HH:MM:SS[.fff]` text since #3994,
and nothing implemented it.

Both drivers now carry `storageTimeValue`, mirroring the SQL
`canonicalTimeOfDay`: `HH:MM:SS`, `.fff` only when the milliseconds are
non-zero, a `Date` / epoch / full-timestamp folding to its **UTC** time-of-day
(never the host's), and totality — an out-of-range wall clock like `'25:00'`
passes through rather than being silently rewritten. Text on both, mongo
included: a wall clock is not an instant, so a BSON `Date` would invent a
calendar day and a zone the author never wrote.

If you have existing `time` data on either driver, values written as `Date`
objects converge to canonical text on their next write; reads of un-migrated
documents are unchanged. Filters were already unable to reach the mixed half,
so no query that worked before stops working.
