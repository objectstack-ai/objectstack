---
title: "Building a CRUD App"
description: "End-to-end tutorial for building a complete CRUD application with ObjectUI — from schema definition to deployment"
---

# Building a CRUD App

This tutorial walks you through building a **Task Manager** CRUD application with ObjectUI — from schema definition to data source setup to deployment.

## Prerequisites

- **Node.js** and **pnpm** (or npm/yarn) — ObjectUI is tested on Node 22.x with pnpm 10.x.
- Basic knowledge of **React** and **TypeScript**

## Step 1: Project Setup

Create a new React project and install the required ObjectUI packages:

```bash
pnpm create vite task-manager --template react-ts
cd task-manager
```

Install ObjectUI core packages and the plugins you need:

```bash
pnpm add @object-ui/react @object-ui/core @object-ui/types @object-ui/components @object-ui/fields
pnpm add @object-ui/plugin-grid @object-ui/plugin-form @object-ui/plugin-detail
```

Install Tailwind CSS:

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

Add Tailwind to your `vite.config.ts`:

<!-- doc-snippet: fragment — a vite.config.ts for the app the reader is scaffolding; '@vitejs/plugin-react' and '@tailwindcss/vite' are that app's devDependencies, not this repo's -->
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Add to your `src/index.css`:

```css
@import "tailwindcss";
```

## Step 2: Register Components

Create `src/setup.ts` to register the built-in component and field renderers:

```ts
import { initializeComponents } from '@object-ui/components';
// Side-effect imports: loading each package runs its own registration.
import '@object-ui/fields';
import '@object-ui/plugin-grid';
import '@object-ui/plugin-form';
import '@object-ui/plugin-detail';

initializeComponents();
```

Loading each package registers what it owns — the components, the field widgets
and each plugin's blocks all go into the one `ComponentRegistry` that
`@object-ui/core` exports. `initializeComponents()` takes no arguments; it exists
so a bundler cannot tree-shake the side-effect import away.

**Every block this tutorial renders comes from a plugin**, so the three plugin
imports are not optional extras: `object-grid` lives in `@object-ui/plugin-grid`,
`object-form` in `@object-ui/plugin-form` and `detail-view` in
`@object-ui/plugin-detail`. Leave one out and `SchemaRenderer` has nothing to
resolve that `type` to — it renders the red **Unknown component type** panel
instead of the block.

Import this file once at the top of your app entry point (`src/main.tsx` or `src/App.tsx`).

## Step 3: Define the Object Schema

Create `src/schemas/task.ts`. This is the metadata that drives the entire UI — grid columns, form fields, validation, and views are all derived from this schema:

```ts
import type { FieldMetadata } from '@object-ui/types';

const fields: Record<string, FieldMetadata> = {
  title: { name: 'title', type: 'text', label: 'Title', required: true },
  status: {
    name: 'status',
    type: 'select',
    label: 'Status',
    defaultValue: 'Todo',
    options: [
      { label: 'Backlog', value: 'Backlog' },
      { label: 'Todo', value: 'Todo' },
      { label: 'In Progress', value: 'In Progress' },
      { label: 'Review', value: 'Review' },
      { label: 'Done', value: 'Done' },
    ],
  },
  priority: {
    name: 'priority',
    type: 'select',
    label: 'Priority',
    defaultValue: 'Medium',
    options: [
      { label: 'Critical', value: 'Critical' },
      { label: 'High', value: 'High' },
      { label: 'Medium', value: 'Medium' },
      { label: 'Low', value: 'Low' },
    ],
  },
  assignee: { name: 'assignee', type: 'text', label: 'Assignee' },
  due_date: { name: 'due_date', type: 'date', label: 'Due Date' },
  description: { name: 'description', type: 'textarea', label: 'Description' },
};

export const TaskSchema = {
  name: 'task',
  label: 'Task',
  icon: 'check-circle-2',
  titleFormat: '{title}',
  fields,
  listViews: {
    all: {
      label: 'All Tasks',
      columns: ['title', 'status', 'priority', 'assignee', 'due_date'],
    },
    active: {
      label: 'Active',
      columns: ['title', 'status', 'priority', 'assignee', 'due_date'],
      filter: [{ field: 'status', operator: 'not_equals', value: 'Done' }],
      sort: [{ field: 'priority', order: 'asc' }],
    },
  },
};
```

