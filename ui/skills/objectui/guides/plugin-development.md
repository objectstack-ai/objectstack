# ObjectUI Plugin Development

Building custom plugins that extend ObjectUI's rendering. Plugins are the extension mechanism for adding heavy or specialized components (grids, charts, maps, editors, kanbans) to the schema-driven UI engine.

## When to create a plugin vs. a component

**Use `@object-ui/components` (atoms)** for lightweight Shadcn wrappers: Button, Badge, Card, Input. Zero heavy dependencies.

**Use `@object-ui/fields`** for form input renderers that implement `FieldWidgetComponentProps`.

**Create a `@object-ui/plugin-*`** when:
- The widget has heavy third-party deps (>50KB): DnD kit, chart libraries, map SDKs, rich editors
- It's a complex composite view: grid with virtual scrolling, kanban board, calendar
- It needs plugin-scoped state or lazy loading
- It should be tree-shakeable / independently installable

## Scaffolding a new plugin

Use the create-plugin CLI to generate the full structure:

```bash
pnpm create-plugin my-widget
```

This generates:

```
packages/plugin-my-widget/
├── src/
│   ├── index.tsx                 # Entry: exports + ComponentRegistry registration
│   ├── MyWidgetImpl.tsx          # Component implementation
│   ├── MyWidgetImpl.test.tsx     # Vitest tests
│   └── types.ts                  # Schema type definitions
├── package.json                  # Dependencies, exports config
├── tsconfig.json                 # TypeScript configuration
├── vite.config.ts                # ESM + UMD build
└── README.md
```

## ComponentRegistry API

The registry maps JSON `type` strings to React component implementations.

### Registering a component

```typescript
import { ComponentRegistry } from '@object-ui/core';

ComponentRegistry.register('my-widget', MyWidgetRenderer, {
  namespace: 'plugin-my-widget',
  label: 'My Widget',
  icon: 'layout-grid',
  category: 'plugin',             // Grouping: 'plugin' | 'view' | 'field' | 'layout'
  isContainer: false,             // Layout region? (react-page scope); NOT "accepts children"
  inputs: [
    { name: 'title', type: 'string' },
    { name: 'columns', type: 'array', required: true },
    { name: 'mode', type: 'enum', enum: ['compact', 'full'] },
  ],
  defaultProps: { mode: 'full' },
});
```

### ComponentMeta options (full reference)

| Option | Type | Description |
|--------|------|-------------|
| `namespace` | `string` | Plugin namespace. Registers as `namespace:type` |
| `label` | `string` | Display name for designer UI |
| `icon` | `string` | Lucide icon name |
| `category` | `string` | Grouping category |
| `skipFallback` | `boolean` | Don't register non-namespaced fallback (prevents overwrites) |
| `inputs` | `ComponentInput[]` | Schema inputs for designer |
| `defaultProps` | `Record<string, any>` | Default properties |
| `isContainer` | `boolean` | Layout container (skipped by the react-page JSX scope). Not "accepts children": a renderer that puts `schema.children` on the page declares `{ name: 'children', type: 'slot' }` in `inputs` — the SDUI parser's `not-a-container` reads that input |
| `resizable` | `boolean` | Designer allows resizing |
| `resizeConstraints` | `object` | Min/max width/height |
| `tier` | `'public' \| 'internal'` | Public contract tier (ADR-0080). Undefined = internal |
| `labelling` | `'control' \| 'group' \| 'display'` | How a host associates its label; absent ⇒ `'control'` |
| `deprecated` | `object` | Authoring-time deprecation (`surfaces`, `replacement`) |
| `examples` | `array` | Sample schemas for the designer |
| `tags` | `string[]` | Free-form grouping tags |
| `description` | `string` | Longer description for the designer |

Sixteen keys in total: the eleven on `ComponentMeta` (`@object-ui/types`
`base.ts`) plus the five `RegistryComponentMetaExtras` the registry adds
(`tier`, `namespace`, `skipFallback`, `labelling`, `deprecated`).

