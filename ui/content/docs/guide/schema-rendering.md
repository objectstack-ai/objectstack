---
title: "Schema Rendering"
---

Object UI's schema rendering system is the core mechanism that transforms JSON configurations into live React components. This guide explains how it works and how to use it effectively.

## Overview

The schema rendering engine follows a simple principle:

```
JSON Schema → SchemaRenderer → React Components → Beautiful UI
```

Every visual element in Object UI starts as a JSON object that describes what should be rendered, not how it should be rendered.

## The SchemaRenderer Component

The `SchemaRenderer` is the primary component that interprets your JSON schemas:

```tsx
import { SchemaRenderer } from '@object-ui/react'
import { initializeComponents } from '@object-ui/components'
import type { PageNodeSchema } from '@object-ui/types'
// Side-effect import: loading the package runs its own field registration.
import '@object-ui/fields'

// Register components once at app initialization
initializeComponents()

function App() {
  const schema: PageNodeSchema = {
    type: "page",
    pageType: "app",
    title: "My Dashboard",
    children: [{ type: "text", content: "Hello" }]
  }
  
  return <SchemaRenderer schema={schema} />
}
```

## Schema Structure

Every schema object must have at minimum a `type` field:

```typescript
import type { CSSProperties } from 'react'

interface BaseSchema {
  type: string           // Component type identifier
  id?: string           // Optional unique identifier
  className?: string    // Tailwind CSS classes
  style?: CSSProperties // Inline styles (use sparingly)
  visibleOn?: string    // Expression for conditional visibility
  hiddenOn?: string     // Expression for conditional hiding
  disabledOn?: string   // Expression for conditional disabling
}
```

### Example Schema

```json
{
  "type": "card",
  "id": "stats-card",
  "className": "p-6 shadow-lg",
  "title": "User Statistics",
  "visibleOn": "${user.role === 'admin'}",
  "children": {
    "type": "text",
    "content": "Total Users: ${stats.totalUsers}"
  }
}
```

## Data Context

Expression scope does **not** arrive as a prop. `SchemaRenderer` declares exactly one prop,
`schema`, and forwards every other prop it is handed straight through to the component the
schema names — so a `data`, `dataSource` or `debug` written on the element is neither read nor
refused. Nothing throws, and there is one line on the console; the expression simply never
resolves, and an unresolvable template is returned as its own source text, so the characters
you typed are what the reader sees. The scope comes from `PredicateScopeProvider`, which
publishes each name you give it as an expression root:

```tsx
import { SchemaRenderer, PredicateScopeProvider } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

// The page schema from the first example on this page.
declare const schema: DeclaredNode

// Every name here becomes a root the schema's expressions can read.
const scope = {
  user: { name: 'John', role: 'admin' },
  stats: { totalUsers: 1234 },
}

function App() {
  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

An app built on `@object-ui/app-shell` does not mount this provider itself: the shell's
`ExpressionProvider` already feeds the same channel with `user` (the signed-in user, also
readable as `current_user`) and `features`.

The scope the evaluator builds is what you published, plus three names the renderer supplies:

| name | what it holds |
|---|---|
| every key of `scope` | exactly what you put there — `user`, `stats`, whatever the page needs |
| `page` | page-local variables, for predicates that gate on another component's state |
| `record` | the row a record surface is bound to, when there is one |
| `current_user` | an alias of whatever you published as `user`; the host's `ExpressionProvider` publishes the signed-in user there |

A name outside that set resolves to nothing, and an unresolvable template is not an error:
the evaluator hands back its own source text and writes one line to the console, so the
characters you typed are what the reader sees.

> **`dataSource` is not an expression root.** `SchemaRendererProvider`'s `dataSource` carries
> the host's `DataSource` *adapter* — the object renderers call `find()` on. The renderer used
> to publish that adapter under the name `data`; an adapter answers no `data.*` path, so the
> root was constant for every conformant host, and objectui#9308 removed it. A `${data.…}`
> expression now reads whatever *you* published under `data`, and nothing if you published
> none. At the runtime layer the row is `record` (ADR-0089).

### Accessing Data in Schemas

Use expression syntax `${}` to reference the scope, by the name you published it under:

```json
{
  "type": "text",
  "content": "Welcome, ${user.name}!"
}
```

## Component Registry

The schema renderer uses a component registry to map schema types to React components:

<!-- doc-snippet: fragment — MyComponent is the reader's own React component, named here to show what register() takes as its second argument -->
```tsx
import { ComponentRegistry } from '@object-ui/core'