An object's metadata is a plain document — the same shape a backend serves from
`DataSource.getObjectSchema()` — so it is written as a literal rather than built
by a helper. `FieldMetadata` is the union every field entry belongs to (`text`,
`select`, `date`, `textarea`, …), and typing the `fields` record against it is
what makes a wrong `type` or a misspelled key fail at compile time. ObjectUI
reads those entries to choose the renderer, apply validation, and generate form
controls automatically.

## Step 4: Create a Data Source

ObjectUI never hardcodes `fetch` calls inside components. Instead, it communicates with your backend through the `DataSource` interface. Create `src/data/rest-data-source.ts`:

```ts
import type { DataSource, QueryParams, QueryResult } from '@object-ui/types';

export class RestDataSource implements DataSource {
  constructor(private baseUrl: string) {}

  async find(resource: string, params?: QueryParams): Promise<QueryResult> {
    const query = new URLSearchParams();
    if (params?.$top) query.set('$top', String(params.$top));
    if (params?.$skip) query.set('$skip', String(params.$skip));
    // `$orderby` is a union — an OData clause string, a map, or an array of
    // fields. This backend speaks the string form, so narrow to it rather
    // than stringifying a shape the server cannot parse.
    if (typeof params?.$orderby === 'string') query.set('$orderby', params.$orderby);
    if (params?.$search) query.set('$search', params.$search);
    const res = await fetch(`${this.baseUrl}/${resource}?${query}`);
    const data = await res.json();
    return { data: data.items, total: data.total };
  }

  async findOne(resource: string, id: string | number) {
    return (await fetch(`${this.baseUrl}/${resource}/${id}`)).json();
  }

  async create(resource: string, data: Partial<any>) {
    const res = await fetch(`${this.baseUrl}/${resource}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async update(resource: string, id: string | number, data: Partial<any>) {
    const res = await fetch(`${this.baseUrl}/${resource}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async delete(resource: string, id: string | number) {
    return (await fetch(`${this.baseUrl}/${resource}/${id}`, { method: 'DELETE' })).ok;
  }

  async getObjectSchema(objectName: string) {
    return (await fetch(`${this.baseUrl}/schema/${objectName}`)).json();
  }
}
```

> **Tip:** For the ObjectStack backend, use the official `@object-ui/data-objectstack` adapter instead of writing your own. See the [Data Connectivity](/docs/guide/data-source) guide for details.

## Step 5: Render a CRUD Grid View

Wire everything together in `src/App.tsx`. `SchemaRendererProvider` injects the
data source once, and every `SchemaRenderer` beneath it renders its schema
against that one adapter:

<!-- doc-snippet: fragment — the reader's src/App.tsx; './setup' and './data/rest-data-source' are the project files created in Steps 2 and 4 -->
```tsx
import './setup';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { RestDataSource } from './data/rest-data-source';

const dataSource = new RestDataSource('https://api.example.com/v1');

function App() {
  return (
    <SchemaRendererProvider dataSource={dataSource}>
      <div className="min-h-screen bg-background p-6">
        <SchemaRenderer
          schema={{
            type: 'object-grid',
            properties: { objectName: 'task' },
          }}
        />
      </div>
    </SchemaRendererProvider>
  );
}

export default App;
```

This renders a fully interactive data grid with sortable columns, pagination,
and row actions. `object-grid` fetches the object's schema itself — through
your data source's `getObjectSchema` (Step 4) — to generate the columns and
field types, so nothing from `src/schemas/task.ts` needs to be imported here;
that file only has to describe what your backend actually serves.

Two details in that snippet are load-bearing, and getting either wrong produces
a grid that draws its header and nothing else:

- **The data source is injected by an ancestor, not passed to the block.**
  `object-grid`, `object-form` and `detail-view` all read the adapter from
  `SchemaRendererProvider`, so it has to be *above* them in the tree. A
  `dataSource` written on the block itself reaches that one block and never
  becomes context for anything under it.
- **The object is named by `objectName`.** That is the key each of these blocks
  declares as required — inside the `properties` bag on `object-grid` and
  `object-form`, as the spec's page component declares their props, and on the
  node on `detail-view`; a differently-spelled key (`object`) is not read, so the
  block has no object to query.

Neither mistake used to say anything — the block simply rendered empty. Both now
report themselves: a block that resolves no adapter renders a **No data source
resolved** panel naming itself and the object it was about to read.

## Step 6: Add Create and Edit Forms

ObjectUI generates forms directly from your schema. Extend `App.tsx` with form state:

<!-- doc-snippet: fragment — two lines to paste into the App component of Step 5 — the useState import and the surrounding function body are already there -->
```tsx
const [showForm, setShowForm] = useState(false);
const [editId, setEditId] = useState<string | null>(null);
```

Add a "New Task" button and handle row clicks to open the edit form:

Both of these render inside the `SchemaRendererProvider` from Step 5, so neither
carries a data source of its own:

<!-- doc-snippet: fragment — JSX to place inside the Step 5 App component; showForm, editId and their setters are the state declared in the block above -->
```tsx
<SchemaRenderer
  schema={{ type: 'object-grid', properties: { objectName: 'task' } }}
  onRowClick={(row: any) => { setEditId(row.id); setShowForm(true); }}
/>

{showForm && (
  <SchemaRenderer
    schema={{
      type: 'object-form',
      properties: {
        objectName: 'task',
        mode: editId ? 'edit' : 'create',
        recordId: editId,
      },
    }}
    onSubmit={() => setShowForm(false)}
    onCancel={() => setShowForm(false)}
  />
)}
```

`recordId` is the key `object-form` reads to load the record it is editing — it
is the form's own spelling and is not shared with `detail-view`, which uses
`resourceId` (Step 8).

The form automatically renders the correct field widgets (text inputs, select dropdowns, date pickers) based on your `FieldMetadata` definitions. Validation rules like `required` are enforced out of the box.

In **create** mode the form also opens with the `defaultValue`s your schema
declares — the `status` and `priority` fields above start on `Todo` and
`Medium`, already submittable, rather than empty next to a required marker.
Only static defaults are seeded: a `defaultValue` that is a runtime token
(`'NOW()'`, `'current_user'`) or a CEL expression is an instruction the server
resolves at insert time, so the form leaves that field empty and lets it, with
*Set automatically when saved.* under the field while it stays empty. In
**edit** mode nothing is seeded — the form shows the record as stored. Values
you pass as `initialData` / `initialValues` outrank a schema default.

## Step 7: Add Filters and Search

Leverage the `active` list view you defined in Step 3 by binding the grid to
it declaratively, with the spec's per-element `dataSource` binding
(`dataSource: { object, view }`). This is the same binding `list-view`,
`detail-view` and every other object-bound block in this repo read —
`ElementDataSourceGate` resolves `view` against the object's saved views
(fetched through your data source's `getObjectSchema` / `listViews`) and
composes that view's `filter` and `sort` onto the query for you:

<!-- doc-snippet: fragment — an excerpt mixing a state declaration with the JSX it drives, to be placed inside the App component; it is not a standalone module -->
```tsx
const [activeView, setActiveView] = useState('all');

// View switcher buttons — the names match the `listViews` keys from Step 3.
<button onClick={() => setActiveView('all')}>All Tasks</button>
<button onClick={() => setActiveView('active')}>Active</button>

// The grid re-resolves `view` whenever `activeView` changes.
<SchemaRenderer
  schema={{
    type: 'object-grid',
    dataSource: { object: 'task', view: activeView },
  }}
/>
```

Selecting **Active** re-queries with the `active` view's `filter`
(`status != Done`) and `sort` (`priority asc`) applied — you never assemble
`$filter` / `$orderby` by hand. A view name your backend does not publish is
reported, not silently ignored: swap `activeView` for a name outside
`listViews` and the grid renders a configuration-error panel in place of the
table, the same way an unresolved `objectName` does (Step 5). A page that
instead fell back to the object's full, unfiltered scope would look like it
worked while returning every record regardless of which button was pressed —
so this block does not offer that fallback.

**Search needs no binding at all.** `object-grid` renders its own search box
in the toolbar — on by default — and typing there drives
`DataSource.find()`'s `$search` parameter directly; there is no separate
query-param key to author. Add `searchableFields: ['title', 'description']`
to the grid's `properties` bag to narrow which fields the server matches; leave
it out and the server decides.

## Step 8: Add a Detail View

Create a detail page that renders a single record with all its fields:

```tsx
import { SchemaRenderer } from '@object-ui/react';

function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-background p-6">
      <button onClick={onBack} className="mb-4 text-sm text-muted-foreground">
        ← Back to list
      </button>
      <SchemaRenderer
        schema={{
          type: 'detail-view',
          objectName: 'task',
          resourceId: taskId,
        }}
      />
    </div>
  );
}
```

Render `TaskDetail` inside the same `SchemaRendererProvider` as the grid — it
reads the injected data source from context, exactly as `object-grid` and
`object-form` do.

Two keys differ from the form above, and both matter:

- **`resourceId`, not `recordId`.** `detail-view` sources the record id from
  `resourceId`; `recordId` is `object-form`'s spelling. The two blocks are not
  interchangeable here.
- **No `data`.** On `detail-view`, `data` means *"here is the record already,
  do not fetch"* — so handing it anything (including the object's metadata)
  makes the block skip `findOne` entirely and render that value as if it were
  the record. Omit it and the block loads the record for itself.

Use this component in your main app with simple routing state, or integrate with a router like React Router or TanStack Router for URL-based navigation.

## Deployment Considerations

**Environment config** — Keep your API URL configurable:

<!-- doc-snippet: fragment — continues Step 4 — RestDataSource is the class defined there, and import.meta.env is Vite's typing in the reader's own app -->
```ts
const dataSource = new RestDataSource(
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
);
```

**Performance** — Use server-side pagination via `$top`/`$skip` query params. ObjectUI plugins support lazy loading via `LazyPluginLoader` from `@object-ui/react`. Set `cache: { enabled: true, ttl: 300 }` on your schema for client-side caching.

**Production build** — Run `pnpm build` and deploy the `dist/` folder to any static host (Vercel, Netlify, Cloudflare Pages).

**Authentication** — Extend `RestDataSource` to inject auth headers:

<!-- doc-snippet: fragment — extends the RestDataSource class defined in Step 4 -->
```ts
class AuthenticatedDataSource extends RestDataSource {
  constructor(baseUrl: string, private getToken: () => string) {
    super(baseUrl);
  }
  // Override fetch calls to include: Authorization: `Bearer ${this.getToken()}`
}
```

## Next Steps

- Explore the [Schema Overview](/docs/guide/schema-overview) for advanced schema features
- Add a Kanban board view using `@object-ui/plugin-kanban` (see the [Kanban Plugin](/docs/plugins/plugin-kanban) reference for runnable board schemas)
- Connect to a production backend with the [Data Connectivity](/docs/guide/data-source) guide
- Build multi-object apps with relationships using `lookup` / `master_detail` fields (see the [Lookup Field](/docs/fields/lookup) reference)
