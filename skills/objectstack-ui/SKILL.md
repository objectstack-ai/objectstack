---
name: objectstack-ui
description: >
  Author ObjectStack UI metadata — Views (list/form/kanban/calendar/gantt),
  Apps (navigation), Pages (structured plus the HTML and React source-authoring
  tiers, ADR-0080/0081), Dashboards, Reports, Charts, Actions, and
  package Docs (`src/docs/*.md`). Use when
  the user is adding `*.view.ts` / `*.page.ts` / `*.app.ts` /
  `*.dashboard.ts` / `*.report.ts` / `*.dataset.ts` / `*.action.ts` /
  `src/docs/*.md` files or designing a Studio-rendered UI surface.
  Do not use for: data schema (see objectstack-data), multi-step flows that
  BRANCH on logic between steps (those are `*.flow.ts` with `type: 'screen'` —
  see objectstack-automation; a stepped form over ONE object is this skill's
  `formViews` `type: 'wizard'`), or Studio's own admin UI (that
  ships with the platform). CEL expressions in
  visibility/conditional rules: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: ui
  tags: view, app, page, dashboard, report, chart, action, widget, doc
---

# UI Design — ObjectStack UI Protocol

Expert instructions for designing user interfaces using the ObjectStack
specification. This skill covers Views (list, form, kanban, calendar, …),
App navigation, Dashboards, Reports, and Actions.

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
| `chart` | Aggregate visualisation over the object (mini chart view) |
| `tree` | Self-referencing hierarchy (tree-grid) |
| `page` | Mounts a published Page (`pageName`); no rows of its own |

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
   DATA MODEL — set `inlineEdit` on the child's `master_detail` field that
   references the parent. Every standard New/Edit form for the parent (modal,
   drawer, full-page) then auto-renders the children and saves parent + children
   in one atomic `/api/v1/batch`. **No view metadata needed.** The
   `true` / `'grid'` / `'form'` ladder and what each value picks:
   **objectstack-data → Relationships → Inline Editing**.

2. **Form view `subforms` (override / tuning).** Add to a form view only when you
   need to override the derived columns/order, or expose a child the
   relationship didn't mark inline:

   ```typescript
   formViews: {
     default: {
       type: 'simple',
       sections: [{ group: 'invoice_header' }],  // a declared fieldGroup
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

**Line-item grid behaviors (`grid` mode).** The editable grid is a real
spreadsheet-style line editor (the QuickBooks / Stripe / NetSuite pattern), and
every behaviour is derived from the DATA MODEL — computed columns, catalog
typeahead auto-fill, persisted drag-reorder, and the live Subtotal → Tax → Total
stack: **objectstack-data → Relationships → Inline Editing**. Three things are
authored on this side: a trailing **ghost** row always exists, so never add an
"Add line" button (typing in the ghost materialises a row; an untouched one is
never persisted); `autofill: false` opts one column out of the typeahead copy;
and the form's `taxRateField` overrides which parent field drives the totals.

**Read side — detail-page related lists.** The mirror of `inlineEdit` is the
related list on the parent's record DETAIL page. You don't author it: every
child relationship is shown as a related list by default (owned `master_detail`
children first). Refine on the relationship:
- `relatedList: 'primary'` — mark a CORE relationship; the detail page promotes
  it to its **own tab** (see layout below). A *prominence* intent, not a layout
  switch (ADR-0085).
- `relatedList: false` — suppress a noisy child from the detail page.
- `relatedListTitle` / `relatedListColumns` — override the derived title /
  columns (both optional; columns otherwise auto-derive from the child object's
  `highlightFields`). See objectstack-data → Relationships → Detail-page related lists.

**Related-list layout.** On the synthesized record detail page, each
`relatedList: 'primary'` child gets its **own tab**; every other related list
stacks under a single shared **Related** tab. Promoting a child table to a
first-class tab is therefore a one-word change on the relationship — no custom
page needed. The object still declares no per-surface *layout* hints: the old
`detail.relatedLayout` toggle and object-level `detail: {...}` block stay
**removed** (ADR-0085); `relatedLayout: 'tabs' | 'stack'` survives only as an
app-level default override, not an object key. For arrangements the
relationship layer can't express — filtered splits (e.g. Open vs Closed tabs), a
chart/report tab, exact tab ordering — assign the object a **custom record
Page** and lay it out explicitly with `record:related_list` (or inline-editable
`line_items`) blocks.

### Field Conditional Rules in Forms

Conditions that belong to a field's lifecycle — `visibleWhen`, `readonlyWhen`,
`requiredWhen` — are declared on the **DATA MODEL field**, not in the form view;
ObjectUI forms consume them. Their semantics and server behaviour:
**objectstack-data → Conditional Field Rules**.

UI-side: inline master-detail grids evaluate these rules **row-by-row** against
each child row. Use `requiredWhen` — the `conditionalRequired` alias was REMOVED
in protocol 17 and is now a parse error. Load **objectstack-formula** when
authoring non-trivial CEL.

---

## Configuring a List View

### The `defineView` container (`*.view.ts` file shape)

Views ship **inside a `defineView` container** — one per object, aggregating
the default `list`, named `listViews`, and `formViews`. The loader expands it
into `<object>.<key>` view items that power the view switcher.

<!-- os:check -->
```typescript
import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'support_case' };

export const CaseViews = defineView({
  list: { label: 'All Cases', type: 'grid', data, columns: ['subject', 'status'] },
  listViews: {
    open: { label: 'Open', type: 'grid', data, columns: ['subject', 'status'],
            filter: [{ field: 'status', operator: 'equals', value: 'open' }] },
  },
  formViews: {
    edit: { type: 'simple', data, sections: [{ group: 'case_detail' }] },
  },
});
```

> **Never export a bare flat view object** (`{ name, label, type, columns }`
> at top level). It is not a valid view container — nothing registers and no
> view appears in the switcher. Every view lives under `list` / `listViews` /
> `formViews`, exactly as in the `defineView` example above.

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
    summary: 'min',       // footer aggregation — plain enum value, not an object
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

### End-User Quick Filters (`userFilters`, ADR-0047)

`filter` is the always-on base criteria. For the *end-user-facing* filter bar
(Airtable "User filters") use `userFilters` — dropdowns, filter tabs, or
toggles the user combines at runtime:

```typescript
userFilters: {
  element: 'dropdown',              // 'dropdown' | 'tabs' | 'toggle'
  fields: [
    { field: 'status' },            // options/labels inferred from field def
    { field: 'priority', showCount: true },
  ],
},

