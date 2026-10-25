---
title: "Custom Plugin Development"
---

This guide walks you through creating custom ObjectUI plugins — from scaffolding to publishing. Plugins extend ObjectUI with new view types, field widgets, or complex interactive components while keeping your application bundle lean through lazy loading.

## What Is an ObjectUI Plugin?

A plugin is a self-contained package that registers one or more components into the [Component Registry](./component-registry.md). When a JSON schema references a plugin's component type, the renderer resolves and renders it automatically.

Plugins differ from regular components in two ways:

- **Lazy-loaded** — heavy dependencies are code-split and fetched on demand.
- **Self-registering** — importing the package is enough; no manual wiring required.

Official plugins (`@object-ui/plugin-grid`, `@object-ui/plugin-kanban`, `@object-ui/plugin-charts`, etc.) all follow this pattern, and your custom plugins should too.

## Plugin Anatomy

Every plugin has three key parts:

```
packages/plugin-board/
├── src/
│   ├── index.tsx          # Entry point: lazy wrapper + ComponentRegistry.register()
│   ├── BoardImpl.tsx      # Heavy implementation (imported lazily)
│   ├── BoardImpl.test.tsx # Tests
│   └── types.ts           # TypeScript interfaces & schema types
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

| File | Role |
|------|------|
| `index.tsx` | Lightweight entry — sets up `React.lazy()`, `Suspense` fallback, and calls `ComponentRegistry.register()`. |
| `BoardImpl.tsx` | The actual renderer. All heavy dependencies live here so they are tree-shaken from the initial bundle. |
| `types.ts` | Schema interfaces extending `BaseSchema` from `@object-ui/types`. |

## Scaffolding With the CLI

The fastest way to start is the `create-plugin` generator:

```bash
npx @object-ui/create-plugin board --description "Kanban-style board view"

# Or with pnpm / npm create aliases:
pnpm create @object-ui/plugin board
npm create @object-ui/plugin board
```

This produces a ready-to-build plugin under `packages/plugin-board/` with the correct `package.json`, Vite config, test file, and registry call already in place. That directory — and the anatomy shown above — is what the generator writes into **your** workspace (`<cwd>/packages/plugin-<name>`, see `packages/create-plugin/src/index.ts`); it is not a package that ships in this repository, so do not expect to find it in a fresh ObjectUI checkout.

After scaffolding, install dependencies:

```bash
pnpm install
```

## Implementing a Custom View Plugin

Let's build a **board** view plugin that renders items in columns (similar to a Kanban but simplified).

### 1. Define the Schema Types

```typescript
// src/types.ts
import type { BaseSchema } from '@object-ui/types';

export interface BoardColumn {
  id: string;
  title: string;
}

export interface BoardItem {
  id: string;
  columnId: string;
  title: string;
  description?: string;
}

export interface BoardSchema extends BaseSchema {
  type: 'board';
  columns: BoardColumn[];
  items: BoardItem[];
  onItemMove?: (itemId: string, toColumnId: string) => void;
}

export interface BoardProps {
  schema: BoardSchema;
  className?: string;
}
```

### 2. Build the Implementation

<!-- doc-snippet: fragment — step 2 of the tutorial: this is the plugin package's own src/BoardImpl.tsx and it imports ./types, the sibling module step 1 tells the reader to write, so it cannot resolve in isolation -->
```tsx
// src/BoardImpl.tsx
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@object-ui/components';
import { cn } from '@object-ui/components';
import type { BoardProps } from './types';

