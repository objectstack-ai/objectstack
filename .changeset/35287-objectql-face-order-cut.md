---
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

fix(objectql,service-analytics): `query_dataset`'s ObjectQL face orders and cuts a top-N in the database instead of reading every group

Clause-②: yes
Metadata-protocol: none

A top-N (`order` with a `limit`, optionally an `offset`) on the analytics ObjectQL face — date-bucketed queries, `$field` filters, drivers without raw SQL — used to read every group and cut in memory. On a driver that compiles the engine's order-and-cut (the SQL driver family: `driver-sql`, the WASM SQLite driver, Turso's local and replica faces) the face now hands the engine its order and `offset + limit`, the database orders, cuts and counts in one statement, and only the cut rows are read. `totalGroups` stays the count of every group, taken from that statement.

Visible change: a text-ordered top-N on such a driver now returns the database's choice of groups — its collation, NULL last in both directions — the same as the native SQL face and `aggregate_records`, instead of the in-memory comparator's (`localeCompare`, `''` read as empty).

Where the engine cannot serve the cut — the in-memory driver, MongoDB, OData, Turso's remote face, a date bucket or reference timezone the driver does not compile, a measure filter it does not evaluate — the face reads every group and cuts in memory as before, and no refusal reaches the caller. A select or lookup dimension ordered by its display label is still cut in memory, by label.

`@objectstack/objectql`: an `AGGREGATE_ORDER_CUT` request may set `declinable: true`; where the cut cannot be served the engine then reads nothing, answers `[]`, leaves `outcome` unset and records the reason on the request's new `declined` slot (`AggregateOrderCutDecline`) instead of refusing `INVALID_QUERY` / 400. Without the flag nothing changes: `aggregate_records` keeps its refusal, and `AggregateOrderCutOutcome` is unchanged.
