# @object-ui/plugin-view

Object View plugin for Object UI - Unified component for displaying and managing ObjectQL data with automatic form and grid generation.

## Features

- **Automatic Views** - Generate views from ObjectQL schemas
- **Form Generation** - Auto-generate forms from object definitions
- **Grid Generation** - Auto-generate data grids
- **CRUD Operations** - Built-in create, read, update, delete
- **Field Mapping** - Automatic field type detection
- **Validation** - Schema-based validation
- **ObjectQL Integration** - Native ObjectStack support
- **View Controls** - View switcher, filter UI, and sort UI components

## Installation

```bash
pnpm add @object-ui/plugin-view
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-view';
import type { ObjectViewSchema } from '@object-ui/types';

// Now you can use view types in your schemas
const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users', // required — the ObjectQL object name
  defaultViewType: 'grid',
};
```

The object name key is **`objectName`**, and it is the only required key besides
`type`. There is no `object`, `viewMode`, `fields`, `mode` or `recordId` key on
this node — see "Schema API" below for the keys `ObjectView` actually reads.

### What the side-effect import registers

Registration is *only* a side effect of importing the package — the single
`import '@object-ui/plugin-view'` above is the whole of it. There is no
components map to iterate over: importing the entry point runs the
`ComponentRegistry.register(...)` calls in `src/index.tsx`, which claim these
schema types:

| Schema `type` | Namespaced key | Renderer |
| --- | --- | --- |
| `object-view` | `plugin-view:object-view` | `ObjectViewRenderer` |
| `view-switcher` | `view:view-switcher` | `ViewSwitcher` |
| `filter-ui` | `view:filter-ui` | `FilterUI` |
| `sort-ui` | `view:sort-ui` | `SortUI` |
| `view:simple` | `plugin-view:view:simple` | `SimpleViewRenderer` (container) |

Both spellings resolve — `register` stores the namespaced key *and* a bare-`type`
fallback (`ComponentRegistry.register` in `packages/core/src/registry/Registry.ts`,
its `!meta?.skipFallback` branch). Note the namespaces are not uniform:
`object-view` / `view:simple` register under `plugin-view`, the three control
components under `view`.

