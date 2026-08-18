# @objectstack/mcp

MCP Runtime Server Plugin for ObjectStack — exposes AI tools, data resources, and agent prompts via the Model Context Protocol.

## Features

- **Model Context Protocol (MCP)**: Expose ObjectStack resources to AI models via MCP
- **AI Tools**: Auto-generate MCP tools from ObjectStack actions and flows
- **Data Resources**: Expose objects, records, and metadata as MCP resources
- **Agent Prompts**: Register prompt templates for AI agents
- **Type-Safe**: Full Zod schema validation for tool inputs/outputs
- **Auto-Discovery**: MCP clients automatically discover available tools and resources
- **Streaming Support**: Stream large datasets and real-time updates
- **Security**: Built-in permission checks for tool execution

## What is MCP?

Model Context Protocol (MCP) is an open protocol that standardizes how AI applications provide context to Large Language Models (LLMs). It allows AI models to:

- **Access Tools**: Execute functions and operations
- **Read Resources**: Access data and content
- **Use Prompts**: Leverage pre-defined prompt templates

Read more: [MCP Specification](https://modelcontextprotocol.io/)

## Installation

```bash
pnpm add @objectstack/mcp
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { MCPServerPlugin } from '@objectstack/mcp';

const stack = defineStack({
  plugins: [
    new MCPServerPlugin({
      name: 'objectstack-server',
      version: '1.0.0',
    }),
  ],
});
```

## Configuration

The constructor takes `MCPServerPluginOptions`:

```typescript
interface MCPServerPluginOptions {
  /** Override MCP server name. Defaults to 'objectstack'. */
  name?: string;

  /** Override MCP server version. Defaults to package version. */
  version?: string;

  /** Transport mode: 'stdio' (default). */
  transport?: 'stdio' | 'http';

  /** Whether to auto-start the MCP server. Defaults to false. */
  autoStart?: boolean;

  /** Custom instructions for the MCP server. */
  instructions?: string;
}
```

Tools and resources are **not** opted into per-option — the plugin bridges the
AI tool registry, metadata service and data engine automatically when it
starts. The HTTP surface needs no start at all: it is served per-request at
`/api/v1/mcp` (default-on; `OS_MCP_SERVER_ENABLED=false` opts out).

Environment overrides: `OS_MCP_SERVER_NAME`, `OS_MCP_SERVER_TRANSPORT`,
`OS_MCP_SERVER_ENABLED`.

## MCP Tools

### Auto-Generated Tools

ObjectStack automatically exposes these operations as MCP tools:

```typescript
// CRUD operations (auto-registered)
'objectstack_find'         // Query records
'objectstack_findOne'      // Get single record
'objectstack_create'       // Create record
'objectstack_update'       // Update record
'objectstack_delete'       // Delete record

// Metadata operations
'objectstack_describeObject'   // Get object schema
'objectstack_listObjects'      // List all objects
'objectstack_listFields'       // List object fields
```

### Native Tools (Streamable HTTP)

Over the network-reachable Streamable HTTP transport, the server self-registers
a native tool set bound to the **caller's principal** (the API key acts as the
user, with full row-level security + permission enforcement). No
`@objectstack/service-ai` and no cloud studio are required — these are part of
the open framework.

```typescript
// Object data (RLS-enforced as the caller)
'list_objects'      // List objects (system sys_* objects hidden by default)
'describe_object'   // Object schema: fields + features
'validate_expression' // Check a CEL expression against a schema before authoring it
'query_records'     // Filter / sort / paginate
'get_record'        // Fetch one by id
'create_record' / 'update_record' / 'delete_record'

// Business actions — operate the app, not just its rows
'list_actions'      // Invokable business actions the caller may run
'run_action'        // Invoke an action by name with { recordId, params }
```

