---
title: "Component Gallery"
description: "Explore all ObjectUI components organized by category"
---

# Component Gallery

ObjectUI provides a comprehensive set of components built on React, Tailwind CSS, and Shadcn UI. All components are defined through JSON schemas and rendered with pixel-perfect quality.

## Quick Navigation

Browse components by category to find what you need:

### [Basic Components](/docs/components/basic/text)
Essential building blocks: Text, Icon, Image, Separator, HTML

### [Form Components](/docs/components/form/button)
Interactive inputs: Button, Input, Select, Checkbox, Switch, Textarea, Slider

### [Layout Components](/docs/components/layout/container)
Structure your UI: Container, Card, Grid, Flex, Stack, Tabs

### [Data Display](/docs/components/data-display/badge)
Show information: Badge, Avatar, Alert, List

### [Feedback Components](/docs/components/feedback/loading)
User feedback: Loading, Progress, Skeleton

### [Overlay Components](/docs/components/overlay/dialog)
Floating elements: Dialog, Drawer, Tooltip, Popover

### [Disclosure Components](/docs/components/disclosure/accordion)
Show/hide content: Accordion, Collapsible

### [Complex Components](/docs/components/complex/table)
Advanced patterns: Table (with sorting, filtering, pagination)

## Component Categories

### Basic Components

The foundation of your UI. These are simple, single-purpose components:

- **[Text](/docs/components/basic/text)** - Display text with typography control
- **[Icon](/docs/components/basic/icon)** - Render icons from Lucide React
- **[Image](/docs/components/basic/image)** - Display images with lazy loading
- **[Separator](/docs/components/basic/separator)** - Visual divider between content
- **[HTML](/docs/components/basic/html)** - Render raw HTML content

### Form Components

Interactive elements for user input:

- **[Button](/docs/components/form/button)** - Trigger actions with multiple variants
- **[Input](/docs/components/form/input)** - Text input with validation
- **[Select](/docs/components/form/select)** - Dropdown selection
- **[Checkbox](/docs/components/form/checkbox)** - Boolean selection
- **[Switch](/docs/components/form/switch)** - Toggle switch
- **[Textarea](/docs/components/form/textarea)** - Multi-line text input
- **[Slider](/docs/components/form/slider)** - Numeric range selection

### Layout Components

Structure and organize your interface:

- **[Container](/docs/components/layout/container)** - Responsive container with max-width
- **[Card](/docs/components/layout/card)** - Content card with header and footer
- **[Grid](/docs/components/layout/grid)** - CSS Grid layout
- **[Flex](/docs/components/layout/flex)** - Flexbox layout
- **[Stack](/docs/components/layout/stack)** - Vertical or horizontal stack
- **[Tabs](/docs/components/layout/tabs)** - Tabbed interface

### Data Display

Present data to users:

- **[Badge](/docs/components/data-display/badge)** - Small status indicators
- **[Avatar](/docs/components/data-display/avatar)** - User profile images
- **[Alert](/docs/components/data-display/alert)** - Contextual messages
- **[List](/docs/components/data-display/list)** - Ordered or unordered lists

### Feedback Components

Provide visual feedback:

- **[Loading](/docs/components/feedback/loading)** - Loading spinner
- **[Progress](/docs/components/feedback/progress)** - Progress bar
- **[Skeleton](/docs/components/feedback/skeleton)** - Loading placeholder

### Overlay Components

Floating UI elements:

- **[Dialog](/docs/components/overlay/dialog)** - Modal dialog
- **[Drawer](/docs/components/overlay/drawer)** - Slide-out drawer
- **[Tooltip](/docs/components/overlay/tooltip)** - Hover tooltips
- **[Popover](/docs/components/overlay/popover)** - Floating popover

### Disclosure Components

Expandable content:

- **[Accordion](/docs/components/disclosure/accordion)** - Expandable sections
- **[Collapsible](/docs/components/disclosure/collapsible)** - Toggle content visibility

### Complex Components

Advanced, feature-rich components:

- **[Table](/docs/components/complex/table)** - Data table with sorting, filtering, and pagination

## Usage Pattern

All ObjectUI components follow the same schema-based pattern:

```json
{
  "type": "component-name",
  "className": "tailwind-classes",
  "componentSpecificProperty": "value"
}
```

### Example: Button

```json
{
  "type": "button",
  "label": "Click Me",
  "variant": "default",
  "size": "default",
  "className": "mt-4"
}
```

### Example: Card with Form

```json
{
  "type": "card",
  "title": "User Profile",
  "className": "max-w-md",
  "children": {
    "type": "form",
    "fields": [
      {
        "type": "input",
        "name": "name",
        "label": "Full Name"
      },
      {
        "type": "input",
        "name": "email",
        "label": "Email",
        "inputType": "email"
      }
    ]
  }
}
```

## Features

All ObjectUI components share these characteristics:

- ✅ **Schema-Driven** - Define with JSON, not code
- ✅ **Tailwind CSS** - Use utility classes directly in schemas
- ✅ **Accessible** - WCAG 2.1 AA compliant
- ✅ **Responsive** - Mobile-first design
- ✅ **Themeable** - Light/dark mode support
- ✅ **Type-Safe** - Full TypeScript support
- ✅ **Performant** - Lazy-loaded and tree-shakable

## Next Steps

- **[Quick Start Guide](/docs/guide/quick-start)** - Build your first ObjectUI app
- **[Schema Rendering](/docs/guide/schema-rendering)** - Learn how the engine works
- **[Component Registry](/docs/guide/component-registry)** - Register custom components
- **[Expressions](/docs/guide/expressions)** - Dynamic values with expressions

## Need Help?

Can't find what you're looking for? Check out:

- [Architecture](/docs/guide/architecture) - Core concepts and package boundaries
- [API Reference](/docs/api) - Schema documentation and protocol specs
- [GitHub](https://github.com/objectstack-ai/objectui) - Report issues or contribute
