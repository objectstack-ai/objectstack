# Kanban Board Component

A fully functional, schema-driven Kanban board component for Object UI with drag-and-drop support.

## Features

- **Multiple Columns**: Create unlimited columns with customizable titles
- **Rich Cards**: Cards support title, description, and multiple badges
- **Drag & Drop**: Smooth drag-and-drop functionality powered by @dnd-kit
- **Reordering**: ⛔ Not supported — card order is persisted nowhere, so a card
  dropped inside its own column returns to its position rather than showing a
  reorder the next data round-trip would silently undo (objectui#8826)
- **Cross-Column Moves**: Move cards between different columns
- **Column Limits**: Optional capacity limits with visual indicators
- **Card Counters**: Shows current count and limit per column
- **Schema-Driven**: Configure entirely through JSON/YAML
- **Event Callbacks**: Custom event handling for card movements

## Usage

### Basic Example

```json
{
  "type": "object-kanban",
  "groupBy": "status",
  "data": [],
  "className": "w-full h-[600px]",
  "columns": [
    {
      "id": "todo",
      "title": "To Do",
      "cards": [
        {
          "id": "card-1",
          "title": "Task Title",
          "description": "Task description",
          "badges": [
            { "label": "High Priority", "variant": "destructive" }
          ]
        }
      ]
    },
    {
      "id": "in-progress",
      "title": "In Progress",
      "limit": 3,
      "cards": []
    },
    {
      "id": "done",
      "title": "Done",
      "cards": []
    }
  ]
}
```

### With Event Handling

⛔ **`onCardMove` is not a document key, and never was.** JSON has no function
value, so it cannot be authored — not as a function, and not as the string
spelling this page used to teach:

```json
{
  "type": "object-kanban",
  "onCardMove": "(event) => { console.log('Card moved:', event); }"
}
```

That document was **accepted and silently dropped** until objectui#9342: the
`object-kanban` validator did not declare the key, `BaseSchema` is
`.passthrough()`, and `ObjectKanban` substituted its own mover on the schema it
hands the board — so an author who wrote it got a board that never called it and
no error saying why. It is now **refused by name**, with the remedy in the
message.

The board's mover is a **React prop**, supplied by the host that owns the write:

```tsx
import { KanbanRenderer } from '@object-ui/plugin-kanban';

const board = { type: 'object-kanban', groupBy: 'status', data: [], columns };

// A sibling of `schema`, never a member of it (objectui#9342).
const onCardMove = (
  cardId: string,
  fromColumnId: string,
  toColumnId: string,
  newIndex: number,
) => {
  console.log(`Card ${cardId} moved from ${fromColumnId} to ${toColumnId} at ${newIndex}`);
};

<KanbanRenderer schema={board} onCardMove={onCardMove} />;
```

⚠️ On an **object-bound** board (`<ObjectKanban>`, the `object-kanban` registry
key) the host does **not** supply it: `ObjectKanban` owns the mover, because the
same function owns the optimistic write, the required-fields dialog and the
rollback. The prop above is for a host that mounts `KanbanRenderer` directly.

## Schema Reference

### Kanban Props

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `"object-kanban"` | Yes | Component type identifier. ⚠️ The bare `kanban` spelling was RETIRED in objectui#8802 (ruled 2026-09-09) and is refused by name. |
| `columns` | `KanbanColumn[]` | Yes | Array of column configurations |
| `className` | `string` | No | Custom CSS classes |
| `onCardMove` | `never` | — | ⛔ RETIRED (objectui#9342) — refused by name. Not a document key: the mover is a React prop on `KanbanRenderer`, or `ObjectKanban`'s own on an object-bound board. See "With Event Handling" above. |

### KanbanColumn

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique column identifier |
| `title` | `string` | Yes | Column header title |
| `cards` | `KanbanCard[]` | Yes | Array of cards in this column |
| `limit` | `number` | No | Maximum number of cards allowed |
| `className` | `string` | No | Custom CSS classes for column |

### KanbanCard

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique card identifier |
| `title` | `string` | Yes | Card title |
| `description` | `string` | No | Card description text |
| `badges` | `Badge[]` | No | Array of badge objects |

### Badge

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `label` | `string` | Yes | Badge text |
| `variant` | `"default" \| "secondary" \| "destructive" \| "outline"` | No | Badge color variant |

## Examples

### Simple Task Board

```json
{
  "type": "object-kanban",
  "groupBy": "status",
  "data": [],
  "columns": [
    {
      "id": "backlog",
      "title": "📋 Backlog",
      "cards": [
        {
          "id": "1",
          "title": "Setup project",
          "badges": [{ "label": "Setup" }]
        }
      ]
    },
    {
      "id": "doing",
      "title": "🚀 Doing",
      "limit": 2,
      "cards": []
    },
    {
      "id": "done",
      "title": "✅ Done",
      "cards": []
    }
  ]
}
```

### Issue Tracking Board

```json
{
  "type": "object-kanban",
  "groupBy": "status",
  "data": [],
  "columns": [
    {
      "id": "new",
      "title": "New Issues",
      "cards": [
        {
          "id": "issue-1",
          "title": "Bug: Login fails on Safari",
          "description": "Users can't login using Safari browser",
          "badges": [
            { "label": "Bug", "variant": "destructive" },
            { "label": "P0", "variant": "destructive" }
          ]
        }
      ]
    },
    {
      "id": "investigating",
      "title": "Investigating",
      "limit": 3,
      "cards": []
    },
    {
      "id": "fixed",
      "title": "Fixed",
      "cards": []
    }
  ]
}
```

## Styling

The Kanban component uses Tailwind CSS and can be customized using the `className` prop:

```json
{
  "type": "object-kanban",
  "groupBy": "status",
  "data": [],
  "className": "w-full h-[800px] bg-gray-50 p-4 rounded-lg",
  "columns": [...]
}
```

Individual columns can also be styled:

```json
{
  "id": "urgent",
  "title": "🔥 Urgent",
  "className": "bg-red-50",
  "cards": [...]
}
```

## Technical Details

- Built with React 18+ and TypeScript
- Uses @dnd-kit for drag-and-drop functionality
- Integrates with Shadcn UI components (Card, Badge, ScrollArea)
- Supports both pointer and touch interactions
- Accessible keyboard navigation (via @dnd-kit)

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Full support with touch gestures
