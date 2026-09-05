---
'@objectstack/lint': minor
---

`widget-measures-missing` — the empty-measure selection is reported on every widget family, not just charts

`chart-measures-missing` (#15462) reported the authoring placeholder only for the chart
family, but the return that produces it is type-independent. At the `@object-ui` revision
this repo pins (`.objectui-sha` = `a472b0716`), `packages/plugin-dashboard/src/DatasetWidget.tsx:683`
reads `if (values.length === 0)` and returns *"Pick measures (values) for this dataset
widget."* ABOVE `isMetric` (`:423`, over `METRIC_TYPES` at `:343`), `isTable` (`:424`) and
the chart branch alike. So a `metric`, `kpi`, `gauge`, `solid-gauge`, `bullet`, `table` or
`pivot` widget that selects no measures renders the same placeholder — the KPI number or
the table the author declared is not drawn at all — and nothing reported it:
`table-count-only` requires `values.length > 0` before it looks, and the rules that iterate
`dimensions[]`/`values[]` are silent on an empty array by construction.

- **New id `widget-measures-missing`** — a NON-chart declared widget type selects no
  measures. Warning tier, suppressible per widget with
  `suppressWarnings: ['widget-measures-missing']`, exactly as the chart-family id is. The
  message states the consequence its family actually has (the single KPI number is not
  drawn / no table is rendered) and the hint names the dataset's declared measures.
- **`chart-measures-missing` is unchanged** — same id, same chart-family population, same
  message and same suppression. The condition split rather than widened because "chart"
  stops naming it once the population is every family, while the old id is reachable from
  the package barrel (a public-surface contract) and may already be written into a board's
  `suppressWarnings`.
- `chart-dimensions-missing` stays chart-family only: a dimensionless `metric` or `table`
  is what those families are for.

The two never double-report one widget, in the pin's own order: the measures check runs
before the dimensions one, and `table-count-only` already skips an empty selection.
