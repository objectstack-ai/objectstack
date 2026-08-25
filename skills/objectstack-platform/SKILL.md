---
name: objectstack-platform
description: >
  Bootstrap, configure, extend, and operate ObjectStack runtimes. Covers
  project setup (`defineStack`, drivers, adapters, scaffolding), plugin and
  service development (PluginContext, DI, kernel hooks like `kernel:ready`),
  and operations (CLI commands, migrations, deployment, test
  harnesses via LiteKernel). Use when the user is writing
  `objectstack.config.ts`, building a plugin or driver, wiring a framework
  adapter, running `os` CLI commands, or planning deployment. Do not use for
  data schema design (see objectstack-data) or query patterns (see
  objectstack-query); data lifecycle hooks (beforeInsert / afterUpdate)
  belong in objectstack-data — only kernel / service-level events live here.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x and @objectstack/core 17.x (Zod v4 schemas), Node 22+
metadata:
  author: objectstack-ai
  version: "1.3"
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
- Scaffolding a **new project** with the bundled `blank` template.
- Writing or modifying **`objectstack.config.ts`** (`defineStack()` config).
- Selecting a **database driver** (Memory, SQL, MongoDB).
- Integrating with a **web framework** (Hono via `@objectstack/hono` / `@objectstack/plugin-hono-server`).
- Understanding the **runtime boot sequence** and plugin loading order.
- Setting up **multi-app composition** with `composeStacks()`.
- Answering **"how do I get started?"** questions.

---

## The Template

`blank` is the only template `create-objectstack` offers, and it is the default:

- Bundled with `create-objectstack` — works offline, no network fetch
- One example object, in-memory driver, Hono server
- A clean slate to extend with the metadata this skill describes

The five remote content templates (`todo`, `compliance`, `content`,
`contracts`, `procurement`) are **retired** — delisted from the marketplace and
no longer maintained. Do not recommend them; asking for one by name is refused.
Build domain metadata on top of `blank` instead.

### Scaffolding Command

```bash
# Interactive — prompts for a name
npx create-objectstack

# Direct — skip prompts (blank is the default, and the only, template)
npx create-objectstack my-app
```

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
| Security assembly | `src/profiles/*` + `src/sharing/*` | Compose `permissions` and `sharingRules` in stack root |
| Localization assembly | `src/translations/*` + `i18n` | Keep per-locale files and central bundle registration |

Use this as the default template for “metadata application” requests before
simplifying to a blank-style minimal stack.

---

## `defineStack()` — The Core Configuration

`objectstack.config.ts` is the single entry point for every project.
It calls `defineStack()` to declare all metadata.

### Minimal Example

<!-- os:check -->
```typescript
import { defineStack } from '@objectstack/spec';
import { Field } from '@objectstack/spec/data';

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
holds a collection of one metadata kind — `manifest`, `objects`,
`objectExtensions`, `views`, `apps`, `pages`, `dashboards`,
`reports`, `datasets`, `actions`, `flows`, `jobs`,
`emailTemplates`, `docs`, `books`, `positions`, `permissions`,
`capabilities`, `sharingRules`, `apis`, `webhooks`, `api`, `agents`,
`tools`, `skills`, `hooks`, `functions`, `mappings`, `analyticsCubes`,
`connectors`, `data` (seed), `datasources`, `datasourceMapping`,
`translations`, `i18n`, `plugins`, `devPlugins`, `requires`, `tiers`.

There is deliberately **no** top-level `workflows` or `approvals` collection:
an approval is authored as a flow with Approval nodes (ADR-0019), and record
state machines are a `state_machine` validation rule on each object
(ADR-0020). A phantom key like `roles:` or `policies:` is **not** a silent
no-op — the top level refuses it and the stack fails to load:

```
defineStack validation failed (1 issue):

  ✗ (root): Unrecognized key(s) on this stack definition: `policies`. …