`list_actions` enumerates each object's headless-invokable actions (script /
flow), filtered to what the author exposed and the caller may run: only actions
opted into the AI surface (`ai: { exposed: true }`, ADR-0011 / #2849) are
listed, declared `requiredPermissions` (ADR-0066 D4) are enforced, and
`sys_*`-object actions are held back fail-closed. `run_action` resolves the
action by name and dispatches it through the framework's own action mechanism
(`engine.executeAction` / automation flow runner), so a BYO-AI MCP client
(Claude Code, Cursor, …) can trigger real business logic — e.g. "complete this
task", "convert this lead".

> **Security model (#2849):** gating happens at *invoke* time (`ai.exposed` +
> capability gate + record-context loads under the caller's RLS). Once invoked,
> a script/body action executes as **trusted application code** — its internal
> reads/writes carry the app's full data authority and are *not* bounded by the
> caller's RLS/FLS. Expose an action to AI only when its body is safe to run on
> behalf of anyone allowed through the gate. Flow actions honour the flow's
> `runAs` declaration (ADR-0049) with the caller's identity forwarded.

### Custom Tools

Register custom tools that AI models can call:

```typescript
import { defineTool } from '@objectstack/spec';

const calculateRevenueTool = defineTool({
  name: 'calculate_revenue',
  description: 'Calculate total revenue for an account',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Account ID' },
      startDate: { type: 'string', description: 'Start date (ISO 8601)' },
      endDate: { type: 'string', description: 'End date (ISO 8601)' },
    },
    required: ['accountId'],
  },
  async execute({ accountId, startDate, endDate }) {
    const opportunities = await kernel.getDriver().find({
      object: 'opportunity',
      filters: [
        { field: 'account_id', operator: 'eq', value: accountId },
        { field: 'stage', operator: 'eq', value: 'closed_won' },
        { field: 'close_date', operator: 'gte', value: startDate },
        { field: 'close_date', operator: 'lte', value: endDate },
      ],
    });

    const total = opportunities.reduce((sum, opp) => sum + opp.amount, 0);

    return {
      accountId,
      totalRevenue: total,
      opportunityCount: opportunities.length,
    };
  },
});

// Register with MCP server
kernel.getService('mcp').registerTool(calculateRevenueTool);
```

## MCP Resources

### Auto-Exposed Objects

All ObjectStack objects are automatically exposed as MCP resources:

```
objectstack://objects/opportunity           # Opportunity object schema
objectstack://objects/opportunity/records   # All opportunity records
objectstack://objects/opportunity/123       # Specific opportunity record
```

### Custom Resources

Expose custom resources to AI models:

```typescript
kernel.getService('mcp').registerResource({
  uri: 'objectstack://reports/sales-pipeline',
  name: 'Sales Pipeline Report',
  description: 'Current sales pipeline with stages and amounts',
  mimeType: 'application/json',
  async read() {
    const opportunities = await kernel.getDriver().find({
      object: 'opportunity',
      filters: [
        { field: 'stage', operator: 'neq', value: 'closed_won' },
        { field: 'stage', operator: 'neq', value: 'closed_lost' },
      ],
    });

    const pipeline = opportunities.reduce((acc, opp) => {
      acc[opp.stage] = (acc[opp.stage] || 0) + opp.amount;
      return acc;
    }, {});

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(pipeline, null, 2),
        },
      ],
    };
  },
});
```

## MCP Prompts

Register prompt templates that AI models can use:

```typescript
kernel.getService('mcp').registerPrompt({
  name: 'analyze_account',
  description: 'Analyze an account and its opportunities',
  arguments: [
    {
      name: 'accountId',
      description: 'Account ID to analyze',
      required: true,
    },
  ],
  async render({ accountId }) {
    const account = await kernel.getDriver().findOne({
      object: 'account',
      filters: [{ field: 'id', operator: 'eq', value: accountId }],
    });

    const opportunities = await kernel.getDriver().find({
      object: 'opportunity',
      filters: [{ field: 'account_id', operator: 'eq', value: accountId }],
    });

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze this account and provide insights:

Account: ${account.name}
Industry: ${account.industry}
Total Opportunities: ${opportunities.length}
Total Value: $${opportunities.reduce((sum, o) => sum + o.amount, 0)}

Opportunities:
${opportunities.map(o => `- ${o.name} (${o.stage}): $${o.amount}`).join('\n')}

Please provide:
1. Key insights about this account
2. Risk assessment
3. Recommendations for next steps`,
          },
        },
      ],
    };
  },
});
```

## Using with AI Clients

### Connecting to a running deployment (remote HTTP)

A running ObjectStack deployment serves MCP over Streamable HTTP at
`/api/v1/mcp` by default (set `OS_MCP_SERVER_ENABLED=false` to opt out). Two
authentication tracks:

**OAuth 2.1 — the human-client track (recommended).** Each deployment is its
own spec-compliant authorization server (backed by the embedded better-auth
instance): it serves `.well-known/oauth-protected-resource` and
`.well-known/oauth-authorization-server` discovery metadata, supports Dynamic
Client Registration (RFC 7591) and the authorization-code + PKCE flow. Any
OAuth-capable MCP client connects self-serve — no admin-minted credentials,
no central registry; you log in through the browser as yourself and every
tool call runs under **your** permissions and row-level security.

```bash
# Claude Code
claude mcp add --transport http objectstack https://your-deployment.example.com/api/v1/mcp
# then approve the browser login on first use

