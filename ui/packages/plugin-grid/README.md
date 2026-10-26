# @object-ui/plugin-grid

Grid plugin for Object UI - Advanced data grid with sorting, filtering, and pagination.

## Features

- **Data grid** — enterprise-grade grid over one ObjectQL object
- **Sorting** — per column (`ListColumn.sortable`), with an initial `sort` order
- **Filtering & search** — a metadata `filter` on the query, plus a toolbar search
  over `searchableFields`
- **Pagination** — `pagination: { pageSize, pageSizeOptions }`
- **Row selection** — `selection: { type: 'single' | 'multiple' }`
- **Inline editing** — `editable`, persisted through the host's data source

## Installation

```bash
pnpm add @object-ui/plugin-grid
```

Then import the stylesheet this package publishes, after the base sheets. It is a
supplement — compiled against the `@object-ui/components` theme with that sheet's
rules subtracted — so the order matters, and without it the grid renders with no
themed styling at all ([#4929](https://github.com/objectstack-ai/objectui/issues/4929)):

```css
/* src/index.css */
@import "tailwindcss";
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
@import "@object-ui/plugin-grid/style.css";
```

## Usage

### Registration is a side effect of the import

There is no registration call to make. Importing the package entry once runs the
three `ComponentRegistry.register(…)` calls in `src/index.tsx`, and from then on
the schema types below resolve:

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-grid';

// The data grid is `object-grid`, and it queries an object — see below for why
// this is not `type: 'grid'`. Its props go in the node's `properties` bag.
const schema = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: ['name', 'email']
  }
};
```

### The schema types this package claims

`register(type, component, { namespace })` publishes `namespace:type`, and — unless
`skipFallback` is set — the bare `type` as a back-compat fallback
(`packages/core/src/registry/Registry.ts:194`, fallback at `:226-240`). So the
two calls in `src/index.tsx` claim exactly these keys:

| `register(…)` call | Namespaced key | Bare fallback |
| --- | --- | --- |
| `('object-grid', ObjectGridRenderer, { namespace: 'plugin-grid' })` | `plugin-grid:object-grid` | `object-grid` |
| `('grid', ObjectGridRenderer, { namespace: 'view', skipFallback: true })` | `view:grid` | **none** — `skipFallback: true` |

The `import-wizard` node key is RETIRED (objectui#10859 batch 8): no schema
produced it, and `objectui validate` refused it at `type`. `ImportWizard` is still
exported, and `@object-ui/app-shell` mounts it directly (the object view's import
flow).

**Bare `grid` is deliberately not ours.** `skipFallback: true` on the second call
keeps this plugin from claiming it, because `grid` belongs to the CSS Grid *layout*
container in `@object-ui/components`
(`src/renderers/layout/grid.tsx:50`), whose schema type is `GridSchema` in
`@object-ui/types` (`src/layout.ts:202` — `columns` there is a **column count**,
not a column list). A schema written as `{ type: 'grid', columns: [...] }` therefore
renders that layout container, not this data grid. Use `object-grid`, or `view:grid`
when you want the namespaced spelling.

### Registering the renderer under your own key

If you need the data grid under an additional key, register the exported renderer
directly — that is what a "manual registration" is here:

```typescript
import { ObjectGridRenderer } from '@object-ui/plugin-grid';
import { ComponentRegistry } from '@object-ui/core';

ComponentRegistry.register('my-grid', ObjectGridRenderer, {
  namespace: 'my-app',
  label: 'My Grid',
  category: 'plugin',
});
```

### Exports

The complete public surface — 20 values and 29 types:

```typescript
import {
  ObjectGrid,
  ObjectGridRenderer,
  VirtualGrid,
  SplitPaneGrid,
  ImportWizard,
  InlineEditing,
  FormulaBar,
  GroupRow,
  RowActionMenu,
  BulkActionBar,
  formatActionLabel,
  inferColumnType,
  parseSpreadsheetFile,
  parseClipboardTable,
  useCellClipboard,
  useColumnSummary,
  useGradientColor,
  useGroupReorder,
  useGroupedData,
  useRowColor,
} from '@object-ui/plugin-grid';

import type {
  ObjectGridComponentProps,
  ObjectGridColumnState,
  ObjectGridExternalPaginationProps,
  ObjectGridProps, // deprecated alias of ObjectGridComponentProps (objectui#4650)
  VirtualGridProps,
  VirtualGridColumn,
  SplitPaneGridProps,
  ImportWizardProps,
  ImportResult,
  InlineEditingProps,
  FormulaBarProps,
  GroupRowProps,
  RowActionMenuProps,
  BulkActionBarProps,
  GroupEntry,
  UseGroupedDataResult,
  AggregationType,
  GroupAggregationConfig,
  AggregationResult,
  CellRange,
  UseCellClipboardOptions,
  UseCellClipboardResult,
  GradientStop,
  UseGradientColorOptions,
  UseGroupReorderOptions,
  UseGroupReorderResult,
  ColumnSummarySetting,
  ColumnSummaryType,
  ColumnSummaryResult,
} from '@object-ui/plugin-grid';
```

The *schema* types are not here — they live in `@object-ui/types`
(`ObjectGridSchema`, `ListColumn`), because the schema is the shared authoring
contract rather than this package's component API.

## Schema API

### Grid

An authored grid node takes its props in its `properties` bag, whose members are
`@objectstack/spec`'s `ComponentPropsMap['object-grid']` row (`ObjectGridProps`):
one required `objectName` — or the node's `dataSource` binding naming the object —
and keys drawn from the list this package **declares** as its authoring surface
(`GRID_QUERY_INPUTS` in `src/index.tsx`) — the same list that feeds the designer
panel and the generated `sdui-intrinsics.d.ts`, so what is authorable here is what
the renderer reads. `objectui validate` judges the bag against that row and
refuses a prop written flat on the node by name, naming where it goes
(`Did you mean objectName → properties.objectName?`), as the spec's own page
component does (objectui#11276). `SchemaRenderer` hoists the bag onto the node
before the grid runs, so `ObjectGridSchema` (`@object-ui/types`) is the node as the
grid reads it — and the type of `<ObjectGrid>`'s `schema` prop.

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const grid: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: ['name', 'email'],
    sort: [{ field: 'created', order: 'desc' }],
    pagination: { pageSize: 20 },
    selection: { type: 'multiple' },
  } satisfies ObjectGridProps,
};
```