The bare `view` alias of `object-view` is RETIRED (objectui#10859 batch 8): it
named the same renderer as `object-view`, and `objectui validate` refused it at
`type`. Author `object-view`.

The `shared-view-link` node key is RETIRED too (objectui#10859 batch 8, phase 2b):
no schema produced it, and `objectui validate` refused it at `type`.
`SharedViewLink` is still exported (see below); mount the component directly.

`ObjectViewRenderer` is a thin internal wrapper — it pulls `dataSource` off the
renderer context and hands the schema to `ObjectView`. It is not exported,
because `ObjectView` itself takes `dataSource` as a **required prop**, not as a
schema key.

### Public exports

The package exports components, helpers and their types — not a registry map:

```typescript
import {
  ObjectView, // ObjectQL-integrated view: list + integrated create/edit
  ViewSwitcher, // registered renderer for `view-switcher`
  FilterUI, // registered renderer for `filter-ui`
  SortUI, // registered renderer for `sort-ui`
  SharedViewLink, // share-link control, mounted directly (its node key is retired)
  ViewTabBar, // horizontal strip of saved-view tabs
  ManageViewsDialog, // sortable dialog over every saved view
  deriveRecordSurface, // record schema -> drawer / modal / page surface
  deriveRecordFlowSurface,
  deriveOverlaySize,
  overlayWidthFor,
  RECORD_SURFACE_PAGE_THRESHOLD,
  deriveFieldOptions, // object fields -> picker options
  toFilterGroup, // filter rules -> FilterBuilderRowGroup (from @object-ui/components)
  toSortItems, // sort config ({ field, order }) -> SortItem[]
  VIEW_TYPE_LABELS,
  VIEW_TYPE_OPTIONS,
  isImageLikeField,
  isGeoLikeField,
  pickPreferredField,
  KANBAN_GROUP_PREFERRED,
  PRIMARY_DATE_PREFERRED,
  END_DATE_PREFERRED,
  TITLE_PREFERRED,
} from '@object-ui/plugin-view';

import type {
  ObjectViewProps,
  ViewSwitcherProps,
  FilterUIProps,
  SortUIProps,
  SharedViewLinkProps,
  ViewTabBarProps,
  ViewTabItem,
  AvailableViewType,
  ManageViewsDialogProps,
  RecordSurface,
  RecordFlow,
  RecordFlowContainer,
  RecordFlowSurface,
  OverlaySize,
  FieldOption,
} from '@object-ui/plugin-view';
```

To serve one of these components under a registry key of your own, register the
exported component under that key:

```typescript
import { ComponentRegistry } from '@object-ui/core';
import { ViewSwitcher } from '@object-ui/plugin-view';

ComponentRegistry.register('my-switcher', ViewSwitcher, {
  namespace: 'my-app',
});
```

## Schema API

### ObjectView

Unified view component for ObjectQL objects. The keys below are the ones
`ObjectView` reads off the schema node (`src/ObjectView.tsx`); every example in
this README is typed with `ObjectViewSchema` from `@object-ui/types`, so a
missing `objectName` fails to compile.

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const shape: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users', // required — ObjectQL object name
  title: 'Users',
  description: 'Everyone with an account',

  // --- List surface ---
  defaultViewType: 'grid', // grid | kanban | gallery | calendar | timeline | gantt | map
  listViews: { all: { label: 'All Users', columns: ['name', 'email'] } }, // named views; each needs `label` and `columns`
  defaultListView: 'all',
  table: { columns: ['name', 'email'] }, // grid configuration (see below)

  // --- Record surface (create / edit / read) ---
  layout: 'drawer', // drawer | modal | page
  form: { showSubmit: true }, // form configuration (see below)
  navigation: { mode: 'drawer' }, // row-click behaviour
  onNavigate: (recordId, mode) => {}, // required by layout/navigation 'page'

  // --- Toolbar ---
  showSearch: true,
  showFilters: true,
  showSort: true,
  showCreate: true,
  showViewSwitcher: false, // default false
  allowCreateView: false,
  viewActions: [{ type: 'share' }],

  // --- Built-in CRUD toggles ---
  operations: { create: true, read: true, update: true, delete: true },
};
```

Three structural facts this component's schema does **not** work the way an
older version of this README claimed:

- **`dataSource` is not a schema key.** It is a **required prop** of
  `ObjectViewProps` (`src/ObjectView.tsx`). Pass it to `<ObjectView>` directly,
  or let the registered renderer pull it off `SchemaRendererProvider` context.
  Putting `dataSource` inside the schema object does nothing.
- **There is no `viewMode`, and no per-record `mode` / `recordId`.** The list
  type is `defaultViewType` (plus `listViews` / `defaultListView`); create,
  edit and read are internal states of one record surface, opened by the
  toolbar's create button and by row actions, and rendered as a drawer, a modal
  or a page according to `layout`. Accordingly `ObjectViewSchema['form']` omits
  `mode` — the component sets it.
- **There are no `onCreate` / `onUpdate` / `onDelete` / `onSubmit` callbacks.**
  The component performs mutations itself through the `dataSource`. What you
  can author is `operations` (booleans that enable or disable each built-in)
  and `onNavigate(recordId, mode)`, which hands off to your router when the
  record surface is a page.

#### `table` and `form` sub-configuration

`table` carries grid configuration and `form` carries form configuration, but
`ObjectView` forwards a **fixed set of keys** from each rather than passing the
object through:

| Sub-config | Keys `ObjectView` forwards |
| --- | --- |
| `table` | read by name: `columns`, `fields`, `title`, `filter`, `sort`, `pagination`, `pageSize`, `selection`, `selectable`, `operations`, `className`; handed to the grid as written: `editable`, `singleClickEdit`, `frozenColumns`, `rowHeight`, `resizable`, `reorderableColumns`, `searchableFields`, `showSearch`, `showPagination`, `showColumnTypeIcons`, `conditionalFormatting`, `rowActions`, `bulkActions`, `bulkActionDefs`, `exportOptions`, `grouping`, `aggregations`, `rowColor`, `label` |
| `form` | `fields`, `customFields`, `sections`, `groups`, `layout`, `columns`, `title`, `description`, `subforms`, `buttons`, `defaults`, `initialValues`, `readOnly`, `showSubmit`, `submitText`, `showCancel`, `cancelText`, `showReset`, `className` |

`table` declares exactly these keys (objectui#10976). Any other grid key —
`emptyState`, `showFilters`, `description`, `keyboardNavigation`, the record
source (`data`, `staticData`), the row click (`navigation`, `onNavigate`: write
those on the `object-view` node), node-level keys such as `id`, `hidden` or
`style`, and the legacy aliases `batchActions` / `resizableColumns` (write
`bulkActions` / `resizable`) — has nothing to act on in the grid the view
draws, so TypeScript rejects it and the validator refuses it by name. Anything
else you put in `form` is ignored.

The keys handed to the grid as written reach the grid the registered renderer
draws. Where the active named view declares the same member (see below), the
named view wins and `table` is the fallback. A host that supplies
`renderListView` composes its own list and takes `columns`, `fields`, `filter`
and `sort` from `table`, as before.

> **`table.defaultFilters` is retired (objectui#12030).** It was the legacy
> spelling of `table.filter`, the same rule array. `@objectstack/spec` 18
> refuses `object-grid`'s `defaultFilters` by name (a retired-key tombstone,
> objectstack#11509), and neither `ObjectView` nor `ObjectGrid` reads it any
> more: a view that still carries it renders **unfiltered**. Rename the key to
> `filter`; the value does not change.

> **`table.defaultSort` is retired (objectui#5861).** It was the legacy
> single-entry spelling of `table.sort`. The installed `@objectstack/spec`
> protocol refuses `object-grid`'s `defaultSort` by name (a retired-key
> tombstone), and neither `ObjectView` nor `ObjectGrid` reads it any more:
> a view that still carries it renders **unsorted**. Rename the key to `sort`
> and wrap the value in an array — `defaultSort: { field: 'name', order: 'asc' }`
> becomes `sort: [{ field: 'name', order: 'asc' }]`.

Two of the forwarded `table` keys are pairs — a canonical `ObjectGridSchema`
key and the `@deprecated` legacy spelling it replaced. As of objectui#5102 the
canonical spelling **takes effect** on every rendering path (the grid, and the
non-grid `kanban` / `gallery` / `calendar` / `timeline` / `gantt` / `map`
renderers); the legacy spelling on the right keeps working as an alias, it is
just no longer the one to reach for:

| write this (canonical) | not this (legacy alias — still works) |
| --- | --- |
| `pagination: { pageSize, pageSizeOptions? }` | `pageSize: number` |
| `selection: { type: 'single' \| 'multiple' \| 'none' }` | `selectable: boolean \| 'single' \| 'multiple'` |

**Precedence when a key is written both ways** — `table: { pagination: {
pageSize: 10 }, pageSize: 50 }`, say — the canonical spelling wins. That is
`ObjectGrid`'s own existing resolution for the paging pairs
(`schema.pagination?.pageSize || schema.pageSize`; `if
(schema.selection?.type) … else if (schema.selectable !== undefined)`), and
`ObjectView` defers to it by forwarding both slots rather than re-resolving
the pair itself. `table.filter` reaches the grid in its one `filter` slot
(objectui#11880), unless it lowers to nothing (absent, `[]` or `{}`), so its
export carries the filter in force and a change to it returns the grid to
page 1:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'products',
  table: {
    pagination: { pageSize: 10 }, // wins
    pageSize: 50, // ignored while `pagination` is present
  },
};
```

`filter` / `sort` have one more tier ahead of `table` entirely, and it
predates this change: an **active named view's own** `filter` / `sort`
(`listViews.<name>.filter` / `.sort`) always outranks anything written on
`table`. In order, highest first: the active named view's `filter`/`sort`,
then `table.filter`/`table.sort`. Neither has a legacy tier: `table.defaultFilters`
and `table.defaultSort` are retired. (If you never write `listViews`, that
first tier never applies.)

Whichever tier wins, its filter goes through `resolveFilterPlaceholders` from
`@object-ui/core` before it leaves `ObjectView` (objectui#10506), on all three
paths: the query a non-grid view issues, the grid, and a host's
`renderListView`. So the spec's context tokens (`{current_user_id}`,
`{current_org_id}`) and the relative-date macros (`{today}`,
`{current_quarter_start}`, …) arrive as real values. The user and organization
come from the nearest `FilterScopeProvider` (`@object-ui/react`), which the
console shell mounts; with none mounted a context token is left as written and
the resolver warns. The filter is never widened: the ObjectStack server resolves
the literal token for a signed-in request and refuses the request otherwise
(the REST face answers 401 at its auth gate before the filter is read, and
where a guest context reaches the engine the resolver answers 400), and a
backend with no resolver of its own matches no record.
`src/__tests__/ObjectView.namedViewContextTokens-10506.test.tsx` pins each path.

`pagination` and `selection` have no such tier, and no effect
outside the grid — the non-grid renderers don't page or multi-select, so
`ObjectView` never forwards either spelling to them.

`columns` is the one forwarded `table` key that is **not** part of this
canonical/legacy story, and it has an unrelated gap: it is forwarded on the
grid path only, so on a non-grid `defaultViewType` the field list still comes
from `table.fields` (objectui#5269, open).

### ViewSwitcher

Toggle between multiple view configurations:

```typescript
import type { ViewSwitcherSchema } from '@object-ui/types';

const viewSwitcher: ViewSwitcherSchema = {
  type: 'view-switcher',
  views: [
    { type: 'grid', label: 'Grid', schema: { type: 'text', content: 'Grid content' } },
    { type: 'kanban', label: 'Kanban', schema: { type: 'text', content: 'Kanban content' } }
  ],
  defaultView: 'grid',
  variant: 'tabs',
  position: 'top',
  persistPreference: true,
  storageKey: 'my-view-switcher'
};
```

### FilterUI

Render a filter toolbar with multiple field types:

```typescript
import type { FilterUISchema } from '@object-ui/types';

const filterUi: FilterUISchema = {
  type: 'filter-ui',
  layout: 'popover',
  showApply: true,
  showClear: true,
  filters: [
    { field: 'name', label: 'Name', type: 'text', placeholder: 'Search name' },
    { field: 'status', label: 'Status', type: 'select', options: [
      { label: 'Open', value: 'open' },
      { label: 'Closed', value: 'closed' }
    ] },
    { field: 'created_at', label: 'Created', type: 'date-range' }
  ]
};
```

### SortUI

Configure sorting with dropdowns or buttons:

```typescript
import type { SortUISchema } from '@object-ui/types';

const sortUi: SortUISchema = {
  type: 'sort-ui',
  variant: 'dropdown',
  multiple: true,
  fields: [
    { field: 'name', label: 'Name' },
    { field: 'created_at', label: 'Created At' }
  ],
  sort: [{ field: 'name', direction: 'asc' }]
};
```

## Examples

### Choosing the list type

The list is always rendered; `defaultViewType` picks which renderer draws it,
and `table` configures the grid:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users',
  defaultViewType: 'grid',
  table: {
    columns: ['name', 'email', 'role', 'created_at'],
    sort: [{ field: 'created_at', order: 'desc' }],
  },
};
```

Non-grid types (`kanban`, `gallery`, `calendar`, `timeline`, `gantt`, `map`)
are rendered through `SchemaRenderer`, so `@object-ui/react` and the matching
plugin must be installed for those.

### Configuring the record form

Create and edit share one record surface. `layout` chooses where it opens and
`form` configures what it contains — there is no separate "form view" node and
no authored `mode`:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users',
  layout: 'drawer', // drawer | modal | page
  form: {
    fields: ['name', 'email', 'role'],
    submitText: 'Save user',
    showCancel: true,
  },
};
```

When `layout` is omitted, the surface is derived from how heavy the object is
(`deriveRecordSurface`): a field-heavy object opens as a page, a light one as a
drawer, and mobile always pages. A page is handed to `onNavigate`; with none to
hand it to, as on the registered `object-view` renderer, whose JSON schema
cannot carry a function, the page falls back to the drawer for create, edit and
read.

### Opening a record

Reading a record is the same surface in its read state, reached by clicking a
row. `navigation.mode` decides how, and `onNavigate` is what hands a page-mode
record off to your router:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

// your application's router
declare const router: { push: (href: string) => void };

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users',
  layout: 'page',
  navigation: { mode: 'page' }, // none | drawer | modal | page | split | popover | new_window
  onNavigate: (recordId, mode) => {
    // mode is 'view' or 'edit'
    router.push(`/users/${recordId}${mode === 'edit' ? '/edit' : ''}`);
  },
};
```

Without an `onNavigate` handler, `page` mode has nowhere to send the user, so
keep the two together: a `page` layout without one falls back to the drawer,
and a row click under `navigation: { mode: 'page' }` opens nothing.
`navigation: { mode: 'none' }` (or `preventNavigation`)
makes rows inert. An active named view (`listViews`, under Read/List) that
declares its own `navigation` replaces this one, as a whole, while it is shown.
Under `split` or `popover`, which open only beside a record the user picked, the
New button's create form opens on the `layout` surface instead: the modal for
`layout: 'modal'`, the drawer otherwise, whether the mode is this node's or an
active named view's. A `page` layout with `onNavigate` still hands New to your
router.

With no host `onRowClick`, a Cmd/Ctrl-click or middle-click on a row opens the
record as a full page in a new browser tab. Inert rows stay inert: `mode: 'none'`,
`preventNavigation`, and `operations.read: false` without a `navigation` config
ignore a modifier click too.

## CRUD Operations

All four operations are built in and run against the `dataSource` prop. You do
not wire handlers for them — you switch them on or off with `operations`, and
`show*` controls whether the matching toolbar affordance is visible.

### Create

`operations.create` enables record creation; `showCreate` shows the button.
Both default to on. The new-record form opens on the surface a `drawer` or
`modal` navigation names, and on the `layout` surface otherwise, under `split`
and `popover` too (see Opening a record):

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'products',
  showCreate: true,
  operations: { create: true },
  layout: 'drawer',
  form: { fields: ['name', 'price', 'category'] },
};
```

