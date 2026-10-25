# Console Streamlining - Architecture Guide

## Overview

This document describes the refactored architecture that enables third-party systems to use ObjectUI components without inheriting the full console infrastructure.

## New Packages

### @object-ui/app-shell

**Purpose**: Minimal application rendering engine

**Exports**:
- `AppShell` - Basic layout container
- `ObjectView` - Renders object views; it reads `objectName` from the router
  (`useParams()`) and takes an `objects` metadata array. For a router-free embed,
  use `ObjectView` from `@object-ui/plugin-view` instead - see the examples below.
- `DashboardView` - Renders a dashboard by name. The dashboard renderer itself,
  `DashboardRenderer`, is not an app-shell export - it ships from
  `@object-ui/plugin-dashboard`, and `DashboardView` renders through it.
- `PageView` - Renders a custom page by name. No package exports a
  `PageRenderer`: a page body is dispatched through the component registry on
  the schema node's `type` (`page`, `app`, `utility`, `home`, `record`).
- `RecordFormPage` - Renders a full-screen create/edit page. No package exports
  a `FormRenderer`; the exported form renderer is `ObjectForm` from
  `@object-ui/plugin-form`, which this page delegates to.

**Dependencies**: `@object-ui/react`, `@object-ui/components`, `@object-ui/fields`, `@object-ui/layout`

**Bundle Size**: ~50KB

### @object-ui/providers

**Purpose**: The upload adapter context

**Exports**:
- `UploadProvider` / `useUpload` - The ambient upload adapter the file and image fields upload through
- `createObjectStackUploadAdapter`, `createS3Adapter`, `createAzureBlobAdapter`, `createObjectUrlAdapter`

Its former `DataSourceProvider`, `MetadataProvider` and `ThemeProvider` retired
(objectui#13453). The data source is `SchemaRendererProvider` and the theme is
`ThemeProvider`, both from `@object-ui/react`; metadata is `MetadataProvider` from
`@object-ui/app-shell`.

**Dependencies**: `@object-ui/types`

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│  Third-Party Application                │
│  (Your Custom Console)                  │
└────────────────┬────────────────────────┘
                 │
                 ├── Custom Routing (React Router, Next.js, etc.)
                 ├── Custom Auth (Your implementation)
                 ├── Custom API (REST, GraphQL, etc.)
                 │
┌────────────────┴────────────────────────┐
│  @object-ui/app-shell                   │
│  - AppShell                             │
│  - ObjectView                           │
│  - DashboardView                        │
│  - PageView                             │
│  - RecordFormPage                       │
└────────────────┬────────────────────────┘
                 │
┌────────────────┴────────────────────────┐
│  @object-ui/react                       │
│  - SchemaRenderer                       │
│  - SchemaRendererProvider (data source) │
│  - ThemeProvider                        │
│  - useActionRunner                      │
│  - Component Registry                   │
└────────────────┬────────────────────────┘
                 │
                 ├──────────────┬──────────────┬──────────────┐
                 │              │              │              │
┌────────────────┴──┐  ┌────────┴────┐  ┌──────┴────┐  ┌─────┴──────┐
│ @object-ui/       │  │ @object-ui/ │  │@object-ui/│  │ Plugins    │
│ components        │  │ fields      │  │ layout    │  │ (optional) │
│ (Shadcn UI)       │  │ (Inputs)    │  │ (Layouts) │  │            │
└───────────────────┘  └─────────────┘  └───────────┘  └────────────┘
```

## Comparison: Before vs After

### Before (Monolithic Console)

```
apps/console (500KB+)
├── Routing (hardcoded)
├── Auth (ObjectStack only)
├── Data Source (ObjectStack only)
├── Admin Pages (forced)
├── App Management (forced)
└── Object Rendering
```

**Problems**:
- Cannot use without full console
- Tied to ObjectStack backend
- No customization of routing/auth
- Large bundle size

### After (Modular Architecture)

```
@object-ui/app-shell (50KB)
├── Object Rendering
├── Dashboard Rendering
├── Page Rendering
└── Form Rendering

@object-ui/react
├── SchemaRendererProvider (generic DataSource)
└── ThemeProvider

Third-Party App
├── Custom Routing
├── Custom Auth
├── Custom API
└── Cherry-picked Components
```

**Benefits**:
- Use components independently
- Bring your own backend
- Full customization
- Small bundle size

## Migration Path

### Phase 1: New Packages (Current)

1. Create `@object-ui/app-shell`
2. Create `@object-ui/providers`
3. Create `examples/byo-backend-console`
4. No breaking changes to console

### Phase 2: Extract More Components (Future)

1. Create `@object-ui/console-components`
2. Create `@object-ui/routing`
3. More examples (Next.js, Embedded)

### Phase 3: Refactor Console (Future)

1. Console uses new packages internally
2. Reduce console to ~150 lines
3. Console becomes reference implementation

## Usage Examples

### Example 1: Minimal Custom Console

```tsx
import { AppShell } from '@object-ui/app-shell';
import type { MinimalAppShellProps } from '@object-ui/app-shell';
import { ObjectView } from '@object-ui/plugin-view';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

// The two things you bring. Both are typed from the surface these packages
// ship, so this snippet compiles on its own: `myAPI` is your backend adapter
// (the "Custom Data Source Interface" section below is the shape it needs),
// and `MySidebar` is your own component, returning whatever `AppShell`
// accepts for `sidebar`.
declare const myAPI: DataSource;
declare function MySidebar(): MinimalAppShellProps['sidebar'];

function MyConsole() {
  return (
    <SchemaRendererProvider dataSource={myAPI}>
      <AppShell sidebar={<MySidebar />}>
        <ContactList />
      </AppShell>
    </SchemaRendererProvider>
  );
}

function ContactList() {
  return (
    <ObjectView schema={{ type: 'object-view', objectName: 'contact' }} dataSource={myAPI} />
  );
}
```

### Example 2: Next.js Integration

Both files below open with `'use client'`. Under the Next.js App Router every
module under `app/` is a **server** component by default, and the `@object-ui/*`
packages carry no `'use client'` banner of their own — so the client boundary has
to be declared here, in the files that import them. Without the directive the
layout's React context providers and the page's client view are both asked to
run on the server, where neither exists.

`app/layout.tsx`:

```tsx
'use client';

import { AppShell } from '@object-ui/app-shell';
import type { MinimalAppShellProps } from '@object-ui/app-shell';
import { ThemeProvider } from '@object-ui/react';

export default function RootLayout({ children }: { children: MinimalAppShellProps['children'] }) {
  return (
    <ThemeProvider>
      <AppShell>{children}</AppShell>
    </ThemeProvider>
  );
}
```

`app/[object]/page.tsx`:

```tsx
'use client';

import { ObjectView } from '@object-ui/plugin-view';
import type { DataSource } from '@object-ui/types';

// Your backend adapter, imported from your own module.
declare const myAPI: DataSource;

export default function Page({ params }: { params: { object: string } }) {
  return <ObjectView schema={{ type: 'object-view', objectName: params.object }} dataSource={myAPI} />;
}
```

### Example 3: Embedded Widget

```tsx
import { ObjectView } from '@object-ui/plugin-view';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

// Your backend adapter, as in Example 1 — declared here because every block on
// this page compiles on its own.
declare const myAPI: DataSource;

function MyExistingApp() {
  return (
    <div className="my-app">
      <header>My App Header</header>

      {/* Embed ObjectUI widget */}
      <SchemaRendererProvider dataSource={myAPI}>
        <ContactWidget />
      </SchemaRendererProvider>

      <footer>My App Footer</footer>
    </div>
  );
}

