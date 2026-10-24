---
title: "Plugins"
---

Object UI supports a powerful plugin system that allows you to extend the framework with additional components. Plugins are separate packages that load on-demand, keeping your main application bundle small while providing rich functionality.

## Overview

Plugins are lazy-loaded component packages that:

- **Auto-register** components when imported
- **Lazy-load** heavy dependencies on-demand
- **Keep bundles small** - only load when needed
- **Are type-safe** with full TypeScript support
- **Follow best practices** with built-in loading states

## Official Plugins

Object UI provides 14+ official plugins for common use cases:

### Data Visualization & Dashboards

#### [@object-ui/plugin-charts](../plugins/plugin-charts.mdx)

Data visualization components powered by Recharts.

- Bar, line, area, and pie charts
- Responsive design
- Customizable colors
- Lazy-loaded (~80 KB)

[Read full documentation →](../plugins/plugin-charts.mdx)

---

#### [@object-ui/plugin-dashboard](../plugins/plugin-dashboard.mdx)

Dashboard layouts with metric cards and widgets.

- Dashboard grid layouts
- Metric/KPI cards with trends
- Widget system
- Lazy-loaded (~22 KB)

[Read full documentation →](../plugins/plugin-dashboard.mdx)

---

#### [@object-ui/plugin-timeline](../plugins/plugin-timeline.mdx)

Timeline component with multiple layout variants.

- Vertical, horizontal layouts
- Customizable markers
- Date formatting
- Lazy-loaded (~20 KB)

[Read full documentation →](../plugins/plugin-timeline.mdx)

---

#### [@object-ui/plugin-gantt](../plugins/plugin-gantt.mdx)

Gantt chart for project visualization.

- Task dependencies
- Progress tracking
- ObjectQL integration
- Lazy-loaded (~40 KB)

[Read full documentation →](../plugins/plugin-gantt.mdx)

---

#### [@object-ui/plugin-calendar](../plugins/plugin-calendar.mdx)

Calendar visualization for events.

- Month/week/day views
- Event management
- ObjectQL integration
- Lazy-loaded (~25 KB)

[Read full documentation →](../plugins/plugin-calendar.mdx)

---

#### [@object-ui/plugin-map](../plugins/plugin-map.mdx)

Map visualization with markers.

- Interactive maps
- Location markers
- ObjectQL integration
- Lazy-loaded (~60 KB)

[Read full documentation →](../plugins/plugin-map.mdx)

---

### Data Management

#### [@object-ui/plugin-grid](../plugins/plugin-grid.mdx)

Advanced data grid with sorting, filtering, and pagination.

- Column sorting and filtering
- Pagination controls
- Row selection
- Lazy-loaded (~45 KB)

[Read full documentation →](../plugins/plugin-grid.mdx)

---

#### [@object-ui/plugin-form](../plugins/plugin-form.mdx)

Advanced form builder with validation.

- Multi-step forms
- Field validation
- Custom field types
- Lazy-loaded (~28 KB)

[Read full documentation →](../plugins/plugin-form.mdx)

---

#### [@object-ui/plugin-view](../plugins/plugin-view.mdx)

ObjectQL-integrated views for automatic CRUD.

- Auto-generated forms and grids
- CRUD operations
- Field mapping
- Lazy-loaded (~35 KB)

[Read full documentation →](../plugins/plugin-view.mdx)

---

### Content & Editing

#### [@object-ui/plugin-editor](../plugins/plugin-editor.mdx)

Code editor component powered by Monaco Editor.

- Syntax highlighting for 100+ languages
- IntelliSense and code completion
- Multiple themes
- Lazy-loaded (~120 KB)

[Read full documentation →](../plugins/plugin-editor.mdx)

---

#### [@object-ui/plugin-markdown](../plugins/plugin-markdown.mdx)

Markdown renderer with GitHub Flavored Markdown support.

- GitHub Flavored Markdown
- XSS protection
- Code syntax highlighting
- Lazy-loaded (~30 KB)

[Read full documentation →](../plugins/plugin-markdown.mdx)

---

#### [@object-ui/plugin-chatbot](../plugins/plugin-chatbot.mdx)

Chat interface component.

- Message history
- User and assistant roles
- Timestamps and avatars
- Responsive floating panel for console assistants
- Inline responding, stop, and retry states
- Lazy-loaded (~35 KB)

[Read full documentation →](../plugins/plugin-chatbot.mdx)

---

### Workflows & Tasks

#### [@object-ui/plugin-kanban](../plugins/plugin-kanban.mdx)