### ComponentInput types

<!-- os:check -->
```typescript
import type { ComponentInput, ComponentInputControlType } from '@object-ui/types';

// The eleven control kinds, taken from the published union rather than retyped.
const controlTypes: ComponentInputControlType[] = [
  'string', 'number', 'boolean', 'enum', 'array', 'object',
  'color', 'date', 'code', 'file', 'slot',
];

// A manifest's inputs, checked against the published type. SIX keys are
// writable — `name`, `type`, `of`, `required`, `enum`, `description`.
const inputs: ComponentInput[] = [
  { name: 'title', type: 'string', required: true, description: 'Heading text' },
  // ONE control type, or an ARRAY of them when the input accepts several
  // shapes. Widening the vocabulary is a contract change.
  { name: 'items', type: ['array', 'object'], of: 'object', description: 'Rows to render' },
  { name: 'variant', type: 'enum', enum: ['solid', 'outline'], description: 'Visual style' },
];

// ADR-0049 RETIREMENT TOMBSTONES - DECLARED but UNWRITABLE.
// Every key named here is `never` on the published type, so authoring one is a
// `tsc` error and a named refusal from the Zod mirror (`ComponentInputSchema`).
// They were never read and never published: the manifest serializer forwards
// a fixed key list per input, `of` now included — `name`,
// `type`, `of`, `required`, `enum`, `binding`, `description` — so an authored
// value was silently dropped. Remedy: delete the key and say it in
// `description`, which IS published. A `Pick` rather than a prose list, so a
// tombstone that is deleted upstream stops compiling here instead of lingering.
type ComponentInputTombstones = Pick<
  ComponentInput,
  | 'label'
  | 'defaultValue'
  | 'advanced'
  | 'inputType'
  | 'min'
  | 'max'
  | 'step'
  | 'placeholder'   // `BaseSchema.placeholder` is a different key, alive
>;
```

⛔ This fence used to keep a private copy of both names, and the copy was wrong
in four ways at once while every gate stayed green: it declared `label`,
`defaultValue` and `advanced` as WRITABLE where the published type has all three
as `never` tombstones, and it did not carry `of` at all. That is what a
teaching copy of a contract type costs; this fence paid it once already.

### Looking up components

```typescript
// By type (searches all namespaces)
const Component = ComponentRegistry.get('my-widget');

// By type + explicit namespace
const Component = ComponentRegistry.get('my-widget', 'plugin-my-widget');

// By full qualified name
const Component = ComponentRegistry.get('plugin-my-widget:my-widget');

// Query all
const allTypes = ComponentRegistry.getAllTypes();
const allConfigs = ComponentRegistry.getAllConfigs();
const pluginComponents = ComponentRegistry.getNamespaceComponents('plugin-my-widget');
```

### Namespace system

When registering with a namespace:
1. Component stored as `plugin-my-widget:my-widget` (full key)
2. Also stored as `my-widget` (fallback for backward compatibility)
3. If `skipFallback: true`, only the namespaced key is registered

**Use `skipFallback: true`** when multiple plugins register the same base type (e.g., both `plugin-form` and `plugin-grid` registering `'form'`).

**A plugin handed a `PluginScope` registers through it instead** —
`scope.registerComponent(type, component, meta?)`
(`packages/types/src/plugin-scope.ts`) applies the scope's own name, storing
`pluginName:type`, so it takes no `namespace`. `ComponentRegistry.register` is
the global registry, where the namespace is yours to pass.

## Implementing a plugin component

### Entry point pattern (`index.tsx`)

