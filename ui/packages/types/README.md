# @object-ui/types

Pure TypeScript type definitions for Object UI - **The Protocol Layer**.

## Features

- 🎯 **Complete Type Coverage** - Every component has full TypeScript definitions
- 🏛️ **Built on @objectstack/spec** - Extends the universal UI component specification
- 📦 **Minimal Dependencies** - Only depends on @objectstack/spec (pure types)
- 🔌 **Framework Agnostic** - Use with React, Vue, or any framework
- 🌍 **Backend Agnostic** - Works with REST, GraphQL, ObjectQL, or local data
- 🎨 **Tailwind Native** - Designed for Tailwind CSS styling
- 📚 **Comprehensive JSDoc** - Every type is fully documented

## Installation

```bash
npm install @object-ui/types
# or
yarn add @object-ui/types
# or
pnpm add @object-ui/types
```

**Important:** This package depends on `@objectstack/spec` which provides the foundational protocol.

## Architecture: The Inheritance Chain

Object UI follows a strict **"Protocol First"** approach with a clear inheritance hierarchy:

```
@objectstack/spec                   ← The "Highest Law" - Universal protocol. The
                                      required range is declared in package.json,
                                      the authority; a copy here goes stale unnoticed.
    ↓
BaseSchema (@object-ui/types)       ← A component node: the base interface every
                                      UI component schema extends, carrying `type`
                                      plus the shared keys (visibleOn, hiddenOn, etc.)
    ↓
Specific Schemas                    ← Component implementations (ChartSchema, etc.)
    ↓
@object-ui/core (Engine)            ← Schema validation and expression evaluation
    ↓
@object-ui/react (Framework)        ← React renderer
    ↓
@object-ui/components (UI)          ← Shadcn/Tailwind implementation
```

This separation allows:
- ✅ Multiple UI implementations (Shadcn, Material, Ant Design)
- ✅ Multiple framework bindings (React, Vue, Svelte)
- ✅ Multiple backend adapters (REST, GraphQL, ObjectQL)
- ✅ Static analysis and validation without runtime dependencies
- ✅ Compliance with the ObjectStack ecosystem standards

## Usage

### Basic Example

```typescript
import type { FormSchema, InputSchema, ButtonSchema } from '@object-ui/types';

const loginForm: FormSchema = {
  type: 'form',
  fields: [
    {
      name: 'email',
      type: 'input',
      inputType: 'email',
      label: 'Email',
      required: true,
    },
    {
      name: 'password',
      type: 'input',
      inputType: 'password',
      label: 'Password',
      required: true,
    }
  ],
  submitLabel: 'Sign In'
};
```

### Advanced Example

```typescript
import type { DataTableSchema, FlexSchema, CardSchema } from '@object-ui/types';

const dashboard: CardSchema = {
  type: 'card',
  title: 'User Management',
  // A card's child channel is `children` (objectui#6771); `content` is no card key.
  children: {
    type: 'data-table',
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Email', accessorKey: 'email' },
      { header: 'Role', accessorKey: 'role' }
    ],
    data: [], // Connected to data source
    pagination: true,
    searchable: true,
    selectable: true
  }
};
```

### Type Narrowing

```typescript
import type { AnySchema, SchemaByType } from '@object-ui/types';

function renderComponent(schema: AnySchema) {
  if (schema.type === 'input') {
    // TypeScript automatically narrows to InputSchema
    console.log(schema.placeholder);
  }
}

// Or use the utility type
type ButtonSchema = SchemaByType<'button'>;
```

### Authoring the spec's blocks in TypeScript

The spec's page blocks take their props in a `properties` bag, which is the
block's `ComponentPropsMap` row in `@objectstack/spec`. These types give each
such node a TypeScript face, derived from the zod arm or the spec row, never
restated by hand:

- `PublicBlockNode`: every public block the zod face arms (`element:text`,
  `page:tabs`, `action:button`, ...), each the arm's own input.
  `PublicBlockNodeOf<'element:text'>` picks one.
- `ObjectQLPublicBlockNode`: every ObjectQL block the zod face arms in
  `ObjectQLPublicBlockComponentSchema`, each the arm's own input. Each is also
  exported by name: `ObjectGridBlockNode`, `ObjectFormBlockNode`,
  `ObjectMapBlockNode`, `ObjectGanttBlockNode`, `ObjectChartBlockNode`,
  `ObjectMetricBlockNode`, `ObjectTimelineBlockNode`,
  `ObjectMasterDetailFormBlockNode`, `ObjectPivotBlockNode`,
  `EmbeddableFormBlockNode` and `ListViewBlockNode`.
- `FlexBlockNode`: an authored `flex` node, its layout props and its child
  list in the bag. `flex` and `object-chart` have no `ComponentPropsMap` row,
  so each bag is the flat type's own members (`FlexSchema`,
  `ObjectChartSchema`), closed like a row.