# claude.ai — Settings → Connectors → Add custom connector → paste the MCP URL
# (requires the deployment to be reachable from the public internet over HTTPS)

# Claude Desktop — Settings → Connectors → Add custom connector
```

TLS is required for OAuth (localhost is exempt, per OAuth 2.1). Local clients
(Claude Code / Desktop) can reach intranet deployments; claude.ai web
connectors additionally need the endpoint publicly reachable. Coarse scopes
(`data:read`, `data:write`, `actions:execute`) narrow the exposed tool
families at consent time; permissions/RLS bind every *object CRUD* call to the
logged-in user. Business actions are the exception: `actions:execute` gates
*which* actions may be invoked (author AI opt-in + capabilities), but an
invoked action's body runs as trusted app code, not under the caller's RLS
(#2849).

**API key — the headless track (CI, scripts, background agents).** Mint a key
(`POST /api/v1/keys`, shown once) and send it as a header — no browser
involved, unchanged from before:

```json
{
  "mcpServers": {
    "objectstack": {
      "type": "http",
      "url": "https://your-deployment.example.com/api/v1/mcp",
      "headers": { "x-api-key": "osk_..." }
    }
  }
}
```

(`Authorization: ApiKey <key>` and `Authorization: Bearer <osk_-prefixed key>`
are also accepted.)

### Claude Desktop (local stdio server)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "objectstack": {
      "command": "node",
      "args": ["/path/to/your/objectstack/server.js"],
      "env": {
        "DATABASE_URL": "your-database-url"
      }
    }
  }
}
```

### Cursor IDE

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "objectstack": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

### Cline VS Code Extension

Configure in Cline settings:

```json
{
  "cline.mcpServers": {
    "objectstack": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

## Server Implementation

### Stdio Transport (Default)

```typescript
// objectstack.config.ts
import { defineStack } from '@objectstack/spec';
import { defineDatasource } from '@objectstack/spec/data';
import { MCPServerPlugin } from '@objectstack/mcp';

