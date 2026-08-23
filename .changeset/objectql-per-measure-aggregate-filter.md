---
"@objectstack/service-analytics": patch
---

**Fix:** `/api/v1/analytics/query` on the ObjectQL door (MongoDB, the memory driver, or any deployment whose driver reports `objectqlAggregate` but not `nativeSql`) now honours a measure's own scoped `filter` — `won_count` and `won_amount`-style conditional measures answer the same numbers the dashboard door and the native-SQL door already did (#10413 phase 2).

`ObjectQLStrategy.execute` lowers each measure's `filter` into the ONE aggregation it belongs to, via the per-aggregation `filter` field #10576 added to `engine.aggregate`'s contract (SQL `FILTER (WHERE …)` semantics) — not into the whole-call filter, which would have narrowed every measure (a fix shaped that way would make a conditional measure right while making every unconditional sibling measure in the same query wrong). An aggregation with no measure filter is unchanged and keeps the native-pushdown-eligible shape.

`ObjectQLStrategy.generateSql` (the `/analytics/sql` echo) renders the same conditional aggregate — `COUNT(CASE WHEN … THEN … END)`-style — so the preview stays an honest description of what `execute()` now actually runs, matching the native-SQL strategy's existing echo for the same class of measure.

Phase 1 (PR #10758) already ANDed a dataset's definition-level `filter` into the whole-call filter on this door; this closes the remaining half of the two-door disagreement #10413 reported. `NativeSQLStrategy` (#10298 / PR #10411) is unaffected by this change.
