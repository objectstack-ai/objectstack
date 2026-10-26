---
title: "Schema Playground"
description: "Interactive schema playground for experimenting with ObjectUI schemas — edit JSON, see live UI, and learn by doing"
---

# Schema Playground

The Schema Playground is the fastest way to learn ObjectUI. Write JSON schemas in an editor, see the rendered UI instantly, and iterate on your designs without setting up a project.

## How It Works

The playground follows the core ObjectUI rendering pipeline:

```
JSON Editor → Schema Validation → SchemaRenderer → Live Preview
```

1. **Write** a JSON schema in the left panel
2. **Preview** the rendered UI in the right panel in real-time
3. **Iterate** by modifying properties and seeing changes instantly

## Setting Up the Playground

Add the playground to any React project with ObjectUI installed:

```tsx
import { useState } from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { initializeComponents } from '@object-ui/components';
// Side-effect import: loading the package runs its own field registration.
import '@object-ui/fields';

initializeComponents();

function SchemaPlayground() {
  const [schema, setSchema] = useState('{\n  "type": "button",\n  "label": "Click me"\n}');
  const [error, setError] = useState<string | null>(null);

  const parsed = (() => {
    try {
      const obj = JSON.parse(schema);
      if (error) setError(null);
      return obj;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  })();

  return (
    <div className="grid grid-cols-2 gap-4 h-[600px]">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">JSON Schema</h3>
        <textarea
          className="flex-1 rounded-md border bg-muted p-3 font-mono text-sm"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
        />
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Live Preview</h3>
        <div className="flex-1 rounded-md border bg-background p-4 overflow-auto">
          {parsed && <SchemaRenderer schema={parsed} />}
        </div>
      </div>
    </div>
  );
}
```

## Example Schemas

Try pasting any of the following schemas into the playground to see them rendered.

### Button

A simple button with a variant and icon:

```json
{
  "type": "button",
  "label": "Save Changes",
  "variant": "default",
  "icon": "save",
  "size": "default"
}
```

Try changing `"variant"` to `"destructive"`, `"outline"`, `"secondary"`, or `"ghost"` to see different styles.

### Card

A content card with a header, a description, and a `children` content list:

```json
{
  "type": "card",
  "title": "Monthly Revenue",
  "description": "Revenue summary for the current month",
  "children": {
    "type": "stack",
    "direction": "col",
    "gap": 4,
    "children": [
      {
        "type": "text",
        "content": "$48,250",
        "className": "text-3xl font-bold"
      },
      {
        "type": "badge",
        "label": "+12.5% from last month",
        "variant": "secondary"
      }
    ]
  }
}
```

### Form

A complete form with validation, driven entirely by schema:

A form draws no heading of its own (put the title on a `card` around it), a select's `options` are
`{ "label", "value" }` objects, and a field's starting value goes in the form's `defaultValues`:

```json
{
  "type": "form",
  "fields": [
    {
      "name": "fullName",
      "type": "text",
      "label": "Full Name",
      "required": true,
      "placeholder": "Jane Doe"
    },
    {
      "name": "email",
      "type": "text",
      "label": "Email",
      "required": true,
      "placeholder": "jane@example.com",
      "pattern": "^[^@]+@[^@]+\\.[^@]+$"
    },
    {
      "name": "role",
      "type": "select",
      "label": "Role",
      "options": [
        { "label": "Admin", "value": "Admin" },
        { "label": "Editor", "value": "Editor" },
        { "label": "Viewer", "value": "Viewer" }
      ]
    },
    {
      "name": "bio",
      "type": "textarea",
      "label": "Bio",
      "placeholder": "Tell us about yourself..."
    }
  ],
  "defaultValues": { "role": "Viewer" },
  "actions": [
    { "type": "submit", "label": "Create Account", "variant": "default" },
    { "type": "reset", "label": "Reset", "variant": "outline" }
  ]
}
```

### Data Table

