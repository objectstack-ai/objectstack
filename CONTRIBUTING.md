# Contributing to ObjectStack

Thank you for your interest in contributing to ObjectStack! This repository is the
whole open stack, not only the protocol: the Zod protocol (`packages/spec`), the
microkernel, the runtime, the drivers, plugins and services, the CLI, the client SDK,
the example apps and the documentation site. This guide takes you from a fork to a
pull request.

**[AGENTS.md](./AGENTS.md) is the rulebook, for human contributors and coding agents
alike.** It holds naming, the Zod-first and contract-first rules, the documentation
guardrails and the changeset rules. This file does not restate them. Where a rule
matters, it points you to AGENTS.md, and if the two ever disagree, AGENTS.md wins.
[Human Minimum](#human-minimum) lists the rules a first pull request most often breaks,
each with its pointer.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Build and Test Cost](#build-and-test-cost)
- [Making a Change](#making-a-change)
- [Human Minimum](#human-minimum)
- [Where Things Live](#where-things-live)
- [UI Workspace (`ui/`)](#ui-workspace-ui)
- [Package Directory](#package-directory)
- [Pull Request Process](#pull-request-process)
- [Community](#community)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please read the
[Code of Conduct](./CODE_OF_CONDUCT.md) and be respectful and professional in all
interactions.

## Getting Started

### Prerequisites

- **Node.js** 22 or later (`engines.node` in the root `package.json`)
- **pnpm 10**. `corepack enable` installs the exact version the root `package.json`
  pins in `packageManager`, and a pnpm 10 you installed yourself switches to that
  pinned version inside this repository. pnpm 8 and 9 cannot install this workspace:
  pnpm 8 refuses the lockfile, and pnpm 9 stops a frozen install on the `overrides`
  that live in `pnpm-workspace.yaml`.
- **Git**

### Initial Setup

```bash
# 1. Fork objectstack-ai/objectstack on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/objectstack.git
cd objectstack

# 3. Add the upstream remote
git remote add upstream https://github.com/objectstack-ai/objectstack.git

# 4. Install dependencies
corepack enable
pnpm install

# 5. Build the workspace (nothing builds it implicitly)
pnpm build
```

The README's [Hack on the framework](./README.md#hack-on-the-framework) section
has the commands for building the Console and running an example app with `pnpm dev`;
the next section says what each one costs.

`pnpm dev` listens on port 3000 and automatically shifts to the next free port
when 3000 is busy; pin an explicit port with `OS_PORT=3000 pnpm dev` (`PORT` is
the legacy alias). The Console's own dev server (`ui/apps/console`, Vite on
:5180) proxies `/api` to `DEV_PROXY_TARGET`, default `http://localhost:3000`, so
when the backend has moved off 3000, point `DEV_PROXY_TARGET` at the port it
printed.

## Build and Test Cost

`pnpm console:build` builds the Console from its source in this workspace
(`ui/apps/console`, against this tree's own spec and client) and copies the
result into `packages/console/dist` (gitignored), which is where `pnpm dev`
serves it from. Nothing is cloned or pinned. `pnpm build` builds the Console
too but does not copy it, so after `pnpm build` this step is a copy. Skip it
and `pnpm dev` still serves the REST API, without the Console. Rerun it after
pulling changes under `ui/`: `packages/console/dist` is never refreshed on its
own.

A first run is slow, not stuck. Measured once on a fresh clone of `main`
(4-vCPU container, Node 22.22, pnpm 10.31):

| Command | Time | |
|:---|---:|:---|
| `pnpm install` | 16 s | |
| `pnpm build` | 6 m 54 s | 72 turbo tasks |
| `pnpm console:build` | 12 m 16 s | 72 turbo tasks: the Console and what it depends on, run before any `pnpm build` (`--concurrency=2`); a cache hit plus a copy, about 1 s, once `pnpm build` has run |
| `pnpm test` | 54 m 03 s | the full suite: 135 turbo tasks |

For your own change, test what it reaches instead of the full suite:

```bash
pnpm turbo run test --affected          # packages your branch changes, and their dependents
pnpm --filter @objectstack/<pkg> test   # one package
```

`--affected` compares your branch with your local `main`, so a stale `main`
widens the set; keep it current, or set `TURBO_SCM_BASE=origin/main`.

Other examples: `pnpm dev:crm`, `pnpm dev:todo`. Docs site: `pnpm docs:dev`.

## Making a Change

1. **Start from an issue.** Pick one from the
   [issue tracker](https://github.com/objectstack-ai/objectstack/issues), or open one
   that describes the bug or the proposal before you write code.
   [docs/NORTH-STAR.md](./docs/NORTH-STAR.md), the project's one North Star, shows where the project is going
   and what comes first; an English summary closes it.
2. **Branch off an up-to-date `main`, one branch and one pull request per issue**,
   with the issue number in the branch name:

   ```bash
   git fetch upstream
   git checkout -b fix/issue-1234-short-slug upstream/main
   ```

   Working in a checkout that coding agents also use? Give every task its own
   `git worktree` instead of switching branches in a shared tree. AGENTS.md
   (Prime Directive #11 and *Multi-agent working discipline*) explains why, and what
   a worktree does not isolate.
3. **Make the change, following AGENTS.md.** Start with the
   [Human Minimum](#human-minimum). Read its *Prime Directives* before a
   structural change, and its *Context Routing* table for the rules of the path you
   are editing.
4. **Test what your change reaches**, not only the file you edited:

   ```bash
   pnpm --filter @objectstack/<pkg> test       # one package
   pnpm --filter @objectstack/<pkg> typecheck  # a type-check-covered package
   pnpm turbo run test --affected              # every package your branch reaches
   pnpm lint                                   # the only style authority (no formatter)
   ```

   Did you touch `packages/spec`? Then regenerate its checked-in artifacts before you
   push. The steps are in AGENTS.md under *Touched `packages/spec`?*.
5. **Add a changeset when the change publishes.** Run `pnpm changeset` and commit the
   `.changeset/*.md` file it writes. A bug fix in a released package takes a `patch`
   changeset. AGENTS.md's *Post-Task Checklist* (step 3) states the whole rule: which
   bump a change takes, the `Clause-②` and `Metadata-protocol` declarations (what they
   mean: [Human Minimum](#human-minimum), item 5), and the migration a breaking change
   must carry.

## Human Minimum

The rules a first pull request most often breaks. Each item names the rule in one
sentence and links the AGENTS.md text that states it; that text is the rule, so read it
before you rely on the summary. The
[pull request template](./.github/PULL_REQUEST_TEMPLATE.md) asks you to confirm the
same list.

1. **Schemas start as Zod, and `packages/spec` holds no runtime logic.** AGENTS.md,
   [Prime Directives 1 and 2](./AGENTS.md#prime-directives).
2. **Each kind of name has one casing**: config keys, machine names, error codes,
   metadata type names, REST paths and `OS_` environment variables. AGENTS.md,
   [Prime Directives 3 and 9](./AGENTS.md#prime-directives).
3. **No formatter: `pnpm lint` is the only style authority, and Prettier is never run on
   a file you touch.** AGENTS.md, [Build & Test](./AGENTS.md#build--test).
4. **One issue, one branch off an up-to-date `main`, one pull request; in a checkout that
   coding agents also use, one `git worktree` per task.** AGENTS.md,
   [Prime Directive 11](./AGENTS.md#prime-directives) and
   [Multi-agent working discipline](./AGENTS.md#multi-agent-working-discipline) item 2.
5. **A change that publishes carries a changeset, and the PR body and the changeset body
   each declare a `Clause-②:` line and a `Metadata-protocol:` line.** AGENTS.md,
   [Post-Task Checklist](./AGENTS.md#post-task-checklist) step 3, which has the exact
   values and what each one requires.
   - `Clause-②` answers one question: does this change widen or narrow what a published
     package accepts or exposes (its accept set or public surface)? `Clause-②: no` when
     it does neither; `Clause-②: yes` when it does.
   - `Metadata-protocol` answers another: what changed in what a metadata author can
     write? `added`, `narrowed`, `semantic`, or `none` for everything else.
   - Each is a line of its own, starting with the key, so the `Check Changeset` gate can
     read it.
6. **Touched `packages/spec`? Regenerate and commit its generated artifacts before you
   push.** AGENTS.md,
   [Touched `packages/spec`?](./AGENTS.md#touched-packagesspec-regenerate-its-artifacts-before-pushing).
7. **Generated and release-owned files are never hand-edited in your pull request**
   (`content/docs/references/`, `packages/*/CHANGELOG.md`, `content/docs/releases/`),
   and only the maintainer cuts a release. AGENTS.md,
   [Documentation Guardrails](./AGENTS.md#documentation-guardrails) and
   [Prime Directive 15](./AGENTS.md#prime-directives).
8. **Issue and pull request titles, bodies and comments are written in English.**
   AGENTS.md, [Communication](./AGENTS.md#communication).

## Where Things Live

| Path | What it holds |
|:---|:---|
| `packages/spec/src/` | The protocol: Zod schemas, types and constants. AGENTS.md lists the domains. |
| `packages/`, `packages/plugins/`, `packages/services/`, … | The kernel, runtime, drivers, plugins, services, CLI and SDK. The [package directory](#package-directory) below has them all. |
| `content/docs/` | The documentation site's pages, in trees such as `getting-started/`, `concepts/`, `data-modeling/`, `ui/`, `automation/`, `api/` and `deployment/`. Preview with `pnpm docs:dev`. |
| `content/docs/references/` | Generated from the Zod schemas by `packages/spec/scripts/build-docs.ts`. Never edit it by hand. |
| `content/docs/releases/` | Written at release time from changesets. Never edit it in a code pull request. |
| `examples/` | The example apps. The *Examples* table in the [package directory](#package-directory) describes each one. |
| `ui/` | ObjectUI: the `@object-ui/*` packages and the Console's source. Their guides live in `content/docs/frontend/`. [UI Workspace](#ui-workspace-ui) below covers working there. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Design details, the plugin lifecycle and the dependency graph. |

AGENTS.md (*Documentation Guardrails*) has the rules for every docs path, including what a
new page needs before it shows up in the navigation.

## UI Workspace (`ui/`)

`ui/` holds ObjectUI, the view layer: the `@object-ui/*` packages and the Console
(`ui/apps/console`). It is a member of this
workspace, so the root `pnpm install` above installs it too, and
[ui/AGENTS.md](./ui/AGENTS.md) adds that tree's own rules to AGENTS.md: the spec-first and
contract-first commandments, Shadcn-native styling, actions as data. Its code is MIT-licensed
([License](#license)). What follows is only what differs from the rest of this guide.

### UI commands

Run these from `ui/`:

```bash
pnpm exec turbo run build --filter='./*/*'       # Build every ui package (turbo, parallel & cached)
pnpm exec turbo run type-check --filter='./*/*'  # Run tsc --noEmit across the ui packages (turbo)
pnpm exec turbo run lint --filter='./*/*'        # Run eslint across the ui packages (turbo)
pnpm dev                                         # The Console's Vite dev server, on :5180
pnpm docs:check-links                            # The internal-link check CI runs on the ui READMEs and docs
pnpm test:e2e                                    # End-to-end tests (playwright)
```

turbo resolves a relative filter against the directory it is launched from, so the filter above
selects every package under `ui/packages/`, `ui/apps/` and `ui/examples/`. The tree has no
`build`, `type-check` or `lint` script of its own, because a `turbo run` in a member's script
would nest inside the root's. The ui packages spell the type-check task `type-check`, with a
hyphen. The Console dev server proxies its API calls to a backend as
[Getting Started](#getting-started) describes.

### UI tests

Run vitest **from `ui/`**, with paths written relative to it and **no `--`** before them:

```bash
pnpm test                                              # Run every vitest project (CI runs this)
pnpm exec vitest run packages/core/                    # Run a single package's tests
pnpm exec vitest run packages/core/src/<file>.test.ts  # Run a single test file
pnpm exec vitest run apps/console/                     # Run just the Console's tests
```

`pnpm --filter <pkg> test` and `turbo run test` are fine too: every package's `test` script
names the ui root (`vitest run --root ../.. packages/<pkg>/`), so they run the same single
config CI does. What is still wrong is `cd packages/x && pnpm exec vitest`, and a path behind
`--`. Each of those moves vitest's root into a package, where the `unit` / `dom` / `dom-heavy`
projects match nothing and only `ui/apps/console` resolves: foreign files pass, your package
never runs, and the output is green. A guard **exits non-zero** on them and prints the
correct invocation. It is wired into every file vitest can pick up as a config:
`ui/vitest.config.mts`, `ui/apps/console/vitest.config.ts`, and every
`ui/packages/<pkg>/vite.config.ts`. The rejection looks like this:

```
vitest 调用被拒绝:从包目录跑 vitest 会静默跑错测试集 (objectui#3378)
...
正确跑法 —— 一律在【仓库根目录】执行,路径前【不要】加 `--`:
  pnpm exec vitest run packages/<pkg>/src/<file>.test.ts   # 只跑一个文件
  pnpm exec vitest run packages/<pkg>/   # 只跑一个包
  pnpm test   # 全量(CI 跑的就是它)
```

Its "repository root" is `ui/`. The guard is `ui/scripts/vitest-invocation-guard.mjs`.

### UI CI

GitHub runs only the workflows in the repository root's
[workflow directory](./.github/workflows/), so a `ui/` change is checked by the same
`ci.yml` as the rest of the repository: its `Lint UI`, `Type Check UI`, `Test UI` and
`Build & E2E UI` jobs run when a pull request changes `ui/`. Read those jobs for what each one
runs; `ui/` keeps no CI guide of its own.

### UI examples

No directory under `ui/examples/` is a dev server: `hello-world` is a snippet to paste into
your own Vite or Next.js app (copy its app component and its schema), and `schema-catalog` is
a data package, the canonical JSON schemas the docs render, a smoke test mounts and AI agents
use as a few-shot corpus. Neither declares a `dev` script.
[`ui/examples/README.md`](./ui/examples/README.md) is the index. The app to run is the Console
(`pnpm dev` above).

### UI layout

| Path | Purpose |
| --- | --- |
| `ui/packages/*` | The published `@object-ui/*` packages, plus the private `vscode-extension`, `test-support` (test-only, never released), `runner` (workspace demo app, never released) and `app-shell` (the Console's shell and views, no longer published after 18.2.0) |
| `ui/apps/console` | The Console app (Vite + React), which `pnpm console:build` builds into the `@objectstack/console` package |
| `ui/examples/*` | The snippet and the schema catalog, see [UI examples](#ui-examples) |
| `ui/docs/` | Internal engineering material (ADRs, audits, design records); not part of the docs site |
| `ui/e2e/` | Playwright end-to-end tests |

The [package directory](#package-directory) lists every `@object-ui/*` package by layer.

### UI documentation

ObjectUI's guides are pages of the documentation site, under `content/docs/frontend/`
(*Custom front-end*), and follow the `content/docs/` rules above. `ui/docs/` is not part of the site.

- **A code block in an ADR or a dated audit is a specimen, not an example to copy.** Fence it
  `plaintext`, never `ts` / `tsx`: a gate compiles the code fences of `content/docs/frontend/`, and
  a record edited until it compiles says something it never said. Code a reader may copy
  belongs in `content/docs/frontend/` or the skills tree.
- **A `json` fence must pass a strict `JSON.parse`.** A block annotated with comments or
  trailing commas is fenced `jsonc`, and must still be one JSON document once those are
  removed; a `${…}` expression stays on one line inside its string.
- **Internal links are checked offline.** `pnpm docs:check-links` resolves every relative
  path in the ui READMEs and `ui/docs/` against the checkout, and CI runs it on every change.

ObjectUI's [Quick Start](./content/docs/frontend/quick-start.mdx) and
[Component Registry](./content/docs/frontend/component-registry.mdx) guides are the place to
start when you add a component.

## Package Directory

<details>
<summary><b>Everything in <code>packages/</code></b>, grouped by layer — click to expand.</summary>

#### Protocol & core

| Package | Description |
| :--- | :--- |
| [`@objectstack/spec`](packages/spec) | The protocol — Zod schemas, TypeScript types, JSON Schemas, constants |
| [`@objectstack/core`](packages/core) | Microkernel — plugin system, DI container, EventBus, Logger |
| [`@objectstack/types`](packages/types) | Shared interfaces describing the runtime environment |
| [`@objectstack/formula`](packages/formula) | Expression engine — CEL plus the ObjectStack stdlib, for formulas, predicates, defaults |
| [`@objectstack/platform-objects`](packages/platform-objects) | Built-in platform objects — identity, security, audit, tenant, metadata |
| [`@objectstack/lint`](packages/lint) | Static validation of a metadata graph, shared by `os validate` and AI authoring |
| [`@objectstack/sdui-parser`](packages/sdui-parser) | Constrained JSX source → SDUI schema tree compiler (parse, never execute) |

#### Engine

| Package | Description |
| :--- | :--- |
| [`@objectstack/objectql`](packages/objectql) | Isomorphic ObjectQL query engine and schema registry |
| [`@objectstack/runtime`](packages/runtime) | Runtime bootstrap — DriverPlugin, AppPlugin, environment artifacts |
| [`@objectstack/rest`](packages/rest) | Auto-generated REST API layer |
| [`@objectstack/metadata`](packages/metadata) | Metadata loading, saving, and persistence |
| [`@objectstack/metadata-core`](packages/metadata-core) | Metadata repository contracts — types, canonicalization, errors |
| [`@objectstack/metadata-fs`](packages/metadata-fs) | File-system metadata repository (JSON files + JSONL change log) |
| [`@objectstack/metadata-protocol`](packages/metadata-protocol) | Metadata management protocol — CRUD, draft/publish, locks, diagnostics |
| [`@objectstack/observability`](packages/observability) | Metrics, error reporting, and logging contracts with noop / console / OTLP exporters |
| [`@objectstack/verify`](packages/verify) | Boot an app in-process and verify it through the real HTTP stack |

#### Drivers

| Package | Description |
| :--- | :--- |
| [`@objectstack/driver-memory`](packages/drivers/driver-memory) | In-memory driver (development, testing, reference implementation) |
| [`@objectstack/driver-sql`](packages/drivers/driver-sql) | SQL driver — PostgreSQL, MySQL, SQLite via Knex |
| [`@objectstack/driver-mongodb`](packages/drivers/driver-mongodb) | MongoDB driver over the official client |
| [`@objectstack/driver-turso`](packages/drivers/driver-turso) | Turso / libSQL driver — edge-first SQLite with embedded replicas |
| [`@objectstack/driver-sqlite-wasm`](packages/drivers/driver-sqlite-wasm) | WASM SQLite driver for browsers and WebContainers (StackBlitz) |

#### Client

| Package | Description |
| :--- | :--- |
| [`@objectstack/client`](packages/client) | Client SDK — CRUD, batch API, error handling |
| [`@objectstack/client-react`](packages/client-react) | React hooks — `useQuery`, `useMutation`, `usePagination` |

#### Plugins

| Package | Description |
| :--- | :--- |
| [`@objectstack/plugin-hono-server`](packages/plugins/plugin-hono-server) | Hono-based HTTP server plugin |
| [`@objectstack/hono`](packages/adapters/hono) | Hono adapter — Node.js, Bun, Deno, Cloudflare Workers |
| [`@objectstack/mcp`](packages/mcp) | MCP server — exposes objects and AI tools over stdio and Streamable HTTP |
| [`@objectstack/plugin-auth`](packages/plugins/plugin-auth) | Authentication and identity (better-auth) |
| [`@objectstack/plugin-security`](packages/plugins/plugin-security) | RBAC, row-level and field-level security |
| [`@objectstack/plugin-sharing`](packages/plugins/plugin-sharing) | Record-level sharing and `sharingModel` enforcement |
| [`@objectstack/organizations`](packages/plugins/organizations) | Multi-organization row-level isolation |
| [`@objectstack/plugin-approvals`](packages/plugins/plugin-approvals) | Multi-step approval engine |
| [`@objectstack/plugin-audit`](packages/plugins/plugin-audit) | Audit log object and audit trail |
| [`@objectstack/plugin-email`](packages/plugins/plugin-email) | Pluggable outbound email transport |
| [`@objectstack/plugin-webhooks`](packages/plugins/plugin-webhooks) | Durable, cluster-aware outbound webhook delivery |
| [`@objectstack/plugin-pinyin-search`](packages/plugins/plugin-pinyin-search) | Pinyin recall for CJK search |
| [`@objectstack/plugin-dev`](packages/plugins/plugin-dev) | Zero-config local development assembly |
| [`@objectstack/knowledge-memory`](packages/plugins/knowledge-memory) | In-memory knowledge adapter (dev / test) |
| [`@objectstack/knowledge-ragflow`](packages/plugins/knowledge-ragflow) | RAGFlow knowledge adapter |
| [`@objectstack/embedder-openai`](packages/plugins/embedder-openai) | OpenAI-compatible embedder (OpenAI, DashScope, Ollama, and any drop-in endpoint) |

#### Connectors & triggers

| Package | Description |
| :--- | :--- |
| [`@objectstack/connector-rest`](packages/connectors/connector-rest) | Generic REST connector for the automation engine |
| [`@objectstack/connector-openapi`](packages/connectors/connector-openapi) | Connector actions generated from an OpenAPI document |
| [`@objectstack/connector-mcp`](packages/connectors/connector-mcp) | Any MCP server's tools as connector actions |
| [`@objectstack/connector-slack`](packages/connectors/connector-slack) | Slack Web API connector |
| [`@objectstack/connector-imap`](packages/connectors/connector-imap) | Read-only IMAP session and mail account abstraction for the mailbox sync |
| [`@objectstack/trigger-record-change`](packages/triggers/trigger-record-change) | Launch flows on insert / update / delete |
| [`@objectstack/trigger-schedule`](packages/triggers/trigger-schedule) | Launch flows on a cron, interval, or one-off schedule |
| [`@objectstack/trigger-api`](packages/triggers/trigger-api) | Inbound HTTP / webhook flow trigger with HMAC verification |

#### Services

| Package | Description |
| :--- | :--- |
| [`@objectstack/service-automation`](packages/services/service-automation) | Automation engine — DAG flows, triggers, workflow state machines |
| [`@objectstack/service-analytics`](packages/services/service-analytics) | Aggregations, time series, funnels, dashboards |
| [`@objectstack/service-realtime`](packages/services/service-realtime) | Real-time events and subscriptions |
| [`@objectstack/service-job`](packages/services/service-job) | Cron and interval job scheduler |
| [`@objectstack/service-queue`](packages/services/service-queue) | Background job queue — in-memory or durable DB-backed |
| [`@objectstack/service-cache`](packages/services/service-cache) | Cache — in-memory and Redis |
| [`@objectstack/service-cluster`](packages/services/service-cluster) | Cluster primitives — PubSub, Lock, KV, Counter |
| [`@objectstack/service-cluster-redis`](packages/services/service-cluster-redis) | Redis driver for the cluster service |
| [`@objectstack/service-storage`](packages/services/service-storage) | File storage — local filesystem and S3 |
| [`@objectstack/service-datasource`](packages/services/service-datasource) | External-table federation and datasource lifecycle |
| [`@objectstack/service-settings`](packages/services/service-settings) | Settings — manifest registry and K/V resolver (env > tenant > user) |
| [`@objectstack/service-i18n`](packages/services/service-i18n) | Internationalization |
| [`@objectstack/service-messaging`](packages/services/service-messaging) | Outbound notification dispatch across channels |
| [`@objectstack/service-sms`](packages/services/service-sms) | SMS delivery (Aliyun, Twilio, log) |
| [`@objectstack/service-knowledge`](packages/services/service-knowledge) | Knowledge / RAG orchestration over pluggable adapters |
| [`@objectstack/service-package`](packages/services/service-package) | Package registry — publish, install, manage metadata packages |
| [`@objectstack/cloud-connection`](packages/cloud-connection) | Runtime-side client for an ObjectStack cloud control plane |

#### Tools & apps

| Package | Description |
| :--- | :--- |
| [`@objectstack/cli`](packages/cli) | The `os` / `objectstack` CLI |
| [`create-objectstack`](packages/create-objectstack) | Project scaffolder (`npm create objectstack`) |
| [`@objectstack/console`](packages/console) | Prebuilt Console SPA, version-locked to this release; built from [`ui/apps/console`](ui/apps/console) in this repository |
| [`@objectstack/studio`](packages/apps/studio) | Studio — the visual metadata builder app |
| [`@objectstack/setup`](packages/apps/setup) | Setup — the platform administration app |
| [`@objectstack/account`](packages/apps/account) | Account — sign in, organizations, connected apps |
| [`@objectstack/docs`](apps/docs) | Documentation site (Fumadocs + Next.js) |

#### Examples

| Example | What it shows |
| :--- | :--- |
| [`examples/app-todo`](examples/app-todo) | The smallest app — objects, views, dashboards, flows |
| [`examples/app-crm`](examples/app-crm) | A minimal CRM exercising the full metadata pipeline: objects → views → app → dashboard → hooks → flows → seed |
| [`examples/app-showcase`](examples/app-showcase) | Kitchen sink — every metadata type, view type, chart type, and capability chain; what `pnpm dev` runs |
| [`examples/app-multi-package`](examples/app-multi-package) | One release artifact carrying two packages that share a namespace |
| [`examples/embed-objectql`](examples/embed-objectql) | ObjectQL as a plain library — no kernel, no plugins |
| [HotCRM](https://github.com/objectstack-ai/hotcrm) | Full-featured enterprise CRM reference app (separate repo) |

</details>

<details>
<summary><b>Everything in <code>ui/packages/</code></b> (ObjectUI, <code>@object-ui/*</code>, MIT), grouped by dependency weight — click to expand.</summary>

Atoms and fields stay light; heavy widgets live in lazy-loaded plugins.

#### Core

| Package | Description |
| :--- | :--- |
| [`@object-ui/types`](ui/packages/types) | Pure TypeScript definitions — the protocol layer |
| [`@object-ui/core`](ui/packages/core) | Registry, validation, expression evaluation; zero React |
| [`@object-ui/react`](ui/packages/react) | React bindings and `SchemaRenderer` |
| [`@object-ui/components`](ui/packages/components) | Standard UI components (Tailwind + Shadcn) |
| [`@object-ui/fields`](ui/packages/fields) | Field renderers and registry |
| [`@object-ui/layout`](ui/packages/layout) | Layout components with React Router integration |

#### Application shell

| Package | Description |
| :--- | :--- |
| [`@object-ui/app-shell`](ui/packages/app-shell) | The Console's shell, views and Studio; a private workspace package, last published to npm as 18.2.0 |
| [`@object-ui/providers`](ui/packages/providers) | The upload adapter context the file and image fields upload through |
| [`@object-ui/auth`](ui/packages/auth) | `AuthProvider`, `useAuth`, `AuthGuard`, sign-in forms |
| [`@object-ui/permissions`](ui/packages/permissions) | Object / field / row-level permission guards and hooks |
| [`@object-ui/i18n`](ui/packages/i18n) | Language packs, RTL layout, date and currency formatting |
| [`@object-ui/mobile`](ui/packages/mobile) | Responsive components, PWA support, touch gestures |
| [`@object-ui/collaboration`](ui/packages/collaboration) | Presence, live cursors, conflict resolution, comment threads |
| [`@object-ui/console`](ui/apps/console) | Fork-ready runtime console with the full plugin set, shipped as a Hono plugin |

#### Data adapters

| Package | Description |
| :--- | :--- |
| [`@object-ui/data-objectstack`](ui/packages/data-objectstack) | ObjectStack data adapter |

#### Plugins (lazy-loaded)

| Package | Description |
| :--- | :--- |
| [`@object-ui/plugin-view`](ui/packages/plugin-view) | ObjectQL-integrated object views (grid, form, detail) |
| [`@object-ui/plugin-grid`](ui/packages/plugin-grid) | Advanced data grid |
| [`@object-ui/plugin-form`](ui/packages/plugin-form) | Advanced form components |
| [`@object-ui/plugin-detail`](ui/packages/plugin-detail) | Detail pages with sections, tabs, and related lists |
| [`@object-ui/plugin-list`](ui/packages/plugin-list) | Unified list view with view-type switching |
| [`@object-ui/plugin-kanban`](ui/packages/plugin-kanban) | Kanban boards with drag-and-drop (dnd-kit) |
| [`@object-ui/plugin-calendar`](ui/packages/plugin-calendar) | Calendar views |
| [`@object-ui/plugin-gantt`](ui/packages/plugin-gantt) | Gantt charts |
| [`@object-ui/plugin-timeline`](ui/packages/plugin-timeline) | Timelines |
| [`@object-ui/plugin-tree`](ui/packages/plugin-tree) | Tree and tree-grid views |
| [`@object-ui/plugin-map`](ui/packages/plugin-map) | Map visualization |
| [`@object-ui/plugin-charts`](ui/packages/plugin-charts) | Charts powered by Recharts |
| [`@object-ui/plugin-dashboard`](ui/packages/plugin-dashboard) | Dashboard layouts and widgets |
| [`@object-ui/plugin-report`](ui/packages/plugin-report) | Pivot tables, grouped aggregations, printable reports |
| [`@object-ui/plugin-designer`](ui/packages/plugin-designer) | Visual page, data-model, process, and report designers |
| [`@object-ui/plugin-editor`](ui/packages/plugin-editor) | Rich text editor powered by Monaco |
| [`@object-ui/plugin-markdown`](ui/packages/plugin-markdown) | Markdown rendering |
| [`@object-ui/plugin-chatbot`](ui/packages/plugin-chatbot) | Chatbot interface |
| [`@object-ui/plugin-ai`](ui/packages/plugin-ai) | Schema generation and conversational assistants (Vercel AI SDK) |

#### Tooling

| Package | Description |
| :--- | :--- |
| [`@object-ui/cli`](ui/packages/cli) | Scaffold, develop, build, and validate schema-driven apps |
| [`@object-ui/create-plugin`](ui/packages/create-plugin) | Scaffold a new Object UI plugin |
| [`@object-ui/runner`](ui/packages/runner) | Universal application runner for testing schemas (private workspace app, not published) |
| [`@object-ui/react-runtime`](ui/packages/react-runtime) | Trusted runtime execution for `kind: 'react'` pages |
| [`vscode-extension`](ui/packages/vscode-extension) | IntelliSense and live preview for schema files |

</details>

## Pull Request Process

### Before Submitting

- [ ] The tests and type-check for what your change reaches pass
- [ ] `pnpm lint` passes
- [ ] Documentation is updated where behaviour changed
- [ ] A changeset is included if the change publishes
- [ ] No unrelated changes are included
- [ ] If the PR changes the auth/audience **defaults** or the **accept/reject behaviour** of
      the unauthenticated surface, label it `needs:pack-smoke` — that runs the packed-install
      smoke on the merge preview before you merge, instead of finding out at release time.

### Opening the Pull Request

Push your branch to your fork and open a pull request against `main`. Its first line
names the issue it fixes (`Fixes #1234`). The body says what changed, why, and how you
verified it. The [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) lays out
that body, the two declaration lines and the [Human Minimum](#human-minimum) checklist.

### Review Process

1. **Automated checks:** CI runs the repository gates, the type-check, the tests and the
   builds.
2. **Code review:** maintainers review your change.
3. **Feedback:** address the review comments.
4. **Merge:** maintainers land the pull request through the merge queue.

## Community

- **[GitHub Discussions](https://github.com/objectstack-ai/objectstack/discussions)** —
  questions and ideas
- **[GitHub Issues](https://github.com/objectstack-ai/objectstack/issues)** — bug reports
  and feature requests
- **[Documentation](https://objectstack.ai/docs)** — the published docs site

This repository is the one public issue tracker for every ObjectOS edition: Community
(the code in this repository), Cloud and Enterprise. Say which edition you run when you
open an issue; the Bug report and Feature request forms ask for it. Cloud and Enterprise
reports are triaged by the ObjectOS Cloud team and may be moved to the repository where
that code lives.

## License

By contributing, you agree that your contributions will be licensed under the
Apache License, Version 2.0 (see [LICENSE](./LICENSE) and [LICENSING.md](./LICENSING.md)),
except contributions under `ui/`, which are licensed under the MIT License
([ui/LICENSE](./ui/LICENSE)).

**Thank you for contributing to ObjectStack! 🚀**
