# Dashboards, Reports & Cubes

## Dashboards

Dashboards are a grid of widgets (`columns` × `rowHeight`) sharing a
`dateRange` scrubber and `globalFilters`. Each widget **binds a `dataset`** and
selects named `dimensions` + `values`, picks a chart `type`, and sets a
`layout: {x,y,w,h}` (ADR-0021).

### Widget Types

A widget's `type` is its **chart type** (`ChartTypeSchema`; defaults to
`metric`) — there are no separate `list` / `calendar` / `custom` widget kinds:

| Family | `type` values |
|:-------|:--------------|
| Single value | `metric`, `kpi`, `gauge`, `solid-gauge`, `bullet` (all render the number today; gauge variants gain a dial when a gauge renderer lands) |
| Comparison | `bar`, `horizontal-bar`, `column` |
| Trend | `line`, `area` |
| Mixed | `combo` (bar/line/area on shared dual axes) |
| Distribution | `pie`, `donut`, `funnel` |
| Relationship | `scatter` |
| Composition | `treemap`, `sankey` |
| Advanced | `radar` |
| Tabular | `table`, `pivot` |

### Dataset-Bound Widgets

Every persisted chart is **dataset-backed** (ADR-0021 single-form cutover): a
dashboard widget, a report, and a list `type:'chart'` view all **bind a `dataset`
and select named `dimensions` + `values`**; the dataset owns the base object,
allowed joins, intrinsic filter, dimensions, and certified measures. A widget
**requires `dataset` + `values`**; the closed schema rejects `object` /
`categoryField` / `valueField` / `aggregate` by name, and one lacking `dataset`
fails `os validate`. The dataset shape is
`DatasetSchema` — see `node_modules/@objectstack/spec/src/ui/dataset.zod.ts`.

A widget's presentation-scope `filter` flows into the query as the runtime
filter; keep `filter` on the widget when binding a dataset.

```typescript
{
  id: 'revenue_by_region',
  type: 'bar',
  title: 'Revenue by Region',
  dataset: 'sales',
  dimensions: ['region'],
  values: ['revenue'],
  layout: { x: 0, y: 0, w: 6, h: 4 },
}
```

**The real decision is not "inline vs dataset" — it is "can a dataset express
this?"** The shape is already fixed (always a dataset), so what you decide is
whether the *data need fits the dataset envelope*, and if not, which lower layer to
escalate to. Decide on **expressibility**; reuse/governance is Level B.

**Level A — the dataset envelope:**

| Fits a dataset → author one | Beyond the envelope → escalate |
|:--|:--|
| one base object + **to-one** joins (`include`, ≤3 hops) | a join that **changes grain** / a **to-many** rollup onto the parent |
| 0..N dimensions; date-bucket `day/week/month/quarter/year` | a **computed dimension** / CASE bucket / numeric bin |
| measures `count/sum/avg/min/max/count_distinct` | list aggregation (collect-into-array / concatenate — retired in protocol 17, no spelling exists) or any custom-SQL metric |
| **derived measures** — `ratio/sum/difference/product` of other measures | scalar math on raw fields (`amount*0.8`), aggregate-of-aggregate |
| WHERE (`$and/$or/$not` on the base object) + measure-scoped filters | **HAVING** (filtering the aggregate result) |
| `compareTo` (previous period/year) + `totals` (matrix subtotals) | **window** (rank, running total, lag/lead, %-of-total); **union**; reshaping params |

> **The iron rule:** a dataset is a governed, *narrow* semantic layer — NOT a
> general analytics escape hatch (no raw SQL, no hand-authored joins, no
> window/having). If the need is in the right column, a dataset **cannot** express
> it — escalate to a hand-authored **Cube** (raw SQL / explicit joins), a **stored
> rollup or formula field** on the object (to-many rollups, computed columns), or
> app code. Do not force it into a dataset: it fails to compile or renders an empty
> series.

Standardized answers to the recurring ambiguous cases:

