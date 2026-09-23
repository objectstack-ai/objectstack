---
name: objectstack-platform
description: >
  Bootstrap, configure, extend, and operate ObjectStack runtimes. Covers
  project setup (`defineStack`, drivers, scaffolding), declaring platform
  capabilities (`requires:` — which service plugins boot), plugin and
  service development (PluginContext, DI, kernel hooks like `kernel:ready`),
  and operations (CLI commands, migrations, deployment, test
  harnesses via LiteKernel). Use when the user is writing
  `objectstack.config.ts`, building a plugin or driver, turning a platform
  capability on, mounting the Hono HTTP layer, running `os` CLI commands, or
  planning deployment. Do not use for
  data schema design (see objectstack-data) or query patterns (see
  objectstack-query); data lifecycle hooks (beforeInsert / afterUpdate)
  belong in objectstack-data — only kernel / service-level events live here.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x and @objectstack/core 17.x (Zod v4 schemas), Node 22+
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: platform
  tags: project, defineStack, driver, hono, plugin, kernel, service, requires, capability, DI, lifecycle, cli, deploy, ops
---

# Platform — ObjectStack Bootstrap & Plugin System

Two concerns over one `defineStack()` / kernel surface: **project setup**
(`objectstack.config.ts`, drivers, the boot sequence) and **plugin
development** (plugins, services, kernel hook / event handlers,
`ObjectKernel` vs `LiteKernel`).

---

## `defineStack()` — The Core Configuration

`objectstack.config.ts` is the single entry point for every project.
It calls `defineStack()` to declare all metadata.

→ Moved verbatim to [references/bootstrap.md](./references/bootstrap.md) § Minimal Example.

### Full Configuration Reference

`defineStack()` accepts an `ObjectStackDefinitionInput` whose top-level keys
are `manifest`, `packages`, `objects`, `objectExtensions`, `views`, `apps`,
`pages`, `dashboards`, `reports`, `datasets`, `actions`, `flows`, `jobs`,
`emailTemplates`, `docs`, `books`, `positions`, `permissions`,
`capabilities`, `sharingRules`, `apis`, `webhooks`, `api`, `server`,
`agents`, `tools`, `skills`, `hooks`, `functions`, `mappings`,
`analyticsCubes`, `connectors`, `data` (seed), `datasources`,
`datasourceMapping`, `translations`, `i18n`, `plugins`, `devPlugins`,
`devHint`, `devLogins`, `requires`, `tiers`, `onEnable`.

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

→ Moved verbatim to [references/bootstrap.md](./references/bootstrap.md) § Map Format (Key → Name) · § Barrel Import Pattern.

### Strict Validation

`defineStack()` validates by default (`strict: true`):

1. **Zod schemas** — field names, types, enums
2. **Cross-references** — views/actions/flows reference defined objects
3. **Seed data** — dataset objects exist in the definition

To disable (advanced — e.g., objects provided by another plugin):

```typescript
export default defineStack(config, { strict: false });
```

### Compile Artifact and Runtime Metadata Boundary

ObjectStack runtime metadata must come from source files during local development or
from a compiled artifact. Do not configure an environment runtime to read or write
metadata through its business database.

```bash
# the CLI ships an `os` binary; `objectstack` is an alias for it
objectstack compile
# -> dist/objectstack.json

OS_ARTIFACT_PATH=./dist/objectstack.json objectstack dev
```

Runtime rule of thumb:

| Context | Metadata source | Database role |
|:--------|:----------------|:--------------|
| Local dev | TS files or `dist/objectstack.json` | Business rows only |
| Production runtime | Artifact API response | Business rows only |
| Control plane | Published JSON in metadata storage | Environment revisions, history, overlays |

