# @object-ui/plugin-detail

DetailView plugin for ObjectUI - A comprehensive detail page component with field grouping, tabs, related lists, and action buttons.

## Features

- **Field Grouping/Sections**: Organize fields into logical sections with titles
- **Collapsible Sections**: Make sections collapsible to save space
- **Tab Navigation**: Organize content into tabs for better UX
- **Related Lists**: Display related records (e.g., contacts for an account) —
  authored as a `record:related_list` block, ⛔ not as a `detail-view` `related`
  array, which is retired (objectui#7997; see **RelatedList** below)
- **Action Buttons**: Edit, Delete, and custom action buttons
- **Readonly/Edit Mode**: Toggle between view and edit modes
- **Back Navigation**: Built-in back button with customizable behavior
- **Loading States**: Skeleton loading for async data
- **Custom Headers/Footers**: Flexible customization options

## Installation

```bash
pnpm add @object-ui/plugin-detail
```

## Usage

### Two ways to reach a data source

`detail-view` needs a data source to load a record, and there are two ways to
give it one. They are equivalent, and an explicit prop wins when both are
present:

```tsx
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { DetailView } from '@object-ui/plugin-detail';
import type { DataSource } from '@object-ui/types';

declare const dataSource: DataSource;

// 1. Injected by an ancestor — the pattern the rest of the family uses, and the
//    one to reach for when a page renders several data-bound blocks.
const viaProvider = <SchemaRendererProvider dataSource={dataSource}>
  <SchemaRenderer schema={{ type: 'detail-view', objectName: 'account', resourceId: '42' }} />
</SchemaRendererProvider>;

// 2. Handed to one placement — what `<DetailView dataSource={…} />` has always
//    taken, and what the examples below use.
const viaProp = <DetailView schema={{ type: 'detail-view', objectName: 'account', resourceId: '42' }} dataSource={dataSource} />;
```

Route 1 is new as of objectui#5378: this block used to read the adapter from its
prop ONLY, while its siblings `object-grid` and `object-form` read it from
context only, so a page could satisfy one of them or the other and never both.
Nothing that worked before changed — route 2 is unaffected — and a block that
resolves neither now renders a **No data source resolved** panel naming itself
and the object it was about to read, instead of an empty shell.

Note the record id is `resourceId` here. `object-form`'s is `recordId`; the two
blocks do not share that key.

### The provenance footer belongs to the record page

`RecordMetaFooter` is the one-line "Created … Updated …" summary of a record's
audit fields. A standalone `DetailView` draws it under its body. On a
`type: 'record'` page the footer is the PAGE's: the page host draws it once for
the record, whatever the number of `record:details` nodes the page carries, and a
`record:details` node that reads the page's record draws none of its own. So a
page with two nodes shows the line once, and a node whose sections are all
hidden draws nothing. The console's record page (`RecordDetailView` in
`@object-ui/app-shell`) draws it at the page foot.

A host that mounts `RecordContextProvider` itself renders `RecordMetaFooter`
once, where its page ends, with the record as `data` and the object definition
as `objectSchema`. A `record:details` node with a `dataSource` binding (below)
shows a record the page does not, so it keeps its own footer.

### Record blocks without a record page (`dataSource`)

`record:details`, `record:highlights` and `record:quick_actions` show the record
their record context carries: on a `type: 'record'` page, the page's record. On
any other page, the spec's per-element `dataSource` binding supplies it — the
block reads the FIRST row of the bound set by the binding's `sort`, under the
caller's own identity:

```json
{
  "type": "record:highlights",
  "properties": { "fields": ["name", "environment_type"] },
  "dataSource": { "object": "sys_environment", "sort": [{ "field": "created_at", "order": "desc" }], "limit": 1 }
}
```

No row draws the block's authored `emptyState` when it declares one, and its
no-record state when it does not. `record:quick_actions` runs the object's
declared actions against the bound row's id. The binding resolves as on
every bound block (a named `view`, an AND-combined `filter`, its `sort`), and the
row is re-read when a write to its object is announced. Declare `limit: 1`:
`objectui validate` warns on a record block whose binding does not. See
**Per-element data binding on a page** in the data-source guide
(`content/docs/guide/data-source.md`). `record:related_list`'s `dataSource` is
different: it binds the rows the list shows.

`emptyState` is the spec's empty-state shape, the one `object-grid` takes:
`{ title, message, icon, link }`. It goes in `properties`, beside the block's
other keys:

```json
{
  "type": "record:details",
  "properties": {
    "fields": ["region"],
    "emptyState": {
      "title": "No production environment",
      "message": "Create one from the environments page.",
      "icon": "server",
      "link": { "label": "Open environments", "url": "/environments" }
    }
  },
  "dataSource": { "object": "sys_environment", "limit": 1 }
}
```

It is drawn in the block's place only when the binding's read settles with no
row. A read the server refuses as forbidden counts as no row. It is not drawn
while the read loads, in place of the error a failed read shows, when a row is
there, or on a block with no `dataSource`. `icon` is a Lucide name. `title` and
`message` are plain strings or inline locale maps, resolved against the display
locale. `link` is followed as a `url` action. Leave `title` out and the heading
reads "Record not found". Leave `emptyState` out and the block keeps its own
no-record state: "Record not found" on `record:details`, nothing on
`record:highlights`, and the empty bar on `record:quick_actions`.

A related list's PARENT record has a binding of its own, `parentDataSource` in
its `properties` (the spec row's member). It is read by the same one-record
rule — the first row by `sort`, re-read when its object is written — and the
list draws that record's children:

```json
{
  "type": "record:related_list",
  "properties": {
    "objectName": "sys_member",
    "relationshipField": "environment_id",
    "parentDataSource": { "object": "sys_environment", "sort": [{ "field": "created_at", "order": "desc" }], "limit": 1 }
  }
}
```

No row draws a notice in the block's place, never an empty list. Without the
key, the parent is the record page's record.

### A section heading that counts a field's values (`count`)

A `record:details` section can show how many values a multi-value field holds
on the current record. `count.field` names the field, and the heading writes the
`{{ count }}` hole where the number goes (`@objectstack/spec` 18,
`RecordDetailsProps.sections[].count`):

```json
{
  "type": "record:details",
  "properties": {
    "sections": [
      {
        "name": "tagging",
        "label": "{{ count }} tags",
        "count": { "field": "tags" },
        "fields": ["tags"],
        "collapsible": true,
        "defaultCollapsed": true
      }
    ]
  }
}
```

With three tags selected the heading reads `3 tags`, collapsed or not. An absent
or empty value counts 0, and a field the viewer may not read counts as absent.
The hole is filled after the heading is translated, so each locale of an inline
label map and a translated `objects.<object>._sections.<name>.label` write the
same `{{ count }}`. `count` changes the heading only: with `hideEmpty` on (the
default), a section whose fields are all empty is still absent. The spec refuses
`count` beside `group`, on a section without `label`, and on a label with no
hole. A section without `count` prints its heading as written.

### Basic Example

```tsx
import { DetailView } from '@object-ui/plugin-detail';

function ContactDetail() {
  return (
    <DetailView
      schema={{
        type: 'detail-view',
        title: 'Contact Details',
        data: {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          company: 'Acme Corp',
        },
        fields: [
          { name: 'name', label: 'Full Name' },
          { name: 'email', label: 'Email' },
          { name: 'phone', label: 'Phone' },
          { name: 'company', label: 'Company' },
        ],
        showBack: true,
        showEdit: true,
        showDelete: true,
      }}
    />
  );
}
```

### With Sections

```tsx
import { DetailView } from '@object-ui/plugin-detail';

declare const accountData: Record<string, unknown>;

const accountDetail = <DetailView
  schema={{
    type: 'detail-view',
    title: 'Account Details',
    sections: [
      {
        title: 'Basic Information',
        icon: '📋',
        fields: [
          { name: 'name', label: 'Account Name' },
          { name: 'industry', label: 'Industry' },
          { name: 'website', label: 'Website' },
        ],
        columns: 2,
      },
      {
        title: 'Address',
        collapsible: true,
        defaultCollapsed: false,
        fields: [
          { name: 'street', label: 'Street' },
          { name: 'city', label: 'City' },
          { name: 'state', label: 'State' },
          { name: 'zipcode', label: 'Zip Code' },
        ],
        columns: 2,
      },
    ],
    data: accountData,
  }}
/>;
```

### With Tabs

```tsx
import { DetailView } from '@object-ui/plugin-detail';

declare const navigate: (url: string) => void;
declare const deleteAccount: (id: string) => void;

const accountDetail = <DetailView
  schema={{
    type: 'detail-view',
    title: 'Account: Acme Corp',
    objectName: 'accounts',
    resourceId: '12345',
    fields: [
      { name: 'name', label: 'Account Name' },
      { name: 'industry', label: 'Industry' },
    ],
    tabs: [
      {
        key: 'details',
        label: 'Details',
        icon: '📄',
        content: {
          type: 'detail-section',
          fields: [
            { name: 'description', label: 'Description' },
            { name: 'employees', label: 'Employee Count' },
          ],
        },
      },
      {
        key: 'activity',
        label: 'Activity',
        badge: '12',
        // `record:activity` — the registered Activity Timeline block. Reachable
        // under that exact key and no other; see the note below the block.
        // Its inputs go in `properties`, as the spec declares them.
        content: {
          type: 'record:activity',
          properties: { limit: 20, showCompleted: false },
        },
      },
    ],
    showEdit: true,
    showDelete: true,
  }}
  onEdit={() => navigate('/accounts/12345/edit')}
  onDelete={() => deleteAccount('12345')}
  onBack={() => navigate('/accounts')}
/>;
```

A tab's `content` is an **SDUI node**, not a private vocabulary: `DetailTabs`
renders it with `<SchemaRenderer schema={toRenderableSchema(tab.content)} />`,
so `content.type` is resolved by the component registry and an unregistered
name paints the `Unknown component type` panel (**OBJUI-001**) instead of a
component. Author only types this repository registers.

Two things about the Activity tab above are worth copying rather than guessing
(objectui#8114 — it previously taught `type: 'activity-timeline'`, which
nothing registers):

- **The key is `record:activity`, with the namespace spelled out.** The
  registration in `src/index.tsx` passes the bare name under
  `{ namespace: 'record', skipFallback: true }`, and `skipFallback` is what
  stops the bare name from also being claimed globally — so `record:activity`
  resolves and `activity` resolves to nothing. `activity` is additionally a tab
  **key** in the example above; the two are unrelated.
- **The node declares the feed's filters, not the feed.** Its inputs (`limit`,
  `showCompleted`, `types`, `filterMode`, …) go in its `properties` bag, and
  the block finds its own feed: a mounted discussion context, or a self-fetch
  from `sys_activity` scoped to the record `useRecordContext` binds. Both need
  a record host; a bare `<DetailView>` like the one above mounts neither, so
  there the tab draws the block's empty state ("No activity recorded"). Under
  a record host, such as the console's record page, the same node draws that
  record's activity. `items` (with its `loading` flag) is the host's feed
  slot, not a key of this node: `@object-ui/types` refuses it by name, and
  `data` is not a key this block reads.