// `ComponentRegistry` is a process-level singleton — import it, do not construct one.
// Register a custom component
ComponentRegistry.register('my-component', MyComponent)

// Now you can use it in schemas
const schema = {
  type: "my-component",
  // ... component props
}
```

## Nested Schemas

Schemas can be nested to create complex UIs:

```json
{
  "type": "page",
  "pageType": "app",
  "title": "Dashboard",
  "children": {
    "type": "grid",
    "columns": 2,
    "children": [
      {
        "type": "card",
        "title": "Card 1",
        "children": {
          "type": "text",
          "content": "Nested content"
        }
      },
      {
        "type": "card",
        "title": "Card 2",
        "children": {
          "type": "chart",
          "chartType": "bar",
          "xAxisKey": "month",
          "series": [{ "name": "revenue" }],
          "data": [
            { "month": "Jan", "revenue": 120 },
            { "month": "Feb", "revenue": 80 }
          ]
        }
      }
    ]
  }
}
```

The chart's rows are written out on the node, and that is the spelling that plots. A
`${…}` on node-level `data` is **not** one of the rows `SchemaRenderer` evaluates: the raw
string reaches `ChartRenderer`, whose `Array.isArray(schema.data) ? schema.data : []` drops
it, and the chart frame draws with nothing in it — no error, no warning. Since objectui#7113
that node is also refused by name, `ChartSchema.data` being `z.array(z.record(…))`. `series`
is required alongside it: `series[].name` picks the column to plot within each row, and
`xAxisKey` names the category column. `chart` reads no `bind` either, so resolve the array in
your own code and hand `SchemaRenderer` a schema whose rows are already on the node.

## Array Rendering

Use arrays for multiple items:

```json
{
  "type": "container",
  "children": [
    { "type": "text", "content": "First item" },
    { "type": "text", "content": "Second item" },
    { "type": "text", "content": "Third item" }
  ]
}
```

## Expression System

Object UI includes a powerful expression system for dynamic behavior:

### Simple Expressions

```json
{
  "type": "text",
  "content": "${user.firstName} ${user.lastName}"
}
```

### Conditional Expressions

```json
{
  "type": "card",
  "title": "${record.status === 'active' ? 'Active' : 'Inactive'}",
  "description": "${record.status === 'active' ? 'This record is in use.' : 'This record is archived.'}"
}
```

`record.status` rather than a bare `status`, because this example is about a row: `record` is
the row a record surface is bound to, and it is the only spelling a row field has — the bare
shorthand and the wrong-layer `data.status` were both retired on runtime record surfaces
(objectui#5330 phase 2). A head name the host publishes itself stays bare; this one is not
one of those.

`card` here rather than `badge`, because an expression is evaluated only on a key the
node's own type carries. `expressionBindableTextKeysFor` — the lookup `SchemaRenderer`
consumes out of `@objectstack/spec` — gives `card` the rows `title` and `description`,
and gives `badge` no rows at all, so a `${…}` written on a badge reaches the DOM as the
characters you typed. Resolve a badge's text before you hand the schema over, and author
it on `label`: `text` is not a `BadgeSchema` key.

### Visibility Control

```json
{
  "type": "button",
  "label": "Delete",
  "visibleOn": "${user.role === 'admin'}"
}
```

### Complex Logic

```json
{
  "type": "alert",
  "variant": "default",
  "title": "Welcome!",
  "children": {
    "type": "text",
    "content": "${user.isNew ? 'Start with the quick tour.' : user.tasks.length === 0 ? 'You are all caught up.' : 'You have tasks waiting.'}"
  }
}
```

The branch sits on the nested `text` node's `content`, which `SchemaRenderer` evaluates
on every node type — the escape hatch for a component that carries no expression rows of
its own, and `alert` is one of those. Its severity could not be chosen by expression in
any case: `AlertSchema.variant` is the closed set `default` | `destructive`, so `info`,
`warning` and `success` are not values it accepts. Pick the variant in the host and
author it as a literal.

## Event Handling

Components can emit events that you handle in React:

<!-- doc-snippet: fragment — prop excerpt: the JSX call is shown alone to isolate onAction and onSubmit; schema and SchemaRenderer come from the first example on this page -->
```tsx
<SchemaRenderer 
  schema={schema}
  onAction={(action, context) => {
    console.log('Action:', action)
    console.log('Context:', context)
  }}
  onSubmit={(data) => {
    console.log('Form submitted:', data)
  }}