When generating `objectstack.config.ts`, keep object names short and
`snake_case`; never set `tableName`, and do not add `sys_metadata` objects to an
environment runtime manifest.

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
  engines: { protocol: '^17' }, // Metadata-protocol major this app targets
}
```

**`manifest.engines.protocol`:** the metadata-protocol major the app is authored
against. `create-objectstack` stamps it into every project it emits (and all
three example apps carry it). The runtime checks it **before it loads
anything**, so a runtime outside the range refuses the app at the boundary with
the exact migration command instead of crashing later. Change it when you
deliberately move to a new protocol major — never to silence a mismatch.

**Object naming:** The object `name` is the canonical identifier and equals the physical table name. Embed any domain prefix directly in the name (e.g. `name: 'crm_account'`); the object-level `namespace` *field* is retired (ADR-0129 D3) and refused at load.

**`manifest.namespace` (ADR-0048):** Optional, but **enforced once set**. When a package declares `manifest.namespace: 'crm'`, every `object.name` must start with `crm_` or `defineStack` errors (`validateNamespacePrefix` in `@objectstack/spec`); the legacy `<ns>__<short>` double-underscore form is rejected, and `sys_`-prefixed names are platform-reserved and exempt. The namespace is also a package-ownership key — installing two packages that both claim `crm` fails with `NamespaceConflictError` (downgrade to a warning with `OS_METADATA_COLLISION=warn`). `os lint` additionally emits a non-fatal `naming/namespace-prefix` warning for bare-named UI/automation items (app, page, dashboard, flow, action, report, dataset) when a namespace is set.

---

## The App / Platform Boundary

An ObjectStack app is a **simplified implementation of business features**:
author metadata under the platform's spec, guided by these skills, and check it
with the `os` commands ([Verify your work](./references/operations.md#verify-your-work)). Never rebuild
what the platform owns.

- **Business features belong in the app; capability belongs in the platform.**
  A missing default, a wrong diagnostic, a shape the spec refuses — the fix is
  upstream. Raise it there; do not compensate for it here.
- **Could this be written by something that has only the metadata, and no
  knowledge of this company?** *No* — it encodes this company's own judgement (a
  discount ceiling, who a case is assigned to, how won/lost is booked) ⇒ the
  app. *Yes* — it only asks whether the metadata is self-consistent (reference
  integrity, translation coverage, view rosters, sharing-rule coverage, CRUD
  round-trips, RLS probes per declared position) ⇒ the platform.
- **A platform defect means waiting for the platform fix.** No defensive coding,
  no shape tolerance, no hand-written predicate re-implementing a platform rule,
  and never "land the half we can" — that spends the contract-first option and
  leaves a decision half-executed. Record the block against the platform issue
  so it is machine-visible; before resuming, confirm the version you **pin**
  carries the fix (merged upstream ≠ present on your pin) and re-run the
  defect's own reproduction.
- **A bad platform default is a default to fix**, not something to work around
  at every call site.

---

## The Template

`blank` is the only template `create-objectstack` offers, and it is the default:

- Bundled with `create-objectstack` — works offline, no network fetch
- One example object, and `requires: ['automation']` plus the three generic
  connector executors in `plugins:`. The memory driver and the Hono server are
  NOT in the file — the CLI auto-registers both at boot
- A clean slate to extend with the metadata this skill describes

The five remote content templates (`todo`, `compliance`, `content`,
`contracts`, `procurement`) are **retired** — delisted from the marketplace and
no longer maintained. Do not recommend them; asking for one by name is refused.
Build domain metadata on top of `blank` instead.

→ Moved verbatim to [references/bootstrap.md](./references/bootstrap.md) § Scaffolding Command.

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
    ├── datasets/             # Optional: analytics datasets
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

## Driver Selection Guide

Drivers are the storage layer. Pick based on your environment:

| Driver | Package | Best For | Notes |
|:-------|:--------|:---------|:------|
| **Memory** | `@objectstack/driver-memory` | Dev, testing, prototyping | `InMemoryDriver` — data lost on restart |
| **SQL** | `@objectstack/driver-sql` | Production (PostgreSQL, MySQL, SQLite) | `SqlDriver` — Knex.js under the hood (`pg` / `mysql` / `better-sqlite3` clients) |
| **MongoDB** | `@objectstack/driver-mongodb` | Production (document store) | `MongoDBDriver` |
| **SQLite WASM** | `@objectstack/driver-sqlite-wasm` | Browser / WebContainer | `SqliteWasmDriver` — in-process, no server |
| **Turso** | `@objectstack/driver-turso` | Edge, serverless, multi-tenant | **Cloud / EE only** — ships with the ObjectStack cloud / enterprise distribution, not the open framework. The open-core CLI recognizes `libsql://` URLs but **fails loudly** (`UnsupportedDriverError`) |