- **"Count of child tasks per project."** Base the dataset on the **child** (`task`)
  and group by the parent lookup (`project`) — grain = child. A rollup onto the
  **parent** grain ("on `project`, count related tasks") is a to-many rollup:
  **not** dataset-expressible — use a **stored rollup field** on `project`.
- **To-one enrichment** ("revenue by `account.industry`") is fine and does **not**
  change grain — put `account` in `include`, add `account.industry` as a dimension.
- **Computed column.** Formatting/currency → a measure's `format`/`currency`;
  arithmetic over declared measures (`margin = difference(revenue, cost)`) → a
  **derived measure**; CASE / bins / `revenue*0.8` / computed dimensions → **not** a
  dataset.
- **Filter by a parent's attribute** → model it as a **dimension** (guaranteed to
  join); a lookup-path *filter* is not a reliable analytics-path construct.
- **A dashboard filter driving several charts** (date/region) → **not** a dataset:
  a dashboard variable + per-chart `filterBindings` broadcast into each chart's
  WHERE. A dataset is implied only when a parameter **reshapes** the query
  (grain/window/join) — and those are beyond the envelope anyway.

**Level B — naming is governance, not expressibility.** An inline dataset draft
(Studio Live Canvas) and a saved named dataset have **identical** expressibility;
naming one is a reuse/governance call (canonical/shared metric, RLS, shared
labels/formats → `defineDataset`). Persisted widgets already require a named
dataset, so Level B only surfaces in Studio previews and hand-coded react-page
`<ObjectChart>` blocks (a single-object inline `aggregate`, no dataset binding).

- Dataset-bound widgets need at least one `values` entry, and every
  `dataset`/`dimensions`/`values` name must resolve to its `defineDataset` —
  `os validate` fails on an unresolved name (an empty chart otherwise).
- **The two paths key their result rows differently — this is the #1 way a
  chart renders blank.** A DATASET returns rows keyed by the declared measure
  NAME (`sum_amount`), because a measure has an author-chosen `name`. An
  OBJECT-bound inline `aggregate` has no such name, so its rows are keyed by
  the RAW FIELD NAMES it was given: `groupBy` for the category column, `field`
  for the value column (the literal `count` for a fieldless `count`). Bind
  `<ObjectChart>`'s `xAxis.field` / `yAxis[].field` / `series[].name` to *those*
  names — never to a `sum_`-style measure name, and never to a field the
  aggregate did not select. `os validate` checks both halves
  (`react-chart-field-unknown`, `react-chart-axis-unknown`).

  ```jsx
  <ObjectChart objectName="showcase_invoice" type="bar"
    aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }}
    xAxis={{ field: 'status' }} yAxis={[{ field: 'total', format: '$0,0' }]}
    series={[{ name: 'total' }]} />
  // rows: [{ status: 'open', total: 1200 }, …]  ← keyed by the raw field names
  ```
- **Charts speak the spec `ChartConfig` shape on every surface** — the same
  `type` / `xAxis` / `yAxis` / `series` you write on a dashboard widget or a
  report. Axis presentation rides on the axis (`format`, `min`/`max`,
  `logarithmic`, `title`); a second `yAxis` entry plus `series[].yAxis: 'right'`
  gives a dual axis; `series[].stack` groups a stacked bar; `annotations` draw
  reference lines/bands.
- Studio's Dashboard Widget Inspector can author per-widget `dataset`,
  `dimensions`, and `values`; curated metadata-admin forms merge
  server-only fields back into the payload, so saving through Studio should
  not drop newer schema fields.
- The analytics runtime applies SecurityPlugin read scope via
  `security.getReadFilter`, so dashboard/report datasets remain RLS-aware.

### KPI Widgets, Filters, Drilldown

