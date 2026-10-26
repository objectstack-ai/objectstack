---
title: "Architecture Overview"
description: "Understanding ObjectUI's architecture, design principles, and how the pieces fit together"
---

# Architecture Overview

ObjectUI is a universal, server-driven UI (SDUI) engine built on React, Tailwind CSS, and Shadcn UI. This guide explains the core architecture and how all the pieces work together.

## Core Philosophy

ObjectUI follows three fundamental principles:

1. **JSON-First**: Every UI element is described as JSON metadata, not hardcoded React components
2. **Backend Agnostic**: Works with any backend system (ObjectStack, custom APIs, etc.)
3. **Component Library Quality**: Combines low-code speed with Shadcn/Tailwind design quality

## Architecture Layers

```
┌─────────────────────────────────────────────┐
│         JSON Schema (Protocol)              │  ← Backend sends this
├─────────────────────────────────────────────┤
│      @object-ui/react (Renderer)            │  ← Interprets schema
├─────────────────────────────────────────────┤
│  Component Registry + Field Registry        │  ← Lookup system
├─────────────────────────────────────────────┤
│    @object-ui/components (UI Primitives)    │  ← Buttons, Cards, etc.
│    @object-ui/fields (Form Inputs)          │  ← Text, Date, Select
│    @object-ui/layout (Page Structure)       │  ← AppShell, Sidebar
│    @object-ui/plugin-* (Advanced Widgets)   │  ← Grid, Charts, Kanban
├─────────────────────────────────────────────┤
│   Shadcn UI + Radix UI (Primitives)         │  ← Accessible components
│   Tailwind CSS (Styling)                    │  ← Utility-first CSS
└─────────────────────────────────────────────┘
```

## Package Structure

ObjectUI is organized as a PNPM monorepo with clear separation of concerns:

### Core Packages

#### `@object-ui/types`
- **Role**: The Protocol
- **Contains**: Pure TypeScript interfaces for JSON schemas
- **Constraint**: ZERO dependencies, no React code
- **Example**: `BaseSchema`, `ActionSchema`, `FieldSchema`

#### `@object-ui/core`
- **Role**: The Engine
- **Contains**: Schema validation, expression evaluation, registries
- **Constraint**: No UI library dependencies, logic only
- **Features**: 
  - Expression engine (`visible: "${record.age > 18}"`)
  - Schema registry and validation
  - Event system

#### `@object-ui/react`
- **Role**: The Runtime
- **Contains**: `SchemaRenderer` and React integration
- **Purpose**: Transforms JSON schemas into live React components

### UI Packages

#### `@object-ui/components`
- **Role**: The Atoms
- **Contains**: Shadcn primitives (Button, Badge, Card, Dialog, etc.)
- **Constraint**: Pure UI, no business logic
- **Style**: Tailwind CSS with `class-variance-authority`

#### `@object-ui/fields`
- **Role**: The Inputs
- **Contains**: Standard field renderers (Text, Number, Select, Date, etc.)
- **Implements**: `FieldWidgetProps` interface
- **Purpose**: Reusable form inputs with consistent API

#### `@object-ui/layout`
- **Role**: The Shell
- **Contains**: Page structure components (AppShell, Page, Sidebar, Header)
- **Purpose**: Routing-aware composition and app scaffolding

### Plugin Packages

Each plugin provides specialized, complex widgets:

- `@object-ui/plugin-grid` - Data tables with ObjectStack integration
- `@object-ui/plugin-kanban` - Kanban board view
- `@object-ui/plugin-charts` - Recharts-based visualizations
- `@object-ui/plugin-calendar` - Calendar and event views
- `@object-ui/plugin-map` - Map visualization
- `@object-ui/plugin-form` - Advanced forms
- `@object-ui/plugin-editor` - Code editor (Monaco)
- `@object-ui/plugin-markdown` - Markdown renderer
- `@object-ui/plugin-gantt` - Gantt chart timeline
- `@object-ui/plugin-timeline` - Event timeline
- `@object-ui/plugin-dashboard` - Dashboard layouts
- `@object-ui/plugin-chatbot` - Chat interface

**Important**: Heavy dependencies (like Monaco, Recharts) are only allowed in plugin packages to keep the core bundle small.

### Utility Packages

Development tools and integration utilities:

- `@object-ui/cli` - Command-line tool for building apps from schemas
- `@object-ui/create-plugin` - Interactive plugin scaffolder
- `@object-ui/runner` - Universal runtime for testing and demos
- `@object-ui/data-objectstack` - ObjectStack data backend adapter
- `vscode-extension` - VS Code extension for schema development

[Learn more about utilities →](/docs/utilities)

## How Schema Rendering Works

### 1. JSON Schema Input

A backend system sends a JSON schema:

