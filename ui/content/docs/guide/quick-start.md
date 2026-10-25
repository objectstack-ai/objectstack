---
title: "Quick Start"
description: "Get up and running with ObjectUI in 5 minutes - install, configure, and render your first server-driven UI"
---

# Quick Start

Get up and running with ObjectUI in a small Vite app. This guide installs the core renderer, registers the built-in component packages, and renders a first JSON schema.

## Prerequisites

- **Node.js** and **pnpm** (or npm/yarn) — ObjectUI is tested on Node 22.x with pnpm 10.x.
- Basic knowledge of **React** and **TypeScript**

## Step 1: Create a React Project

If you don't have an existing React project, create one with Vite:

```bash
pnpm create vite my-app --template react-ts
cd my-app
```

## Step 2: Install ObjectUI

Install the core ObjectUI packages:

```bash
pnpm add @object-ui/react @object-ui/core @object-ui/types @object-ui/components @object-ui/fields
```

Install Tailwind CSS for styling:

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

## Step 3: Configure Tailwind CSS

Add Tailwind to your `vite.config.ts`:

<!-- doc-snippet: fragment — a vite.config.ts for the reader's own project: @vitejs/plugin-react and @tailwindcss/vite are the reader's dependencies, not this repository's, so the imports cannot resolve here -->
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
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
```

Each `style.css` is a stylesheet the package compiles from its own sources at build time, and between them they carry every utility ObjectUI renders with — the themed ones (`bg-primary`, `border-input`) included.

**Import them in that order.** `@object-ui/components/style.css` is the complete sheet: Tailwind's base layer, the `@theme` tokens and the utilities its components use. `@object-ui/fields/style.css` is a small supplement on top of it — only the ~155 utilities the field widgets add and the components sheet does not already carry, which is why it is a few kB rather than another 170. It is not a standalone stylesheet, and on its own it will not style anything.

**Plugin packages that publish a stylesheet need one line each.** `@object-ui/plugin-grid` and `@object-ui/plugin-kanban` ship the same kind of supplement, built the same way, so add whichever of them you install:

```css
@import "@object-ui/plugin-grid/style.css";
@import "@object-ui/plugin-kanban/style.css";
```

Without that line the plugin renders with no themed styling at all — its `bg-muted/10`, `bg-card/60` and `text-muted-foreground/60` have no other source in a published app, because the `@theme` block they resolve lives in package source that is never published ([#4929](https://github.com/objectstack-ai/objectui/issues/4929)). The remaining `@object-ui/plugin-*` packages ship no stylesheet yet; importing one that does not exist breaks the build, so add only the lines above.

That is the whole styling setup: you do not add `@source` lines for the ObjectUI packages, and pointing Tailwind at them inside `node_modules` only regenerates utilities these imports already gave you.

## Step 4: Render Your First Schema

Replace `src/App.tsx` with:

```tsx
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { CardSchema } from '@object-ui/types';

const schema: CardSchema = {
  type: 'card',
  title: 'Team Directory',
  description: 'Rendered from JSON metadata',
  className: 'mx-auto max-w-3xl',
  children: {
    type: 'data-table',
    caption: 'Users',
    columns: [
      { header: 'Name', accessorKey: 'name', sortable: true },
      { header: 'Email', accessorKey: 'email' },
      { header: 'Role', accessorKey: 'role' },
    ],
    data: [
      { name: 'Ada Lovelace', email: 'ada@example.com', role: 'Admin' },
      { name: 'Grace Hopper', email: 'grace@example.com', role: 'Editor' },
      { name: 'Katherine Johnson', email: 'katherine@example.com', role: 'Viewer' },
    ],
    pagination: false,
    searchable: false,
  },
} as const;

function App() {
  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <SchemaRendererProvider dataSource={undefined}>
        <SchemaRenderer schema={schema} />
      </SchemaRendererProvider>
    </div>
  );
}

export default App;
```

Importing `@object-ui/components` and `@object-ui/fields` registers their renderers with the shared `ComponentRegistry`. `SchemaRendererProvider` injects the host's data adapter, and everything below it — expressions, smart fields, data-aware plugins — reads it back from there.

This app renders inline `data`, so it has no adapter to inject and says so with `undefined`. That is a real state of the contract, not a placeholder: `dataSource` is typed `DataSource | null | undefined` (`@object-ui/types`), so a host either hands over an adapter or states that it has none. It used to be typed `any` and this example passed an empty object, which no renderer can do anything with (objectui#7912).

## Step 5: Run the App

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). You should see a card and data table rendered from JSON.

## What Just Happened?

1. **Schema** - the UI was described as JSON with `type`, visual props, and nested `children`.
2. **Registry** - importing the component packages registered renderers for `card` and `data-table`.
3. **Renderer** - `SchemaRenderer` resolved each `type` and rendered React components.
4. **Provider** - `SchemaRendererProvider` is where a host injects its `DataSource`; this app has none, so it passes `undefined`.

## Next Steps

### Add Actions

Actions are data, not inline functions. Declare one as an `action:button`
node whose `properties` bag carries the block's props, as `@objectstack/spec`
declares them: `actionType` names the built-in executor the action runner
dispatches to, and the bag's other keys carry that executor's arguments —
`target` is the location a `url` action navigates to. Written flat on the node,
`actionType` and `target` are refused by the spec's strict page component:

```json
{
  "type": "action:button",
  "properties": {
    "label": "Open details",
    "actionType": "url",
    "target": "/users/ada"
  }
}
```

Learn the full action model in [Enhanced Actions](/docs/core/enhanced-actions).

### Connect a Data Source

```bash
pnpm add @object-ui/data-objectstack
```

```tsx
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com'
});
```

Pass the adapter to `SchemaRendererProvider` and let data-aware renderers call the `DataSource` interface. See [Data Connectivity](/docs/guide/data-source).

### Learn More

- [Architecture Overview](/docs/guide/architecture) — Understand how ObjectUI works
- [Schema Rendering](/docs/guide/schema-rendering) — Deep dive into schema rendering
- [Component Registry](/docs/guide/component-registry) — Customize and extend components
- [Plugins](/docs/guide/plugins) — Add views like Grid, Kanban, Charts
- [Fields Guide](/docs/guide/fields) — Field widgets and cell renderers
