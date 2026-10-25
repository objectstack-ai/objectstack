---
title: "ObjectUI Documentation"
description: "Build schema-driven React interfaces with ObjectUI, Tailwind CSS, and Shadcn UI"
---

# ObjectUI Documentation

ObjectUI is a schema-driven UI engine for React. It renders JSON metadata into accessible, themeable components built with Tailwind CSS, Shadcn UI, and Radix primitives.

Use it when your application needs server-driven pages, metadata-defined forms, reusable enterprise views, or an embeddable renderer that stays independent from any single backend.

## Start Here

1. [Quick Start](/docs/guide/quick-start) - install ObjectUI and render a first schema.
2. [Schema Rendering](/docs/guide/schema-rendering) - learn how JSON becomes React UI.
3. [Data Connectivity](/docs/guide/data-source) - connect a backend through the `DataSource` contract.
4. [Schema Reference](/docs/api/schema-reference) - inspect the supported schema shapes.

## A Small Schema

```json
{
  "type": "data-table",
  "caption": "Users",
  "className": "rounded-lg border",
  "columns": [
    {
      "header": "Name",
      "accessorKey": "name",
      "sortable": true
    },
    {
      "header": "Email",
      "accessorKey": "email"
    }
  ],
  "data": [
    {
      "name": "Ada Lovelace",
      "email": "ada@example.com"
    },
    {
      "name": "Grace Hopper",
      "email": "grace@example.com"
    }
  ]
}
```

That schema renders through `SchemaRenderer` after the component package is imported once for registration side effects.

## Build Paths

### Render Schemas

- [Schema Renderer](/docs/core/schema-renderer) explains the runtime component.
- [Component Registry](/docs/guide/component-registry) explains how `type` maps to React components.
- [Expressions](/docs/guide/expressions) covers visibility, disabled state, and dynamic values.

### Build Applications

- [App Schema](/docs/core/app-schema) defines app navigation, branding, and layout.
- [Layout Guide](/docs/guide/layout) covers page structure and layout primitives.
- [Building a CRUD App](/docs/guide/building-crud-app) walks through a full task manager.

### Connect Data

- [Data Connectivity](/docs/guide/data-source) covers the backend adapter contract.
- [ObjectStack Adapter](/docs/utilities/data-objectstack) connects ObjectUI to ObjectStack backends.
- [User State Persistence](/docs/guide/user-state-persistence) covers favorites and recent items.

### Extend ObjectUI

- [Plugin Guide](/docs/guide/plugins) explains lazy-loaded feature packages.
- [Plugin Development](/docs/guide/plugin-development) walks through a custom plugin.
- [Theming](/docs/guide/theming) covers design tokens, Tailwind, and runtime themes.

## Reference

- [Components](/docs/components) - core renderers grouped by category.
- [Fields](/docs/guide/fields) - field widgets and cell renderers.
- [Plugins](/docs/plugins) - heavier views such as grids, kanban, charts, maps, and reports.
- [Utilities](/docs/utilities) - CLI, runner, plugin scaffolding, and editor tooling.

## Console

The ObjectUI Console is the reference application for rendering ObjectStack metadata as an admin UI. Start with [Console](/docs/guide/console), then use [Console Architecture](/docs/guide/console-architecture) and [Metadata Diagnostics](/docs/guide/metadata-diagnostics) when integrating a real backend.