// In-view filter tabs (presets on top of the base filter):
tabs: [
  { name: 'all', label: 'All', isDefault: true },
  { name: 'urgent', label: 'Urgent', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
],

// Runtime visualization whitelist (Airtable "Appearance → Visualizations"):
appearance: { allowedVisualizations: ['grid', 'kanban', 'gallery'] },
```

Rules:
- Every `field` MUST exist on the source object — reference diagnostics
  (`_diagnostics`) flag unknown fields; treat `valid: false` as a failed write.
- **Tabs XOR dropdowns — never both on one view.** The toolbar renders ONE
  filter element style (Airtable's Elements choice). If a view configures
  both `tabs` and `userFilters`, tabs win and the dropdowns never render.
  Want both demos? Put them on different views.
- **On an object list view (`*.view.ts` `list` / `listViews`), only
  `element: 'dropdown'` (value chips) is allowed — `tabs` is page-only**
  (ADR-0047 amendment). An object view's saved-view `ViewTabBar` already owns
  the tab-bar role, so a `tabs` user-filter would render a second, colliding
  tab bar. The spec narrows it (`ObjectUserFiltersSchema` — a `tabs` element is
  untypable at author time and **rejected** at parse, not dropped) and the
  `validate` list-view-mode lint reports it.
  Need named presets on an object? Add a `listViews` entry instead. The full
  `dropdown | tabs | toggle` range applies only to **page lists** /
  `interfaceConfig.userFilters` (the block above).
- **Omit `userFilters` when unsure — omission means a clean toolbar.** Filter
  elements render only when explicitly configured; nothing is auto-derived.
  In data mode the saved-views switcher already covers the preset use case,
  so most views need no filter elements at all.
- `userFilters: { element: 'dropdown' }` (no `fields`) is valid shorthand:
  the renderer fills the field list from the object's select/boolean fields.
- `element` is `dropdown` or `tabs`; `toggle` is **deprecated** (ADR-0047 §3.4a)
  — it stays in the enum for back-compat rendering, but author `dropdown`/`tabs`.
- The visualization switcher renders as a compact dropdown in the toolbar's
  right cluster. Authors only control the `allowedVisualizations` whitelist;
  a single-entry whitelist locks the visualization (no switcher).

### Toolbar Search (`searchableFields`, ADR-0061)

The toolbar's search box scans a set the **object** owns. A list view's
`searchableFields` **narrows** that set for this one list — it can never widen
it, and the runtime enforces that by **refusing the request**, not by quietly
dropping the extra name.

<!-- os:check -->
```typescript
import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'support_case' };

export const CaseViews = defineView({
  // No `searchableFields` → the toolbar searches everything the object allows.
  list: { label: 'All Cases', type: 'grid', data, columns: ['subject', 'status'] },
  listViews: {
    // This list only: search the reference number and the subject line.
    triage: {
      label: 'Triage', type: 'grid', data,
      columns: ['case_number', 'subject', 'status'],
      searchableFields: ['case_number', 'subject'],
    },
  },
});
```

**What the object allows** is resolved server-side, and it is the whole rule:

| The object … | The allowed set is |
|:-------------|:-------------------|
| declares `searchableFields` | **that list, verbatim** — whatever the field types are |
| declares nothing | the auto-default: the name field + the text-like columns (`text` / `email` / `phone` / `url` / `autonumber` / `textarea` / `markdown` / `select` / `status`) |

Field **type** therefore decides only in the second row: where the object
declares the set, a lookup in it is scanned and a `text` column outside it is
refused. Judge every entry against the object's allowed set, never the type
list. Modelling side: **objectstack-data → Search Fields**. Query side
(`search.fields` over the API): **objectstack-query → Full-Text Search**.

#### ⛔ One bad entry 400s EVERY search on that list

The client echoes this declaration verbatim as the `$searchFields` override —
the active view's list wins over the object's — and the ingress gate refuses any
entry outside the allowed set before the engine ever runs. The blast radius is
the list's whole search box, for every user and every term: not a narrower
result, no result at all.

| What you write on the view | `os validate` | Toolbar search at runtime |
|:---------------------------|:--------------|:--------------------------|
| a subset of the allowed set | clean | scans exactly those columns |
| key omitted | clean | scans the object's full allowed set |
| `searchableFields: []` | clean | **identical to omitting it** — empty is *absent* at all three layers, so it scans MORE than `["subject"]` would |
| a renamed / mistyped column | `searchable-field-unknown` | `400 INVALID_FIELD` |
| a dotted path (`account_id.name`) | `searchable-field-unknown` | `400 INVALID_FIELD` |
| a real column outside the allowed set | `searchable-field-unsearchable` | `400 INVALID_FIELD` |
| a virtual `formula` column — nothing stored to scan | `searchable-field-unsearchable` | `400 INVALID_FIELD` |

Both diagnostics are **errors**, not warnings — `os validate` fails the build.

To remove the search box, toggle the affordance — a different key, same view:

<!-- os:check -->
```typescript
import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'support_case' };

export const AuditViews = defineView({
  list: {
    label: 'Audit Log', type: 'grid', data,
    columns: ['case_number', 'status'],
    userActions: { search: false },   // ← no search box; `searchableFields: []` would NOT do this
  },
});
```

**Searching by a related record's title:** never reach for a dotted path. The
search axis resolves no traversal, so `account_id.name` is refused rather than
silently dropped. Mirror the parent's title into a **stored** field on this
object and narrow to that. The prescription — the mirror field, the two hooks
that maintain it, and why a `formula` field cannot be the mirror — lives in
**objectstack-data → Search Fields (`searchableFields`)**.

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

Board settings nest under `kanban:` (`KanbanConfigSchema`) — there is **no
top-level `groupBy`**. The top-level `columns` is required on every list view
(including kanban), while `kanban.columns` picks the fields shown on each card.

```typescript
{
  type: 'kanban',
  data: { provider: 'object', object: 'project_task' },
  columns: ['title', 'assignee', 'priority'],       // required on every list view
  kanban: {
    groupByField: 'status',                // one board column per select option
    summarizeField: 'estimate_hours',      // optional — summed at the top of each column
    columns: ['title', 'assignee', 'priority'],   // fields shown on each card
  },
  sort: 'priority desc',
}
```

> **Key rule:** `kanban.groupByField` should be a `select` type with
> well-defined options. Each option becomes a column on the board.

---

## Configuring Gantt Views

Timeline settings nest under `gantt:` (`GanttConfigSchema`);
`startDateField` / `endDateField` / `titleField` are required in it.

```typescript
{
  type: 'gantt',
  data: { provider: 'object', object: 'project_task' },
  columns: ['name', 'assigned_to', 'status'],   // left-pane tree columns
  gantt: {
    startDateField: 'start_date',               // task bar start
    endDateField: 'end_date',                   // task bar end
    titleField: 'name',                         // bar label
    progressField: 'progress',                  // 0–100 fill
    dependenciesField: 'depends_on',            // FS dependency arrows
    parentField: 'parent',                      // builds the summary-bar tree
  },
}
```

Rows with children (or `type: 'summary'`) render as **summary bars** — they
move the whole group on drag and have **no resize handles**. Leaf tasks resize
freely unless `locked: true`.

---

## App Navigation

An **App** groups objects, dashboards, reports, and custom pages into a
structured navigation tree. Build with `App.create({...})` from
`@objectstack/spec/ui` and register under `defineStack({ apps: [...] })`.

<!-- os:check -->
```typescript
import { App } from '@objectstack/spec/ui';

