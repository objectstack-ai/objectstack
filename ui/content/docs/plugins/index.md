---
title: "Plugin Gallery"
description: "Explore all ObjectUI plugins for extended functionality"
---

# Plugin Gallery

ObjectUI plugins are lazy-loaded component packages that extend the framework with additional functionality. They load on-demand, keeping your main application bundle small while providing rich features.

## Quick Navigation

Browse available plugins:

### Data Visualization & Dashboards

- **[Charts Plugin](/docs/plugins/plugin-charts)** - Bar, Line, Area, and Pie charts
- **[Dashboard Plugin](/docs/plugins/plugin-dashboard)** - Dashboard layouts with metric cards and widgets
- **[Timeline Plugin](/docs/plugins/plugin-timeline)** - Vertical, horizontal, and Gantt-style timelines
- **[Gantt Plugin](/docs/plugins/plugin-gantt)** - Project task visualization with dependencies (ObjectQL)
- **[Calendar View Plugin](/docs/plugins/plugin-calendar-view)** - Full calendar with month/week/day views
- **[Calendar Plugin](/docs/plugins/plugin-calendar)** - Calendar for ObjectQL data sources
- **[Map Plugin](/docs/plugins/plugin-map)** - Location visualization with markers (ObjectQL)

### Data Management

- **[Grid Plugin](/docs/plugins/plugin-grid)** - Advanced data grid with sorting, filtering, and pagination
- **[Form Plugin](/docs/plugins/plugin-form)** - Advanced form builder with validation
- **[View Plugin](/docs/plugins/plugin-view)** - ObjectQL-integrated views (grid, form, detail)

### Content & Editing

- **[Editor Plugin](/docs/plugins/plugin-editor)** - Code editor powered by Monaco Editor
- **[Markdown Plugin](/docs/plugins/plugin-markdown)** - Markdown renderer with GFM support
- **[Chatbot Plugin](/docs/plugins/plugin-chatbot)** - Chat interface component

### Workflows & Tasks

- **[Kanban Plugin](/docs/plugins/plugin-kanban)** - Kanban board with drag-and-drop

## Official Plugins

### Charts Plugin

**[@object-ui/plugin-charts](/docs/plugins/plugin-charts)** - Data visualization components powered by Recharts.

- Bar, line, area, and pie charts
- Responsive design
- Customizable colors and themes
- Lazy-loaded (~540 KB)

```bash
npm install @object-ui/plugin-charts
```

[Read full documentation →](/docs/plugins/plugin-charts)

---

### Editor Plugin

