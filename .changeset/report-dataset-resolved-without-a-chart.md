---
"@objectstack/lint": patch
---

A report's `dataset`, `rows`, `columns` and `values` are checked whether or not the report draws a chart (#16105)

**Behaviour change — new findings on reports that used to publish clean.** `validateChartBindings` reached a report through one closure that opened `if (!isRec(chart)) return`, and that closure was the only place a report's `dataset` was ever passed to the resolver. Two gaps followed, and both are closed:

- **A report authored without a `chart` was not checked at all.** Bind it to a dataset that does not exist and `os lint` exited 0 and named nothing. It now reports `chart-dataset-unknown` at `error`, the same as a charted report always did.
- **`rows` and `columns` were resolved on no report, charted or not.** On one and the same report object the measure selection (`values`) was resolved against the dataset and the dimension selection beside it was not. Both now report `chart-dimension-unknown` at `error` for a name the bound dataset does not declare as a dimension, at `reports[i].rows[j]` / `reports[i].columns[j]`. A chartless report's `values` is resolved for the first time too, under the existing `chart-measure-unknown`.

`ReportSchema` is what makes these bindings rather than free text: it requires `dataset` + `values` on every non-`joined` report, and declares `rows` (the down axis) and `columns` (the across axis a `matrix` pivots on, ADR-0021 D2) as dimension names taken from that dataset. The chart is optional decoration on top of a binding the report already has. So a report bound to a missing dataset, or grouping on a dimension its dataset does not declare, now fails authoring instead of rendering blank or mis-grouped in production.

No new rule id, no severity moved, and the charted path is unchanged — `chart-axis-not-selected` stays a `warning` and still resolves against the chart's own `chart.yAxis`. Two smaller corrections come with the restructure, both on messages an author reads:

- The dataset finding on a report now points at `reports[i].dataset`, the key the author wrote. It used to say `reports[i].chart.dataset`, a position a report does not have.
- Its sentence ends "there is no data to render" rather than "the chart has no data to render", which is not true of a report that draws no chart.

Blocks of a `joined` report carry the same keys and take the same checks. An unresolvable dataset is still exactly one finding per report or block.
