---
"@objectstack/service-analytics": patch
---

Analytics measures are now compiled from everything they declare — `aggregate`, `field` **and** `filter` — on both the dashboard path and `POST /api/v1/analytics/query`.

**Reported figures change, and the new ones are the declared ones.** Two corrections, both of which move numbers a dashboard or an API consumer is already reading:

- A measure written `{ aggregate: 'count', field: 'some_column' }` used to compile to `COUNT(*)` and count **rows**. It now compiles to `COUNT("some_column")` and counts **non-null values**. Any such measure will report the same number as before or a **smaller** one, and a rate built on top of it (a numerator over a total) will drop accordingly — a "100%" tile whose column was mostly empty was reading its own denominator.
- `POST /api/v1/analytics/query` used to drop every per-measure `filter`, and the dataset's definition-level `filter` with it, returning unfiltered aggregates under the author's measure names. It now applies both, so the endpoint answers what the dashboard already answered for the same cube. Figures pulled through the API — agent tools, exports, downstream reports — will move to the filtered values; a measure declaring `filter: { stage: 'closed_won' }` stops counting every row.

Measures that declare no `field` still compile to `COUNT(*)`, and a cube that is not a compiled dataset (an inferred or manifest cube) emits byte-for-byte the statement it did before. Measure filters lower to portable `CASE WHEN` conditional aggregates rather than `FILTER (WHERE …)`, which MySQL does not have.

If a saved figure or a screenshot disagrees with what the platform now reports, the new number is the one the metadata declares.
