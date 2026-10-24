---
title: Architecture Overview
description: Deep dive into the ObjectUI 3-layer architecture, data flow, plugin system, state management, and action system.
---

# Architecture Overview

ObjectUI is a **Server-Driven UI (SDUI) engine** that transforms JSON schemas into fully interactive React interfaces built on Shadcn/Tailwind. This document covers the internal architecture, data flow, and extension points.

## The 3-Layer Architecture

ObjectUI enforces a strict separation across three layers. Each layer has clear constraints on what it may import and what it may contain.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: @objectstack/spec (The Protocol)                         │
│  Pure TypeScript type definitions — 12 export modules               │
│  ❌ No runtime code. No React. No dependencies.                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ imports (never redefines)
┌──────────────────────────────▼──────────────────────────────────────┐
│  Layer 2: @object-ui/types (The Bridge)                             │
│  Re-exports spec types + ObjectUI-specific schemas                  │
│  ❌ No runtime code. Zero runtime dependencies.                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ consumed by
┌──────────────────────────────▼──────────────────────────────────────┐
│  Layer 3: Implementations (The Runtime)                             │
│  core, react, components (91+), fields (35+), plugins, etc.        │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer 1 — `@objectstack/spec` (The Protocol)

The upstream JSON specification for all ObjectStack products. ObjectUI **imports** these types but never redefines them. Located externally and consumed as `@objectstack/spec`; the range each package installs is declared in that package's own `package.json`, under `dependencies`.

### Layer 2 — `@object-ui/types` (The Bridge)

Lives in `packages/types/`. Re-exports spec types and adds ObjectUI-specific schemas (component schemas, widget props, field props). Has **zero** runtime dependencies — only type-level imports of `@objectstack/spec` and `zod` for validation schemas. Marked `sideEffects: false`.

### Layer 3 — Implementations (The Runtime)

All packages that ship runnable code: `core`, `react`, `components`, `fields`, `layout`, `i18n`, `auth`, `permissions`, and every `plugin-*` package.

## Package Dependency Graph

```
@objectstack/spec
       │
       ▼
@object-ui/types ◄─────────────────────────────────────┐
       │                                                │
       ▼                                                │
@object-ui/core                                         │
       │  (registry, evaluator, actions, validation)    │
       ▼                                                │
@object-ui/react ──────► @object-ui/i18n                │
       │  (SchemaRenderer, hooks, contexts)             │
       ├──────────────────────────────────────┐         │
       ▼                                      ▼         │
@object-ui/components              @object-ui/fields    │
       │  (91+ Shadcn atoms)          (35+ inputs)      │
       ▼                                      ▼         │
@object-ui/layout           @object-ui/plugin-*         │
  (AppShell, Header,          (grid, kanban, charts,    │
   Sidebar, routing)           dashboard, form, etc.)   │
                                      │                 │
                                      └─────────────────┘
                                   (all packages import types)
```

**Strict rules:**

| Package | May Import | Must NOT Import |
|---------|-----------|-----------------|
| `types` | `@objectstack/spec` | Any runtime package |
| `core` | `types`, `lodash`, `zod` | React, any UI library |
| `react` | `core`, `types`, `i18n` | Plugin packages directly |
| `components` | `types` (for props) | `core`, `react` |
| `fields` | `types` (for `FieldWidgetProps`) | `core` business logic |
| `plugin-*` | Any package | Other plugins |

## Data Flow: Schema → Screen

The rendering pipeline transforms a JSON schema into a live React component tree:

```
  JSON Schema (from API or static file)
       │
       ▼
  ┌─────────────┐     ┌──────────────────┐
  │ SchemaRenderer │───►│ ExpressionEvaluator │
  │ (packages/     │     │ Resolves ${...}     │
  │  react/src/)   │     │ expressions         │
  └──────┬────────┘     └──────────────────┘
         │
         ▼
  ┌─────────────────┐
  │ ComponentRegistry │  ← registry.resolve(schema.type)
  │ (packages/core/  │
  │  src/registry/)  │
  └──────┬──────────┘
         │
         ▼
  ┌──────────────────┐
  │ React Component   │  ← Wrapped in ErrorBoundary
  │ (Button, Grid,    │     with ARIA attributes
  │  Kanban, etc.)    │
  └──────────────────┘
```

1. **SchemaRenderer** (`packages/react/src/SchemaRenderer.tsx`) receives a JSON schema object.
2. It evaluates dynamic expressions via `ExpressionEvaluator` (`packages/core/src/evaluator/`).
3. It looks up the component type in the `ComponentRegistry` (`packages/core/src/registry/Registry.ts`).
4. The matched component renders with schema props, wrapped in a per-component `ErrorBoundary` with ARIA accessibility attributes (`aria-label`, `aria-describedby`, `role`).