### Wiring a driver — you usually do not

Under `os dev` / `os serve` / `os start` the CLI **resolves the driver itself**
from the database URL and registers `DriverPlugin` for you (memory in dev, SQL
in prod). Do **not** put a driver in your config's `plugins:` array: no example
app does, and the `plugins:` key is for plugins the CLI cannot infer (connector
executors, your own plugins). Pick a driver by setting the DB URL, not by
writing code.

Construct `DriverPlugin` yourself only when **you** own the runtime — embedding
via `Runtime` / `ObjectKernel`, or a test that boots a kernel directly:

```typescript
import { DriverPlugin } from '@objectstack/runtime';
import { SqlDriver } from '@objectstack/driver-sql';

new DriverPlugin(new SqlDriver({ client: 'pg', connection: process.env.DATABASE_URL }));
```

---

## HTTP Layer (Hono)

Two packages exist:

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

// prefix defaults to '/api'.
export default createHonoApp({ kernel });
```

⚠️ **`prefix` does not move auth.** The `/auth/*` mount follows the auth
service's `basePath` (`AuthPlugin` default `/api/v1/auth`), not `prefix` —
`createHonoApp({ kernel })` reaches better-auth at `/api/v1/auth/*`. A `prefix`
that `basePath` is not inside **refuses at boot**, naming both values.

### Architecture

`createHonoApp` creates an `HttpDispatcher`, mounts explicit
routes for auth and discovery, and delegates everything else to it — so **new
routes added to HttpDispatcher work automatically**.

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
[Ports & networking](./references/operations.md#ports--networking).

### `requires:` — which service plugins boot

Step 4's list is the fixed core. Every other service plugin is opt-in, and
`requires: [...]` on the stack root is what turns it on. The CLI expands each
token through the `CAPABILITY_PROVIDERS` registry in
`packages/cli/src/commands/serve.ts` — all 20 of its entries:

| Token | Provider package |
|:--|:--|
| `automation` | `@objectstack/service-automation` — flows, and any declarative `connectors:` entry |
| `analytics` `cache` `storage` `queue` `job` `messaging` `realtime` `settings` `sms` | `@objectstack/service-` + the token |
| `marketplace` | `@objectstack/service-package` |
| `audit` `email` `sharing` `reports` `approvals` `webhooks` | `@objectstack/plugin-` + the token |
| `pinyin-search` | `@objectstack/plugin-pinyin-search` |
| `mcp` | `@objectstack/mcp` |
| `triggers` | `@objectstack/trigger-record-change`, plus `trigger-schedule` and `trigger-api`. **Pair it with `job`** — schedule and time-relative triggers run on the job service |

The tokens in `PLATFORM_CAPABILITY_TOKENS` not in that map do not resolve
through it:

- **Tier-gated** — `ai`, `ai-studio`, `i18n`, `ui`, `auth` have no provider
  entry; dedicated blocks in `serve.ts` `run()` open their tier instead
  (`ai`/`ai-studio` through the intent-driven AI block, the other three through
  their tier blocks).
- **Enterprise / cloud** — `hierarchy-security` has no open-edition provider and
  ships in `@objectstack/security-enterprise`, loaded through `plugins[]`;
  `ai-seat` and `governance` are resolved only by cloud's objectos-runtime.

The authoritative list is `PLATFORM_CAPABILITY_TOKENS`
(`@objectstack/spec`, `kernel/platform-capabilities.ts`) — an unknown token is
**rejected by `defineStack` at authoring time**, not at boot.

Five rules that change what you write:

- **Precedence:** `requires` › `tiers` › `--preset` › built-in default. An
  explicit instance in `plugins:` always shadows capability resolution.
- **Declaring is a demand.** A capability YOU declared whose provider package is
  absent is a hard boot error; one the platform auto-injects for you stays
  best-effort (warn and continue).
- **`auth` implies `email`.** Auth callbacks (password reset, email
  verification, magic link, invitation) need the mail service, so the CLI
  appends `email` whenever `auth` is required.
- **Keep `automation` whenever `plugins:` lists a connector** — connector
  executors register their provider factories with it, and without it they have
  nowhere to register and boot fails.
- **Pair `triggers` with `job`.** `triggers` alone arms record-change triggers;
  schedule and time-relative triggers run on the job service, so autolaunched
  scheduled flows stay silent without `job`.

### `onEnable` — where an app binds runtime code

`objectstack.config.ts` may export `onEnable` beside its default stack.
`AppPlugin` invokes it during boot and hands the app live runtime handles: this
is the one seam where declarative metadata reaches imperative code (registering
action handlers, giving a job its data handle, provisioning a fixture
datasource). All three example apps use it.

```typescript
export const onEnable = async (ctx: { ql: { registerAction: (...a: unknown[]) => void } }) => {
  registerTaskActionHandlers(ctx.ql);
};
```

→ Moved verbatim to [references/bootstrap.md](./references/bootstrap.md) § Plugin Loading Order Matters · § Programmatic Bootstrap (Without CLI).

---

→ Moved verbatim to [references/bootstrap.md](./references/bootstrap.md) § Multi-App Composition.

---

## Seed Data

The stack's `data:` collection is authored with `defineSeed()`, which
**objectstack-data** owns — go there for `externalId` matching, `env:` scoping,
and which keys are derived. In particular `object` is derived from the object
definition: never write it by hand, and never hand-write a raw
`data: [{ object: … }]` literal.

`mode` decides what a seed run does to rows that already exist:

| Mode | Behavior |
|:-----|:---------|
| `upsert` (default) | Insert or update based on `externalId` match |
| `insert` | Always insert (fails on duplicate) |
| `update` | Only update found records; ignore new ones |
| `ignore` | Insert if not exists, skip otherwise |
| `replace` | ⚠️ **Data loss** — drops and re-inserts all records |

---

## CLI Commands

Daily commands are covered in **Part 3 — Operations** below
([jump there](./references/operations.md#part-3--operations-cli-testing-deployment)). High-level cheat
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

→ Moved verbatim to [references/bootstrap.md](./references/bootstrap.md) § Complete Working Example.

---
---

→ Part 2 — Plugin Development & Kernel Extension moved verbatim to [references/plugin-development.md](./references/plugin-development.md) (Quick Reference — Detailed Rules · ObjectKernel vs LiteKernel · Plugin Interface — Quick Overview · PluginContext API · Complete Plugin Example · Using Plugins · Testing Plugins · Well-Known Plugin Names & Services · MetadataPlugin Runtime Boundary · Health Monitoring · Feature Flags); its detailed rules stay at [rules/plugin-lifecycle.md](./rules/plugin-lifecycle.md) · [rules/service-registry.md](./rules/service-registry.md) · [references/plugin-hooks.md](./references/plugin-hooks.md).

---
---

→ Part 3 — Operations: CLI, Testing, Deployment moved verbatim to [references/operations.md](./references/operations.md) (Daily-loop commands · Build & runtime · Verify your work · Ports & networking · Data & migrations · Environments & deploy · Shipping a plugin · Testing pattern · Deployment targets · Health & observability · Common ops pitfalls).

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

