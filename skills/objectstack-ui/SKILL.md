---
name: objectstack-ui
description: >
  Author ObjectStack UI metadata — Views (list/form/kanban/calendar/gantt),
  Apps (navigation), Pages, Dashboards, Reports, Charts, Actions. Use when
  the user is adding `*.view.ts` / `*.app.ts` / `*.dashboard.ts` /
  `*.action.ts` files or designing a Studio-rendered UI surface. Do not use
  for: data schema (see objectstack-data), interactive screen flows /
  wizards (those are `*.flow.ts` with `type: 'screen'` — see
  objectstack-automation), the React renderer implementation (lives in
  `packages/client-react`, not metadata), or Studio's own admin UI (that
  ships with the platform). CEL expressions in
  visibility/conditional rules: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec Zod schemas (v4+)
metadata:
  author: objectstack-ai
  version: "1.1"
  domain: ui
  tags: view, app, page, dashboard, report, chart, action, widget
---

# UI Design — ObjectStack UI Protocol

Expert instructions for designing user interfaces using the ObjectStack
specification. This skill covers Views (list, form, kanban, calendar, …),
App navigation, Dashboards, Reports, and Actions.

---

## When to Use This Skill

- You are creating a **list view** (grid, kanban, calendar, gantt, map, …).
- You are designing a **form layout** (simple, tabbed, wizard).
- You are building an **app** with structured navigation menus.
- You need a **dashboard** with widget grids.
- You are adding **reports** (tabular, summary, matrix, chart).
- You are configuring **actions** (buttons, URL jumps, screen flows).

---

## View Types

### List Views

| Type | When to Use |
|:-----|:------------|
| `grid` | Standard data table — default for most objects |
| `kanban` | Visual board with columns (status-driven workflows) |
| `gallery` | Card-based masonry layout (visual catalogues, contacts) |
| `calendar` | Date-based scheduling (events, tasks, bookings) |
| `timeline` | Chronological activity stream |
| `gantt` | Project management with dependency tracking |
| `map` | Geospatial records with `location` fields |

### Form Views

| Type | When to Use |
|:-----|:------------|
| `simple` | Single-page form — suitable for objects with ≤ 15 fields |
| `tabbed` | Tabbed sections — for complex objects with many field groups |
| `wizard` | Step-by-step flow — guided data entry (onboarding, applications) |

### Master-Detail Forms (parent + child line items)

To let users enter a record **together with its child line items** (invoice +
lines, project + tasks) and save them **atomically**, you almost never need a
custom page or form config. Prefer, in order:

1. **Relationship `inlineEdit` (default, zero UI config).** Declare it in the
   DATA MODEL — set `inlineEdit: true` on the child's `master_detail` field that
   references the parent (see the objectstack-data skill → Relationships →
   Inline Editing). Every standard New/Edit form for the parent (modal, drawer,
   full-page) then auto-renders an editable child grid and saves parent +
   children in one atomic `/api/v1/batch`. **No view metadata needed.**

2. **Form view `subforms` (override / tuning).** Add to a form view only when you
   need to override the derived columns/order, or expose a child the
   relationship didn't mark inline:

   ```typescript
   formViews: {
     default: {
       type: 'simple',
       sections: [{ label: 'Invoice', fields: ['number', 'account'] }],
       subforms: [
         { childObject: 'invoice_line', // relationshipField + columns are
           title: 'Line Items',         // derived from the child object;
           addLabel: 'Add line' },      // set `columns` here only to override.
       ],
     },
   },
   ```

3. **`object-master-detail-form` page block (bespoke layout).** Use a page only
   for free-form layouts. Same `details: [{ childObject }]` shorthand.

The relationship FK and grid columns are derived from the child object's
metadata in every case; select options and lookups carry through. A parent
`summary` field rolls child values up server-side (see objectstack-data).

---

## Configuring a List View

### Data Source (`data`)

Every view connects to data via one of three providers:

```typescript
// Auto-connect to an ObjectStack object
data: { provider: 'object', object: 'support_case' }

// Custom API endpoint
data: { provider: 'api', read: { url: '/api/cases', method: 'GET' } }

// Static inline data
data: { provider: 'value', items: [...] }
```

> **Best practice:** Always use `provider: 'object'` when the data source is
> an ObjectStack-managed object. It enables automatic CRUD, real-time updates,
> filtering, and pagination.

### Columns

