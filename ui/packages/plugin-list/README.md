# @object-ui/plugin-list

ListView plugin for ObjectUI - A unified view component with view type switching, filtering, sorting, and view configuration persistence.

## Features

- **View Type Switching**: Switch between Grid, Kanban, Gallery, Calendar,
  Timeline, Gantt, Map, Chart and Tree views
- **View Persistence**: Automatically saves user's view preference
- **Integrated Search**: Full-text search across records
- **Filtering**: Advanced filter UI (expandable filter panel)
- **Sorting**: Sort by any field, toggle ascending/descending
- **Flexible Configuration**: Configure available view types per object
- **Custom Templates**: Support for custom view options per view type

## Visual density defaults (renderer-only, metadata always wins)

The toolbar and cell renderers are tuned for low visual noise on dense tables:

- **Unified toolbar row**: view tabs (`schema.tabs`), user filters and tool
  buttons share a single bordered row. The previous stacked rows (`tabs` /
  `description` / `toolbar`) are collapsed into one separator line.
- **Four tool buttons by default**: the right side of the row is Filter, Sort,
  Display and Search. **Display** holds the rest — a Layout row (the
  visualization switcher, when the list offers more than one), Group, Row
  color, Hide fields, Density, a session-only Row numbers switch and an Edit
  inline switch, with Reset to view default, Refresh and Export in its footer.
  Its trigger counts the settings that differ from the view's own. Each
  control saves what its own toolbar button saves; the panel stores nothing
  of its own. A view that sets `compactToolbar: false` gets one toolbar
  button per control instead (objectui#12423).
- **Flat user-filter pills**: `userFilters` (dropdown mode) render as ghost
  text + count. Active state is shown via `text-foreground font-medium`
  rather than a filled / bordered pill.
- **Quiet active state for tool buttons**: filter / group / sort / color /
  density / search no longer paint a `bg-primary/10 border` block when
  active — they switch to `text-foreground font-medium` and rely on the
  trailing count for emphasis.
- **Dot-style select/status cells (opt-in)**: the cell renderer supports
  `appearance: 'dot'` to render `● label` instead of a filled badge for
  high-density tables. **This is opt-in** — by default select/status
  cells render as filled badges in both list and detail views, keeping
  visual consistency across views. Set `appearance: 'dot'` on the field
  (or column) in metadata when you want the lighter style.

## Installation

```bash
pnpm add @object-ui/plugin-list
```

## Usage

### Basic Example

```tsx
import { ListView } from '@object-ui/plugin-list';

function ContactsView() {
  return (
    <ListView
      schema={{
        type: 'list-view',
        objectName: 'contacts',
        viewType: 'grid',
        columns: ['name', 'email', 'phone', 'company'],
        sort: [{ field: 'name', order: 'asc' }],
      }}
    />
  );
}
```

### Grouping Records (Airtable-style)

Group rows in grid/gallery views by one or more fields. Two equivalent shapes
are supported on the schema:

Spec-compliant: a structured `GroupingConfig` (multi-level, with per-field
options).

```tsx
import { ListView } from '@object-ui/plugin-list';

<ListView
  schema={{
    type: 'list-view',
    objectName: 'tasks',
    viewType: 'grid',
    columns: ['title', 'status', 'assignee'],
    grouping: {
      fields: [
        { field: 'status', order: 'asc', collapsed: false },
        { field: 'assignee', order: 'asc', collapsed: true },
      ],
    },
  }}
/>
```

Shorthand: a single field name, the shape the visual view-config UI emits. It is
normalized internally into the `GroupingConfig` above — an alternative to the
block before it, never a second view rendered beside it.

```tsx
import { ListView } from '@object-ui/plugin-list';

<ListView
  schema={{
    type: 'list-view',
    objectName: 'tasks',
    viewType: 'grid',
    columns: ['title', 'status'],
    groupBy: 'status',
  }}
/>
```

When both are present, `grouping` wins. End users can also add or remove
grouping fields at runtime via the Group toolbar button. Every such edit, in
the Display panel's Group section or in the wide toolbar's Group panel
(Clear included), fires `onGroupingChange` with the spec `GroupingConfig`, or
with `undefined` when the grouping is cleared. A changed `schema.grouping` that
the list re-reads does not fire it: that value came from the host
(objectui#11860).

A grouped **grid** is grouped on the server: over a data source that answers
the group header query (`dataSource.queryGroupHeaders`), `ListView` hands the
grid its own fetch, and the group set, every group count and each group's
rows come from the query (see *Grouping is server-side* in the
`@object-ui/plugin-grid` README). A toolbar search is handed to that grid too,
with the view's `searchableFields`: the grid puts the term on the group header
query and on every group's row query, so only the groups holding matches are
shown and each count is its matching rows (objectui#11021).

Over a data source that declares no `queryGroupHeaders`, `ListView` does not
fetch a window and group it — every count would be a page slice, and groups
past the window would be missing. It shows an error naming
`queryGroupHeaders` in place of the grid instead, fetches no rows, and keeps
the toolbar, so removing the grouping there lifts it (objectui#10881). Rows
handed in whole (`data` as an array, or `{ provider: 'value', items }`) are
still grouped in the browser, exactly.

### With Multiple View Types

Each view type's configuration is a block of that name at the top level of the
schema: `kanban`, `calendar`, `gallery`, `timeline`, `gantt`, `map`, `chart`,
`tree`. Each block is `@objectstack/spec`'s own list-view block, and an unknown
key in it is refused by name.

```tsx
import { ListView } from '@object-ui/plugin-list';

<ListView
  schema={{
    type: 'list-view',
    objectName: 'deals',
    viewType: 'kanban',
    columns: ['name', 'amount', 'stage', 'close_date'],
    kanban: {
      groupByField: 'stage',
      columns: ['name', 'amount'],
      titleField: 'name',
    },
    calendar: {
      startDateField: 'close_date',
      titleField: 'name',
    },
    // A chart binds a semantic-layer dataset and selects its dimensions and
    // measures by name (ADR-0021).
    chart: {
      chartType: 'bar',
      dataset: 'deal_pipeline',
      dimensions: ['stage'],
      values: ['total_amount'],
    },
  }}
/>
```

A stored view may also carry the same blocks in a legacy `options` bag
(`options.kanban`, …), which the platform's view write door judges key by key
with the same block schemas. `ListView` reads it under the top-level block, which
wins per key. Author the top-level blocks.

### With Callbacks

```tsx
import { ListView } from '@object-ui/plugin-list';

<ListView
  schema={{
    type: 'list-view',
    objectName: 'tasks',
    columns: ['title', 'status', 'priority'],
  }}
  onViewChange={(view) => console.log('View changed to:', view)}
  onSearchChange={(search) => console.log('Search:', search)}
  onSortChange={(sort) => console.log('Sort:', sort)}
  onFilterChange={(filters) => console.log('Filters:', filters)}
  onGroupingChange={(grouping) => console.log('Grouping:', grouping)}
/>
```

### Host slot: `toolbarLeading`

A host can draw its own node at the start of the list toolbar row, before the
user-filter chips, with the `toolbarLeading` prop. The node sits in a
`min-w-0 flex-1` wrapper, so it gets the width the right-hand controls leave.
This is a React prop for the host app, not a schema key: list metadata cannot
set it. Without it the toolbar row is unchanged. The console uses it to put its
saved-view tabs on the same row as Filter, Sort, Display and Search.

```tsx
import { ListView } from '@object-ui/plugin-list';

function MyViewTabs() {
  return <nav aria-label="Views">…</nav>;
}

<ListView
  schema={{ type: 'list-view', objectName: 'tasks', columns: ['title', 'status'] }}
  toolbarLeading={<MyViewTabs />}
/>
```

### Host prop: `rowAdornment`

A host can draw a node beside each row's title in the grid with the
`rowAdornment` prop: a function called with the row record that returns a React
node, or `null` for none. The list hands it to the grid as the grid's own
`rowAdornment` (see `@object-ui/plugin-grid`), which places it in the cell of
the object's declared name field when a column shows it, else in the first
shown column. Only the grid is handed it: the board, calendar and the other
visualizations, and the compact posture, draw no title cell for it. This is a
React prop for the host app, not a schema key: list metadata cannot set it.
Without it every row is unchanged. The console uses it on Setup → Users on a
cloud-managed environment, to mark a user who holds no permission set beyond
the baseline.

### Host prop: `viewDefaults`

A host that stores the user's own hidden fields or density and lays that
preference over `hiddenFields` / `rowHeight` in `schema` passes the view's own
values in `viewDefaults`. The Display control's trigger count and its "Reset to
view default" then compare these two settings against the view, not against
`schema`, and the reset writes the view's values back through the doors the
controls write through (`onHiddenFieldsChange`, `schema.onDensityChange`), so
the stored preference follows. This is a React prop for the host app, not a
schema key: list metadata cannot set it.

When it is passed, its members are the whole baseline: an absent `hiddenFields`
means the view hides nothing, and an absent `rowHeight` means the default
density. Without it nothing changes: `schema` is taken as the view's own. The
console passes it on the object list page, where it persists both settings per
user.

```tsx
import { ListView } from '@object-ui/plugin-list';

// The view hides `amount`; the user has since hidden `stage` as well.
<ListView
  schema={{ type: 'list-view', objectName: 'deals', hiddenFields: ['amount', 'stage'] }}
  viewDefaults={{ hiddenFields: ['amount'] }}
  onHiddenFieldsChange={(hidden) => console.log('Hidden:', hidden)}
/>
```

## Schema

The ListView component accepts a `ListViewSchema`, exported from
`@object-ui/types`. That type is derived from the package's zod schema — which
itself derives from `@objectstack/spec` — so it cannot drift from the protocol.
This page therefore annotates an example *against* the shipped type instead of
restating it as a second hand-written interface: every key below is re-checked
on every commit, and a shape the type stops accepting fails here rather than
misleading a reader.

```typescript
import type { ListViewSchema } from '@object-ui/types';

const view: ListViewSchema = {
  type: 'list-view',
  objectName: 'tasks',
  viewType: 'grid',
  // Spec-canonical column list. The legacy `fields` alias is still accepted on
  // input (stored view metadata carries it) and folded into `columns` by
  // `normalizeListViewSchema` — but nothing reads it, so emit `columns`.
  columns: ['title', 'status', 'assignee'],
  filters: [['status', '=', 'open']],
  sort: [{ field: 'title', order: 'asc' }],
  // One block per view type, at the top level. A grid has no block of its own:
  // its settings are the top-level keys above.
  kanban: { groupByField: 'status', columns: ['assignee'], titleField: 'title' },
  calendar: { startDateField: 'due_date', titleField: 'title' },
  chart: { chartType: 'bar', dataset: 'task_status', dimensions: ['status'], values: ['total_amount'] },
};

// `columns` also accepts ListColumn objects in place of the field-name strings.
const richColumns: ListViewSchema['columns'] = [
  { field: 'title', label: 'Title', width: 200 },
];

// The view-type vocabulary, written as a record keyed by the shipped union so
// this list cannot go stale: a value added to or removed from
// ListViewSchema['viewType'] fails this block.
const viewTypes: Record<NonNullable<ListViewSchema['viewType']>, string> = {
  grid: 'Rows and columns',
  kanban: 'Cards grouped into columns',
  gallery: 'Card grid',
  calendar: 'Records on a month / week calendar',
  timeline: 'Records bucketed on a date axis',
  gantt: 'Bars over a project timeline',
  map: 'Records at their geographic coordinates',
  chart: 'Aggregated bar / line / pie / area chart',
  tree: 'Hierarchical parent-child rows',
};

export { view, richColumns, viewTypes };
```

## Empty state

When the `grid` or `gallery` visualization has no record to show, the view
draws its `emptyState` (the spec's `EmptyState`): a Lucide `icon`, a `title`, a
`message` and one `link: { label, url }` the user follows, such as the how-to
page that explains what belongs in the list (objectui#12270). A member left out
keeps the localized default copy; `title`, `message` and the link's `label`
each take a string or an inline locale map, resolved against the display
locale.

The link is followed as a `type: 'url'` action through the action runner, so it
opens what such an action opens: an in-app path (`/…` or `./…`) in place, an
`http(s)://` address as the runner opens an external target, and `mailto:` in
place. The runner refuses anything else at the click and reports it. The link
is drawn beside the add-record action when the view's `addRecord` block offers
one; the two are separate, and either, both or neither may be drawn.

```typescript
import type { ListViewSchema } from '@object-ui/types';

const emptyTasks: ListViewSchema = {
  type: 'list-view',
  objectName: 'tasks',
  viewType: 'grid',
  columns: ['title'],
  emptyState: {
    title: 'No open tasks',
    message: 'Tasks assigned to you appear here.',
    icon: 'inbox',
    link: { label: 'How tasks are assigned', url: '/docs/tasks' },
  },
};

export { emptyTasks };
```

A list page (`interfaceConfig` of a `type: 'list'` page) may declare its own
`emptyState` of the same shape. The page's own block wins, whole, over the one
its source view declares, on every visualization; the source view's is the
fallback when the page declares none.

## Page size and fetch batch

A list view asks the server for one window of records. When
`pagination.pageSize` is not declared, what that window is depends on whether
the view pages:

- **The grid view pages on the server.** The window is one page, and the
  grid's pager turns it. Its size is the default `@objectstack/spec` declares
  for `pagination.pageSize`; the list reads it from the spec rather than
  keeping a number of its own.
- **Every other view does not page** — kanban, gallery and the rest, and a
  grouped grid. The window is one fetch batch of **100** records, and records
  past it are not reachable; the record-count bar says so when the batch comes
  back full. It is a fetch size, not a page size, so it does not follow the
  spec's display default.
- **The calendar view fetches the days it shows.** With a start date bound
  (`calendar.startDateField`), the window is the calendar's visible days on
  that field (and on `calendar.endDateField` when one is bound, so a span that
  runs into the month is fetched), plus the records with no start date, which
  the calendar lists as unscheduled. The list walks that window in steps of the
  same fetch batch of 100 until it is exhausted, so every record of the month
  is drawn, and stops at the platform's non-grid ceiling of 2,000 records with
  a note under the calendar naming both numbers. Moving to a month the fetched
  window does not cover fetches that month. The calendar reports the days it
  draws through its `onVisibleRangeChange` callback (objectui#12081).

A declared `pagination.pageSize` sizes the window on every view but the
calendar, as before. With no declared size, switching between the grid view and
another view changes the window, so the list fetches again.

## On a page — `data` and `type`

A `list-view` node on a page is written in `@objectstack/spec`'s list view
spelling: `data` says where its records come from, and `type` says which kind of
list it is. On a metadata page both sit in the node's `properties`. The node's
own `type` stays `list-view`, because it is the key the page renderer looks the
component up by:

```json
{
  "type": "list-view",
  "properties": {
    "data": { "provider": "object", "object": "deal" },
    "columns": ["name", "amount"],
    "kanban": { "groupByField": "stage" }
  }
}
```

That node draws a grid of `deal` records: without `properties.type` the list is
a grid, the spec's default kind. Add `"type": "kanban"` to the same `properties`
and it draws a kanban over `deal`, grouped by `stage`. A `type` that names no
kind this list draws is a grid too. `data` may also hand the list its rows
(`{ "provider": "value", "items": [...] }`).

A page node's own `objectName` and `viewType` are **not read**. The page
renderer removes them before the list sees the node, and logs one warning per key
naming what to write instead. A node that names its object only as `objectName`
therefore names no object, and the list draws a hint in its place: "No object
named: set data.object or dataSource.object." Converting page nodes stored in
the old spelling is the platform's job (an ADR-0087 conversion in
`@objectstack/spec`); this renderer does not read them back. `ListView`'s own
React props (the `ListViewSchema` examples above) are a separate surface and
still spell the two `objectName` and `viewType`.

`objectui validate` judges a page `list-view` node in this spelling. Its record
source is `properties.data` or a bound `dataSource.object`, and a node with
neither is refused at `properties.data`. `objectName` and `viewType` are refused
by name, on the node or in `properties`, each naming what to write instead
(`properties.data`, `properties.type`). A `properties.type` that names no kind a
list view draws is refused, and so is a list view prop such as `columns` written
on the node itself rather than in `properties`.

## On a page — `requiredPermissions`

One more key of the spec's list view row acts on a page `list-view` node. It
sits in `properties`:

```json
{
  "type": "list-view",
  "properties": {
    "data": { "provider": "object", "object": "deal" },
    "columns": ["name", "amount"],
    "requiredPermissions": ["sales.view_pipeline"]
  }
}
```

**`requiredPermissions`** names the capabilities the viewer must **all** hold,
the names permission sets grant through `systemPermissions`. It gates the node
the way it gates the record blocks (`record:details`, `record:highlights`,
`record:related_list`). A viewer missing one sees the notice "Insufficient
permissions to view list." (`role="status"`) in place of the list, and no
records are queried. An empty list, or no key, is no gate. A permission
provider that reports no capabilities at all leaves the list shown; the server
stays the authority. Only the page node reads this key: the object list page
draws `ListView` itself, and the server gates the views it serves.

`addRecord` draws an Add button. `position` places it: `"top"` (the toolbar),
`"bottom"` or `"both"`. `mode` and `formView` are not read.

The spec row declares `enabled` default `true` and `position` default
`"bottom"`. The renderer does not apply those defaults: it draws the button only
for an explicit `enabled: true`, and places an absent `position` at the top.
objectui#13099 owns that gap; until it lands, write both keys.

```json
{
  "type": "list-view",
  "properties": {
    "data": { "provider": "object", "object": "deal" },
    "addRecord": { "enabled": true, "position": "top" }
  }
}
```

On a page node the click calls the `onCreate` a `RelatedRecordActionsContext`
provider (`@object-ui/react`) serves for the listed object, resolved with
`{ objectName }` and no `relationshipField`. The console's page host serves the
create the object list's New opens: the record-form overlay, or the full-page
create route for an object whose `editMode` is `page`. With no such provider,
for a viewer who may not create, or for a create the object greys, the button
is not drawn, rather than drawn with no action. A host that passes `ListView`'s
own `onAddRecord` prop keeps it; the console's object list passes its header
New's create.

`sharing` does nothing on a page node yet: it draws a Share button with no
action, because the spec declares none for it. It is not a published input.

## Page binding — `dataSource` (referencing a saved view by name)

On a metadata page, a `list-view` component can also bind its data through the
spec's per-element data source (`PageComponentSchema.dataSource`,
`ElementDataSourceSchema`) instead of naming its object in `data` and inlining
the view's configuration. A bound `dataSource.object` outranks `data`:

```json
{
  "type": "list-view",
  "dataSource": { "object": "account", "view": "hot", "limit": 10 }
}
```

`view` names a **saved view** of that object — either one embedded in the object
definition (`listViews`) or one created in the UI (the metadata overlay an
adapter serves from `listViews()`). Its `columns`, `filter`, `sort`, page size
and view kind are applied to the render, so a page no longer has to keep a second
copy of a view's configuration in sync with the view itself. Both the short key
(`hot`) and the qualified id (`account.hot`) resolve.

**Precedence.** `dataSource.*` keys are authoritative — the author wrote them on
this placement, and they beat the component's own same-named key. Values that
come from the named view are a *baseline*: a key written on the component itself
is more specific than the view it points at, so the component's key wins
(an empty `columns: []` counts as "not authored"), and a kind written as
`properties.type` beats the view's kind. `filter` is the exception —
the spec calls `dataSource.filter` "additional filter criteria", so the
component's filter, the view's filter and the binding's filter all AND together.
A binding can narrow what the view selects, never widen it.

**An unresolvable `view` is an error, not an empty table.** If the named view
does not exist, the block renders a configuration error listing the object's
actual views, and issues no query. It deliberately does not fall back to the
object's default view: that would turn a typo into a silently *wider* answer on a
page that still looks like it works.

## Compact posture in a narrow page region — `compact`

`ListViewProps` has an optional host prop, `compact`. It is a React prop, not a
schema key: nothing in `@objectstack/spec` declares a posture, and an author
never writes one. The `list-view` page block sets it. It reads
`usePageRegionPosture()` from `@object-ui/components` and passes
`compact` when the answer is `'compact'`, which means the page region the block
sits in is narrower than half the page (an `aside` or `sidebar` rail beside
`main`).

With `compact`, the list draws:

- a header with the list's title (its `label`, else the object's label) and
  the record count;
- one row per record: the view's first visible column, with the second visible
  column muted on a line below; a click on a row opens the record the way a grid
  row does.

It does not draw the toolbar, the view tabs, the `#` row-number column, the
pager or the record-count bar.

The prop applies only to a paged grid, the view whose rows `ListView` fetches
a page of. A board, a calendar or a grouped grid keeps its own rendering. When
`compact` is absent (wide regions, unknown widths, the object list page and
every other host), the list renders exactly as before.

### "View all"

Under its rows the compact list draws a "View all" link (`list.viewAll`) to the
rest of the list. The host builds the destination: the `list-view` block asks
the host's `listHref` / `openList` on `RelatedRecordActionsContext`
(`@object-ui/react`) for the object it reads, naming the saved view the block
binds with `dataSource.view` when it binds one. Without a bound view the link
goes to the object's own list. The block's own `filter`, `columns` and `sort`
are never handed over, so they never reach the URL; the header count stays the
answer to what the block shows.

The link is a real anchor: a plain left click navigates in the app through
`openList`, and a modifier click (a new tab) follows the href. A host that
publishes no `listHref`, or answers `null`, gets no link. An empty list draws
no link either.

## Sorting (and why relational columns are not offered)

The toolbar sort becomes a server `$orderby` on the **flat field name**, so the
sort key is whatever that field stores. For a relational field
(`lookup` / `master_detail` / `user` / `tree`) that is the foreign-key **id**,
while the column shows the related record's name — the rows would come back in
an order with no visible relation to the column ("sorting is broken", from the
user's side). The server cannot order by the related name without a join, and
`objectstack#4256` settled that it will not add one.

So the sort picker withholds relational fields and says so. To sort by a related
record's name, denormalize that name onto this object as a **stored field,
written when the source changes**, then sort by that field — the remedy the
server's own refusal prescribes, in the same words the sort panel's hint uses.

**Not a formula field.** A formula value is computed on read, so no driver
materializes a column behind it, and since `objectstack#6994` the server answers
a sort that names one with a hard `400 INVALID_SORT` (before that it degraded
silently: the rows came back in an arbitrary order under a `200`, `asc` and
`desc` identical). The picker withholds formula fields for the same reason
(`objectui#4243`), so there is no formula column here to sort "like any other
text column" — the column you sort is the stored one the denormalization writes.

A field the view's CURRENT sort already uses stays listed under both rules —
relational ones labelled `(by ID)` — so existing view metadata round-trips
instead of silently losing its sort, and a sort the server would refuse can
still be edited away in the picker that otherwise hides its field.

Column-header sorting inside the grid follows the **same two rules**, because a
header click is a server `$orderby` as well whenever the grid is showing one
window of a larger collection (`objectui#3106`) — not a client-side reorder of
the loaded rows. So on that path a relational or formula column carries no
clickable header either (`objectui#3950`); offering one would have been the same
illusion through a different control.

Where the sort really does stay in the browser — inline `data` — both kinds of
header stay live and order by the value the cell shows: the resolved label for
a relational column, the server-hydrated result for a formula one (see
`getSortValue` in `@object-ui/core`).

## View Persistence

The ListView automatically persists the user's view type preference in localStorage using the key `listview-{objectName}-view`.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-list)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-list)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