/>
```

Reference actions in schemas — the block's props go in its `properties` bag, as
`@objectstack/spec` declares them; the spec's strict page component refuses them
written flat on the node:

```json
{
  "type": "action:button",
  "properties": {
    "name": "call_api",
    "label": "Click Me",
    "actionType": "api",
    "target": "/api/action",
    "method": "POST"
  }
}
```

Three things about the shape this replaces. A declarative action is its own NODE TYPE,
`action:button` — a plain `button` has no authorable handler: `ButtonSchema.onClick` is a
runtime slot for a host-supplied function, refused by name by the zod mirror, and (being
on `SDUI_DOM_PASS_THROUGH_KEYS`) forwarded straight to the DOM listener slot, where React
throws on the first click: "Expected `onClick` listener to be a function, instead got a
value of `object` type." The execution type is `actionType`, and the built-in vocabulary
is `script` | `url` | `modal` | `flow` | `api` | `form` (plus objectui's `navigation`
alias) — anything else must be a handler your host registered on `ActionProvider`. `ajax`
is neither. And an `api` action's endpoint is its `target`, with the verb in `method`: the
spec's `action:button` row refuses `endpoint` and names `target` in its place, and `api` is
not a key any action renderer forwards.

## Performance Optimization

### Lazy loading: there is no such knob

There is no authorable lazy-loading key — not on `tabs`, not on any other node.
This section used to show a `tabs` node carrying `"lazyLoad": true` beneath the
sentence "Large schemas are automatically optimized". Nothing in this repository
performs that optimization and nothing reads that key, so the promise is removed
here rather than respelled.

Two things mislead, so both are worth naming:

- **`lazyLoad` is a real name in this repository — on a different surface.** It is
  a member of `PerformanceConfig`, the argument type of the `usePerformance`
  hook: a configuration object you pass in TypeScript, never a key you author on
  a node. Finding it in a search does not make it authorable. It gates nothing
  even there — `usePerformance` resolves it into the config it hands back and
  never branches on it, unlike its sibling `debounceMs`, which the hook lifts
  into a local and passes to `setTimeout`.
- **The `tabs` renderer builds every panel on the same render pass.** It maps
  `items` twice, unconditionally — once for the triggers and once for the
  panels — so no tab's `content` waits for a click. It uses neither `lazy` nor
  `Suspense`, and it never calls `usePerformance`.

To defer real work behind a tab, defer the *component* rather than the node: see
[Code Splitting](#code-splitting) below.

For reference, a `tabs` node written with the keys `TabsSchema` actually declares:

```json
{
  "type": "tabs",
  "defaultValue": "tab1",
  "items": [
    { "value": "tab1", "label": "Tab 1", "content": { "type": "text", "content": "First panel" } },
    { "value": "tab2", "label": "Tab 2", "content": { "type": "text", "content": "Second panel" } }
  ]
}
```

`items` is the node's tab list — there is no `tabs` key — and every item takes
`value`, `label` and `content`: the identifier, the visible title, and the panel.
All three are required, and the two ways of getting an item wrong fail
differently. An item missing one of them is **refused**. An item that also
carries the older `title` spelling is **accepted with that key dropped**, while
an item-level `body` is **refused by name**, pointed at `content`. On
the node itself, `body` and `children` are refused by name: `tabs` reads neither
content channel. The four keys it does render are `defaultValue`, `items`,
`orientation` and `value`.

### Memoization

The renderer automatically memoizes components to prevent unnecessary re-renders.

### Code Splitting

Use dynamic imports for heavy components:

<!-- doc-snippet: fragment — code-splitting excerpt: ./HeavyChart is the reader's own component file, and registry is whichever registry instance the host already holds -->
```tsx
import { lazy } from 'react'

