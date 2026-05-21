# ObjectStack

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
![Version](https://img.shields.io/badge/version-v4.0.1-green.svg)
![Tests](https://img.shields.io/badge/tests-6%2C507%20passing-brightgreen.svg)

> The AI-native business backend: define business objects, permissions, workflows, APIs, UI metadata, and agent tools once as structured Zod metadata.

## What is ObjectStack?

ObjectStack is a metadata-driven backend for building business applications that AI agents can understand, operate, and audit safely.

Instead of hiding business logic inside ad-hoc SQL queries, UI state, or JavaScript strings, ObjectStack makes the business system explicit:

- **Business objects** are Zod schemas with typed fields, relations, validation, and permissions.
- **Business actions** are generated from metadata as REST APIs, SDK calls, and MCP tools.
- **Business logic** is represented as analyzable metadata: flows, conditions, policies, and artifacts.
- **Business runtime** is a microkernel that loads plugins, drivers, services, and compiled project artifacts.

The goal is not to be another low-code UI builder. ObjectStack is the structured execution layer for AI-native business software: agent-ready, permission-aware, versioned, and auditable.

ObjectStack is built around three protocol layers:

- **ObjectQL** (Data Layer) — Objects, fields, queries, relations, validation, and data access.
- **ObjectOS** (Control Layer) — Runtime, permissions, automation, plugins, tenants, and artifact loading.
- **ObjectUI** (View Layer) — Apps, views, dashboards, actions, and presentation metadata.

All core definitions start with **Zod schemas** (1,600+ exported schemas across 200 schema files). TypeScript types, JSON Schemas, REST routes, UI metadata, and agent tools are derived from the same source of truth.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full microkernel and layer architecture documentation.

## Key Features

- **Agent-ready metadata** — Business objects, actions, and permissions are explicit enough for AI agents to inspect and use.
- **Automatic tool surface** — Metadata can power REST APIs, client SDKs, UI views, and MCP tools without redefining each action by hand.
- **Protocol-first schemas** — All schemas are defined with Zod; TypeScript types are derived via `z.infer<>`.
- **Versioned JSON artifacts** — TypeScript-authored metadata compiles into deployable, self-describing JSON artifacts.
- **Microkernel plugin system** — DI container, EventBus, and lifecycle hooks (init -> start -> destroy).
- **Multi-database support** — In-memory, PostgreSQL, MySQL, SQLite, and Turso/libSQL drivers.
- **7 framework adapters** — Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit.
- **Client SDK + React hooks** — `useQuery`, `useMutation`, `usePagination` out of the box.
- **Built-in authentication** — [better-auth](https://www.better-auth.com/) via `plugin-auth`.
- **RBAC / RLS / FLS security** — Role-based, row-level, and field-level access control.
- **Automation engine** — DAG-based flows, triggers, and workflow management.
- **AI service** — Agent, Tool, and Skill protocol built on the Vercel AI SDK.
- **Studio IDE** — Web-based metadata explorer, schema inspector, API console, and AI assistant.
- **CLI toolchain** — `os init`, `os dev`, `os studio`, `os serve`, `os validate`, and more.

## Why AI-native?

Most internal-tool and low-code platforms were designed for humans clicking screens. AI support is usually added later as a chat box that can call a few predefined queries.

ObjectStack starts from a different assumption: AI agents need a structured, bounded, and auditable business backend before they can safely perform real work.

| Dimension | Retool / Appsmith-style tools | ObjectStack |
| :--- | :--- | :--- |
| Business model | Implicit in pages, queries, and scripts | Explicit Zod `ObjectSchema` metadata |
| Business logic | JavaScript snippets and query glue | Flows, policies, conditions, and typed metadata |
| External contract | App-specific UI state | Self-describing JSON Project Artifact |
| Agent tools | Manually defined one by one | Generated from metadata and permissions |
| Agent reasoning | Calls predefined queries | Reads schema, composes safe actions, respects boundaries |
| Governance | App-level conventions | Auth, RBAC, RLS, FLS, audit, and versioned artifacts |

This makes ObjectStack a backend substrate for AI-native business applications: CRM agents, support agents, operations agents, workflow agents, and internal tools that must act on real business data without bypassing permissions or audit trails.

## Quick Start

### For Application Developers

```bash
# Create a new project
npx @objectstack/cli init my-app
cd my-app

# Start development server
os dev

# Open Studio IDE
os studio
# → API:    http://localhost:3000/api/v1/
# → Studio: http://localhost:3000/_studio/
```

### For Framework Contributors

```bash
# 1. Clone and install
git clone https://github.com/objectstack-ai/framework.git
cd framework
pnpm install

# 2. Build all packages
pnpm build

# 3. Run tests
pnpm test

# 4. Start Documentation site
pnpm docs:dev
# → http://localhost:3000/docs
```

## Monorepo Scripts

| Script | Description |
| :--- | :--- |
| `pnpm build` | Build all packages (excludes docs) |
| `pnpm dev` | Start development server |
| `pnpm studio` | Launch Studio IDE with dev server |
| `pnpm test` | Run all tests |
| `pnpm doctor` | Check environment health |
| `pnpm setup` | Install dependencies and build spec |
| `pnpm docs:dev` | Start documentation site locally |
| `pnpm docs:build` | Build documentation for production |

## CLI Commands

```bash
os init [name]    # Scaffold a new project
os dev            # Start dev server with hot-reload
os studio         # Start dev server + Studio IDE
os serve          # Start production server
os compile        # Build deployable JSON artifact
os validate       # Validate configuration against protocol
os info           # Display metadata summary
os generate       # Scaffold objects, views, and flows
os doctor         # Check environment health
```

## Package Directory

### Core

| Package | Description |
| :--- | :--- |
| [`@objectstack/spec`](packages/spec) | Protocol definitions — Zod schemas, TypeScript types, JSON Schemas, constants |
| [`@objectstack/core`](packages/core) | Microkernel runtime — Plugin system, DI container, EventBus, Logger |
| [`@objectstack/types`](packages/types) | Shared TypeScript type utilities |

### Engine

| Package | Description |
| :--- | :--- |
| [`@objectstack/objectql`](packages/objectql) | ObjectQL query engine and schema registry |
| [`@objectstack/runtime`](packages/runtime) | Runtime bootstrap — DriverPlugin, AppPlugin |
| [`@objectstack/metadata`](packages/metadata) | Metadata loading and persistence |
| [`@objectstack/rest`](packages/rest) | Auto-generated REST API layer |

### Drivers

| Package | Description |
| :--- | :--- |
| [`@objectstack/driver-memory`](packages/plugins/driver-memory) | In-memory driver (development and testing) |
| [`@objectstack/driver-sql`](packages/plugins/driver-sql) | SQL driver — PostgreSQL, MySQL, SQLite (production) |
| [`@objectstack/driver-turso`](packages/plugins/driver-turso) | Turso/libSQL driver |

### Client

| Package | Description |
| :--- | :--- |
| [`@objectstack/client`](packages/client) | Client SDK — CRUD, batch API, error handling |
| [`@objectstack/client-react`](packages/client-react) | React hooks — `useQuery`, `useMutation`, `usePagination` |

### Plugins

| Package | Description |
| :--- | :--- |
| [`@objectstack/plugin-hono-server`](packages/plugins/plugin-hono-server) | Hono-based HTTP server plugin |
| [`@objectstack/plugin-mcp-server`](packages/plugins/plugin-mcp-server) | Model Context Protocol server — exposes ObjectStack to AI agents |
| [`@objectstack/plugin-msw`](packages/plugins/plugin-msw) | Mock Service Worker plugin for browser testing |
| [`@objectstack/plugin-auth`](packages/plugins/plugin-auth) | Authentication plugin (better-auth) |
| [`@objectstack/plugin-security`](packages/plugins/plugin-security) | RBAC, Row-Level Security, Field-Level Security |
| [`@objectstack/plugin-dev`](packages/plugins/plugin-dev) | Developer mode — in-memory stubs for all services |
| [`@objectstack/plugin-audit`](packages/plugins/plugin-audit) | Audit logging plugin |
| [`@objectstack/plugin-setup`](packages/plugins/plugin-setup) | First-run setup wizard |

### Services

| Package | Description |
| :--- | :--- |
| [`@objectstack/service-ai`](packages/services/service-ai) | AI service — Agent, Tool, Skill, Vercel AI SDK integration |
| [`@objectstack/service-analytics`](packages/services/service-analytics) | Analytics — aggregations, time series, funnels, dashboards |
| [`@objectstack/service-automation`](packages/services/service-automation) | Automation engine — flows, triggers, DAG-based workflows |
| [`@objectstack/service-cache`](packages/services/service-cache) | Cache — in-memory, Redis, multi-tier |
| [`@objectstack/service-feed`](packages/services/service-feed) | Activity feed / chatter |
| [`@objectstack/service-i18n`](packages/services/service-i18n) | Internationalization service |
| [`@objectstack/service-job`](packages/services/service-job) | Cron & interval job scheduler |
| [`@objectstack/service-package`](packages/services/service-package) | Package registry — publish, version, retrieve metadata packages |
| [`@objectstack/service-queue`](packages/services/service-queue) | Background job queue (in-memory, BullMQ) |
| [`@objectstack/service-realtime`](packages/services/service-realtime) | Real-time events and subscriptions |
| [`@objectstack/service-storage`](packages/services/service-storage) | File storage (local, S3, R2, GCS) |
| [`@objectstack/service-tenant`](packages/services/service-tenant) | Multi-tenant context and routing |

### Framework Adapters

| Package | Description |
| :--- | :--- |
| [`@objectstack/express`](packages/adapters/express) | Express adapter |
| [`@objectstack/fastify`](packages/adapters/fastify) | Fastify adapter |
| [`@objectstack/hono`](packages/adapters/hono) | Hono adapter (Node.js, Bun, Deno, Cloudflare Workers) |
| [`@objectstack/nestjs`](packages/adapters/nestjs) | NestJS module integration |
| [`@objectstack/nextjs`](packages/adapters/nextjs) | Next.js App Router adapter |
| [`@objectstack/nuxt`](packages/adapters/nuxt) | Nuxt adapter (h3-based) |
| [`@objectstack/sveltekit`](packages/adapters/sveltekit) | SvelteKit adapter |

### Tools & Apps

| Package | Description |
| :--- | :--- |
| [`@objectstack/cli`](packages/cli) | CLI — `init`, `dev`, `serve`, `studio`, `compile`, `validate`, `generate` |
| [`create-objectstack`](packages/create-objectstack) | Project scaffolder (`npx create-objectstack`) |
| [`objectstack-vscode`](packages/vscode-objectstack) | VS Code extension — autocomplete, validation, diagnostics |
| [`@objectstack/studio`](apps/studio) | Studio IDE — metadata explorer, schema inspector, AI assistant |
| [`@objectstack/docs`](apps/docs) | Documentation site (Fumadocs + Next.js) |

### Examples

| Example | Description | Level |
| :--- | :--- | :--- |
| [`@example/app-todo`](examples/app-todo) | Task management app — objects, views, dashboards, flows | Beginner |
| [`@example/app-crm`](examples/app-crm) | Enterprise CRM — accounts, contacts, opportunities, leads | Intermediate |
| [`@objectstack/objectos`](apps/objectos) | ObjectOS Runtime — multi-app orchestration with plugins | Advanced |

## Codebase Metrics

| Metric | Value |
| :--- | :--- |
| Packages | 42 |
| Zod schema files | 200 |
| Exported schemas | 1,600+ |
| `.describe()` annotations | 8,750+ |
| Service contracts | 27 |
| Test files | 229 |
| Tests passing | 6,507 |

## Architecture

ObjectStack uses a **microkernel architecture** where the kernel provides only the essential infrastructure (DI, EventBus, lifecycle), and all capabilities are delivered as plugins. The three protocol layers sit above the kernel:

```
┌─────────────────────────────────────────────────────┐
│              ObjectKernel (Core)                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Plugin Lifecycle Manager                     │  │
│  │  • Dependency Resolution (Topological Sort)   │  │
│  │  • Init → Start → Destroy Phases              │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Service Registry (DI Container)              │  │
│  │  • registerService(name, service)             │  │
│  │  • getService<T>(name): T                     │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Event Bus (Hook System)                      │  │
│  │  • hook(name, handler)                        │  │
│  │  • trigger(name, ...args)                     │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
              │
    ┌─────────┴─────────┬──────────┬──────────┐
    │                   │          │          │
┌───▼────┐      ┌───────▼──┐   ┌──▼───┐  ┌───▼────┐
│ObjectQL│      │  Driver  │   │ Hono │  │  App   │
│ Plugin │      │  Plugin  │   │Server│  │ Plugin │
└────────┘      └──────────┘   └──────┘  └────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete design documentation including the plugin lifecycle state machine, dependency graph, and design decisions.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the planned phases covering runtime hardening, framework adapter completion, developer experience improvements, performance optimization, and security hardening.

Studio-specific roadmap: [apps/studio/ROADMAP.md](./apps/studio/ROADMAP.md)

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow, coding standards, testing requirements, and documentation guidelines.

Key standards:
- **Zod-first** — all schemas start with Zod; TypeScript types are derived via `z.infer<>`
- **camelCase** for configuration keys (e.g., `maxLength`, `defaultValue`)
- **snake_case** for machine names / data values (e.g., `project_task`, `first_name`)

## Documentation

Full documentation: **[https://docs.objectstack.ai](https://docs.objectstack.ai)**

Run locally: `pnpm docs:dev`

## License

Apache 2.0 © ObjectStack
