---
title: "Schema Overview"
description: "Comprehensive overview of ObjectUI schemas for building enterprise applications"
---

# Schema Overview

ObjectUI provides powerful schemas that enable you to build sophisticated enterprise applications with advanced features like theming, reporting, and complex workflows. This guide provides an overview of all available schemas and helps you get started quickly.

## Key Capabilities

ObjectUI includes enterprise-grade capabilities to build production-ready applications:

- **Application Structure** - Define complete multi-page applications with navigation
- **Dynamic Theming** - Brand your applications with custom themes and light/dark modes
- **Advanced Actions** - Build complex workflows with API calls, chaining, and conditions
- **Enterprise Reporting** - Generate, schedule, and export comprehensive reports

## Core Schemas

### Application Configuration

#### [App Schema](/docs/core/app-schema)
Define your entire application structure with navigation, branding, and global settings.

<!-- doc-snippet: fragment — a shape excerpt: `menu` and `navigation` are written as a literal `[...]` ellipsis because the section is about the app schema's top-level keys, not about a menu -->

```typescript
const app: AppComponentSchema = {
  type: 'app',
  title: 'My Application',
  layout: 'sidebar',
  menu: [...],
  navigation: [...]
};
```

**Use Cases:**
- Multi-page applications
- Admin dashboards
- CRM systems
- Internal tools

---

### Theming & Branding

#### [Theme Schema](/docs/core/theme-schema)
Dynamic theming with light/dark modes, color palettes, and typography.

Theming is **not** a component you declare in a page. There is no `type: 'theme'`
node: the `ThemeComponentSchema` wrapper documented here until objectui#5489 was
retired because no renderer ever implemented it, so a page declaring one got the
registry's "Unknown component type" panel rather than a theme manager.

A theme is a **document**, not a node. Author it as the `Theme` shape
`@object-ui/types` re-exports from `@objectstack/spec/ui`, hand it to
`ThemeProvider` (`@object-ui/react`), and `ThemeEngine` (`@object-ui/core`)
turns it into the CSS variables your components already read.

**What the theme document carries:**
- Light/dark mode switching
- 20+ semantic colors
- Typography system
- CSS variables
- Tailwind integration

---

### Advanced Actions

#### [Enhanced Actions](/docs/core/enhanced-actions)
Powerful action system with AJAX calls, chaining, conditions, and tracking.

<!-- doc-snippet: fragment — a shape excerpt: `chain` and `tracking` are written as literal `[...]` / `{...}` ellipses so the section can list the action keys without a worked example of each -->

```typescript
const action: ActionSchema = {
  type: 'action',
  actionType: 'ajax',
  api: '/api/submit',
  chain: [...],
  condition: '${...}',
  tracking: {...}
};
```

**New Action Types:**
- **`ajax`** - API calls with full request configuration
- **`confirm`** - Confirmation dialogs
- **`dialog`** - Modal/dialog actions

**Key Features:**
- Action chaining (sequential/parallel)
- Conditional execution (a `condition` predicate gates whether an action runs)
- Success / failure notices (`successMessage` / `errorMessage`)
- Event tracking
- Retry logic

---

### Reporting

#### [Report Schema](/docs/core/report-schema)
Enterprise reports with aggregation, export, and scheduling.

```typescript
import type { ReportComponentSchema } from '@object-ui/types';

const report: ReportComponentSchema = {
  type: 'report',
  title: 'Sales Report',
  fields: [
    { name: 'revenue', aggregation: 'sum' },
    { name: 'orders', aggregation: 'count' }
  ],
  schedule: {
    frequency: 'monthly',
    recipients: ['team@company.com']
  }
};
```

**Features:**
- Field aggregation (sum, avg, count, min, max)
- Multiple export formats (PDF, Excel, CSV)
- Scheduled reports
- Email distribution
- Interactive builder

---

## Quick Comparison

| Schema | Purpose | Best For |
|--------|---------|----------|
| **AppComponentSchema** | Application structure | Multi-page apps, dashboards |
| **Enhanced Actions** | Complex workflows | API integration, multi-step processes |
| **ReportComponentSchema** | Data reporting | Analytics, business intelligence |

## View Components

ObjectUI also includes enhanced view components:

### [Detail View](/docs/plugins/plugin-detail)
Rich detail pages with sections, tabs, and related records.

### [View Switcher](/docs/components/complex/view-switcher)
Toggle between list, grid, kanban, calendar, timeline, and map views.

### [Filter UI](/docs/components/complex/filter-ui)
Advanced filtering interface with multiple field types.

### [Sort UI](/docs/components/complex/sort-ui)
Sort configuration with multiple fields.

## Installation & Setup

### Package Installation

