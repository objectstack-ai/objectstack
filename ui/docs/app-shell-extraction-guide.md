# `@object-ui/app-shell` — Architecture Guide

## Overview

This document describes `@object-ui/app-shell` as it ships today, and the two
ways a host uses it: compose the full console from its building blocks, or take
only the layout container and bring your own routing, auth and backend.

The package started as a minimal rendering engine for third-party hosts. It has
since become the home of the console itself: its routing tree, its auth and
organization pages, Studio, the metadata admin engine, the marketplace and the
AI chat pages all live here, and `apps/console` composes them. The sections
below describe that package, not the original plan.

## What the package contains

### `@object-ui/app-shell`

**Entry**: one root entry, `.` (`src/index.ts`), plus `./styles.css`. There are
no subpath exports.

**Size** (non-test TypeScript under `src/`): about 211,000 lines in about 600
files, with about 1,700 test files beside them. By directory:

| Directory | Lines | What it holds |
|:---|---:|:---|
| `views/metadata-admin` | ~97,000 | The generic metadata admin engine: directory, list, edit, history and diagnostics pages, the schema form, the per-type previews and inspectors, and its own designer string table (`i18n.ts`) |
| `views/studio-design` | ~22,000 | The Studio WYSIWYG design surface, its per-type canvases and the builder landing page |
| `views/` (the rest) | ~27,000 | The inner-SPA views: `ObjectView`, `RecordDetailView`, `RecordFormPage`, `DashboardView`, `PageView`, `ReportView`, search, flows, approvals |
| `console/` | ~22,000 | The console routing tree (`AppContent`, `ConsoleShell`) and its pages: auth, home, organizations, marketplace, AI chat |
| `hooks/`, `layout/`, `utils/`, `providers/`, `chrome/`, `context/`, the rest | ~43,000 | Shell chrome (header, sidebar, command palette, toasts), the metadata, adapter and expression providers, navigation and user-state hooks, runtime configuration and observability |

**Exports**: the root entry publishes about 200 names (about 35 of them
type-only). They fall into these groups, in the order `src/index.ts` lists
them:

- **The minimal shell** — `AppShell` (layout container) and its
  `MinimalAppShellProps`.
- **Providers and hooks** — `AdapterProvider`, `MetadataProvider`,
  `ExpressionProvider`, the settle signal (`useSettleSignal`, `whenIdle`, …),
  recent items, favorites, navigation pins and sync, the AI-surface signal.
- **Console building blocks** — `ConsoleShell`, `ConnectedShell`,
  `AuthenticatedRoute`, `RequireOrganization`, `SystemRedirect`,
  `SetupRedirect`, and the host-app route policy (`resolveHostAppSegment`).
- **Layout chrome and top-level chrome** — `ConsoleLayout`, `AppHeader`,
  `UnifiedSidebar`, `ConsolePageHeader`, `CommandPalette`, `ConsoleToaster`,
  `ErrorBoundary`, `ThemeProvider`, the unsaved-edits guard.
- **Runtime configuration and observability** — `initRuntimeConfig`,
  `getRuntimeConfig` and the branding / stage readers; Sentry wiring.
- **Inner-SPA views** — `ObjectView`, `RecordDetailView`, `RecordFormPage`,
  `DashboardView`, `PageView`, `ReportView`, `SearchResultsPage`,
  `FlowRunner`.
- **Default pages** — `DefaultAppContent`, `DefaultLoginPage`,
  `DefaultRegisterPage`, `DefaultHomePage`, the organization pages,
  `MarketplacePage`, `AiChatPage`, with the sign-up decision they share
  (`decideSignUpOffer`).
- **Registries** — the app component registry (`registerAppComponent`), the
  metadata resource, preview and inspector registries, and the Studio canvas
  registry, so a plugin can override a page without forking it.
- **Metadata admin and Studio pages** — `MetadataDirectoryPage`,
  `MetadataResourceRouter`, `SchemaForm`, `StudioDesignSurface`,
  `BuilderLanding`, `PackagedAutomationPage`.
- **AI assistant bus** — `assistantBus`, connecting the metadata designers to
  the chat.

The [package README](../packages/app-shell/README.md) is the API reference for
these names.

**Load-time registrations**: importing the entry registers, as a side effect,
the built-in admin components, the console's SDUI widgets (cloud connection,
product blocks, diagnostics), the record blocks (`record:attachments`,
`record:approvals`, `record:approval_decision`), the global search,
notifications, app launcher and nav menu blocks, and the metadata admin
built-ins. The built-in metadata designers load from a deferred chunk on the
first read of a designer registry, not during the entry's evaluation; the
console's first-load budget (`scripts/check-eager-closure-budget.mjs`) is sized
on that.

**Dependencies**: `@object-ui/react`, `@object-ui/components`,
`@object-ui/fields`, `@object-ui/layout`, `@object-ui/core`,
`@object-ui/types`, `@object-ui/i18n`, `@object-ui/auth`,
`@object-ui/permissions`, `@object-ui/providers`,
`@object-ui/data-objectstack`, `@object-ui/collaboration`,
`@object-ui/plugin-editor`, `@objectstack/spec`, `@objectstack/formula`,
`@objectstack/lint`; the view plugins (`plugin-grid`, `plugin-list`,
`plugin-form`, `plugin-detail`, `plugin-view`, `plugin-dashboard`,
`plugin-calendar`, `plugin-kanban`, `plugin-charts`, `plugin-report`,
`plugin-designer`, `plugin-chatbot`) are peer dependencies.

