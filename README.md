# ObjectStack

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-v4.0.1-green.svg)
![Tests](https://img.shields.io/badge/tests-6%2C507%20passing-brightgreen.svg)

> **A metadata protocol and TypeScript toolkit for AI-native business apps.** Describe your objects, permissions, workflows, APIs, UI, and AI tools once as typed, version-controlled Zod metadata — and ObjectStack derives the TypeScript types, REST API, client SDK, UI, and MCP tools from that single definition.

This repo is the **framework**: the protocol, kernel, SDK, CLI, and production runtime you build — and ship — with. `os start` or the official Docker image [`ghcr.io/objectstack-ai/objectstack`](./docker) runs your compiled app in production, Console and governance included, entirely on open source.  · Try a live app in ~30s on [StackBlitz](https://stackblitz.com/github/objectstack-ai/hotcrm) (no install).

<p align="center">
  <img src="docs/screenshots/architecture.png" width="940" alt="ObjectStack architecture: author typed Zod metadata (objects, flows, views, policies); the microkernel compiles it into a versioned JSON artifact and loads plugins, drivers, and services; it generates a REST API, client SDK, Console and Studio UI, and MCP tools used by developers and AI agents, governed by Auth, RBAC, RLS, FLS, and audit, over PostgreSQL, MySQL, SQLite, or MongoDB">
  <br><sub>One typed definition → TypeScript types, REST API, client SDK, UI, and MCP tools.</sub>
</p>

## What is ObjectStack?

ObjectStack is an **open-source** (Apache-2.0) metadata protocol and toolkit for *describing* business applications — so one typed definition powers your data model, API, UI, and AI tools — plus the production runtime that serves them. AI operates your app under your permissions through the built-in MCP server.

Instead of hiding business logic inside ad-hoc SQL queries, UI state, or JavaScript strings, ObjectStack makes the business system explicit:

- **Business objects** are Zod schemas with typed fields, relations, validation, and permissions.
- **Business actions** are generated from metadata as REST APIs, SDK calls, and MCP tools.
- **Business logic** is represented as analyzable metadata: flows, conditions, policies, and artifacts.
- **Business runtime** is a microkernel that loads plugins, drivers, services, and compiled environment artifacts.

The goal is not to be another low-code UI builder. ObjectStack is the structured *definition* layer for AI-native business software — agent-ready, versioned, and analyzable; permissions and audit are enforced by the runtime.

ObjectStack is built around three layers:

- **ObjectQL** (Data Layer) — Objects, fields, queries, relations, validation, and data access.
- **Kernel** (Control Layer) — Runtime, permissions, automation, plugins, environments, and artifact loading.
- **ObjectUI** (View Layer) — Apps, views, dashboards, actions, and presentation metadata.

All core definitions start with **Zod schemas** (1,600+ exported schemas across 200 schema files). TypeScript types, JSON Schemas, REST routes, UI metadata, and agent tools are derived from the same source of truth.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full microkernel and layer architecture documentation, and [content/docs/concepts/north-star.mdx](./content/docs/concepts/north-star.mdx) for the product north star (metadata protocols · environment-aware runtime · compiled app artifacts).

## Author your app — in code or in Studio

Everything is **typed metadata**. Define a business object once — fields, a color-coded picklist, validation — all declarative:

```ts
import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Task = ObjectSchema.create({
  name: 'todo_task',
  label: 'Task',
  fields: {
    subject: Field.text({ label: 'Subject', required: true, searchable: true }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'In Progress', value: 'in_progress', color: '#3B82F6' },
        { label: 'Completed', value: 'completed', color: '#10B981' },
      ],
    }),
    due_date: Field.date({ label: 'Due Date' }),
  },
});
```

From that single schema, ObjectStack derives the database table, an auto-generated REST API and typed client SDK, UI views (list, board, calendar, Gantt…), and MCP tools for agents — all from one definition.

Prefer clicking? Author the same metadata visually in **Studio** — objects, relations, validation, and flows — and it compiles to the exact same artifacts:

<p align="center">
  <img src="docs/screenshots/modeling.png" width="49%" alt="Studio object designer showing the Opportunity object's typed fields, lookups, and layout sections">
  <img src="docs/screenshots/automation.png" width="49%" alt="Studio flow designer showing a visual DAG that enrolls leads into a campaign">
</p>
<p align="center"><sub><b>Model</b> objects as typed metadata &nbsp;·&nbsp; <b>Automate</b> with visual flows — both produce the same analyzable metadata.</sub></p>

> **Want to see it running?** `os dev` serves the live Console locally, and `os start` (or the official Docker image) ships the same Console to production — dashboards, boards, calendars, records, and AI working your data under your permissions.

## Key Features

- **AI-native, not retrofitted** — Objects, permissions, flows, APIs, and UI are declarative typed metadata, small enough for an agent to load end-to-end. That metadata generates an automatic tool surface — REST APIs, client SDKs, UI views, and an [MCP](packages/mcp) server — so agents inspect and act through the same contracts you defined.
- **Protocol-first runtime** — Every definition starts as a Zod schema (`z.infer<>` types), compiles into versioned, self-describing JSON artifacts, and runs on a microkernel plugin system (DI container, EventBus, `init → start → destroy` lifecycle).
- **Data & framework reach** — In-memory, PostgreSQL, MySQL, SQLite, and MongoDB drivers; 7 framework adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit); a client SDK with React hooks (`useQuery` / `useMutation` / `usePagination`).
- **Governance & built-ins** — better-auth, RBAC / RLS / FLS, a DAG-based automation engine, an [MCP](packages/mcp) server that exposes the app to your own AI (BYO-AI), the ObjectUI Console, and a full CLI (`os init` / `dev` / `compile` / `validate` / …).

## Why AI-native?

Most internal-tool and low-code platforms were designed for humans clicking screens. AI support is usually added later as a chat box that can call a few predefined queries. ObjectStack starts from a different assumption: **AI agents need a structured, bounded, and auditable business backend before they can safely perform real work** — and the entire business system has to be small enough to fit in an agent's context window.

A typical enterprise application is tens of thousands of lines of CRUD, forms, queries, permissions, and API glue spread across dozens of files. ObjectStack collapses the same surface into a few hundred lines of typed metadata — **roughly two orders of magnitude less code for a developer (or an AI agent) to read, write, and maintain.**

The point isn't lines of code. The point is **fit in an agent's context window.** When the entire business system is small, typed, and declarative, an AI agent can load it end-to-end, reason about every dependency, and safely refactor across data, API, UI, and permissions in a single change. That turns AI from an autocomplete tool into a real co-maintainer of production business software.

| Dimension | Retool / Appsmith-style tools | ObjectStack |
| :--- | :--- | :--- |
| Business model | Implicit in pages, queries, and scripts | Explicit Zod `ObjectSchema` metadata |
| Code footprint | Thousands of lines of queries, JS, and UI state per app | **~100× less** — declarative metadata replaces CRUD, forms, validation, and API glue |
| Business logic | JavaScript snippets and query glue | Flows, policies, conditions, and typed metadata |
| External contract | App-specific UI state | Self-describing JSON Environment Artifact |
| Agent tools | Manually defined one by one | Generated from metadata and permissions |
| Agent reasoning | Calls predefined queries | Reads the full schema, composes safe actions, respects boundaries |
| AI maintainability | Agents must crawl sprawling app code | Whole app fits in an agent's context window |
| Governance | App-level conventions | Auth, RBAC, RLS, FLS, audit, and versioned artifacts |

Described in ObjectStack and served by its runtime, this is the substrate for AI-native business apps — CRM, support, operations, and workflow agents acting on real business data without bypassing permissions or audit.

## Quick Start

### For Application Developers

```bash
# Create a new project
npx create-objectstack my-app
cd my-app

# Start dev server (REST API + console UI)
pnpm dev
# → API:    http://localhost:3000/api/v1/
# → Console: http://localhost:3000/_console/
```

Alternatively, with the CLI installed: `os init my-app && cd my-app && os dev`.

Ready for production? The scaffolded project is container-ready:

```bash
docker build -t my-app . && docker compose up -d   # app + Postgres on the official runtime image
```

See [Self-Hosted Deployment](https://objectstack.ai/docs/deployment/self-hosting) for bare Node, Kubernetes, and the secrets you must pin.

### For Framework Contributors

```bash
# 1. Clone and install
git clone https://github.com/objectstack-ai/framework.git
cd framework
pnpm install

# 2. Build all packages
pnpm build

# 4. Start ObjectStack Showcase
pnpm dev
```

## Monorepo Scripts

| Script | Description |
| :--- | :--- |
| `pnpm build` | Build all packages (excludes docs) |
| `pnpm dev` | Run the showcase kitchen-sink example (`@objectstack/example-showcase`) — REST + Studio; exercises every metadata type, view, automation, AI & security chain |
| `pnpm dev:showcase` | Same as `pnpm dev` (explicit alias) |
| `pnpm dev:crm` | Run the minimal CRM example (`@objectstack/example-crm`) |
| `pnpm dev:todo` | Run the Todo example (`@objectstack/example-todo`) |
| `pnpm objectui:refresh` | Pull the sibling `../objectui` build into `packages/console/` |
| `pnpm test` | Run all tests (Turborepo) |
| `pnpm setup` | Install dependencies and build the spec package |
| `pnpm docs:dev` | Start the documentation site locally |
| `pnpm docs:build` | Build documentation for production |

## CLI Commands

The CLI binary ships as both `os` and `objectstack`.

```bash
os init [name]    # Scaffold a new project
os create         # Interactive project / object scaffolder
os dev            # Start dev server with hot-reload (REST + console)
os start          # Start the production server
os serve          # Serve a compiled artifact
os compile        # Build a deployable JSON Environment Artifact
os validate       # Validate metadata against the protocol
os lint           # Lint metadata for best-practice violations
os info           # Display project metadata summary
os generate       # Scaffold objects, views, flows, agents, migrations
os doctor         # Check environment health
os explain        # Explain protocol concepts on the command line
```

Cloud, package registry, and environment management subcommands (`os package publish`, `os package install`, `os login`, `os whoami`, `os environments`, `os cloud …`) are available when targeting an ObjectStack Cloud control plane.

## Use the generated API

Every object ships a REST API automatically — no controllers to write:

```bash
# CRUD endpoints for the `todo_task` object you defined above
curl http://localhost:3000/api/v1/todo_task
```

For the browser, the typed client SDK and React hooks (`useQuery` / `useMutation` / `usePagination`) live in [`@objectstack/client-react`](packages/client-react). Need a new capability? Write a plugin, driver, or service against the same kernel APIs — every built-in is one (see below).

## Package Directory

<details>
<summary><b>72 published packages</b> across core, engine, drivers, client, plugins, services, adapters, tools, and examples — click to expand.</summary>

### Core

| Package | Description |
| :--- | :--- |
| [`@objectstack/spec`](packages/spec) | Protocol definitions — Zod schemas, TypeScript types, JSON Schemas, constants |
| [`@objectstack/core`](packages/core) | Microkernel runtime — Plugin system, DI container, EventBus, Logger |
| [`@objectstack/types`](packages/types) | Shared TypeScript type utilities |
| [`@objectstack/formula`](packages/formula) | Canonical expression engine — CEL (cel-js) + ObjectStack stdlib for formula fields, predicates, conditions, dynamic defaults |
| [`@objectstack/platform-objects`](packages/platform-objects) | Built-in platform object schemas — identity, security, audit, notification, package, and environment |

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
| [`@objectstack/driver-mongodb`](packages/plugins/driver-mongodb) | MongoDB driver (native document database) |

> Turso / libSQL driver (`@objectstack/driver-turso`) and the libSQL-backed vector knowledge plugin (`@objectstack/knowledge-turso`) live in the [ObjectStack Cloud](https://github.com/objectstack-ai/cloud) monorepo as of this release.

### Client

| Package | Description |
| :--- | :--- |
| [`@objectstack/client`](packages/client) | Client SDK — CRUD, batch API, error handling |
| [`@objectstack/client-react`](packages/client-react) | React hooks — `useQuery`, `useMutation`, `usePagination` |

### Plugins

| Package | Description |
| :--- | :--- |
| [`@objectstack/plugin-hono-server`](packages/plugins/plugin-hono-server) | Hono-based HTTP server plugin |
| [`@objectstack/mcp`](packages/mcp) | Model Context Protocol server — exposes ObjectStack to AI agents |
| [`@objectstack/plugin-auth`](packages/plugins/plugin-auth) | Authentication plugin (better-auth) |
| [`@objectstack/plugin-security`](packages/plugins/plugin-security) | RBAC, Row-Level Security, Field-Level Security |
| [`@objectstack/plugin-sharing`](packages/plugins/plugin-sharing) | Record-level sharing — `sys_record_share` + enforcement middleware |
| [`@objectstack/plugin-approvals`](packages/plugins/plugin-approvals) | Approval as a flow node — approver resolution, record lock & status mirror over `sys_approval_request` + `sys_approval_action` |
| [`@objectstack/plugin-audit`](packages/plugins/plugin-audit) | Audit logging plugin |
| [`@objectstack/plugin-email`](packages/plugins/plugin-email) | Pluggable outbound email transport |
| [`@objectstack/plugin-webhooks`](packages/plugins/plugin-webhooks) | Outbound webhook delivery — fan-out `data.record.*` events |
| [`@objectstack/plugin-reports`](packages/plugins/plugin-reports) | Saved reports + scheduled email digests |
| [`@objectstack/plugin-dev`](packages/plugins/plugin-dev) | Developer mode — in-memory stubs for all services |

### Services

| Package | Description |
| :--- | :--- |
| [`@objectstack/service-analytics`](packages/services/service-analytics) | Analytics — aggregations, time series, funnels, dashboards |
| [`@objectstack/service-automation`](packages/services/service-automation) | Automation engine — flows, triggers, and workflow state machines |
| [`@objectstack/service-cache`](packages/services/service-cache) | Cache — in-memory, Redis, multi-tier |
| [`@objectstack/service-feed`](packages/services/service-feed) | Activity feed / chatter |
| [`@objectstack/service-i18n`](packages/services/service-i18n) | Internationalization service |
| [`@objectstack/service-job`](packages/services/service-job) | Cron & interval job scheduler |
| [`@objectstack/service-package`](packages/services/service-package) | Package registry — publish, version, retrieve metadata packages |
| [`@objectstack/service-queue`](packages/services/service-queue) | Background job queue (in-memory, BullMQ) |
| [`@objectstack/service-realtime`](packages/services/service-realtime) | Real-time events and subscriptions |
| [`@objectstack/service-settings`](packages/services/service-settings) | Settings — manifest registry + K/V resolver (Env > Tenant > User) |
| [`@objectstack/service-storage`](packages/services/service-storage) | File storage (local, S3, R2, GCS) |

### Framework Adapters

| Package | Description |
| :--- | :--- |
| [`@objectstack/hono`](packages/adapters/hono) | Hono adapter (Node.js, Bun, Deno, Cloudflare Workers) — the supported HTTP adapter |

### Tools & Apps

| Package / App | Description |
| :--- | :--- |
| [`@objectstack/cli`](packages/cli) | CLI binary (`os` / `objectstack`) — `init`, `dev`, `start`, `serve`, `compile`, `publish`, `validate`, `generate`, `lint`, `doctor` |
| [`create-objectstack`](packages/create-objectstack) | Project scaffolder (`npx create-objectstack`) |
| [`objectstack-vscode`](packages/vscode-objectstack) | VS Code extension — autocomplete, validation, diagnostics |
| [`@object-ui/console`](https://github.com/objectstack-ai/objectui/tree/main/apps/console) | Fork-ready runtime console SPA (lives in objectstack-ai/objectui, served via `@object-ui/console` on npm) |
| [`@objectstack/account`](apps/account) | Account & identity portal — sign in, organizations, connected apps |
| [`@objectstack/docs`](apps/docs) | Documentation site (Fumadocs + Next.js) |

### Examples

| Example | Description | Level |
| :--- | :--- | :--- |
| [`@objectstack/example-todo`](examples/app-todo) | Task management app — objects, views, dashboards, flows | Beginner |
| [`@objectstack/example-crm`](examples/app-crm) | Minimal CRM smoke-test workspace — validates the metadata loading pipeline | Intermediate |
| [HotCRM](https://github.com/objectstack-ai/hotcrm) | Full-featured enterprise CRM reference app (separate repo) | Advanced |

</details>

## Architecture

ObjectStack uses a **microkernel architecture** where the kernel provides only the essential infrastructure (DI, EventBus, lifecycle), and all capabilities are delivered as plugins. The three layers sit above the microkernel:

<p align="center">
  <img src="docs/screenshots/layers.png" width="900" alt="ObjectStack layered architecture: the ObjectQL data layer, the kernel control layer, and the ObjectUI view layer sit on a microkernel (plugin lifecycle, service registry / DI, event bus); every capability — drivers, server, auth, security, automation, AI — is a plugin">
</p>

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete design documentation including the plugin lifecycle state machine, dependency graph, and design decisions.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the current documentation and architecture cleanup priorities.

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow, coding standards, testing requirements, and documentation guidelines.

Key standards:
- **Zod-first** — all schemas start with Zod; TypeScript types are derived via `z.infer<>`
- **camelCase** for configuration keys (e.g., `maxLength`, `defaultValue`)
- **snake_case** for machine names / data values (e.g., `project_task`, `first_name`)

## Documentation

Full documentation: **[https://objectstack.ai/docs](https://objectstack.ai/docs)**

**Upgrading from 10.x?** See [Upgrading to ObjectStack 11](./docs/upgrading-to-11.md).

Run locally: `pnpm docs:dev`

## Community

- ⭐ **Star this repo** if ObjectStack is useful — it helps others find it.
- 🐛 Questions, bugs, or feature requests → [open an issue](https://github.com/objectstack-ai/framework/issues).
- 🤝 Want to contribute? See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0. 