With a `page` surface, authored or derived, creation calls
`onNavigate('new', 'edit')`, whatever the navigation, so the host route owns the
form. With no `onNavigate`, the page has nowhere to route, so it falls back to
the drawer.

### Read/List

Search, filter and sort are toolbar toggles; column set, filter, sort and page
size live in `table`:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'products',
  defaultViewType: 'grid',
  showSearch: true,
  showFilters: true,
  showSort: true,
  table: {
    columns: ['name', 'price', 'category'],
    filter: [{ field: 'category', operator: 'equals', value: 'electronics' }],
    pagination: { pageSize: 25 },
  },
};
```

Saved views are `listViews`, keyed by view name, with `defaultListView`
selecting which opens first:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'products',
  listViews: {
    all: { label: 'All Products', type: 'grid', columns: ['name', 'price'] },
    cheap: {
      label: 'Under 100',
      type: 'grid',
      columns: ['name', 'price'],
      filter: [{ field: 'price', operator: 'less_than', value: 100 }],
    },
  },
  defaultListView: 'all',
};
```

**On the registered renderer.** An authored `object-view` node, and the Studio's
view preview, draws a grid named view through `ObjectGrid`. Ten grid members the
protocol declares under the same name on a named view and on `object-grid` —
`pagination`, `selection`, `rowHeight`, `resizable`, `searchableFields`,
`conditionalFormatting`, `rowActions`, `bulkActions`, `bulkActionDefs` and
`exportOptions` — come from the active named view first, and fall back to
the same key on `table` (`pagination` and `selection` since objectui#10885, the
rest since objectui#10976). A named view's
`hiddenFields` removes those fields from the columns the grid draws, when a
column list is declared, and its `fieldOrder` then orders the columns that
remain, the way `ListView` orders them on a host's `renderListView`. Its
`inlineEdit` turns on in-cell editing, and only where the object grants inline
edit to the user. Its `navigation` replaces the node's `navigation` as a whole:
the row click, and the surface and width of the record, create and edit forms,
follow the active named view, on this path, and on a host's `renderListView`
when the host wires the `onRowClick` it is handed and passes `ObjectView` no
`onRowClick` of its own. Under a named `split` or `popover`, the create form
opens on the `layout` surface, as under Opening a record. `label` and `data`,
also declared on both, are not
handed to the grid on this path: the named view's `label` is already the tab's
text, and `data` waits on objectui#10971, because `ListView` and `ObjectGrid`
pick different objects for it.
`src/__tests__/ObjectView.routeTwoNamedGridMembers-10885.test.tsx` pins the ten
grid members and `hiddenFields`; `ObjectView.namedViewNavigation-10885.test.tsx`
and `ObjectView.namedViewInlineEdit-10885.test.tsx` pin `navigation` and
`inlineEdit`, and `@object-ui/app-shell`'s
`objectViewRouteParity.fieldOrder-10885.test.tsx` pins `fieldOrder` against
`ListView`.

**On a host's `renderListView`.** A host that composes `ObjectView` with both
`listViews` and its own `renderListView` receives a `list-view` node for the
active view. For the list members the protocol declares on a named view — list
chrome (`description`, `compactToolbar`, `allowPrinting`, `showRecordCount`,
`sharing`, `aria`, `emptyState`), record actions (`addRecord`, `inlineEdit`,
`rowActions`, `bulkActions`, `bulkActionDefs`, `exportOptions`), grid
presentation (`rowHeight`, `pagination`, `selection`, `resizable`,
`hiddenFields`, `conditionalFormatting`), and search, filter and navigation
(`searchableFields`, `userFilters`, `navigation`) — that node takes the value
from the active named view first, ahead of the host's `views` entry
(objectui#10758). `filterableFields` is relayed from no source: `@objectstack/spec`
18 retires it, and no per-view Filter-panel whitelist replaces it — the Filter
panel offers every field the user may read, minus the fields the object marks
`hidden: true` (objectui#13118).
`src/__tests__/ObjectView.namedViewProtocolKeys-8980.test.tsx` pins each family.

### Update

Editing is reached from a row's edit action; `operations.update` is what gates
it. The edited record is chosen by the click, never by an authored `recordId`:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'products',
  operations: { update: true },
  layout: 'modal',
  form: { fields: ['name', 'price'], submitText: 'Update' },
};
```

Under a `page` surface this becomes `onNavigate(recordId, 'edit')`; a page with
no `onNavigate` falls back to the drawer.

### Delete

`operations.delete` enables both the per-row delete and bulk delete; there is
no `enableDelete` key and no `onDelete` callback:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'products',
  operations: { create: true, read: true, update: true, delete: false },
};
```

## Integration with ObjectQL

The plugin works seamlessly with ObjectStack:

The adapter is the `dataSource` **prop**, not part of the schema:

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import { ObjectView } from '@object-ui/plugin-view';
import type { ObjectViewSchema } from '@object-ui/types';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-auth-token',
});

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'contacts',
  defaultViewType: 'grid',
  showSearch: true,
  showSort: true,
  table: {
    columns: ['first_name', 'last_name', 'email', 'company'],
    pagination: { pageSize: 25 },
  },
};