const HeavyChart = lazy(() => import('./HeavyChart'))

registry.register('heavy-chart', HeavyChart)
```

## Error Handling

The renderer includes built-in error boundaries:

<!-- doc-snippet: fragment — prop excerpt: the JSX call is shown alone to isolate onError; schema and SchemaRenderer come from the first example on this page -->
```tsx
<SchemaRenderer 
  schema={schema}
  onError={(error, errorInfo) => {
    console.error('Rendering error:', error)
    // Log to error tracking service
  }}
/>
```

## Render is not a validation door

`SchemaRenderer` does **not** parse your document against the published Zod schema before it
draws. The one document check on the render path is `validateSchema` from `@object-ui/core` —
a hand-written structural walker — and it runs **in development only**: the call sits behind a
`process.env.NODE_ENV !== 'production'` guard, warns to the console, and marks the offending
host element with `data-obj-schema-invalid` so an app can hang a visual cue off it. In a
production build that pass is skipped entirely — the document is not checked at all before it
is drawn, and `data-obj-schema-invalid` is never emitted.

The walker and the schema do not share an accept set, so neither one's verdict tells you
anything about the other's. The walker judges node *structure* — is the root an object, does
every node carry a `type`, recursing through `children` — plus a few rules of its own, such as
a short hand-written table of retired node-type spellings. The rest of the published contract
is outside it. Take a `chatbot` node carrying a key the schema has retired: the walker is
silent, whether that key holds a node, an array of nodes, a string, a number or a record, while
`safeValidateSchema` refuses the same document with the retirement's own message. So a document
that renders without a warning has **not** thereby passed the contract, and a warning that does
appear is a report about node structure, not about the schema.

Validation happens at three doors, all of them outside the render path:

1. **Load time — the framework's Zod parse.** Every metadata item a package ships is validated
   against its Zod schema when the framework loads it; the result travels with the item as a
   `_diagnostics` envelope, which Studio surfaces. See
   [Metadata Diagnostics](./metadata-diagnostics.md).
2. **Authoring time — `objectui validate`.** It parses one document, JSON or YAML, against the
   published schema's strict authoring face — which refuses, by name, any key no schema declares,
   on every node — prints the schema's own errors when it fails, and exits non-zero. That exit
   code is the CLI's validation verdict. `objectui check` does not give it. `check` sweeps a
   project's JSON files and checks the `type` of each file it recognises, and a file whose root
   carries an ObjectUI structural key (`children`, `className`, `body`, …) is recognised by that
   key alone, without being parsed against the schema — so an invalid document of that shape is
   not reported at all. Only a file with none of those keys is parsed; it is listed by name when
   its root `type` names a registered component but the document does not validate, and that
   list is advisory: being listed does not fail the run. `check` exits non-zero on unreadable
   JSON, and on a `${…}` expression on a text key its node never evaluates, in a listed file as
   in a recognised one. See [`objectui check`](/docs/utilities/cli#objectui-check).
3. **Wherever else you need it — `StrictAnyComponentSchema.safeParse`.** Exported from
   `@object-ui/types/zod`, it is the parse `objectui validate` runs, so a build step, a CI job or
   a save handler can apply the identical contract. `safeValidateSchema`, from the same module,
   is the tolerant parse: it keeps a key no schema declares, unjudged, the way the renderer does.

Put the check where documents are authored, saved or loaded — not in the paint. A document that
reaches the browser without passing one of those doors is drawn as best the renderer can, in
development and in production alike.

## TypeScript Support

Full type safety for your schemas:

```tsx
import type { PageNodeSchema, FormSchema } from '@object-ui/types'

const form: FormSchema = {
  type: "form",
  // TypeScript will validate this entire structure
  fields: []
}