**Bundle size**: not one number. A host that imports only `AppShell` still
evaluates the entry and its load-time registrations; the console's eager
closure is measured and budgeted by `scripts/check-eager-closure-budget.mjs`,
not by this page.

### `@object-ui/providers`

**Purpose**: The upload adapter context

**Exports**:
- `UploadProvider` / `useUpload` - The ambient upload adapter the file and image fields upload through
- `createObjectStackUploadAdapter`, `createS3Adapter`, `createAzureBlobAdapter`, `createObjectUrlAdapter`

Its former `DataSourceProvider`, `MetadataProvider` and `ThemeProvider` retired
(objectui#13453). The data source is `SchemaRendererProvider` and the theme is
`ThemeProvider`, both from `@object-ui/react`; metadata is `MetadataProvider` from
`@object-ui/app-shell`.

**Dependencies**: `@object-ui/types`

## Who consumes it

Inside this repository three workspace members depend on the package:

- `apps/console` — the product console. It imports about 75 names from the
  root entry, and composes the routing tree mostly through
  `DefaultAppContent`, so components such as `ObjectView` and `ConsoleLayout`
  reach it through that tree rather than by name.
- [`examples/console-starter`](../examples/console-starter/README.md) — the
  minimal full console: `ConsoleShell`, `AuthenticatedRoute`, the `Default*`
  pages and `DefaultAppContent`.
- [`examples/byo-backend-console`](../examples/byo-backend-console/README.md) —
  the bring-your-own-backend embed. It imports `AppShell` only and renders data
  through `@object-ui/plugin-view` and `@object-ui/react`.

A name the root entry exports that nothing outside the package names is retired
from the entry, not kept for a caller that may come: the module that defines it
stays, and in-package code imports it from there.

## Architecture Diagram

```
┌────────────────────────────────────────────────┐
│  Host                                          │
│  apps/console · examples/console-starter       │
│  (or your own app — see byo-backend-console)   │
└───────────────────────┬────────────────────────┘
                        │
┌───────────────────────┴────────────────────────┐
│  @object-ui/app-shell                          │
│  - AppShell (minimal layout container)         │
│  - ConsoleShell / DefaultAppContent (routing)  │
│  - Default pages: auth, home, orgs, AI chat    │
│  - Inner-SPA views: ObjectView, RecordDetail…  │
│  - Metadata admin engine + Studio              │
│  - Providers, chrome, registries               │
└───────────────────────┬────────────────────────┘
                        │
┌───────────────────────┴────────────────────────┐
│  @object-ui/react                              │
│  - SchemaRenderer                              │
│  - SchemaRendererProvider (data source)        │
│  - ThemeProvider                               │
│  - useActionRunner                             │
│  - Component Registry                          │
└───────────────────────┬────────────────────────┘
                        │
     ┌──────────────┬───┴──────────┬──────────────┐
     │              │              │              │
┌────┴──────┐ ┌─────┴─────┐ ┌──────┴────┐ ┌───────┴──────┐
│@object-ui/│ │@object-ui/│ │@object-ui/│ │ View plugins │
│components │ │ fields    │ │ layout    │ │ (peer deps)  │
└───────────┘ └───────────┘ └───────────┘ └──────────────┘
```

## Two ways to use it

### The full console

Compose the console's routing tree from the building blocks, as
`examples/console-starter` does: `ConsoleShell` around `AuthenticatedRoute`,
the `Default*` pages, and `DefaultAppContent` for the app routes. This brings
the whole package: its auth flow against the ObjectStack backend, Studio, the
metadata admin pages and the marketplace.

### Bring your own backend

Take `AppShell` for the layout and render data with the view plugins and
`@object-ui/react` against your own `DataSource`, as
`examples/byo-backend-console` and the examples below do. Routing, auth and the
API are yours. The view to embed is `ObjectView` from
`@object-ui/plugin-view`; app-shell's own `ObjectView` reads `objectName` from
the router (`useParams()`) and is meant for the console's route tree.

The package's direction — what stays in a product-neutral renderer and what is
console product — is recorded in
[ADR-0060](./adr/0060-product-neutral-renderer.md) and held by
`packages/app-shell/src/__tests__/product-neutral-renderer.ratchet.test.ts`.

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

## Testing

- Each package has its own suite: `pnpm --filter @object-ui/app-shell test`
  runs app-shell's, from the `ui/` root (`vitest run --root ../..`).
- The code blocks on this page are type-checked by
  `scripts/check-doc-snippet-types.mjs`, and every symbol a published README
  imports is checked against the package's built types by
  `scripts/check-readme-exports.mjs`.
- `examples/console-starter` carries its own tests under `test/`.

## Documentation

- [`@object-ui/app-shell` README](../packages/app-shell/README.md) — the API
  reference for the root entry's names.
- [`examples/README.md`](../examples/README.md) — which example to start from.
- [ADR-0060](./adr/0060-product-neutral-renderer.md) — the product-neutral
  renderer direction.

## License

MIT