<!-- os:check -->
```typescript
import type { Dashboard } from '@objectstack/spec/ui';

export const SalesDashboard: Dashboard = {
  name: 'sales_dashboard',
  label: 'Sales Performance',
  columns: 12,
  gap: 4,
  refreshIntervalSeconds: 180,             // auto-refresh cadence

  header: {
    showTitle: true,
    actions: [
      { label: 'New Opportunity', icon: 'Plus',     actionType: 'modal',  actionUrl: 'create_opportunity' },
      { label: 'Forecast',        icon: 'TrendingUp', actionType: 'url',   actionUrl: '/reports/forecast' },
      { label: 'Export',          icon: 'Download', actionType: 'script', actionUrl: 'export_dashboard_pdf' },
    ],
  },

  // Date-range scrubber bound to a field on the underlying objects:
  dateRange: { field: 'close_date', defaultRange: 'this_quarter', allowCustomRange: true },

  // Filters applied to ALL widgets:
  globalFilters: [
    { field: 'owner', label: 'Sales Rep', type: 'lookup', scope: 'dashboard',
      optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' } },
  ],

  // ADR-0021: widgets bind a semantic `dataset` and select dimensions/measures
  // BY NAME (the `opportunity_metrics` / `order_metrics` datasets define the base
  // object, measures, and date dimensions — see Guides → Analytics Datasets). The
  // widget `filter` is the presentation-scope runtimeFilter.
  widgets: [
    {
      id: 'total_pipeline_value', type: 'metric',
      title: 'Total Pipeline',
      dataset: 'opportunity_metrics', values: ['total_amount'],
      filter: { stage: { $nin: ['closed_won', 'closed_lost'] } },
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: { icon: 'DollarSign' },   // the measure's own `format` drives the number
      // Period-over-period: renderer fetches the prior quarter and
      // surfaces a secondary value + delta arrow automatically.
      compareTo: { kind: 'previousPeriod' },
    },

    // Chart widget with comparison overlay (M2). The renderer issues a
    // second query with the time window shifted by `compareTo` and
    // overlays it as a muted/dashed series. The date axis is a dataset
    // dimension whose monthly bucketing lives on the dataset (`dateGranularity`).
    {
      id: 'revenue_vs_last_year', type: 'line',
      title: 'Revenue — This Year vs Last',
      dataset: 'order_metrics', dimensions: ['closed_at'], values: ['total_sum'],
      filter: { closed_at: { $gte: '{current_year_start}', $lte: '{current_year_end}' } },
      compareTo: { kind: 'previousYear' },
      layout: { x: 3, y: 0, w: 9, h: 4 },
    },
  ],
};
```

### Dashboard filters — `globalFilters` + per-widget `filterBindings`

A dashboard filter is **broadcast into every widget's query**. A widget with no
`filterBindings` inherits it on its own object's like-named field — which is how
a filter bar looks alive while the tiles read `0`: the inherited binding is
field-valid and value-empty when two objects share a column name under different
vocabularies.

| Declare | On | Meaning |
|:--|:--|:--|
| `name` | a `globalFilters` entry | The stable key `filterBindings` references. Defaults to `field`; name it for the **vocabulary it carries**, not the column it sits on. |
| `scope: 'widget'` + `targetWidgets` | a `globalFilters` entry | Apply to those widget ids only. `scope` defaults to `'dashboard'`. |
| `filterBindings: { filterName: 'field' }` | a widget | Re-target onto THIS widget's field. |
| `filterBindings: { filterName: false }` | a widget | Opt out — the honest binding when the vocabularies are disjoint and no field can be re-targeted. |
| absent | a widget | Default binding: the filter's own `field`; for the reserved `dateRange`, `dateRange.field ?? 'created_at'`. |

```typescript
// One control, two objects: re-target on one widget, opt the other out.
{ id: 'revenue_by_region', dataset: 'order_metrics', values: ['total_sum'],
  filterBindings: { region: 'sales_region' } },
{ id: 'projects_at_risk', dataset: 'project_metrics', values: ['project_count'],
  filterBindings: { task_status: false } },
```

### Period-over-period — `compareTo`

Set `compareTo` on any data-bound widget to add a second query against a
shifted time window. The renderer derives the comparison automatically;
no second `filter` is required.

`compareTo` is `{ kind, dimension? }` — the same shape the analytics executor
reads (`DatasetSelection.compareTo`), so what a widget declares is exactly what
runs. There is no second widget-side vocabulary.