<ObjectView schema={schema} dataSource={dataSource} />;
```

Rendering the same node through the registry instead (`type: 'object-view'` in
a larger schema tree) works because `ObjectViewRenderer` reads the
`dataSource` off `SchemaRendererProvider` context — again, not off the schema.

## Field Configuration

There is no `fieldConfig` key. Labels, types, requiredness and validation come
from the object's own metadata, which the view reads through the `dataSource` —
that is what makes the view "automatic". What the schema node chooses is
**which** fields appear and how they are grouped:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users',
  table: {
    columns: ['name', 'email', 'role'], // grid columns
  },
  form: {
    fields: ['name', 'email', 'role'], // flat field list, or use sections
    sections: [
      { label: 'Identity', fields: ['name', 'email'] },
      { label: 'Access', fields: ['role'] },
    ],
    columns: 2,
  },
};
```

To override a field's rendering beyond what the object metadata says, use
`form.customFields` (full field definitions) rather than a per-field patch on
the view node.

## Advanced Features

### Child records (master-detail)

There is no `nestedFields` key. A child collection is declared as a **subform**
on the record form, which is where an order's line items belong:

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'orders',
  layout: 'page',
  form: {
    fields: ['order_number', 'customer', 'total'],
    subforms: [
      {
        childObject: 'order_items',
        title: 'Line items',
        columns: [{ name: 'product' }, { name: 'quantity' }, { name: 'price' }],
      },
    ],
  },
};
```

Only `childObject` is required — the relationship field and the grid columns are
derived from the child object's metadata unless you override them
(`relationshipField`, `columns`). A column is `@objectstack/spec`'s
`InlineGridColumn`: an object keyed by `name`, never a bare field name. One that
declares no `type` takes its label, type and the rest from the child field;
an undeclared column key is refused by the validator.

### View tabs

There is no `tabs` key, and `form.layout` has no tabbed value
(`vertical | horizontal`). The tab strip this package ships is
the **saved-view** tab bar: declare the views and render `<ViewTabBar>` (or let
a host such as `@object-ui/app-shell` do it):

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const schema: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users',
  showViewSwitcher: true,
  allowCreateView: true,
  listViews: {
    active: { label: 'Active', type: 'grid', columns: ['name', 'email'] },
    admins: {
      label: 'Admins',
      type: 'grid',
      columns: ['name', 'email'],
      filter: [{ field: 'role', operator: 'equals', value: 'admin' }],
    },
  },
  defaultListView: 'active',
};
```

