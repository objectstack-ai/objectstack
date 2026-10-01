---
"@objectstack/spec": minor
---

feat(spec)!: a dashboard widget with no dimension declares two or more measures only on a type that renders them — `pie` / `donut` / `funnel` / `scatter` / `radar` / `treemap` / `sankey` are refused at `values` (#20958; objectui#8894 ruling D's principle)

Clause-②: yes (narrowing) — the accept set NARROWS (that is the change), and the published surface GAINS two exports: the one constant the rule reads, `DASHBOARD_WIDGET_MULTI_MEASURE_TYPES`, and the check itself, `checkDashboardWidgetDimensionlessMeasureArity`, exported so objectui's `.shape` mirror can chain it.

<!-- adr-0087: registered dashboard-widget-dimensionless-multi-measure-refused -->

**BREAKING** accept-set narrowing at `dashboard.widgets[].values`, shipped as
`minor` under this repo's launch-window convention for breaking changes
(`check-changeset-no-major` refuses `major` while the window is open, so
breaking-ness is carried by this banner and by the ADR-0087 disposition above,
never by the bump level). The prescription is registered under protocol major 18
as `dashboard-widget-dimensionless-multi-measure-refused`.

**What was wrong.** Outside the metric family, `DashboardWidgetSchema.values`
(`z.array(z.string()).min(1)`) had no upper bound. Measured on this tree before
the change: `{ type: 'pie', dataset: 'sales', values: ['a', 'b'] }` with no
`dimensions` parsed through `DashboardWidgetSchema`, and so did `donut`,
`funnel`, `scatter`, `radar`, `treemap` and `sankey` — while `bogusProp` on the
same widget was refused by name, the lit control. After it, the same body is
refused at `defineStack`, at `os validate` (which loads through `defineStack`),
and on the metadata save path (`422 INVALID_METADATA`, active and draft). With
nothing to split by, those seven types draw `values[0]`: every measure after it
is queried and dropped on the floor by the renderer. The maintainer's ruling D
(「协议不正确的应该先修改协议」) fixes the protocol where it admits measures a
widget type cannot render; the metric-family narrowing was its first
application, and this is the same principle on the chart types.

### Write instead

| wrote | write instead |
|---|---|
| `{ id: 'mix', type: 'pie', dataset: 'sales', values: ['amount_sum', 'count'] }` (no `dimensions`) | `{ id: 'mix', type: 'table', dataset: 'sales', values: ['amount_sum', 'count'] }` — a row of measures |
| the same, wanting a chart | `type: 'bar'` (or `column` / `horizontal-bar`) — one bar per measure |
| the same, wanting the pie | `{ id: 'mix', type: 'pie', …, values: ['amount_sum'] }` **and** `{ id: 'mix_count', type: 'pie', …, values: ['count'] }` — one widget per measure, each with its own `id` (and `layout`, if you pin positions) |

No conversion does this for you: whether a dimensionless two-measure pie meant a
table, a bar chart or two pies is an authoring choice. The refusal lands at
`widgets[N].values` as ONE `custom` issue naming the widget's `id`, the number
of measures and the authored `type`, and it lists the types that do render
several measures on a dimensionless widget, read from
`DASHBOARD_WIDGET_MULTI_MEASURE_TYPES` (`table`, `pivot`, `bar`, `column`,
`horizontal-bar`, `line`, `area`, `combo`). That constant is the one list — the
check, the refusal text and the `values` doc string read it, and objectui's
mirror is to import it rather than restate it. A type that later gains a
declared multi-measure rendering joins it with no migration.

**Nothing else moves.** The seven types WITH a dimension, and with one measure,
parse exactly as before; every type in the multi-measure set keeps accepting
any number of measures with no dimension; the metric family's refusal is
unchanged and still ONE issue (this check steps aside for `metric` / `kpi` /
`gauge` / `solid-gauge` / `bullet` and for a typeless widget, which resolves to
`metric`); an empty `values` keeps its `too_small`; a `type` outside
`ChartTypeSchema` reports the type refusal alone. Census at the branch point
(`05be35259`), every tracked `.ts` / `.tsx` / `.js` / `.json` / `.md` / `.mdx`:
23 widget literals on the seven types, every one with one dimension and one
measure, and 0 dimensionless multi-measure widgets on them; the same scan over
an objectui checkout (`1263e40`) reads 0 as well.