- `ElementTextInputNode` and `ElementRecordPickerNode`: the spec rows of
  `element:text_input` and `element:record_picker`.
- `PageDocumentNode`: a stored page document under its page kind
  (`type: 'home'`, `kind: 'html'`, ...).
- `AuthoringNode`: all of the above. `SchemaRenderer`'s `schema` prop
  (`@object-ui/react`) accepts it beside `BaseSchema`.

```typescript
import type { ElementTextInputNode, PublicBlockNodeOf } from '@object-ui/types';

const tabs: PublicBlockNodeOf<'page:tabs'> = {
  type: 'page:tabs',
  properties: {
    items: [{ label: 'Details', value: 'details', children: [] }],
  },
};

const workspace: ElementTextInputNode = {
  type: 'element:text_input',
  id: 'workspace',
  properties: { label: 'Workspace', placeholder: 'acme' },
};
```

A key misspelled inside a bag (`properties: { contnet: 'Hello' }` on an
`element:text`) does not type-check against these types. An action's executor
keys (`actionType`, `target`, `params`) belong in the `action:button` bag, not
flat on the node.

### The strict authoring face

`@object-ui/types/zod` publishes **two** faces over the same declarations.

- The **rendering face** (`AnyComponentSchema`, `SchemaNodeSchema`, every named
  mirror) is tolerant: a node may carry keys the schema does not declare, because
  renderer props ride through it. Some declared sub-blocks are closed on this face
  as well — an `object-map` node's `map` block is one (objectui#5157) — so a key
  misspelled inside one of them is refused by both faces.
- The **strict authoring face** is a derived twin that closes every declared
  object, at every depth. It is meant for authoring-time checking — validating a
  document a person or an agent just wrote — where an undeclared key is far more
  likely to be a typo than a renderer prop.

```typescript
import {
  AnyComponentSchema,
  ButtonSchema,
  StrictAnyComponentSchema,
  deriveStrictAuthoringSchema,
} from '@object-ui/types/zod';

const document = { type: 'card', childrn: [] }; // note the typo

AnyComponentSchema.safeParse(document).success;       // true  — the tolerant face
StrictAnyComponentSchema.safeParse(document).success; // false — `unrecognized_keys: ["childrn"]`

// Take the strict twin of any schema on the face:
const StrictButton = deriveStrictAuthoringSchema(ButtonSchema);
```

The twins are derived from the mirrors, never hand-written, so they cannot drift
from them. Strictness here is a property of the parse, not of the declaration:
the derived schema carries the same TypeScript type as the schema it came from.
Opaque `custom` / `function` / `transform` validators have no shape to close;
`deriveStrictAuthoringSchema` reports each one it meets through the optional
`onOpaqueShape` callback.

