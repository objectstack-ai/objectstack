# List, Kanban & Gantt Views

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
  { field: 'assigned_to', operator: 'equals', value: '{current_user_id}' },
]
```

Common operators: `equals`, `not_equals`, `contains`, `starts_with`,
`greater_than`, `less_than`, `is_empty`, `is_not_empty`, `in`, `not_in`,
`this_week`, `this_month`, `this_quarter`, `last_n_days`.

> **`{current_user_id}`** resolves to the signed-in user's id.

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
