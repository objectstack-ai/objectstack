# List, Kanban & Gantt Views

- [Configuring a List View](#configuring-a-list-view) · [The `defineView` container](#the-defineview-container-viewts-file-shape) · [Data Source](#data-source-data)
- [Columns](#columns) · [Column Features](#column-features) · [Filtering](#filtering) · [Sorting](#sorting) · [Grouping](#grouping)
- [End-User Quick Filters](#end-user-quick-filters-userfilters-adr-0047) · [Toolbar Search](#toolbar-search-searchablefields-adr-0061)
- [Configuring Kanban Views](#configuring-kanban-views)
- [Configuring Gantt Views](#configuring-gantt-views)

## Configuring a List View

### The `defineView` container (`*.view.ts` file shape)

Views ship **inside a `defineView` container** — one per object, aggregating
the default `list` and `form`, named `listViews`, and `formViews`. The loader
expands it into `<object>.<key>` view items that power the view switcher.

<!-- os:check -->
```typescript
import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'support_case' };

export const CaseViews = defineView({
  list: { label: 'All Cases', type: 'grid', data, columns: ['subject', 'status'] },
  form: { type: 'simple', data, sections: [{ group: 'case_detail' }] },
  listViews: {
    open: { label: 'Open', type: 'grid', data, columns: ['subject', 'status'],
            filter: [{ field: 'status', operator: 'equals', value: 'open' }] },
  },
});
```

> **Never export a bare flat view object** (`{ name, label, type, columns }`
> at top level): nothing registers and no view appears in the switcher.

### Data Source (`data`)

Bare-key blocks in this file are fragments, so `check:skill-examples` skips
them. Every view connects to data via one of two providers:

```typescript
data: { provider: 'object', object: 'support_case' }
data: { provider: 'value', items: [...] }
```

> Use `provider: 'object'` for an ObjectStack-managed object. A view never calls an API: an API read is a
> page element's `dataSource` binding.

### Columns

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
    summary: 'min',       // plain enum value, not an object
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

**Inline editing is on by default**, under the permission gate: a user who may
`update` the object edits a cell in place. A list whose records are read-only
by nature — a log, an audit trail, a history, a report roll-up — declares
`userActions: { editInline: false }`.

### Filtering

`filter` is a list whose elements must **all** match. An element is a rule
`{ field, operator, value }` or an any-of group `{ or: [rule, ...] }` that
matches when **any** of its rules does — still ANDed with the elements beside it:

```typescript
filter: [
  { or: [                                   // open, OR urgent …
    { field: 'status', operator: 'equals', value: 'open' },
    { field: 'priority', operator: 'equals', value: 'urgent' },
  ] },
  { field: 'assigned_to', operator: 'equals', value: '{current_user_id}' },   // … AND mine ({current_user_id} = the signed-in user)
]
```

Operators (no others): `equals`, `not_equals`, `contains`,
`not_contains`, `icontains`, `starts_with`, `ends_with`, `greater_than`, `less_than`,
`greater_than_or_equal`, `less_than_or_equal`, `in`, `not_in` (list values),
`is_empty`, `is_not_empty`, `is_null`, `is_not_null`, `before`, `after`, `between` (`[min, max]`).

A group holds flat rules only (no group in a group) and never `or: []`; `$or`,
`any` / `anyOf`, `logic` / `conditions` on a rule are refused naming this shape.
The Console builder saves its OR toggle as one group and edits a filter that is
exactly one group; a group beside other elements applies, but the builder shows
it read-only.

### End-User Quick Filters (`userFilters`, ADR-0047)

`filter` is the always-on base criteria. For the *end-user-facing* filter bar
(Airtable "User filters") use `userFilters` — dropdowns, filter tabs, or
toggles the user combines at runtime:

```typescript
userFilters: {
  element: 'dropdown',              // 'dropdown' | 'tabs' ('toggle' is deprecated)
  fields: [
    { field: 'status' },            // options/labels inferred from field def
    { field: 'priority', showCount: true },
  ],
},

// Runtime visualization whitelist (Airtable "Appearance → Visualizations"):
appearance: { allowedVisualizations: ['grid', 'kanban', 'gallery'] },  // one entry = locked, no switcher
```

Rules:
- Every `field` MUST exist on the source object — reference diagnostics
  (`_diagnostics`) flag unknown fields; treat `valid: false` as a failed write.
- **A list view has no `tabs` key** — it was removed (a parse error that
  names the fix). Each named preset is a `listViews`
  entry, rendered as a tab in the object's saved-view switcher.
- **On an object list view (`*.view.ts` `list` / `listViews`), only
  `element: 'dropdown'` (value chips) is allowed — `tabs` is page-only**
  (ADR-0047 amendment): the saved-view switcher already owns the tab bar, so
  `ObjectUserFiltersSchema` **rejects** `tabs` at parse (not dropped) and the
  `validate` list-view-mode lint reports it. The full
  `dropdown | tabs | toggle` range applies only to **page lists** /
  `interfaceConfig.userFilters`.
- **Omit `userFilters` when unsure — omission means a clean toolbar.** Nothing
  is auto-derived.
- `userFilters: { element: 'dropdown' }` (no `fields`) is valid shorthand:
  the renderer fills the field list from the object's select/boolean fields.

### Toolbar Search (`searchableFields`, ADR-0061)

The toolbar's search box scans a set the **object** owns. A list view's
`searchableFields` **narrows** that set for this one list — never widens it.

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
| declares `searchableFields` | **that list, verbatim** — any stored field type |
| declares nothing | the auto-default: the name field + the text-like columns (`text` / `email` / `phone` / `url` / `autonumber` / `textarea` / `markdown` / `select`) + every field marked `searchable: true`, of any type except `secret` / `password` / `vector` or a virtual `formula` |

`searchable: false`, the default, removes nothing the type default scans.

Modelling side: **objectstack-data → Search Fields**. Query side
(`search.fields` over the API): **objectstack-query → Full-Text Search**.

#### ⛔ One bad entry 400s EVERY search on that list

The client sends this list verbatim as the `$searchFields` override and the
ingress gate refuses any entry outside the allowed set before the engine runs —
the whole search box, for every user and every term: no result at all.

| What you write on the view | `os validate` | Toolbar search at runtime |
|:---------------------------|:--------------|:--------------------------|
| a subset of the allowed set | clean | scans exactly those columns |
| key omitted | clean | scans the object's full allowed set |
| `searchableFields: []` | clean | **identical to omitting it** — empty is *absent*, so it scans MORE than `["subject"]` would |
| a renamed / mistyped column, or a dotted path (`account_id.name`) | `searchable-field-unknown` | `400 INVALID_FIELD` |
| a real column outside the allowed set, or a virtual `formula` column | `searchable-field-unsearchable` | `400 INVALID_FIELD` |

Both diagnostics are **errors**, not warnings — `os validate` fails the build.

To remove the search box, toggle the affordance instead:

<!-- os:check -->
```typescript
import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'support_case' };

export const AuditViews = defineView({
  list: {
    label: 'Audit Log', type: 'grid', data,
    columns: ['case_number', 'status'],
    userActions: { search: false },   // ← no search box
  },
});
```

**Searching by a related record's title:** mirror it into a **stored** field
and narrow to that (objectstack-data → Search Fields).

### Sorting

```typescript
// `order` is required.
sort: [
  { field: 'priority', order: 'desc' },
  { field: 'created_at', order: 'asc' },
]
```

### Grouping

`grouping.fields[]` nests levels, outermost first. A `select` level keeps its
option order (declare stages in pipeline order); others sort by label.
`orderBy` orders a level's groups by a number, date or boolean field of the
same object instead — text or a select is refused
(`list-view-group-order-unorderable`):

```typescript
grouping: { fields: [
  { field: 'stage' },
  { field: 'period_label', orderBy: 'period_start', order: 'desc' },  // newest first
] },
```

---

## Configuring Kanban Views

Board settings nest under `kanban:` (`KanbanConfigSchema`) — there is **no
top-level `groupBy`**; the top-level `columns` stays required.

<!-- os:check -->
```typescript
import type { ListView } from '@objectstack/spec/ui';

const board: ListView = {
  type: 'kanban',
  data: { provider: 'object', object: 'project_task' },
  columns: ['title', 'assignee', 'priority'],
  kanban: {
    groupByField: 'status',                // a select field — one lane per option
    lanes: ['todo', 'in_progress', 'review'],
    summarizeField: 'estimate_hours',      // optional — summed at the top of each column
    columns: ['title', 'assignee', 'priority'],   // fields shown on each card
  },
  sort: [{ field: 'priority', order: 'desc' }],
};
```

> `lanes` chooses the lanes and their order, not the records: a record whose
> value is unlisted lands in `Uncategorized`, so filter the view to keep records
> off the board. Omit it to draw every option in its own order; a value that is
> not one of the field's inline options, or listed twice, fails `os validate`.

### Adding a board, calendar, gallery or gantt beside the list

"Add a kanban (calendar / gallery / gantt) view" means a NEW `listViews` entry
that coexists with the views the object has — its key encodes the kind or
purpose (`status_kanban`, `timeline_gantt`: the key a nav item's `viewName`
names, registered as `OBJECT.status_kanban`), the default `list` and every
other view untouched. Never satisfy an add by retyping `list` (or an existing named
view) to `type: 'kanban'`: nothing refuses it, the view is converted in place
and the original is gone. Change a view's kind in place only when the request
says to convert or replace THAT view.

**A board over a field added in the same change opens empty.** Adding a field
writes nothing into existing rows, so when `kanban.groupByField` is a `select`
created in this change every pre-existing record lands in the trailing
`Uncategorized` lane: one empty lane per option, the populated lane last,
under a non-zero record count. That
is the renderer's correct fallback, not lost data, and the hand-over says so
instead of "the board is ready": (a) the existing records are all in the last
`Uncategorized` lane, scroll right; (b) dragging a card out of it onto a real
lane writes the field, or edit them from the list; (c) a runtime-token
(`current_user`) or CEL `defaultValue` is applied on INSERT and changes no
existing row, but on a SQL datasource a LITERAL `defaultValue` becomes the
added column's DEFAULT, so there the existing rows read it and land in its
lane. The same is owed when an existing list is converted into a board over a
just-added field.

---

## Configuring Gantt Views

Timeline settings nest under `gantt:` (`GanttConfigSchema`);
`startDateField` / `endDateField` / `titleField` are required in it.

<!-- os:check -->
```typescript
import type { ListView } from '@objectstack/spec/ui';

const timeline: ListView = {
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
};
```

Rows with children (or `type: 'summary'`) are **summary bars**: dragged as a
group, **no resize handles**. Leaf tasks resize unless `locked: true`.