```

Undeclared keys are handled per surface, and the two postures are worth
keeping straight:

- **Refused** — `defineStack()`'s top level, each `objects[]` entry
  (`ObjectSchema`), and each field (`FieldSchema`). The parse throws, naming
  the surface and the offending key. TypeScript rejects the literal earlier
  still, with `TS2353: Object literal may only specify known properties`.
- **Warned, then dropped** — the authoring surfaces whose shapes have not
  been closed yet (`connectors` is one). `defineStack()` prints the warning
  before the parse, and the value does not survive it:
  `defineStack: connectors.stripe.bogusKey: 'bogusKey' is not a declared connector key, so its value is dropped at load.`
  Treat these as errors-in-waiting — closing the remaining shapes is a
  scheduled migration, so a key that only warns today is expected to be
  refused later.

For the exact Zod shape — including which keys are optional and what types
the collection items take — read
`node_modules/@objectstack/spec/src/stack.zod.ts`
(`ObjectStackDefinitionSchema`; the input type is
`ObjectStackDefinitionInput`). Each collection's item shape lives in
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
2. **Cross-references** — views/actions/flows reference defined objects
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
| **Memory** | `@objectstack/driver-memory` | Dev, testing, prototyping | `InMemoryDriver` — data lost on restart |
| **SQL** | `@objectstack/driver-sql` | Production (PostgreSQL, MySQL, SQLite) | `SqlDriver` — Knex.js under the hood (`pg` / `mysql` / `better-sqlite3` clients) |
| **MongoDB** | `@objectstack/driver-mongodb` | Production (document store) | `MongoDBDriver` |
| **SQLite WASM** | `@objectstack/driver-sqlite-wasm` | Browser / WebContainer | `SqliteWasmDriver` — in-process, no server |
| **Turso** | `@objectstack/driver-turso` | Edge, serverless, multi-tenant | **Cloud / EE only** — ships with the ObjectStack cloud / enterprise distribution, not the open framework. The open-core CLI recognizes `libsql://` URLs but **fails loudly** (`UnsupportedDriverError`) |

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
```

---

## Adapter Selection Guide

The HTTP layer is Hono-based. Two packages exist:

| Package | Export | Use When |
|:--------|:-------|:---------|
| `@objectstack/hono` | `createHonoApp({ kernel, prefix })` | You own the server: embed ObjectStack routes in your own Hono app / deploy target. |
| `@objectstack/plugin-hono-server` | `HonoServerPlugin` | ObjectStack owns the server: a kernel plugin that hosts the Hono app and opens the listening socket (this is what `os dev` / `os serve` register). |

There are **no** `@objectstack/adapter-*` packages (no adapter-express /
-fastify / -nextjs / -nuxt / -nestjs / -sveltekit). To integrate another
framework, mount the Hono app (a web-standard `fetch` handler) or call the
dispatcher yourself.

### Usage Pattern (Hono)

```typescript
import { createHonoApp } from '@objectstack/hono';

const app = createHonoApp({
  kernel,                    // ObjectKernel instance
  prefix: '/api',            // API route prefix (default: '/api')
});