export default function BoardImpl({ schema, className }: BoardProps) {
  const { columns, items } = schema;

  return (
    <div className={cn('grid gap-4', className)} style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
      {columns.map((col) => (
        <div key={col.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{col.title}</h3>
          {items
            .filter((item) => item.columnId === col.id)
            .map((item) => (
              <Card key={item.id}>
                <CardHeader className="p-3">
                  <CardTitle className="text-sm">{item.title}</CardTitle>
                </CardHeader>
                {item.description && (
                  <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
                    {item.description}
                  </CardContent>
                )}
              </Card>
            ))}
        </div>
      ))}
    </div>
  );
}
```

### 3. Create the Entry Point

<!-- doc-snippet: fragment — step 3 of the tutorial: the plugin package's own src/index.tsx, importing ./BoardImpl and ./types — both are files the reader created in steps 1 and 2 -->
```tsx
// src/index.tsx
import React, { Suspense } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { Skeleton } from '@object-ui/components';

const LazyBoard = React.lazy(() => import('./BoardImpl'));

export const BoardRenderer: React.FC<{ schema: any; [key: string]: any }> = ({
  schema,
  ...props
}) => (
  <Suspense fallback={<Skeleton className="w-full h-[300px]" />}>
    <LazyBoard schema={schema} {...props} />
  </Suspense>
);

// Auto-register on import
ComponentRegistry.register('board', BoardRenderer, {
  namespace: 'plugin-board',
  label: 'Board View',
  category: 'plugin',
  inputs: [
    { name: 'columns', type: 'array', required: true },
    { name: 'items', type: 'array', required: true },
  ],
  defaultProps: {
    columns: [
      { id: 'todo', title: 'To Do' },
      { id: 'done', title: 'Done' },
    ],
    items: [],
  },
});

export { default as BoardImpl } from './BoardImpl';
export type { BoardSchema, BoardProps, BoardColumn, BoardItem } from './types';
```

Now any schema with `"type": "board"` will resolve to your component.

## What Reaches the DOM

`SchemaRenderer` hands a registered component far more than the keys it
declares: the node itself as `schema`, every other key the author wrote on the
node, the contents of its `props` bag, the runtime props it injects (`bind`,
`events`, the camelCase `ariaLabel` the author wrote, the data-source adapter)
and whatever its own host passed. React writes unknown lowercase props straight
onto an element and stringifies objects, so a component that ends in a bare
`{...props}` spread onto an element puts all of it on the page —
`schema="[object Object]"`, `datasource="[object Object]"`, a `name` on a `div`,
and every authored key the widget never declared. Nothing warns: React stays
silent for lowercase names.

**The contract for a registered widget's host element** (objectui#4425,
phase-2 ruling, comment 5270759246): it receives only what `toDomProps` from `@object-ui/core`
passes — the SDUI contract's declared DOM keys (`id`, `className`, `role`,
`tabIndex` and the rest of `SDUI_DOM_PASS_THROUGH_KEYS`) and the open `aria-*`
and `data-*` families. Everything else the renderer hands a widget is either
**consumed** — read by name and turned into behaviour — or dropped. It is a
whitelist rather than a list of keys to strip, because the set of keys an author
may write is unbounded and a strip list can only name the ones that exist today.

```tsx
import type { HTMLAttributes, ReactNode } from 'react';
import { toDomProps, type SduiDomPassThroughKey } from '@object-ui/core';

// The DOM pass-through this widget declares is exactly what the whitelist
// forwards — named from the whitelist's own key type, so the two cannot drift.
interface BoardFrameProps extends Pick<HTMLAttributes<HTMLDivElement>, SduiDomPassThroughKey> {
  children?: ReactNode;
}

export function BoardFrame({ className, children, ...props }: BoardFrameProps) {
  return (
    // Spread FIRST, so the attributes the widget computes stay authoritative.
    <div {...toDomProps(props)} className={className}>
      {children}
    </div>
  );
}
```

A widget that really means to forward something beyond that set **declares**
it on its props type and forwards it **by name** — the way `style` reaches the
layout containers. Never reopen the spread to get it. A component that is both
registered and exported for direct React use may keep a wider declared
`HTMLAttributes` pass-through on its direct door, as `@object-ui/plugin-dashboard`'s
metric cards do; what the renderer hands it still goes through the whitelist.

Field widgets follow the same rule with their own declared set: `@object-ui/fields`
exports a `toDomProps` that adds the form-control keys `name` and `disabled`
(see [Field Widget Props](/docs/fields/widget-props)).

**The gate.** `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`
renders every registered widget of the packages it covers through the real
`SchemaRenderer`, with planted canary keys from every family above, and fails
on any attribute HTML does not define. A known leak is a ledger row in that
file naming the issue that owns its fix, and the ledger is a two-way ratchet: a
new leak fails the gate, and so does a fixed one until its row is deleted.

## Implementing a Custom Field Widget

Field widgets follow the `FieldWidgetComponentProps` interface from `@object-ui/fields`.

```typescript
// FieldWidgetComponentProps<T> shape (from packages/fields/src/widgets/types.ts)
import type { FieldMetadata } from '@object-ui/types';

type FieldWidgetComponentProps<T = any> = {
  value: T;
  onChange: (val: T) => void;
  field: FieldMetadata;
  readonly?: boolean;
  disabled?: boolean;
  className?: string;
  error?: string;
};
```

The validation slot is named `error`, matching `FieldWidgetPropsSchema` in
`@objectstack/spec/ui` — the published contract a widget is written against.
The form renderer supplies it from the active validation message.

### `field` is the only metadata carrier (v17, breaking)

Before v17 a widget could receive its metadata under **either** `field` or
`schema`, depending on which host rendered it, so widgets written in that era
resolve their config as `field || schema`. `schema` has been removed from
`FieldWidgetComponentProps` in v17: **read `props.field`, full stop.** Reading
`props.schema` now yields `undefined`.

`schema` itself is not going anywhere — it is the universal SDUI node
`SchemaRenderer` hands to *every* registered component (`element:*`, `page:*`,
grids, reports). That is precisely why a **field widget** needs an adapter when
it is rendered from a schema node instead of from a form. Wrap it once, at
registration, and the widget only ever implements one contract:

<!-- doc-snippet: fragment — registration excerpt: ColorPickerField is the widget the reader writes in the next section, shown here first so the registration call reads in one piece -->
```tsx
import { ComponentRegistry } from '@object-ui/core';
import { withFieldCarrier } from '@object-ui/fields';

ComponentRegistry.register('color', withFieldCarrier(ColorPickerField), {
  namespace: 'field',
});
```

`withFieldCarrier` forwards the node by reference (nothing is copied or
dropped) and consumes `schema` so it never reaches the DOM. Every built-in
field widget is registered through it.

### Who renders what

The widget and the form renderer split validation display, and the split is
not optional:

| Concern | Owner |
|---|---|
| `aria-invalid` on the input | **the widget** — only it renders the input element |
| the required marker (`*`) | **the form renderer** (`<FormLabel>`) |
| the message TEXT | **the form renderer** (`<FormMessage/>`) |

So consume `error` as a **boolean signal** — `aria-invalid={!!error}` — and do
not render the message yourself. The form already prints it below the control;
a widget that prints it too shows the user the same sentence twice. For the
same reason `required` is not in the props: the marker has one author.

### Example: Color Picker Field

```tsx
// src/ColorPickerField.tsx
import React from 'react';
import { Input } from '@object-ui/components';
import type { FieldWidgetComponentProps } from '@object-ui/fields';

export function ColorPickerField({
  value,
  onChange,
  field,
  readonly,
  disabled,
  error,
}: FieldWidgetComponentProps<string>) {
  if (readonly) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-4 w-4 rounded-full border"
          style={{ backgroundColor: value || '#000' }}
        />
        <span className="text-sm">{value || '—'}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-8 w-8 cursor-pointer rounded border-0 p-0"
      />
      <Input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field?.placeholder || '#000000'}
        disabled={disabled}
        className="font-mono text-sm"
        // The whole job of `error` here: tell assistive tech the field failed.
        // The message text is rendered by the form, not by this widget.
        aria-invalid={!!error}
      />
    </div>
  );
}
```

Register it as a field widget:

<!-- doc-snippet: fragment — the plugin package's own src/index.tsx again, importing ./ColorPickerField — the file written in the block immediately above -->
```tsx
// src/index.tsx
import { ComponentRegistry } from '@object-ui/core';
import { withFieldCarrier } from '@object-ui/fields';
import { ColorPickerField } from './ColorPickerField';

