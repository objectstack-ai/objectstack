---
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
"@objectstack/spec": patch
---

feat(drivers): lower `count_distinct` on the SQL family (#6409)

`count_distinct` has been declared by `AggregationFunction` since the enum was
written, and until now no SQL backend compiled it: both faces of the SQL family
refused it with `NOT_IMPLEMENTED` / 501. A dashboard measure asking for a
deduplicated count against a SQL datasource got a capability-gap refusal for a
query that was already correct.

This is the ENFORCE half of #6188's split ruling (maintainer, 2026-08-07).
`array_agg` and `string_agg` took ADR-0049's remove leg and left the enum in
protocol 17 — no SQL backend compiled them and `string_agg` had no single shape
to lower to. `count_distinct` was deliberately kept on the other side of that
split, on the strength of having exactly one portable lowering. That lowering
now exists:

- **`driver-sql`** — `SqlDriver.aggregate` emits `count(distinct "column")`, on
  every dialect the driver targets.
- **`driver-turso`** — `RemoteTransport.aggregate` emits the same, on the remote
  path. Both faces in one change, deliberately: `TursoDriver` picks between them
  from `url`, so a lowering that landed on one alone would mean one query
  answering two ways depending on a connection string.

**Semantics: distinct NON-NULL values of the target column** — the standard
`COUNT(DISTINCT col)` answer, and the same one `objectql`'s in-memory fallback
and `service-analytics`'s SQL strategy already give.

**`field` is now required for `count_distinct`.** `AggregationNodeSchema` makes
`field` optional because `COUNT(*)` is a real spelling, but `COUNT(DISTINCT *)`
is a syntax error in every dialect. A `count_distinct` aggregation with no
`field` is refused up front with `INVALID_QUERY` / 400 and a message naming the
fix, rather than being sent to the database and coming back as an opaque 500.
Plain `count` with no `field` still means `COUNT(*)`, unchanged.

**The refusal message no longer names `count_distinct` as unsupported.** Both
faces build their "Compiled here:" list from their lowering table, so the
message now lists it among the functions that work. With this entry the declared
aggregate vocabulary and the SQL family's compiled vocabulary are the same set.

**New shared conformance table.** `AGGREGATION_CASES` / `AGGREGATION_ROWS`
(`@objectstack/spec/data`) is the standard both SQL faces are now run against —
values over one fixture carrying duplicates and nulls, so a lowering that lost
the dedup or counted NULL as a value fails on a number rather than passing a
SQL-string assertion. `driver-memory` and `driver-mongodb` are inside the #5499
freeze and are not enrolled; the table records what each would answer and why,
rather than omitting them.
