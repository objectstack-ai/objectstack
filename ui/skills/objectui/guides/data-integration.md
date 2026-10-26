# ObjectUI Data Integration

Connecting schema-driven rendering to a real or mock data backend. The DataSource interface is the universal adapter between the UI layer and any API protocol.

## Architecture

```
┌─────────────────────────────┐
│  Schema-Driven UI Layer     │
│  (SchemaRenderer, Plugins)  │
├─────────────────────────────┤
│  SchemaRendererProvider     │  ← dataSource prop (the ADAPTER)
├─────────────────────────────┤
│  DataSource Interface       │  ← universal API contract
├─────────────────────────────┤
│  Adapter Implementation     │
│  (ObjectStack, REST, Mock)  │
└─────────────────────────────┘
```

⚠️ That column is the FETCH channel and nothing else. The **values a page's
`${…}` expressions and `bind` paths read** arrive on a second, independent
channel — the ambient scope a host publishes with `PredicateScopeProvider`.
`dataSource` publishes no expression root and answers no `bind`
path; keep the two apart when you wire a page.

Components never import fetch libraries directly. They call the DataSource
methods from context for CRUD, and read the ambient scope through
`useDataScope(path)`.

## DataSource interface

⚠️ The fence below is a deliberately SIMPLIFIED teaching copy, kept rather than
replaced by an import: `data.ts` lists every published `DataSource` member and the
excerpt is what makes this section readable. The real one is
`import type { DataSource } from '@object-ui/types';` (source:
`packages/types/src/data.ts`) — read it before you rely on any member's exact
signature, because nothing checks the copy below against it.

```typescript
interface DataSource<T = any> {
  // Core CRUD (required)
  find(resource: string, params?: QueryParams): Promise<QueryResult<T>>;
  findOne(resource: string, id: string | number, params?: QueryParams): Promise<T | null>;
  create(resource: string, data: Partial<T>): Promise<T>;
  update(resource: string, id: string | number, data: Partial<T>): Promise<T>;
  delete(resource: string, id: string | number): Promise<boolean>;

  // Schema introspection (required)
  getObjectSchema(objectName: string): Promise<any>;

  // Bulk operations (optional)
  bulk?(resource: string, op: 'create' | 'update' | 'delete', data: Partial<T>[]): Promise<T[]>;

  // View support (optional)
  getView?(objectName: string, viewId: string): Promise<any | null>;
  createView?(...); updateView?(...); deleteView?(...);

  // Analytics (optional)
  aggregate?(resource: string, params: AggregateParams): Promise<AggregateResult>;

  // Real-time (optional)
  onMutation?(callback: (event: MutationEvent) => void): () => void;
}
```

Six members are **required**; the optional half is much larger than the excerpt
above — `data.ts` lists every optional member, covering bulk/transaction,
views, apps & pages, file upload, and the export / import job lifecycles. Read
it before concluding a capability is missing, and note the spellings that do
**not** exist: there is no `saveView` and no `updateViewConfig` (write a view
through `createView` / `updateView`) and no generic `execute`.

### QueryParams

```typescript
import type { QueryParams } from '@object-ui/types';

// Imported, not re-declared: the nine keys below are the whole published type,
// so a private copy could only be a second, slower-moving answer.
const params: QueryParams = {
  $select: ['name', 'email'],     // SELECT specific fields
  $filter: { status: 'active' },  // WHERE conditions (or a FilterArray from @objectstack/spec/data)
  $orderby: { createdAt: 'desc' },
  $skip: 0,                       // OFFSET (for pagination)
  $top: 20,                       // LIMIT (page size)
  $expand: ['owner'],             // JOIN/expand related objects
  $search: 'acme',                // free-text search term
  $searchFields: ['name'],        // fields the search term is matched against
  $count: true,                   // ask the backend for `total`
};
```

`$orderby` also takes a `string`, a `string[]`, or an
`Array<{ field: string; order?: 'asc' | 'desc' }>` — read the published type for
the full union rather than copying this one arm.

⚠️ `QueryParams` declares those nine keys and **no index signature**. So an
unprefixed `limit` is a compile error at the call site, not a key that
type-checks and is then dropped on the wire. This fence claimed the opposite
while it kept its own copy — which is exactly the drift a copy cannot report.

### QueryResult

<!-- os:check -->
```typescript
import type { QueryResult } from '@object-ui/types';

// Imported, not re-declared. The fence's old copy was already the WHOLE type,
// member for member, so the copy bought the reader nothing and could only drift.
function summarize(result: QueryResult<{ id: string }>) {
  return {
    items: result.data,                      // required, and NOT named `records`
    total: result.total ?? result.data.length,
    nextCursor: result.hasMore ? result.cursor : undefined,
  };
}
```

The whole type is seven members: `data` (required), `total`, `page`
(1-indexed), `pageSize`, `hasMore`, `cursor`, `metadata`. `data` is the one a
mis-remembering adapter gets wrong — it is **not** named `records`.

## Wiring DataSource to SchemaRenderer

### Basic setup

```typescript
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = new ObjectStackAdapter({
  baseUrl: '/api/v1',
});

function App() {
  return (
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={pageSchema} />
    </SchemaRendererProvider>
  );
}
```

