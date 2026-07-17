---
name: objectstack-platform
description: >
  Bootstrap, configure, extend, and operate ObjectStack runtimes. Covers
  project setup (`defineStack`, drivers, adapters, scaffolding), plugin and
  service development (PluginContext, DI, kernel hooks like `kernel:ready`
  and `data:*`), and operations (CLI commands, migrations, deployment, test
  harnesses via LiteKernel). Use when the user is writing
  `objectstack.config.ts`, building a plugin or driver, wiring a framework
  adapter, running `os` CLI commands, or planning deployment. Do not use for
  data schema design (see objectstack-data) or query patterns (see
  objectstack-query); data lifecycle hooks (beforeInsert / afterUpdate)
  belong in objectstack-data — only kernel / service-level events live here.
license: Apache-2.0
compatibility: Requires @objectstack/spec v4+, @objectstack/core v4+, Node 18+, pnpm 8+
metadata:
  author: objectstack-ai
  version: "1.1"
  domain: platform
  tags: project, defineStack, driver, adapter, plugin, kernel, service, DI, lifecycle, cli, deploy, ops
---

# Platform — ObjectStack Bootstrap & Plugin System

Expert instructions for two related concerns:

1. **Project setup** — scaffolding new projects, writing
   `objectstack.config.ts`, picking drivers and adapters, the runtime boot
   sequence (the original "quickstart" skill).
2. **Plugin development** — building plugins, registering services,
   wiring kernel hook / event handlers, working with `ObjectKernel` vs
   `LiteKernel` (the original "plugin" skill).

Both areas share the same `defineStack()` / kernel surface, which is why
they live in one skill.

---

## When to Use This Skill

- Creating a **new ObjectStack project** from scratch.
- Choosing the right **project template** (minimal-api, full-stack, plugin).
- Writing or modifying **`objectstack.config.ts`** (`defineStack()` config).
- Selecting a **database driver** (Memory, SQL, Turso).
- Integrating with a **web framework** (Hono, Express, Fastify, Next.js, etc.).
- Understanding the **runtime boot sequence** and plugin loading order.
- Setting up **multi-app composition** with `composeStacks()`.
- Answering **"how do I get started?"** questions.

---

## Decision Tree: Choosing a Template

```
What are you building?
│
├── A simple REST API or backend service?
│   └── ✅ minimal-api
│       • 1 object, REST endpoints, in-memory driver
│       • Fastest path to a running API
│
├── A full business application with UI?
│   └── ✅ full-stack
│       • Multiple objects, views, apps, auth
│       • Studio UI included
│       • CRM-like starter with relationships
│
└── A reusable extension for other projects?
    └── ✅ plugin
        • Plugin scaffold with onInstall/onEnable/onDisable
        • Exports objects that other apps can import
        • Designed for the marketplace
```

### Scaffolding Command

```bash
# Interactive — prompts for name, template, package manager
npx create-objectstack

# Direct — skip prompts
npx create-objectstack my-app --template full-stack
```

Templates: `minimal-api` | `full-stack` | `plugin`

---

## Project Structure Conventions

Every ObjectStack project follows this directory structure:

```
my-app/
├── objectstack.config.ts    # ← THE entry point — defineStack()
├── package.json
├── tsconfig.json
└── src/
    ├── objects/              # Business object definitions
    │   ├── task.object.ts    # → exports a single object
    │   └── index.ts          # → barrel: export * from './task.object'
    ├── views/                # Optional: UI view definitions
    │   ├── task.view.ts
    │   └── index.ts
    ├── apps/                 # Optional: app definitions (nav, pages)
    │   ├── main.app.ts
    │   └── index.ts
    ├── flows/                # Optional: automation flows
    │   ├── task.flow.ts
    │   └── index.ts
    ├── actions/              # Optional: action definitions
    │   ├── task.action.ts
    │   └── index.ts
    ├── dashboards/           # Optional: dashboards
    ├── reports/              # Optional: reports
    ├── i18n/                 # Optional: translation bundles
    └── handlers/             # Optional: runtime hook handlers
```

### Naming Conventions

| Concept | Convention | Example |
|:--------|:-----------|:--------|
| File names | `{name}.{type}.ts` | `task.object.ts`, `main.app.ts` |
| Machine names | `snake_case` | `project_task`, `first_name` |
| Config keys | `camelCase` | `maxLength`, `defaultValue` |
| Barrel exports | `Object.values(imported)` | `objects: Object.values(objects)` |

---

## CRM Blueprint (Reference Implementation)

When scaffolding a production-style metadata app, align with this
CRM-style layout:

| Blueprint Area | CRM Reference | What to Reuse |
|:--|:--|:--|
| Stack assembly | `objectstack.config.ts` | Single `defineStack()` root aggregating all metadata collections |
| By-type directories | `src/{objects,views,pages,actions,flows,...}` | Domain-per-folder layout with barrel exports |
| Typed aggregates | `src/*/index.ts` | Export `allFlows` / `allAgents` / `allSkills` typed arrays |
| Runtime capabilities | `requires: ['ai','automation','analytics','auth','ui','approvals','sharing']` | Declare opt-in capabilities explicitly |
| Security assembly | `src/profiles/*` + `src/sharing/*` | Compose `permissions`, `sharingRules`, and `roles` in stack root |
| Localization assembly | `src/translations/*` + `i18n` | Keep per-locale files and central bundle registration |

Use this as the default template for “metadata application” requests before
simplifying to minimal-api.