All schemas are included in `@object-ui/types`. Install it in your project:

```bash
npm install @object-ui/types
# or
pnpm add @object-ui/types
# or
yarn add @object-ui/types
```

### TypeScript Usage

Import the type definitions you need:

```typescript
import type { 
  AppComponentSchema, 
  ActionSchema,
  ReportComponentSchema
} from '@object-ui/types';
```

### Runtime Validation

For runtime validation, use the included Zod schemas:

```typescript
import { 
  AppComponentSchema,
  ActionSchema,
  ReportComponentSchema
} from '@object-ui/types/zod';

const myConfig = { type: 'app', title: 'My Application', layout: 'sidebar' };

const result = AppComponentSchema.safeParse(myConfig);
if (result.success) {
  // Valid configuration
  const app = result.data;
} else {
  // Handle validation errors
  console.error(result.error);
}
```

## Quick Start Example

Here's a complete example showing how to build a simple CRM application using ObjectUI schemas:

```typescript
import type { AppComponentSchema } from '@object-ui/types';

// Define your application structure
const app: AppComponentSchema = {
  type: 'app',
  name: 'enterprise-crm',
  title: 'Enterprise CRM',
  layout: 'sidebar',
  
  menu: [
    {
      type: 'item',
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      path: '/dashboard'
    },
    {
      type: 'group',
      label: 'Sales',
      children: [
        { type: 'item', label: 'Leads', path: '/leads' },
        { type: 'item', label: 'Deals', path: '/deals' }
      ]
    }
  ]
};
```

This creates a professional-looking CRM application with:
- A sidebar layout with navigation menu
- Sales section with leads and deals

Theming is configured separately, as a theme document handed to `ThemeProvider` —
see [Theme Schema](/docs/core/theme-schema).

## Advanced Features

ObjectUI provides advanced schemas and capabilities for enterprise applications:

### Core Schemas

ObjectUI includes these top-level schemas:

- **`AppComponentSchema`** - Define your entire application structure
- **`ReportComponentSchema`** - Create data reports with aggregation

### Enhanced ActionSchema

The `ActionSchema` provides comprehensive action handling:

- ✅ Action types: `ajax`, `confirm`, `dialog`
- ✅ Action chaining via the `chain` array (sequential or parallel)
- ✅ Conditional execution with the `condition` property
- ❌ Success/failure callbacks: `onSuccess` / `onFailure` were RETIRED (objectui#7068) — both faces refuse them; write `successMessage` / `errorMessage` for notices, and the spec's `onSuccess` block `{ navigate, openIn }` on `UIActionSchema` for post-success navigation (objectui#5934)
- ✅ Event tracking with the `tracking` configuration
- ✅ Automatic retry logic

### View Components

ObjectUI includes enhanced view components:

- **`DetailViewSchema`** - Rich detail pages with sections and tabs
- **`ViewSwitcherSchema`** - Toggle between list, grid, kanban, calendar views
- **`FilterUISchema`** - Advanced filtering interface
- **`SortUISchema`** - Multi-field sort configuration

## Getting Started

### Installation Steps

1. **Install package** - Add `@object-ui/types` to your project
   ```bash
   npm install @object-ui/types@latest
   ```

2. **Configure application** - Define your app structure with AppComponentSchema (optional)
   
3. **Set up theming** - Hand a `Theme` document to `ThemeProvider` for consistent styling (optional)

4. **Implement actions** - Use advanced action features like `confirm` and chaining

5. **Test your application** - Verify all functionality works as expected

## Learning Resources

- **[Schema Type Reference](/docs/api/schema-reference)** - Complete schema reference with JSON examples.
- **[Quick Start](/docs/guide/quick-start)** - Render your first ObjectUI schema.
- **[Schema Rendering](/docs/guide/schema-rendering)** - Understand the renderer pipeline.
- **[Component Registry](/docs/guide/component-registry)** - Learn how schema `type` values resolve to components.

## Getting Help

### Community Support
- **[GitHub Issues](https://github.com/objectstack-ai/objectui/issues)** - Report bugs and request features

### Official Documentation
- **[Documentation Site](https://www.objectui.org/docs)** - Full documentation and guides
- **[Schema Reference](/docs/api/schema-reference)** - Detailed schema documentation

## Next Steps

Ready to build with ObjectUI? Here's what to do next:

1. **[Review schema documentation](/docs/api/schema-reference)** - Learn about each schema in detail
2. **[Try the Quick Start](/docs/guide/quick-start)** - Build your first ObjectUI application
3. **[Explore components](/docs/components)** - See the core renderer catalog
4. **[Explore plugins](/docs/plugins)** - Add heavier widgets such as grids, kanban, charts, maps, and reports
