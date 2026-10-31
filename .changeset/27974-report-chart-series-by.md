---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): a report chart can split its bars by a second dataset dimension with `chart.seriesBy`

Clause-②: yes (widening)
Metadata-protocol: added

`ReportChartSchema` declares one optional key, `seriesBy`: the name of a second dimension of the report's bound dataset. It splits the chart's one `yAxis` measure into a series per value of that dimension, so a report can draw a bar per owner split by stage. It is the report's spelling of a dashboard widget's two-entry `dimensions` selection. With `seriesBy` set, a `chart.series[]` entry's `name` names a value of that dimension, because each derived series is one value.

- **Lint.** `os validate`, `os build` and the report publish door resolve `chart.seriesBy` against the dataset's declared dimensions exactly as they resolve `chart.xAxis`: an undeclared name is a `chart-dimension-unknown` error with the nearest declared dimension suggested. When `seriesBy` is set, `chart.series[].name` is no longer judged against the chart's measure, since it names a dimension value.
- **Liveness.** The key is graded `planned` with an author warning: this is the contract half, and the report chart still draws one series until the renderer reads `seriesBy` in a later change.

Nothing to do for existing reports. A chart without `seriesBy` parses and draws exactly as before.