export default app;          // Deploy to Cloudflare Workers, Deno, Bun, Node
```

### Architecture

`createHonoApp` follows this architecture:

1. Accept a `kernel` (ObjectKernel) instance
2. Create an `HttpDispatcher` internally
3. Mount explicit routes for auth and discovery
4. Delegate everything else to the dispatcher

This means **new routes added to HttpDispatcher work automatically**
without adapter code changes.

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
  4. Auto-detect and register plugins (in this order):
     ├── ObjectQLPlugin (if objects defined)
     ├── DriverPlugin (memory in dev, SQL in prod)
     ├── AppPlugin (loads the defineStack bundle)
     ├── I18nServicePlugin (if translations/i18n defined)
     ├── HonoServerPlugin (registered BEFORE AuthPlugin — the server must
     │     exist for plugins that mount routes during init/start)
     ├── AuthPlugin
     ├── Split platform-app plugins (ADR-0048, optional/best-effort, after AuthPlugin):
     │     @objectstack/setup → createSetupAppPlugin   (first-run wizard)
     │     @objectstack/account → createAccountAppPlugin
     │     (@objectstack/studio is intentionally NOT default-loaded — the
     │      Console, mounted at /_console/ by `--ui`, ships its own Studio
     │      surface at /_console/studio/…)
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
      mode: 'upsert',              // 'upsert' | 'insert' | 'update' | 'ignore' | 'replace'
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
| `update` | Only update found records; ignore new ones |
| `ignore` | Insert if not exists, skip otherwise |
| `replace` | Drop and re-insert all records |

---

## CLI Commands

Daily commands are covered in **Part 3 — Operations** below
([jump there](#part-3--operations-cli-testing-deployment)). High-level cheat
sheet for the bootstrap loop:

```bash
npx create-objectstack my-app
cd my-app && npm install
os dev --ui          # dev server + Console at /_console/ (auto-hops port if taken)
os validate          # metadata cross-reference checks
os compile           # produce dist/ artifact
os migrate plan      # preview metadata↔DB schema drift (additive sync never alters existing columns)
os migrate apply     # reconcile DB to metadata (loosening only; --allow-destructive for drops/tightenings)
PORT=8080 os start   # production — pin the port explicitly (see Ports & networking)
```

---

## Complete Working Example

A minimal but complete project from scratch:

**`package.json`** (mirrors the `blank` template):
```json
{
  "name": "my-todo-app",
  "type": "module",
  "scripts": {
    "dev": "objectstack dev",
    "start": "objectstack start",
    "build": "objectstack build",
    "validate": "objectstack validate"
  },
  "dependencies": {
    "@objectstack/spec": "^16.0.0-rc.1",
    "@objectstack/runtime": "^16.0.0-rc.1",
    "@objectstack/driver-memory": "^16.0.0-rc.1",
    "@objectstack/plugin-hono-server": "^16.0.0-rc.1"
  },
  "devDependencies": {
    "@objectstack/cli": "^16.0.0-rc.1",
    "typescript": "^6.0.0"
  }
}
```

**`src/objects/task.object.ts`**:
<!-- os:check -->
```typescript
import { Field } from '@objectstack/spec/data';

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
# → Server at http://localhost:3000 (default port; dev auto-hops if taken)
# → REST API at http://localhost:3000/api
# → Console at http://localhost:3000/_console/
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
- **[Hooks & Events](./rules/plugin-hooks-events.md)** — Kernel hooks & events reference (record-level lifecycle hooks → [objectstack-data](../objectstack-data/SKILL.md))

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
| **Dependency resolution** | Topological sort + circular detection (throws) | Topological sort (throws on cycles) |
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
// Register a kernel hook handler
ctx.hook('kernel:ready', async () => {
  ctx.logger.info('System is ready!');
});

// React to a metadata hot-reload / publish
ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
  ctx.logger.info('Metadata reloaded', { changed: payload?.changed });
});

