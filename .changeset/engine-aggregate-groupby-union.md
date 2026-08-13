---
"@objectstack/spec": minor
---

`EngineAggregateOptionsSchema.groupBy` now declares the standard `GroupByNodeSchema` union — a bare field name, or a `{ field, dateGranularity?, alias? }` bucket object for date bucketing — the same vocabulary `QuerySchema.groupBy` has always declared (#8032). The engine, driver-mongodb and the in-memory aggregation path have always executed the structured form; the engine-options declaration was the one face still saying `string[]`, so every correct caller had to cast around it. This widens the declared accept-set only: plain-string `groupBy` payloads validate byte-identically and no runtime behavior changes.