### With authentication

```typescript
import { createAuthenticatedFetch } from '@object-ui/auth';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

const authClient = createAuthClient({ baseURL: '/api/v1/auth' });
const authenticatedFetch = createAuthenticatedFetch(authClient);

const dataSource = new ObjectStackAdapter({
  baseUrl: '/api/v1',
  fetch: authenticatedFetch,  // Injects Bearer token automatically
});
```

### Static data (no backend)

For prototypes or static pages there is no adapter to inject. Publish the values
as an ambient **scope** instead — that is the channel `bind` and `${…}` read:

<!-- os:check -->
```tsx
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react'
import type { SchemaRendererProps } from '@object-ui/react'

declare const schema: SchemaRendererProps['schema']

const staticData = {
  customers: [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ],
  metrics: { total: 2, active: 1 },
  userRole: 'admin',
}

function Prototype() {
  return (
    <PredicateScopeProvider scope={staticData}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

Components that read `bind` (see "Via `bind` + `useDataScope`" below) will then
access `staticData.customers` when given `bind: "customers"`.

⛔ Passing that same object as `SchemaRendererProvider`'s `dataSource` does
**not** work and never warns: `dataSource` declares the `DataSource` adapter
contract, it publishes no expression root, and `useDataScope` no longer walks
it. Every `bind` resolves `undefined` and every `${…}` on the
page renders as its own source characters.

## ObjectStackAdapter

The built-in adapter for ObjectStack backends (`packages/data-objectstack`).

### Constructor options

```typescript
new ObjectStackAdapter({
  baseUrl: string;               // API base URL
  token?: string;                // Static API token
  autoReconnect?: boolean;       // Auto-reconnect on disconnect (default: true)
  maxReconnectAttempts?: number;  // Max retry count (default: 5)
  fetch?: typeof fetch;          // Custom fetch (for auth token injection)
});
```

### Connection management

```typescript
const adapter = new ObjectStackAdapter({ baseUrl: '/api/v1' });

// Listen for connection state changes
adapter.onConnectionStateChange((event) => {
  console.log(event.state); // 'connected' | 'disconnected' | 'error'
});

// Listen for batch progress
adapter.onBatchProgress((event) => {
  console.log(`${event.percentage}% complete`);
});
```

## How components access data

### Via `bind` + `useDataScope`

A component reads the `bind` field only if it calls `useDataScope`:

<!-- os:check -->
```json
{
  "type": "list",
  "bind": "customerNames"
}
```

Inside the component: `const data = useDataScope("customerNames")` resolves the
`customerNames` array **from the ambient scope** a host published with
`PredicateScopeProvider` — not from `SchemaRendererProvider`'s `dataSource`.

`useDataScope` is called by `list` and `tree-view` in `@object-ui/components`,
and by the `object-*` widgets the plugin packages register (`object-grid`,
`object-kanban`, `object-chart`, `object-data-table`, `object-gallery`,
`object-timeline`, `object-pivot`). Every other component ignores `bind` — no
error, no warning, nothing in the console — except `data-table` (one warning, below).

`data-table` is not among them, which is the trap worth knowing by name: it
takes its rows from an inline `data` array on the node, so a bound `data-table`
renders a correct-looking header over an empty body: nothing is thrown and
nothing on the page says why — the one signal is a `[ObjectUI] DataTable bind:`
console warning. Pointing the node's own `data` key at an
expression (`"data": "${data.customers}"`) fails the same way, with its own
console warning (`[ObjectUI] DataTable data:`) — node keys are
not expression-evaluated — so **the host resolves the array and puts it on the
node**, as below. The one spelling that does carry a provider expression
through is measured, with its open-question caveat, in
[`../rules/protocol.md`](../rules/protocol.md).

<!-- os:check -->
```json
{
  "type": "data-table",
  "data": [
    { "name": "Ada Lovelace", "email": "ada@example.com" },
    { "name": "Grace Hopper", "email": "grace@example.com" }
  ],
  "columns": [
    { "header": "Name", "accessorKey": "name" },
    { "header": "Email", "accessorKey": "email" }
  ]
}
```

### Via expressions on the node

Computed values go through the expression system. `content` is the text key that
is both expression-evaluated and read back by the renderer. The roots it reads
are the ones the host published on `PredicateScopeProvider`, so the example below
assumes a scope carrying `data: { metrics: { total: … } }`:

<!-- os:check -->
```json
{
  "type": "card",
  "title": "Total Customers",
  "children": [
    { "type": "text", "content": "${data.metrics.total} customers" }
  ]
}
```

A `statistic` declares `label` / `value` / `description` as expression-bindable,
so these are evaluated on the node and read back. Host-resolved
literals work exactly as before:

<!-- os:check -->
```json
{
  "type": "statistic",
  "label": "Total Customers",
  "value": "128",
  "description": "+12 this week",
  "trend": "up"
}
```

Do not reach for a `props` envelope to get an expression evaluated — values
inside it are evaluated and then handed over as React props, which these
renderers never read, so the component paints an empty frame. (`properties` is a
different envelope and behaves differently; see
[`../rules/protocol.md`](../rules/protocol.md).)

### Via DataSource methods (in plugin code)

Plugin components that need CRUD operations access the DataSource from context
— and must guard it before calling. `useSchemaContext()` throws only when there
is **no provider** above the component; a provider with **no adapter bound** is
an ordinary, supported state (a Studio preview, a page that renders before the
host connects its adapter, a widget test that drives `apiFetch` alone). The
renderer itself already reads the member that way — `useDataScope` returns
`undefined` when nothing is bound — so an unguarded call throws on its first use
in exactly those places. Decide what the component shows while the adapter is
absent:

<!-- os:check -->
```typescript
import { useSchemaContext } from '@object-ui/react';

