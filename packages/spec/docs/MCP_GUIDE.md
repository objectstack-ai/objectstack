# MCP (Model Context Protocol) Integration Guide

## Overview

The Model Context Protocol (MCP) is a standardized protocol for connecting AI assistants to external tools, data sources, and resources. ObjectStack implements MCP to enable seamless integration between AI agents and business data, workflows, and services.

## Core Concepts

### 1. MCP Server

An MCP server is a service endpoint that exposes capabilities to AI agents. Each server can provide:

- **Resources**: Contextual information (data, documents, records)
- **Tools**: Callable functions and operations
- **Prompts**: Predefined prompt templates

### 2. Transport

Multiple transport protocols are supported:

- **stdio**: Standard input/output (local processes)
- **http**: HTTP REST API
- **websocket**: Bidirectional WebSocket communication
- **grpc**: High-performance gRPC communication

### 3. Capabilities

MCP servers declare their supported features:

- `resources`: Supports resource listing and retrieval
- `resourceTemplates`: Supports dynamic resource templates
- `tools`: Supports tool/function calling
- `prompts`: Supports prompt templates
- `sampling`: Supports LLM sampling
- `logging`: Supports logging and debugging

## Quick Start

### Define an MCP Server

```typescript
import { MCPServerConfigSchema } from '@objectstack/spec/ai';

export const objectStackMCP = MCPServerConfigSchema.parse({
  // Server Identity
  name: 'objectstack_mcp',
  label: 'ObjectStack MCP Server',
  description: 'Connects AI agents to ObjectStack data and workflows',
  
  // Server Info
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
  
  // Transport Configuration
  transport: {
    type: 'http',
    url: 'https://api.objectstack.ai/mcp',
    auth: {
      type: 'bearer',
      secretRef: 'system:mcp_api_key',
    },
  },
  
  // Expose business data as resources
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
  
  // Expose business operations as tools
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
      requiresConfirmation: true,
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
});
```

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌──────────────┐
│ AI Agent    │ ◄─MCP──►│ MCP Server  │ ◄─────► │ ObjectStack  │
│             │         │             │         │ Data & Logic │
└─────────────┘         └─────────────┘         └──────────────┘
     │                        │
     │                        ├─ Resources (Data)
     │                        ├─ Tools (Actions)
     │                        └─ Prompts (Templates)
     │
     └─ Uses resources & tools to accomplish tasks
```

## Use Cases

### 1. Expose ObjectStack Objects as MCP Resources

Make your business data accessible to AI agents:

```typescript
const resourceTemplates = [
  {
    uriPattern: 'objectstack://objects/{objectName}/{recordId}',
    name: 'Object Record Detail',
    description: 'Get a single record from a specific object',
    parameters: [
      {
        name: 'objectName',
        type: 'string',
        required: true,
        description: 'Object name (e.g., account, contact, task)',
      },
      {
        name: 'recordId',
        type: 'string',
        required: true,
        description: 'Record ID',
      },
    ],
    handler: 'resources.getRecordDetail',
    mimeType: 'application/json',
    resourceType: 'json',
  },
];
```

### 2. Expose Business Logic as MCP Tools

Enable AI agents to execute business operations:

```typescript
const tools = [
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
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results',
        default: 10,
        minimum: 1,
        maximum: 100,
      },
    ],
    handler: 'data.search',
    sideEffects: 'read',
  },
  
  {
    name: 'trigger_workflow',
    description: 'Trigger a business workflow',
    parameters: [
      {
        name: 'workflow_name',
        type: 'string',
        description: 'Workflow to trigger',
        required: true,
      },
      {
        name: 'context_data',
        type: 'object',
        description: 'Context data for the workflow',
        required: true,
      },
    ],
    handler: 'workflows.trigger',
    sideEffects: 'write',
    requiresConfirmation: true,
  },
];
```

### 3. Provide Domain-Specific Prompt Templates

Create specialized prompts for common business tasks:

```typescript
const prompts = [
  {
    name: 'analyze_sales_pipeline',
    description: 'Analyze sales pipeline and provide recommendations',
    messages: [
      {
        role: 'system',
        content: 'You are a sales analytics expert.',
      },
      {
        role: 'user',
        content: `Analyze the following sales pipeline data:
Pipeline: {{pipeline_data}}
Time Period: {{time_period}}

Provide:
1. Current pipeline health
2. Conversion rate analysis
3. Bottleneck identification
4. Recommended actions`,
      },
    ],
    arguments: [
      {
        name: 'pipeline_data',
        type: 'string',
        required: true,
        description: 'Sales pipeline data in JSON format',
      },
      {
        name: 'time_period',
        type: 'string',
        required: true,
        description: 'Time period for analysis',
      },
    ],
    category: 'sales',
  },
];
```

## Integration with AI Agents

### Using MCP Tools in an Agent

```typescript
import { AgentSchema } from '@objectstack/spec/ai';