```typescript
import React, { Suspense } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { Skeleton } from '@object-ui/components';

// Export types
export type { MyWidgetSchema, MyWidgetProps } from './types';

// Export component for direct usage
export { MyWidget } from './MyWidgetImpl';

// Lazy load for schema-driven rendering (keeps bundle small for non-users)
const LazyMyWidget = React.lazy(() => import('./MyWidgetImpl'));

// Renderer wrapper for SchemaRenderer
const MyWidgetRenderer: React.FC<{ schema: any }> = ({ schema }) => {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <LazyMyWidget {...schema} {...schema.props} />
    </Suspense>
  );
};

// Register in ComponentRegistry — meta options as above
ComponentRegistry.register('my-widget', MyWidgetRenderer, {
  namespace: 'plugin-my-widget',
});
```

### Component implementation pattern

```typescript
// MyWidgetImpl.tsx
import React from 'react';
import { cn } from '@object-ui/components';
import { useDataScope } from '@object-ui/react';
import type { MyWidgetProps } from './types';

export function MyWidget({
  title,
  columns,
  className,
  bind,
  ...props
}: MyWidgetProps) {
  // Get data from schema's `bind` path
  const data = useDataScope(bind);

  return (
    <div className={cn('rounded-lg border p-4', className)}>
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      {/* Widget rendering logic */}
    </div>
  );
}

export default MyWidget;
```

### Type definitions

```typescript
// types.ts
import type { BaseSchema } from '@object-ui/types';

// Only the widget's OWN members: `id` / `className` / `bind` / `hidden` /
// `disabled` / `children` are INHERITED — and `hidden` / `disabled` are
// `boolean | ExpressionWire` there, not strings (packages/types/src/base.ts).
export interface MyWidgetSchema extends BaseSchema {
  type: 'my-widget';
  props?: MyWidgetProps; // read by the entry point's `{...schema.props}`
}

export interface MyWidgetProps {
  title?: string;
  columns?: ColumnDef[];
  className?: string;
  [key: string]: any;
}
```

## Implementing field widgets

Field widgets are simpler plugins that render form inputs. They implement `FieldWidgetComponentProps`:

<!-- os:check -->
```typescript
import { type FieldWidgetComponentProps } from '@object-ui/fields';
import { Input } from '@object-ui/components';

export function ColorField({
  value,
  onChange,
  field,
  readonly,
  disabled,
  className,
  error,
}: FieldWidgetComponentProps<string>) {
  return (
    <Input
      type="color"
      className={className}
      value={value || '#000000'}
      onChange={(e) => onChange(e.target.value)}
      disabled={readonly || disabled}
      // `error` drives the a11y state ONLY. The form renderer already prints
      // the message below the control via `<FormMessage/>`; printing it here
      // too shows the user the same sentence twice.
      aria-invalid={!!error}
    />
  );
}
```

### FieldWidgetComponentProps interface

The seven props a widget author writes, DERIVED from the published type rather
than retyped: the key names are checked against it and the value types come
from it, so this short view cannot drift from the long one.

```typescript
import type { FieldWidgetComponentProps } from '@object-ui/fields';

type WidgetAuthorProps<T = string> = Pick<
  FieldWidgetComponentProps<T>,
  | 'value'      // Current field value — typed `T`
  | 'onChange'   // Value change callback — `(val: T) => void`
  | 'field'      // Field metadata (name, label, type, etc.)
  | 'readonly'   // Read-only mode
  | 'disabled'   // HTML disabled state
  | 'className'  // Tailwind CSS classes
  | 'error'      // Active validation message — drive `aria-invalid` with it
>;
```

A widget signature normally names the whole type, as the example above does
(`FieldWidgetComponentProps<string>`); the `Pick` here exists to show WHICH
seven a widget author actually writes without keeping a second copy of them.

The slot is named `error` because that is what `FieldWidgetPropsSchema` in
`@objectstack/spec/ui` — the published widget contract — calls it.

The type is **closed**: it also declares the host plumbing
(`dataSource`, `dependentValues`, `dependsOn`, `dependsOnLabels`, `emptyHint`,
`compact`, `onUploadingChange`, `onSelectRecord`, `onCreateNew`) and, by
intersection, the DOM/ARIA pass-through the renderer forwards
(`FieldWidgetDomProps` → `id` / `name`, `AriaAttributes`, and a
`data-${string}` index signature), and nothing else. A key it does not declare is a compile error rather than a silent
`any`, so a typo like `readOnly` for `readonly` is caught at build time instead
of being quietly `undefined` at runtime.

