---
"@objectstack/objectql": patch
---

fix(objectql): `engine.aggregate`'s in-memory lowering asks the driver for ROWS, so a per-aggregation `filter` stops being refused by the driver it was lowered for (#16642)

`engine.aggregate` forks: a driver with a native `aggregate()` gets the pushdown, and anything the pushdown cannot express — a per-aggregation `filter` (#10576), a date granularity the driver does not advertise, a non-UTC reference timezone — falls back to `driver.find()` plus `applyInMemoryAggregation`. That fallback handed `find()` the whole aggregate AST, **aggregation keys included**.

`find()`'s contract says nothing about `groupBy` / `aggregations`, and the drivers disagree about them. `driver-sql` and `driver-rest` ignore both and return rows — which is the only reason this path ever worked. `driver-memory` **honours** them (`find()` → `performAggregation`, the same method its `aggregate(AST)` door funnels through), which is the shape measured here; `driver-mongodb` and `driver-turso` carry the same refusal on their own aggregation faces, so a driver that ever routes `find()` into one lands in the same place. Against a driver of the second kind the one seam answered two different wrong things:

- the per-aggregation `filter` that **routed the call here** was refused `NOT_IMPLEMENTED`/501 by the driver's own #10413 guard — a guard aimed at a caller reaching the driver's aggregation face directly, whose remedy text is *"route the query through the engine"*. The engine's own lowering was being told to use the engine. Downstream, `service-analytics`'s ObjectQL strategy lowers a dataset measure `filter` into exactly this key, so on the memory driver a measure `filter` (and the `derived: { op: 'ratio' }` that needs two differently-filtered counts) answered **501** while sqlite answered the number;
- a date-bucketed `groupBy` came back **already grouped**, on the raw timestamp — `dateGranularity` is an engine concept no driver face reads — and `applyInMemoryAggregation` then aggregated those group rows a second time. That half does not refuse: it reports a count of *buckets* under the author's own measure name.

The fix is one seam: on the in-memory path the AST sent to `find()` carries no `groupBy`, no `aggregations` and no `having` — the three things this path is about to evaluate itself. `where` is untouched, so the middleware-injected read scope (RLS / tenancy) still travels with the call.

`patch`: no signature moves and no key is added or retired. The pushdown fork is unchanged (an aggregation with no filter still goes to `drv.aggregate`), and on `driver-sql` — which ignored the stripped keys — the emitted statement and every number are unchanged. What changes is that two shapes that used to answer a refusal or a wrong number now answer the number the contract already promised: `driver-memory`'s `refusePerAggregationFilter` and `driver-sql`'s `unsupportedAggregationFilterError` both document themselves as *unreachable through `engine.aggregate`, which lowers in memory for every driver* — this is the line that makes that true.