A `metric-card` sitting directly in a dashboard's `widgets` slot is a
component node whose props are its registration's `inputs`. Its node declares
them — `title`, `value` (required), `icon`, `trend` and `trendValue`, with
`description` from `BaseSchema` — so both faces judge each value by its member,
and the strict face still refuses any other key by name (objectui#11022,
objectui#11467; the members are held to the live registration and to
`MetricCard`'s props by a test in `@object-ui/plugin-dashboard`). A widget's
`component` slot takes the same node first; the strict face judges a card there
by it, while the tolerant face also keeps `BaseSchema` for any other component
node. The node also declares one widget key, `layout`, the spec's widget
position, which the editable grid's Save Layout writes onto every entry; it is
judged by the spec's shape (objectui#11070). `metric-card` is not a widget
`type`, so the slot reads such a card through this node alone, and a card with
no `value` is refused on both faces (objectui#11483):

```typescript
import { StrictAnyComponentSchema } from '@object-ui/types/zod';

const card = (widget: object) => ({ type: 'dashboard', widgets: [widget] });

StrictAnyComponentSchema.safeParse(card({ type: 'metric-card', value: 42 })).success; // true
StrictAnyComponentSchema.safeParse(card({ type: 'metric-card', value: 42, bogus: 1 })).success; // false — `bogus` is named
StrictAnyComponentSchema.safeParse(card({ type: 'metric-card', title: 'Revenue' })).success; // false — no `value`
StrictAnyComponentSchema.safeParse(card({ type: 'metric-card', value: 42, layout: { x: 0, y: 0, w: 3, h: 2 } })).success; // true
StrictAnyComponentSchema.safeParse(card({ type: 'metric-card', value: 42, trend: 'sideways' })).success; // false — not a trend
```

### Writing a widget's `layout`

A widget's `layout` is optional, but once present it is four numbers: the spec
refuses a box that carries only `w` or only `h`. A widget with no `layout` is
auto-placed by the grid. An editor that changes one dimension writes the whole
box through `completeWidgetLayout`, seeding the coordinates it does not edit
from the box the grid shows the widget in, which for a widget with no `layout`
is `defaultWidgetPlacement(index)` (objectui#11388):

```typescript
import { completeWidgetLayout, defaultWidgetPlacement } from '@object-ui/types';
import type { DashboardWidgetSchema } from '@object-ui/types';

declare const widget: DashboardWidgetSchema;
declare const index: number; // the widget's position in `widgets[]`

const layout = completeWidgetLayout(widget.layout, { w: 6 }, defaultWidgetPlacement(index));
// No `layout` at index 0 → { x: 0, y: 0, w: 6, h: 4 }; an existing box keeps its x, y and h.
const next: DashboardWidgetSchema = { ...widget, layout };
```

The width and height editors in `@object-ui/app-shell` (Studio),
`@object-ui/plugin-dashboard` (`DashboardWithConfig`) and
`@object-ui/plugin-designer` (`DashboardEditor`) all write through it, and
`DashboardGridLayout` places a widget with no `layout` through the same
default.

## Type Categories

### Base Types

Foundation types that all components build upon:

- `BaseSchema` - The base interface for all components
- `SchemaNode` - What a node slot holds: a `DeclaredNode`, or a primitive rendered as text
- `DeclaredNode` - The discriminated union, keyed by `type`, of every declared node type; every node slot and `SchemaRenderer`'s `schema` prop take it, so an inline child is checked against its own type and an undeclared `type` is refused
- `CustomNodeRegistry` - The interface an application augments (`declare module '@object-ui/types'`) to declare a node type it registers, which then joins `DeclaredNode`
- `AuthoringNode` - The spec-declared nodes with a typed `properties` bag (see "Authoring the spec's blocks in TypeScript")
- `NODE_SLOT_DECLARATIONS` / `nodeSlotsFor(type)` - The per-type node slots beside `children`: where a renderer hands authored nodes back to `SchemaRenderer` through a key of its own (a dialog's `trigger`, a tab item's `content`, a page's `regions[].components`), spelled as key paths (`items[].content`). One declaration, read by `objectui check`, the core schema validator and the SDUI parser; `nodeSlotValues(node, path)` walks a node by it
- `ComponentMeta` - Metadata for component registration
- `ComponentInput` - Input field definitions for designers/editors

### Layout Components

Structure and organization:

- `ContainerSchema` - Max-width container
- `FlexSchema` - Flexbox layout, as the renderer reads it; an authored `flex` node writes its `FlexLayoutProps` in its `properties` bag
- `GridSchema` - CSS Grid layout
- `CardSchema` - Card container
- `TabsSchema` - Tabbed interface

### Form Components

User input and interaction:

- `FormSchema` - Complete form with validation
- `InputSchema` - Text input field
- `SelectSchema` - Dropdown select
- `CheckboxSchema` - Checkbox input
- `RadioGroupSchema` - Radio button group
- `DatePickerSchema` - Date selection
- And 10+ more form components

### Data Display Components

Information presentation:

- `DataTableSchema` - Enterprise data table with sorting, filtering, pagination
- `TableSchema` - Simple table
- `ListSchema` - List with items
- `ChartSchema` - Charts and graphs
- `TreeViewSchema` - Hierarchical tree
- `TimelineSchema` - Timeline visualization

### Feedback Components

Status and progress:

- `LoadingSchema` - Loading spinner
- `ProgressSchema` - Progress bar
- `SkeletonSchema` - Loading placeholder
- `ToastSchema` - Toast notifications

### Overlay Components

Modals and popovers:

- `DialogSchema` - Modal dialog
- `SheetSchema` - Side panel/drawer
- `PopoverSchema` - Popover
- `TooltipSchema` - Tooltip
- `DropdownMenuSchema` - Dropdown menu

### Navigation Components

Menus and navigation:

- `HeaderBarSchema` - Top navigation bar
- `SidebarSchema` - Side navigation
- `BreadcrumbSchema` - Breadcrumb navigation
- `PaginationSchema` - Pagination controls

### Complex Components

Advanced composite components:

- `ObjectKanbanSchema` - Kanban board (`object-kanban`; the bare `kanban` node type key and its `KanbanSchema` arm retired in objectui#8802)
- `CalendarViewSchema` - Calendar with events
- `FilterBuilderSchema` - Advanced filter builder
- `CarouselSchema` - Image/content carousel
- `ChatbotSchema` - Chat interface

### Action Components

Server-driven actions and the nodes that render them:

- `UIActionSchema` - One action: what it runs, where it renders (`locations`) and how it looks
- `ActionBarSchema` - The location-aware action toolbar (`action:bar`), rendered by `@object-ui/components`; it declares no index signature, so a typed literal may write only the keys the renderer reads

### Data Management

Backend integration:

- `DataSource` - Universal data adapter interface
- `QueryParams` - Query parameters (OData-style)
- `QueryResult` - Paginated query results
- `DataBinding` - Data binding configuration

## Design Principles

### 1. Protocol Agnostic

Types don't assume any specific backend:

```typescript
import type { DataSource, QueryParams, QueryResult } from '@object-ui/types';

// Two methods quoted from the shipped `DataSource`. `extends Pick` ties the
// quotation to the real interface: the day either member is renamed away or its
// return type changes, this block stops compiling.
interface DataSourceExcerpt<T = any> extends Pick<DataSource<T>, 'find' | 'create'> {
  find(resource: string, params?: QueryParams): Promise<QueryResult<T>>;
  create(resource: string, data: Partial<T>): Promise<T>;
  // Works with REST, GraphQL, ObjectQL, or anything
}
```

### 2. Tailwind Native

All components support `className` for Tailwind styling:

```typescript
import type { ButtonSchema } from '@object-ui/types';

const button: ButtonSchema = {
  type: 'button',
  label: 'Click Me',
  className: 'bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded'
};
```

### 3. Type Safe

Full TypeScript support with discriminated unions:

```typescript
import type { AnySchema, ButtonSchema, FormSchema, InputSchema } from '@object-ui/types';

// The shipped `AnySchema` carries 50+ members. These three are a slice of it,
// and the assignment below is what proves the slice really is part of the union.
type SchemaSlice = InputSchema | ButtonSchema | FormSchema;
declare const slice: SchemaSlice;
const anySchema: AnySchema = slice;

function render(schema: AnySchema) {
  switch (schema.type) {
    case 'input': /* schema is InputSchema */ break;
    case 'button': /* schema is ButtonSchema */ break;
  }
}
```

### 4. Composable

Components can nest indefinitely:

```typescript
import type { ContainerSchema, FlexBlockNode, HeaderBarSchema, SidebarSchema } from '@object-ui/types';

// The two leaves are annotated with their node types, so each is checked
// against its own declaration (`BaseSchema` carries no index signature to
// absorb a stray key, objectui#8347).
// The sidebar draws what it composes through `children` (an app's navigation
// lives in the app's metadata, not on this node), and `collapsible: false`
// draws it in the page flow, beside `main`.
const sidebar: SidebarSchema = {
  type: 'sidebar',
  collapsible: false,
  children: [
    { type: 'text', content: 'Menu' },
    { type: 'button', label: 'Home', variant: 'ghost' }
  ]
};

const main: ContainerSchema = {
  type: 'container',
  children: [{ type: 'data-table', data: [], columns: [] }]
};

// An authored `flex` node takes its props, the child list included, in its
// `properties` bag. `FlexBlockNode` is that node, its bag closed, and each
// entry of the bag's child list is checked as a node of its own `type`. The
// nested `flex` names its type with `satisfies` too. That was needed while the
// post-hoist `FlexSchema` inherited `BaseSchema`'s index signature, which
// admitted any `properties`; objectui#8347 removed it, so the entry is judged
// as `FlexBlockNode` either way, and the annotation stays as documentation.
const page: FlexBlockNode = {
  type: 'flex',
  properties: {
    direction: 'col',
    children: [
      { type: 'header-bar', crumbs: [{ label: 'My App' }] } satisfies HeaderBarSchema,
      {
        type: 'flex',
        properties: {
          direction: 'row',
          children: [sidebar, main]
        }
      } satisfies FlexBlockNode
    ]
  }
};
```

`FlexSchema` is the same node as the `flex` renderer reads it, after `SchemaRenderer`
hoists the bag onto the node; `objectui validate` refuses those props written flat on an
authored node.

## Comparison

### vs Amis Types

- ✅ **Lighter** - No runtime dependencies
- ✅ **Tailwind Native** - Built for Tailwind CSS
- ✅ **Better TypeScript** - Full type inference
- ✅ **Framework Agnostic** - Not tied to React

### vs Formily Types

- ✅ **Full Pages** - Not just forms, entire UIs
- ✅ **Simpler** - More straightforward API
- ✅ **Better Docs** - Comprehensive JSDoc

## Contributing

We follow these constraints for this package:

1. **ZERO runtime dependencies** - Only TypeScript types
2. **No React imports** - Framework agnostic
3. **Comprehensive JSDoc** - Every property documented
4. **Protocol first** - Types define the contract

## Links

- 📚 [Documentation](https://www.objectui.org/docs/api/schema-reference)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/types)
- 📝 [Changelog](./CHANGELOG.md)
- 💻 [GitHub repository](https://github.com/objectstack-ai/objectui)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT
