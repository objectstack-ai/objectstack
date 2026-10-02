---
'@objectstack/spec': minor
---

feat(spec)!: a `pie` / `donut` / `funnel` / `treemap` / `sankey` dashboard widget takes ONE measure with a dimension too — two or more are refused at `values`, and the check export is renamed `checkDashboardWidgetChartMeasureArity` (#21293; extends #20958)

Clause-②: yes (narrowing) — the accept set NARROWS (that is the change), and the published surface swaps one export for another: `checkDashboardWidgetDimensionlessMeasureArity` is removed and `checkDashboardWidgetChartMeasureArity` is added in its place, the same check with a second arm.

<!-- adr-0087: registered dashboard-widget-single-series-multi-measure-refused -->

**BREAKING** accept-set narrowing at `dashboard.widgets[].values`, plus one renamed
export, shipped as `minor` under this repo's launch-window convention for breaking
changes (`check-changeset-no-major` refuses `major` while the window is open, so
breaking-ness is carried by this banner and by the ADR-0087 disposition above,
never by the bump level). The prescription is registered under protocol major 18
as `dashboard-widget-single-series-multi-measure-refused`.

**What was wrong.** The previous release refused two or more measures on a
dimensionless `pie` / `donut` / `funnel` / `scatter` / `radar` / `treemap` /
`sankey`, and stepped aside for any widget that declared a dimension. Five of those
types draw ONE series whatever the dimension: objectui's chart renderer binds the
first series on its `pie` / `donut`, `funnel`, `treemap` and `sankey` arms and reads
no other, so `{ type: 'pie', dimensions: ['stage'], values: ['revenue', 'cost'] }`
drew one slice per stage for `revenue` and no trace of `cost`. Measured on this tree
before the change: that body parsed through `DashboardWidgetSchema` on all five
types (and on `scatter` / `radar` / `bar` / `table`), while `bogusProp` on the same
widget was refused by name, the lit control. After it, the five are refused at
`widgets[N].values`; `scatter` and `radar` with a dimension are outside the ruling
and parse as before.

### Write instead

| wrote | write instead |
|---|---|
| `{ id: 'mix', type: 'pie', dataset: 'sales', dimensions: ['stage'], values: ['revenue', 'cost'] }` | `{ id: 'mix', type: 'table', dataset: 'sales', dimensions: ['stage'], values: ['revenue', 'cost'] }` — a column per measure |
| the same, wanting a chart | `type: 'bar'` (or `column` / `horizontal-bar`) — one bar per measure in each stage |
| the same, wanting the pie | `{ id: 'mix', type: 'pie', …, values: ['revenue'] }` **and** `{ id: 'mix_cost', type: 'pie', …, values: ['cost'] }` — one widget per measure, each with its own `id` (and `layout`, if you pin positions) |
| `import { checkDashboardWidgetDimensionlessMeasureArity } from '@objectstack/spec/ui'` | `import { checkDashboardWidgetChartMeasureArity } from '@objectstack/spec/ui'` — same `(widget, ctx)` signature; chain it where the old name was chained |

No conversion does this for you: whether a two-measure pie by stage meant a table, a
grouped bar chart or two pies is an authoring choice. The refusal is ONE `custom`
issue at `widgets[N].values` naming the widget's `id`, the number of measures and
the authored `type`, and saying that type draws one series whatever its
`dimensions`.

**Why the export is renamed.** The dimensionless rule's check now has a second arm
that judges widgets WITH a dimension, so its old name described a boundary that no
longer exists. It refuses everything the old name refused, word for word on a
dimensionless widget. No first-party consumer chained the old name: objectui's
`DashboardWidgetSchema` mirror chains `checkDashboardWidgetStageOrder` and
`checkDashboardWidgetMetricMeasureArity` only, measured at the pinned objectui
commit and on objectui's `main`.

**Nothing else moves.** One measure parses on every type; `scatter` and `radar`
keep accepting several measures with a dimension; every type in
`DASHBOARD_WIDGET_MULTI_MEASURE_TYPES` keeps accepting any number of measures with
or without a dimension; a dimensionless widget of the five keeps the dimensionless
refusal, word for word and still ONE issue; the metric family's refusal is
unchanged; an empty `values` keeps its `too_small`; a `type` outside
`ChartTypeSchema` reports the type refusal alone. Census at the branch point
(`4b20c8474`), every tracked `.ts` / `.tsx` / `.js` / `.mjs` / `.cjs` / `.json` /
`.md` / `.mdx` / `.yml`: 496 literals carry `values: [...]`, 33 of them on one of
the seven types, and the only dimensioned multi-measure one on the five is a spec
test fixture that pinned the old acceptance (moved to the refusal in this change).
The same scan over objectui at its pinned commit (`89cad75d5`) finds no authored
widget of that shape — its one hit is the prose example in a changeset.