---

## `defineStack()` — The Core Configuration

`objectstack.config.ts` is the single entry point for every project.
It calls `defineStack()` to declare all metadata.

### Minimal Example

```typescript
import { defineStack, Data } from '@objectstack/spec';
const { Field } = Data;

export default defineStack({
  manifest: {
    id: 'com.example.todo',
    version: '1.0.0',
    type: 'app',
    name: 'Todo Manager',
  },
  objects: [
    {
      name: 'task',
      label: 'Task',
      fields: {
        title:    Field.text({ required: true }),
        status:   Field.select({ options: [
          { label: 'Open', value: 'open' },
          { label: 'Done', value: 'done' },
        ], defaultValue: 'open' }),
        due_date: Field.date(),
      },
    },
  ],
});
```

### Full Configuration Reference

`defineStack()` accepts an `ObjectStackDefinitionInput`. Each top-level key
holds a collection of one metadata kind — `objects`, `views`, `apps`,
`pages`, `dashboards`, `reports`, `actions`, `flows`, `workflows`,
`approvals`, `agents`, `ragPipelines`, `hooks`, `apis`, `webhooks`,
`roles`, `permissions`, `sharingRules`, `policies`, `themes`,
`translations`, `i18n`, `datasources`, `data` (seed), `plugins`,
`devPlugins`, `manifest`, `objectExtensions`, `mappings`,
`analyticsCubes`, `connectors`.

For the exact Zod shape — including which keys are optional and what types
the collection items take — read
`node_modules/@objectstack/spec/src/stack.zod.ts`
(`ObjectStackDefinitionInputSchema`). Each collection's item shape lives in
its own domain folder (`data/object.zod.ts`, `ui/view.zod.ts`, …).

### Map Format (Key → Name)

All named collections support **map format** where the key becomes the `name` field:

```typescript
export default defineStack({
  // Array format (traditional)
  objects: [
    { name: 'task', fields: { title: Field.text() } },
  ],

  // Map format (key becomes name) — preferred for readability
  objects: {
    task: { fields: { title: Field.text() } },
    project: { fields: { name: Field.text() } },
  },
});
```

### Barrel Import Pattern

Use barrel exports to keep config clean:

```typescript
// src/objects/index.ts
export { default as task } from './task.object';
export { default as project } from './project.object';

// objectstack.config.ts
import * as objects from './src/objects';
import * as apps from './src/apps';
import * as views from './src/views';
import * as flows from './src/flows';

export default defineStack({
  manifest: { id: 'com.example.pm', namespace: 'pm', version: '1.0.0', type: 'app', name: 'PM' },
  objects: Object.values(objects),
  apps: Object.values(apps),
  views: Object.values(views),
  flows: Object.values(flows),
});
```

### Strict Validation

`defineStack()` validates by default (`strict: true`):

1. **Zod schemas** — field names, types, enums
2. **Cross-references** — views/actions/workflows reference defined objects
3. **Seed data** — dataset objects exist in the definition

To disable (advanced — e.g., objects provided by another plugin):

```typescript
export default defineStack({ ... }, { strict: false });
```

### Compile Artifact and Runtime Metadata Boundary

ObjectStack runtime metadata must come from source files during local development or
from a compiled artifact. Do not configure a project runtime to read or write
metadata through its business database.

```bash
objectstack compile
# -> dist/objectstack.json

OS_ARTIFACT_PATH=./dist/objectstack.json objectstack dev
```

Runtime rule of thumb:

| Context | Metadata source | Database role |
|:--------|:----------------|:--------------|
| Local dev | TS files or `dist/objectstack.json` | Business rows only |
| Production runtime | Artifact API response | Business rows only |
| Control plane | Published JSON in metadata storage | Project revisions, history, overlays |

When generating `objectstack.config.ts`, keep object names short and
`snake_case`; never set `tableName`, and do not add `sys_metadata` objects to a
project runtime manifest.

---

## Manifest Reference

Every stack needs a `manifest` to identify itself in the ecosystem:

```typescript
manifest: {
  id: 'com.example.crm',        // Reverse domain unique ID
  version: '1.0.0',             // Semver
  type: 'app',                  // app | plugin | driver | module | ...
  name: 'Acme CRM',             // Human-readable display name
  description: 'CRM system',    // Optional description
}
```

**Object naming:** The object `name` is the canonical identifier and equals the physical table name. Embed any domain prefix directly in the name (e.g. `name: 'crm_account'`); the object-level `namespace` *field* is deprecated and ignored by the runtime.

**`manifest.namespace` (ADR-0048):** Optional, but **enforced once set**. When a package declares `manifest.namespace: 'crm'`, every `object.name` must start with `crm_` or `defineStack` errors (`validateNamespacePrefix` in `@objectstack/spec`); the legacy `<ns>__<short>` double-underscore form is rejected, and `sys_`-prefixed names are platform-reserved and exempt. The namespace is also a package-ownership key — installing two packages that both claim `crm` fails with `NamespaceConflictError` (downgrade to a warning with `OS_METADATA_COLLISION=warn`). `os lint` additionally emits a non-fatal `naming/namespace-prefix` warning for bare-named UI/automation items (app, page, dashboard, flow, action, report, dataset) when a namespace is set.

---

## Driver Selection Guide

Drivers are the storage layer. Pick based on your environment:

| Driver | Package | Best For | Notes |
|:-------|:--------|:---------|:------|
| **Memory** | `@objectstack/driver-memory` | Dev, testing, prototyping | Data lost on restart (unless persistence adapter used) |
| **SQL** | `@objectstack/driver-sql` | Production (PostgreSQL, MySQL, SQLite) | Uses Knex.js under the hood |
| **Turso** | `@objectstack/driver-turso` | Edge, serverless, multi-tenant | LibSQL/Turso cloud, per-tenant databases |

### Usage Pattern

```typescript
import { DriverPlugin } from '@objectstack/runtime';

// Development (in-memory, zero config)
import { InMemoryDriver } from '@objectstack/driver-memory';
new DriverPlugin(new InMemoryDriver())

// Production (SQLite)
import { SqlDriver } from '@objectstack/driver-sql';
new DriverPlugin(new SqlDriver({
  client: 'better-sqlite3',
  connection: { filename: './data/app.db' },
  useNullAsDefault: true,
}))

// Production (PostgreSQL)
new DriverPlugin(new SqlDriver({
  client: 'pg',
  connection: process.env.DATABASE_URL,
}))

// Edge / Serverless (Turso)
import { TursoDriver } from '@objectstack/driver-turso';
new DriverPlugin(new TursoDriver({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
}))
```

---

## Adapter Selection Guide

Adapters bridge ObjectStack to web frameworks. All expose the same REST API.

| Adapter | Package | Use When |
|:--------|:--------|:---------|
| **Hono** | `@objectstack/adapter-hono` | Default choice. Lightweight, edge-ready, web-standard. |
| **Express** | `@objectstack/adapter-express` | Existing Express codebase. |
| **Fastify** | `@objectstack/adapter-fastify` | Need Fastify's schema validation / plugin ecosystem. |
| **Next.js** | `@objectstack/adapter-nextjs` | Full-stack React with App Router. |
| **Nuxt** | `@objectstack/adapter-nuxt` | Vue.js / Nuxt projects. |
| **NestJS** | `@objectstack/adapter-nestjs` | Enterprise Angular-style architecture. |
| **SvelteKit** | `@objectstack/adapter-sveltekit` | Svelte projects. |

### Usage Pattern (Hono)

```typescript
import { createHonoApp } from '@objectstack/adapter-hono';

const app = createHonoApp({
  kernel,                    // ObjectKernel instance
  prefix: '/api',            // API route prefix (default: '/api')
});

export default app;          // Deploy to Cloudflare Workers, Deno, Bun, Node
```

### Usage Pattern (Next.js App Router)

```typescript
// app/api/[...objectstack]/route.ts
import { createRouteHandler } from '@objectstack/adapter-nextjs';
import { kernel } from '@/lib/objectstack';

const handler = createRouteHandler({ kernel });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
```

### Pattern Across All Adapters

Every adapter follows the same architecture:

1. Accept a `kernel` (ObjectKernel) instance
2. Create an `HttpDispatcher` internally
3. Mount explicit routes for auth, GraphQL, storage, discovery
4. Delegate everything else to `dispatcher.dispatch()`

This means **new routes added to HttpDispatcher work automatically in all
adapters** without code changes.

---

## Runtime Boot Sequence

Understanding how ObjectStack starts helps debug and customize:

```
objectstack.config.ts
  └── defineStack({ manifest, objects, views, ... })
        │
        ▼
CLI: `os serve` / `os dev`
  1. Load .env files (NODE_ENV-based)
  2. Dynamic import of config file
  3. Create Runtime + ObjectKernel
  4. Auto-detect and register plugins:
     ├── ObjectQLPlugin (if objects defined)
     ├── DriverPlugin (memory in dev, SQL in prod)
     ├── AppPlugin (loads the defineStack bundle)
     ├── I18nServicePlugin (if translations/i18n defined)
     ├── AuthPlugin
     ├── Split platform-app plugins (ADR-0048, optional/best-effort, after AuthPlugin):
     │     @objectstack/setup → createSetupAppPlugin   (first-run wizard)
     │     @objectstack/studio → createStudioAppPlugin
     │     @objectstack/account → createAccountAppPlugin
     ├── HonoServerPlugin
     ├── RESTPlugin (auto-generated API)
     ├── DispatcherPlugin
     └── AIServicePlugin (cloud / EE only — reverse-mounted by a cloud host; absent in the open framework per cloud ADR-0025)
  5. Runtime.start() → init + start all plugins
  6. Server listens on the resolved port (see "Ports & networking" in Part 3)
```