export const CrmApp = App.create({
  name: 'crm_enterprise',
  label: 'Enterprise CRM',
  icon: 'briefcase',
  // defaultAgent: 'build',                // ADR-0063 §2 — the resolvable set is exactly two
                                           // platform agents: `ask` (data surface) / `build`
                                           // (authoring, e.g. Studio). Any other name parses
                                           // but binds nothing at chat time. A data app like
                                           // this one omits the key — `ask` is the default.
  // hidden: true,                         // ADR-0045 — drop from the App Switcher but keep
                                           // routable & permission-checked; the shell surfaces
                                           // hidden apps (e.g. `account`) via the avatar menu.
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
        // One-off parameterized slice — lands on the bare data surface
        // (`/:objectName/data`, objectui ADR-0055) with removable URL filter
        // chips, NOT anchored to a saved view. Don't author a view for these:
        { id: 'nav_my_open',     type: 'object', objectName: 'opportunity', filters: { owner_id: '{current_user_id}', status: 'open' }, label: 'My Open Deals', icon: 'user-check' },
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
| `object`    | `objectName`, `viewName?`, `recordId?`, `filters?`, `label`, `icon` | Link to an object list, a named view, a record deep-link, or a `filters` slice on the bare data surface. Target precedence: `recordId` → `filters` → `viewName` |
| `dashboard` | `dashboardName`, `label`, `icon`              | Link to a dashboard |
| `report`    | `reportName`, `label`, `icon`                 | Link to a report |
| `page`      | `pageName`, `label`, `icon`                   | Link to a custom Page (`type: 'home' | 'list' | ...`) |
| `url`       | `url`, `label`, `icon`                        | External or custom URL |
| `action`    | `actionDef` (`{ actionName, params? }`), `label`, `icon` | Run an action instead of navigating |
| `component` | `componentRef`, `params?`, `label`, `icon`    | Built-in platform component; `componentRef` is a colon-joined registry key (`metadata:resource`), `params` become props |
| `separator` | —                                             | Visual separator |

> **`requiresObject` / `requiresService`:** Use these on any item that
> depends on an optional system object or kernel service so the nav item is
> automatically hidden when missing — never hard-code conditional UI.

---

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

See the **Production Pattern** section below for the full
`Dashboard` shape with `refreshInterval`, header actions, date range,
global filters, widget options, and the period-over-period (`compareTo`)
modifier; date bucketing comes from the bound dataset dimension's
`dateGranularity` (ADR-0021).

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

---

## Report Types

| Type | When to Use |
|:-----|:------------|
| `tabular` | Flat data table with columns and filters |
| `summary` | Grouped data with subtotals (e.g., revenue by region) |
| `matrix` | Cross-tab / pivot table (`rows` down × `columns` across) |
| `joined` | Multi-block analytic surface (combines several sub-reports) |

There is no `chart` report type — a report *visualizes* via its embedded
`chart:` config (see the example below).

### Report Configuration

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

## Three Run Modes: Object Nav vs Filters Slice vs Interface Pages (ADR-0047 / objectui ADR-0055)

Object list UI has **three run modes**, selected by the navigation item shape:

| | Data mode (`type: 'object'`) | Bare slice (`type: 'object'` + `filters`) | Interface mode (`type: 'page'`) |
|:--|:--|:--|:--|
| What renders | ALL list views as switcher tabs | The URL-defined slice, no saved-view tabs | One curated page with its own list definition |
| Anchored to | Saved views | **The URL itself** (`/:objectName/data?filter[...]`) | Page config |
| User-created views | Allowed | "Save as view" exit only | Never |
| Quick filters | Auto-derived (or view `userFilters` — `dropdown` only) | Auto-derived + removable URL chips | Only what the author enabled |
| Visualization | Switchable (whitelist) | Switchable (URL filter state survives) | Locked unless whitelisted |

**Decision rule — default to data mode.** Generate ONLY objects + list views +
navigation pointing at objects. Escalate only on explicit signals:

- **`filters` slice** — the entry is a one-off / parameterized condition
  (dashboard drill-through, "assigned to me" link, a shared URL). Don't
  author a view for it; a slice graduates to a named view only when it is
  curated and reused. Values support `{current_user_id}` / `{current_org_id}`.
  Never treat it as security: the surface shows what row-level permissions
  allow. (Canonical rules: objectui ADR-0055, "parameterized bare data
  surface".)
- **Interface page** — persona split ("sales reps see…", customer portal,
  给业务部门的简化界面); capability narrowing ("users must not change views",
  "only filter by X"); curation language (workspace / 工作台 / "Airtable
  interface-like").

Ambiguity resolves to **no page and no view** — data mode is a functional
superset; a missing page costs polish, a superfluous page (or a view authored
for a one-off slice) is a permanently-maintained duplicate asset.

> One-sentence rule: prefer the object's default view over a pinned
> `viewName`; prefer URL `filters` over authoring a view for one-off slices;
> prefer a named view over a page; use a page only for composition a single
> object view cannot express. Every target appears exactly once.

**The iron rule (revised):** an interface page **IS the view definition**. It
binds an object (`interfaceConfig.source`) and carries its **own** `columns` /
`sort` / `filterBy` directly (Airtable parity — there is no "inherit from a
named view" concept), plus presentation policy (`userFilters`,
`appearance.allowedVisualizations`, `userActions`). The old
`sourceView` ("inherit from a named object view") is **deprecated** legacy: it
is still honored at runtime as a fallback when the page defines no `columns` of
its own, but new pages define `columns`/`sort`/`filterBy` on the page.

<!-- os:check -->
```typescript
import { definePage } from '@objectstack/spec/ui';

export const TaskWorkbenchPage = definePage({
  name: 'task_workbench',
  label: 'Task Workbench',
  type: 'list',
  object: 'task',
  interfaceConfig: {
    source: 'task',
    columns: ['subject', 'status', 'due_date'],  // the page IS the view definition
    sort: [{ field: 'due_date', order: 'asc' }],
    filterBy: [{ field: 'status', operator: 'not_equals', value: 'done' }],
    userFilters: { element: 'dropdown', fields: [{ field: 'status' }] },
    appearance: { allowedVisualizations: ['grid'] },  // locked
    userActions: { sort: true, search: true, filter: false },
  },
});
```

---

## Record Presentation — surface, width & columns are auto-derived

A record's create / edit / detail **presents itself adaptively**. You do **not**
author the surface, the overlay width, or the column count — all three are derived
at runtime from how heavy the record is + the client viewport, because an author
(especially an AI) cannot know the client's screen. **Write the data (fields,
`fieldGroups`); let the platform lay it out.**

- **Surface (page vs drawer).** Derived from field count: a field-heavy object
  opens create/edit/detail as a **full page**; a light one as a **drawer**. Mobile
  always pages. Don't set it. To force it for a specific object, set
  `navigation.mode` (`page` | `drawer` | `modal`) on the list view (or object) — or,
  for bespoke layout, assign a record `Page` (below).
- **Field width.** Use the relative **`span: 'full'`** to make a field take the
  whole row; otherwise **omit it** (`auto` sizes by widget type × current columns —
  textarea / rich-text / file take the row automatically). Do **not** use the
  absolute `colSpan` — it only lines up at one width and is deprecated.
- **Overlay width.** Never author pixels. If you must nudge, use the **`size`**
  bucket (`sm` | `md` | `lg` | `xl` | `full`) on `navigation`; the pixel
  `width` / `drawerWidth` are deprecated (they can't be chosen without knowing the
  client viewport).
- **Column count.** Not authored. The form grid follows its **real rendered width**
  via container queries — the same form is 1 column in a narrow drawer and up to 4
  on a wide page. Author *grouping* with `fieldGroups` + `Field.group`; the columns
  adapt themselves.
- **`sections` are the escape hatch — reach for them last.** The ladder, in
  order: (1) **derive** — declare `fieldGroups` + `Field.group` and author no
  `sections` at all; (2) **reference** — when one surface needs a local
  arrangement, a section may name a declared group, `{ group: 'contact_info' }`,
  and inherits its members, label and presentation (restating a key the group
  declares is refused at parse); (3) **enumerate** — `{ label, fields: [...] }`
  only for a named-customer requirement a group reference genuinely cannot
  express (a cross-group entry combination, a wizard/pane structure), with that
  reason in a comment beside it. A hand-enumerated section re-copies membership
  the object already owns and goes stale on the next field added, so rung 3 is
  an exception, never a default.

> **Rule of thumb: presentation (surface / width / columns) is not metadata.**
> Write fields + semantic roles; the renderer decides the pixels. Reach for
> `navigation.mode` / `size` / a `Page` only to *override* — never as the default.

---

## Pages — Lightning-Style Page Layouts

A **Page** is a Salesforce-Lightning-style layout composed of **regions**
populated with **components**. Pages let designers assemble record details,
home pages, app launchers, and utility bars without writing React.

Register under `defineStack({ pages: [...] })`.

### Page Types

`PageTypeSchema` has exactly **five** values — only types with a dedicated
renderer are authorizable (ADR-0049 enforce-or-remove):

| `type`    | Purpose |
|:----------|:--------|
| `record`  | Component-based record layout with regions (overrides the default record detail) |
| `home`    | App home / landing page |
| `app`     | App-level page with navigation context |
| `utility` | Floating utility panel (e.g. notes, phone dialer) |
| `list`    | Record list/grid interface page — configured via `interfaceConfig` (see the iron rule above) |

Disambiguation: there is **no** `record_detail`, `app_launcher`, or
`utility_bar` type — a record layout is `type: 'record'`, an app-level page is
`type: 'app'`, a utility panel is `type: 'utility'`. Likewise
grid/kanban/calendar/gallery/timeline are NOT page types — they are
*visualizations* of a `list` page
(`interfaceConfig.appearance.allowedVisualizations`). Former roadmap-only types
(`dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`)
were removed from the enum because they never shipped a renderer.

### Templates & Regions

`template` controls the column layout (e.g. `'three-column'`,
`'two-column'`, `'single-column'`). Each template exposes named
**regions** (`header`, `left_sidebar`, `main`, `right_sidebar`, `footer`)
which contain components.

### Component Catalogue (selection)

| `type`               | Use |
|:---------------------|:----|
| `page:header`        | Title + subtitle + breadcrumb + inline `actions: Action[]` |
| `page:card`          | Bordered/un-bordered card with `children: Component[]` (plus an optional `footer: Component[]` slot) |
| `flex`               | Generic styleable box (`properties.children`) — the workhorse for custom layout; style via `responsiveStyles` (see Styling below) |
| `element:text`       | Text node — `properties.content`; style via `responsiveStyles` |
| `element:button`     | Button — `properties.label` + `variant`/`size` + optional `action` |
| `record:highlights`  | Salesforce highlights panel — strip of key fields |
| `record:path`        | Stage progress bar driven by a status field |
| `record:related_list` | Related-list (child records via lookup) |
| `nav:menu`           | Quick-create / nav menu bound to current context |
| `object-metric`      | Single KPI widget (count/sum/avg) |
| `object-chart`       | Embedded chart |

### Example — Record Detail Page

<!-- os:check -->
```typescript
import { defineAction, definePage } from '@objectstack/spec/ui';

// Normally lives in its own `*.action.ts`; inlined so this block stands alone.
const ConvertLeadAction = defineAction({
  name: 'convert_lead', label: 'Convert Lead', objectName: 'lead',
  type: 'flow', target: 'lead_conversion', locations: ['record_header'],
});

export const LeadDetailPage = definePage({
  name: 'lead_detail_page',
  label: 'Lead Detail',
  type: 'record',
  object: 'lead',
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
});
```

> **Variable substitution** — `{first_name}`, `{current_user.first_name}`,
> `{current_quarter_start}` etc. resolve from the page's `variables` block,
> the bound record, and the runtime context. Declare `variables: [...]` at
> the page root for any non-record value. For relative-date placeholders
> (`{today}`, `{30_days_ago}`, `{N_<unit>_(ago|from_now)}` …) see the
> [Date Macros](#date-macros--filter-placeholders) reference below — the
> full token list is published as `DATE_MACRO_TOKENS` in `@objectstack/spec/data`.

> **Actions in header** — pass full `Action` objects into
> `page:header.properties.actions`; do **not** create a sibling action node.
> The header renders them inline in the action slot.

### AI-authored *source* pages — `kind:'html'` and `kind:'react'` (ADR-0080/0081)

Besides the structured `regions` model above, a page's whole body can be written
as a *source string* in `source`, with `kind` choosing the authoring tier. Pick
by what the page needs:

| `kind` | Author writes | JS runs? | Use when |
|:--|:--|:--|:--|
| `full` / `slotted` | structured `regions` / `slots` (no `source`) | — | record/detail/home layouts from the component catalogue |
| `html` | constrained JSX = registered components + safe native HTML, **parsed, never executed** | no | free-form layout / landing / dashboard that just *composes* blocks — no interactivity |
| `react` | **real React** (hooks, `.map`, `onClick`, expressions) | yes (main React tree) | complex interactive business UIs — master/detail, wizards, state-driven filters |

`source` is the source-of-truth in both source tiers; `regions` is ignored. A
`kind:'html'`/`'react'` page with no `source` fails the build (ADR-0078). The legacy
value `kind:'jsx'` is a deprecated alias for `kind:'html'`.

#### `kind:'html'` — constrained JSX, parsed (safe by construction)

Tags are the **registered components** (bare names: `<flex>`, `<grid>`, `<card>`,
`<object-grid>`, `<object-form>`, `<object-metric>`, …) **plus the safe native HTML
set** (`<h1>`–`<h6>`, `<p>`, `<a>`, `<ul>/<ol>/<li>`, `<img>`, `<blockquote>`, `<strong>`,
…). Props come from each component's registry `inputs` (e.g. `<text content=…>`,
`<badge label=…>`). **No JavaScript** — `onClick`, `{expr}` logic and `.map()` are NOT
available; use `kind:'react'` for those. `os build` parses the source and fails loudly
on unknown tags / missing required props / forbidden constructs (event handlers,
`dangerouslySetInnerHTML`).

```typescript
export const ReleaseNotesPage = definePage({
  name: 'release_notes', label: 'Release Notes', type: 'home', kind: 'html',
  source: `
<flex direction="col" gap={6} style={{"maxWidth":"768px","margin":"0 auto","padding":"40px"}}>
  <h1 style={{"fontSize":"32px","fontWeight":700,"color":"hsl(var(--foreground))"}}>Release Notes</h1>
  <object-metric objectName="ticket" aggregate="count" label="Open tickets" />
</flex>`,
});
```

#### `kind:'react'` — real React, executed (trusted tier)

The source is real React executed at render by the runtime. The injected scope are
**closure variables (NOT props)** — reference them directly:

- `React` — hooks (`React.useState`, `React.useEffect`, …)
- `useAdapter()` — live data: `adapter.find('obj', {…})` / `.findOne` / `.create` / `.update`
- the public **data blocks as PascalCase components** — `<ObjectForm>`, `<ListView>`,
  `<ObjectMetric>`, `<ObjectChart>`, `<ObjectKanban>`, … The scope is built at
  runtime from the public block registry (every non-container public block gets a
  PascalCase wrapper), so blocks like `<ObjectMetric>` / `<ObjectKanban>` exist
  even though the written contract below documents only the curated core set;
  `<Block type="…" …/>` is the escape hatch for any other registered type.
  **Exception — the `record:*` family is NOT usable here** (`<RecordDetails>`,
  `<RecordHighlights>`, `<RecordRelatedList>`, `<RecordPath>`, `<RecordActivity>`,
  …): the registry injects a wrapper for each, but every one of them renders from
  the record context a **record page** mounts, which a react page never does — so
  they come back empty however you bind them. `os validate` rejects them here
  (`react-block-needs-record-context`), by tag and via `<Block type="record:…">`.
  On a react page the parent record is ordinary React state, so use the blocks
  that read their own props: `<ListView objectName="<child>" filters={['<lookup
  field>', '=', parentId]}>` for a related list, `<ObjectForm mode="view"
  recordId={…}>` for a field panel, plain JSX over `useAdapter().findOne` for a
  highlights strip or a stage bar. Need the family itself? Author the page as
  `type:'record'`, where the context exists
- `data` / `variables` / `page`

Compose **layout with inline `style={{…}}`** (real CSS); use the injected blocks
for data. **Do NOT use Tailwind `className`** — see *Styling a page* below for
why it silently does nothing. Real component
props/callbacks flow through — e.g. `<ObjectForm>` honors `objectName` / `mode` / `recordId` /
`formType` / `onSuccess` / `onCancel`; `<ListView>` honors `objectName` / `fields` /
`onRowClick` / `navigation`.

> **Do not guess props — read the contract.** Each injected block's full prop set
> (name, type, `data`/`controlled`/`callback` kind, required, description) is the
> **[React-tier component contract](./references/react-blocks.md)**, generated from
> [`contracts/react-blocks.contract.json`](./contracts/react-blocks.contract.json).
> It is the authoritative answer to "what props does `<ObjectForm>`/`<ListView>`/…
> take?" — author against it, not from memory. The `data` props are sourced from the platform's spec schemas (FormView,
> ListView, Chart, …) — the same protocol the server validates;
> `binding`/`controlled`/`callback` are the React overlay. The contract covers
> the **curated core set**; runtime-injected blocks outside it (`<ObjectMetric>`,
> `<ObjectKanban>`, …) read their props from the block registry at render time —
> except the `record:*` family, which is rejected on this surface (above).
> (Maintainers: regenerate with `pnpm --filter @objectstack/spec gen:react-blocks`.)

Master/detail (click a row → edit it → save refreshes the list):

<!-- os:check -->
```tsx
import { definePage } from '@objectstack/spec/ui';

export const CrmWorkbenchPage = definePage({
  name: 'crm_workbench', label: 'CRM Workbench', type: 'home', kind: 'react',
  source: `
function Page() {
  const [sel, setSel] = React.useState(null);
  const [reload, setReload] = React.useState(0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, padding: 32, alignItems: 'start' }}>
      <ListView key={reload} objectName="project"
        fields={['name','status','owner']} navigation={{ mode: 'none' }}
        onRowClick={(r) => setSel(r)} />
      {sel
        ? <ObjectForm objectName="project" mode="edit" recordId={sel.id}
            onSuccess={() => { setSel(null); setReload((k) => k + 1); }} />
        : <p style={{ color: 'hsl(var(--muted-foreground))' }}>Select a project to edit.</p>}
    </div>
  );
}`,
});
```

