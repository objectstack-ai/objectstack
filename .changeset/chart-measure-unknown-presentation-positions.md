---
"@objectstack/lint": patch
---

`chart-measure-unknown` no longer blocks a build over a chart `series[].name` (or a page chart's `yAxis[].field`) that names nothing — those positions are presentation, and the message now says so.

The rule fired at `error` on every measure position of the three chart surfaces it covers, with one consequence sentence: *"result rows are keyed by MEASURE NAME … so this series comes back empty"*. Read at the `@object-ui` revision this repo pins (`.objectui-sha`), that is true only where the position feeds the dataset query, and the three surfaces do not agree:

- **Report charts** run the chart's own query out of the two axis strings (`useDatasetRows(dataset, [xAxis], [yAxis], …)` — *"the embedded chart queries only `chart.xAxis` × `chart.yAxis`"*), so `chart.xAxis`/`chart.yAxis` are the binding. `chart.series[]` is *"the author's per-chart override for ONE measure's display name"*, lowered through `mergeAuthoredSeries`, where *"an authored entry naming a measure that is NOT in the dataset selection is **ignored** — membership belongs to the dataset"*.
- **List-view charts** have no presentation position at all: `ListChartConfigSchema` is a strict object of `chartType`/`dataset`/`dimensions`/`values`, and `values[]` is handed to the chart as the dataset measures.
- **Dataset-bound page chart components** query `{ dimensions, measures: values }` and then replace the authored series wholesale with one derived entry per selected measure, so `properties.series[].name` reaches the renderer not at all and `properties.yAxis[].field` re-points nothing.

**Behaviour change users see:** the three presentation positions — report `chart.series[].name`, page-component `properties.series[].name` and `properties.yAxis[].field` — drop from `error` to `warning`. A build or a metadata publish that used to be refused because of one of them now succeeds, with the finding on the advisory channel. The finding is KEPT, not deleted: the metadata really is wrong — the author wrote a key and believes it is in force. Every query position (report `chart.yAxis`, and `values[]` on all three surfaces) keeps `error` and its existing message verbatim.

Two smaller corrections ride along, both from the same read:

- The page surface's `yAxis[].field` refs are no longer concatenated into the `series[]` limb before the measure walk, so an axis position no longer takes the series message. Reading both shapes on that surface stays deliberate; giving them one sentence was not.
- `chart-axis-not-selected` (a declared measure outside the selection) took the same one-size consequence, *"the query does not return it, so the series plots nothing"*. It keeps that wording at a query position and states the real one at a presentation position, where no series is derived for the name in the first place.

Note that none of these three surfaces declares `suppressWarnings` — it is a dashboard-widget key — so the new advisories cannot be individually silenced; the hint says so instead of pointing at a key that does not exist.