Kanban board component with drag-and-drop powered by @dnd-kit.

- Drag and drop cards between columns
- Column limits (WIP limits)
- Card badges for status/priority
- Lazy-loaded (~100 KB)

[Read full documentation →](../plugins/plugin-kanban.mdx)

---

## How Plugins Work

### Stylesheets

A plugin's JavaScript is only half of what it renders with. `@object-ui/plugin-grid` and `@object-ui/plugin-kanban` publish a `style.css` of their own, and an app that installs one must import it after the base sheets:

```css
/* src/index.css */
@import "tailwindcss";
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
@import "@object-ui/plugin-grid/style.css";
@import "@object-ui/plugin-kanban/style.css";
```

Each plugin sheet is compiled against the components theme and then has every rule that sheet already ships subtracted from it, so it carries only what the plugin adds. That includes the themed utilities (`bg-muted/10`, `bg-card/60`, `ring-primary/40`) which **no consumer-side configuration can produce** — the `@theme` block declaring their tokens lives in package source that is not published, so scanning `node_modules` cannot reach it ([#4929](https://github.com/objectstack-ai/objectui/issues/4929)). Skip the import and the view renders unstyled.

Add a line only for the plugins you install. The other `@object-ui/plugin-*` packages do not publish a stylesheet yet; the build step above is the pattern each of them will adopt when it needs one.

### Lazy Loading Architecture

Plugins use React's `lazy()` and `Suspense` to load heavy dependencies on-demand:

<!-- doc-snippet: fragment — excerpt of a plugin package's own source; './MonacoImpl' is a sibling file in the reader's package, not a module resolvable from this repo -->
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
| plugin-editor | ~0.2 KB | ~120 KB | Monaco editor |
| plugin-charts | ~0.2 KB | ~80 KB | Recharts visualization |
| plugin-kanban | ~0.2 KB | ~100 KB | Drag-and-drop board |
| plugin-markdown | ~0.2 KB | ~30 KB | Markdown rendering |
| plugin-dashboard | ~0.2 KB | ~22 KB | Dashboard layouts |
| plugin-form | ~0.2 KB | ~28 KB | Form builder |
| plugin-grid | ~0.2 KB | ~45 KB | Data grid |
| plugin-view | ~0.2 KB | ~35 KB | ObjectQL views |
| plugin-timeline | ~0.2 KB | ~20 KB | Timeline layouts |
| plugin-chatbot | ~0.2 KB | ~35 KB | Chat interface |
| plugin-calendar | ~0.2 KB | ~25 KB | Calendar views |
| plugin-gantt | ~0.2 KB | ~40 KB | Gantt charts |
| plugin-map | ~0.2 KB | ~60 KB | Map visualization |

Without lazy loading, all this code would be in your main bundle!

### Auto-Registration

Plugins automatically register their components when imported:

<!-- doc-snippet: fragment — continues the block above — CodeEditorRenderer is defined there, and this line is the tail of the same plugin index.tsx -->
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
import '@object-ui/plugin-dashboard'
import '@object-ui/plugin-form'
import '@object-ui/plugin-grid'
// ... import other plugins as needed
```

Now all plugin components are available in your schemas!

## Creating Custom Plugins

You can create your own plugins following the same pattern:

### 1. Create Package Structure

```bash
mkdir -p packages/plugin-myfeature/src
cd packages/plugin-myfeature
```

### 2. Create Heavy Implementation

<!-- doc-snippet: fragment — the reader's new package importing its own heavy dependency; 'heavy-library' is a placeholder name, not an installed module -->
```typescript
// src/MyFeatureImpl.tsx
import HeavyLibrary from 'heavy-library'

export default function MyFeatureImpl(props) {
  return <HeavyLibrary {...props} />
}
```

### 3. Create Lazy Wrapper

<!-- doc-snippet: fragment — the reader's new src/index.tsx; './MyFeatureImpl' is the sibling file created in the previous step -->
```typescript
// src/index.tsx
import React, { Suspense } from 'react'
import { ComponentRegistry } from '@object-ui/core'
import { Skeleton } from '@object-ui/components'

// Lazy load implementation
const LazyFeature = React.lazy(() => import('./MyFeatureImpl'))

// Create renderer with Suspense
export const MyFeatureRenderer = (props) => (
  <Suspense fallback={<Skeleton className="w-full h-[300px]" />}>
    <LazyFeature {...props} />
  </Suspense>
)

// Auto-register
ComponentRegistry.register('my-feature', MyFeatureRenderer)

// Export for manual use
export const myFeatureComponents = {
  'my-feature': MyFeatureRenderer
}
```

### 4. Add TypeScript Types

```typescript
// src/types.ts
import type { BaseSchema } from '@object-ui/types'

export interface MyFeatureSchema extends BaseSchema {
  type: 'my-feature'
  customProp?: string
}
```

### 5. Configure Build

<!-- doc-snippet: fragment — a vite.config.ts for the reader's plugin package; '@vitejs/plugin-react' is that package's devDependency, not this repo's -->
```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'ObjectUIPluginMyFeature',
      fileName: (format) => `index.${format}.js`
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        '@object-ui/components',
        '@object-ui/core'
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    }
  }
})
```

### 6. Add Package.json

```json
{
  "name": "@object-ui/plugin-myfeature",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.umd.js",
  "module": "./dist/index.es.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.es.js",
      "require": "./dist/index.umd.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "vite build && tsc --emitDeclarationOnly"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  },
  "dependencies": {
    "heavy-library": "^1.0.0"
  },
  "devDependencies": {
    "@object-ui/components": "workspace:*",
    "@object-ui/core": "workspace:*",
    "@object-ui/types": "workspace:*",
    "@vitejs/plugin-react": "^6.0.5",
    "typescript": "^6.0.3",
    "vite": "^8.2.1"
  }
}
```

## Best Practices

### 1. Keep Entry Point Light

The main index file should only contain:
- Lazy loading wrapper
- Component registration
- Type exports

Heavy imports go in the `*Impl.tsx` file.

### 2. Provide Good Loading States

Always show a meaningful skeleton while loading:

<!-- doc-snippet: fragment — a bare JSX excerpt showing the Suspense wrapper shape; Suspense, Skeleton, LazyComponent and props all come from the surrounding component -->
```typescript
<Suspense fallback={
  <Skeleton className="w-full h-[400px]" />
}>
  <LazyComponent {...props} />