const schema: PageNodeSchema = {
  type: "page",
  pageType: "app",
  title: "Typed Page",
  children: [form]
}
```

The spec's page blocks take their props in a `properties` bag. `SchemaRenderer`
accepts them through `AuthoringNode` from `@object-ui/types`, so the bag is
typed by the spec's `ComponentPropsMap` row and a misspelled key in it does not
compile:

```tsx
import { SchemaRenderer } from '@object-ui/react'
import type { PublicBlockNodeOf } from '@object-ui/types'

const heading: PublicBlockNodeOf<'element:text'> = {
  type: "element:text",
  properties: { content: "Quarterly revenue", variant: "h2" }
}

function Heading() {
  return <SchemaRenderer schema={heading} />
}
```

## Best Practices

### 1. Keep Schemas Simple

Break complex UIs into smaller, reusable schemas:

```tsx
// ❌ Bad: One massive schema
const massiveSchema = { /* 500 lines of JSON */ }

// ✅ Good: Composed schemas
const headerSchema = { /* ... */ }
const contentSchema = { /* ... */ }
const footerSchema = { /* ... */ }

const pageSchema = {
  type: "page",
  children: [headerSchema, contentSchema, footerSchema]
}
```

### 2. Use Data Context Effectively

Put everything the schema's expressions need on one scope, mounted above the tree — not on
the renderer, which does not read it:

```tsx
import { SchemaRenderer, PredicateScopeProvider } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

// The reader's own values.
declare const schema: DeclaredNode
declare const userData: { name: string }
declare const userSettings: { theme: string }
declare const dashboardStats: { totalUsers: number }

// ✅ Good — one provider, and every expression reads a name published on it
const scope = {
  user: userData,
  settings: userSettings,
  stats: dashboardStats,
}

function Dashboard() {
  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

### 3. Leverage Expressions

Move logic to expressions instead of creating conditional schemas:

<!-- doc-snippet: fragment — a bad/good contrast pair in one fence: schema is deliberately declared twice so the two spellings sit side by side, and user, adminSchema and userSchema are the reader's own values -->
```tsx
// ❌ Bad
const schema = user.isAdmin ? adminSchema : userSchema

// ✅ Good
const schema = {
  type: "page",
  children: [
    { 
      type: "admin-panel",
      visibleOn: "${user.isAdmin}"
    },
    {
      type: "user-panel",
      visibleOn: "${!user.isAdmin}"
    }
  ]
}
```

### 4. Use TypeScript

Always type your schemas for better IDE support and fewer runtime errors.

## Common Patterns

### Loading States

```json
{
  "type": "container",
  "children": {
    "type": "spinner",
    "visibleOn": "${loading}"
  }
}
```

### Empty States

```json
{
  "type": "empty",
  "visibleOn": "${items.length === 0}",
  "title": "No items found",
  "action": {
    "type": "button",
    "label": "Create New"
  }
}
```

### Error States

```json
{
  "type": "alert",
  "variant": "destructive",
  "visibleOn": "${error}",
  "title": "Something went wrong",
  "children": { "type": "text", "content": "${error.message}" }
}
```

`visibleOn` is a condition key and is evaluated on every node type. The message text is a
nested `text` node because `alert` carries no expression rows — and `message` is not an
`AlertSchema` key at all: the alert's own text keys are `title` and `description`, and the
renderer falls back from `description` to `children`. `destructive` is the variant this state
wants; `error` is not in the closed set.

## Next Steps

- [Component Registry](./component-registry.md) - Learn about component registration
- [Expression System](./expressions.md) - Master expressions
- [Schema Overview](/docs/guide/schema-overview) - Explore all available schemas

## Related Documentation

- [SchemaRenderer](/docs/core/schema-renderer) - Technical reference for the renderer
- [Architecture Overview](/docs/guide/architecture) - System architecture
- [`@object-ui/core` README](https://github.com/objectstack-ai/objectui/tree/main/packages/core) - Core package API reference
- [`@object-ui/react` README](https://github.com/objectstack-ai/objectui/tree/main/packages/react) - React package API reference
