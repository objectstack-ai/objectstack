---
"@objectstack/service-analytics": minor
---

feat(analytics): serve in-envelope cross-object grouping on the ObjectQL path by FK-expand (#3654)

`engine.aggregate()` cannot join, so the ObjectQL fallback path (date-granularity
bucketing, in-memory driver, federated objects) previously REJECTED any
cross-object grouping like `revenue by account.region` (#3664 stopgap — a loud
error instead of the earlier silent `(null)` mis-bucket). It now SERVES the
common case directly.

For a single-hop cross-object DIMENSION with recombinable measures, the strategy:
1. groups the base aggregate on the lookup FK column (`account`) — which the
   engine can do — scoped to the base object;
2. resolves each FK id to the related attribute (`region`) with a read of the
   referenced object **scoped to that object's own RLS**; then
3. re-buckets by the resolved attribute in memory, recombining the measures
   (sum/count add; min/max take the extremum).

A base row whose referenced record the caller cannot read buckets under an
explicit `(restricted)` group: its measure still counts (grand totals are
preserved) but the hidden record's attribute never appears — no leak (ADR-0021
D-C, the #3602 class). `/analytics/sql` renders the equivalent `LEFT JOIN`.

Deliberately bounded — still REJECTED (loud, never silently wrong): cross-object
references in a MEASURE or FILTER (need a real join to evaluate), multi-hop
dimensions (`a.b.c`), and non-recombinable measures (`avg`, `count_distinct`)
with a cross-object dimension. Cross-object queries on `NativeSQLStrategy` (the
normal SQL path) are unchanged — it hand-compiles the joins.