| Key | Value | Behaviour |
|:--|:--|:--|
| `kind` | `'previousPeriod'` | The equal-length window immediately before the resolved one. |
| `kind` | `'previousYear'` | The same window shifted back one calendar year. |
| `dimension` | dimension name, **optional** | Which time dimension's window to shift. Omit it when the selection dates exactly one — the executor resolves it. With zero or several it errors, naming the candidates; it never guesses. |

```typescript
compareTo: { kind: 'previousPeriod' }                            // one dated dimension
compareTo: { kind: 'previousYear', dimension: 'close_date' }     // several — say which
```

* **Metric widgets** — the prior-period value renders as a small caption
  beneath the headline number, alongside a green/red delta arrow and an
  i18n trend label resolved from the comparison kind (e.g. `vs previous
  period`, `vs previous year`). Authors should *not*
  hand-author `options.trend` when `compareTo` is set; the renderer wins
  and overwrites it.
* **Cartesian charts** (`line` / `area` / `bar` / `horizontal-bar` /
  `scatter`) — the comparison series is appended after the primary series
  with `variant: 'comparison'`, muted per family (dashed `'4 4'` on
  line/area only; reduced opacity on all). Override per-series with
  `series.dashArray` / `series.opacity`.
* **Pie / donut / funnel** — `compareTo` is silently ignored; there is no
  meaningful "two-period" composition for part-of-whole charts.
* **Requirements** — a comparison needs a **dated window** to shift. When the
  selection carries no time dimension with a date range (no resolvable date
  macro in the widget `filter`, no dashboard `dateRange`), the executor says so
  rather than rendering a silently empty comparison column. The shifted query
  reuses the original `filter` shape and replaces only the date-bound clauses.

```typescript
// Metric — WoW delta (binds the task_metrics dataset; filter = runtimeFilter)
{ id: 'done_this_week', type: 'metric', dataset: 'task_metrics', values: ['task_count'],
  filter: { assignee: '{current_user_id}', status: 'done',
            completed_at: { $gte: '{week_start}' } },
  compareTo: { kind: 'previousPeriod' } }

// Bar — YoY overlay on a stable category set
{ id: 'headcount_by_dept', type: 'bar', dataset: 'employee_metrics',
  dimensions: ['department'], values: ['headcount'],
  filter: { status: { $ne: 'terminated' } },
  compareTo: { kind: 'previousYear' } }
```

### Server-side date bucketing — `dateGranularity` (ADR-0021)

The **dataset dimension carries the default; a widget's
`options.dateGranularity` overrides it for that widget only.** Give a date
dimension a `dateGranularity` and any presentation that selects it groups by that
bucket server-side — without it every distinct timestamp becomes its own
category, collapsing a 12-row seed into a 12-point flat line. (The old widget-level
`categoryGranularity` was removed in the single-form cutover.)

<!-- os:check -->
```typescript
import { defineDataset, type DashboardWidget } from '@objectstack/spec/ui';

// In the dataset (Guides → Analytics Datasets):
defineDataset({
  name: 'contract_metrics', label: 'Contract Metrics', object: 'contract',
  dimensions: [{ name: 'signed_date', field: 'signed_date', type: 'date', dateGranularity: 'month' }],
  measures: [{ name: 'signed_count', aggregate: 'count' }],
});
// A monetary measure may declare `currency` (ISO 4217) for a locale-correct
// symbol: `{ name: 'revenue', aggregate: 'sum', field: 'amount', currency: 'USD' }`.
// It resolves measure `currency` → the aggregated field's
// `currencyConfig.defaultCurrency` → the tenant `localization.currency` default
// (ADR-0053). Omit it for non-money measures (count, avg-of-hours).

// The widget just selects the dimension by name:
const signedByMonth: DashboardWidget = { id: 'signed_by_month', type: 'line',
  dataset: 'contract_metrics', dimensions: ['signed_date'], values: ['signed_count'],
  filter: { signed_date: { $gte: '{12_months_ago}' } },
  compareTo: { kind: 'previousYear' } };
```

