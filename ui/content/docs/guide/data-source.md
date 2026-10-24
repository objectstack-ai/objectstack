---
title: "Data Connectivity"
---

ObjectUI follows the **Universal Adapter Pattern**. UI components do not hardcode transport details. They receive a `DataSource` implementation from `SchemaRendererProvider` and call a stable CRUD/query contract.

This keeps the renderer backend-agnostic: ObjectStack, REST, GraphQL, and proprietary backends can all be adapted behind the same interface.

## The Interface

The canonical interface lives in `@object-ui/types`:

```typescript
import type { BatchTransactionOperation, QueryParams, QueryResult } from '@object-ui/types';

export interface DataSource<T = unknown> {
  find(resource: string, params?: QueryParams): Promise<QueryResult<T>>;
  findOne(resource: string, id: string, params?: QueryParams): Promise<T | null>;
  create(resource: string, data: Partial<T>): Promise<T>;
  update(
    resource: string,
    id: string,
    data: Partial<T>,
    opts?: { ifMatch?: string },
  ): Promise<T>;
  delete(
    resource: string,
    id: string,
    opts?: { ifMatch?: string },
  ): Promise<boolean>;

  // Optional: atomically persist an ordered set of cross-object operations
  // (master-detail save). `{ $ref: <op index> }` links a child to a parent
  // created earlier in the same batch. Adapters without server-side atomicity
  // may emulate it — see below.
  batchTransaction?(
    operations: BatchTransactionOperation[],
  ): Promise<{ results: any[] }>;

  getObjectSchema(objectName: string): Promise<unknown>;
}
```

`find()` returns a `QueryResult<T>` so components can receive both rows and pagination metadata:

```typescript
interface QueryResult<T = unknown> {
  data: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  cursor?: string;
  metadata?: Record<string, unknown>;
}
```

## Available Adapters

### ObjectStack Adapter (Official)

Use `@object-ui/data-objectstack` for ObjectStack-compatible backends.

```bash
pnpm add @object-ui/data-objectstack
```

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.your-instance.com'
});
```

## Usage

Inject the data source at the renderer boundary:

```tsx
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DeclaredNode } from '@object-ui/types';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com'
});

// `object-grid` is a data-bound node: it reads `objectName` from its
// `properties` bag and queries the injected data source for the rows.
const mySchema: DeclaredNode = { type: 'object-grid', properties: { objectName: 'users' } };

function App() {
  return (
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={mySchema} />
    </SchemaRendererProvider>
  );
}
```

## Creating a Custom Adapter

If you have a proprietary backend, wrap its SDK or client in a `DataSource` implementation. Keep transport details in the adapter, not in renderers.

```typescript
import type { DataSource, QueryParams, QueryResult } from '@object-ui/types';

type User = {
  id: string;
  name: string;
  email: string;
};

type BackendClient = {
  listUsers(params?: QueryParams): Promise<{ rows: User[]; total?: number }>;
  getUser(id: string | number): Promise<User | null>;
  createUser(data: Partial<User>): Promise<User>;
  updateUser(id: string | number, data: Partial<User>): Promise<User>;
  deleteUser(id: string | number): Promise<boolean>;
  describeObject(name: string): Promise<unknown>;
};

class UserDataSource implements DataSource<User> {
  constructor(private readonly client: BackendClient) {}

  async find(resource: string, params?: QueryParams): Promise<QueryResult<User>> {
    if (resource !== 'users') {
      return { data: [], total: 0 };
    }

    const result = await this.client.listUsers(params);
    return {
      data: result.rows,
      total: result.total,
    };
  }

  findOne(_resource: string, id: string | number): Promise<User | null> {
    return this.client.getUser(id);
  }

  create(_resource: string, data: Partial<User>): Promise<User> {
    return this.client.createUser(data);
  }

  update(_resource: string, id: string | number, data: Partial<User>): Promise<User> {
    return this.client.updateUser(id, data);
  }

  delete(_resource: string, id: string | number): Promise<boolean> {
    return this.client.deleteUser(id);
  }

