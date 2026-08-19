# @objectstack/mcp

MCP Runtime Server Plugin for ObjectStack — exposes your app's data objects, business actions, and authored skills over the Model Context Protocol (stdio + Streamable HTTP).

## Features

- **Model Context Protocol (MCP)**: expose an ObjectStack app to any MCP client
- **Object tools**: list / describe / query / aggregate / read / create / update / delete, generated from your metadata
- **Action tools**: invoke the business actions an author opted into the AI surface
- **Resources**: object schemas, records and metadata types as MCP resources
- **Prompts**: authored skills and registered agents project as MCP prompts
- **Two transports**: a long-lived stdio server, and a per-request Streamable HTTP endpoint at `/api/v1/mcp`
- **Security**: every call runs under a real principal — permissions, row-level and field-level security apply, and OAuth scopes narrow the tool families

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

### Environment variables

| Variable | Effect |
|---|---|
| `OS_MCP_SERVER_ENABLED` | HTTP surface, **default-on**. `false` disables it. |
| `OS_MCP_SERVER_NAME` | Override the server name. |
| `OS_MCP_SERVER_TRANSPORT` | Override the transport (`stdio` \| `http`). |
| `OS_MCP_STDIO_ENABLED` | Auto-start the **long-lived stdio** transport (equivalent to the `autoStart` option). |
| `OS_MCP_STDIO_API_KEY` | The identity the stdio server runs as. **Required** whenever stdio auto-starts. |

The stdio transport has its own switch on purpose: starting it claims the
process's stdin/stdout. Setting `OS_MCP_SERVER_ENABLED=true` also starts stdio,
but that path is **deprecated** and logs a warning — use `OS_MCP_STDIO_ENABLED`
or the `autoStart` option.

`OS_MCP_STDIO_API_KEY` is not optional and has no fallback: a stdio server with
no resolvable principal **refuses to start** rather than serving data unscoped
(ADR-0101). Mint a key in Setup → Connect an Agent, or `POST /api/v1/keys`.

The legacy `MCP_SERVER_*` spellings are still honoured with a deprecation
warning.

## The tool surface

There are two independent families, and which one you get depends on how the
server is assembled.

### Object and action tools

Registered from a **data bridge** the host supplies — the surface both
transports serve. Every call runs as the caller (permissions, RLS and FLS
apply):

```typescript
// Object data
'list_objects'         // List objects (system sys_* objects hidden by default)
'describe_object'      // Object schema: fields + features
'validate_expression'  // Check a CEL expression against a schema before authoring it
'query_records'        // Filter / sort / paginate
'aggregate_records'    // count/sum/avg/min/max/count_distinct, optionally grouped
'get_record'           // Fetch one by id
'create_record'        // Create
'update_record'        // Update by id
'delete_record'        // Delete by id (destructive)

// Business actions — operate the app, not just its rows
'list_actions'         // Invokable business actions the caller may run
'run_action'           // Invoke an action by name with { recordId, params }
```

`aggregate_records` is registered only when the bridge implements `aggregate`;
a bridge without that seam serves the rest and advertises nothing it cannot do.

OAuth scopes narrow the families at consent time: `data:read` covers
list/describe/query/aggregate/get, `data:write` covers create/update/delete, and
`actions:execute` covers `list_actions` / `run_action`. A tool outside the grant
is **not registered at all**, so the SDK rejects it as an unknown tool — the
grant doubles as dispatch-time enforcement.

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

### AI-registry tools

If the deployment also runs an AI service that exposes a function-calling
`ToolRegistry`, the plugin bridges every tool in it onto the long-lived server
under the same name, description and JSON Schema. This family is empty on an app
that registers no AI tools, and its absence is reported honestly: no tools
registered means the `tools` capability is not advertised.

## Resources

Registered by the resource bridge, from your metadata:

```
objectstack://objects                                    # List all data objects
objectstack://objects/{objectName}                       # Object schema
objectstack://objects/{objectName}/records/{recordId}     # One record
objectstack://metadata/types                             # List all metadata types
```

The record resource is registered only when the host supplies a record reader;
without one, the schema and listing resources are served alone.

## Prompts

Two prompt families are bridged — there is no per-item prompt registration call:

1. **`agent_prompt`** — one dynamic prompt that loads a registered agent's
   system prompt by name, with optional UI context (`objectName`, `recordId`,
   `viewName`).