```json
{
  "type": "card",
  "title": "Welcome",
  "children": {
    "type": "text",
    "content": "Hello, ${user.name}!"
  }
}
```

### 2. SchemaRenderer Processing

The `SchemaRenderer` component:

1. Receives the schema, and reads the expression scope off the context above it
2. Evaluates expressions (`${user.name}`)
3. Looks up the component type in the registry
4. Recursively renders child schemas
5. Handles events and state updates

The scope does **not** arrive as a prop. `SchemaRenderer` declares exactly one prop, `schema`,
and forwards everything else it is handed to the component the schema names — so a `data={…}`
written on the element is neither read nor refused. The host publishes its values with
`PredicateScopeProvider`, and every key it publishes becomes a root the expressions can read:

```tsx
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

// The schema from step 1, as the object the renderer receives.
const schema: DeclaredNode = {
  type: 'card',
  title: 'Welcome',
  children: {
    type: 'text',
    content: 'Hello, ${user.name}!',
  },
}

function App() {
  const scope = { user: { name: 'Alice' } }

  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

An app built on `@object-ui/app-shell` does not mount this provider itself: the shell's
`ExpressionProvider` already feeds the same channel with the signed-in `user` (also readable as
`current_user`) and `features`. On top of what the host published, the renderer supplies
`record` — the row a record surface is bound to — and `page`, the page-local variables.

⛔ `SchemaRendererProvider`'s `dataSource` is **not** an expression root. It carries the host's
`DataSource` *adapter*, the object data renderers call `find()` on; the two are different
channels on purpose.

### 3. Component Registry Lookup

The registry maps type strings to React components:

<!-- doc-snippet: fragment — registry excerpt — CardComponent and TextComponent are placeholder names for the reader's own components, and ComponentRegistry is imported where it is used further down the page -->
```typescript
// During app initialization
ComponentRegistry.register('card', CardComponent)
ComponentRegistry.register('text', TextComponent)

// At runtime
const Component = ComponentRegistry.get('card') // → CardComponent
```

### 4. React Component Rendering

The registered component renders with evaluated props:

<!-- doc-snippet: fragment — the JSX the registry produces for step 1's schema; CardComponent and TextComponent are the placeholder components registered in the block above -->
```tsx
<CardComponent title="Welcome">
  <TextComponent content="Hello, Alice!" />
</CardComponent>
```

## The Registry Pattern

ObjectUI uses two registry systems for extensibility:

### Component Registry

Maps schema types to React components:

<!-- doc-snippet: fragment — MyWidgetComponent is a placeholder for the reader's own component; the block shows the register() call's metadata argument, not a runnable module -->
```tsx
import { ComponentRegistry } from '@object-ui/core'

// Register a component
ComponentRegistry.register('my-widget', MyWidgetComponent, {
  label: 'My Widget',
  category: 'Custom',
  icon: 'box',
  inputs: [
    { name: 'title', type: 'string' }
  ]
})
```

### Field Registry

Maps field types to input components:

<!-- doc-snippet: fragment — RatingFieldComponent is a placeholder for the reader's own field renderer -->
```tsx
import { registerFieldRenderer } from '@object-ui/fields'

// Register a field renderer
registerFieldRenderer('rating', RatingFieldComponent)
```

This allows:
- ✅ Overriding standard components
- ✅ Adding custom field types
- ✅ Plugin system for complex widgets
- ✅ Keeping bundles small (lazy loading)

## Expression System

ObjectUI includes a powerful expression engine for dynamic UIs:

### String Interpolation

```json
{
  "type": "text",
  "content": "Welcome, ${user.firstName} ${user.lastName}!"
}
```

### Conditional Rendering

```json
{
  "type": "button",
  "label": "Submit",
  "visible": "${current_user.role === 'admin'}",
  "disabled": "${record.status === 'locked'}"
}
```

`current_user` is the signed-in user the host's `ExpressionProvider` publishes; `record` is the
row a record surface is bound to, and is the only spelling a row field has — the bare shorthand
(`status`) and the wrong-layer `data.status` were both retired on runtime record surfaces
(objectui#5330 phase 2). A head name outside the scope is not refused: the predicate is
unevaluable, this surface fails soft, and the node is shown on every row.

A button's text key is `label`, and `text` is not a `ButtonSchema` key at all. Only
`objectui validate` refuses the misspelling, by name: the rendering face is
`.passthrough()` — `BaseSchema` KEEPS the unknown key — and the renderer, which reads
`schema.label`, never looks at it.
Measured on the node above with `text`: the button renders with an empty `textContent`,
so it appears on screen as a blank rectangle with no text.

### Data Transformations

```json
{
  "type": "statistic",
  "label": "Orders",
  "value": "${orders.length}",
  "description": "${orders.length > 10 ? 'Above target' : 'On track'}"
}
```

`statistic` rather than `badge`: an expression is evaluated only on a key the node's own
type carries, and `expressionBindableTextKeysFor` gives `statistic` the rows `label`,
`value` and `description` while giving `badge` none. A badge's text is its `label`, and it
has to arrive already resolved.

See the [Expressions Guide](/docs/guide/expressions) for complete details.

## Data Flow

```
Backend API
    ↓