| Key (in `properties`) | Type | Notes |
| --- | --- | --- |
| `objectName` | `string` (**required**) | The object queried. There is no `object`. |
| `columns` | `string[] \| ListColumn[]` | Field names or column objects — see below. |
| `label` | `I18nLabel` | Table caption and export title. |
| `description` | `I18nLabel` | One line of help text above the grid — see `description` and `emptyState` below. |
| `emptyState` | `EmptyState` (`@objectstack/spec/ui`) | `{ title?, message?, icon?, link? }`, drawn in place of an empty table — see below. |
| `filter` | `ViewFilterRule[]` | Lowered to `$filter`. |
| `sort` | `[{ field, order }]` | Initial order; a header click replaces it. |
| `pagination` | `PaginationConfig` | `{ pageSize?, pageSizeOptions? }` — **strict**, and its presence is what enables paging. |
| `searchableFields` | `string[]` | A non-empty list is what enables the toolbar search. |
| `data` | `ViewData` | Bypasses the object query — see [Inline data](#inline-data). |
| `selection` | `SelectionConfig` | `{ type: 'none' \| 'single' \| 'multiple' }`. |
| `rowActions` / `bulkActions` | `string[]` | **Names** of actions, not definitions. |
| `editable` / `singleClickEdit` | `boolean` | Inline editing — see [Inline Editing](#inline-editing). |
| `keyboardNavigation` | `boolean` | Arrow keys move focus between cells, and the cells are one Tab stop — see [Keyboard navigation](#keyboard-navigation). On by default when the grid renders editable. |
| `navigation` | `NavigationConfig` | What a row click does, `{ mode: 'page' \| 'drawer' \| 'modal' \| 'split' \| 'none', … }`. |
| `operations` | `object` | Toggles the built-in CRUD/export/import affordances, e.g. `{ delete: false }`. |
| `rowHeight`, `frozenColumns`, `resizable`, `reorderableColumns`, `showColumnTypeIcons`, `rowColor`, `conditionalFormatting`, `aggregations`, `exportOptions` | | The rest of the declared surface. (`className` is a base prop: it stays on the node, beside the bag.) |
| `grouping` | `GroupingConfig` | Row grouping — **server-side**: group set, counts and aggregations come from the query, rows are paged per group; see [Grouping is server-side](#grouping-is-server-side). |

**There is no `sortable`, `filterable`, `onRowClick`, `onSelectionChange`,
`onCellChange`, `onRowSave`, `onBatchSave` or `object` on this schema.** The
booleans do not exist at all; the five `on*` names are **component props**
(`ObjectGridComponentProps`), which no metadata document can carry — see
[Row callbacks are component props](#row-callbacks-are-component-props).

#### `description` and `emptyState`

Two keys the grid honours (objectui#11068). The upstream protocol's `object-grid`
row declares both (objectstack#20694), so both are bag members and both are in
`GRID_QUERY_INPUTS` (objectui#11227):

- `description` — one line of help text drawn above the grid. A string, or an
  inline locale map resolved against the display locale the way `label` is.
- `emptyState: { title?, message?, icon?, link? }` — the list view's own
  empty-state shape (`EmptyState`), drawn **in place of** an empty table: a
  Lucide `icon`, a `title` (default: the table's own "No results found"), a
  `message` (default: none) and one `link: { label, url }` the user follows
  (default: none; objectui#12270). `title`, `message` and the link's `label`
  each take a string or an inline locale map, resolved against the display
  locale; a map with no usable entry keeps that member's default, and a link
  whose label resolves to no text is not drawn. The link is followed as a
  `type: 'url'` action through the action runner, so it opens what such an
  action opens: an in-app path (`/…` or `./…`) in place, an `http(s)://`
  address as the runner opens an external target, and `mailto:` in place; the
  runner refuses anything else at the click and reports it. It is not drawn when
  a term typed into the grid's own server-side search box is what emptied it —
  the table and its search box stay, so the term can be cleared. Leave the key
  out and an empty grid draws the table's own empty row, as before.

```json
{
  "type": "object-grid",
  "properties": {
    "objectName": "contacts",
    "description": "Everyone you work with",
    "emptyState": {
      "title": { "en": "No contacts yet", "fr": "Aucun contact" },
      "message": "Add one to get started",
      "icon": "users",
      "link": { "label": "How contacts work", "url": "/docs/contacts" }
    }
  }
}
```

Written flat on the node, either key is refused by name and pointed at the bag
(`description` → `properties.description`), as the spec's own page component
refuses it. Until the row declared `description`, this page told you to write it
on the node; that is now the refused spelling.

`keyboardNavigation`, the third key objectstack#20694 added to the row, is
honoured too (objectui#11068) and is in `GRID_QUERY_INPUTS` — see
[Keyboard navigation](#keyboard-navigation). The row's own description may still
carry the `[EXPERIMENTAL — not enforced]` marker it was published with before this
build; the installed row (`ComponentPropsMap['object-grid']`) is the place to read
its current text.

`name`, `placeholder`, `rowSpecActions` and `bulkSpecActions` are **retired** on
this node (objectui#11068): nothing ever read them, and both faces of
`@object-ui/types` refuse them by name. Write `id` or `label`,
`emptyState: { message }`, `rowActions` and `bulkActions` instead.

### Column Definition

A column is either a **field name** (`'name'`) or a `ListColumn` object. `ListColumn`
is declared by `@objectstack/spec/ui` (`ListColumnSchema`) and re-exported from
`@object-ui/types`; it is the type of `ObjectGridSchema['columns']`, so it is the
same column vocabulary the saved-view metadata uses.

| Key | Type | Meaning |
| --- | --- | --- |
| `field` | `string` (**required**) | The field this column reads. There is no `accessorKey`. |
| `label` | `string \| Record<string, string>` | Header text, or an inline locale map. There is no `header`. |
| `width` | `number` | Column width in pixels. |
| `align` | `'left' \| 'center' \| 'right'` | Cell alignment. |
| `hidden` | `boolean` | Hidden by default, revealable in the column chooser. |
| `sortable` | `boolean` | Allow sorting on this column. |
| `resizable` | `boolean` | Allow dragging this column's width. |
| `wrap` | `boolean` | Wrap long cell text instead of eliding it. |
| `type` | `string` | Override the rendered cell type instead of inferring it from the field. |
| `pinned` | `'left' \| 'right'` | Freeze the column to one edge. |
| `summary` | `ColumnSummary \| { type; field? }` | Footer aggregation — see [Column Summaries](#column-summaries). |
| `prefix` | `{ field: string; type?: 'text' \| 'badge' }` | Render a second field inline before the value. |
| `link` | `boolean` | Render the value as a link to the record. |
| `action` | `string` | Run a named action when the cell is clicked. |

`ListColumnSchema` is a **strict** Zod object, so an unknown key is rejected rather
than ignored — a column is spelled this one way.

```typescript
import type { ListColumn } from '@object-ui/types';

const columns: ListColumn[] = [
  { field: 'name', label: 'Full Name', width: 200, sortable: true, pinned: 'left', link: true },
  { field: 'stage', type: 'select', prefix: { field: 'health', type: 'badge' }, wrap: true },
  { field: 'amount', type: 'currency', align: 'right', summary: 'sum', resizable: true },
  { field: 'owner_id', label: { en: 'Owner', 'zh-CN': '负责人' }, hidden: true, action: 'reassign' },
];
```

### Column Summaries

A column can declare a footer aggregation with `summary`, either as a shorthand
string or as an object that aggregates a different field than the one displayed:

```json
{
  "columns": [
    { "field": "name", "summary": "count_filled" },
    { "field": "amount", "type": "currency", "summary": "sum" },
    { "field": "owner", "summary": { "type": "count_unique", "field": "owner_id" } }
  ]
}
```

The accepted values are `ColumnSummarySchema` from `@objectstack/spec`:

| `summary` | Footer shows | Reads |
|---|---|---|
| `none` | nothing — the column opts out | — |
| `count` | number of rows | every row |
| `count_filled` | rows whose cell is non-empty | raw values |
| `count_empty` | rows whose cell is empty | raw values |
| `count_unique` | distinct non-empty values | raw values |
| `percent_filled` | share of rows that are non-empty | raw values |
| `percent_empty` | share of rows that are empty | raw values |
| `sum` | total | numeric values |
| `avg` | mean | numeric values |
| `min` | smallest | numeric values |
| `max` | largest | numeric values |

A cell counts as empty when it is `null`, `undefined`, `""` or an empty array,
so an unset multi-select or lookup reads as empty rather than as a filled `[]`.

The count and percent families read raw cell values, so they work on text,
select and lookup columns. `sum`/`avg`/`min`/`max` need numeric values (numeric
strings are parsed) and render nothing when the column has none.

A `currency` or `percent` column formats its `sum`/`avg`/`min`/`max` in that
unit. Counts stay plain cardinalities and percentages carry their own `%`, so
`count_unique` on a currency column reads `Unique: 3`, not `$3.00`.

The unit comes from the column's `type`, or its object field's. Every other
formatting hint (`currency`, `defaultCurrency`, `currencyConfig`, `precision`,
`scale` and `max`) is read off the object field only, the way the list cell
reads it. `ListColumnSchema` declares none of them, so a column that carries one
does not change the footer (objectui#11588).

A `percent` column's aggregate takes both halves of the percent rule from the
same place the list cell above it does — the storage its field declares for
the fraction-vs-points scaling (the spec's `percentScaleOf`: a fraction unless
the field declares a `max` above 1, read through `percentCellScale` in
`@object-ui/fields`, never guessed from the value), and the session locale's
own percent convention for the sign — so the footer and the cells never read
under two conventions. On a column whose field declares `max: 100`, a sum of
`1234.5` renders `Sum: 1,235%` in `en`, `Sum: 1.235 %` in `de-DE` (no-break
space before the sign) and `Sum: %1.235` in `tr-TR`, where the sign goes in
front of the number (objectui#9269); on a fraction-stored column a sum of `1`
renders `Sum: 100%`. The width
is what `resolveFieldScale` in `@objectstack/spec/data` resolves for the field:
its declared `scale`, or, when it declares none, the protocol's own width for a
percent — the answer the list cell, the record header's summary chip and the
percent edit widget read too, so an undeclared percent shows one width on every
face (objectui#9843). It is never the field's `precision` (objectui#9295).

A `number` column's aggregate reads the same resolver. A declared `scale` is a
fixed width (`Sum: 1.50`); a `number` declaring none has no fixed width, and the
footer rounds the computed result to the most decimal places any of the values
it was computed from carried — an average of `1`, `2`, `2` reads `Avg: 2`, and a
sum of `0.1` and `0.2` reads `Sum: 0.3` (objectstack#19628, objectui#9843). A
column with no `type` keeps the plain widths it always had.

**Which rows the figures describe (objectui#12081).** The footer is drawn
beside the count of the matched set, so its figures are that set's. When the
grid holds every matched row (rows handed in whole, or one page that holds every
match) they are computed from those rows. When the grid holds one page of a
larger set — it pages on the server, or a host such as `ListView` hands it one
page with `manualPagination`, `rowCount` and `findParams` — it asks the data
source for the whole set's figures in ONE aggregate query through
`queryGroupHeaders`, with no `groupBy`: the query behind the rows (its filter,
search and search fields), without its page, sort or projection. Turning the
page or sorting asks nothing; a refresh or a write to the object asks again.
A grid whose columns declare no summary that maps to an aggregate (none at
all, only `none`, or only unknown members) has no footer and asks nothing.
These figures are the server's, so "empty" means a stored `null`. The answer is
used only when its row count equals the count the grid shows. Otherwise the
footer shows the page's figure and says so: `Sum (this page): 32,500`. That is
the case when the data source has no `queryGroupHeaders`, refuses the query or
answers without one row, when the query carries a key this read cannot repeat,
and when the count shown is an estimate. The platform's paged count under a
search is one.

The footer row renders only when at least one column resolves to a summary — a
view whose columns are all `none` (or carry no `summary`) has no footer.

## Examples

Every example below checks its bag with `satisfies ObjectGridProps` (the spec's
row type), which is the point: an un-annotated `const schema = { … }` type-checks
no matter what is written in it, so a snippet that carries no annotation cannot
tell you whether its keys are real.
And note the `type` — `object-grid`, never `grid`. Bare `grid` renders the CSS Grid
*layout container* from `@object-ui/components`
([above](#the-schema-types-this-package-claims)), which is how a copied example ends
up leaking `columns="[object Object]"` into the DOM instead of drawing a table
(objectui#4787).

### Basic Grid

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: [
      { field: 'name', label: 'Name', width: 200, sortable: true },
      { field: 'email', label: 'Email' },
      { field: 'role', label: 'Role' },
      { field: 'status', label: 'Status', type: 'select' },
    ],
    sort: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 20 },
  } satisfies ObjectGridProps,
};
```

Sorting is declared **per column** (`ListColumn.sortable`) — there is no top-level
`sortable` switch, and none is needed: a column is sortable by default, so the key
is there to turn one off.

### Inline data

A grid normally queries `objectName`. To render fixed rows instead — demos,
fixtures, tests — give it a `ViewData` with the `value` provider. The rows go
under `items`; a bare array is the deprecated `staticData` spelling.

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
    ],
    data: {
      provider: 'value',
      items: [
        { id: 1, name: 'John Doe', email: 'john@example.com', status: 'Active' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', status: 'Active' },
      ],
    },
  } satisfies ObjectGridProps,
};
```

### Cell appearance

A column does not carry a render function. What it can say is which **cell type**
to use and how to decorate the value — the same vocabulary the saved-view metadata
uses, so a grid authored by hand and one authored in the designer render alike.

```typescript
import type { ListColumn } from '@object-ui/types';

const columns: ListColumn[] = [
  { field: 'status', type: 'select' },
  { field: 'amount', type: 'currency', align: 'right', summary: 'sum' },
  { field: 'name', link: true, prefix: { field: 'health', type: 'badge' } },
  { field: 'owner_id', action: 'reassign' },
];
```

`link: true` renders the value as a link to the record and `action: 'reassign'`
runs a named action on click — that is the metadata form of the "Actions column"
a render function used to be written for. A genuinely custom cell **renderer** is
a component-layer concern: `VirtualGridColumn.cell` on `VirtualGrid`, a React prop,
not an authoring key.

Once the grid has loaded its object schema, a `password` or `secret` field draws a
mask (`••••••`), and the grid withholds its raw value on these paths: Ctrl+C / Cmd+C on the cell copies nothing, the cell has no
tooltip, it never enters inline edit, the table's CSV export and the grid's own
client export (CSV and JSON, used when the data source has no server export) leave
it out, the mobile card draws it through its cell, and it cannot be a grouping key
(a grouping entry on it is ignored with a console warning). The grid decides this
with `isMaskedFieldType()` from `@object-ui/fields` and passes it to the table as the
column's `masked` flag (see the data table's "Masked columns"). A column `type`
authored over such a field (`type: 'text'` on a `secret` field) cannot lift the
refusal, though such a cell then draws the value as the text it was told to be.

The table also leaves such a column out of its client-side search, disables its sort,
and sizes it from its header rather than its values (objectui#10657, which folded
objectui#10658).

Before the object schema has loaded — on the host-fetched path (rows handed down as
`data`), the rows paint first — an untyped view column is **withheld**: it draws the
mask, never its value as text, and every path above treats it as masked (a grouping
entry on it is ignored, without a warning, until the schema is in). It stays withheld
when the schema read fails. A column that authors its own `type` draws from it
meanwhile. The record panel a row opens under overlay navigation draws every value as
the mask in that window too.

A host that already holds the object's definition passes its `fields` to the grid as
the `objectFields` prop, beside the `data` it fetched, and the grid answers from them
until its own read lands, so there is no such window; `ListView` does this
(objectui#10657, which folded objectui#10706). `objectFields` is a runtime prop only:
an `objectFields` key authored in the schema never reaches the grid.

Not covered:

- The server-streamed export (`exportDownload`) sends the masked columns as before
  and relies on the server's masking.
- The client JSON export writes an expanded lookup record whole, so a credential
  field of the related object is not pruned.

### Selectable Grid

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: ['name', 'email'],
    selection: { type: 'multiple' },
    bulkActions: ['delete', 'export'],
  } satisfies ObjectGridProps,
};
```

`selection.type` is the canonical spelling; the boolean `selectable` is a
deprecated legacy alias, read only when `selection` is absent. Declaring bulk
actions auto-enables multi-select, so the two keys agree by construction.

To react to a selection in React, pass the `onRowSelect` **component prop** —
see [Row callbacks are component props](#row-callbacks-are-component-props).

### Grid with Pagination

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: ['name', 'email'],
    pagination: { pageSize: 10, pageSizeOptions: [10, 20, 50, 100] },
  } satisfies ObjectGridProps,
};
```

`PaginationConfig` is a **strict** object of exactly `pageSize` and
`pageSizeOptions` — there is no `showSizeChanger`, and none is needed: the pager
always carries a rows-per-page picker, and `pageSizeOptions` only replaces the
choices it offers with your own.

With no `pageSize` declared, every page the grid shows — the server-paged table,
the table over inline `data`, the grouped view's page of groups, and a group's
own page of rows — uses the default `@objectstack/spec` declares for
`pagination.pageSize`; the grid reads it from the spec rather than keeping a
number of its own. Declare `pagination.pageSize` to choose the count yourself.
A window of rows the grid groups in the browser, because the server does not
group it, is not a page: undeclared, it is a fixed fetch batch of the grid's
own, and it does not follow the display default.

### Grouping is server-side

`grouping` is answered by the **server**, not by bucketing the records the
browser happens to hold (objectui#7189, maintainer ruling A). The set of groups
and every number in a group header — the count and any per-group aggregation —
are properties of the query; the rows inside a group are paged.

A grouped grid that fetches its own rows asks its data source for the group
headers — the query `@objectstack/spec/ui`'s `compileListViewGroupQuery`
compiles, sent through `dataSource.queryGroupHeaders` (the ObjectStack adapter
posts it to `POST /data/:object/query`) — and then pages each **open** group's
rows with that group's own query (`compileListViewGroupRowsQuery`: the view's
filter AND the group's key, `limit` / `offset` per group). So:

- Every group appears, with its **true size**, whatever the page size and
  whatever order the rows are stored in — a store of 186 records over five
  units renders five headers reading 86/61/31/7/1.
- A group larger than the page gets its **own pager**, and turning it asks the
  server for that group's next page, so every record is reachable.
- A collapsed group costs no row query at all.
- `aggregations` are computed by the same header query, over the group's whole
  row set.
- Multi-level grouping asks one header query per level, so an outer header's
  numbers are that level's own (an average is never an average of averages).
- A `lookup` / `master_detail` / `user` grouping key is the referenced record's
  id on the wire; the grid labels it from the referenced record.

When a `ListView` hosts the grid (the console's list views) over a data source
that answers the group header query, it hands a grouped grid its own fetch and
the view's effective filter, rather than a window of rows.

**Rows handed in whole** (`data: { provider: 'value', items }`, or a host's
whole result set) are grouped where they are, in the browser: nothing was
withheld, so the grouping is exact. The grid takes rows a host hands it to be
the whole set — unless that host declares them one page of more
(`manualPagination`, `onPageChange` and a `rowCount` above the rows it
handed). A grouped grid refuses such a window with an error saying grouping
needs every record; hand the rows in whole, or let the grid fetch them.

**Everything else needs the group header query** (objectui#10881). Over a data
source that declares no `queryGroupHeaders`, a grouped grid that fetches its
own rows does not group a page of them — every count would be a page slice,
and a group whose records all fall past the page would be missing. It shows an
error naming `queryGroupHeaders` instead, and asks for no rows. A `ListView`
makes the same refusal before it mounts such a grid. To group, implement
`queryGroupHeaders` on the data source, or hand the rows in whole.

A **search** term the grid queries with goes on the group header query and on
every group's row query, as one pair (`search` / `searchFields`, which the
header query declares beside `where`): the headers count the
searched rows, and the rows under them are those rows (objectui#11021). The
term is the one typed into the grid's box, or the one a host hands down as the
`search` prop: a host that passes `search` owns the term even where the grid
fetches for itself. That is how a `ListView` hands its toolbar search to the
grid that groups for it, with the view's `searchableFields` on the grid's node.

## Integration with Data Sources

**The adapter is not a schema key.** A schema is a serialisable document; a live
adapter is an object with methods, so it cannot travel in one. The grid reads its
adapter from React context — `useSchemaContext()` at `src/index.tsx:80` — which the
host installs once, above the whole tree:

```tsx
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import '@object-ui/plugin-grid';
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-auth-token',
});

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'created', label: 'Created', type: 'datetime' },
    ],
    filter: [{ field: 'status', operator: 'equals', value: 'active' }],
    searchableFields: ['name', 'email'],
    pagination: { pageSize: 20 },
  } satisfies ObjectGridProps,
};

export const App = () => (
  <SchemaRendererProvider dataSource={dataSource}>
    <SchemaRenderer schema={schema} />
  </SchemaRendererProvider>
);
```

The object comes from `objectName`; there is no `object` key. Filtering is the
metadata `filter` (lowered to `$filter`) and search is `searchableFields` (lowered
to `$searchFields`) — a non-empty list is what puts the search box in the toolbar.

> A top-level `dataSource` **does** mean something on a schema node, but it is not
> this: it is the spec's element **binding** (`PageComponentSchema.dataSource`,
> objectstack#6953) — a descriptor such as `{ object: 'users', view: 'my_view' }`,
> resolved by `useElementDataSource`
> (`packages/react/src/hooks/useElementDataSource.ts:139`) and mapped onto this
> grid's keys by the gate at `src/index.tsx:88`. Handing that slot a live adapter is
> rejected on purpose: the predicate refuses any value carrying a `find` method
> (`packages/core/src/data-scope/element-data-source.ts:131`), so an adapter written
> there is silently ignored rather than mistaken for a binding. Pass adapters
> through the provider above; see the spec for the binding's own surface.

## Features

### Sorting

Columns sort by default. `sortable` is a **per-column** key, used to turn a column
off; the grid-level `sort` declares the order the grid opens with.

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    sort: [{ field: 'created', order: 'desc' }],
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email', sortable: false },
    ],
  } satisfies ObjectGridProps,
};
```

### Filtering and search

There is no per-column filter key. A grid narrows its query two ways: a `filter`
baked into the metadata, and a toolbar search over the fields named in
`searchableFields`.

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    filter: [
      { field: 'status', operator: 'equals', value: 'active' },
      { field: 'created', operator: 'after', value: '2026-01-01' },
    ],
    searchableFields: ['name', 'email'],
    columns: ['name', 'email', 'status'],
  } satisfies ObjectGridProps,
};
```

### Row Actions

`rowActions` and `bulkActions` are lists of **action names** — the actions
themselves live in the object's action set, so the same action behaves identically
wherever it is offered. They are `string[]`, not inline definitions with callbacks.

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: ['name', 'email'],
    rowActions: ['view', 'edit', 'delete'],
    selection: { type: 'multiple' },
    bulkActions: ['delete', 'export'],
  } satisfies ObjectGridProps,
};
```

### Row callbacks are component props

`onRowClick`, `onRowSelect`, `onCellChange`, `onRowSave`, `onBatchSave`, `onEdit`,
`onDelete`, `onBulkDelete` and `onAddRecord` are React props on
`ObjectGridComponentProps` — they are functions, so no metadata document can hold
them, and writing one into a schema does nothing at all: the grid builds the inner
table's handlers itself and never reads any of these nine off the schema.

The one callback the grid does read off the schema is `onNavigate`, declared on
`ObjectGridSchema` for programmatic callers only. It is a function value too, so
it is no more authorable than the nine — it is deliberately absent from the
manifest and the designer panel, and prefer passing it as a prop
(objectui#5234, maintainer ruling of 2026-08-19).

```tsx
import { ObjectGrid } from '@object-ui/plugin-grid';
import type { ObjectGridComponentProps } from '@object-ui/plugin-grid';

export const Grid = (props: ObjectGridComponentProps) => (
  <ObjectGrid
    {...props}
    onRowClick={(record) => console.log('Row clicked:', record)}
    onRowSelect={(rows) => console.log('Selection changed:', rows)}
  />
);
```

Note `onRowSelect` — the prop that reports a selection change is spelled that way;
there is no `onSelectionChange` on this component.

The declarative alternative, which *is* metadata and survives a round trip through
storage, is `navigation`: `{ mode: 'page' | 'drawer' | 'modal' | 'split' | 'none' }`
decides what a row click does without any host code.

### Withholding a row's Edit or Delete

`operations` and the `onEdit` / `onDelete` wiring are GRID-level: they decide
whether the generic Edit / Delete entries exist at all, identically for every
row. When the refusal belongs to one RECORD — a system field a designer may not
drop — use `rowOperations`, a component prop called with a row record that
answers for that row alone. Mounting `<ObjectGrid>` directly hands it the node as
it reads it, so its `schema` prop is the flat `ObjectGridSchema`, with no bag:

```tsx
import { ObjectGrid } from '@object-ui/plugin-grid';
import type { ObjectGridSchema } from '@object-ui/types';

const schema: ObjectGridSchema = {
  type: 'object-grid',
  objectName: 'field_definition',
  columns: ['name', 'label', 'type'],
};

export const FieldList = ({ isSystem }: { isSystem: (name: string) => boolean }) => (
  <ObjectGrid
    schema={schema}
    onEdit={(record) => console.log('edit', record)}
    onDelete={(record) => console.log('delete', record)}
    rowOperations={(record) => ({ delete: !isSystem(String(record.name)) })}
  />
);
```

It speaks the same `update` / `delete` vocabulary as the authored `operations`
block, and it is an **intersection**, never a union: `false` withholds the
entry, while `true`, an omitted member, and a `null` / `undefined` return all
leave the grid's own verdict alone. Nothing it returns can re-open what the
object's lifecycle bucket, its `userActions`, the server's effective operations,
the principal's grant or the record-level verdict already closed — and a grid
that passes no `rowOperations` renders exactly as it did before the prop
existed.

Prefer this over refusing inside the callback. A refusal that runs after the
click ships a button that is drawn as available and then does nothing, which is
indistinguishable from a broken build (objectui#8674).

### A node beside a row's title

A host that has something to say about one record, next to its name, passes
`rowAdornment`: a component prop called with a row record that returns a React
node, or `null` for none. The grid draws it in the cell of the object's
declared `nameField` when a column shows that field, else in the first shown
column (never in the row actions), and beside the card's title in the card
view. It is drawn after the cell's own content and never in place of it, so
the value, its link and its mask stay as they were. A grid that passes no
`rowAdornment` renders exactly as it did before the prop existed. It is a host
prop, not a schema key: list metadata cannot set it.

```tsx
import { ObjectGrid } from '@object-ui/plugin-grid';
import type { ObjectGridSchema } from '@object-ui/types';

const schema: ObjectGridSchema = {
  type: 'object-grid',
  objectName: 'sys_user',
  columns: ['name', 'email'],
};

export const UserList = ({ needsAccess }: { needsAccess: (id: string) => boolean }) => (
  <ObjectGrid
    schema={schema}
    rowAdornment={(record) => (needsAccess(String(record.id)) ? <span>Not authorized</span> : null)}
  />
);
```

The console's Setup → Users list on a cloud-managed environment uses it to mark
a user who holds no permission set beyond the baseline (objectui#13330).

### Inline Editing

Enable inline cell editing for quick updates:

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'users',
    columns: [
      { field: 'id', label: 'ID' },
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'status', label: 'Status', type: 'select' },
    ],
    editable: true,
    singleClickEdit: false,
  } satisfies ObjectGridProps,
};
```

`editable` is the only switch: it is a grid-level flag, and edits persist through
the host's data source (`dataSource.update`) with no callback to wire.

**Inline Editing Features:**
- **Double-click to edit**: double-click any editable cell to enter edit mode
  (`singleClickEdit: true` opens it on the first click instead)
- **Keyboard shortcuts**:
  - Press `Enter` on a focused cell to start editing
  - Press `Enter` while editing to save changes
  - Press `Escape` to cancel editing
- **Per-field read-only**: which cells open is decided by the **field definition**,
  not by a column key — a field marked `readonly`, and computed/binary field types
  (formula, autonumber, file, …), never open an editor
  (`isFieldInlineEditable`, `src/inline-edit-options.ts:82`). There is no
  `editable` key on `ListColumn`.
- **Visual feedback**: editable cells show a hover state
- **Automatic focus**: the input is focused and selected when editing begins

**Use Cases:**
- Quick data corrections
- Batch data entry
- Spreadsheet-like editing experience
- Real-time updates with backend synchronization

### Keyboard navigation

`keyboardNavigation` turns the grid's data cells into one roving Tab stop, on the
WAI-ARIA grid pattern (objectui#11068):

```json
{
  "type": "object-grid",
  "properties": {
    "objectName": "users",
    "columns": ["name", "email", "status"],
    "keyboardNavigation": true
  }
}
```

- **One Tab stop.** Tab reaches the cells once — on the cell that last held
  focus, or the first cell of the first row — and the next Tab moves past them.
  A widget a cell renders (the record link, a row's action menu, a selection
  checkbox) keeps its own Tab stop.
- **Arrow keys** move focus one cell; **Home** / **End** go to the first / last
  cell of the row, and **Ctrl+Home** / **Ctrl+End** to the first / last cell of
  the page. At an edge, focus stays put.
- **Editing.** On an editable grid, Enter still opens the focused cell, and an
  open cell's editor keeps every key. An edit ended with Enter or Escape hands
  focus back to its cell, so the arrows carry on from there.
- **Default.** On when the grid renders editable — the authored `editable` *and*
  the viewer's permission to update the object, the same value inline editing
  obeys. A read-only grid keeps every cell its own Tab stop unless you write
  `true`, and `false` turns it off on an editable grid.
- While it is on, the table is exposed to assistive technology as a `grid`. A
  grouped grid navigates within each group's table; the mobile card layout has
  no cells and is unaffected.

### Batch Editing & Multi-Row Save

Edit multiple cells across multiple rows and save them individually or all at once:

The schema half is just `editable` — the save/cancel affordances appear on their
own once a row has pending changes:

```typescript
import type { ObjectGridBlockNode } from '@object-ui/types';
import type { ObjectGridProps } from '@objectstack/spec/ui';

const schema: ObjectGridBlockNode = {
  type: 'object-grid',
  properties: {
    objectName: 'products',
    columns: [
      { field: 'sku', label: 'SKU' },
      { field: 'name', label: 'Name' },
      { field: 'price', label: 'Price', type: 'currency', align: 'right' },
      { field: 'stock', label: 'Stock', type: 'number', align: 'right' },
    ],
    editable: true,
  } satisfies ObjectGridProps,
};
```

Left alone, saving goes through the host's data source. A React host that needs to
own persistence supplies `onRowSave` / `onBatchSave` as **component props** — and
because they are props, they take the adapter from the host's own scope rather than
from anything in the schema:

```tsx
import type { ObjectGridComponentProps } from '@object-ui/plugin-grid';

type Persistence = Pick<ObjectGridComponentProps, 'onRowSave' | 'onBatchSave'>;

const persistence = (
  dataSource: NonNullable<ObjectGridComponentProps['dataSource']>,
): Persistence => ({
  onRowSave: async (rowIndex, changes, row) => {
    await dataSource.update('products', row.id, changes);
  },
  onBatchSave: async (allChanges) => {
    await Promise.all(
      allChanges.map(({ row, changes }) => dataSource.update('products', row.id, changes)),
    );
  },
});
```

**Batch Editing Features:**
- **Pending changes tracking**: Edit multiple cells across multiple rows before saving
- **Visual indicators**: 
  - Modified rows are highlighted with amber background
  - Modified cells are shown in bold with amber text
  - Toolbar shows count of modified rows
- **Row-level actions**: Save or cancel changes for individual rows
- **Batch operations**: 
  - "Save All" button to save all modified rows at once
  - "Cancel All" button to discard all pending changes
- **Flexible callbacks** — all three are `ObjectGridComponentProps`, never schema keys:
  - `onRowSave`: called when saving a single row
  - `onBatchSave`: called when saving multiple rows at once
  - `onCellChange`: called for each staged cell edit
- **A concurrent write is refused, not overwritten**: the default saves send each
  row's `updated_at` as `If-Match`, and an editable grid asks for that column even
  when no column shows it. A row someone else saved after it was read answers
  `409`, which opens the record page's conflict dialog (Reload latest, Overwrite
  anyway, Cancel). "Save All" reports each row on its own: a refused row stays
  pending and flagged, and the rows that saved are cleared.
- **Each pending edit stays on its record**: edits are kept by the record's `id`,
  not by row position, so a re-read in a new order (a row save's refresh, the
  data-invalidation bus, a page change) draws and saves every edit on the record
  it was typed on. An edit whose record the current page no longer holds stays
  pending, and "Save All" still writes it to that record.
- **Editing during a save is kept**: cells stay editable while a row save or
  "Save All" is in flight, and the save clears only the values it sent. An edit
  made during the save, on any row or on the cell being saved, stays pending.

**Example Workflow:**
1. User edits multiple cells across different rows
2. Modified rows are visually highlighted
3. Toolbar shows "X rows modified" with Save All/Cancel All buttons
4. User can:
   - Save individual rows using row-level save button
   - Save all changes at once using "Save All" button
   - Cancel individual row changes or all changes

## TypeScript Support

The schema and column types come from `@object-ui/types`; this package exports the
*component* types. `ObjectGridSchema` types the component's `schema` prop — the
node as the grid reads it, after `SchemaRenderer` hoists an authored node's
`properties` bag onto it — so its keys sit flat here.

```typescript
import type { ObjectGridSchema, ListColumn } from '@object-ui/types';
import type { ObjectGridComponentProps } from '@object-ui/plugin-grid';

const nameColumn: ListColumn = {
  field: 'name',
  label: 'Full Name',
  sortable: true
};

const grid: ObjectGridSchema = {
  type: 'object-grid',
  objectName: 'users',
  columns: [nameColumn],
  pagination: { pageSize: 20 }
};

// Row callbacks are COMPONENT props, not schema keys.
const gridProps: ObjectGridComponentProps = {
  schema: grid,
  // TWO parameters (objectui#9357). The second is the modifier payload the grid
  // forwards from the DOM click — read `metaKey` / `ctrlKey` / `button` to
  // implement Cmd/Ctrl/middle-click yourself. It is optional in both
  // directions: a one-parameter handler like the one below stays valid.
  onRowClick: (record) => console.log('Row clicked:', record)
};

// The same prop, taking the payload:
const gridPropsWithModifiers: ObjectGridComponentProps = {
  schema: grid,
  onRowClick: (record, event) => {
    if (event?.metaKey || event?.ctrlKey || event?.button === 1) {
      window.open(`/users/${record.id}`, '_blank');
      return;
    }
    console.log('Row clicked:', record);
  }
};
```

`ObjectGridProps` is a deprecated alias of `ObjectGridComponentProps` and denotes the
same type; `@objectstack/spec/ui` owns the name `ObjectGridProps` for the *authored*
props document of the `object-grid` element (objectui#4650).

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-grid)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-grid)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
