---
'@objectstack/spec': minor
---

feat(spec): a dataset answer declares its four drill-through sidecars (#20700)

Clause-②: yes (widening)

`AnalyticsResult` (`@objectstack/spec/contracts`) gains four optional members, and
`AnalyticsResultResponseSchema` (`@objectstack/spec/api`) mirrors them on `data`:
`dimensionFields` (drillable dimension name to its field), `drillRawRows` (each
row's stored grouped values, aligned to `rows`), `drillRawTotals` (the same for
`totals`) and `drillRanges` (each row's date-bucket range, `[gte, lt)`). Nothing is
removed or renamed, and no existing member changes meaning.

`@objectstack/service-analytics` already sets them on a drillable `queryDataset`
answer. Code typed against `AnalyticsResult` can now read them without a cast, and
a parse with `AnalyticsResultResponseSchema` keeps them where it used to strip them.