</Suspense>
```

### 3. Export Types

Make your plugin type-safe:

<!-- doc-snippet: fragment — re-export excerpt from the reader's package; './types' is the file created in step 4 -->
```typescript
export type { MyFeatureSchema } from './types'
```

### 4. Document Your Plugin

Include a README with:
- Installation instructions
- Usage examples
- Schema API reference
- Bundle size information

### 5. Test Lazy Loading

Verify that:
- The main bundle is small (~200 bytes)
- The lazy chunk is separate
- Components load correctly when rendered

```bash
pnpm build
ls -lh dist/
```

## Plugin vs Component Package

**Use a Plugin when:**
- The component depends on large libraries (>50 KB)
- Not all apps will use this component
- You want on-demand loading

**Use regular Components when:**
- The component is lightweight
- Most apps will use it
- It's part of core functionality

## Troubleshooting

### Plugin not loading

Check that you imported it in your app:

<!-- doc-snippet: fragment — the app-side import of '@object-ui/plugin-myfeature', the package this guide teaches the reader to publish -->
```typescript
import '@object-ui/plugin-myfeature'
```

### TypeScript errors

Make sure types are exported:

<!-- doc-snippet: fragment — re-export from '@object-ui/plugin-myfeature', the reader's own published package -->
```typescript
export type { MyFeatureSchema } from '@object-ui/plugin-myfeature'
```

### Bundle size too large

Check that the implementation is in a separate file:

```
✅ src/index.tsx        (light, uses React.lazy)
✅ src/MyFeatureImpl.tsx (heavy, imported lazily)
```

### Component not registering

Check that ComponentRegistry.register() is called at the module level:

<!-- doc-snippet: fragment — a good/bad contrast pair; ComponentRegistry and MyFeatureRenderer are the ambient names of the plugin index.tsx being discussed -->
```typescript
// ✅ Good - runs on import
ComponentRegistry.register('my-feature', MyFeatureRenderer)

// ❌ Bad - never runs
export function registerComponents() {
  ComponentRegistry.register('my-feature', MyFeatureRenderer)
}
```

## Related Documentation

- [Component Registry](./component-registry.md) - Understanding the registry
- [Schema Rendering](./schema-rendering.md) - How schemas become UI
- [Custom Plugin Development](/docs/guide/plugin-development) - Component development
- **[Create Plugin Utility](/docs/utilities/create-plugin)** - Scaffold new plugins quickly
- **[CLI Tool](/docs/utilities/cli)** - Test plugins with the CLI
- **[All Utilities](/docs/utilities)** - Complete toolkit for development

## Next Steps

1. Install official plugins you need
2. Try creating a custom plugin
3. Share your plugins with the community
4. Contribute new plugins to Object UI