Columns can be defined as a simple string array or detailed config:

```typescript
// Simple — field names only
columns: ['subject', 'status', 'priority', 'assigned_to', 'due_date']

// Enhanced — full control
columns: [
  { field: 'subject', link: true, width: 300 },
  { field: 'status',  width: 120, align: 'center' },
  { field: 'priority' },
  { field: 'assigned_to', label: 'Owner' },
  {
    field: 'due_date',
    summary: { function: 'min' },
    sortable: true,
  },
]
```

### Column Features

| Property | Purpose |
|:---------|:--------|
| `field` | Field name (snake_case) — **required** |
| `label` | Display label override |
| `width` | Pixel width |
| `align` | `left` / `center` / `right` |
| `hidden` | Hide by default (user can show) |
| `pinned` | Freeze column: `left` / `right` |
| `sortable` | Allow sorting |
| `resizable` | Allow resizing |
| `link` | Make this the primary navigation link |
| `summary` | Footer aggregation: `count`, `sum`, `avg`, `min`, `max`, etc. |

### Filtering

```typescript
filter: [
  { field: 'status', operator: 'not_equals', value: 'closed' },
  { field: 'assigned_to', operator: 'equals', value: '$currentUser' },
]
```

Common operators: `equals`, `not_equals`, `contains`, `starts_with`,
`greater_than`, `less_than`, `is_empty`, `is_not_empty`, `in`, `not_in`,
`this_week`, `this_month`, `this_quarter`, `last_n_days`.

> **`$currentUser`** is a runtime variable — the logged-in user's ID.

### Sorting

```typescript
// Simple
sort: 'created_at desc'

// Multi-field
sort: [
  { field: 'priority', order: 'desc' },
  { field: 'created_at', order: 'asc' },
]
```

---

## Configuring Kanban Views

```typescript
{
  type: 'kanban',
  data: { provider: 'object', object: 'support_case' },
  columns: ['subject', 'priority', 'assigned_to'],
  groupBy: 'status',
  sort: 'priority desc',
}
```

> **Key rule:** The `groupBy` field should be a `select` type with well-defined
> options. Each option becomes a column on the board.

---

## App Navigation

An **App** groups objects, dashboards, reports, and custom pages into a
structured navigation tree. Build with `App.create({...})` from
`@objectstack/spec/ui` and register under `defineStack({ apps: [...] })`.

```typescript
import { App } from '@objectstack/spec/ui';

export const CrmApp = App.create({
  name: 'crm_enterprise',
  label: 'Enterprise CRM',
  icon: 'briefcase',
  defaultAgent: 'sales_copilot',          // optional AI copilot binding
  branding: {
    primaryColor: '#4169E1',
    logo: '/assets/crm-logo.png',
    favicon: '/assets/crm-favicon.ico',
  },
  navigation: [
    {
      id: 'group_sales', type: 'group', label: 'Sales', icon: 'chart-line',
      expanded: true,
      children: [
        { id: 'nav_lead',        type: 'object', objectName: 'lead',        label: 'Leads',         icon: 'user-plus' },
        { id: 'nav_opportunity', type: 'object', objectName: 'opportunity', label: 'Opportunities', icon: 'target' },
        // Open a specific named view instead of the object default:
        { id: 'nav_pipeline',    type: 'object', objectName: 'opportunity', viewName: 'pipeline_kanban', label: 'Sales Pipeline', icon: 'columns-3' },
        { id: 'nav_dash',        type: 'dashboard', dashboardName: 'sales_dashboard', label: 'Sales Dashboard', icon: 'chart-bar' },
        { id: 'nav_report',      type: 'report',    reportName: 'opportunities_by_stage', label: 'Opps by Stage', icon: 'bar-chart-3' },
      ],
    },
    {
      id: 'group_approvals', type: 'group', label: 'Approvals', icon: 'check-circle',
      children: [
        // Reference system objects via `requiresObject` so the menu auto-hides
        // when the capability is not installed.
        { id: 'nav_approval_requests', type: 'object', objectName: 'sys_approval_request', label: 'Approval Requests', icon: 'inbox', requiresObject: 'sys_approval_request' },
      ],
    },
  ],
});
```

### Navigation Item Types