**Safety / availability.** `kind:'react'` executes author code in the app, so it is gated
by the host capability `react-pages` — **ON by default** (the platform trusts reviewed,
draft-gated authors). A deployment that does not trust its authors turns it off server-side
with `OS_PAGE_REACT=off`; the page then shows a "disabled" notice instead of executing.
`os build` does NOT lint react source (it is real JS, not constrained JSX) — errors surface
at render behind an error boundary, so always test a react page in the browser.

### Styling a page (ADR-0065) — `responsiveStyles`, NOT `className`

To style a metadata-authored block, give it a **`responsiveStyles`** object — a
per-breakpoint map of CSS properties. The renderer compiles each styled node to
**id-scoped CSS** at render time. **Do NOT put Tailwind classes in `className`**
expecting them to render: Tailwind is compiled at the *renderer's* build over the
*renderer's* source, never over your metadata, so a class only happens to work if
objectui already uses it — arbitrary classes (`text-[27px]`, `bg-[#1a2b3c]`,
`grid-cols-7`) silently do nothing. `responsiveStyles` has no such trap (values
are compiled from your data at render).

Rules:
- **`responsiveStyles` and `id` are top-level** envelope fields; **child nodes go
  in `properties.children`** (the renderer hoists `properties` to schema level).
- Every styled node **needs a stable `id`** (the CSS is scoped to it).
- **Values should be design tokens** for consistency: spacing `var(--space-1..12)`,
  radius `var(--radius)` / `var(--radius-xl)`, shadow `var(--shadow-sm|md|lg)`,
  colors `var(--surface)` / `var(--surface-sunken)` / `var(--text-strong)` /
  `var(--text-muted)` / `var(--brand)` / `var(--brand-foreground)` /
  `var(--hairline)`, or `hsl(var(--primary))` etc. (theme tokens track light/dark).
- **Responsive lives in the breakpoint maps** — `large` (base, desktop-first),
  then `medium` / `small` / `xsmall` as `max-width` overrides. **Never** author
  `md:`-style variant classes.
- **Compose from generic styleable blocks** — `flex`, `element:text`,
  `element:button` — and style each block's root. (`page:card` etc. are fine for
  structure but style what you control.)

```typescript
// A styled pricing card — every block carries responsiveStyles + tokens.
{
  id: 'plan_solo', type: 'flex',
  responsiveStyles: {
    large: {
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)',
      backgroundColor: 'var(--surface)', border: '1px solid hsl(var(--primary))',
      boxShadow: '0 0 0 3px hsl(var(--primary) / 0.25), var(--shadow-lg)',
    },
    small: { padding: 'var(--space-4)', gap: 'var(--space-3)' },  // responsive via the model
  },
  properties: {
    children: [
      { id: 'plan_solo_price', type: 'element:text',
        responsiveStyles: { large: { fontSize: '40px', fontWeight: '700', color: 'var(--text-strong)' }, small: { fontSize: '32px' } },
        properties: { content: '$29' } },
      { id: 'cta_solo', type: 'element:button',
        responsiveStyles: { large: { marginTop: 'auto', width: '100%' } },  // pin CTA to card bottom
        properties: { label: 'Upgrade', variant: 'primary', size: 'large' } },
    ],
  },
}
```