To group a *form's* fields instead, use `form.sections` as shown under "Field
Configuration".

## TypeScript Support

This package's type export surface is the seven `*Props` types plus the
record-surface and field-option types listed under "Public exports" — it ships
**no schema types**. The authored `type: 'object-view'` node is typed by
`@object-ui/types`, which this package imports (`src/ObjectView.tsx`) without
re-exporting, so import it from there:

| Import from `@object-ui/types` | What it types |
| --- | --- |
| `ObjectViewSchema` | the whole `type: 'object-view'` node — `objectName` (required), `title`, `description`, `layout`, `defaultViewType`, `listViews`, `defaultListView`, `navigation`, `table`, `form`, `searchableFields`, `show*`, `operations`, `onNavigate`, `allowCreateView`, `viewActions` (`viewTabBar` is retired — objectui#7779 — and refused by name; `filterableFields` is retired with the spec's own retirement of it — objectui#13118 — and nothing reads it) |
| `NamedListView` | the former type of a `listViews` entry, still exported. Since objectui#7928 an entry is `@objectstack/spec`'s `ObjectListViewSchema` — `NonNullable<ObjectViewSchema['listViews']>[string]` |
| `ViewNavigationConfig` | `navigation` — row/item click behaviour |
| `ViewTabBarConfig` | the `config` prop of `ViewTabBar` — tab-bar UX (inline add, overflow, indicators), composed by the host; not an `object-view` node key |

```typescript
import type { ObjectViewSchema } from '@object-ui/types';

const userView: ObjectViewSchema = {
  type: 'object-view',
  objectName: 'users',
  defaultViewType: 'grid',
  // Displayed columns are grid configuration, inherited from ObjectGridSchema.
  table: { columns: ['name', 'email', 'role'] },
};
```

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-view)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-view)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).