| Type | Properties | Purpose |
|:-----|:-----------|:--------|
| `group`     | `label`, `icon`, `expanded`, `children[]`     | Collapsible group of items |
| `object`    | `objectName`, `viewName?`, `label`, `icon`    | Link to an object list (optionally a specific view) |
| `dashboard` | `dashboardName`, `label`, `icon`              | Link to a dashboard |
| `report`    | `reportName`, `label`, `icon`                 | Link to a report |
| `page`      | `pageName`, `label`, `icon`                   | Link to a custom Page (`type: 'home' | 'app_launcher' | ...`) |
| `url`       | `url`, `label`, `icon`                        | External or custom URL |
| `divider`   | —                                             | Visual separator |

> **`requiresObject` / `requiresCapability`:** Use these on any item that
> depends on an optional system object or capability so the nav item is
> automatically hidden when missing — never hard-code conditional UI.

---

## Dashboards

Dashboards are a grid of widgets (`columns` × `rowHeight`) sharing a
`dateRange` scrubber and `globalFilters`. Each widget declares an `object`,
an `aggregate` measure or chart spec, and a `layout: {x,y,w,h}`.

### Widget Types

| Type | Purpose |
|:-----|:--------|
| `metric` | Single KPI number (count, sum, avg) |
| `chart` | Bar, line, pie, donut, area chart |
| `list` | Embedded list view (mini table) |
| `calendar` | Embedded calendar widget |
| `custom` | Custom component (HTML / React) |

See the **Production Pattern** section below for the full
`Dashboard` shape with `refreshInterval`, header actions, date range,
global filters, widget options, and the period-over-period (`compareTo`)
/ date-bucketing (`categoryGranularity`) modifiers available on every
data-bound widget.

---

## Report Types

| Type | When to Use |
|:-----|:------------|
| `tabular` | Flat data table with columns and filters |
| `summary` | Grouped data with subtotals (e.g., revenue by region) |
| `matrix` | Cross-tab / pivot table (two grouping dimensions) |
| `chart` | Visual chart report |
| `joined` | Multi-block analytic surface (combines several sub-reports) |

### Report Configuration

```typescript
import type { ReportInput } from '@objectstack/spec/ui';

export const PipelineCoverageReport: ReportInput = {
  name: 'pipeline_coverage_by_quarter',
  label: 'Pipeline Coverage (Quarter)',
  objectName: 'opportunity',
  type: 'matrix',
  columns: [
    { field: 'name',   label: 'Opportunity' },
    { field: 'amount', label: 'Amount', aggregate: 'sum' },
  ],
  groupingsDown:   [{ field: 'forecast_category', sortOrder: 'asc' }],
  groupingsAcross: [{ field: 'close_date', dateGranularity: 'quarter' }],
  filter: { stage: { $ne: 'closed_lost' } },
  chart: { type: 'bar', xAxis: 'forecast_category', yAxis: 'amount' },
};
```

> **`dateGranularity`** on a grouping (`day | week | month | quarter | year`)
> tells the server to bucket date fields in a single aggregate query — do
> **not** pre-compute virtual columns for this.
> **`groupingsDown`** drives row groupings (summary). Add `groupingsAcross`
> to upgrade to a matrix. Multi-level grouping = multiple entries in the array.

---

## Pages — Lightning-Style Page Layouts

A **Page** is a Salesforce-Lightning-style layout composed of **regions**
populated with **components**. Pages let designers assemble record details,
home pages, app launchers, and utility bars without writing React.

Register under `defineStack({ pages: [...] })`.

### Page Types

| `type`           | Purpose |
|:-----------------|:--------|
| `home`           | App home / landing page |
| `record_detail`  | Object record detail layout (overrides the default form) |
| `app_launcher`   | Tile grid for switching between apps |
| `utility_bar`    | Persistent bottom-of-screen utilities (notes, tasks, calls) |

### Templates & Regions

`template` controls the column layout (e.g. `'three-column'`,
`'two-column'`, `'single-column'`). Each template exposes named
**regions** (`header`, `left_sidebar`, `main`, `right_sidebar`, `footer`)
which contain components.

### Component Catalogue (selection)

| `type`               | Use |
|:---------------------|:----|
| `page:header`        | Title + subtitle + breadcrumb + inline `actions: Action[]` |
| `page:card`          | Bordered/un-bordered card with `body: Component[]` |
| `record:highlights`  | Salesforce highlights panel — strip of key fields |
| `record:path`        | Stage progress bar driven by a status field |
| `record:related`     | Related-list (child records via lookup) |
| `nav:menu`           | Quick-create / nav menu bound to current context |
| `widget:metric`      | Single KPI widget (count/sum/avg) |
| `widget:chart`       | Embedded chart |

