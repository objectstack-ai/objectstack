---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a `$between` analytics filter no longer vanishes from the query (ADR-0053 D-A3.1)

A dashboard widget or dataset whose filter used `$between` was querying **every
row**. `normalizeAnalyticsFilters` maps Mongo-style operators onto the internal
pipeline form, `$between` was missing from that map, and an unmapped operator is
skipped — so the predicate was silently dropped from the compiled WHERE clause.
Both strategies read that normalizer, so both the raw-SQL and the ObjectQL
aggregate paths were affected. The symptom is #3650's: a chart that draws the
whole dataset instead of the requested window, with nothing in the SQL to
suggest a filter was ever asked for.

`$between [min, max]` now lowers to its two bounds (`gte` + `lte`) instead of
gaining an operator of its own, so a range's max inherits the calendar-day
whole-day rule (#3777) from each strategy's existing upper-bound handling —
`NativeSQLStrategy` compiles a bare-day upper bound half-open itself, and the
ObjectQL path gets the same rule from the driver — rather than needing a second
implementation to keep in step. A malformed `$between` (not a two-element
array) now throws instead of being dropped, matching the stance driver-memory
took for the same shape in #3948: an unbounded read is exactly the failure this
prevents, and it is indistinguishable from a legitimately wide query.

Found by giving the temporal conformance matrix its missing sixth consumer
(`native-sql-temporal-conformance.test.ts`), which executes the shared cases
against a real SQLite engine and asserts row ids — a dropped predicate is
invisible to the SQL-string assertions the strategy's other suites use.