## Multi-view UX

In addition to the renderer, the package ships two components that wrap an
object's set of saved views (Airtable / Notion-style):

- **`<ViewTabBar>`** — a horizontal strip of view tabs. Per-tab chevron menu
  exposes rename, pin, duplicate, set default, delete, and "Manage all
  views…". An overflow `… N more` dropdown surfaces the remaining views and
  links to the management dialog. (In-place tab drag is intentionally
  disabled — reordering happens in `<ManageViewsDialog>` to avoid the
  ambiguity of "does dragging the visible tab change the global order or
  just the visible subset?".)
  A tab item's optional `description` (`ViewTabItem.description`) is the
  view's description, already resolved to the viewer's language and already
  gated by the host on `appearance.showDescription` (leave it out when that is
  `false`). The strip draws it on the active tab only: as the tab's tooltip and
  as the header of its chevron menu. The console's object page passes it, so a
  list it hosts draws no description row of its own (objectui#12528).
- **`<ManageViewsDialog>`** — a Shadcn `Dialog` containing a vertical sortable
  list of **every** view (visible + overflow + metadata-defined). Supports
  drag-reorder, search, inline rename, pin / set-default toggles, and a per-row
  `⋯` action menu (rename, duplicate, edit configuration, set default,
  pin/unpin, delete). Open it from the chevron menu's "Manage all views…"
  item or from the header of the overflow `… N more` dropdown.

Both components share the same callback surface
(`onRenameView`, `onDeleteView`, `onReorderViews`, …) so a host like
`@object-ui/app-shell`'s `ObjectView` wires the same set of handlers into
both. View ordering is persisted to `localStorage` under
`viewOrder:{objectName}` and, for backend-saved views, also written back as
`sortOrder`.