## The Plugin System

Plugins are self-contained packages that register heavy or complex views (grids, kanbans, charts). They follow a consistent pattern defined in `packages/core/src/registry/PluginSystem.ts`.

### Plugin Lifecycle

```
  import 'plugin-kanban'
       │
       ▼
  PluginSystem.load(plugin)
       │  ├─ Check dependencies
       │  ├─ Prevent duplicate loading
       │  └─ Call plugin.register(scope)
       ▼
  PluginScope.registerComponent(type, Component, meta)
       │  └─ Auto-prefixes with plugin namespace
       ▼
  ComponentRegistry.register('object-kanban', ObjectKanbanRenderer, {
    namespace: 'plugin-kanban',
    category: 'view'
  })
```

### Lazy Loading

Plugins use `React.lazy()` wrapped by `LazyPluginLoader` (`packages/react/src/LazyPluginLoader.tsx`):

- **Retry logic**: 2 retries with 1-second delay by default
- **Custom fallbacks**: Loading skeleton + error boundary
- **Tree-shaking**: Plugins are code-split from the initial bundle

### Plugin Registration Pattern

Every plugin follows the same structure (see `packages/plugin-kanban/`, `packages/plugin-grid/`):

<!-- doc-snippet: fragment — an excerpt of a plugin package's own index: `./KanbanImpl` is that package's sibling module and `Props` its local prop type, neither of which exists outside the plugin being described -->

```typescript
// 1. Lazy-load the heavy implementation
const LazyKanban = React.lazy(() => import('./KanbanImpl'));

// 2. Define a thin wrapper with Suspense
const KanbanRenderer: React.FC<Props> = ({ schema }) => (
  <Suspense fallback={<Skeleton />}>
    <LazyKanban schema={schema} />
  </Suspense>
);

// 3. Register in the global registry
ComponentRegistry.register('object-kanban', KanbanRenderer, {
  namespace: 'plugin-kanban',
  label: 'Object Kanban',
  category: 'view',
  inputs: [/* schema config */]
});
```

Scaffold a new plugin with `npx @object-ui/create-plugin`.

## State Management

ObjectUI uses **React Context** for all state management, with contexts scoped to specific concerns:

### Core Contexts (`packages/react/src/context/`)

| Context | Purpose |
|---------|---------|
| `SchemaRendererContext` | Data scope + debug mode for the rendering tree |
| `ActionContext` | Action runner instance for handling user interactions |
| `ThemeContext` | Theme tokens and dark/light mode |
| `NotificationContext` | Toast and notification system |
| `DndContext` | Drag-and-drop state for sortable views |

### Domain Contexts (separate packages)

| Context | Package | Purpose |
|---------|---------|---------|
| `AuthContext` | `packages/auth/` | Authentication state |
| `PermissionContext` | `packages/permissions/` | RBAC/ABAC permissions |
| `I18nProvider` | `packages/i18n/` | Locale and translations |

Contexts are composed at the application root and consumed by plugins and components via hooks (e.g., `useActionRunner`, `useExpression`, `useViewData`).

## Expression Evaluation

The expression engine lives in `packages/core/src/evaluator/` and powers dynamic schemas:

### Components

- **`ExpressionEvaluator.ts`** — Main engine: parses and evaluates `${...}` template expressions.
- **`ExpressionContext.ts`** — Variable scope: provides `data`, `user`, `params` to expressions.
- **`ExpressionCache.ts`** — Caches parsed expressions for repeated evaluations.
- **`FormulaFunctions.ts`** — Built-in functions available inside expressions.

### Expression Types

```json
{
  "visible": "${data.role === 'admin'}",
  "label": "Hello, ${data.user.name}!",
  "disabled": "${data.status !== 'draft'}",
  "className": "${data.priority === 'high' ? 'text-red-500' : 'text-gray-500'}"
}
```

Expressions support:
- **String interpolation**: `"Welcome, ${data.name}"`
- **Conditionals**: `"${data.age > 18}"`
- **Ternary operators**: `"${data.active ? 'Yes' : 'No'}"`
- **Variable references**: `data.*`, `user.*`, `params.*`

## Action System

The action system (`packages/core/src/actions/`) handles user interactions defined in schemas.

### ActionRunner (`ActionRunner.ts`)

Executes action schemas and returns directives:

```
  User Click → Schema Action
       │
       ▼
  ActionRunner.execute(action, context)
       │  ├─ Check confirmation dialog
       │  ├─ Evaluate conditions
       │  └─ Execute by action type
       ▼
  ActionResult
    ├─ reload: boolean
    ├─ redirect: string
    ├─ modal: SchemaObject
    └─ toast: { message, type }
```

### Supported Action Types

| Type | Description |
|------|-------------|
| `script` | Dispatch a named/registered script action — an `action.body` always executes **server-side** |
| `url` | Navigate to a URL |
| `api` | Make an API request (AJAX) |
| `modal` | Open a modal with a nested schema |
| `flow` | Start a server-side flow by name (`target`). In the console, a click on a declared `type: 'flow'` action goes through the action endpoint, `POST /api/v1/actions/{object}/{action}`, so every server-side gate the action declares applies; a flow start that names no declared action (an inline page button, a dashboard header action) goes through `POST /api/v1/automation/{flow}/trigger`. A run that pauses at a `screen` node opens the flow runner. Whether the run pauses or goes straight through, it closes on one success toast: the action's `successMessage`, else the flow's own `successMessage`, else a default sentence. A run that ends refused or fails shows no success toast |

### Server Action Dispatch (`serverActionHandler.ts`)

`ActionSchema.body` (the spec's preferred binding for script actions) executes
server-side via `POST /api/v1/actions/{object}/{action}` — the client
dispatches, it never interprets a body (a browser cannot enforce the L2
sandbox's capabilities/timeout/memory contract, and L1 is formula-engine CEL,
a different dialect from the `${...}` evaluator).

`createServerActionHandler` is the core factory every consumer uses to build
that dispatch. It owns the protocol (name-based action identity, record-id
resolution, re-entrancy guard, the `/actions` response-envelope rule) and
injects the three things core has no opinion about:

<!-- doc-snippet: fragment — the three injected values are the reader's own (`myAuthenticatedFetch`, `currentObject`, `notifyDataChanged`), and the closing line is a bare `<ActionProvider ... />` tag whose remaining props are deliberately elided -->

```typescript
import { createServerActionHandler } from '@object-ui/core';

const script = createServerActionHandler({
  fetch: myAuthenticatedFetch,          // auth is yours
  baseUrl: 'https://api.example.com',   // origin is yours ('' = same-origin)
  resolveObject: () => currentObject,   // fallback object scope is yours
  onRefresh: () => notifyDataChanged(), // data invalidation is yours
});

// Registered handlers beat the built-in executors:
<ActionProvider handlers={{ script }} ... />
```

The console builds on the same factory (`@object-ui/app-shell`'s
`createConsoleServerActionHandler` adds the popup pre-open dance and the
`redirectUrl` convention on top).

### TransactionManager (`TransactionManager.ts`)

Wraps multi-step actions in transactions for consistency, supporting rollback on failure.

## Key Directories Reference

```
packages/
├── types/src/           # Layer 2 — Pure type definitions
├── core/src/
│   ├── evaluator/       # Expression engine
│   ├── registry/        # Component & plugin registries
│   ├── actions/         # ActionRunner, TransactionManager
│   ├── validation/      # Schema validation engine
│   ├── adapters/        # Data source adapters (API, Value)
│   ├── data-scope/      # ViewDataProvider, element data sources
│   ├── query/           # Query AST (filtering/sorting)
│   ├── theme/           # ThemeEngine
│   └── builder/         # Schema builder utilities
├── react/src/
│   ├── SchemaRenderer.tsx
│   ├── LazyPluginLoader.tsx
│   ├── context/         # All React contexts
│   └── hooks/           # 20+ hooks (useExpression, useActionRunner, etc.)
├── components/          # 91+ Shadcn UI atoms
├── fields/              # 35+ field renderers
├── layout/              # AppShell, Header, Sidebar
├── i18n/                # Internationalization
├── auth/                # AuthContext + providers
├── permissions/         # RBAC/ABAC
└── plugin-*/            # 20 plugin packages
    ├── plugin-grid/
    ├── plugin-kanban/
    ├── plugin-charts/
    ├── plugin-dashboard/
    ├── plugin-form/
    └── ... (15 more)
```

## Further Reading

- [Schema Overview](/docs/guide/schema-overview) — JSON schema structure
- [Schema Rendering](/docs/guide/schema-rendering) — How schemas become UI
- [Component Registry](/docs/guide/component-registry) — Registering components
- [Plugin Development](/docs/guide/plugin-development) — Building plugins
- [Expressions](/docs/guide/expressions) — Expression syntax reference
- [Theming](/docs/guide/theming) — Theme configuration