**Port resolution** (both `os dev` and `os start` → `os serve`):
`--port` flag › `$OS_PORT` › `$PORT` › `3000`. On a conflict the behaviour is
mode-dependent — dev hops to the next free port, production fails loudly. See
[Ports & networking](#ports--networking).

### Plugin Loading Order Matters

Plugins initialize in registration order. Key dependencies:

| Plugin | Depends On | Reason |
|:-------|:-----------|:-------|
| ObjectQLPlugin | (none) | Core data engine, should load first |
| DriverPlugin | (none) | Registers driver service |
| AppPlugin | ObjectQLPlugin | Registers objects/metadata with engine |
| AuthPlugin | ObjectQLPlugin | Needs user/session objects |
| RESTPlugin | ObjectQLPlugin, AppPlugin | Generates routes from registered objects |
| AIServicePlugin | ObjectQLPlugin, AppPlugin | Needs metadata for tool generation. **Cloud / EE only** — `@objectstack/service-ai` moved to cloud (cloud ADR-0025); the open edition has no in-UI AI plugin and uses `@objectstack/mcp` (BYO-AI) |

### Programmatic Bootstrap (Without CLI)

```typescript
import { Runtime, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import appConfig from './objectstack.config';

const runtime = new Runtime();
runtime.use(new ObjectQLPlugin());
runtime.use(new DriverPlugin(new InMemoryDriver()));
runtime.use(new AppPlugin(appConfig));
await runtime.start();

const kernel = runtime.getKernel();
// kernel is now ready — use it with an adapter
```

---

## Multi-App Composition

Use `composeStacks()` to merge multiple apps into one runtime:

```typescript
import { composeStacks, defineStack } from '@objectstack/spec';
import CrmApp from './apps/crm/objectstack.config';
import TodoApp from './apps/todo/objectstack.config';

const combined = composeStacks([CrmApp, TodoApp], {
  objectConflict: 'error',   // Throw on duplicate object names
  manifest: 'last',          // Use last stack's manifest
});

export default combined;
```

### Conflict Strategies

| Strategy | Behavior |
|:---------|:---------|
| `'error'` (default) | Throw if two stacks define the same object name |
| `'override'` | Last stack wins — later definition replaces earlier |
| `'merge'` | Shallow-merge objects with same name (later fields win) |

### Host Pattern (Plugins as AppPlugin)

For a hosting environment where each app runs isolated:

```typescript
import { Runtime, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AuthPlugin } from '@objectstack/plugin-auth';

export default defineStack({
  manifest: { id: 'platform-host', type: 'app', version: '1.0.0', name: 'Platform' },
  plugins: [
    new ObjectQLPlugin(),
    new DriverPlugin(new SqlDriver({ ... })),
    new AuthPlugin({ secret: process.env.AUTH_SECRET }),
    new AppPlugin(CrmApp),     // contributes objects: crm_account, crm_lead, ...
    new AppPlugin(TodoApp),    // contributes objects: task, ...
  ],
});
```

Each app registers its objects by their canonical `name`. Object names are globally unique and equal the physical table name — use them directly in queries, hooks, formulas, and REST URLs.

---

## Seed Data

Declarative data loading for bootstrapping, demos, and testing:

```typescript
export default defineStack({
  // ... objects, apps, etc.
  data: [
    {
      object: 'task',
      mode: 'upsert',              // 'upsert' | 'insert' | 'ignore' | 'replace'
      externalId: 'subject',       // Idempotency key for upsert matching
      records: [
        { subject: 'Learn ObjectStack', status: 'open', priority: 'high' },
        { subject: 'Build first app', status: 'open', priority: 'medium' },
      ],
    },
  ],
});
```

| Mode | Behavior |
|:-----|:---------|
| `upsert` (default) | Insert or update based on `externalId` match |
| `insert` | Always insert (fails on duplicate) |
| `ignore` | Insert if not exists, skip otherwise |
| `replace` | Drop and re-insert all records |

---

## CLI Commands

Daily commands are covered in **Part 3 — Operations** below
([jump there](#part-3--operations-cli-testing-deployment)). High-level cheat
sheet for the bootstrap loop:

```bash
npx create-objectstack my-app --template full-stack
cd my-app && pnpm install
os dev --ui          # dev server + Studio (auto-hops port if taken)
os validate          # metadata cross-reference checks
os compile           # produce dist/ artifact
os migrate plan      # preview metadata↔DB schema drift (additive sync never alters existing columns)
os migrate apply     # reconcile DB to metadata (loosening only; --allow-destructive for drops/tightenings)
PORT=8080 os start   # production — pin the port explicitly (see Ports & networking)
```

---

## Complete Working Example

A minimal but complete project from scratch:

**`package.json`**:
```json
{
  "name": "my-todo-app",
  "type": "module",
  "dependencies": {
    "@objectstack/spec": "^4.0.0",
    "@objectstack/runtime": "^4.0.0",
    "@objectstack/objectql": "^4.0.0",
    "@objectstack/driver-memory": "^4.0.0",
    "@objectstack/adapter-hono": "^4.0.0",
    "@objectstack/cli": "^4.0.0"
  }
}
```

**`src/objects/task.object.ts`**:
```typescript
import { Data } from '@objectstack/spec';
const { Field } = Data;

export default {
  name: 'task',
  label: 'Task',
  fields: {
    title:       Field.text({ label: 'Title', required: true }),
    description: Field.textarea({ label: 'Description' }),
    status:      Field.select({
      label: 'Status',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Done', value: 'done' },
      ],
      defaultValue: 'open',
    }),
    priority: Field.select({
      label: 'Priority',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
      defaultValue: 'medium',
    }),
    due_date: Field.date({ label: 'Due Date' }),
  },
  indexes: [
    { fields: ['status'] },
    { fields: ['due_date'] },
  ],
};
```

**`src/objects/index.ts`**:
```typescript
export { default as task } from './task.object';
```

**`objectstack.config.ts`**:
```typescript
import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.todo',
    version: '1.0.0',
    type: 'app',
    name: 'Todo Manager',
  },
  objects: Object.values(objects),
});
```

```bash
# Run it
os dev --ui
# → Server at http://localhost:5174
# → REST API at http://localhost:5174/api
# → Studio UI at http://localhost:5174/studio
```

---
---

# Part 2 — Plugin Development & Kernel Extension


## When to Use This Skill

- You are creating a **new plugin** (driver, server, service, app feature)
- You need to **register or consume services** via the DI container
- You are using the **hook/event system** for inter-plugin communication
- You need to choose between **ObjectKernel** and **LiteKernel**
- You are debugging **plugin loading order** or dependency resolution
- You need to configure **graceful shutdown**, timeouts, or health checks
- You are implementing **service factories** with lifecycle management

---

## Quick Reference — Detailed Rules

For comprehensive documentation with incorrect/correct examples:

- **[Plugin Lifecycle](./rules/plugin-lifecycle.md)** — 3-phase lifecycle (init/start/destroy), execution order, complete examples
- **[Service Registry](./rules/service-registry.md)** — DI container, factories, lifecycles (singleton/transient/scoped), core fallbacks
- **[Hooks & Events](./rules/plugin-hooks-events.md)** — Plugin hooks reference (→ [objectstack-data](../objectstack-data/SKILL.md))

---

## ObjectKernel vs LiteKernel

| Feature | ObjectKernel | LiteKernel |
|:--------|:-------------|:-----------|
| **Use case** | Production servers, full applications | Serverless, edge, unit tests |
| **Package** | `@objectstack/core` | `@objectstack/core` |
| **Plugin loading** | Async with validation & metadata | Synchronous `use()` |
| **Service factories** | Singleton / Transient / Scoped | Direct instances only |
| **Health monitoring** | Built-in per-plugin health checks | Not available |
| **Graceful shutdown** | Timeout + rollback on failure | Basic destroy phase |
| **Dependency resolution** | Topological sort + circular detection | Topological sort |
| **Core fallbacks** | Auto-injects in-memory fallbacks | Not available |
| **Config validation** | Zod schema validation per plugin | Not available |

### Decision Guide

```
What environment are you targeting?
│
├── Production server / full application?
│   └── ✅ ObjectKernel
│       • Full DI with factories and scopes
│       • Health monitoring and auto-recovery
│       • Graceful shutdown with timeout
│       • Startup failure rollback
│
├── Serverless / edge (Cloudflare Workers, Deno Deploy)?
│   └── ✅ LiteKernel
│       • Minimal memory footprint
│       • Fast cold start
│       • No background health checks
│
└── Unit tests (vitest)?
    └── ✅ LiteKernel
        • Simple setup, fast teardown
        • No system requirement validation
        • No shutdown signal handlers
```

### ObjectKernel Configuration

```typescript
import { ObjectKernel } from '@objectstack/core';

const kernel = new ObjectKernel({
  logger: {
    level: 'info',           // 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    format: 'json',          // 'json' | 'text' | 'pretty'
  },
  defaultStartupTimeout: 30000,   // Per plugin (ms)
  gracefulShutdown: true,         // Register SIGINT/SIGTERM handlers
  shutdownTimeout: 60000,         // Total shutdown timeout (ms)
  rollbackOnFailure: true,        // Rollback all plugins if one fails
  skipSystemValidation: false,    // Skip system checks (useful for tests)
});
```

### LiteKernel Configuration

```typescript
import { LiteKernel } from '@objectstack/core';

const kernel = new LiteKernel({
  logger: { level: 'warn' },
});
```

---

## Plugin Interface — Quick Overview

```typescript
import type { Plugin, PluginContext } from '@objectstack/core';

export interface Plugin {
  name: string;               // Unique identifier (reverse domain recommended)
  version?: string;           // Semantic version
  type?: string;              // 'standard' | 'ui' | 'driver' | 'server' | 'app'
  dependencies?: string[];    // Plugins that must init before this one

  // Phase 1: Register services
  init(ctx: PluginContext): Promise<void> | void;

  // Phase 2: Execute business logic (optional)
  start?(ctx: PluginContext): Promise<void> | void;

  // Phase 3: Cleanup (optional)
  destroy?(): Promise<void> | void;
}
```

See [rules/plugin-lifecycle.md](./rules/plugin-lifecycle.md) for complete examples.

---

## PluginContext API

### Service Registry

```typescript
// Register a service (in init phase)
ctx.registerService('my-service', myServiceInstance);

// Get a service (in start phase)
const db = ctx.getService<IDataEngine>('objectql');

// Replace a service
ctx.replaceService('cache', new InstrumentedCache(existingCache));

// Get all services
const allServices: Map<string, any> = ctx.getServices();
```

See [rules/service-registry.md](./rules/service-registry.md) for factories and lifecycles.

### Hook / Event System

```typescript
// Register a hook handler
ctx.hook('kernel:ready', async () => {
  ctx.logger.info('System is ready!');
});

// Register data lifecycle hooks
ctx.hook('data:beforeInsert', async (objectName, record) => {
  if (objectName === 'task') {
    record.created_at = new Date().toISOString();
  }
});

// Trigger a custom hook
await ctx.trigger('my-plugin:initialized', { version: '1.0.0' });
```

See [rules/hooks-events.md](./rules/plugin-hooks-events.md) for all 14 built-in hooks and patterns.

### Logger

```typescript
ctx.logger.debug('Detailed trace info', { key: 'value' });
ctx.logger.info('Plugin initialized');
ctx.logger.warn('Cache miss rate high', { rate: 0.45 });
ctx.logger.error('Connection failed', error);
```

### Kernel Access

```typescript
const kernel = ctx.getKernel();
const isRunning = kernel.isRunning();
const state = kernel.getState(); // 'idle' | 'initializing' | 'running' | 'stopping' | 'stopped'
```

---

## Complete Plugin Example

```typescript
// packages/plugins/plugin-audit/src/plugin.ts
import type { Plugin, PluginContext } from '@objectstack/core';

interface AuditEntry {
  timestamp: string;
  operation: string;
  object: string;
  recordId?: string;
}

class AuditService {
  private log: AuditEntry[] = [];

  record(entry: AuditEntry) {
    this.log.push(entry);
  }

  getLog(): AuditEntry[] {
    return [...this.log];
  }
}

const AuditPlugin: Plugin = {
  name: 'com.example.audit',
  version: '1.0.0',
  type: 'plugin',
  dependencies: ['com.objectstack.engine.objectql'],

  async init(ctx: PluginContext) {
    // Phase 1: Register service and hooks
    const auditService = new AuditService();
    ctx.registerService('audit', auditService);

    ctx.hook('data:afterInsert', async (objectName, _record, result) => {
      auditService.record({
        timestamp: new Date().toISOString(),
        operation: 'insert',
        object: objectName,
        recordId: result?.id,
      });
    });

    ctx.logger.info('Audit plugin initialized');
  },

  async start(ctx: PluginContext) {
    // Phase 2: Log that audit is active
    ctx.logger.info('Audit logging active');
  },

  async destroy() {
    // Phase 3: Cleanup
  },
};

export default AuditPlugin;
```

---

## Using Plugins

```typescript
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { DriverPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';
import AuditPlugin from './plugin';

const kernel = new ObjectKernel();
await kernel.use(new ObjectQLPlugin());
await kernel.use(new DriverPlugin(new InMemoryDriver()));
await kernel.use(AuditPlugin);
await kernel.bootstrap();

// Services are now available
const audit = kernel.getService<AuditService>('audit');
```

---

## Testing Plugins

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import AuditPlugin from './plugin';

describe('AuditPlugin', () => {
  it('records insert events', async () => {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    kernel.use(AuditPlugin);
    await kernel.bootstrap();

    // Simulate a data event
    await kernel.context.trigger('data:afterInsert', 'task', {}, { id: '123' });

    const audit = kernel.getService('audit');
    const log = audit.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].operation).toBe('insert');
    expect(log[0].object).toBe('task');

    await kernel.shutdown();
  });
});
```

---

## Well-Known Plugin Names & Services

| Plugin Name | Service Key | Package |
|:------------|:------------|:--------|
| `com.objectstack.engine.objectql` | `objectql` | `@objectstack/objectql` |
| `com.objectstack.driver.*` | `driver.{name}` | `@objectstack/driver-*` |
| `com.objectstack.auth` | `auth` | `@objectstack/plugin-auth` |
| `com.objectstack.rest` | `rest` | `@objectstack/rest` |
| `com.objectstack.metadata` | `metadata` | `@objectstack/metadata` |
| `com.objectstack.realtime` | `realtime` | `@objectstack/service-realtime` |
| `com.objectstack.cache` | `cache` | `@objectstack/service-cache` |
| `com.objectstack.setup` | — | `@objectstack/setup` → `createSetupAppPlugin` (ADR-0048 one-app pkg) |
| `com.objectstack.studio` | — | `@objectstack/studio` → `createStudioAppPlugin` |
| `com.objectstack.account` | — | `@objectstack/account` → `createAccountAppPlugin` |
| `com.objectstack.cloud-connection` | — | `@objectstack/cloud-connection` → `createCloudConnectionPlugin` |

---

## MetadataPlugin Runtime Boundary

`MetadataPlugin` is the `IMetadataService` provider for the ObjectStack runtime, but runtime
metadata is read-only and artifact/file backed:

- Do **not** register `sys_metadata` or `sys_metadata_history` from an ObjectStack
  runtime plugin. Those persistence tables belong to the control plane.
  (Exception, #1826: an *isolated project kernel* may opt into `sys_metadata`
  hydration from its own DB — the general boundary otherwise stands.)
- Do **not** call `MetadataManager.setDataEngine()` automatically from
  `MetadataPlugin.start()`. Project databases must contain business rows only.
- Use `artifactSource: { mode: 'local-file', path: './dist/objectstack.json' }`
  for local artifact boot; production should use the Artifact API loader once
  wired.
- `DatabaseLoader`, `setDatabaseDriver()`, and `setDataEngine()` remain valid for
  control-plane services that explicitly own metadata revisions, history, or
  overlays.

```typescript
import { MetadataPlugin } from '@objectstack/metadata';

await kernel.use(new MetadataPlugin({
  watch: false,
  artifactSource: { mode: 'local-file', path: './dist/objectstack.json' },
}));
```

---

## Health Monitoring (ObjectKernel Only)

```typescript
const MyPlugin: Plugin & { healthCheck(): Promise<PluginHealthStatus> } = {
  name: 'com.example.db',
  version: '1.0.0',

  async init(ctx) { /* ... */ },

  async healthCheck() {
    try {
      await this.pool.query('SELECT 1');
      return { healthy: true, message: 'Database connected' };
    } catch (err) {
      return { healthy: false, message: 'Database unreachable', details: { error: err.message } };
    }
  },
};

// Check health
const health = await kernel.checkPluginHealth('com.example.db');
const allHealth = await kernel.checkAllPluginsHealth();

// Get startup metrics
const metrics = kernel.getPluginMetrics();
// Map<string, number> — plugin name → startup duration in ms
```

---

## Feature Flags

```typescript
import { defineStack } from '@objectstack/spec';

export default defineStack({
  featureFlags: [
    {
      name: 'experimental_ai_copilot',
      label: 'AI Copilot',
      enabled: true,
      strategy: 'percentage',
      conditions: { percentage: 25 },   // 25% of users
      environment: ['production'],
    },
    {
      name: 'beta_kanban_view',
      label: 'Kanban View',
      enabled: true,
      strategy: 'group',
      conditions: { groups: ['beta_testers'] },
    },
  ],
});
```

Strategies: `boolean` | `percentage` | `user_list` | `group` | `custom`

---
---

# Part 3 — Operations: CLI, Testing, Deployment

The `@objectstack/cli` package ships an `os` binary (alias: `objectstack`).
Every project gets the same command surface — `pnpm install` does not need to
be re-run when commands are added.

## Daily-loop commands

| Command | What it does |
|:--------|:-------------|
| `os init` | Scaffold a new project (alternative to `npx create-objectstack`) |
| `os dev` | Start the dev server with hot metadata reload. `--fresh` = ephemeral clean DB + auto `--seed-admin`, which POSTs a sign-up after boot (default `admin@objectos.ai` / `admin123`; override with `--admin-email` / `--admin-password`). The seeded human is auto-promoted to **platform admin**, so Setup/Studio work on first login. |
| `os studio` | Launch Studio UI against the local stack |
| `os validate` | Validate `objectstack.config.ts` — Zod protocol schema, CEL/predicate validation (`record.<field>` existence), and widget-binding integrity. Same gates as `os build`, no artifact emitted. See [Verify your work](#verify-your-work). |
| `os lint` | Style/convention lint on metadata files |
| `os info` | Print resolved stack info (env, drivers, adapter, plugin list) |
| `os doctor` | Diagnose common setup issues |

## Build & runtime

| Command | What it does |
|:--------|:-------------|
| `os build` | Compile TS metadata, bundle, and produce `dist/` |
| `os compile` | Compile to portable JSON artifact (for runtime hydration) |
| `os serve` | Serve a compiled stack in production mode |
| `os start` | Production-grade boot (validates env, applies migrations, starts adapter) |
| `os generate <kind>` | Scaffold an object / view / flow / agent from a template |

## Verify your work

ObjectStack metadata mistakes fail **silently at runtime**, not at edit time:
a bare field ref in a predicate (`done` instead of `record.done`) evaluates to
`null` and silently hides an action/validation on every record (#2183/#2185); a
dangling dashboard widget binding renders an empty chart (ADR-0021). Both are
caught at author time by one command:

```bash
os validate     # Zod schema + CEL predicates + widget bindings — no artifact
# or
os build        # the same three gates, plus emits dist/objectstack.json
```

`os validate` and `os build` run the **same** structural + semantic gates:

1. **Zod protocol schema** — the stack conforms to `@objectstack/spec`.
2. **CEL / predicate validation (ADR-0032)** — every `visible` / `disabled` /
   `requiredWhen` / validation rule / flow condition / sharing rule is parsed
   for CEL syntax *and* checked that each `record.<field>` reference exists on
   the target object. A bare `field` (missing `record.`) fails here.
3. **Widget-binding integrity (ADR-0021)** — every dashboard widget's
   `dataset` / `dimensions` / `values` resolves to a declared dataset/field.

Both exit non-zero with a located, corrective message; `os build` additionally
emits the artifact. Use `os validate` as the fast inner-loop check after editing
metadata and `os build` when you need `dist/`. In a scaffolded project these are
`npm run validate` / `npm run build`.

**Rule of thumb: never report a metadata change as done until `os validate`
passes.** (`os lint` is a *separate* style/convention pass — naming, labels,
namespace prefixes — and does not replace `os validate`.)

## Ports & networking

Port resolution is the same for `os dev` and `os start` (both spawn `os serve`):

```
--port <n>  ›  $OS_PORT  ›  $PORT  ›  3000   (default)
```

**Conflict behaviour is mode-dependent — this is deliberate:**

| Mode | If the resolved port is busy |
|:-----|:-----------------------------|
| **Dev** (`os dev`, or `NODE_ENV=development`) | Auto-hops to the next free port (up to +100) so several example apps run side-by-side. The startup banner shows the *actual* bound port. |
| **Production** (`os start`) | **Fails loudly and exits 1.** It never silently drifts — a shifted port breaks reverse-proxy upstreams, better-auth callback URLs, and CORS trusted-origins as opaque 403/502s. |

**Production guidance:**

- **Pin the port explicitly** — `PORT=8080 os start` (or `--port 8080`). Don't
  rely on the `3000` default; it collides easily on shared hosts.
- **Keep these in sync when you change the port** (mismatch ⇒ better-auth
  `Invalid origin` 403 / CORS failures):
  - reverse-proxy upstream (`nginx`/`caddy`)
  - `OS_AUTH_URL` / better-auth `baseURL` + `callbackURL`
  - `OS_TRUSTED_ORIGINS` (CORS allow-list)
  - the app's `hostname`
- **Recommended topology:** terminate TLS on a reverse proxy (`:443`) and let
  the app listen on an internal high port (e.g. `8080`) fixed via `PORT`.

## Data & migrations

| Command | What it does |
|:--------|:-------------|
| `os data seed` | Run all `defineSeed()` entries scoped to current env |
| `os data export` / `import` | Bulk import / export records as JSONL |
| `os diff` | Show schema diff between local and target environment |
| `os meta apply` | Apply metadata + data migrations to the target |
| `os migrate plan` / `os migrate apply` | Dry-run / apply physical-DB drift reconciliation from metadata (forward-only — no batch rollback; `os rollback` was removed) |

## Environments & deploy

| Command | What it does |
|:--------|:-------------|
| `os login` / `logout` / `whoami` | Auth against the ObjectStack cloud control plane |
| `os environments list` / `create` / `switch` | Manage cloud environments (prod/staging/dev) |
| `os register` | Register the local stack as a deployable target |
| `os cloud …` | Cloud-specific subcommands (logs, metrics, status) |
| `os package publish [dist/objectstack.json] [--env … --install --visibility org]` | Upload the compiled artifact as a versioned package to the cloud catalog (ADR-0008 P3) |
| `os package install <manifest-id │ ./dist/objectstack.json> [--version │ --runtime http://localhost:3000]` | Install a package into a **running** runtime via its install-local endpoint. Catalog mode (by manifest id) or air-gapped local-artifact mode. Auths with the **target runtime's** session (`--email/--password` or `OS_RUNTIME_EMAIL`/`OS_RUNTIME_PASSWORD`), not the cloud login |

> **Cloud connection & marketplace (`@objectstack/cloud-connection`, ADR-0008/0009).**
> The open runtime-side cloud client. Its plugins —
> `CloudConnectionPlugin`/`createCloudConnectionPlugin`, `MarketplaceProxyPlugin`,
> `MarketplaceInstallLocalPlugin`, `RuntimeConfigPlugin` — expose the install-local
> endpoint that `os package install` targets, ship the **Installed Apps** page and
> marketplace Setup nav as plugin metadata, and maintain `LocalManifestSource`
> (a local desired-state ledger) plus runtime-identity bind v2 (environment-less
> self-hosted binding).

## Testing pattern

Use `LiteKernel` for unit / integration tests — it skips the cloud bits and
plugin discovery, so tests run in milliseconds:

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import stack from '../objectstack.config';

describe('account hooks', () => {
  it('defaults industry to "Other"', async () => {
    const kernel = await LiteKernel.create({ stack });
    const created = await kernel.api('account').create({ name: 'Acme' });
    expect(created.industry).toBe('Other');
    await kernel.shutdown();
  });
});
```

- **Seed in tests:** call `kernel.seed(SeedData)` after create. See
  **objectstack-data** for env-scoped fixtures (`env: ['test']`).
- **Reset between tests:** prefer `await kernel.reset()` over recreating —
  it's an order of magnitude faster.
- **HTTP-level tests:** mount the adapter (Hono / Express) on a random
  port and use `fetch`. The adapter is just middleware.

## Deployment targets

| Target | Driver | Adapter | Notes |
|:-------|:-------|:--------|:------|
| Node.js server | `driver-postgres` / `driver-sqlite` | `adapter-hono` / `adapter-express` | Default — works anywhere Node runs |
| Edge (Cloudflare Workers, Vercel Edge) | `driver-turso` / `driver-d1` | `adapter-hono` | Cold-start friendly; LiteKernel only |
| Serverless (Lambda, Vercel functions) | `driver-postgres` (with pooler) | `adapter-nextjs` / `adapter-express` | Mind cold-start: prefer LiteKernel |
| Browser / WebContainer | `driver-sqlite-wasm` | none (in-process) | Studio playground, demos |
| Docker / Kubernetes | any | any | Use `os start` as the entrypoint; pin `PORT` and `EXPOSE` it (see [Ports & networking](#ports--networking)) |

## Health & observability

- **Health endpoint:** the adapter auto-exposes `GET /healthz` and
  `GET /readyz` when the kernel reports ready (see "Health Monitoring"
  earlier in this skill).
- **Logs:** plugins log via `ctx.logger`. Configure the sink in
  `defineStack({ logging: { sink: 'pino' | 'console' | custom } })`.
- **Metrics:** the kernel exposes a `metrics` service; install
  `@objectstack/plugin-prometheus` for an OpenMetrics scrape endpoint.

## Common ops pitfalls

| Symptom | Likely cause |
|:--------|:-------------|
| `os dev` hangs at "Loading metadata…" | Circular import in `objectstack.config.ts` — run `os validate` |
| `os start` exits with "Port N is already in use" | Intended: production never auto-shifts ports. Free the port or set `PORT=<n>` — see [Ports & networking](#ports--networking) |
| better-auth `Invalid origin` 403 after a port/host change | Port or hostname out of sync with `OS_AUTH_URL` / `OS_TRUSTED_ORIGINS` — see [Ports & networking](#ports--networking) |
| Migrations apply locally but not in cloud | `env` scoping on the dataset excludes the target environment |
| Adapter 404s on auto-generated routes | `enable.apiEnabled: false` on the object, or missing `os build` |
| LiteKernel test passes, ObjectKernel boot fails | Test missed a plugin dependency — list with `os info` |
| Hot reload misses new objects | Barrel `src/objects/index.ts` not re-exporting — check the file |
| Login works but **Setup / Studio missing** | The logged-in user isn't a platform admin. Setup/Studio are gated by `setup.access` / `studio.access` on `admin_full_access`, auto-granted only to the first registered **human** (`bootstrapPlatformAdmin`). The `usr_system` seed identity is skipped, so it can't steal the grant. Either sign up first (`--seed-admin`/`--fresh` does this) or check `sys_user_permission_set` for a cross-tenant (`organization_id = NULL`) `admin_full_access` link on your user. Don't edit nav code first. |

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