function MyPlugin() {
  const { dataSource } = useSchemaContext();

  const loadData = async () => {
    // No adapter bound is a real state, not an error — see above.
    if (!dataSource) return [];

    const result = await dataSource.find('contacts', {
      $filter: { active: true },
      $orderby: [{ field: 'name', order: 'asc' }],
      $top: 20,
    });
    return result.data;
  };
}
```

## MSW mock setup (frontend-first development)

For developing the UI without a running backend, use Mock Service Worker with ObjectStack's in-browser kernel.

### Browser mock server

```typescript
// src/mocks/browser.ts
import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { MSWPlugin } from '@objectstack/plugin-msw';

export async function startMockServer(appConfig: any) {
  const kernel = new ObjectKernel({ skipSystemValidation: true });

  await kernel.use(new ObjectQLPlugin());

  const driver = new InMemoryDriver();
  await kernel.use(new DriverPlugin(driver, 'memory'));
  await kernel.use(new AppPlugin(appConfig));
  await kernel.use(new MSWPlugin({
    enableBrowser: true,
    baseUrl: '/api/v1',
    logRequests: true,
  }));

  await kernel.bootstrap();

  // Seed initial data
  if (appConfig.manifest?.data) {
    for (const dataset of appConfig.manifest.data) {
      for (const record of dataset.records) {
        await driver.create(dataset.object, record);
      }
    }
  }
}
```

### App entry with MSW

```typescript
// src/main.tsx
import { startMockServer } from './mocks/browser';
import appConfig from '../objectstack.config';

async function bootstrap() {
  if (import.meta.env.DEV) {
    await startMockServer(appConfig);
  }

  const root = ReactDOM.createRoot(document.getElementById('root')!);
  root.render(<App />);
}

bootstrap();
```

### Test DataSource helper

<!-- os:check -->
```typescript
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

export function createTestDataSource() {
  return new ObjectStackAdapter({ baseUrl: '/' });
}
```

## Building a custom DataSource adapter

If your backend isn't ObjectStack-compatible, implement the DataSource interface:

<!-- os:check -->
```typescript
import type { DataSource, QueryParams, QueryResult } from '@object-ui/types';

export class RestApiAdapter implements DataSource {
  constructor(private baseUrl: string) {}

  async find(resource: string, params?: QueryParams): Promise<QueryResult> {
    const url = new URL(`${this.baseUrl}/${resource}`);
    if (params?.$filter) url.searchParams.set('filter', JSON.stringify(params.$filter));
    if (params?.$top) url.searchParams.set('limit', String(params.$top));
    if (params?.$skip) url.searchParams.set('offset', String(params.$skip));
    if (params?.$orderby) url.searchParams.set('sort', JSON.stringify(params.$orderby));

    const res = await fetch(url.toString());
    const body = await res.json();

    return {
      data: body.items,
      total: body.totalCount,
      pageSize: params?.$top,
    };
  }

  async findOne(resource: string, id: string | number): Promise<any> {
    const res = await fetch(`${this.baseUrl}/${resource}/${id}`);
    return res.json();
  }

  async create(resource: string, data: Partial<any>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async update(resource: string, id: string | number, data: Partial<any>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/${resource}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async delete(resource: string, id: string | number): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/${resource}/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  async getObjectSchema(objectName: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/schema/${objectName}`);
    return res.json();
  }
}
```

## Mutation event subscription

For real-time UI updates when data changes:

```typescript
const adapter = new ObjectStackAdapter({ baseUrl: '/api/v1' });

// Subscribe to mutations
const unsubscribe = adapter.onMutation?.((event) => {
  console.log(`${event.type} on ${event.resource}:`, event.record);
  // Trigger re-fetch in the affected component
});

// Clean up
unsubscribe?.();
```

## Common data integration mistakes

- Spelling `QueryParams` options without the `$` prefix (`limit`, `filter`, `sort`): the index signature accepts them, nothing reads them, and a dropped `$top` fetches the whole table.
- Importing `fetch` directly in components instead of using DataSource from context.
- Forgetting to await `startMockServer()` before rendering — MSW intercepts aren't ready.
- Mismatched `baseUrl` between MSW plugin and ObjectStackAdapter — requests bypass mocks.
- Not providing `getObjectSchema()` — plugins that need field metadata will fail.
- Passing a DataSource adapter instance where a static object is expected (or vice versa).
- Not handling loading/error states in components that fetch data.