See **The `record:activity` block** in the plugin-detail guide for its declared
inputs (`types`, `limit`, `filterMode`, `showCompleted`, …).

## Schema

The DetailView component accepts a `DetailViewSchema`, declared in
`@object-ui/types`. Import it rather than re-typing it — every key below is
checked against that declaration, so this example cannot drift from the package:

```typescript
import type { DetailViewSchema } from '@object-ui/types';

const schema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Account Details',
  objectName: 'accounts',
  resourceId: '12345',
  api: '/api/accounts/12345',
  data: undefined,
  // Field name whose value becomes the header title; `title` is the fallback.
  primaryField: 'name',
  // Field values rendered as badges beside the header title.
  summaryFields: ['industry', 'website'],
  layout: 'vertical',
  columns: 2,
  // See the examples above for the shapes these three carry.
  sections: [],
  fields: [],
  tabs: [],
  actions: [],
  // The view's own heading (title, follow-star, copy-id chip); drawn unless
  // `false`. `record:details` sets it from its own `showHeader`.
  showHeader: true,
  showBack: true,
  backUrl: '/accounts',
  showEdit: true,
  editUrl: '/accounts/12345/edit',
  showDelete: true,
  deleteConfirmation: 'Delete this account?',
  loading: false,
  header: { type: 'text', label: 'Custom header' },
  footer: { type: 'text', label: 'Custom footer' },
};
```

### `summaryFields` and non-scalar values

A summary chip is a single-line pill, and it formats `currency`, `date`,
`datetime`, `percent` and the option families itself. Any other value it can
render as text it renders as text.

