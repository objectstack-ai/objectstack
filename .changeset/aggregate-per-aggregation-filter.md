---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-memory": patch
---

`engine.aggregate` honours a per-aggregation `filter` (#10576, the contract
half of #10413). `AggregationNodeSchema.filter` — declared since #4286 but
marked experimental and enforced by nothing — is now live with SQL
`FILTER (WHERE …)` semantics: the predicate narrows the SOURCE rows that one
aggregation reads while sibling aggregations in the same call keep seeing
every row of the group, so a measure-scoped filter (`stage: 'closed_won'`)
can finally reach the engine instead of being silently dropped (the #10413
wrong-numbers defect on the ObjectQL analytics path). The
`StrategyContext.executeAggregate` bridge (`@objectstack/spec/contracts`)
gains the same optional `filter` on its aggregation entries so analytics
strategies can lower measure filters into it (#10413 phase 2 consumes this
seam next).

Execution is the correct-first two-tier shape date bucketing and HAVING use:
the engine lowers filtered aggregations in memory for every driver (unknown
operators refuse loudly with `INVALID_FILTER`/400 naming the aggregation
position; a group emptied by its filter answers the ruled empty-group values
— count/sum 0, avg/min/max null). No driver compiles conditional aggregation
natively today, so each native aggregate face (driver-sql — inherited by
driver-sqlite-wasm and Turso local —, the Turso remote transport,
driver-mongodb's pipeline builder, driver-memory's `performAggregation`)
refuses a directly-delivered per-aggregation filter with
`NOT_IMPLEMENTED`/501 instead of silently aggregating the unfiltered rows.
Aggregations without a `filter` are byte-identically unchanged, including
their native pushdown path.