export default defineStack({
  manifest: {
    id: 'com.example.crm',
    namespace: 'crm',
    version: '0.1.0',
    type: 'app',
    name: 'My CRM',
    engines: { protocol: '^17' },
  },
  // Optional: the CLI already anchors a persistent SQLite database at
  // `<project>/.objectstack/data/standalone.db`. Declare a datasource only
  // to point somewhere else.
  datasources: [
    defineDatasource({
      name: 'primary',
      label: 'Primary',
      driver: 'sqlite',
      config: { filename: '.objectstack/data/app.db' },
    }),
  ],
  plugins: [
    new MCPServerPlugin({
      name: 'my-crm',
      transport: 'stdio', // Claude Desktop, Cursor, Cline
      autoStart: true,    // stdio is a long-lived transport, so start it
    }),
  ],
});
```

Run it with the CLI (`os dev` / `os serve`) — `defineStack()` returns the
metadata definition; the CLI boots the kernel from it.

### HTTP Transport

```typescript
export default defineStack({
  manifest: { /* ... */ },
  plugins: [
    new MCPServerPlugin({
      name: 'my-crm',
      transport: 'http',
    }),
  ],
});
// Served per-request by the running server at /api/v1/mcp
```

## Advanced Features

### Streaming Resources

```typescript
kernel.getService('mcp').registerResource({
  uri: 'objectstack://exports/opportunities-csv',
  name: 'Opportunities Export (CSV)',
  mimeType: 'text/csv',
  async *stream() {
    // Stream header
    yield 'Name,Stage,Amount,Close Date\n';

    // Stream records in batches
    let offset = 0;
    const batchSize = 100;

    while (true) {
      const batch = await kernel.getDriver().find({
        object: 'opportunity',
        limit: batchSize,
        offset,
      });

      if (batch.length === 0) break;

      for (const opp of batch) {
        yield `${opp.name},${opp.stage},${opp.amount},${opp.close_date}\n`;
      }

      offset += batchSize;
    }
  },
});
```

### Tool Permissions

```typescript
kernel.getService('mcp').registerTool({
  name: 'delete_opportunity',
  description: 'Delete an opportunity',
  permissions: ['opportunity:delete'], // Require permission
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
  },
  async execute({ id }, context) {
    // context includes userId, permissions, etc.
    if (!context.hasPermission('opportunity:delete')) {
      throw new Error('Permission denied');
    }

    await kernel.getDriver().delete({
      object: 'opportunity',
      filters: [{ field: 'id', operator: 'eq', value: id }],
    });

    return { success: true, deleted: id };
  },
});
```

### Dynamic Tool Registration

```typescript
// Register tools from flow definitions
const flows = await kernel.getMetadata('flow');

for (const flow of flows) {
  kernel.getService('mcp').registerTool({
    name: `flow_${flow.name}`,
    description: flow.description,
    inputSchema: generateSchemaFromFlow(flow),
    async execute(inputs) {
      return await kernel.executeFlow(flow.name, inputs);
    },
  });
}
```

## Server Capabilities

The MCP server exposes these capabilities:

```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    },
    "resources": {
      "subscribe": true,
      "listChanged": true
    },
    "prompts": {
      "listChanged": true
    },
    "logging": {},
    "experimental": {
      "streaming": true
    }
  }
}
```

## Best Practices

1. **Tool Design**: Keep tools focused and well-documented
2. **Resource Naming**: Use clear, hierarchical URI schemes
3. **Prompt Templates**: Make prompts flexible with arguments
4. **Error Handling**: Always return helpful error messages
5. **Permissions**: Check permissions before tool execution
6. **Performance**: Use streaming for large datasets
7. **Versioning**: Version your server and tools

## Debugging

The plugin logs through the kernel logger — there is no `debug` option. The
MCP surface is controlled by environment variables:

```bash
OS_MCP_SERVER_ENABLED=true   # explicit true also auto-starts the stdio transport
OS_MCP_SERVER_NAME=my-crm    # override the server name
OS_MCP_SERVER_TRANSPORT=http # override the transport
```

View MCP messages in client:
- **Claude Desktop**: Check logs in `~/Library/Logs/Claude/mcp*.log`
- **Cursor**: Check Output panel → MCP Server
- **Cline**: Check extension logs

## Example: Complete CRM Server

```typescript
// objectstack.config.ts
import { defineStack } from '@objectstack/spec';
import { MCPServerPlugin } from '@objectstack/mcp';

import * as objects from './src/objects/index.js';
import { allActions } from './src/actions/index.js';

export default defineStack({
  manifest: {
    id: 'com.example.crm',
    namespace: 'crm',
    version: '0.1.0',
    type: 'app',
    name: 'CRM Assistant',
    engines: { protocol: '^17' },
  },
  objects: Object.values(objects),
  // Your actions become MCP tools — the plugin bridges them at start.
  actions: allActions,
  plugins: [new MCPServerPlugin({ name: 'crm-assistant' })],
});
```

There is no imperative "register a tool" call to make: the plugin derives the
tool set from your metadata. The bridging helpers it uses —
`registerObjectTools`, `registerActionTools` and `registerSkillPrompts` — are
exported for hosts that drive an `MCPServerRuntime` directly.

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).

## See Also

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [@objectstack/spec/ai](../../spec/src/ai/)
