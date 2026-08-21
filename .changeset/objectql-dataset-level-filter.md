---
"@objectstack/service-analytics": patch
---

Apply a dataset's definition-level `filter` on the ObjectQL analytics path
(#10413, phase 1). `/api/v1/analytics/query` served by a driver that reports
`objectqlAggregate` but not `nativeSql` (MongoDB, the memory driver) reached
`engine.aggregate` with no `filter` key at all: the dataset's own scope — a
`filter: { is_deleted: false }` on the dataset definition — was dropped, so
every measure aggregated the whole table while the dashboard door, on the same
cube and the same measure names, answered the scoped numbers. The scope is now
ANDed into the strategy's whole-call filter (never merged key-by-key, so a
caller's own `where` and the time windows cannot be overwritten by it), and the
representative SQL echo renders it too.

Per-MEASURE `filter`s on this path are still not applied: an
`engine.aggregate` aggregation is `{ field, method, alias }` and cannot carry a
predicate of its own. Widening that contract is #10576; lowering the measure
filters into it is phase 2 of #10413. The native-SQL path already applies both
(#10298).
