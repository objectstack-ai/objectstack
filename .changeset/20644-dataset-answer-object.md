---
'@objectstack/service-analytics': patch
---

fix(service-analytics): every dataset answer names its base object as `object` (#20644)

Clause-②: no

**What was wrong.** `queryDataset` set `object`, the dataset's base object, only
while it built drill-through metadata, which it builds only when a drillable
dimension is selected and at least one row came back. A dimension-less (KPI)
answer, a zero-row answer and the degraded answer for an unavailable backing
object carried no `object`, and neither did a draft preview (`previewDrafts`),
grouped or not. `POST /api/v1/analytics/dataset/query` relays the service answer
as it is, so a consumer that refreshes on that object's record changes had
nothing to subscribe to for those answers.

**What changed.** Every `queryDataset` answer carries `object`, the dataset's
`object` by machine name, whatever dimensions are selected and whether or not
rows came back, as `AnalyticsResult.object` in `@objectstack/spec` declares. A
grouped answer is unchanged: `object` sits beside the same drill-through keys
as before. A cube `query` answer still carries no `object`.