**[@object-ui/plugin-editor](/docs/plugins/plugin-editor)** - Code editor component powered by Monaco Editor (VS Code's editor).

- Syntax highlighting for 100+ languages
- IntelliSense and code completion
- Multiple themes (VS Dark, Light, etc.)
- Lazy-loaded (~20 KB)

```bash
npm install @object-ui/plugin-editor
```

[Read full documentation →](/docs/plugins/plugin-editor)

---

### Kanban Plugin

**[@object-ui/plugin-kanban](/docs/plugins/plugin-kanban)** - Kanban board component with drag-and-drop powered by @dnd-kit.

- Drag and drop cards between columns
- Column limits (WIP limits)
- Card badges for status/priority
- Lazy-loaded (~100-150 KB)

```bash
npm install @object-ui/plugin-kanban
```

[Read full documentation →](/docs/plugins/plugin-kanban)

---

### Markdown Plugin

**[@object-ui/plugin-markdown](/docs/plugins/plugin-markdown)** - Markdown renderer with GitHub Flavored Markdown support.

- GitHub Flavored Markdown
- XSS protection
- Code syntax highlighting
- Lazy-loaded (~100-200 KB)

```bash
npm install @object-ui/plugin-markdown
```

[Read full documentation →](/docs/plugins/plugin-markdown)

---

### Timeline Plugin

**[@object-ui/plugin-timeline](/docs/plugins/plugin-timeline)** - Timeline component with multiple layout variants.

- Vertical, horizontal, and Gantt-style layouts
- Customizable markers with icons
- Date formatting options
- Time scales (day/week/month)

```bash
npm install @object-ui/plugin-timeline
```

[Read full documentation →](/docs/plugins/plugin-timeline)

---

### Chatbot Plugin

**[@object-ui/plugin-chatbot](/docs/plugins/plugin-chatbot)** - Chat interface component with message history.

- User and assistant message roles
- System messages
- Timestamps and avatars
- Auto-scroll and typing indicators

```bash
npm install @object-ui/plugin-chatbot
```

[Read full documentation →](/docs/plugins/plugin-chatbot)

---

### Calendar View Plugin

**[@object-ui/plugin-calendar-view](/docs/plugins/plugin-calendar-view)** - Full-featured calendar with month, week, and day views.

- Month, week, and day calendar views
- Event display with colors
- Navigation controls
- All-day and timed events

```bash
npm install @object-ui/plugin-calendar-view
```

[Read full documentation →](/docs/plugins/plugin-calendar-view)

---

### Calendar Plugin (ObjectQL)

**[@object-ui/plugin-calendar](/docs/plugins/plugin-calendar)** - Calendar visualization for ObjectQL data sources.

- ObjectQL integration
- Automatic field mapping
- Database-driven events
- Works with object/value providers

```bash
npm install @object-ui/plugin-calendar
```

[Read full documentation →](/docs/plugins/plugin-calendar)

---

### Gantt Plugin (ObjectQL)

**[@object-ui/plugin-gantt](/docs/plugins/plugin-gantt)** - Gantt chart for ObjectQL data sources.

- Project task visualization
- Progress tracking (0-100%)
- Task dependencies
- ObjectQL integration

```bash
npm install @object-ui/plugin-gantt
```

[Read full documentation →](/docs/plugins/plugin-gantt)

---

### Map Plugin (ObjectQL)

**[@object-ui/plugin-map](/docs/plugins/plugin-map)** - Map visualization for ObjectQL data sources.

- Location-based markers
- Latitude/longitude support
- Marker customization
- ObjectQL integration

```bash
npm install @object-ui/plugin-map
```

[Read full documentation →](/docs/plugins/plugin-map)

---

### Dashboard Plugin

**[@object-ui/plugin-dashboard](/docs/plugins/plugin-dashboard)** - Dashboard layouts with metric cards and widgets.

- Dashboard grid layouts
- Metric/KPI cards with trends
- Widget system
- Responsive design

```bash
npm install @object-ui/plugin-dashboard
```

[Read full documentation →](/docs/plugins/plugin-dashboard)

---

### Grid Plugin

**[@object-ui/plugin-grid](/docs/plugins/plugin-grid)** - Advanced data grid with sorting, filtering, and pagination.

- Column sorting and filtering
- Pagination controls
- Row selection
- Custom cell renderers

```bash
npm install @object-ui/plugin-grid
```

[Read full documentation →](/docs/plugins/plugin-grid)

---

### Form Plugin

**[@object-ui/plugin-form](/docs/plugins/plugin-form)** - Advanced form builder with validation.

- Multi-step forms
- Field validation
- Custom field types
- Form state management

```bash
npm install @object-ui/plugin-form
```

[Read full documentation →](/docs/plugins/plugin-form)

---

### View Plugin

**[@object-ui/plugin-view](/docs/plugins/plugin-view)** - ObjectQL-integrated views for automatic CRUD operations.

- Auto-generated forms and grids
- CRUD operations
- ObjectQL integration
- Field mapping

```bash
npm install @object-ui/plugin-view
```

[Read full documentation →](/docs/plugins/plugin-view)

---

## How Plugins Work

### Lazy Loading Architecture

Plugins use React's `lazy()` and `Suspense` to load heavy dependencies on-demand:

<!-- doc-snippet: fragment — the inside of a plugin package: `./MonacoImpl` is that package's own sibling module, which exists only within the plugin being described and cannot resolve from here -->

```typescript
// The plugin structure
import React, { Suspense } from 'react'
import { Skeleton } from '@object-ui/components'

// Lazy load the heavy implementation
const LazyEditor = React.lazy(() => import('./MonacoImpl'))

export const CodeEditorRenderer = (props) => (
  <Suspense fallback={<Skeleton className="w-full h-[400px]" />}>
    <LazyEditor {...props} />
  </Suspense>
)
```

**Benefits:**
- **Smaller initial bundle**: Main app loads faster
- **Progressive loading**: Components load when needed
- **Better UX**: Loading skeletons while chunks download
- **Automatic code splitting**: Vite handles chunking

### Bundle Impact

| Plugin | Initial Load | Lazy Load | Description |
|--------|-------------|-----------|-------------|
| plugin-editor | ~0.2 KB | ~20 KB | Monaco editor |
| plugin-charts | ~0.2 KB | ~540 KB | Recharts visualization |
| plugin-kanban | ~0.2 KB | ~100-150 KB | Drag-and-drop board |
| plugin-markdown | ~0.2 KB | ~100-200 KB | Markdown rendering |
| plugin-timeline | ~0.2 KB | ~10 KB | Timeline layouts |
| plugin-chatbot | ~0.2 KB | ~30 KB | Chat interface |
| plugin-calendar-view | ~0.2 KB | ~40 KB | Full calendar |
| plugin-calendar | ~0.2 KB | ~50 KB | ObjectQL calendar |
| plugin-gantt | ~0.2 KB | ~60 KB | ObjectQL Gantt |
| plugin-map | ~0.2 KB | ~20 KB | ObjectQL map |

Without lazy loading, all this code would be in your main bundle!

### Auto-Registration

Plugins automatically register their components when imported:

<!-- doc-snippet: fragment — continues the plugin-structure block above: `CodeEditorRenderer` is the component defined there, and repeating its definition here would bury the one line this section is about -->

```typescript
// In the plugin's index.tsx
import { ComponentRegistry } from '@object-ui/core'

ComponentRegistry.register('code-editor', CodeEditorRenderer)
```

You just need to import the plugin once:

```typescript
// In your App.tsx or main.tsx
import '@object-ui/plugin-editor'
import '@object-ui/plugin-charts'
import '@object-ui/plugin-kanban'
import '@object-ui/plugin-markdown'
```

Now all plugin components are available in your schemas!

## Usage Pattern

All ObjectUI plugins follow the same usage pattern:

```jsonc
{
  "type": "plugin-component-name",
  "className": "tailwind-classes"
  // Plugin-specific properties go here, on the node itself
}
```

Plugin renderers read their configuration off the node (`schema.objectName`,
`schema.columns`, …), exactly like the built-in ones. Do not wrap those keys in
a `props` envelope: `SchemaRenderer` spreads `schema.props` as React props
rather than merging it into the node, so anything parked there is never read.

### Example: Code Editor

```json
{
  "type": "code-editor",
  "language": "typescript",
  "value": "const greeting = 'Hello World';",
  "className": "h-96",
  "theme": "vs-dark"
}
```

### Example: Bar Chart

```json
{
  "type": "bar-chart",
  "data": [
    { "name": "Jan", "value": 400 },
    { "name": "Feb", "value": 300 },
    { "name": "Mar", "value": 600 }
  ],
  "dataKey": "value",
  "xAxisKey": "name",
  "height": 300,
  "color": "#8884d8"
}
```

## Features

All ObjectUI plugins share these characteristics:

- ✅ **Lazy Loaded** - Load on-demand, not upfront
- ✅ **Auto-Register** - Import once, use everywhere
- ✅ **Type-Safe** - Full TypeScript support
- ✅ **Schema-Driven** - Define with JSON, not code
- ✅ **Tailwind CSS** - Use utility classes directly
- ✅ **Loading States** - Built-in skeletons while loading
- ✅ **Small Footprint** - Minimal initial bundle impact

## Next Steps

- **[Plugin Guide](/docs/guide/plugins)** - Learn how plugins work in detail
- **[Quick Start Guide](/docs/guide/quick-start)** - Build your first ObjectUI app
- **[Component Gallery](/docs/components)** - Explore core components
- **[Schema Rendering](/docs/guide/schema-rendering)** - Learn how the engine works

## Need Help?

Can't find what you're looking for? Check out:

- [Architecture](/docs/guide/architecture) - Core concepts and package boundaries
- [API Reference](/docs/api) - Schema documentation and protocol specs
- [GitHub](https://github.com/objectstack-ai/objectui) - Report issues or contribute