The spec field is `PageComponentSchema.responsiveStyles` (`ResponsiveStylesSchema` —
see `node_modules/@objectstack/spec/src/ui/responsive.zod.ts`). See ADR-0065
(SDUI styling model).

**In the source tiers (`kind:'html'` / `kind:'react'`) the same rule holds — no
Tailwind `className` — but the primitive differs:**

- **`kind:'html'`** — lay out with the registered components' own structured props
  (`<flex direction="col" gap={6}>`, `<grid columns={4}>` compile their *own*,
  already-shipped classes) and add CSS with a **`style` object written as JSON**
  (quoted keys/values): `style={{"padding":"40px","color":"hsl(var(--foreground))"}}`.
  A JS-style object (`{{padding: 40}}`) is parsed as a deferred expression and will
  NOT apply — keys and string values must be double-quoted.
- **`kind:'react'`** — it's real React, so style with an ordinary inline
  **`style={{}}`** object using `hsl(var(--token))` theme colors:
  `color: 'hsl(var(--foreground))'`, `background: 'hsl(var(--card))'`,
  `border: '1px solid hsl(var(--border))'`, `borderRadius: 'var(--radius)'`. Tokens
  are HSL **triplets**, so always wrap them: `hsl(var(--card))`, never bare
  `var(--card)`; a translucent scrim is `hsl(0 0% 0% / 0.5)`. For a **drawer/modal**,
  render `<ObjectForm formType="drawer"|"modal" open onOpenChange={…}>` — it ships a
  pre-styled Sheet/Dialog with backdrop + animation (`open`/`onOpenChange` are
  read by the component at runtime; they sit outside the contract's `data` prop
  tables); never hand-roll a `fixed inset-0` overlay (its utility classes won't
  compile, so it renders as unstyled boxes with no backdrop).

---

## Docs — Package Documentation (ADR-0046)

A **Doc** is a page of package documentation shipped *as metadata*. You
author plain Markdown in a flat `src/docs/` directory; `os build`
compiles each `*.md` into a `doc` item that travels inside the package
artifact and renders in the console at `/docs/<name>`. Docs are also the
grounding the AI assistant reads about a package.

```
src/docs/
  crm_index.md         → doc "crm_index"      → /docs/crm_index
  crm_user_guide.md    → doc "crm_user_guide" → /docs/crm_user_guide
```

### Authoring rules (each enforced by `os build`)

1. **Flat directory.** Every `.md` lives directly in `src/docs/`;
   subdirectories are a build error. Flatness is what keeps links stable
   — a reference resolves by basename, never by path.
2. **Namespace-prefixed filename.** The filename stem becomes the doc
   `name` (`^[a-z][a-z0-9_]*$`) and must start with the package namespace
   (`crm_…`). Names share one flat, instance-global space with the URL, so
   a bare `user_guide` would collide across packages and fail at install
   (ADR-0048).
3. **Title** resolves: frontmatter `title:` → first `#` heading → `name`.
   Optional frontmatter `description:` is a one-line summary the docs portal
   shows under the title — add it on index/overview docs.
4. **Pure Markdown.** CommonMark + GFM only, plus heading anchors, fenced
   code highlighting, and GitHub alerts (`> [!NOTE]`, `> [!WARNING]`, …).
   **MDX and image references are rejected at build time** — docs are
   publisher content rendered inside the platform (no authored code across
   the trust boundary; images await a content-addressed asset service).
5. **Cross-references** use plain relative links — `[overview](./crm_index.md)`.
   The console rewrites `*.md` → `/docs/<target>` (anchors preserved);
   broken same-package links fail the build.