### `field` is the only metadata carrier (v17, breaking)

Before v17 a widget could receive its metadata under **either** `field` or
`schema`, so widgets in the wild resolve their config as `field || schema`.
`schema` is gone from the widget contract in v17 — read `props.field`, full
stop.

`schema` still exists everywhere else: it is the universal SDUI node
`SchemaRenderer` hands to *every* registered component. That is exactly why a
field widget needs an adapter when it is rendered from a schema node rather
than from a form. Wrap it once, at registration:

```tsx
import { ComponentRegistry } from '@object-ui/core';
import { withFieldCarrier } from '@object-ui/fields';

ComponentRegistry.register('color', withFieldCarrier(ColorField), {
  namespace: 'field',
});
```

`withFieldCarrier` maps the node onto `field` (by reference — nothing is
copied or dropped) and consumes `schema`, so the widget only ever implements
one contract. All built-in field widgets are registered through it.

Two things are deliberately **not** props, because each has exactly one author
in the form renderer: the validation message TEXT (`<FormMessage/>`) and the
required marker (`<FormLabel>`). Rendering either inside a widget
double-displays it.

## Package configuration

### package.json essentials

<!-- os:check -->
```json
{
  "name": "@object-ui/plugin-my-widget",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "dependencies": {
    "@object-ui/components": "workspace:*",
    "@object-ui/core": "workspace:*",
    "@object-ui/react": "workspace:*",
    "@object-ui/types": "workspace:*",
    "lucide-react": "^1.43.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  }
}
```

### tsconfig.json

<!-- os:check -->
```json
{
  "extends": "../../tsconfig.react.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
```

## Registration patterns from existing plugins

### Multiple type registrations (plugin-form pattern)

```typescript
// Register primary type
ComponentRegistry.register('object-form', ObjectFormRenderer, {
  namespace: 'plugin-form',
  label: 'Object Form',
  category: 'plugin',
});

// Register semantic alias
ComponentRegistry.register('form', ObjectFormRenderer, {
  namespace: 'view',
  skipFallback: true,  // Don't overwrite other 'form' registrations
});

// Register variant
ComponentRegistry.register('embeddable-form', EmbeddableFormRenderer, {
  namespace: 'plugin-form',
  label: 'Embeddable Form',
  category: 'plugin',
});
```

### Data-driven component with `useDataScope` (plugin-kanban pattern)

```typescript
const KanbanRenderer: React.FC<{ schema: any }> = ({ schema }) => {
  const boundData = useDataScope(schema.bind);

  // Transform flat data + groupBy into column structure
  const columns = transformToColumns(boundData, schema.props?.groupBy);

  return <ObjectKanban columns={columns} {...schema.props} />;
};
```

## Testing patterns

### Registration test

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';

describe('plugin-my-widget registration', () => {
  beforeAll(async () => {
    await import('./index');
  });

  it('registers my-widget component', () => {
    expect(ComponentRegistry.has('my-widget')).toBe(true);
  });

  it('has correct metadata', () => {
    const config = ComponentRegistry.getConfig('my-widget');
    expect(config?.meta?.label).toBe('My Widget');
    expect(config?.meta?.category).toBe('plugin');
  });
});
```

## Common mistakes

- Forgetting to export the component as `default` for `React.lazy()` dynamic imports.
- Registering without a namespace, causing collisions with other plugins.
- Importing heavy dependencies at the top level instead of using `React.lazy()`.
- Not including `@object-ui/core` in dependencies (needed for `ComponentRegistry`).
- Putting business logic in the renderer — keep renderers thin, delegate to the implementation component.
- Using `any` for schema types — define proper TypeScript interfaces in `types.ts`.