| `dateGranularity` | Rendered bucket label |
|:--|:--|
| `'day'` | `YYYY-MM-DD` |
| `'week'` | ISO date of the bucket (`YYYY-MM-DD`) |
| `'month'` | `YYYY-MM` |
| `'quarter'` | `YYYY-Qn` |
| `'year'` | `YYYY` |

* **Engine support** — Postgres `date_trunc`, MySQL `date_format`, SQLite
  `strftime`, MongoDB `$dateTrunc`, in-memory fallback. All emitted by the
  analytics service, not the client.
* **Human labels are automatic** — the analytics layer formats the bucket value
  to the label above, and resolves `select`/`lookup` dimension values to their
  option label / related-record name. Measures carry their `label` + `format`
  (e.g. `$0,0`) so KPIs and legends read "Total Spent / $616,000", not
  "spent_sum / 616000". Authors do not format dimension/measure values by hand.
* **Combines with `compareTo`** — the comparison query is issued with the same
  granularity, so the muted overlay aligns bucket-for-bucket.
* **Rule of thumb** — `day` for ≤30d windows, `week` for ~90d, `month` for
  6–12 months, `quarter` for multi-year, `year` for retention / compliance.

### Widget `options` — the five declared keys

`options` is an open bag — presentation extras (`icon`, `trend`, `density`, …)
pass through untouched. These five are **declared** because they change the SQL
the dataset query compiles to, so a typo (`sortDirection`, `granularity`) is an
author-time type error rather than an option that silently does nothing.

| Key | Value | Effect |
|:--|:--|:--|
| `dateGranularity` | `day` / `week` / `month` / `quarter` / `year` | Buckets this widget's selected DATE dimensions. **Overrides** the dataset dimension's own default, for this widget only. |
| `sortBy` | a name this widget selects | Order by that dimension or measure. It must be one of this widget's own `dimensions` / `values` entries. |
| `sortOrder` | `'asc'` \| `'desc'` | Direction for `sortBy` (default ascending). |
| `limit` | positive integer | Max rows, applied **after** ordering — so "top 10 accounts" is `limit` **plus** `sortBy`. Without `sortBy` the runtime orders by the selected dimensions: deterministic, but not the top of anything. |
| `stageOrder` | array of **stored** values | Explicit category order for `funnel` / `pyramid`. Stored values, not display labels; omit it to inherit the field's own picklist order. |

```typescript
// Top 10 accounts by revenue, bucketed monthly for this widget only
options: { sortBy: 'revenue_sum', sortOrder: 'desc', limit: 10, dateGranularity: 'month' }
```

### Drilldown

Dashboards drill in two ways: **drill-through** turns an aggregate into the rows
behind it; **drill-to-record** opens one record.

* **`table` / `pivot` widgets drill through.** Clicking an aggregated table row
  or pivot cell opens a side drawer listing the underlying records. The dataset
  preserves each grouped row's raw group keys, so the drawer filters to the
  *exact* records (no label→id guessing). Automatic — no per-widget config.
* **The drilled record list drills to record.** Any row in that drawer opens the
  single record's detail, completing the **group → records → record** chain.
* **Escape hatch — "Open in list →".** The drawer header offers a link to the
  object's *full* list page (sort / bulk-select / export / shareable URL),
  scoped by the same drill filter. The in-place drawer is the default (peek
  without losing the dashboard); the escape hatch escalates when the user wants
  the full surface — the Looker / Power BI "see records → open page" model.
* **`metric` / `chart` widgets are not click-drillable** in the dataset form
  (they render the aggregate only; `compareTo` still applies). Surface the detail
  through a `table` / `pivot` widget instead.

**Reports drill the same way.** A `summary` / `matrix` report (`drilldown`
defaults `true`) opens the identical in-place drawer on row/cell click — peek the
records, click a row to open one, or "Open in list →" for the full list page.
Dashboard and report drill are unified.

---

## Report Configuration