JSON Schema + Data
    ↓
SchemaRenderer (evaluates expressions)
    ↓
Component Registry (maps types)
    ↓
React Components (render UI)
    ↓
User Interactions (events)
    ↓
Event Handlers (update data)
    ↓
Re-render (React state updates)
```

## Styling System

ObjectUI uses **Tailwind CSS** exclusively for styling:

### Class-Variance-Authority (CVA)

All component variants use `cva` for type-safe variants:

<!-- doc-snippet: fragment — quotes how @object-ui/components declares its variants internally; class-variance-authority is that package's own dependency, not a module resolvable from the docs root -->
```tsx
import { cva } from 'class-variance-authority'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
      }
    }
  }
)
```

### Class Merging

Use `cn()` helper (tailwind-merge + clsx) for class overrides:

<!-- doc-snippet: fragment — a one-line usage excerpt; '@/lib/utils' is the reader's app path alias and Button and props come from the surrounding component -->
```tsx
import { cn } from '@/lib/utils'

<Button className={cn('default-classes', props.className)} />
```

### ❌ Forbidden

- Inline styles (`style={{}}`) - except for dynamic values
- CSS Modules
- Styled-components
- Any CSS-in-JS library

## Type Safety

ObjectUI is built with **TypeScript** in strict mode:

```typescript
import type { BaseSchema, ButtonSchema } from '@object-ui/types'

function handleClick() {
  // ...
}

const schema: ButtonSchema = {
  type: 'button',
  label: 'Click me',
  variant: 'default', // ✅ Type-checked
  onClick: handleClick, // ✅ a handler, not its name — onClick is () => void | Promise<void>
}
```

## Testing Strategy

- **Unit Tests**: Vitest + React Testing Library
- **Type Tests**: TypeScript strict mode

## Best Practices

### 1. Keep Core Light

Heavy dependencies only go in plugins:

- ✅ `@object-ui/plugin-charts` can import Recharts
- ❌ `@object-ui/components` cannot import Recharts

### 2. Use Registries

Don't import components directly - use registries:

<!-- doc-snippet: fragment — a good/bad contrast pair mixing an import, bare JSX and a bare schema literal — three separate excerpts in one block, none a module -->
```tsx
// ❌ Bad
import { MyGrid } from './MyGrid'
<MyGrid data={data} />

// ✅ Good
ComponentRegistry.register('my-grid', MyGrid)
{ type: 'my-grid', data: [...] }
```

### 3. Tailwind Only

Never use inline styles or CSS-in-JS:

<!-- doc-snippet: fragment — a good/bad contrast pair of two unclosed div openings, quoted to compare the style attribute with a Tailwind class -->
```tsx
// ❌ Bad
<div style={{ backgroundColor: 'red' }}>

// ✅ Good
<div className="bg-red-500">
```

### 4. Expressions for Dynamic Values

Use expressions for dynamic content:

<!-- doc-snippet: fragment — a good/bad contrast pair of two bare schema object literals -->
```tsx
// ❌ Bad - hardcoded
{ type: 'text', content: 'Hello, John!' }

// ✅ Good - dynamic
{ type: 'text', content: 'Hello, ${user.name}!' }
```

## Plugin Development

When creating a plugin:

1. Create package in `packages/plugin-{name}/`
2. Export components and types
3. Register components with ComponentRegistry
4. Add documentation in `content/docs/plugins/`
5. Add to plugins meta.json

<!-- doc-snippet: fragment — the reader's new plugin package index.tsx; './MyWidget' is the sibling source file in that package -->
```typescript
// packages/plugin-mywidget/src/index.tsx
import { ComponentRegistry } from '@object-ui/core'
import { MyWidget } from './MyWidget'

export { MyWidget }

ComponentRegistry.register('my-widget', MyWidget, {
  label: 'My Widget',
  category: 'Plugins',
  icon: 'box'
})
```

## Related Documentation

- [Schema Rendering](/docs/guide/schema-rendering) - How schemas become React components
- [Component Registry](/docs/guide/component-registry) - Registering custom components
- [Field Registry](/docs/guide/fields) - Custom field types
- [Expressions](/docs/guide/expressions) - Dynamic expressions
- [Plugins](/docs/guide/plugins) - Plugin system
- [Data Sources](/docs/guide/data-source) - Data integration
- [Utilities](/docs/utilities) - Development tools and CLI utilities