A table over inline rows, with sortable columns and pagination. `grid` is the layout grid (a
column count and a gap), not a data table:

```json
{
  "type": "data-table",
  "caption": "Team Members",
  "columns": [
    { "header": "Name", "accessorKey": "name", "sortable": true },
    { "header": "Role", "accessorKey": "role", "sortable": true },
    { "header": "Status", "accessorKey": "status", "sortable": true },
    { "header": "Joined", "accessorKey": "joined" }
  ],
  "data": [
    { "name": "Alice Chen", "role": "Engineer", "status": "Active", "joined": "2024-01-15" },
    { "name": "Bob Smith", "role": "Designer", "status": "Active", "joined": "2024-03-22" },
    { "name": "Carol Jones", "role": "PM", "status": "Away", "joined": "2023-11-08" }
  ],
  "pagination": true,
  "pageSize": 10
}
```

### Composing Schemas

Schemas can be nested to build complex layouts. Here is a dashboard that combines multiple components:

```json
{
  "type": "page",
  "pageType": "app",
  "title": "Project Dashboard",
  "children": {
    "type": "grid",
    "columns": 3,
    "gap": 4,
    "children": [
      {
        "type": "card",
        "title": "Open Issues",
        "children": {
          "type": "text",
          "content": "24",
          "className": "text-4xl font-bold text-primary"
        }
      },
      {
        "type": "card",
        "title": "Pull Requests",
        "children": {
          "type": "text",
          "content": "8",
          "className": "text-4xl font-bold text-primary"
        }
      },
      {
        "type": "card",
        "title": "Deployments",
        "children": {
          "type": "text",
          "content": "142",
          "className": "text-4xl font-bold text-primary"
        }
      }
    ]
  }
}
```

## Schema → Rendered UI Flow

Every schema goes through the following pipeline before becoming visible UI:

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐     ┌──────────┐
│  JSON Schema │────▶│  Validation  │────▶│ Registry Lookup│────▶│ React UI │
└─────────────┘     └──────────────┘     └────────────────┘     └──────────┘
```

1. **Parse** — The JSON string is parsed into a JavaScript object.
2. **Validate** — The `type` field is checked against the component registry. Required fields are verified.
3. **Resolve** — The registry maps the `type` to a React component. Expressions like `"visibleOn": "${data.role === 'admin'}"` are evaluated.
4. **Render** — The matched component receives the schema properties as props and renders Shadcn primitives with Tailwind classes.

In code, this is a single call:

```tsx
import { SchemaRenderer } from '@object-ui/react';
import type { CardSchema } from '@object-ui/types';

// The schema object (from your editor, API, or file)
const schema: CardSchema = {
  type: 'card',
  title: 'Hello',
  children: { type: 'text', content: 'World' },
};

// One line to go from JSON to UI
<SchemaRenderer schema={schema} />
```

## Tips for the Playground

- **Start simple** — Begin with a single `button` or `text` schema and add complexity incrementally.
- **Use `className`** — Any schema object accepts a `className` property for Tailwind utility classes.
- **Check the `type`** — If nothing renders, verify the `type` value matches a registered component.
- **Nest schemas** — Use container types like `stack`, `grid`, and `page` to compose multiple components.
- **Add expressions** — Use `visibleOn` and `disabledOn` for dynamic behavior: `"visibleOn": "${data.showAdvanced}"`.

## Related Resources

- [Schema Rendering](/docs/guide/schema-rendering) — How the rendering engine works in detail
- [Schema Overview](/docs/guide/schema-overview) — Full catalog of all available schema types
- [Component Registry](/docs/guide/component-registry) — How components are registered and resolved
- [Expressions](/docs/guide/expressions) — Dynamic expressions for conditional rendering
- [Building a CRUD App](/docs/guide/building-crud-app) — End-to-end tutorial using schemas in a real project
- [Type Documentation](/docs/api) — Full API reference for `@object-ui/types`
