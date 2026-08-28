# @objectstack/spec

[![Try Online](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/objectstack-ai/objectstack/tree/main/examples/app-todo?file=objectstack.config.ts)

The **Source of Truth** for the ObjectStack Protocol. Contains strictly typed Zod schemas that define every aspect of the system.

## Protocols

- **System**: Manifests, Datasources, APIs.
- **Data**: Objects, Fields, Validation Rules.
- **UI**: Views, Layouts, Dashboards.
- **Automation**: Flows, Workflows, Triggers.
- **AI**: Agents, RAG Pipelines, Models, MCP Servers.

## Export surfaces

The package publishes one entry per protocol domain (`@objectstack/spec/data`,
`/ui`, `/kernel`, …) plus fine-grained vocabulary entries
(`@objectstack/spec/meta-spelling` — the `/meta/:type` URL-spelling contract
and the `defineStack()` manifest-collection vocabulary, two deliberately
distinct maps per objectstack#8424).
Each entry is a self-contained bundle: what an entry's module graph reaches is
what every consumer of that entry pays for.

**Standing principle** (maintainer ruling 2026-08-20, recorded verbatim on
objectstack#10096):

> **浏览器可达的 spec 导出面必须 schema-free。** A `@objectstack/spec` export
> surface that browser/client consumers reach must carry vocabulary — maps,
> folds, enums, pure predicates — without linking the zod schema/validation
> machinery. The schema graph is the server/publish side's dependency, never
> the price of spelling a URL segment or reading a posture predicate.

Adding an export that browser/client code will import? Either place it on a
schema-free entry (`/meta-spelling` is the reference pattern: derivation from
the schema graph happens at build time via `gen:meta-url-spelling`, gated by
`check:meta-url-spelling`), or verify the entry it lands on keeps a
schema-free module graph. The package declares `sideEffects: false`, so
bundlers may drop what a consumer does not reach — module-scope side effects
in any published module are therefore also a defect (measured, not assumed;
see objectstack#10031).

**Node-only imports are refused everywhere a browser bundler resolves**
(#11072). Every entry is loadable from a browser build by construction —
schema-bearing entries included — so no published bundle may link a Node
builtin or a server-only package. The one sanctioned exception is the
pg-grammar arm of the postgres `url` refinement (`pg-connection-string`, whose
`parse` statically resolves `require('fs')`): the entries that reach it carry a
`browser` export condition pointing at `dist/browser/**` bundles in which that
arm is swapped for a dependency-free twin (`src/data/driver/pg-url-grammar.*`,
`tsup.config.ts` → `swapServerOnlyGrammarArm`), and Node consumers keep the
full DSN refusal unchanged. `check:browser-reachable-entries` enforces both
halves — a browser-conditioned bundle that still links the parser, and a
non-conditioned bundle that links anything Node-only, are each a red — with a
positive control on the Node side. Need Node-only work in a schema? Route it
through a seam module the browser pass swaps, never import it directly.

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
