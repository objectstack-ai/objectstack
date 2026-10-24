# @object-ui/plugin-dashboard — Skill notes

Server-driven dashboard renderer. Consumes `DashboardSchema` (from
`@objectstack/spec`) and renders a grid of widgets (metric, gauge, chart,
table, pivot, etc.) with drag/resize, drill-down, and async data binding.

> **Authoring shape (ADR-0021).** Dashboard widgets bind a semantic-layer
> `dataset` and select its `dimensions` + `values` by name — that is the only
> author-facing analytics shape. The pre-ADR-0021 inline query
> (`object` + `categoryField` + `valueField` + `aggregate`, pivot
> `rowField`/`columnField`) was removed at `@objectstack/spec` 9.0.0 and is a
> hard error under `DashboardWidgetSchema.strict()` (framework#3251). Examples
> below use the dataset shape.

## Period-over-period comparison (`compareTo`)

Any dataset-bound widget (metric / gauge / chart / table / pivot) can opt into a
period-over-period comparison by adding a `compareTo` field. The dataset
executor re-runs the same selection over the shifted window and attaches a
`<measure>__compare` column to each row, which the widget shows as:

- For **metric** & **gauge** widgets, a delta percentage surfaced as a `trend`
  indicator (overrides any static `trend` prop).
- For **chart** widgets (line / area / bar / horizontal-bar / combo), a muted
  second series (dashed line, lower fill opacity). Pie, donut, funnel and
  scatter charts ignore `compareTo`.
- For **table** widgets, a comparison column beside each compared measure.
- For a **pivot** cross-tab (`type: 'pivot'` with ≥2 dimensions), the comparison
  is stacked **inside** the cell — current value on top, comparison value and
  delta beneath in smaller type — because those columns are already
  `bucket × measure` and a comparison column would double the width. Row,
  column and grand subtotals stack it the same way, and one caption names the
  window for the whole table (objectui#3614).

Nothing is opted into per render path: every path detects the comparison from
the `<measure>__compare` column in the returned data, so a selection the
executor sent no comparison for renders exactly as it does without `compareTo`.

**CSV export is data, not a picture of the table.** The export always emits a
flat `<measure>__compare` column per compared measure — including the cross-tab,
whose display stacks them — so exported cells stay bare numbers a spreadsheet
can compute on.

### Accepted value

`compareTo` is an object — the analytics executor's own contract
(`DatasetSelection.compareTo`, objectstack#5011). It is a plain **strict**
object, so an unknown key is rejected rather than ignored:

```ts
{ kind: 'previousPeriod' | 'previousYear', dimension?: string }
```

| Key | Meaning |
|---|---|
| `kind: 'previousPeriod'` | The equal-length window immediately before the current one. On the inline (non-dataset) path this substitutes `current_*` / `today` date macro tokens with `last_*` / `yesterday` (e.g. `current_quarter_start` → `last_quarter_start`), so it works best when the filter uses date macros. |
| `kind: 'previousYear'` | The same window shifted back one calendar year. |
| `dimension` | Optional. Names the dataset time dimension whose window is shifted. **Omit it** unless the widget's window covers more than one date field — the executor resolves it, and says so loudly (listing the candidates) when there is not exactly one. |

The earlier spellings are retired: the bare strings `"previousPeriod"` /
`"previousYear"` are now `{ "kind": "previousPeriod" }` / `{ "kind":
"previousYear" }`, and the `{ "offset": "…" }` form is gone. `{ offset: '1y' }`
is `{ kind: 'previousYear' }`; `'7d'` / `'1M'` have no faithful equivalent —
state that window on the widget's own `filter` and ask for
`{ kind: 'previousPeriod' }`.

### The window has to be a bounded date range

A period-over-period comparison is only defined against a **bounded** window,
so the widget's `filter` must date the measure with both ends —
`{ "$gte": …, "$lte": … }` on a date field (a date-macro pair, or the
dashboard's own date-range filter bound to that widget). The renderer lowers
that window into the dataset query's time dimension for the executor to shift.

A half-open `{ "$gte": … }`, an exclusive `$lt`, or no date condition at all
leaves nothing to shift, and the widget surfaces the executor's error instead of
rendering a comparison that silently isn't one.

### Trend label i18n

The trend label key is sniffed from the filter so it surfaces automatically
without per-card configuration:

| Filter contains | Translation key |
|---|---|
| `{current_year_*}` / `{year_*}` | `dashboard.trend.vsLastYear` |
| `{current_quarter_*}` / `{quarter_*}` | `dashboard.trend.vsLastQuarter` |
| `{current_month_*}` / `{month_*}` | `dashboard.trend.vsLastMonth` |
| `{current_week_*}` / `{week_*}` | `dashboard.trend.vsLastWeek` |
| `{today}` | `dashboard.trend.vsYesterday` |
| anything else | `dashboard.trend.vsPreviousPeriod` |

`kind: 'previousYear'` always uses `vsLastYear` regardless of the filter shape;
the sniffing above applies to `kind: 'previousPeriod'`.

### Metric example

```json
{
  "id": "revenue",
  "type": "metric",
  "dataset": "order_metrics",
  "values": ["revenue"],
  "filter": {
    "created_at": {
      "$gte": "{current_quarter_start}",
      "$lte": "{current_quarter_end}"
    }
  },
  "compareTo": { "kind": "previousPeriod" }
}
```

Renders a KPI card showing this quarter's revenue with a `↑ 12.5% vs last quarter`
delta sourced from the same dataset query run against Q1 2026. (The `revenue`
measure — its aggregate, field, format, and currency — is declared once on the
`order_metrics` dataset, not inline on the widget.)

### Chart example (year-over-year line)

```json
{
  "id": "orders-trend",
  "type": "line",
  "dataset": "order_metrics",
  "dimensions": ["created_at"],
  "values": ["order_count"],
  "filter": {
    "created_at": {
      "$gte": "{current_year_start}",
      "$lte": "{current_year_end}"
    }
  },
  "compareTo": { "kind": "previousYear" }
}
```

Renders a line of monthly order counts for the current year with a dashed,
50%-opacity overlay of last year's counts on the same axis. Comparison-period
points are aligned to current-period buckets by groupBy value when possible,
otherwise by sorted index (the common case for time series).

### Naming the dimension (only when the window is ambiguous)

```json
{ "compareTo": { "kind": "previousYear", "dimension": "created_at" } }
```

Needed only when the widget's filter dates more than one field, so the executor
cannot tell which window to shift. With a single dated field, omit `dimension`
— hard-coding one that the dataset does not date is how a comparison ends up
running over a window nobody asked for.

### When NOT to use `compareTo`

- Filters with no bounded date range — there is no window to shift, and the
  widget reports that instead of rendering a comparison. Date the widget (a
  date-macro `$gte`/`$lte` pair, or a dashboard date-range filter bound to it)
  or omit `compareTo` entirely.
- Pie / donut / funnel charts — comparison overlays are not visually
  meaningful and are silently ignored.
- Scatter charts, and the `bubble` widget type that renders as one — a scatter
  binds ONE measure to its y axis, so an overlay could only be drawn on the
  primary's own y. `compareTo` is ignored until scatter can project a second
  measure (objectui#7194 option A); ruled in objectui#7402.

## Related

- Date macros: `@object-ui/core` → `resolveDateMacros`
- Comparison utilities: `@object-ui/core` → `shiftFilterByCompareTo`,
  `compareToTrendLabelKey`, `CompareToConfig`
- Spec: `@objectstack/spec` → `DashboardWidgetSchema.compareTo`