2. **One prompt per authored skill** that carries `instructions` (#3905). Write
   a `*.skill.ts`, and its instructions become a prompt any connected MCP client
   can list and fetch.

The skill **list** is a snapshot taken when the bridge runs; each prompt's
**body** is re-read from metadata at `prompts/get` time, so an edited skill
serves fresh text without a restart.

## Extending the server from a host

⚠️ There is **no** imperative `registerTool()` / `registerResource()` /
`registerPrompt()` call on the `'mcp'` service. Tools, resources and prompts are
derived from metadata, and a host that drives the runtime itself contributes
them through the bridge methods and the exported helpers below.

`MCPServerRuntime`'s public surface, as published in `dist/index.d.ts`:

| Member | What it does |
|---|---|
| `new MCPServerRuntime(config?)` | `MCPServerRuntimeConfig`: `name`, `version`, `instructions`, `transport`, `logger`. |
| `server` | The underlying `McpServer` (getter), for advanced use. |
| `isStarted` | Whether a transport is currently connected (getter). |
| `bridgeTools(toolRegistry)` | Bridge an AI service's function-calling `ToolRegistry`. |
| `bridgeDataTools(bridge, toolOptions?)` | Register the object-CRUD tools, plus the action pair when the bridge carries that seam. Returns the tool names registered. |
| `bridgeResources(metadataService, getRecord?)` | Register the `objectstack://` resources. |
| `bridgePrompts(metadataService, mergedRead?)` | Register the agent and skill prompts. |
| `start()` / `stop()` | Attach / detach the configured long-lived transport. |
| `renderSkill(options?)` | Render the portable Agent Skill (`SKILL.md`) for this environment. |
| `handleHttpRequest(request, opts?)` | Serve one Streamable HTTP request (Web-standard `Request`/`Response`). |

Ordering matters: **bridge everything before `start()`**. Registering a tool,
resource or prompt is also what declares its capability, and the MCP SDK refuses
to register capabilities once a transport is attached.

The three helpers the bridges use are exported so a host can drive an
`McpServer` directly:

```typescript
import {
  MCPServerRuntime,
  registerObjectTools,
  registerActionTools,
  registerSkillPrompts,
} from '@objectstack/mcp';
import type { McpDataBridge, McpActionBridge, McpSkillBridge } from '@objectstack/mcp';

// Your host supplies these, bound to the caller's principal.
declare const data: McpDataBridge & McpActionBridge;
declare const skills: McpSkillBridge;

const runtime = new MCPServerRuntime({
  name: 'my-host',
  version: '1.0.0',
  transport: 'stdio',
});

// Either: one call for the whole data surface, returning the names registered.
const registered: string[] = runtime.bridgeDataTools(data, { maxQueryLimit: 200 });

// Or: drive the helpers against the underlying McpServer yourself.
registerObjectTools(runtime.server, data, { allowSystemObjects: false });
registerActionTools(runtime.server, data, { grantedScopes: ['actions:execute'] });
registerSkillPrompts(runtime.server, skills);

await runtime.start();
```

`RegisterObjectToolsOptions` carries `allowSystemObjects`, `maxQueryLimit` and
`grantedScopes`; `RegisterActionToolsOptions` carries `allowSystemObjects` and
`grantedScopes`. `McpDataBridge` is the data seam (`listObjects`,
`describeObject`, `query`, `get`, `create`, `update`, `remove`, and the optional
`aggregate` / `listObjectsDiagnosed`); `McpActionBridge` adds `listActions` and
`runAction`; `McpSkillBridge` is a single `listSkills`.

Also exported for hosts that render the skill surface themselves:
`renderSkillMarkdown`, `listSkillPrompts`, `projectSkillPrompt`,
`skillPromptResult`, `OBJECTSTACK_SKILL_NAME`, `OBJECTSTACK_SKILL_DESCRIPTION`,
and the Setup page metadata `CONNECT_AGENT_PAGE` / `CONNECT_AGENT_UI_BUNDLE`.

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

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`. The
stdio transport needs both of its switches — the enable flag and the identity it
runs as:

```json
{
  "mcpServers": {
    "objectstack": {
      "command": "node",
      "args": ["/path/to/your/objectstack/server.js"],
      "env": {
        "DATABASE_URL": "your-database-url",
        "OS_MCP_STDIO_ENABLED": "true",
        "OS_MCP_STDIO_API_KEY": "osk_..."
      }
    }
  }
}
```

### Cursor IDE

Add to `.cursor/mcp.json` (same two environment variables apply):

```json
{
  "mcpServers": {
    "objectstack": {
      "command": "node",
      "args": ["./server.js"],
      "env": {
        "OS_MCP_STDIO_ENABLED": "true",
        "OS_MCP_STDIO_API_KEY": "osk_..."
      }
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
      "args": ["./server.js"],
      "env": {
        "OS_MCP_STDIO_ENABLED": "true",
        "OS_MCP_STDIO_API_KEY": "osk_..."
      }
    }
  }
}
```

## Server Implementation

### Stdio Transport

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
metadata definition; the CLI boots the kernel from it. With `autoStart: true`
you must also set `OS_MCP_STDIO_API_KEY`, or boot fails closed.

### HTTP Transport (default)

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

## Server capabilities

The server does **not** hand-declare a capability set. Capabilities are derived
from what was actually registered, because the SDK's registration call installs
the handler and declares the capability together — so there is no way to
advertise a primitive this server cannot serve (ADR-0076 D12).

In practice: `tools` appears once a tool is registered, `resources` once a
resource is, `prompts` once the skill/agent bridge runs. `logging` is the one
hand-declared entry, and it is honest — declaring it is itself what wires the
`logging/setLevel` handler.

There is no `subscribe`, no `listChanged` and no streaming capability. An app
with no bridged tools advertises no `tools` capability, which is the honest
report rather than an empty promise.

## Best practices

1. **Model the app, not the transport** — tools come from your objects and
   actions, so the lever that shapes the AI surface is your metadata.
2. **Opt actions in deliberately** — `ai: { exposed: true }` is a security
   decision; an invoked action body runs as trusted app code.
3. **Scope the grant** — hand `grantedScopes` the narrowest set the client
   needs; an ungranted tool is never registered.
4. **Cap the reads** — `maxQueryLimit` bounds what one `query_records` call can
   pull.
5. **Prefer `aggregate_records` over paging** — a question about totals should
   not walk every row.
6. **Bridge before `start()`** — capabilities cannot be declared once a
   transport is attached.

## Debugging

The plugin logs through the kernel logger — there is no `debug` option. The
MCP surface is controlled by the environment variables listed under
[Configuration](#environment-variables):

```bash
OS_MCP_SERVER_ENABLED=false     # opt the HTTP surface out (it is on by default)
OS_MCP_SERVER_NAME=my-crm       # override the server name
OS_MCP_SERVER_TRANSPORT=http    # override the transport
OS_MCP_STDIO_ENABLED=true       # auto-start the long-lived stdio transport
OS_MCP_STDIO_API_KEY=osk_...    # required identity for that transport
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
- [@objectstack/spec AI metadata](../spec/src/ai/)
