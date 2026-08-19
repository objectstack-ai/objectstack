# @objectstack/spec

[![Try Online](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/objectstack-ai/spec/tree/main/examples/app-todo?file=objectstack.config.ts)

The **Source of Truth** for the ObjectStack Protocol. Contains strictly typed Zod schemas that define every aspect of the system.

## Protocols

- **System**: Manifests, Datasources, APIs.
- **Data**: Objects, Fields, Validation Rules.
- **UI**: Views, Layouts, Dashboards.
- **Automation**: Flows, Workflows, Triggers.
- **AI**: Agents, RAG Pipelines, Models, MCP Servers.

## Usage

**Recommended: Use `ObjectSchema.create()` with `Field.*` helpers for strict TypeScript validation:**

```typescript
import { ObjectSchema, Field } from '@objectstack/spec/data';

// Create a validated object definition with type checking
export const Task = ObjectSchema.create({
  name: 'task',
  label: 'Task',
  icon: 'check-square',
  
  fields: {
    title: Field.text({
      label: 'Title',
      required: true,
      maxLength: 200,
    }),
    
    status: Field.select({
      label: 'Status',
      options: [
        { label: 'To Do', value: 'todo', default: true },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Done', value: 'done' },
      ],
    }),
  },
  
  enable: {
    trackHistory: true,
    apiEnabled: true,
  },
});
```

**Alternative: Runtime validation of existing objects:**

```typescript
import { ObjectSchema } from '@objectstack/spec/data';

// Validate a JSON object against the schema
const result = ObjectSchema.parse(myObjectDefinition);
if (result.success) {
  console.log('Valid object:', result.data);
}
```

## MCP (Model Context Protocol) Integration

Declare the MCP servers your agents may reach. `MCPServerRefSchema` is a
**reference** to a server — where it lives and how to authenticate — not a
description of what it serves:

```typescript
import { MCPServerRefSchema } from '@objectstack/spec/ai';

// A reference to an MCP server an agent may call
export const objectStackMCP = MCPServerRefSchema.parse({
  name: 'objectstack_mcp',
  label: 'ObjectStack MCP Server',
  transport: 'http',                      // 'stdio' | 'http' | 'websocket'
  endpoint: 'https://api.objectstack.ai/mcp',
  secretRef: 'system:mcp_api_key',        // optional
  active: true,                           // defaults to true
});
```

The tools, resources and prompts an ObjectStack server exposes are **not
authored here** — they are derived from your metadata at runtime by the
`MCPServerPlugin` in `@objectstack/mcp`, which bridges the metadata and data
engines to any connected MCP client.
