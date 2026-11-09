---
'@objectstack/spec': patch
'@objectstack/service-analytics': patch
'@object-ui/data-objectstack': patch
---

feat(spec,service-analytics,data-objectstack): a dataset answer says, per measure, which records that measure counted (`drillScopes`)

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/spec`: `AnalyticsResult.drillScopes?: Record<string, FilterCondition>`**, also declared on the `AnalyticsResultResponse` wire schema. Each selected measure name maps to the list filter, on the answer's `object`, that selects the records the measure aggregates: the dataset's own `filter`, AND the measure's own `filter`, AND, for a measure over a field, that field holding a value (both instants for a duration measure), with each `{token}` resolved as the query resolved it. It is `{}` when none of these applies. A measure that no list filter can select is left out: a derived measure, or a scope that names a relationship path (`account.region`, as a key or a `$field` reference). A measure left out offers no drill. A `__compare` column has no entry.
- **`@objectstack/service-analytics`: `queryDataset` sets `drillScopes` on every dataset answer that has rows**, on both query faces, from the same token-resolved filters the numbers were computed under. A drill that lists the clicked bucket (`dimensionFields` / `drillRawRows` / `drillRawTotals`, `drillRanges`) AND the widget's own filter AND this scope lists exactly the records the number counted. Before this, a drill built from the bucket and the widget filter alone listed every record in the bucket, so a filtered measure such as "paid invoices" showed 4 records behind the number 2.
- **`@object-ui/data-objectstack`: `queryDataset` passes `drillScopes` through**, typed as the spec slot. The adapter lists the keys it returns, so until now the sidecar was dropped before it reached a widget.