A **`percent`** chip is formatted by `@object-ui/fields`' `formatPercent` — the
same call the list cell makes — so one stored value reads the same beside the H1
as it does in a list: scaled at the storage the field declares (the spec's
`percentScaleOf`: a fraction unless the field declares a `max` above 1, read
through `percentCellScale` in `@object-ui/fields`, never guessed from the
value), rounded to the width `resolveFieldScale` (`@objectstack/spec/data`)
resolves for the field — its declared `scale`, or the protocol's own width for
a percent that declares none, which every percent face reads (objectui#9843) —
and rendered through the display locale's own percent affix rather than an
appended sign. A stored `1234.5` on a field declaring `max: 100` therefore
reads `1,235%` in an `en` session, and a stored `1` on a field declaring no
`max` reads `100%`; both carry the locale's own affix and marks elsewhere. Which stored values that convention moves, and
what each reads in both places, is re-derived by
`src/__tests__/summaryChip.percentConvention-9167.test.tsx` rather than listed
here. The chip's bar keeps the unrounded magnitude, as the list cell's bar does.

An **object** value — an expanded lookup payload, an address, a location, a
file — is drawn by that field's own cell renderer, so the chip shows what the
same value shows everywhere else on the page: the referenced record's name, the
formatted postal line, the coordinates, the file name.

Fifteen field kinds are the exception, because their renderer does not fit a
pill: the option families draw a badge (which would nest inside the chip's own),
`user` draws an avatar, `image` / `avatar` / `signature` draw an image and no
text at all, and `boolean` / `toggle` / `date` / `datetime` / `repeater` draw a
"No value" face for a value the chip only exists because the page called
filled. Those keep a text chip, carrying `@object-ui/fields`' shared value
coercion — the record's name where the object has one, and `[Object]` where it
does not. The set and the measurement behind it are
`src/summaryChipRenderers.ts`.

## Components

### RecordDetailPanel

The record overlay's **payload**, with no shell of its own: one
`InlineEditProvider` session wrapping `DetailView` plus the record-level
`InlineEditSaveBar`, and the `objectSchema` → typed-field derivation that feeds
them.

All five list-type renderers (`ObjectGrid`, `ObjectTree`, `ObjectGantt`,
`ObjectKanban`, `ObjectCalendar`) mount this component through
`NavigationOverlay` from `@object-ui/components`, so an authored
`navigation.mode` of `drawer` / `modal` / `split` / `popover` means the same
thing on every view type (objectui#9299). ⛔ Do not re-wrap it in a shell of
your own — that is exactly the fork this component exists to remove.

```tsx
import type { ReactNode } from 'react';
import { NavigationOverlay, useOverlayAnchor } from '@object-ui/components';
import { RecordDetailPanel } from '@object-ui/plugin-detail';
import { useNavigationOverlay } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

declare const dataSource: DataSource;
declare const objectSchema: { fields?: Record<string, unknown> };
declare const myView: ReactNode;
declare function saveField(field: string, value: unknown): Promise<void>;
declare function deleteRecord(): Promise<void>;

function ContactsOverlay() {
  const navigation = useNavigationOverlay({
    navigation: { mode: 'drawer' },
    objectName: 'contacts',
  });
  // `popover` anchors to the element the click landed on; spread
  // `anchorCaptureProps` on your own container, or call `captureAnchor(event)`
  // at a click site that already has one.
  const { anchorRef } = useOverlayAnchor();

  return (
    <NavigationOverlay
      {...navigation}
      title="Record Detail"
      mainContent={myView}
      popoverAnchorRef={anchorRef}
    >
      {(record) => (
        <RecordDetailPanel
          record={record}
          objectName="contacts"
          recordId={String(record.id)}
          dataSource={dataSource}
          objectSchema={objectSchema}
          onFieldSave={saveField}
          onDelete={deleteRecord}
          onClose={navigation.close}
        />
      )}
    </NavigationOverlay>
  );
}
```

Omit `onFieldSave` for a strictly read-only panel; omit `onDelete` for no
delete action.

**Capability is handler presence, not a boolean.** A caller that omits
`onFieldSave` gets a read-only panel and one that omits `onDelete` gets no
delete action — which is what lets a row locked through a renderer's `lockField`
open read-only without the panel knowing what a lock is.

**…and a handler is a wiring, not a grant.** The inline edit is the `recordEdit`
row of the affordance-to-grant map in `@object-ui/core` (objectui#12082), the row
the record page reads for the same in-place edit: the object's policy (read off
the `objectSchema` you pass), the effective API operation set and the caller's
**update** grant. When it is closed the panel opens no inline-edit session, as if
`onFieldSave` were absent; each field still asks its own field question. The
delete action is `DetailView`'s own `recordDelete` read. With no permission
provider mounted both read open.

`RECORD_OVERLAY_DEFAULT_WIDTH` is exported alongside it and is the single code
home of the default overlay width repo-wide. ⛔ Do not re-spell the literal at a
call site.

### RecordDetailDrawer

The same payload in the drawer shell — a published convenience wrapper that
delegates to `NavigationOverlay` in `mode="drawer"`. It no longer owns a
`Sheet`, a drag-resize implementation, or a chrome header of its own
(objectui#9299).

A width a user had already dragged is persisted by the shell under
`ov:drawer-width:<objectName>`; a width left by the retired implementation under
`objectui.drawerWidth.<objectName>` is read once, moved forward and removed, so
existing widths carry over rather than reset.

### DetailSection

Renders a group of fields with optional collapsing.

### DetailTabs

Tab navigation for organizing content into different views.

### RelatedList

Displays related records in list, grid, or table format.

> **Retired: `DetailViewSchema.related`** (objectui#7997, ADR-0049
> enforce-or-remove). Author a `record:related_list` block instead.
>
> Until objectui#7997 a `detail-view` node could carry its own `related` array,
> and this README taught it. That array is retired under ADR-0049
> enforce-or-remove (maintainer ruling 2026-09-10). It was a second entry to a
> capability `@objectstack/spec` already governs — the protocol declares no
> `DetailView` schema at all — so it mirrored nothing and drifted from the
> renderer it fed: it typed `columns` as `TableColumn` objects while the
> renderer also accepted bare field names. Authoring it is now **refused by
> name** on both the TypeScript and the JSON face, ⛔ not silently ignored.
>
> Nothing about the rendered result changed: both entries always went through
> the `RelatedList` component documented here. Only the second door closed.
>
> ```tsx
> import { SchemaRenderer } from '@object-ui/react';
>
> const contacts = (
>   <SchemaRenderer
>     schema={{
>       type: 'record:related_list',
>       properties: {
>         objectName: 'contact',
>         relationshipField: 'account_id',
>         title: 'Contacts',
>         columns: ['name', 'email', 'phone'],
>       },
>     }}
>   />
> );
> ```
>
> ⚠️ `columns` is an array of **field-name strings**, which is what the protocol
> declares (`RecordRelatedListProps.columns`). The header comes from the related
> object's field `label` and the cell from the field's type, so a label rename
> reaches the list for free — the hand-spelled `{ accessorKey, header }` form the
> retired array taught froze both. `relationshipField` names the field on the
> related object pointing back at this record, and replaces the retired form's
> `api` endpoint.
>
> ⚠️ The block reads the parent record from the record page's `RecordContext`,
> so author it on a record page. Placed anywhere it cannot resolve a parent id
> it scopes to nothing and renders an empty list — which is also what the
> retired `related` form did whenever it declared `api` without a
> `referenceField`.


Related lists are **paged by default**: the `record:related_list` renderer
applies the spec default `limit` of **5** when the node doesn't declare one
(`@objectstack/spec` `RecordRelatedListProps.limit`, "Number of records to
display initially"), so a child collection of any size renders as pages with
Previous/Next controls instead of one flat dump. On the auto-fetch path the
component asks the server for **one page at a time** (`$top`/`$skip`) and
reads the collection size from `QueryResult.total` (falling back to a
`hasMore` estimate), so large child tables never ship wholesale to the
browser. A user column sort becomes a server `$orderby` (ordering stays
global across pages), and the node's `sort` prop seeds the initial order.
Because that `$orderby` names a flat field, two kinds of column cannot survive
the trip. A **relational column** (`lookup` / `master_detail` / `user` / `tree`)
would order the collection by the stored foreign-key id while its cells show
related-record names (`objectui#3096`); a **`formula` column** has no
materialized column to order by at all — silently unordered rows under a `200`
before `objectstack#6994`, a `400 INVALID_SORT` after it (`objectui#3950`). So on
the windowed path neither offers a sort affordance, at either of this card's two
sort entry points: the embedded table's column headers, and the button row a
`list` card keeps because it has no headers. In client mode the sort key is the
value the cell shows — the label this list already resolved, the formula result
the server hydrated — so the affordance stays and orders by that.
Passing `data` directly keeps the historical client-side slicing, and typing
in the opt-in filter box temporarily falls back to the full-fetch client
pipeline (the contains-filter sweeps the columns the list shows, which no
generic server filter can express).

A `password` / `secret` column draws `••••••`, and the list flags it
`masked` on the table it renders (objectui#10657), so the table never copies it
on Ctrl+C / Cmd+C, shows it as a tooltip, sorts by it from its header, or sizes
it by its value. The rule is `isMaskedFieldType()` from `@object-ui/fields`,
read over the column's authored `type` and the object's field type, so an
authored `type: 'text'` over a `secret` field keeps the flag. While the object
definition is still loading, or after its read failed, the list cannot tell
which columns are masked, so it flags every one and draws every cell it would
draw from that definition as the mask, never as text; it keeps doing so when
the read failed (objectui#10657). A column with a `cell` of your own draws what
your `cell` returns.

The list's own filter box and sort read the same flag (objectui#10728). The
opt-in filter box matches a term against the columns the list shows that are
not masked, so a masked value, and a field no column shows, never keeps a row.
A masked column gets no sort button on a `list` card, and a sort by it is
refused (including one the embedded table asks for, which a server-paged list
would send as `$orderby`). In a list that sorts in the browser, a sort set on a
column before it was flagged also stops ordering the rows. While the definition
is loading, or after its read failed, every column is flagged: the filter box
keeps no row and no sort button is offered. Not covered: on a server-paged
list, an authored `sort` naming a masked field is still sent to the server as
`$orderby`, and so is a sort the user set on a column before that column was
flagged, with each page the list fetches, until the user sorts by another
column. The column is flagged after the sort only when the `columns` or the
object of a list already on screen change; `record:related_list` sets both
once per block.

A list that authors `columns` sends a **`$select` projection** on its
auto-fetch (`objectui#10186`), the one `ListView` and `ObjectGrid` already send
(`objectui#6898`). It asks for the authored columns that pass the same gates the
column layer draws through (redaction, the parent key, field-level security),
plus `id`, the `$expand` roots, and, once the child schema has loaded, the
fields the row predicates read (the child object's `userActions` Edit/Delete
overrides, its actions, and the host's row actions), plus the mobile card
gallery's cover field when declared and readable. A column the principal
cannot read is dropped once the permission answer has loaded; a request sent
before that answer can still carry it, the same deferral `ObjectGrid` has.
If every authored column is denied, the list asks for `id` and its predicate
operands, not for everything. On a backend that honours `$select`, rows then
carry only the projected fields, so the opt-in filter box above sweeps those.
A list **without** authored `columns` derives them from `highlightFields` or
the field walk, and both choose by the emptiness of the rows fetched. That list sends no projection, and its column layer alone keeps a
denied field off screen. Against ObjectStack's server the projection is defence
in depth, because the server already strips denied fields from every row.

The node's `filter` (spec `RecordRelatedListProps.filter`, "additional filter
criteria") narrows the list beyond the parent relationship: it is
**AND-combined** with the parent-relationship condition, never substituted for
it, so a related list stays scoped to the record it appears on and an additional
criterion can only ever narrow that set. That condition is **not one fixed
spelling** — it is compiled to match the relationship field's ARITY on the
child object (`objectui#7299`). A single-valued relationship gets the equality
form `{ [relationshipField]: parentId }`; a multi-valued one gets the membership
form `{ [relationshipField]: { $contains: parentId } }`, because the stored
value is an array of ids and equality would ask whether the whole array *is* one
id. The arity verdict is `@objectstack/spec/data`'s own `isMultiValueField`,
never a rule this package keeps locally. Authors write `filter` in the spec's own
vocabulary (`[{ field, operator, value }]`); a `dataSource` binding's composed
filter (component AND saved view AND binding) lands on the same key. Both are
lowered to ObjectQL through the repo's single filter sink, so no second dialect
appears.

**A third producer writes that same key: the relationship itself.** A `lookup` /
`master_detail` field may declare `relatedListFilter` (added to `@objectstack/spec`
in objectstack#8704 / PR #8955 — see this package's own `@objectstack/spec`
dependency in `package.json` for the version in use), a canonical Query-DSL
`FilterCondition` such as
`{ status: { $ne: 'deleted' } }`. `RecordDetailView` derives the record page's
related lists from the relationship graph and carries that value onto this node's
`filter`, so an auto-derived page honours it without anyone authoring a page
(objectui#4664). It is an authored constraint, not a user-editable suggestion —
it never becomes a filter-bar row — and it lands on the existing key rather than
a new one, so all three producers share one read site and one lowering.

The **tab badge honours the same composed filter**. `page:tabs` auto-derives a
Related tab's count from the `record:related_list` nodes underneath it, and that
probe reads this node's `filter` and composes it with the parent scope through
the same `mergeFilterNodes` sink the row query uses — one value, sent twice. That
is what keeps the badge from saying 7 above a list showing 3; it is normative in
the spec key's own contract text, not a nicety. Counts are cached per
(object, relationship, parent, **scope**), so a filtered and an unfiltered probe
over the same relationship never badge each other. On the legacy raw-URL fallback path (no `dataSource` adapter, where the
query language is `filter[<field>]=<value>` and cannot carry an operator) a
declared filter is refused with a console explanation rather than dropped —
answering with more rows than the metadata asked for is the failure this key's
wiring exists to remove.

The **Add** affordance renders only where every link in its chain is available:
a spec-valid `add.picker.object` *and* a `dataSource`. The picker dialog and the
add callback both required the adapter already, so without it the button used to
render and do nothing at all when clicked — visible in hosts that supply no
`RecordContext` (Studio designer previews, context-free embeds).

…and only where the caller may make the write it ends in (objectui#12082). With
a `linkField` the picked records become link rows of the list's own object: the
**create** grant there, the `relatedNew` row of the affordance-to-grant map in
`@object-ui/core`. Without one the picked record is re-parented: the **update**
grant on `add.picker.object`, the `relatedRowEdit` row. The remove that the
`record:related_list` renderer falls back to when an `add` config is present and
no host handed over a delete reads the list object's `relatedRowDelete` row, the
row the host's own delete reads, so it never puts back a delete the host
withheld. With no permission provider mounted these read open.

The `record:related_list` renderer is automatically gated on the current
user's object-level `read` permission for the child object: when the
permission system (`@object-ui/permissions`) is loaded and denies read,
the whole section renders nothing — no header, no empty grid, no "New"
button that would be rejected server-side. With no `PermissionProvider`
mounted (Studio designer, standalone embeds) the gate stays open.

### InlineEditSaveBar & InlineFieldInput

The record-level inline-edit session (#2407): double-clicking a field (or its
hover pencil) in the highlights strip or details body stages edits into ONE
shared draft (`InlineEditProvider` from `@object-ui/react`), committed by
`<InlineEditSaveBar>` as a single atomic OCC-guarded update. Polish shipped in
#2572:

- **Editors**: `InlineFieldInput` routes every field type to the same widget
  the form uses — including `number` / `currency` / `percent` (numeric
  keyboard, `min`/`max`/`step` from metadata, fraction↔percent conversion) and
  reference pickers, which receive `$expand`-ed record objects as-is so the
  display name renders without a hydration re-fetch.
- **Keyboard shortcuts**: while the session is active, **Esc** cancels (open
  popovers/dialogs keep owning Escape for "close") and **Cmd/Ctrl+Enter**
  saves; both respect the in-flight `saving` and `locked` states.
- **Approval lock**: hosts pass `locked` / `lockedHint` to the save bar and
  gate `InlineEditProvider.canEdit` when the record is approval-locked, so a
  locked record hides its edit affordances instead of rejecting at Save.
- **Approval band & recall** (#6464): the band reads `approvalPending` /
  `approvalProgress` from the same provider, and offers its **Recall** button
  only where the click can succeed. Recall is the submitter's lever — the
  server authorizes it on submitter identity and refuses everyone else — so
  hosts that resolve approvals pass `InlineEditProvider.approvalIsSubmitter`.
  It is tri-state on purpose: `false` withdraws the button from a resolved
  non-submitter, `true` keeps it, and **omitting it leaves the button exactly
  as it was** — a host that resolves no approval identity is unchanged rather
  than losing its submitter's only unlock lever. It gates the affordance only;
  the recall endpoint remains the authority on who may actually recall.
- **Answered approvals read** (#12220): a host whose approvals read answered
  (a 2xx) passes `InlineEditProvider.approvalReadAnswered`. Its `locked` /
  `approvalPending` are then the whole answer, and the band stops falling back
  to the record's `approval_status` column: a composition without the
  approvals service answers the read with an empty list and enforces no lock,
  so a stale `pending` in the column no longer shows a lock with nothing to
  recall. Omitting it keeps the column fallback exactly as before. Hosts and
  the band decide through one rule, `resolveApprovalLock` from
  `@object-ui/react`.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-detail)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-detail)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## Reference Rail decision matrix

The "Reference Rail" is the right-hand column on the record detail page
that surfaces summary cards for related collections (similar to
Salesforce's **Related** rail and HubSpot's **About this record**
sidebar). It is rendered by the `record:reference_rail` component. The
rail is **off by default** — it fans out a collection query per related
list — so the synth emits it only when the `buildDefaultPageSchema` call
opts in with `showReferenceRail: true`, and then only when:

1. The page is generated by the synth (`buildDefaultPageSchema`) — i.e.
   no explicit `Page` overrides the object's detail view.
2. That same synth call passes **≥2 entries** in its `related` option —
   the count is read off the caller's option, **not** off the objectDef.
3. The viewport is **≥ xl (1280 px)** — below that the rail collapses and
   the **Related** tab keeps full coverage.
4. The synth call does **not** opt out via `hideReferenceRail`.

Conditions 1, 2 and 4 are one conjunction inside `buildDefaultPageSchema`,
quoted here verbatim so that a later change to it shows up as a diff
against this page: `options.showReferenceRail === true`,
`!options.hideReferenceRail`, `Array.isArray(options.related)`,
`options.related.length >= 2`. Condition 3 is not part of that
expression — it is the `hidden xl:flex` class the synth puts on the
`aside` region.

### Opting in

The opt-in flag and the ≥2 count are both `buildDefaultPageSchema`
**options**, never objectDef keys:

```ts
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';
import type { ObjectDefLike } from '@object-ui/plugin-detail';

declare const opportunityDef: ObjectDefLike;

const page = buildDefaultPageSchema(opportunityDef, {
  showReferenceRail: true, // required — omit it and no rail is emitted
  related: [
    { objectName: 'quote', relationshipField: 'opportunity' },
    { objectName: 'task', relationshipField: 'related_to_opportunity' },
  ],
});
```

When the rail emits, the synth automatically suppresses the **Related**
tab so the same information isn't shown twice.

### Opting out

The opt-out is a `buildDefaultPageSchema` **option**, not an objectDef key:

```ts
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';
import type { ObjectDefLike } from '@object-ui/plugin-detail';

declare const productDef: ObjectDefLike;

const page = buildDefaultPageSchema(productDef, {
  hideReferenceRail: true,  // hide the rail; restore the Related tab
  hideRelatedTab: true,     // (optional) force-hide the Related tab too
});
```

### CRM business-domain guidance

| Object type        | Rail   | Why                                                          |
|--------------------|--------|--------------------------------------------------------------|
| Hub objects        | **on** | Account / Opportunity / Contact / Case — users browse laterally to quotes, contacts, activities |
| Transactional      | **on** | Quote / Contract / Order — show line-items + related parties at a glance |
| Campaign / Event   | **on** | Members, responses, child campaigns                         |
| Catalog            | **off**| Product / Price Book — users edit attributes; lateral relationships are noise |
| Atomic action      | **off**| Task / Note — focused single-column edit beats a related-list rail |
| Lead (unconverted) | **off**| Pre-conversion records have no children — keep it focused on the form |

### Adding the rail to a custom `Page`

For explicit (non-synth) Pages, add an `aside` region after the `main`
region:

```ts
const asideRegion = {
  name: 'aside',
  width: 'small',
  className: 'hidden xl:flex flex-col gap-4',
  components: [
    {
      type: 'record:reference_rail',
      id: 'opp_reference_rail',
      properties: {
        entries: [
          { objectName: 'quote',                 relationshipField: 'opportunity', title: 'Quotes',     limit: 3 },
          { objectName: 'opportunity_line_item', relationshipField: 'opportunity', title: 'Products',   limit: 3 },
          { objectName: 'task',                  relationshipField: 'related_to_opportunity', title: 'Open Tasks', limit: 3 },
        ],
      },
    },
  ],
};
```

The `entries` go in the node's `properties` bag, as the example shows: that
bag is the contract, and `objectui validate` refuses a flat `entries` written
on the node itself, naming `properties.entries`.

## License

MIT — see [LICENSE](./LICENSE).