  getObjectSchema(objectName: string): Promise<unknown> {
    return this.client.describeObject(objectName);
  }
}
```

## Query Parameters

ObjectUI uses OData-style query keys for broad compatibility:

<!-- doc-snippet: fragment — continues the adapter block above: dataSource is the adapter created there, and repeating its construction here would bury the query keys this section is about -->
```typescript
await dataSource.find('users', {
  $select: ['id', 'name', 'email'],
  $filter: { status: 'active' },
  $orderby: { name: 'asc' },
  $skip: 0,
  $top: 25,
  $count: true,
});
```

Data-aware plugins may also use optional methods such as `batchTransaction`, `bulkUpdate`, `bulkDelete`, `getView`, or `listViewOverrides` when an adapter supports them. Keep the required CRUD methods implemented first, then add optional capabilities as your UI needs them.

`listMetadataItems(type)` lists one metadata registry type as `{ name, label }` headers, for the `position-ref` / `permission-ref` field widgets (see the [Fields guide](./fields.md)). An empty array means the registry has no item of that type, so a failed load must **reject**, never resolve `[]`.

### Cross-object atomic writes (`batchTransaction`)

Master-detail saves (a parent record plus its child line items) go through
`dataSource.batchTransaction(operations)` — one ordered list of cross-object
create/update/delete operations, where a child's foreign key can be
`{ $ref: <parent op index> }` to point at a parent created in the same batch.
The `@object-ui/data-objectstack` adapter maps this to the published
`@objectstack/client` `data.batchTransaction` SDK method, which drives the
server's atomic `POST /api/v1/batch` endpoint (commit-all-or-roll-back-all).
Adapters without a
transactional endpoint don't need to hand-write orchestration: call
`emulateBatchTransaction(dataSource, operations)` from `@object-ui/core`, which
executes the operations sequentially (resolving `$ref`s) with best-effort
compensation on failure. UI components never branch on atomicity — they call
`runBatchTransaction(dataSource, operations)` (also from `@object-ui/core`),
which uses the adapter's method when present and emulates otherwise.

The `@object-ui/data-objectstack` adapter decides whether it can trust server
atomicity **declaratively**, at connect time: it reads the
`capabilities.transactionalBatch` flag from `GET /api/v1/discovery`
(framework #3298). When the backend advertises `true`, the adapter treats any
`/batch` failure as a real error — no non-atomic client-side compensation. When
the flag is `false` or absent (a backend predating #3298), it keeps the legacy
behaviour: probe `/batch` and fall back to the non-atomic emulation on
`404`/`405`/`501`. Atomic cross-object saves are therefore guaranteed only
against backends that advertise the capability; older ones still save, but
best-effort. See the
[adapter README](https://github.com/objectstack-ai/objectui/blob/main/packages/data-objectstack/README.md#cross-object-atomic-batch-batchtransaction)
for the full capability table and minimum-backend note.

## Per-element data binding on a page (`dataSource`)

A metadata page component carries its own data binding —
`PageComponentSchema.dataSource`, the spec's `ElementDataSourceSchema` — so one
page can show several objects without a page-level object context:

```json
{
  "type": "list-view",
  "dataSource": { "object": "account", "view": "hot", "limit": 10 }
}
```

This is metadata, **not** the data-source adapter. The two share a name and are
different things: the adapter is injected by the host (`SchemaRendererProvider`),
while `dataSource` on a schema node is JSON describing *what to query*. A
renderer therefore reads the binding off `schema.dataSource` and gets its adapter
from context — never from a prop the schema could occupy. `SchemaRenderer` strips
the binding from the props it spreads for exactly this reason.

`view` names a **saved view** of that object; its columns, filter, sort and page
size are applied to the render, so a page never has to keep a second copy of a
view's configuration. `filter` is *additional* criteria — it AND-combines with the
view's filter rather than replacing it — while `sort` and `limit` override the
view's. Only a usable `limit` overrides: a binding cap the contract refuses (`0`,
a negative, a non-integer) is treated as not authored and yields to the view's
cap exactly as an absent one would, and the view's cap is held to the same rule. A `view` name that does not resolve is reported as a configuration error;
it never degrades into an unfiltered query for the object.

`@object-ui/react` exposes `useElementDataSource(schema, dataSource?)` for
renderers that need the same resolution, and `@object-ui/core` exposes the pure
parts (`isElementDataSourceConfig`, `resolveSavedView`,
`composeElementDataSource`).

### Which blocks consume it, and which keys each one honours

The binding is declared on every page component, but a component can only honour
the keys it has a read site for — a calendar has no page to cap, a metric is one
aggregated number, a form edits one record. Each block therefore maps the keys it
reads and leaves the rest alone; a key written onto a schema slot the block
ignores would be accepted and dropped, which is the defect this binding removes.

| block | `object` | `view` | `filter` | `sort` | `limit` |
|---|---|---|---|---|---|
| `list-view` | ✅ (`data`) | ✅ | ✅ | ✅ | ✅ |
| `object-grid` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `element:record_picker` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `element:number` | ✅ | filter | ✅ | — single value | — single value |
| `element:repeater` | ✅ | filter / sort / limit | ✅ | ✅ | ✅ |
| `record:related_list` | ✅ | columns / filter / sort / limit | ✅ | ✅ | ✅ |
| `object-calendar` | ✅ | filter / sort | ✅ | ✅ | — platform ceiling |
| `object-kanban` | ✅ | filter / limit | ✅ | — no ordering | ✅ (`limit`) |
| `object-chart` | ✅ | filter | ✅ | — engine orders | — no page |
| `object-metric` | ✅ | filter | ✅ | — single value | — single value |
| `object-gantt` | ✅ | filter / sort | ✅ | ✅ | — platform ceiling |
| `object-map` | ✅ | filter / sort | ✅ | ✅ | — platform ceiling |
| `object-pivot` | ✅ | filter | ✅ | — grouping orders | — totals need all rows |
| `object-timeline` | ✅ | filter / sort / limit | ✅ | ✅ | ✅ (`limit`) |
| `object-form` | ✅ | error-checked only | — no collection query | — | — |
| `embeddable-form` | ✅ | error-checked only | — no collection query | — | — |
| `object-master-detail-form` | ✅ | error-checked only | — no collection query | — | — |
| `record:line_items` | ✅ (`childObject`) | filter / sort / limit | ✅ (AND parent scope) | ✅ | ✅ (`limit`) |
| `record:details` | ✅ (its record) | filter / sort | ✅ | ✅ (picks the first row) | — one row is read |
| `record:highlights` | ✅ (its record) | filter / sort | ✅ | ✅ (picks the first row) | — one row is read |
| `record:quick_actions` | ✅ (its record) | filter / sort | ✅ | ✅ (picks the first row) | — one row is read |

Reading the `view` column: it lists what a named saved view actually contributes
on that block. A view name that does not resolve is reported as a configuration
error on **every** block in the table, including the ones that take nothing else
from the view — so a typo never passes silently, whatever the block.

Reading the `object` column: on a block with an object key it lands on that key,
which is `objectName` everywhere except `list-view` and `record:line_items`. A
`list-view` node names its object in `data` (`{ "provider": "object", "object": … }`),
the spec's list view spelling, and a bound `dataSource.object` outranks
`data.object`; the node's own `objectName` is not read. On `record:line_items` the collection the panel
lists, fetches and writes is `childObject`. Its `relationshipField` is *not* part
of the binding and stays the author's — it has to name a field on the bound child
object, so rebinding `object` without updating it is an authoring error the panel
cannot paper over. A `record:line_items` node bound this way needs no `childObject`
of its own, and the page compile accepts it; a node that names its child object in
neither place shows a configuration hint naming `childObject` and loads nothing.

Two kinds of block have no object key for the binding to land on. The
`element:*` blocks read `dataSource.object` themselves (see below). The three
one-record blocks, whose rows read "its record", take the binding's `object` as
the object of the record they show, and the bound row becomes that record.

`record:details`, `record:highlights` and `record:quick_actions` show the
record their record context carries. Bound, a block reads the FIRST row of
the bound set by the binding's `sort`, under the caller's own identity, and that
row becomes its record, so a product page shows a record without being a
`type: 'record'` page:

```json
{
  "type": "record:details",
  "properties": { "fields": ["name", "environment_type"] },
  "dataSource": {
    "object": "sys_environment",
    "filter": [{ "field": "environment_type", "operator": "equals", "value": "production" }],
    "limit": 1
  }
}
```

When no row matches — or the server refuses the read — the block draws its
authored `emptyState` in its place, when its `properties` declare one. That is
the spec's empty-state shape, the one `object-grid` takes: `{ title, message,
icon, link }`, with `title` and `message` as plain strings or inline locale maps
and `link` as `{ label, url }`. A block that declares none draws what it draws
for a record that is not there: `record:details` its "record not found" state,
`record:highlights` nothing, `record:quick_actions` an empty bar. The empty state
is never drawn while the read loads, on a block with no `dataSource`, or for a
read that fails any other way, which is reported in the block's place. `record:quick_actions`
runs the object's declared actions against the bound row's id. The bound row is
re-read whenever a write to its object is announced on the page (the data
source's mutation events, or `notifyDataChanged`). `objectui validate` warns on a
record block whose binding has no `limit: 1`, so the binding says which record it
means. On a record page, a block with no `dataSource` still shows the page's
record; a bound one shows its bound record instead, read-only.

Because the binding lands on `objectName` (on `list-view`, it stands in for
`data`), a node bound this way needs no `objectName` (or `data`) of its own. The schema validator (`StrictAnyComponentSchema`, which
`objectui validate` runs, and the tolerant `safeValidateSchema` alike) counts the binding as a record source of `list-view`,
`object-grid`, `object-kanban`, `object-calendar`, `object-gantt` and `object-map`,
and still refuses one of those nodes that declares no other record source and names
its object in neither place. A binding with an empty `object` names nothing.

The page compile accepts such a node too, on every row above whose object lands on
`objectName`, and on `list-view`: those registrations do not declare `objectName`
(on `list-view`, `data`) required, because the binding can supply it. The exception is `record:related_list`, whose spec row
requires `objectName`, so the page compile still refuses one of those nodes without
it. A node that names its object in neither place renders a short hint, "No object
named: set objectName or dataSource.object.", in place of an empty list, board,
form, chart, metric or pivot. On `list-view` the hint names the key a page node
writes: "No object named: set data.object or dataSource.object.". `object-grid`
shows its own "Object name required for data fetching" error instead. A block with another record source (inline `data`
rows, a form's inline fields — `customFields`, or `sections` whose every field is
inline — a chart's `dataset`, a `bind` path, or a metric's `fallbackValue`) draws
from that source and shows no hint.

`element:record_picker` and `element:number` keep their display configuration
in the node's `properties` bag and take their query from the binding **only**:
every query key either one reads comes from `dataSource` and from nowhere else.
The flat `properties.object`, `properties.filter`, `properties.sort` and
`properties.limit` on these two elements are not read, and `@objectstack/spec`
retires them (objectstack#11509). `element:number` no longer offers its flat
`object` or `filter` (objectui#12085), so the page validator reports either one
as a prop the metric does not have. The binding's filter is AND-combined with its
view's filter, as on every block above. On `element:number`,
`{ "dataSource": { "object": "contact" }, "properties": { "aggregate": "count" } }`
is a complete metric; its `sort` and `limit` are not read, because an aggregate
has no ordering and a capped count would be a wrong number, and a filter the
converter refuses shows the configuration-error panel instead of a count.
Either of the two whose node names no `dataSource.object` issues no query: an
`element:number` that sets `aggregate` shows a short "No object named: set
dataSource.object." notice instead of a count, and an `element:record_picker`
offers no records. The Studio page designer writes the metric's object into
`dataSource`.

`element:repeater` reads its query from the binding alone. `@objectstack/spec`
18 retired the flat `properties.object`, `properties.filter`, `properties.sort`
and `properties.limit` (objectstack#11509), and the repeater reads none of them
(objectui#12345); the spec's conversion moves them into `dataSource`. A node
that still carries one is refused by the spec's row and by the
`@object-ui/types` mirror, and the page validator reports it as a prop the
repeater does not have. The repeater requires no prop (objectui#12085): a node
whose `dataSource` names no object issues no query and shows its empty state.
With a named saved view, the binding's own `sort` and `limit` win and the
view's are the baseline, and the view's filter is AND-combined with the
binding's. The Studio page designer writes the repeater's object and its row
limit into `dataSource`, as it does the metric's object.

```json
{
  "type": "element:repeater",
  "dataSource": {
    "object": "task",
    "filter": [{ "field": "status", "operator": "equals", "value": "open" }],
    "sort": [{ "field": "due_date", "order": "asc" }],
    "limit": 5
  },
  "properties": { "titleField": "subject", "fields": ["due_date"] }
}
```

#### A related list's parent record: `parentDataSource`

`record:related_list` reads two bindings. Its `dataSource` is the CHILD rows the
list draws (its row in the table above). Its parent record — the record the
list hangs off — is the record page's record, or, when the block's
`properties` carry `parentDataSource`, the record that binding reads. The key
is a member of the spec's `record:related_list` row and takes the same object
binding `dataSource` takes. It is read the way the three one-record blocks
above read their record: the FIRST row of the binding by its `sort`, under the
caller's own identity, re-read whenever a write to its object is announced.
The list then draws that record's children through `relationshipField`, and
`relationshipValueField` is read on that row. So a product page lists a
record's children without being a `type: 'record'` page:

```json
{
  "type": "record:related_list",
  "properties": {
    "objectName": "sys_member",
    "relationshipField": "environment_id",
    "parentDataSource": {
      "object": "sys_environment",
      "filter": [{ "field": "environment_type", "operator": "equals", "value": "production" }],
      "limit": 1
    }
  }
}
```

When no row matches — or the server refuses the read — the block says so in its
place, naming the object, and draws no list: an empty list would read as "this
record has no related records". A read that fails any other way is reported in
the block's place. `objectui validate` warns on a `parentDataSource` without
`limit: 1`, and refuses the key written on the node instead of in `properties`.
On a record page, a related list without `parentDataSource` lists the page
record's children, as before; with it, it lists the bound record's children.

#### Scoping a filter to the record in view: `{record_id}`

On a `type: 'record'` page, a filter value can name the record the page shows
with `{record_id}`, in a component's own filter and in its `dataSource.filter`
alike. On a person's record page this counts that person's open tasks, and the
next person's page counts theirs:

```json
{
  "type": "element:number",
  "dataSource": {
    "object": "task",
    "filter": [{ "field": "assignee", "operator": "equals", "value": "{record_id}" }]
  },
  "properties": { "aggregate": "count" }
}
```

The id is the page's mounted record context, never a URL parameter or a page
variable. Anywhere with no record in context (a list view, a dashboard, a report,
a page that is not a record page) the token is refused by name: the renderer
warns, the value is left as written rather than dropped or blanked, and the
ObjectStack server refuses the query (`FILTER_TOKEN_UNRESOLVED`), so the number
never silently becomes a count over every record. `{record_id}` scopes what a
component *shows*; it is not access control, which stays with the server's
row-level security (objectui#7297).

On `record:related_list` and `record:line_items` the composed filter is
AND-combined with the parent relationship condition, never substituted for it: a
child panel is always scoped to the record it appears on, and an *additional*
criterion can only narrow that set further. (Until objectstack#7118
`record:related_list` declared `filter` without reading it, so a named view
contributed its columns / sort / limit while its filter was dropped — the list
could be wider than the view it named. That gap is closed; the `filter` cell above
is what closed it.)

`object-timeline` and `record:line_items` were the two residual gaps in this table
until objectstack#7137. Neither had a `filter` / `sort` read site at all — the
timeline's whole fetch was `find(objectName, { options: { $top: 100 } })` and the
line-items panel's was the parent FK plus a fixed `$top: 500` — so a `view` named
on either resolved (a typo reported) and then contributed nothing: the rendered
rows could be **wider than the view they named**, with no error anywhere. Both now
read `filter`, `sort` and `limit`, so the cells above are ✅. Two notes on what
came with that:

- The timeline's default window is `limit ?? 100` and it is now a real `$top`.
  The old `{ options: { $top: 100 } }` nested the cap under a key that is not a
  `QueryParams` field and that no adapter in this repo reads, so the intended cap
  never reached the wire; a timeline over a large object fetched whatever the
  server chose to return. Authoring `limit` (or a view's `pagination.pageSize`)
  now sets it.
- `record:line_items` still does **not** take a view's `columns`: they are editable
  `GridColumn` objects (`{ field, type, … }`) rather than a field-name projection,
  so a view's column list would be the wrong *shape*, not merely a wider answer.

`object-kanban` carried the same nesting, and until objectui#4025 this table read
`— fixed window` in its `limit` cell. There was no window: the board's cap was
written `{ options: { $top: 100 } }` — `$filter` at the top level where the
adapters read it, the cap one level down under a key that is not a `QueryParams`
field — so a board over a large object fetched every row the server would return
and grouped all of it into lanes, client-side. The cap is now a real `$top`,
defaulting to 100, and the `limit` cell is ✅ because the read site exists: a
`limit` authored on the block, the binding's `limit`, or the named view's
`pagination.pageSize` all set it. The board's `sort` cell still reads `— no
ordering` — lanes come from `groupBy` and the fetch declares no `$orderby`, so
mapping `sort` would be the accepted-and-dropped defect one block over.

Note the two `limit`s on a board are different keys at different levels: the row
cap above is `limit` on the **board**, while `limit` on a **column** is that
lane's WIP limit (how many cards it may hold before it warns), which is display
behaviour and never touches the query.

Reading `— platform ceiling` on `object-calendar` / `object-gantt` / `object-map`
(and on `object-tree`, which predates this table): those four are the **non-grid**
visualisations, and objectui#7210's maintainer ruling settled what their row
behaviour is. They fetch the whole **filtered** result set — a gantt cannot
compute a truthful `min(start) → max(end)` from one page, a map fits its camera to
every marker, and a tree assembled from a page loses every node whose parent fell
outside it — but the fetch is **bounded** by `NON_GRID_ROW_CEILING`
(`@object-ui/react`, currently 2,000). Past it the view draws the first N rows and
shows a footnote naming both N and the total. Silent truncation is the failure
that ruling exists to prevent: a cut-off schedule still looks like a schedule.

The `limit` cell stays "not ✅" for all four because the ceiling is **not
authorable and must not become one** — a named constant in the renderer, by the
same ruling. An authored `limit`, a binding's `limit` and a named view's
`pagination.pageSize` all still fail to reach these queries, which is what the
cell has always meant. What changed is only that "no cap at all" is no longer
true.

Remaining gap, recorded rather than papered over:

- `object-form` / `embeddable-form` / `object-master-detail-form` resolve `view`
  only to report an unresolvable name; a view that does resolve contributes
  nothing, because a list view's columns are not a form layout. On the
  master-detail form the bound object is the **parent**; child collections come
  from `details[]`, by FK.

Blocks not in the table (`dashboard`, the other `record:*` panels) do not consume
the binding yet.

## Binding a page element to an API endpoint (`provider: 'api'`)

`PageComponentSchema.dataSource` has a second shape beside the object binding:
the spec's `ElementApiDataSourceSchema`. It binds one same-origin endpoint
instead of the rows of an object:

```json
{
  "type": "stat",
  "dataSource": { "provider": "api", "read": { "url": "/api/v1/cloud/home" }, "path": "data" },
  "properties": { "label": "Members", "value": "${data.members.count}" }
}
```

`SchemaRenderer` honours it on every node:

- It reads `read.url` with `GET`, through the host's authenticated fetch
  (`SchemaRendererProvider`'s `apiFetch`; the console passes its signed-in
  fetch), and selects `path` from the answer — dotted keys, a numeric segment
  indexing a list. Omit `path` to bind the whole answer.
- The selected value is `data` in the node's `${…}` holes and in its
  `visibleWhen`, and in the holes of everything the node renders. A hole that is
  the whole string (`"${data.members.count}"`) evaluates to the value itself — a
  number, a boolean, a list — rather than to text.
- While the read is in flight the node draws a loading line; a failed read, or
  a `path` that selects nothing, draws an error panel naming why. The node is
  never drawn without its data.
- The binding is judged by the spec's own schema before anything is read. An
  absolute or protocol-relative `url`, a credential key, or a `method` other
  than `GET` is refused with the spec's message, and no request is sent.

Elements that bind the same URL at the same time share one request. A host can
also keep one open's answers: inside `ElementApiOpenScope` (from
`@object-ui/react`), a read that has already answered in the same open is
answered again with no request. The console mounts it and counts one open per
visit of a history entry, so a navigation entry's `visible` and a page element bound to
the same URL make one request, even when the entry's read settled first:

- following a link, a navigation entry, or Back and Forward starts a new open,
  and the page reads again, even on an entry visited before;
- a redirect that replaces the address (the app root's landing on its first
  entry) stays in the open;
- a failed read is not kept, and any declared data change (`notifyDataChanged`,
  which every save and action reports) drops what the open kept, so a read
  after a write asks the server.

Outside such a scope nothing is kept beyond the request in flight: a page that
mounts again reads again.

The console's product-page blocks — `hero`, `stat`, `usage-bar`, `checklist` and
`tile-grid` — accept this binding in their arms; see the `@object-ui/app-shell`
README.