function ContactWidget() {
  return <ObjectView schema={{ type: 'object-view', objectName: 'contact' }} dataSource={myAPI} />;
}
```

## Custom Data Source Interface

Third-party systems implement `DataSource`, which `@object-ui/types` **exports**.
Import it; never re-declare it locally. A local copy is a second contract that
drifts silently, and the components consume the exported one — `ObjectView`'s
`dataSource` prop is typed `DataSource`, so a stand-in that satisfies only a
hand-written look-alike is rejected at the call site.

A minimal adapter implements the interface's six **required** members. Both
halves of that sentence are checked when this page compiles, rather than
asserted:

```tsx
import type { DataSource } from '@object-ui/types';

// Which six they are. A member name that is not on the exported interface —
// `getMetadata`, say — fails this `Pick` rather than being read past.
type MinimalDataSource = Pick<
  DataSource,
  'find' | 'findOne' | 'create' | 'update' | 'delete' | 'getObjectSchema'
>;

// And that those six SUFFICE. Every other member of `DataSource` — `searchAll`,
// `bulk`, `getView`, `aggregate`, `exportDownload`, the import-job family — is optional, so
// a value with just the six is assignable to the whole interface. This line goes
// red the moment a seventh member becomes required.
declare const minimal: MinimalDataSource;
export const adapter: DataSource = minimal;
```

Example implementation. It is annotated `: DataSource`, which is what makes the
list above complete: leave a required member out and this block stops compiling,
so there is nothing here to elide. Parameter and return types are inferred from
the contract — read the signatures off it rather than off this page:

```tsx
import type { DataSource } from '@object-ui/types';

export const myDataSource: DataSource = {
  async find(resource, params) {
    const res = await fetch(`/api/${resource}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return res.json();
  },
  async findOne(resource, id) {
    const res = await fetch(`/api/${resource}/${id}`);
    return res.status === 404 ? null : res.json();
  },
  async create(resource, data) {
    const res = await fetch(`/api/${resource}`, { method: 'POST', body: JSON.stringify(data) });
    return res.json();
  },
  async update(resource, id, data) {
    const res = await fetch(`/api/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    return res.json();
  },
  async delete(resource, id) {
    const res = await fetch(`/api/${resource}/${id}`, { method: 'DELETE' });
    return res.ok;
  },
  async getObjectSchema(objectName) {
    const res = await fetch(`/api/metadata/${objectName}`);
    return res.json();
  },
};
```

## Testing Strategy

### Unit Tests

- Each package has its own test suite
- No cross-package dependencies in tests
- Mock data sources for testing

### Integration Tests

- Test byo-backend-console example end-to-end
- Verify custom data source integration
- Test routing scenarios

### E2E Tests

- Separate E2E tests for byo-backend-console
- Verify it works independently of full console

## Documentation

### Package READMEs

Each package has comprehensive documentation:
- Installation
- Usage examples
- API reference
- Migration guide

### Examples

- `examples/byo-backend-console` - Basic integration (~100 lines)
- `examples/nextjs-console` - Next.js integration (TODO)
- `examples/embedded-widget` - Embedded usage (TODO)

### Guides

- Architecture Guide (this document)
- Integration Guide
- Migration Guide for console users
- Cookbook for common patterns

## Success Metrics

- ✅ Third-party developer can build console in < 1 hour
- ✅ Minimal bundle size < 200KB (vs current 500KB+)
- ✅ Zero ObjectStack dependencies for core rendering
- ⏳ 100% test coverage for extracted packages
- ✅ At least 1 working integration example

## License

MIT