// Trigger a custom hook
await ctx.trigger('my-plugin:initialized', { version: '1.0.0' });
```

Built-in kernel events: `kernel:ready`, `kernel:bootstrapped`,
`kernel:listening`, `kernel:shutdown`, `app:seeded`, `metadata:reloaded`,
`external.schema.drift`.

> **⚠️ There are no `data:*` kernel hooks.** Record-level lifecycle logic
> (beforeInsert / afterUpdate / …) runs on the **ObjectQL engine**, not the
> kernel event bus — author it via the `hooks:` collection or
> `ql.on('beforeInsert', 'task', async (ctx) => { … })` (see
> **objectstack-data**). Because `ctx.hook()` accepts any string, a handler
> registered for `'data:beforeInsert'` will register successfully and then
> **silently never fire**. Kernel hooks are for platform lifecycle only.

See [rules/plugin-hooks-events.md](./rules/plugin-hooks-events.md) for the kernel event list, payloads, and patterns.

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
// src/plugins/audit.ts
import type { Plugin, PluginContext } from '@objectstack/core';

interface AuditEntry {
  timestamp: string;
  event: string;
  detail?: Record<string, unknown>;
}

class AuditService {
  private log: AuditEntry[] = [];

  record(event: string, detail?: Record<string, unknown>) {
    this.log.push({ timestamp: new Date().toISOString(), event, detail });
  }

  getLog(): AuditEntry[] {
    return [...this.log];
  }
}

const AuditPlugin: Plugin = {
  name: 'com.example.audit',
  version: '1.0.0',
  type: 'plugin',

  async init(ctx: PluginContext) {
    // Phase 1: Register service and kernel hooks
    const auditService = new AuditService();
    ctx.registerService('audit', auditService);

    ctx.hook('kernel:ready', async () => {
      auditService.record('kernel:ready');
    });

    ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
      auditService.record('metadata:reloaded', { changed: payload?.changed });
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

> To audit **record writes** (who inserted/updated which record), register
> engine lifecycle hooks instead — e.g.
> `ctx.getService('objectql').on('afterInsert', 'task', async (hookCtx) => …)`
> in `start()`, or the declarative `hooks:` collection. See
> **objectstack-data** for the engine hook contract.

---

## Using Plugins

```typescript
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { DriverPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';
import AuditPlugin from './plugins/audit';

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
import type { PluginContext } from '@objectstack/core';
import AuditPlugin from './audit';

describe('AuditPlugin', () => {
  it('records kernel lifecycle events', async () => {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    kernel.use(AuditPlugin);

    // `kernel.context` is protected — to fire events in a test, capture a
    // PluginContext from a probe plugin instead.
    let probe!: PluginContext;
    kernel.use({ name: 'test.probe', init(ctx) { probe = ctx; } });

    await kernel.bootstrap();   // fires kernel:ready → recorded

    // Simulate a metadata hot-reload announcement
    await probe.trigger('metadata:reloaded', { changed: ['object/task'] });

    const audit = kernel.getService<{ getLog(): { event: string }[] }>('audit');
    const events = audit.getLog().map((e) => e.event);
    expect(events).toContain('kernel:ready');
    expect(events).toContain('metadata:reloaded');

    await kernel.shutdown();
  });
});
```

---

## Well-Known Plugin Names & Services

| Plugin Name | Service Key | Package |
|:------------|:------------|:--------|
| `com.objectstack.engine.objectql` | `objectql` (also `data`) | `@objectstack/objectql` |
| `com.objectstack.driver.*` | `driver.{name}` | `@objectstack/driver-*` |
| `com.objectstack.auth` | `auth` | `@objectstack/plugin-auth` |
| `com.objectstack.rest.api` | — (registers no service) | `@objectstack/rest` |
| `com.objectstack.metadata` | `metadata` | `@objectstack/metadata` |
| `com.objectstack.service.realtime` | `realtime` | `@objectstack/service-realtime` |
| `com.objectstack.service.cache` | `cache` | `@objectstack/service-cache` |
| `com.objectstack.server.hono` | — | `@objectstack/plugin-hono-server` → `HonoServerPlugin` |
| `com.objectstack.setup` | — | `@objectstack/setup` → `createSetupAppPlugin` (ADR-0048 one-app pkg) |
| `com.objectstack.studio` | — | `@objectstack/studio` → `createStudioAppPlugin` |
| `com.objectstack.account` | — | `@objectstack/account` → `createAccountAppPlugin` |
| `com.objectstack.cloud.connection` | — | `@objectstack/cloud-connection` → `createCloudConnectionPlugin` |

---

## MetadataPlugin Runtime Boundary

`MetadataPlugin` is the `IMetadataService` provider for the ObjectStack runtime, but runtime
metadata is read-only and artifact/file backed:

- Do **not** register `sys_metadata` or `sys_metadata_history` from an ObjectStack
  runtime plugin. Those persistence tables belong to the control plane.
  (Exception: an *isolated project kernel* may opt into `sys_metadata`
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

Feature flags are **not a spec/metadata concept**. There is no `featureFlags:` /
`features:` key on `defineStack` (writing one is refused at load, not stripped), and the
former `FeatureFlagSchema` (`@objectstack/spec/kernel`) was removed — it had zero runtime
consumers, and its only protocol home (the static `ObjectStackCapabilities.system.features`
descriptor) was itself dead: no endpoint ever served it. Runtime capability discovery is
`GET /api/v1/discovery`.

The live toggle surfaces are runtime configuration, not authored metadata:

- **`feature_flags` settings manifest** (`@objectstack/service-settings`) — org-tunable
  toggles like `ai_enabled` / `beta_*`, resolvable at runtime and env-overridable via
  `OS_FEATURE_FLAGS_*` (ADR-0007 settings cascade).
- **Auth capability gates** — `requiresFeature` on actions/params lowers to the
  `PUBLIC_AUTH_FEATURES` registry (`kernel/public-auth-features.ts`), the fixed
  deployment-level flags plugin-auth advertises to anonymous clients.

---
---

# Part 3 — Operations: CLI, Testing, Deployment

The `@objectstack/cli` package ships an `os` binary (alias: `objectstack`).
Every project gets the same command surface — `npm install` does not need to
be re-run when commands are added.

## Daily-loop commands

| Command | What it does |
|:--------|:-------------|
| `os init` | Scaffold a new project (alternative to `npx create-objectstack`) |
| `os dev` | Start the dev server with hot metadata reload. `--seed-admin` (default **on** for plain `os dev`) seeds a loginable dev admin **in-process via the runtime** (env vars `OS_SEED_ADMIN*`) on an **empty** DB only — idempotent, never overwrites an existing account (default `admin@objectos.ai` / `admin123`; override with `--admin-email` / `--admin-password`; disable with `--no-seed-admin`). `--fresh` = ephemeral clean OS_HOME/DB, implies `--seed-admin`. The seeded admin is promoted to **platform admin**, so Setup/Studio work on first login. |
| `os dev --ui` | Also mount the bundled Console portal at `/_console/` (there is no separate `os studio` command) |
| `os validate` | Validate `objectstack.config.ts` — Zod protocol schema, CEL/predicate validation (`record.<field>` existence), and widget-binding integrity. Same gates as `os build`, no artifact emitted. See [Verify your work](#verify-your-work). |
| `os lint` | Style/convention lint on metadata files |
| `os info` | Print a metadata summary of the config (objects, apps, and other collections; `--json`) |
| `os doctor` | Diagnose common setup issues |

## Build & runtime

| Command | What it does |
|:--------|:-------------|
| `os build` | Compile TS metadata, bundle, and produce `dist/` |
| `os compile` | Compile to portable JSON artifact (for runtime hydration) |
| `os serve` | Serve a compiled stack in production mode |
| `os start` | Quick-start a server: auto-compiles `objectstack.config.ts` when no artifact is present, and falls back to an empty kernel with the Console + marketplace when there is no config at all. It does **not** validate env or apply migrations — run `os validate` / `os migrate apply` yourself |
| `os generate <kind>` | Scaffold an object / view / flow / agent from a template |

## Verify your work

ObjectStack metadata mistakes fail **silently at runtime**, not at edit time:
a bare field ref in a predicate (`done` instead of `record.done`) evaluates to
`null` and silently hides an action/validation on every record; a
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
| `os data create` / `get` / `query` / `update` / `delete` | Record-level CRUD against a running server (there is no `os data seed` / `export` / `import` — seed data in the `data:` collection loads automatically at boot) |
| `os diff` | Compare two ObjectStack config files and detect breaking changes |
| `os meta register` / `os meta resync` | Register (create/update) metadata on a target server / re-sync it (there is no `os meta apply`) |
| `os migrate plan` / `os migrate apply` | Dry-run / apply physical-DB drift reconciliation from metadata (forward-only — no batch rollback; `os rollback` was removed) |

## Environments & deploy

| Command | What it does |
|:--------|:-------------|
| `os login` / `logout` / `whoami` | Auth against the ObjectStack cloud control plane |
| `os environments list` / `create` / `switch` | Manage cloud environments (prod/staging/dev) |
| `os register` | Register the local stack as a deployable target |
| `os cloud login` / `logout` / `whoami` | Cloud auth subcommands (these three only — there are no `os cloud logs/metrics/status`) |
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
plugin discovery, so tests run in milliseconds. Assemble the same plugins the
CLI would auto-register (`use()` is synchronous and chainable):

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';
import stack from '../objectstack.config';

describe('stack boot', () => {
  it('registers the task object', async () => {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    kernel
      .use(new ObjectQLPlugin())
      .use(new DriverPlugin(new InMemoryDriver()))
      .use(new AppPlugin(stack));
    await kernel.bootstrap();

    const ql = kernel.getService<any>('objectql');
    // query / mutate through the engine — see objectstack-query for the API
    expect(ql).toBeDefined();

    await kernel.shutdown();
  });
});
```

- **Seed in tests:** declare fixtures in the stack's `data:` collection —
  they load at boot. See **objectstack-data** for env-scoped fixtures
  (`env: ['test']`).
- **Reset between tests:** create a fresh `LiteKernel` per test — with the
  in-memory driver a full bootstrap is cheap, and there is no `reset()`.
- **HTTP-level tests:** mount `createHonoApp({ kernel })` from
  `@objectstack/hono` and drive it with `app.request(...)` / `fetch`.

## Deployment targets

| Target | Driver | HTTP layer | Notes |
|:-------|:-------|:-----------|:------|
| Node.js server | `driver-sql` (`pg` / `mysql` / `better-sqlite3`) | `plugin-hono-server` / `@objectstack/hono` | Default — works anywhere Node runs |
| Edge (Cloudflare Workers, Vercel Edge) | `driver-turso` (**cloud / EE only**) | `@objectstack/hono` | Cold-start friendly; LiteKernel only |
| Serverless (Lambda, Vercel functions) | `driver-sql` (`pg` with pooler) / `driver-mongodb` | `@objectstack/hono` | Mind cold-start: prefer LiteKernel |
| Browser / WebContainer | `driver-sqlite-wasm` | none (in-process) | Playground, demos |
| Docker / Kubernetes | any | any | Use `os start` as the entrypoint; pin `PORT` and `EXPOSE` it (see [Ports & networking](#ports--networking)) |

## Health & observability

- **Health endpoints:** the HTTP dispatcher exposes `GET /health` and
  `GET /ready` under the API prefix (see "Health Monitoring"
  earlier in this skill).
- **Logs:** plugins log via `ctx.logger`. Logger config is a **kernel
  construction** option, not a `defineStack` key:
  `new ObjectKernel({ logger: { level: 'info', format: 'json' } })`.
- **Metrics:** use the kernel's built-ins — `kernel.getPluginMetrics()`
  (per-plugin startup durations) and `await kernel.checkAllPluginsHealth()`.
  There is no `metrics` service and no `@objectstack/plugin-prometheus`.

## Common ops pitfalls

| Symptom | Likely cause |
|:--------|:-------------|
| `os dev` hangs at "Loading metadata…" | Circular import in `objectstack.config.ts` — run `os validate` |
| `os start` exits with "Port N is already in use" | Intended: production never auto-shifts ports. Free the port or set `PORT=<n>` — see [Ports & networking](#ports--networking) |
| better-auth `Invalid origin` 403 after a port/host change | Port or hostname out of sync with `OS_AUTH_URL` / `OS_TRUSTED_ORIGINS` — see [Ports & networking](#ports--networking) |
| Migrations apply locally but not in cloud | `env` scoping on the dataset excludes the target environment |
| Adapter 404s on auto-generated routes | `enable.apiEnabled: false` on the object, or missing `os build` |
| LiteKernel test passes, ObjectKernel boot fails | Test missed a plugin the CLI auto-registers — compare your test's `use()` list against the `os dev` boot log |
| Hot reload misses new objects | Barrel `src/objects/index.ts` not re-exporting — check the file |
| Login works but **Setup / Studio missing** | The logged-in user isn't a platform admin. Setup/Studio are gated by `setup.access` / `studio.access` on `admin_full_access`, auto-granted only to the first registered **human** (`bootstrapPlatformAdmin`). The `usr_system` seed identity is skipped, so it can't steal the grant. Either sign up first (`--seed-admin`/`--fresh` does this) or check `sys_user_permission_set` for a cross-tenant (`organization_id = NULL`) `admin_full_access` link on your user. Don't edit nav code first. |
| A permission set is declared but grants nobody anything | Declaring a set is not assigning it. Assignment is a `sys_user_permission_set` row whose `permission_set_id` is the `sys_permission_set` **record id**, never the set's `name` — see "Assigning a permission set to a user" in **objectstack-data**. |

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