ComponentRegistry.register('field-color', withFieldCarrier(ColorPickerField), {
  namespace: 'plugin-board',
  label: 'Color Picker',
  category: 'field',
  inputs: [
    { name: 'value', type: 'string', label: 'Value' },
    { name: 'placeholder', type: 'string', label: 'Placeholder' },
  ],
});

export { ColorPickerField };
```

## Using the ComponentRegistry

### Namespaced Registration

Namespaces prevent type collisions between plugins:

<!-- doc-snippet: fragment — continues the board example: BoardRenderer is the component defined in step 3's src/index.tsx, not re-declared here -->
```tsx
import { ComponentRegistry } from '@object-ui/core';

// Register with a namespace — accessible as 'plugin-board:board' AND 'board'
ComponentRegistry.register('board', BoardRenderer, {
  namespace: 'plugin-board',
});

// Explicit lookup by namespace
ComponentRegistry.get('board', 'plugin-board');

// Fallback lookup (works when the type is unambiguous)
ComponentRegistry.get('board');
```

Use `skipFallback: true` in the metadata if you do **not** want the component to be available without a namespace prefix.

### Querying Registered Components

```tsx
import { ComponentRegistry } from '@object-ui/core';

ComponentRegistry.has('board');                              // boolean
ComponentRegistry.getAllTypes();                              // string[]
ComponentRegistry.getNamespaceComponents('plugin-board');     // RegistryComponentConfig[]
```

## Plugin Configuration & Schema Types

Define your schema interface in `types.ts` and extend `BaseSchema`:

<!-- doc-snippet: fragment — abridged restatement of step 1's src/types.ts — BoardColumn and BoardItem are the interfaces declared alongside it there, elided to keep the extends BaseSchema line in focus -->
```typescript
import type { BaseSchema } from '@object-ui/types';