### Example — Record Detail Page

```typescript
import { Page } from '@objectstack/spec/ui';
import { ConvertLeadAction } from '../actions/lead.actions';

export const LeadDetailPage: Page = {
  name: 'lead_detail_page',
  label: 'Lead Detail',
  type: 'record_detail',
  objectName: 'lead',
  template: 'three-column',
  regions: [
    {
      name: 'header', width: 'full',
      components: [
        {
          type: 'page:header', id: 'lead_header', label: 'Lead Information',
          properties: {
            title: '{first_name} {last_name}',
            subtitle: '{company}',
            icon: 'user-plus',
            breadcrumb: true,
            actions: [ConvertLeadAction],   // inline action buttons in header
          },
        },
        {
          type: 'record:highlights', id: 'lead_highlights',
          properties: { fields: ['status', 'rating', 'lead_source', 'owner', 'email', 'phone'] },
        },
        {
          type: 'record:path', id: 'lead_path',
          properties: {
            statusField: 'status',
            stages: [
              { value: 'new',         label: 'New' },
              { value: 'contacted',   label: 'Contacted' },
              { value: 'qualified',   label: 'Qualified' },
              { value: 'unqualified', label: 'Unqualified' },
            ],
          },
        },
      ],
    },
    // left_sidebar / main / right_sidebar regions follow…
  ],
};
```

