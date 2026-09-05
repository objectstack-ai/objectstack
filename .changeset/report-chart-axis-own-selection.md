---
"@objectstack/lint": patch
---

`chart-axis-not-selected` resolves a report chart against its own `chart.yAxis`, not `report.values` (#15734)

**Behaviour change — one false finding removed on the report surface.** A report chart whose `chart.yAxis` names a declared measure that `report.values` does not select no longer raises a `chart-axis-not-selected` warning. Nothing else about the rule moves, and no other surface moves at all.

The warning stated a query consequence the renderer refutes. Read at the `@object-ui` revision this repo pins (`.objectui-sha`), `plugin-report/src/DatasetReportRenderer.tsx` does not query `report.values` for the chart at all — it runs the chart's own, narrower query out of the two axis strings:

```
const state = useDatasetRows(
  dataset,
  plan.kind === 'series' && xAxis ? [xAxis] : [],
  wantsQuery && yAxis ? [yAxis] : [],
```

and says so in that file's own words at the `scopeOrder` docblock: *"the embedded chart queries only `chart.xAxis` × `chart.yAxis`"*. So the measure the warning said "the query does not return" is exactly the one the query asks for, and the chart plots it. `report.values` is the selection of the TABLE beneath the chart.

Both limbs follow from that one measurement:

- **No not-selected check at the report `chart.yAxis`.** That position IS the chart's query, so it cannot fail to select itself. `chart-measure-unknown` there is untouched: an UNDECLARED measure is still no column at all, and still an `error`.
- **`chart.series[].name` resolves against the singleton `{ chart.yAxis }`.** The entry is a display-name override paired with a DERIVED series, and the chart derives exactly one (`buildChartSeries(…, [xAxis], [yAxis], …)`). An entry naming `chart.yAxis` now lands however the table is selected, and one naming any other declared measure is still reported — including a measure `report.values` does select, which it could not reach before.

The list-view and page-component surfaces are unchanged, and carry firing controls that say so: on both, `values` IS the measure set the query asks for (`ObjectView` hands it to the chart; `ObjectChart` queries `{ dimensions: schema.dimensions, measures: schema.values }`), so the existing resolution is the right one there.

The per-position tier and consequence wording is untouched — only the SET the report surface resolves against moves.
