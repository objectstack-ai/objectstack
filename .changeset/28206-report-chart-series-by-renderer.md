---
'@object-ui/plugin-report': patch
'@objectstack/spec': patch
'@objectstack/lint': patch
---

feat(plugin-report): a report chart draws its `seriesBy` split

Clause-②: no
Metadata-protocol: none

A report chart that sets `chart.seriesBy` now draws the split it declares: one bar per `xAxis` value, split into one series per value of the `seriesBy` dimension (a bar per owner, split by stage). The chart's own dataset query asks for `[xAxis, seriesBy]` × `[yAxis]` and the rows are pivoted the way a dashboard widget with two dimensions pivots them, null group included. The series follow the split dimension's declared option order, and a `chart.series[]` entry whose `name` is a split value lands its colour and label on that series. Before this, the key was accepted and checked at publish, but the chart still drew a single series.

- **Liveness.** The `chart.seriesBy` row of the report ledger is graded `live` with the renderer as its evidence, so `os validate` no longer prints the "nothing draws it yet" author warning for it.
- **Lint.** `os explain chart-axis-not-selected` now says the report chart queries its `xAxis` dimension and, when set, its `seriesBy` split. No rule, severity or finding changes.

Nothing to do for existing reports. A chart without `seriesBy` queries and draws exactly as before.