**Write business concepts, not machine inventories.** A hand-copied table of
objects, fields or components has no producer and drifts; the self-describing
metadata is the one source. A doc answers *what is this, what business problem
does it solve, how do I use it*. Boundary: a fact the reader sees on screen
(the view list in an app's navigation) is documentable; the semantic layer
behind the screen is not.

### Routing model — platform-level viewer, opt-in entry

The viewer is **platform-level**: one global `/docs/<name>` route
resolves any doc regardless of which app you came from. The URL is
**single-coordinate** — no package or app prefix — so a doc has exactly
one URL. Do **not** design per-app or per-package doc URLs; that gives one
doc many addresses and breaks cross-references.

To surface a doc inside an app, add a navigation item that **links into**
that global URL. There is no dedicated `doc` nav-item type yet, so use a
`url` item pointing at `/docs/<name>`:

```typescript
navigation: [
  { id: 'nav_help', type: 'url', url: '/docs/crm_user_guide',
    label: 'User Guide', icon: 'book-open' },
]
```

A platform-level "Documentation" portal (browse/search all docs by
package) is a later, additive concern — author-side, nothing to model now.

> **Live instances vs. structural views.** For a *live, interactive
> instance* — a dashboard, a report, a record table — **don't embed it**:
> link to it by URL and let the platform render it (one source, never a
> stale copy). But for *structural metadata that no single screen shows as
> one picture* — a state machine, a flow, a permission matrix — embed a
> read-only view inline with a `metadata` fence (below).

### Inline metadata views — the `metadata` fence (ADR-0051)

A `metadata` fenced block embeds a **live, read-only** view of one metadata
item, resolved from the *current* metadata at render time — change the rule and
the diagram follows; it is never a screenshot. The body is flat `key: value`
**data, not code**, so it stays inside the §3.4 trust boundary.

Three view kinds:

| `type` | renders | required | optional |
| :--- | :--- | :--- | :--- |
| `state_machine` | a record's lifecycle transition graph (from a `state_machine` validation rule) | `object` + `name` (the rule) | `detail`, `mode` |
| `flow` | a flow's steps; `detail: business` (default) folds purely technical nodes | `name` | `detail` (`business`\|`technical`), `mode` |
| `permission` | a permission set's object-level C/R/U/D matrix | `name` | `mode` |

````md
Tasks move across the board only by these rules:

```metadata
type: state_machine
object: crm_task
name: crm_task_status_flow
```
````

`os build` lints every fence: `type` must be one of the three (typo →
did-you-mean), `name` is required, `state_machine` also needs `object`, and
the referenced object-rule / flow / permission set **must exist in this
package** — a dead same-package reference fails the build (same posture as
a broken link). At render time a missing or forbidden reference degrades to
a placeholder, never a crash.

Scope is deliberately narrow: **only** `state_machine`, `flow`,
`permission`. Embedding an `object` (data model) or an arbitrary SDUI
component is **not** supported. **`permission` caveat:** the matrix is not
yet projected to the reader's own permissions (ADR-0051 P3) — do not place a
`permission` embed in a doc reachable by less-privileged or anonymous
readers until that lands.

### Example

```md
---
title: CRM Overview
description: Accounts, contacts, and opportunities — start here.
---

# CRM

Manages accounts, contacts, and opportunities.

> [!TIP]
> New here? Start with the [user guide](./crm_user_guide.md).

| Object | Purpose |
| :--- | :--- |
| `crm_account` | Companies and organizations |
| `crm_contact` | People at an account |
```

---

## CRM UI Blueprint (Metadata-First)

Use this CRM-style structure as the canonical UI assembly reference:

| UI Surface | Typical Location | Pattern to Follow |
|:--|:--|:--|
| Multi-view object UI | `src/views/*.view.ts` | Define default `list` + `form`, then named `listViews` / `formViews` for scenarios |
| **Public / anonymous form** | `src/views/*.view.ts` (formView with `sharing.allowAnonymous: true`) | Web-to-Lead / Web-to-Case. Auto-exposed at `GET/POST /api/v1/forms/:slug` |
| App navigation | `src/apps/*.app.ts` | Use grouped nav trees, `viewName` shortcuts, and `requiresObject` for capability-aware visibility |
| **Analytics dataset** | `src/datasets/*.dataset.ts` | One per object you want reportable — dashboards and reports bind a **declared** dataset by name, so an object without one has no analytics face |
| Dashboards | `src/dashboards/*.dashboard.ts` | Combine KPI + chart + table widgets with shared `dateRange` and `globalFilters` |
| Reports | `src/reports/*.report.ts` | Select `rows` (dimensions) + `values` (measures) from that dataset; tabular/summary/matrix/joined |
| Record pages | `src/pages/*.page.ts` | Compose `regions` + components (`page:header`, `record:highlights`, related lists, tabs) |
| User actions | `src/actions/*.actions.ts` | Use `flow` for orchestration and `modal` for parameterized bulk mutations |

This blueprint is the default for “build a complete metadata app UI” tasks.

---

## Dashboards (cont.) — KPI Widgets, Filters, Drilldown

Dashboards (`Dashboard`) are first-class metadata. Beyond the basic widget
layout shown above, the production-grade pattern uses:

<!-- os:check -->
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

> **Tokens in filters:** `{current_quarter_start}`, `{current_user_id}` are
> resolved at request time. Avoid baking absolute dates into definitions.
> The full list of supported date placeholders is documented in
> [Date Macros](#date-macros--filter-placeholders) below.

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

## Date Macros — Filter Placeholders

Filter values in list views, dashboards, reports and pages accept relative-date
tokens (`{today}`, `{current_month_start}`, `{30_days_ago}`) and the two session
tokens `{current_user_id}` / `{current_org_id}`. **The vocabulary, both accepted
spellings, the two resolvers and the near-miss list are owned by
objectstack-query → `rules/filters.md` — load it before writing a filter token.**
An unrecognised token is a build error and a runtime throw, never a silent
literal.

Two rules this package owns, because they are about UI surfaces rather than the
token vocabulary:

* A filter token is **presentation scope, not security**. It decides what a
  surface *shows*; RLS decides what a caller may *read*. Removing a
  `{current_user_id}` filter widens a view — it must never be the thing standing
  between a user and someone else's data.
* `AppContextSelector` ids (e.g. `{active_package}`) resolve in navigation
  `recordId` / `params` only. Filters are not evaluated with the sidebar's
  selector state.

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

### Cube Rules (enforced)

1. **`sql` = object name** (e.g. `'opportunity'`). The ObjectQL strategy
   reads it via `cube.sql.trim()` — do **not** put raw SQL there.
2. **Always declare `granularities`** on `time` dimensions so dashboards can
   bucket by day / month / quarter without ad-hoc queries.

---

## Actions

Actions are user-triggered operations attached to an object or a view.
Register them under `defineStack({ actions: [...] })`.

### Action Types

| `type`   | Purpose                                                            | Required field |
|:---------|:-------------------------------------------------------------------|:---------------|
| `script` | Run an inline L2 hook body (sandboxed JS) on the server            | `body` (or `target` = registered function name) |
| `url`    | Navigate to an internal route or external URL                      | `target`       |
| `modal`  | Open a dialog (typically collecting `params`, then executing `body`) | `target`     |
| `flow`   | Launch a screen/auto-launched flow by name                         | `target`       |
| `api`    | Call a registered API endpoint                                     | `target`       |
| `form`   | Open a FormView by name (routed to `/_console/forms/:name`)        | `target`       |

### Where Actions Appear (`locations`)

`locations` is an array — an action can live in multiple surfaces:

| Value            | Surface |
|:-----------------|:--------|
| `record_header`  | Detail page header (single record) |
| `record_more`    | Detail page overflow menu (the "More" / ⋯ button) |
| `record_related` | Related-list section inside a record |
| `record_section` | Body section/tab of a record (e.g. a Security tab) |
| `list_item`      | Per-row action in list views |
| `list_toolbar`   | Bulk action on selected rows (`input.selectedIds`) |

### Visibility, Disable & Feedback

- `visible` — CEL predicate (prefer the `P\`...\`` tagged template); when false the action is **hidden**.
- `disabled` — `boolean` **or** a CEL predicate; when true the action **shows but greys out**. Use this (not `visible`) when the action should stay discoverable but locked in the current state.
- `confirmText` — set for any destructive or irreversible operation.
- `successMessage` / `errorMessage` — author-controlled toast copy on success / failure. Always set `successMessage` for non-obvious outcomes; without it the UI shows a generic "Action completed" toast.
- `undoable: true` — on a single-record update, offers an **Undo** in the success toast (and `Ctrl+Z`); the runtime snapshots prior values and restores them.

Predicates are **bare CEL** — `record.status == "converted"`, evaluated against
the current record. `record.<field>` resolves identically on every surface
(`record_header`, `list_item`, …); prefer it over the bare-field form. Never
wrap a predicate in `${…}` or `{…}` braces (see `objectstack-formula`).

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';
import { P } from '@objectstack/spec';

export const ReassignLeadAction = defineAction({
  name: 'reassign_lead',
  label: 'Reassign Lead',
  objectName: 'lead',
  type: 'api',
  target: 'lead',
  locations: ['record_header', 'list_item'],
  // Greys out (stays visible) once the lead is converted:
  disabled: P`record.status == "converted"`,
  params: [{ field: 'assigned_to', required: true }],
  undoable: true,                 // success toast offers Undo; Ctrl+Z works too
  successMessage: 'Lead reassigned.',
  errorMessage: "Couldn't reassign this lead — try again.",
});
```

### Examples

**Flow-typed action** (delegates to a screen flow):

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';
import { P } from '@objectstack/spec';

export const ConvertLeadAction = defineAction({
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
});
```

**Modal-typed action** (collect params, then execute server body):

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';

export const AddToCampaignAction = defineAction({
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
});
```

#### Action body context (`ctx`)

A server-side action `body` (and a registered function `handler`) receives a
`ctx` with `input` (the modal params), `record` (the target row, when a
`recordId` is in scope), `api` (scoped cross-object CRUD), and the caller
identity. Read the caller's active organization under the **blessed**
`organizationId` name — the same value as the `organization_id` column and
`current_user.organizationId` in RLS, so it matches hooks and seed data with
zero relearning:

```typescript
// ✅ Blessed — identical to the hook surface (ctx.user / ctx.session)
const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
```

Action bodies execute **trusted** (the `ctx.engine` / `ctx.api` facade bypasses
RLS/FLS), so a body that must scope by org reads it from `ctx` explicitly.
`ctx.user` is `undefined` for a context-less / self-invoked call. Same two
isolation axes, same blessed name, same `undefined` cases as hooks — see the
objectstack-data hooks reference.

The caller's position names are on `ctx.session.positions` (absent, not empty,
when the caller holds none). **This array is not an authorization input**:
`positions.includes('admin')` is a defect under a blessed name — ask the
security service for privilege (ADR-0095).

### Opening in a New Tab (`openIn` / `opensInNewTab` / `newTabUrl`)

There are **two** mechanisms here. Pick by whether the URL is static or computed:

#### `openIn: 'new-tab'` — simplest case (static `target`)

When you have a **static** `target` URL (relative or absolute) you just want
opened in a new tab, set `openIn: 'new-tab'` on a `type: 'url'` action. No
handler, no synchronous pre-open. `openIn: 'self'` forces in-place navigation;
omit it and external/absolute URLs open in a new tab while relative URLs
navigate in place. objectui's `ActionRunner.executeUrl` reads `openIn` with
priority over the legacy heuristic.

<!-- os:check -->
```typescript
import { defineAction } from '@objectstack/spec/ui';

export const PrintA3Action = defineAction({
  name: 'print_a3',
  label: 'Print Summary Sheet (A3)',
  type: 'url',
  target: '/print/a3?id=${record.id}',   // static template; interpolated at click
  openIn: 'new-tab',
  locations: ['list_toolbar'],
});
```

#### `opensInNewTab` + `newTabUrl` — async / computed redirect (SSO)

For actions whose redirect URL is **computed after a fetch** (SSO and SSO-like
handlers), set `opensInNewTab: true`. The renderer pre-opens the tab
**synchronously** on click so popup blockers don't fire, then navigates it to
the handler's returned `redirectUrl`. For external deep-links with no server
round-trip, add `newTabUrl` — a direct URL template (supports the `{recordId}`
placeholder). It is valid **only** alongside `opensInNewTab: true`, and the
target endpoint must enforce its own auth (the new tab carries no in-app session
context).

```typescript
export const OpenInvoicePdfAction = defineAction({
  name: 'open_invoice_pdf',
  label: 'Open PDF',
  objectName: 'invoice',
  type: 'url',
  opensInNewTab: true,
  newTabUrl: '/api/v1/invoice/{recordId}/pdf',   // zero-roundtrip; endpoint self-auths
  locations: ['record_header'],
});
```

> ⚠️ **Never express new-tab behavior via `params`.** `params` is exclusively
> `ActionParam[]` for collecting **user input**. Writing an object form like
> `params: { newTab: true }` fails the zod build outright; the array form
> `params: [{ name: 'newTab', type: 'checkbox' }]` *builds* but mis-renders as a
> user-facing checkbox in the param-collection dialog. Use `openIn` (static) or
> `opensInNewTab`/`newTabUrl` (async) instead — these are static execution
> options, not inputs.

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

1. **Putting too many columns in a grid view.**
   Users rarely need more than 6–8 columns visible by default. Use `hidden`
   for secondary columns.

2. **Forgetting `link: true` on the primary column.**
   The first meaningful column (usually the name/subject) should be the
   navigation link to the record detail.

3. **Putting widget grid placement in `position`.**
   The grid-placement field is `layout: { x, y, w, h }` — `position` is not a
   widget key and the closed schema REJECTS it by name (it was silently
   dropped before protocol 17). `layout` is optional: omit it and the widget
   auto-flows (the Studio designer relies on this); set it only when you want
   an explicit grid position.

---

## Verify your work

After authoring any `*.view.ts` / `*.action.ts` / `*.dashboard.ts`, run the
author-time gate before reporting done:

```bash
os validate     # CEL predicates (record.<field>) + widget bindings + schema
# or: os build  # the same gates, plus emits dist/
```

Two UI-specific traps it catches, both **silent at runtime** otherwise:

- **Action / field predicate** — a bare field ref in an action `visible` /
  `disabled` or a field `visibleWhen` (`done` instead of `record.done`)
  evaluates to `null` and hides the control on *every* record (the
  "button never shows" trap).
- **Dashboard widget binding** — a widget `dataset` / `dimensions` / `values`
  that doesn't resolve to a declared dataset/field renders an empty chart
  (ADR-0021).

Don't report a view/action/dashboard done until `os validate` passes. In a
scaffolded project the gate is `npm run validate`.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.
