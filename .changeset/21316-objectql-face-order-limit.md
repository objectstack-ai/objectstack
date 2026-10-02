---
"@objectstack/service-analytics": patch
---

fix(service-analytics): the ObjectQL strategy applies a query's `order`, then its `offset` and `limit`, to the aggregated answer, as its echoed `sql` says

Clause-②: no

**Before**, the ObjectQL strategy passed none of the three keys to `engine.aggregate`, which has no ordering or window grammar, and applied none of them itself. Every date-bucketed query lands on that strategy, because the native-SQL strategy declines `granularity`. Measured through `POST /api/v1/analytics/query` on SQLite and PostgreSQL 16.14:

- `timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }]`, `order: { closed_on: 'desc' }`, `limit: 1` answered every month, unordered (ascending on SQLite, `04, 03, 05` on PostgreSQL).
- A selected dimension with `order: { note: 'desc' }`, and a selected measure with `limit: 2, offset: 1`, answered every group in the engine's order.

The echoed `sql` and `POST /api/v1/analytics/sql` rendered `ORDER BY … LIMIT … OFFSET …` for all three.

**Now** the strategy orders the answer by `order`, in the key order given, and then applies `offset` and `limit`. This happens on the direct path and on the cross-object (FK-expand) path, after the re-bucket. A bare `limit` with no `order` slices the engine's order, as `LIMIT` without `ORDER BY` does. Where the native-SQL strategy answers the same query, the two answer the same rows for numbers and for text of single-case ASCII letters. The comparison is the dataset door's own `applyOrdering`, which sorts NULL and `''` last in both directions, while SQL places NULL by driver (lowest on SQLite, highest on PostgreSQL), so the two faces can still order NULL, `''`, numeric text and mixed-case text differently.

**Dataset door.** `POST /api/v1/analytics/dataset/query` pushes a single query's `order`, `limit` and `offset` down to the strategy, and then windowed the answer a second time, so `offset` was applied twice. `limit: 2, offset: 1` over five groups answered one row, the third, on the native-SQL strategy. It now windows only a grid it could not push down. The ObjectQL strategy answered that page correctly before, because it dropped the window; it still does.

**Unchanged.** A query with no `order`, `limit` or `offset` answers exactly the engine's aggregate rows. Which `order` keys are accepted is unchanged: the analytics door still refuses a key the query does not select. The dataset door's own ordering is unchanged too: label sort keys, derived measures, the implicit dimension order for a bare `limit`, and the chronological default.