export interface BoardSchema extends BaseSchema {
  type: 'board';
  columns: BoardColumn[];
  items: BoardItem[];
}
```

Declare `ComponentInput` entries when registering: they are what the published manifest (`sdui.manifest.json`) and the JSX-page compiler's diagnostics read. Each entry carries the seven keys the manifest forwards — `name`, `type`, `of`, `required`, `enum`, `binding`, `description`; a default belongs in the renderer's own fallback read and, for the author, in `description` (`label`, `defaultValue` and `advanced` are retired keys — nothing ever read them). At the component level the manifest carries one marker of its own: `tier: 'html'` on the intrinsic HTML elements a `kind:'html'` page may author (`HTML_TIER_INTRINSICS` in `@object-ui/core`). An entry without it is a curated block; a reader that means the curated vocabulary filters on it, a reader that whitelists tags takes every key.

`of` is the coarse kind of an `array`'s elements, or of the values of an `object` used as a map. Declare it whenever the contract admits exactly one kind there: `type: 'array'` alone says a value is a list and stops, so a member of the wrong shape reaches the renderer with nothing anywhere reporting it. With `of` declared, the parser reports a member no declared kind accepts, and the generated `sdui-intrinsics.d.ts` types the elements (`string[]` rather than `unknown[]`). Like `type`, it names a KIND and never a domain: `of: 'object'` says the elements are objects, not which keys they carry — spell that out in `description`, and let `os validate` judge the values. A member contract that genuinely accepts several kinds takes the array form (`of: ['string', 'object']`), or no `of` at all:

<!-- doc-snippet: fragment — continues the board example: ComponentRegistry and BoardRenderer both come from step 3's src/index.tsx; this block shows only the inputs metadata -->
```tsx
ComponentRegistry.register('board', BoardRenderer, {
  inputs: [
    { name: 'columns', type: 'array', of: 'object', required: true },
    { name: 'items', type: 'array', of: 'object', required: true },
    {
      name: 'layout',
      type: 'enum',
      enum: ['horizontal', 'vertical'],
      description: 'Defaults to "horizontal" — the renderer\'s own fallback',
    },
  ],
});
```

## Testing Plugins

ObjectUI uses **Vitest + React Testing Library**. Place tests next to the implementation.

<!-- doc-snippet: fragment — the plugin package's own src/BoardImpl.test.tsx, importing ./BoardImpl — the implementation the reader wrote in step 2 -->
```tsx
// src/BoardImpl.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// `toBeInTheDocument` is a jest-dom matcher, not a Vitest one — without this
// import the assertions below do not type-check and do not run.
import '@testing-library/jest-dom';
import BoardImpl from './BoardImpl';

