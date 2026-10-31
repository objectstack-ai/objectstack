---
'@objectstack/spec': minor
---

feat(spec)!: a report chart's `seriesBy` that cannot split is refused at authoring time — on a single-series chart type, or naming the same dimension as `xAxis`

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: two combinations of existing values that no renderer could draw are now refused. A conversion cannot know whether the author meant a bar chart or one series, so there is nothing for a migration to rewrite; the refusal text names both fixes. -->

**BREAKING** for two report chart shapes, both of which parsed before and then failed on the page. `ReportSchema` (non-`joined` reports; a joined report's `chart` is refused whole, as before) now refuses, at `chart.seriesBy`:

- **`seriesBy` on a single-series type** — `pie`, `donut`, `funnel`, `treemap` or `sankey`. The split derives one series per value of the `seriesBy` dimension and these types draw one series, so the page showed a refusal panel instead of the chart. The refusal names the report, the type and the split. Fix: a bar-family type (`bar` / `column` / `horizontal-bar`) for one bar per split value in each `xAxis` category, or drop `seriesBy` to keep the single-series chart. This is the report spelling of the rule dashboards already apply to a dimensioned widget with several measures on the same types.
- **`seriesBy` naming the same dimension as `xAxis`** — every series held exactly one point. Fix: name a different dimension than `xAxis`, or drop `seriesBy`.

`SINGLE_SERIES_CHART_TYPES` is now exported from `@objectstack/spec/ui` (the list `checkDashboardWidgetChartMeasureArity` reads); the report refusal reads the same constant, so the two doors cannot drift apart.