> **Variable substitution** — `{first_name}`, `{current_user.first_name}`,
> `{current_quarter_start}` etc. resolve from the page's `variables` block,
> the bound record, and the runtime context. Declare `variables: [...]` at
> the page root for any non-record value. For relative-date placeholders
> (`{today}`, `{30_days_ago}`, `{N_<unit>_(ago|from_now)}` …) see the
> [Date Macros](#date-macros--filter-placeholders) reference below — the
> full token list is published as `DATE_MACRO_TOKENS` in `@objectstack/spec`.

> **Actions in header** — pass full `Action` objects into
> `page:header.properties.actions`; do **not** create a sibling action node.
> The header renders them inline in the action slot.

---

## CRM UI Blueprint (Metadata-First)

Use this CRM-style structure as the canonical UI assembly reference:

| UI Surface | Typical Location | Pattern to Follow |
|:--|:--|:--|
| Multi-view object UI | `src/views/*.view.ts` | Define default `list` + `form`, then named `listViews` / `formViews` for scenarios |
| **Public / anonymous form** | `src/views/*.view.ts` (formView with `sharing.allowAnonymous: true`) | Web-to-Lead / Web-to-Case. Auto-exposed at `GET/POST /api/v1/forms/:slug`. See `guides/public-forms.mdx` |
| App navigation | `src/apps/*.app.ts` | Use grouped nav trees, `viewName` shortcuts, and `requiresObject` for capability-aware visibility |
| Dashboards | `src/dashboards/*.dashboard.ts` | Combine KPI + chart + table widgets with shared `dateRange` and `globalFilters` |
| Reports | `src/reports/*.report.ts` | Prefer `groupingsDown` + `groupingsAcross` + `dateGranularity` for matrix/summary analytics |
| Record pages | `src/pages/*.page.ts` | Compose `regions` + components (`page:header`, `record:highlights`, related lists, tabs) |
| User actions | `src/actions/*.actions.ts` | Use `flow` for orchestration and `modal` for parameterized bulk mutations |

This blueprint is the default for “build a complete metadata app UI” tasks.

---

## Dashboards (cont.) — KPI Widgets, Filters, Drilldown

Dashboards (`Dashboard`) are first-class metadata. Beyond the basic widget
layout shown above, the production-grade pattern uses:

```typescript
import type { Dashboard } from '@objectstack/spec/ui';

export const SalesDashboard: Dashboard = {
  name: 'sales_dashboard',
  label: 'Sales Performance',
  columns: 12,
  gap: 4,
  refreshInterval: 180,                    // seconds; auto-refresh

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

  widgets: [
    {
      id: 'total_pipeline_value', type: 'metric',
      title: 'Total Pipeline',
      object: 'opportunity',
      filter: { stage: { $nin: ['closed_won', 'closed_lost'] } },
      valueField: 'amount', aggregate: 'sum',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: { icon: 'DollarSign', format: '0,0' },
      // Period-over-period: renderer fetches the prior quarter and
      // surfaces a secondary value + delta arrow automatically.
      compareTo: 'previousPeriod',
      actionType: 'url', actionUrl: '/objects/opportunity?filter=open',
    },

    // Chart widget with comparison overlay (M2). The renderer issues a
    // second query with the time window shifted by `compareTo` and
    // overlays it as a muted/dashed series.
    {
      id: 'revenue_vs_last_year', type: 'line',
      title: 'Revenue — This Year vs Last',
      object: 'order',
      filter: { closed_at: { $gte: '{current_year_start}', $lte: '{current_year_end}' } },
      categoryField: 'closed_at', valueField: 'total', aggregate: 'sum',
      compareTo: 'previousYear',
      layout: { x: 3, y: 0, w: 9, h: 4 },
    },
  ],
};
```

> **Tokens in filters:** `{current_quarter_start}`, `{current_user.id}` are
> resolved at request time. Avoid baking absolute dates into definitions.
> The full list of supported date placeholders is documented in
> [Date Macros](#date-macros--filter-placeholders) below.

### Period-over-period — `compareTo`

Set `compareTo` on any data-bound widget to add a second query against a
shifted time window. The renderer derives the comparison automatically;
no second `filter` is required.

| Value | Behaviour |
|:--|:--|
| `'previousPeriod'` | Inspect the widget `filter` for date-macro tokens (`{current_month_start}`, `{last_7_days}`, …) and shift the window back by one period of the same kind. |
| `'previousYear'`   | Shift the resolved filter window back by one calendar year. |
| `{ offset: '7d' }` | Shift by an explicit duration. Units: `d` (days), `w` (weeks), `M` (months), `y` (years). |

* **Metric widgets** — the prior-period value renders as a small caption
  beneath the headline number, alongside a green/red delta arrow and an
  i18n trend label resolved from the comparison kind (e.g. `vs previous
  period`, `vs previous year`, `vs previous 7d`). Authors should *not*
  hand-author `options.trend` when `compareTo` is set; the renderer wins
  and overwrites it.
* **Cartesian charts** (`line` / `area` / `bar` / `horizontal-bar` /
  `scatter`) — the comparison series is appended after the primary series
  with `variant: 'comparison'` and styled as a muted overlay (`opacity: 0.5`
  + `strokeDasharray: '4 4'` for line/area/scatter; `opacity: 0.4` for
  bars). Override per-series with `series.dashArray` / `series.opacity`.
* **Pie / donut / funnel** — `compareTo` is silently ignored; there is no
  meaningful "two-period" composition for part-of-whole charts.
* **Requirements** — `compareTo` is a no-op when the filter contains no
  resolvable date macros and no global `dateRange` is configured. The
  shifted query reuses the original `filter` shape and replaces only the
  date-bound clauses.

```typescript
// Metric — WoW delta
{ id: 'done_this_week', type: 'metric', object: 'task',
  filter: { assignee: '{current_user_id}', status: 'done',
            completed_at: { $gte: '{week_start}' } },
  aggregate: 'count',
  compareTo: 'previousPeriod' }

// Bar — YoY overlay on a stable category set
{ id: 'headcount_by_dept', type: 'bar', object: 'employee',
  filter: { status: { $ne: 'terminated' } },
  aggregate: 'count', categoryField: 'department',
  compareTo: 'previousYear' }
```

### Server-side date bucketing — `categoryGranularity`

For any chart with `categoryField` pointing at a date/datetime field, set
`categoryGranularity` to bucket values server-side. Without it every
distinct timestamp becomes its own category, which collapses a 12-row
seed dataset into a 12-point flat-line chart.

| Value | Bucket key |
|:--|:--|
| `'day'` | Calendar day (`YYYY-MM-DD`) |
| `'week'` | ISO week (`YYYY-Www`) |
| `'month'` | Calendar month (`YYYY-MM`) |
| `'quarter'` | Calendar quarter (`YYYY-Qn`) |
| `'year'` | Calendar year (`YYYY`) |

* **Engine support** — Postgres `date_trunc`, MySQL `date_format`, SQLite
  `strftime`, MongoDB `$dateTrunc`, in-memory `bucketDateValue` fallback.
  All emitted by the analytics service, not the client.
* **Rule of thumb** — `day` for ≤30d windows, `week` for ~90d, `month`
  for 6–12 months, `quarter` for multi-year, `year` for retention /
  compliance scopes.
* **Combines with `compareTo`** — the comparison query is issued with the
  same granularity, so the muted overlay aligns bucket-for-bucket.
* **xAxis format** — pair with a matching `chartConfig.xAxis.format`
  (`%b %d` for day, `%b %Y` for month, etc.) so the rendered labels
  match the bucket grain.

```typescript
// Line chart — monthly trend with YoY overlay
{ id: 'signed_by_month', type: 'line', object: 'contract',
  filter: { signed_date: { $gte: '{12_months_ago}' } },
  aggregate: 'count',
  categoryField: 'signed_date',
  categoryGranularity: 'month',
  compareTo: 'previousYear',
  chartConfig: {
    type: 'line',
    xAxis: { field: 'signed_date', format: '%b %Y' },
    yAxis: [{ field: 'value', format: '0,0' }],
  },
}
```

---

## Date Macros — Filter Placeholders

Dashboards, reports, list-view filters, and other UI metadata can embed
relative-date placeholders that are resolved on the client just before
the request leaves the browser. The canonical contract is published as
[`DATE_MACRO_TOKENS`](../../packages/spec/src/data/date-macros.zod.ts) in
`@objectstack/spec`; the resolver lives in `@object-ui/core`
(`resolveDateMacros`). Keep the two in lockstep.

Both `{token}` and `${token}` forms are accepted.

### Fixed tokens (36)

| Category | Tokens |
|:--|:--|
| Instants | `today`, `yesterday`, `tomorrow`, `now` |
| Current period | `current_week_start` / `_end`, `current_month_start` / `_end`, `current_quarter_start` / `_end`, `current_year_start` / `_end` |
| Last period | `last_week_start` / `_end`, `last_month_start` / `_end`, `last_quarter_start` / `_end`, `last_year_start` / `_end` |
| Next period | `next_week_start`, `next_month_start`, `next_quarter_start`, `next_year_start` |
| Bare aliases | `week_start`, `week_end`, `month_start`, `month_end`, `quarter_start`, `quarter_end`, `year_start`, `year_end` (same as `current_*`) |

### Parameterised tokens — `{N_<unit>_(ago|from_now)}`

`N` is any positive integer; `<unit>` is one of
`minute(s) | hour(s) | day(s) | week(s) | month(s) | year(s)`.
`minute`/`hour` resolve to a full ISO timestamp; coarser units resolve to
`YYYY-MM-DD`.

```
{30_days_ago}       {7_days_from_now}     {1_day_ago}
{2_weeks_ago}       {6_months_from_now}   {1_year_ago}
{15_minutes_ago}    {2_hours_from_now}
```

### DO / DON'T

* **DO** type-check tokens against the spec — `isDateMacroToken(tok)` from
  `@objectstack/spec` returns `false` for anything unsupported.
* **DO** prefer `Field.datetime()` for "near-now" filters (minute/hour
  precision); driver-sql automatically coerces ISO macros to the stored
  ms-epoch representation.
* **DON'T** invent tokens. Unknown placeholders silently pass through as
  literal strings — the resulting SQL compares text against
  `'{my_made_up_token}'` and matches zero rows.
* **DON'T** combine multiple tokens inside one value without resolution
  semantics (`'{today}-{tomorrow}'` is fine; `{today_or_tomorrow}` is
  not — there is no such token).

---

## Analytics Cubes — Semantic Layer

`Cube` definitions sit between objects and dashboards/reports — they expose
named **measures** (aggregates) and **dimensions** (groupings) that BI
widgets can compose without hand-rolling each query. Register under
`defineStack({ analyticsCubes: [...] })`.

```typescript
import type { Cube } from '@objectstack/spec/data';

export const opportunityCube: Cube = {
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
};
```

### Cube Best Practices

1. **`sql` = object name** (e.g. `'opportunity'`). The ObjectQL strategy
   reads it via `cube.sql.trim()` — do **not** put raw SQL there.
2. **Use dotted lookups** in `dimensions[*].sql` (`'account.industry'`) to
   reach across relations — the engine auto-joins.
3. **Always declare `granularities`** on `time` dimensions so dashboards can
   bucket by day / month / quarter without ad-hoc queries.
4. **Keep `public: true`** for any cube referenced by a dashboard widget; an
   internal-only cube should be `public: false`.
5. One cube per object usually beats omnibus cubes — composability stays high.

---

## Actions

Actions are user-triggered operations attached to an object or a view.
Register them under `defineStack({ actions: [...] })`.

### Action Types

| `type`   | Purpose                                                            | Required field |
|:---------|:-------------------------------------------------------------------|:---------------|
| `script` | Run an inline L2 hook body (sandboxed JS) on the server            | `body`         |
| `url`    | Navigate to an internal route or external URL                      | `target`       |
| `modal`  | Open a dialog, collect `params`, then execute `body`               | `target`, `params`, `body` |
| `flow`   | Launch a screen/auto-launched flow by name                         | `target`       |
| `api`    | Call a registered API endpoint                                     | `target`       |

### Where Actions Appear (`locations`)

`locations` is an array — an action can live in multiple surfaces:

| Value            | Surface |
|:-----------------|:--------|
| `record_header`  | Detail page header (single record) |
| `record_more`    | Detail page overflow menu |
| `list_item`      | Per-row action in list views |
| `list_toolbar`   | Bulk action on selected rows (`input.selectedIds`) |
| `global`         | Global action launcher (utility bar) |

### Visibility & Confirmation

Use `visible` (CEL predicate, prefer the `P\`...\`` tagged template) to
gate the action against the current record. Set `confirmText` for any
destructive or irreversible operation.

### Examples

**Flow-typed action** (delegates to a screen flow):

```typescript
import type { Action } from '@objectstack/spec/ui';
import { P } from '@objectstack/spec';

export const ConvertLeadAction: Action = {
  name: 'convert_lead',
  label: 'Convert Lead',
  objectName: 'lead',
  icon: 'arrow-right-circle',
  type: 'flow',
  target: 'lead_conversion',                // name of the flow
  locations: ['record_header', 'list_item'],
  visible: P`record.status == "qualified" && record.is_converted == false`,
  confirmText: 'Are you sure you want to convert this lead?',
  successMessage: 'Lead converted successfully!',
  refreshAfter: true,
};
```

**Modal-typed action** (collect params, then execute server body):

```typescript
export const AddToCampaignAction: Action = {
  name: 'create_campaign',
  label: 'Add to Campaign',
  objectName: 'lead',
  icon: 'send',
  type: 'modal',
  target: 'create_campaign',
  locations: ['list_toolbar'],
  params: [
    // Field-backed params resolve label/type/options from object metadata:
    { field: 'campaign_id', objectOverride: 'campaign', required: true },
  ],
  body: {
    language: 'js',
    source: `
      const campaignId = input.campaign_id;
      const ids = Array.isArray(input.selectedIds) ? input.selectedIds : [];
      for (const leadId of ids) {
        await ctx.api.object('campaign_member').insert({
          campaign_id: campaignId, lead_id: leadId, status: 'sent',
        });
      }
      return { count: ids.length };
    `,
    capabilities: ['api.write'],
    timeoutMs: 10000,
  },
  successMessage: 'Leads added to campaign!',
  refreshAfter: true,
};
```

### Action Parameter Patterns

Prefer **field-backed** params (`{ field: 'email' }`) over inline declarations
— the runtime resolves label (i18n), type, validation, options, placeholder,
and widget mapping from object metadata. Use `objectOverride` to reference a
field from a different object. Set `defaultFromRow: true` to pre-fill from
the selected row in `list_item` contexts.

> **Best practices:**
> - Always add `confirmText` for destructive actions.
> - Use `visible` (CEL) so buttons appear only when actionable.
> - Set `refreshAfter: true` whenever the action mutates the current record.
> - For bulk actions, read `input.selectedIds` inside `body.source`.

---

## Common Pitfalls

1. **Using `provider: 'api'` when `provider: 'object'` is available.**
   Object provider gives you free filtering, sorting, pagination, and
   real-time updates.

2. **Putting too many columns in a grid view.**
   Users rarely need more than 6–8 columns visible by default. Use `hidden`
   for secondary columns.

3. **Forgetting `link: true` on the primary column.**
   The first meaningful column (usually the name/subject) should be the
   navigation link to the record detail.

4. **Not setting quick filters.**
   Quick filters dramatically improve usability. Always add at least a
   "My Records" filter using `$currentUser`.

5. **Dashboard widgets without position.**
   Every widget needs `position: { x, y, w, h }` on the grid. Plan the
   layout on paper first.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