export const salesAgent = AgentSchema.parse({
  name: 'sales_assistant',
  label: 'Sales Assistant',
  role: 'Sales Support Agent',
  instructions: 'You help sales team with customer data and pipeline management.',
  
  model: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.3,
  },
  
  // Reference MCP tools
  tools: [
    {
      type: 'action',
      name: 'search_records',
      description: 'Search for customer records',
    },
    {
      type: 'flow',
      name: 'create_opportunity',
      description: 'Create a new sales opportunity',
    },
  ],
  
  knowledge: {
    topics: ['sales_playbook', 'product_catalog'],
    indexes: ['sales_knowledge_base'],
  },
});
```

## Best Practices

### 1. Tool Naming

- Use `snake_case` naming
- Start with verbs (`create_`, `update_`, `search_`, `trigger_`)
- Make names descriptive and clear

### 2. Parameter Design

- Provide detailed descriptions to help AI understand usage
- Use appropriate types and validation rules
- Provide sensible defaults
- Use `enum` to constrain valid values

### 3. Side Effects

- `none`: No side effects (pure queries)
- `read`: Read-only operations
- `write`: Modifies data
- `delete`: Deletes data

For operations with side effects, gate them with something that is enforced:
`approval: 'always'` on the MCP tool binding, or `ai.requiresConfirmation` on
the underlying **action** (+ the HITL approval queue).

> ⚠️ `requiresConfirmation` on the **tool definition** is declared but read by
> no execution path — it produces no pause (#3715).

### 4. Security

1. Use authentication (Bearer Token, API Key)
2. Implement access control (`allowedAgents`, `allowedUsers`)
3. Enable rate limiting (`rateLimit`)
4. Use HTTPS transport
5. Rotate keys regularly

### 5. Performance

- Use resource caching (`cacheable: true`)
- Set reasonable `cacheMaxAge`
- Implement rate limiting
- Monitor and log performance metrics

## Advanced Configuration

### Transport Examples

#### HTTP Transport
```typescript
{
  type: 'http',
  url: 'https://api.objectstack.ai/mcp',
  auth: {
    type: 'bearer',
    secretRef: 'system:mcp_api_key',
  },
  timeout: 30000,
  retryAttempts: 3,
}
```

#### WebSocket Transport
```typescript
{
  type: 'websocket',
  url: 'wss://api.objectstack.ai/mcp',
  auth: {
    type: 'bearer',
    token: 'your-token',
  },
  timeout: 60000,
}
```

#### stdio Transport
```typescript
{
  type: 'stdio',
  command: 'node',
  args: ['./mcp-server.js'],
  env: {
    NODE_ENV: 'production',
  },
}
```

### Health Checks

```typescript
{
  healthCheck: {
    enabled: true,
    interval: 60000,
    timeout: 5000,
    endpoint: '/health',
  },
  autoStart: true,
  restartOnFailure: true,
}
```

### Access Control

```typescript
{
  permissions: {
    allowedAgents: ['support_agent', 'sales_agent'],
    allowedUsers: ['admin@example.com'],
    requireAuth: true,
  },
  rateLimit: {
    enabled: true,
    requestsPerMinute: 100,
    requestsPerHour: 5000,
  },
}
```

## Reference

- [Model Context Protocol Official Docs](https://modelcontextprotocol.io)
- [ObjectStack Agent Configuration](./agent.zod.ts)
- [ObjectStack API Protocol](../api/protocol.zod.ts)
