# Plugin Kanban - Lazy-Loaded Kanban Board

A lazy-loaded kanban board component for Object UI based on @dnd-kit for drag-and-drop functionality.

## Features

- **Internal Lazy Loading**: @dnd-kit libraries are loaded on-demand using `React.lazy()` and `Suspense`
- **Zero Configuration**: Just import the package and use `type: 'object-kanban'` in your schema
- **Automatic Registration**: Components auto-register with the ComponentRegistry
- **Skeleton Loading**: Shows a skeleton while @dnd-kit loads
- **Drag and Drop**: Full drag-and-drop support for cards between columns
- **Column Limits**: Set maximum card limits per column
- **Customizable**: Badge support, custom styling, and callbacks

## Installation

```bash
pnpm add @object-ui/plugin-kanban
```

Then import the stylesheet this package publishes, after the base sheets. It is a
supplement — compiled against the `@object-ui/components` theme with that sheet's
rules subtracted — so the order matters, and without it the board renders with no
themed styling at all ([#4929](https://github.com/objectstack-ai/objectui/issues/4929)):

```css
/* src/index.css */
@import "tailwindcss";
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
@import "@object-ui/plugin-kanban/style.css";
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-kanban';

// Now you can author the `object-kanban` node type in your schemas.
// ⛔ The bare `kanban` node type key RETIRED in objectui#8802 — a
// `{ type: 'kanban' }` document is now refused BY NAME and told to write
// `object-kanban`. (The STORED `NamedListView.type` value `"kanban"` is a
// different layer and is unaffected — do not rewrite saved views.)
//
// ONE record source (`data`, `bind` or `objectName`, or a `dataSource.object`
// binding, which the registration lands on `objectName`) is what the surviving
// face requires of every board; `groupBy` is OPTIONAL since objectui#8990 but is what
// makes the lanes hold cards, so every working board authors it. The shape below
// is the one the catalog fixture `plugin-kanban/basic-kanban-board.json` carries.
const schema = {
  type: 'object-kanban',
  groupBy: 'status',
  data: [],
  columns: [
    {
      id: 'todo',
      title: 'To Do',
      cards: [
        { id: '1', title: 'Task 1', description: 'Description' }
      ]
    },
    {
      id: 'done',
      title: 'Done',
      cards: []
    }
  ]
};
```

### Manual Integration

```typescript
import { kanbanComponents } from '@object-ui/plugin-kanban';
import { ComponentRegistry } from '@object-ui/core';

// Manually register if needed
Object.entries(kanbanComponents).forEach(([type, component]) => {
  ComponentRegistry.register(type, component);
});
```

### TypeScript Support

The plugin exports TypeScript types for full type safety:

```typescript
import type { KanbanCard, KanbanColumn } from '@object-ui/plugin-kanban';
import type { ObjectKanbanSchema } from '@object-ui/types';

const card: KanbanCard = {
  id: 'task-1',
  title: 'My Task',
  description: 'Task description',
  badges: [
    { label: 'High Priority', variant: 'destructive' }
  ]
};

const column: KanbanColumn = {
  id: 'todo',
  title: 'To Do',
  cards: [card],
  limit: 5
};

// ⚠️ `object-kanban`: the bare `kanban` node type key and its `KanbanSchema`
// arm RETIRED in objectui#8802. One of `bind` / `data` / `objectName` is what the
// surviving face requires of every board; `groupBy` is optional since
// objectui#8990, and authored here because a board without it holds no cards.
const schema: ObjectKanbanSchema = {
  type: 'object-kanban',
  groupBy: 'status',
  data: [],
  columns: [column]
};
```

## Schema API

```typescript
import type { ObjectKanbanSchema } from '@object-ui/types';

declare const columns: KanbanColumn[];

// The board document. `type` is required, and so is ONE record source — `bind`,
// `data` or `objectName`, or a `dataSource.object` binding, which lands on
// `objectName`. `groupBy`, `columns`, `navigation` and `className` are optional.
//
// `groupBy` is OPTIONAL since objectui#8990, matching `@objectstack/spec`. It is
// still the key that makes the board work: with no lane key the records are never
// distributed, so a lane-less board draws whatever lanes `columns` declares and
// holds NO cards, and dragging a card writes nothing back. Omitting it is valid,
// not useful — author it on any board meant to group records.
//
// ⚠️ `onCardMove` is NOT a document key: it is a React prop the host supplies
// (JSON has no function value), which is why it is spelled with explicit
// parameter types below rather than inferred from the annotation. Since
// objectui#9342 the document face says so BY NAME — `ObjectKanbanSchema` carries
// a `?: never` tombstone and the zod mirror refuses the key with the remedy in
// the message, where before an authored one was accepted and silently dropped.
// The annotation is the type this package's renderer consumes; an unknown key
// does not fail it — `ObjectKanbanSchema` extends `BaseSchema`, whose index
// signature deliberately accepts type-specific extensions, so the compiler is
// not what catches a misspelt board key.
const board: ObjectKanbanSchema = {
  type: 'object-kanban',
  groupBy: 'status',                  // optional, but the field that makes the lanes
  data: [],                           // one record source is required
  columns,                            // Array of columns
  navigation: { mode: 'modal' },      // What a card click opens (see below)
  className: 'h-full',                // Tailwind classes
};

// Supplied by the React host, never authored in JSON:
const onCardMove = (cardId: string, fromColumnId: string, toColumnId: string, newIndex: number) => {
  // see "Example with Callbacks" below
  void [cardId, fromColumnId, toColumnId, newIndex];
};

// Column structure
interface KanbanColumn {
  id: string;                         // The option VALUE — the ONLY key a record is matched on
  title: string;                      // Display only; never decides lane membership (objectui#10069)
  cards: KanbanCard[];
  limit?: number;                     // WIP limit — the count at which the lane warns
  className?: string;
  collapsed?: boolean;                // Lane starts collapsed — narrowed to a title
                                      // spine, cards withheld, heading a disclosure
                                      // the viewer can reopen (objectui#9628)
  color?: never;                      // RETIRED — refused by name; style a lane through className
}

// Card structure
interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  badges?: Array<{
    label: string;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
    colorClass?: string;
    colorStyle?: React.CSSProperties; // Required whenever colorClass came from getBadgeHexAppearance(color) in @object-ui/fields — the class reads CSS custom properties only this style declares (objectui#5183)
  }>;
  cardSubtitle?: string;              // Synthesized subtitle, rendered in preference to description
  cardFieldCells?: Array<{            // Structured per-field cells; wins over cardSubtitle/description
    field: string;
    label?: string;
    node: React.ReactNode;
  }>;
  coverImage?: string;                // Resolved cover-image URL, from the board's coverImageField
}
```

### Card-click navigation

`navigation` is what a card click opens — the spec's `NavigationConfig` by
reference, `ViewNavigationConfig` in `@object-ui/types`, the type
`ObjectGridSchema.navigation` uses: `mode` (`page`, `drawer`, `modal`, `split`,
`popover`, `new_window` or `none`) with `size`, `openNewTab` and
`preventNavigation`. With the key absent a click opens the record in a drawer,
and a click handler from a parent view outranks the whole key. `page` — and a
block written without `mode`, which takes the spec's `page` default — opens the
record page through the record navigator the host publishes on
`RelatedRecordActionsContext` (objectui#11293); the console publishes one on its
custom pages, record pages and list views. Under a host that publishes none,
such as an embedded renderer, there is no record page to open and the click
opens nothing.

## Features

- **Drag and Drop**: Drag cards between columns — the column change is persisted.
  ⛔ **Not in-column ordering.** A card dropped inside its own column returns to
  its position: card order is persisted nowhere, there is no ordering slot in
  `@objectstack/spec` to write it to, and a board that animated the reorder
  anyway would be showing a success the next data round-trip silently undoes
  (objectui#8826). The landing position of a cross-column move is not claimed
  either — the card lands where the data order puts it.
- **Column Limits**: Set maximum card limits and get visual feedback when full
- **Card Badges**: Add colored badges to cards for status/priority
- **Responsive**: Horizontal scrolling for many columns
- **Accessible**: Drag announcements and each card's description read in the viewer's language (objectui#12716, objectui#12837). Cards move by pointer or touch drag; there is no keyboard drag.

## Lazy Loading Architecture

The plugin uses a two-file pattern for optimal code splitting:

1. **`KanbanImpl.tsx`**: Contains the actual @dnd-kit imports (heavy ~100-150 KB)
2. **`index.tsx`**: Entry point with `React.lazy()` wrapper (light)

When bundled, Vite automatically creates separate chunks:
- `index.js` (~200 bytes) - The entry point
- `KanbanImpl-xxx.js` (~100-150 KB) - The lazy-loaded implementation

The @dnd-kit libraries are only downloaded when an `object-kanban` component is actually rendered, not on initial page load.

## Bundle Size Impact

By using lazy loading, the main application bundle stays lean:
- Without lazy loading: +100-150 KB on initial load
- With lazy loading: +0.19 KB on initial load, +100-150 KB only when kanban is rendered

This results in significantly faster initial page loads for applications that don't use kanban on every page.

## Development

```bash
# Build the plugin
pnpm build

# The package will generate proper ESM and UMD builds with lazy loading preserved
```

## Example with Callbacks

```typescript
import type { KanbanColumn } from '@object-ui/plugin-kanban';
import type { ObjectKanbanSchema } from '@object-ui/types';

declare const columns: KanbanColumn[];

const schema: ObjectKanbanSchema = {
  type: 'object-kanban',
  groupBy: 'status',
  data: [],
  columns,
};

// The host supplies the handler as a React prop — JSON has no function value.
// It is a SIBLING of `schema` on `KanbanRenderer`, never a member of it
// (objectui#9342): `<KanbanRenderer schema={schema} onCardMove={onCardMove} />`.
const onCardMove = (cardId: string, fromColumnId: string, toColumnId: string, newIndex: number) => {
  console.log(`Card ${cardId} moved from ${fromColumnId} to ${toColumnId} at index ${newIndex}`);
  // Update your backend or state here
};
```

⚠️ An **object-bound** board does not take this prop. `ObjectKanban` owns the
mover — the same function owns the optimistic write, the required-fields dialog
and the rollback — so on the `object-kanban` registry key there is no host
handler to supply, and the document key is refused by name.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-kanban)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-kanban)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