<!-- os:check -->
```typescript
import { defineReport } from '@objectstack/spec/ui';

// ADR-0021: a report binds a `dataset` and selects `rows` (dimensions) +
// `values` (measures) BY NAME. The `opportunity_metrics` dataset defines the
// object, the `amount_sum` measure, and the `forecast_category` + `close_date`
// (dateGranularity: 'quarter') dimensions — see Guides → Analytics Datasets.
export const PipelineCoverageReport = defineReport({
  name: 'pipeline_coverage_by_quarter',
  label: 'Pipeline Coverage (Quarter)',
  type: 'matrix',
  dataset: 'opportunity_metrics',
  rows: ['forecast_category'],   // down axis
  columns: ['close_date'],       // across axis (ADR-0021 D2) — matrix pivots rows × columns
  values: ['amount_sum'],        // measures placed in the cells
  runtimeFilter: { stage: { $ne: 'closed_lost' } },
  // Optional ordering, most significant key first. A selected DATE dimension is
  // already chronological by default — declare `order` only to change that, or
  // to sort by a measure / a non-date dimension.
  order: [{ by: 'amount_sum', direction: 'desc' }],
  // drilldown defaults true — click a cell to open the underlying records; set false to disable.
  chart: { type: 'bar', xAxis: 'forecast_category', yAxis: 'amount_sum' },
});
```

> **`dateGranularity`** lives on the dataset's date **dimension**
> (`day | week | month | quarter | year`); selecting that dimension buckets the
> field server-side in a single aggregate query — do **not** pre-compute virtual
> columns for this.
> **`rows`** are the report's grouping dimensions (selected from the dataset by
> name). A `summary` groups *down* by `rows`. A `matrix` pivots `rows` (down) ×
> **`columns`** (across, ADR-0021 D2) with `values` in the cells — do **not**
> put both axes in `rows`. Multi-level grouping on either axis = multiple
> dimension names in that array. `drilldown` (default `true`) makes cells
> click-through to the underlying records.
> **`order`** sorts the result server-side — a list of `{ by, direction }`, most
> significant key first. `by` must be a `rows`/`columns` dimension or a `values`
> measure the report actually selects (anything else is an authoring error). A
> selected date dimension already defaults to ASCENDING, so a month-bucketed
> matrix reads left-to-right in time with no `order` at all; list the `columns`
> key first when the across-axis header sequence is what matters. A `joined`
> report orders per block (`blocks[].order`), never on the container.

---

## Analytics Cubes — Semantic Layer

`Cube` definitions sit between objects and dashboards/reports — they expose
named **measures** (aggregates) and **dimensions** (groupings) that BI
widgets can compose without hand-rolling each query. Register under
`defineStack({ analyticsCubes: [...] })`.

<!-- os:check -->
```typescript
import { defineCube } from '@objectstack/spec/data';

export const opportunityCube = defineCube({
  name: 'opportunity',
  title: 'Opportunities',
  sql: 'opportunity',            // underlying object name (snake_case)
  public: true,
  measures: {
    count:  { name: 'count',  label: 'Count',        type: 'count', sql: '*' },
    amount: { name: 'amount', label: 'Total Amount', type: 'sum',   sql: 'amount', format: 'currency' },
  },
  dimensions: {
    stage:            { name: 'stage',            label: 'Stage',    type: 'string', sql: 'stage' },
    close_date:       { name: 'close_date',       label: 'Close',    type: 'time',   sql: 'close_date',
                        granularities: ['day', 'week', 'month', 'quarter', 'year'] },
    account_industry: { name: 'account_industry', label: 'Industry', type: 'string', sql: 'account.industry' },
    owner:            { name: 'owner',            label: 'Owner',    type: 'string', sql: 'owner' },
  },
});
```

### Cube Rules

1. **`sql` = object name** (e.g. `'opportunity'`). The ObjectQL strategy
   reads it via `cube.sql.trim()` — do **not** put raw SQL there.
2. **Always declare `granularities`** on `time` dimensions so dashboards can
   bucket by day / month / quarter without ad-hoc queries.