const schema = {
  type: 'board' as const,
  columns: [
    { id: 'todo', title: 'To Do' },
    { id: 'done', title: 'Done' },
  ],
  items: [
    { id: '1', columnId: 'todo', title: 'Write tests' },
    { id: '2', columnId: 'done', title: 'Ship plugin' },
  ],
};

describe('BoardImpl', () => {
  it('renders all columns', () => {
    render(<BoardImpl schema={schema} />);
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders items in correct columns', () => {
    render(<BoardImpl schema={schema} />);
    expect(screen.getByText('Write tests')).toBeInTheDocument();
    expect(screen.getByText('Ship plugin')).toBeInTheDocument();
  });

  it('handles empty items gracefully', () => {
    render(<BoardImpl schema={{ ...schema, items: [] }} />);
    expect(screen.getByText('To Do')).toBeInTheDocument();
  });
});
```

Run tests:

```bash
pnpm vitest run packages/plugin-board
```

## Publishing Guidelines

### Package Checklist

Before publishing, verify:

- [ ] `package.json` has correct `name`, `version`, `exports`, and `peerDependencies`.
- [ ] `react` and `react-dom` are **peer** dependencies, not direct dependencies.
- [ ] `@object-ui/core` and `@object-ui/components` are in `devDependencies` (or `peerDependencies`).
- [ ] `vite.config.ts` marks React and ObjectUI packages as **external**.
- [ ] Types are exported via `"types"` field in `package.json`.
- [ ] All tests pass (`pnpm vitest run`).
- [ ] The entry point is lightweight — heavy code lives in `*Impl.tsx` files.

### Build & Verify

```bash
pnpm build --filter @object-ui/plugin-board
ls -lh packages/plugin-board/dist/
```

The entry chunk should be under 1 KB; the lazy chunk carries the bulk.

### Publish

```bash
cd packages/plugin-board
npm publish --access public
```

### Consumers Install & Use

```bash
pnpm add @object-ui/plugin-board
```

<!-- doc-snippet: fragment — consumer-side excerpt: @object-ui/plugin-board is the package the reader has just been taught to build and publish, so it does not resolve from this repo -->
```tsx
// app/main.tsx — import once, auto-registers
import '@object-ui/plugin-board';
```

```json
{
  "type": "board",
  "columns": [
    { "id": "todo", "title": "To Do" },
    { "id": "done", "title": "Done" }
  ],
  "items": [
    { "id": "1", "columnId": "todo", "title": "Write docs" }
  ]
}
```

## Related Documentation

- [Component Registry](./component-registry.md) — registry internals and advanced usage
- [Plugins Overview](./plugins.md) — official plugin catalog
- [Schema Rendering](./schema-rendering.md) — how schemas become UI
- [Fields Guide](./fields.md) — built-in field widgets and `FieldWidgetComponentProps`
