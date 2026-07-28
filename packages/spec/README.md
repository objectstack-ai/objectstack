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

Define MCP servers to connect AI agents to your ObjectStack data and tools:

```typescript
import { MCPServerConfigSchema } from '@objectstack/spec/ai';

// Define an MCP server exposing ObjectStack data
export const objectStackMCP = MCPServerConfigSchema.parse({
  name: 'objectstack_mcp',
  label: 'ObjectStack MCP Server',
  description: 'Connects AI agents to ObjectStack data and workflows',
  
  serverInfo: {
    name: 'ObjectStack MCP',
    version: '1.0.0',
    capabilities: {
      resources: true,
      resourceTemplates: true,
      tools: true,
      prompts: true,
    },
  },
  
  transport: {
    type: 'http',
    url: 'https://api.objectstack.ai/mcp',
    auth: {
      type: 'bearer',
      secretRef: 'system:mcp_api_key',
    },
  },
  
  // Expose data as resources
  resourceTemplates: [
    {
      uriPattern: 'objectstack://objects/{objectName}',
      name: 'Object Data',
      description: 'Access object records',
      parameters: [
        {
          name: 'objectName',
          type: 'string',
          required: true,
          description: 'Name of the object to access',
        },
      ],
      handler: 'resources.getObjectData',
    },
  ],
  
  // Expose workflows as tools
  tools: [
    {
      name: 'create_record',
      description: 'Create a new record in any object',
      parameters: [
        {
          name: 'object',
          type: 'string',
          description: 'Object name (e.g., "account", "contact")',
          required: true,
        },
        {
          name: 'data',
          type: 'object',
          description: 'Record data as key-value pairs',
          required: true,
        },
      ],
      handler: 'flows.create_record',
      sideEffects: 'write',
      // NOTE: declarative only — nothing pauses on this flag (#3715). A real
      // human-in-the-loop gate is `ai.requiresConfirmation` on the underlying
      // action (+ the approval queue), or `approval: 'always'` on an MCP binding.
      requiresConfirmation: true,
    },
    {
      name: 'search_records',
      description: 'Search for records using natural language or filters',
      parameters: [
        {
          name: 'object',
          type: 'string',
          description: 'Object to search in',
          required: true,
        },
        {
          name: 'query',
          type: 'string',
          description: 'Search query',
          required: true,
        },
      ],
      handler: 'data.search',
      sideEffects: 'read',
    },
  ],
  
  // Provide prompt templates
  prompts: [
    {
      name: 'analyze_customer_data',
      description: 'Analyze customer data and generate insights',
      messages: [
        {
          role: 'system',
          content: 'You are a data analyst specializing in customer insights.',
        },
        {
          role: 'user',
          content: 'Analyze the following customer data and provide insights: {{customer_data}}',
        },
      ],
      arguments: [
        {
          name: 'customer_data',
          type: 'string',
          required: true,
          description: 'Customer data in JSON format',
        },
      ],
    },
  ],
  
  autoStart: true,
  healthCheck: {
    enabled: true,
    interval: 60000,
  },
});
```
