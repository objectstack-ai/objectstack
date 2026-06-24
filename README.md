# ObjectStack

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-v4.0.1-green.svg)
![Tests](https://img.shields.io/badge/tests-6%2C507%20passing-brightgreen.svg)

> **Open-source, AI-native backend for real business apps.** Describe a business app and AI builds the whole thing — objects, APIs, UI, workflows, and permissions — as version-controlled Zod metadata on a database you own. Self-host it; AI agents then operate it within RBAC / RLS and audit.

**Try it in ~30s** — boot the [HotCRM](https://github.com/objectstack-ai/hotcrm) reference app on [StackBlitz](https://stackblitz.com/github/objectstack-ai/hotcrm) (no install). · Hosted platform: **[ObjectOS](https://cloud.objectos.app)**.

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="900" alt="ObjectStack Console rendering an executive dashboard — KPI cards for revenue, accounts, contacts and leads, a revenue-trend area chart, and a revenue-by-industry donut, all defined as metadata">
  <br><sub>The runtime <b>Console</b> rendering a dashboard defined entirely in metadata — KPI cards, charts, and scheduled reports.</sub>
</p>

## What is ObjectStack?

ObjectStack is an **open-source**, metadata-driven backend for building business applications that AI agents can understand, operate, and audit safely — self-hostable, with your data on your own database.

Instead of hiding business logic inside ad-hoc SQL queries, UI state, or JavaScript strings, ObjectStack makes the business system explicit:

- **Business objects** are Zod schemas with typed fields, relations, validation, and permissions.
- **Business actions** are generated from metadata as REST APIs, SDK calls, and MCP tools.
- **Business logic** is represented as analyzable metadata: flows, conditions, policies, and artifacts.
- **Business runtime** is a microkernel that loads plugins, drivers, services, and compiled environment artifacts.

The goal is not to be another low-code UI builder. ObjectStack is the structured execution layer for AI-native business software: agent-ready, permission-aware, versioned, and auditable.

ObjectStack is built around three protocol layers:

- **ObjectQL** (Data Layer) — Objects, fields, queries, relations, validation, and data access.
- **ObjectOS** (Control Layer) — Runtime, permissions, automation, plugins, environments, and artifact loading.
- **ObjectUI** (View Layer) — Apps, views, dashboards, actions, and presentation metadata.

All core definitions start with **Zod schemas** (1,600+ exported schemas across 200 schema files). TypeScript types, JSON Schemas, REST routes, UI metadata, and agent tools are derived from the same source of truth.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full microkernel and layer architecture documentation, and [content/docs/concepts/north-star.mdx](./content/docs/concepts/north-star.mdx) for the product north star (metadata protocols · environment-aware runtime · compiled app artifacts).

## See it in action

ObjectStack ships a runtime **Console** and a visual **Studio** on top of the same metadata — every object, view, dashboard, flow, and permission you declare in code is immediately explorable, editable, and operable in the browser.

**One object, every view.** The same `task` records — rendered as a board, a Gantt schedule, a calendar, or a cover gallery. View types are metadata, and the per-view bindings (kanban group-by, Gantt start/end/progress, calendar date, gallery cover) are auto-derived from the object, so switching layout takes no extra UI code.

<p align="center">
  <img src="docs/screenshots/kanban.png" width="49%" alt="Kanban board grouping tasks across Backlog, To Do, In Progress, In Review, and Done columns">
  <img src="docs/screenshots/gantt.png" width="49%" alt="Gantt schedule with colored task bars, milestone diamonds, and a today marker">
</p>
<p align="center">
  <img src="docs/screenshots/calendar.png" width="49%" alt="Month calendar with task events placed on their due dates">
  <img src="docs/screenshots/gallery.png" width="49%" alt="Gallery of task cards with cover images, assignees, and status badges">
</p>
<p align="center"><sub><b>Board</b> · <b>Gantt</b> · <b>Calendar</b> · <b>Gallery</b> — the same records, four visualizations, zero extra UI code (grid, timeline, and map ship too).</sub></p>

**Model and automate.**

<p align="center">
  <img src="docs/screenshots/modeling.png" width="49%" alt="Studio object designer showing the Opportunity object's typed fields, lookups, and layout sections">
  <img src="docs/screenshots/automation.png" width="49%" alt="Studio flow designer showing a visual DAG that enrolls leads into a campaign">
</p>
<p align="center"><sub><b>Model</b> business objects as typed metadata — fields, relations, validation, sections &nbsp;·&nbsp; <b>Automate</b> with flows that compile to analyzable metadata.</sub></p>

**Ask your data.**

<p align="center">
  <img src="docs/screenshots/ask-ai.png" width="860" alt="AI assistant answering questions about records using the same metadata and permissions">
  <br><sub>AI agents act through the same objects, actions, and permissions you defined — agent-ready by construction, not bolted on.</sub>
</p>

## How it works

Everything is **typed metadata**. Author a business object once — fields, a color-coded picklist, validation, all declarative:

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

From that single schema, ObjectStack compiles a running backend — the database table, an auto-generated REST API and typed client SDK, the Console &amp; Studio UI (list, board, calendar, Gantt…), and MCP tools for agents — all behind the same permissions, over a database you host.

<p align="center">
  <img src="docs/screenshots/architecture.png" width="940" alt="ObjectStack architecture: author typed Zod metadata (objects, flows, views, policies); the microkernel runtime compiles it into a versioned JSON artifact and loads plugins, drivers, and services; it generates a REST API, client SDK, Console and Studio UI, and MCP tools used by developers and AI agents — all governed by Auth, RBAC, RLS, FLS, and audit, over PostgreSQL, MySQL, SQLite, or MongoDB">
</p>

## Key Features

- **AI-native, not retrofitted** — Objects, permissions, flows, APIs, and UI are declarative typed metadata, small enough for an agent to load end-to-end. That metadata generates an automatic tool surface — REST APIs, client SDKs, UI views, and an [MCP](packages/mcp) server — so agents inspect and act through the same contracts you defined.
- **Protocol-first runtime** — Every definition starts as a Zod schema (`z.infer<>` types), compiles into versioned, self-describing JSON artifacts, and runs on a microkernel plugin system (DI container, EventBus, `init → start → destroy` lifecycle).
- **Data & framework reach** — In-memory, PostgreSQL, MySQL, SQLite, and MongoDB drivers; 7 framework adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit); a client SDK with React hooks (`useQuery` / `useMutation` / `usePagination`).
- **Governance & built-ins** — better-auth, RBAC / RLS / FLS, a DAG-based automation engine, an AI service (Agent / Tool / Skill on the Vercel AI SDK), the ObjectUI Console, and a full CLI (`os init` / `dev` / `compile` / `validate` / …).

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

This makes ObjectStack a backend substrate for AI-native business applications: CRM agents, support agents, operations agents, workflow agents, and internal tools that must act on real business data without bypassing permissions or audit trails.

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

Cloud, package registry, and environment management subcommands (`os publish`, `os rollback`, `os package`, `os login`, `os whoami`, `os cloud …`) are available when targeting an ObjectStack Cloud control plane.

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
| [`@objectstack/plugin-msw`](packages/plugins/plugin-msw) | Mock Service Worker plugin for browser testing |

### Services

| Package | Description |
| :--- | :--- |
| [`@objectstack/service-ai`](packages/services/service-ai) | AI service — Agent, Tool, Skill, Vercel AI SDK integration |
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
| [`@objectstack/express`](packages/adapters/express) | Express adapter |
| [`@objectstack/fastify`](packages/adapters/fastify) | Fastify adapter |
| [`@objectstack/hono`](packages/adapters/hono) | Hono adapter (Node.js, Bun, Deno, Cloudflare Workers) |
| [`@objectstack/nestjs`](packages/adapters/nestjs) | NestJS module integration |
| [`@objectstack/nextjs`](packages/adapters/nextjs) | Next.js App Router adapter |
| [`@objectstack/nuxt`](packages/adapters/nuxt) | Nuxt adapter (h3-based) |
| [`@objectstack/sveltekit`](packages/adapters/sveltekit) | SvelteKit adapter |

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

## Codebase Metrics

| Metric | Value |
| :--- | :--- |
| Source packages | 72 |
| Apps | 2 (account, docs) |
| Framework adapters | 7 (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) |
| Database drivers | 3 (Memory, SQL, MongoDB) |
| Zod schema files | 200 |
| Exported schemas | 1,600+ |
| `.describe()` annotations | 8,750+ |
| Service contracts | 27 |
| Test files | 676 |
| Tests passing | 6,507 |

## Architecture

ObjectStack uses a **microkernel architecture** where the kernel provides only the essential infrastructure (DI, EventBus, lifecycle), and all capabilities are delivered as plugins. The three protocol layers sit above the kernel:

<p align="center">
  <img src="docs/screenshots/layers.png" width="900" alt="ObjectStack layered architecture: the ObjectQL data layer, ObjectOS control layer, and ObjectUI view layer sit on a microkernel (plugin lifecycle, service registry / DI, event bus); every capability — drivers, server, auth, security, automation, AI — is a plugin">
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

Full documentation: **[https://docs.objectstack.ai](https://docs.objectstack.ai)**

Run locally: `pnpm docs:dev`

## Community

- ⭐ **Star this repo** if ObjectStack is useful — it helps others find it.
- 🐛 Questions, bugs, or feature requests → [open an issue](https://github.com/objectstack-ai/framework/issues).
- 🤝 Want to contribute? See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0. Enterprise editions, official cloud services, and marketplace
commercial terms live outside this repository.
