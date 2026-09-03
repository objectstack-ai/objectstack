# ADR-0015: External Datasource Federation

**Status**: Accepted — backend/REST/CLI implemented; Studio UI + extra dialect drivers pending (proposed 2026-05-29 · calibrated 2026-06-12)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source of truth per metadata type)
**Consumers**: `@objectstack/spec`, `@objectstack/runtime`, `@objectstack/objectql`, `@objectstack/plugins/driver-sql`, `@objectstack/services/service-ai`, `@objectstack/cli`, `../objectui`

---

## 0. Context

ObjectStack today owns its own database: the `default` datasource is a
managed Postgres/SQLite where the framework freely runs DDL
(`createTable`, `alterTable`, migrations from `ISchemaDiffService`).
The protocol already includes:

- `Datasource` (`packages/spec/src/data/datasource.zod.ts`) — connection
  + driver + capabilities (transactions, queryFilters, readOnly, …).
- `Object.datasource` (`packages/spec/src/data/object.zod.ts#datasource`) — per-object
  routing key, defaulting to `'default'`.
- `ISchemaDiffService` (`packages/spec/src/contracts/schema-diff-service.ts`) —
  introspect → diff → migration plan.
- `ExternalLookup` (`packages/spec/src/data/external-lookup.zod.ts`) —
  per-field REST/OData/GraphQL live lookup with caching, retry, JSONPath
  extraction. **Not** a table-level federation primitive.
- `DataSync` (`packages/spec/src/automation/sync.zod.ts`) — batch/incremental
  replication between systems via connector instances.
- AI surface: `IDataEngine`-backed `query_data` tool, `SchemaRetriever`,
  `data-chat-agent`, `metadata-assistant-agent` — all consume objects
  uniformly through `IMetadataService` + ObjectQL.

What is **missing** for the "plug ObjectStack into a mature warehouse and
let the AI chat with it" use case:

1. **Ownership semantics.** Nothing in `Datasource` distinguishes
   "ObjectStack owns this schema" from "this is somebody else's
   production database — never touch DDL." The `capabilities.readOnly`
   flag only hints at query pushdown; it does not gate migrations.
2. **Boot-time validation.** No mechanism verifies that an externally
   bound object matches the remote table; declaring a wrong column type
   silently produces runtime errors at query time.
3. **Reverse introspection workflow.** `IDataEngine` drivers can
   `introspectSchema()`, but there is no CLI / UI / service that turns
   that into an ObjectStack `Object` draft.
4. **Catalog persistence.** Repeated introspection is expensive; we have
   no metadata type to cache the remote schema snapshot and surface
   drift.
5. **Write safety.** Writes through external datasources are neither
   blocked nor explicitly opted into.
6. **AI prompt awareness.** `SchemaRetriever` does not tell the LLM that
   a given object is external/read-only, so the model may attempt
   schema-mutating tool calls or generate unsafe writes.

This ADR proposes a single, layered solution that closes all six gaps
**without introducing a new metadata type for federated objects** —
keeping ADR-0005's "one Zod source per type" invariant intact.

---

## 1. Decision

Add **External Datasource Federation** as a first-class capability of
the existing `Datasource` and `Object` protocols, governed by three
runtime gates and supported by one new metadata type (`external_catalog`)
plus one new service contract (`IExternalDatasourceService`).

A federated object is still an `Object`. Its remote-ness is expressed by:

- the **datasource it points to** (`schemaMode !== 'managed'`), and
- an optional **`object.external`** sub-record describing the remote
  binding (table name, schema, column map, writability).

All downstream consumers (views, ObjectQL, REST, AI tools, permissions,
audit) continue to see a normal `Object`. Differences in behaviour are
enforced inside the runtime gates and the driver layer.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Configure mature external databases (Postgres, MySQL, Snowflake,
  BigQuery, MongoDB, …) through CLI **and** Studio UI.
- Register existing remote tables as ObjectStack objects **without
  touching the remote schema**.
- **Fail-fast** at registration / boot time when an object definition
  diverges from the remote table; emit an actionable diff.
- Make all existing capabilities work transparently for federated
  objects: ObjectQL pushdown, REST/GraphQL auto-routes, Views,
  Dashboards, Reports, AI Data Chat, AI report agents, RBAC, audit,
  realtime (where the driver supports it).
- Default to read-only; require **two explicit opt-ins** (datasource
  level + object level) to enable writes.
- Coexist with `ExternalLookup` (per-field HTTP) and `DataSync`
  (batch replication) without overlap or ambiguity.

### 2.2 Non-Goals (v1)

- Cross-datasource distributed transactions.
- Reverse DDL push (ObjectStack will never alter the remote schema).
- Replacing dedicated ETL — heavy batch ingestion remains the job of
  `DataSync` + connector plugins.
- Multi-statement stored-procedure invocation through ObjectQL.
- Cross-datasource joins (documented as a future workstream; users
  should mirror dimension tables via `DataSync` for now).

---

## 3. Conceptual Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ObjectStack Environment                       │
│                                                                      │
│   ┌─────────────┐      ┌──────────────────┐      ┌───────────────┐   │
│   │ Datasource  │◀────▶│ ExternalCatalog  │◀────▶│ Federated     │   │
│   │ schemaMode= │      │ (remote schema   │      │ Object        │   │
│   │ 'external'  │      │  snapshot+drift) │      │ external: {…} │   │
│   └─────────────┘      └──────────────────┘      └───────────────┘   │
│         │                                                │           │
│         │ routed via Object.datasource                   │           │
│         ▼                                                ▼           │
│   ┌──────────────────────┐                  ┌──────────────────────┐ │
│   │ Mature External DB   │  ◀── ObjectQL ──│ AI / Views / REST    │ │
│   │ (Postgres, Snowflake │      pushdown    │ unchanged consumers  │ │
│   │  MySQL, BigQuery…)   │                  │                      │ │
│   └──────────────────────┘                  └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Three new protocol artefacts:

| Artefact                  | Kind                    | Purpose                                                                          |
|:--------------------------|:------------------------|:---------------------------------------------------------------------------------|
| `Datasource.schemaMode`   | new field on existing   | Declare ownership (`managed` / `external` / `validate-only`).                    |
| `Object.external`         | new field on existing   | Per-object remote binding (table name, schema, writability, column overrides).   |
| `ExternalCatalog`         | **new metadata type**   | Cached remote schema snapshot + last validation diff, surfaced in Studio.        |

One new service contract: `IExternalDatasourceService` (introspect,
generate draft, refresh catalog, validate).

### 3.1 Why no `external_object` metadata type?

Introducing a parallel `external_object` Zod schema would force every
downstream consumer (views, ObjectQL planner, permissions, AI tools,
REST generator) to special-case two object shapes — violating
ADR-0005's "one Zod source per metadata type" invariant and roughly
doubling the protocol surface.

Instead, externality is a **property of the binding**, not a new
metadata kind. A federated object is still an `object` in
`DEFAULT_METADATA_TYPE_REGISTRY`; the difference is encoded by the
`datasource` it points to and an optional `external` sub-record.

---

## 4. Spec Layer Changes

All schemas live in `packages/spec/src/`. Each change is additive and
backward-compatible (defaults preserve current behaviour).

### 4.1 `data/datasource.zod.ts`

```ts
export const SchemaModeSchema = z.enum([
  'managed',        // ObjectStack owns this schema: DDL + migrations allowed.
  'external',       // Mature external DB: DDL forbidden; mismatch fails boot.
  'validate-only',  // Like external, but mismatches warn instead of fail.
]).describe('Schema ownership mode');

export const ExternalDatasourceSettingsSchema = z.object({
  label: z.string().optional()
    .describe('Display label, e.g. "Snowflake — ANALYTICS / PROD"'),
  allowedSchemas: z.array(z.string()).optional()
    .describe('Whitelist of remote schemas/databases that may be exposed.'),
  allowWrites: z.boolean().default(false)
    .describe('Global write gate. Individual objects must also opt in.'),
  validation: z.object({
    onMismatch: z.enum(['fail', 'warn', 'ignore']).default('fail'),
    checkOnBoot: z.boolean().default(true),
    checkIntervalMs: z.number().optional()
      .describe('Optional background drift-check interval.'),
  }).default({}),
  credentialsRef: z.string().optional()
    .describe('Reference into the secrets store; never inline credentials.'),
  queryTimeoutMs: z.number().default(30_000)
    .describe('Hard cap on per-query execution time.'),
});

export const DatasourceSchema = lazySchema(() => z.object({
  // …existing fields…
  schemaMode: SchemaModeSchema.default('managed'),
  external: ExternalDatasourceSettingsSchema.optional(),
}).superRefine((ds, ctx) => {
  if (ds.schemaMode !== 'managed' && !ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `schemaMode='${ds.schemaMode}' requires 'external' settings.`,
    });
  }
  if (ds.schemaMode === 'managed' && ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `'external' settings only apply when schemaMode != 'managed'.`,
    });
  }
}));
```

### 4.2 `data/object.zod.ts`

```ts
export const ObjectExternalBindingSchema = z.object({
  remoteName: z.string().optional()
    .describe('Remote table/view name. Defaults to object.name.'),
  remoteSchema: z.string().optional()
    .describe('Remote schema/database qualifier.'),
  writable: z.boolean().default(false)
    .describe('Per-object write opt-in (also requires datasource.external.allowWrites).'),
  columnMap: z.record(z.string(), z.string()).optional()
    .describe('Remote column name → local field name.'),
  introspectedAt: z.string().datetime().optional()
    .describe('Set by `os datasource introspect`; informational.'),
  ignoreColumns: z.array(z.string()).optional()
    .describe('Remote columns to skip during validation (dev convenience).'),
});

export const ObjectSchema = lazySchema(() => z.object({
  // …existing fields, including:
  // datasource: z.string().optional().default('default'),
  external: ObjectExternalBindingSchema.optional(),
}));
```

The cross-field invariant ("`object.external` only when its datasource
has `schemaMode !== 'managed'`") is enforced at metadata-load time,
not in the Zod schema, because the datasource may live in another
artefact.

### 4.3 `data/external-catalog.zod.ts` (new)

```ts
export const ExternalColumnSchema = z.object({
  name: z.string(),
  sqlType: z.string(),
  nullable: z.boolean(),
  primaryKey: z.boolean().default(false),
  suggestedFieldType: z.string().optional(),
});

export const ExternalTableSchema = z.object({
  remoteSchema: z.string().optional(),
  remoteName: z.string(),
  columns: z.array(ExternalColumnSchema),
  indexes: z.array(z.object({
    name: z.string(),
    columns: z.array(z.string()),
    unique: z.boolean(),
  })).optional(),
  rowCountEstimate: z.number().optional(),
});

export const ExternalCatalogSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Catalog id, conventionally `<datasource>_catalog`.'),
  datasource: z.string()
    .describe('Datasource.name this catalog snapshots.'),
  snapshotAt: z.string().datetime(),
  tables: z.array(ExternalTableSchema),
}));
```

Register in `DEFAULT_METADATA_TYPE_REGISTRY` with:

```ts
{ name: 'external_catalog', allowOrgOverride: false, schema: ExternalCatalogSchema }
```

### 4.4 `shared/external-errors.ts` (new)

```ts
export type SchemaDiffEntryKind =
  | 'missing_table' | 'missing_column' | 'type_mismatch'
  | 'nullability_mismatch' | 'unmapped_column' | 'pk_mismatch';

export interface SchemaDiffEntry {
  kind: SchemaDiffEntryKind;
  remoteSchema?: string;
  remoteName?: string;
  column?: string;
  expected?: string;
  actual?: string;
  severity: 'error' | 'warning';
}

export class ExternalSchemaMismatchError extends Error {
  readonly code = 'EXTERNAL_SCHEMA_MISMATCH';
  constructor(
    readonly datasource: string,
    readonly object: string,
    readonly diffs: SchemaDiffEntry[],
  ) { super(renderDiffMessage(datasource, object, diffs)); }
}

export class ExternalWriteForbiddenError extends Error {
  readonly code = 'EXTERNAL_WRITE_FORBIDDEN';
}

export class ExternalSchemaModeViolationError extends Error {
  readonly code = 'EXTERNAL_SCHEMA_MODE_VIOLATION';
}
```

### 4.5 `contracts/external-datasource-service.ts` (new)

```ts
export interface RemoteTable {
  schema?: string;
  name: string;
  columnCount: number;
  rowCountEstimate?: number;
}

export interface GenerateDraftOpts {
  remoteSchema?: string;
  rename?: Record<string, string>;   // remote col → field name
  primaryKey?: string[];             // override PK detection
  includeColumns?: string[];
  excludeColumns?: string[];
}

export interface SchemaValidationResult {
  ok: boolean;
  datasource: string;
  object: string;
  diffs: SchemaDiffEntry[];
}

export interface SchemaValidationReport {
  ok: boolean;
  results: SchemaValidationResult[];
}

export interface IExternalDatasourceService {
  listRemoteTables(datasource: string, opts?: { schema?: string }): Promise<RemoteTable[]>;
  generateObjectDraft(datasource: string, remoteName: string, opts?: GenerateDraftOpts): Promise<unknown>;
  refreshCatalog(datasource: string): Promise<ExternalCatalog>;
  validateObject(objectName: string): Promise<SchemaValidationResult>;
  validateAll(): Promise<SchemaValidationReport>;
}
```

### 4.6 Type compatibility matrix

A pure module `packages/spec/src/data/type-compat.ts` maps SQL types
(`text`, `varchar`, `numeric(10,2)`, `timestamptz`, `jsonb`, …) to
ObjectStack field types, and exposes `isCompatible(remoteSqlType,
fieldType): boolean | 'lossy'`. The matrix is dialect-aware
(`postgres`, `mysql`, `sqlite`, `snowflake`, `bigquery`, `mongo`). New
dialects extend the matrix; the matrix is unit-tested independently.

---

## 5. Runtime Gates

Three gates enforce the ownership semantics. Each gate is a single
choke-point so the rules are auditable and cannot be bypassed by
accident.

### 5.1 Gate 1 — DDL gate (driver layer)

**Where**: every driver method that mutates schema
(`createTable`, `alterTable`, `dropTable`, plus the
`ISchemaDiffService.applyMigrations` implementation).

**Behaviour**:

```ts
if (datasource.schemaMode !== 'managed') {
  throw new ExternalSchemaModeViolationError(
    `DDL is forbidden on datasource '${datasource.name}' (schemaMode=${datasource.schemaMode}).`,
  );
}
```

**Concretely** — `packages/drivers/driver-sql/src/sql-driver.ts`
and `packages/drivers/driver-sql/src/sql-driver.ts` (current `createTable` / `alterTable` call sites) gain a
guard at the top. The `applyMigrations` implementation (forthcoming
in `service-migration` per ADR-0008) also calls this guard.

### 5.2 Gate 2 — Boot validation (runtime layer)

**Where**: a new `external-validation-plugin` registered in
`@objectstack/runtime`, subscribed to `kernel:ready`.

**Behaviour**:

```ts
const report = await externalDatasourceService.validateAll();
for (const r of report.results.filter(r => !r.ok)) {
  const ds = datasources.get(r.datasource)!;
  const mode = ds.external?.validation.onMismatch ?? 'fail';
  if (mode === 'fail') throw new ExternalSchemaMismatchError(r.datasource, r.object, r.diffs);
  if (mode === 'warn') logger.warn({ diffs: r.diffs }, 'external schema drift');
}
```

The validator walks every object whose datasource has
`schemaMode !== 'managed'`, runs `IExternalDatasourceService.validateObject`,
and aggregates the report. Catalog snapshots are reused across
validations within a boot to avoid duplicate introspection.

Background drift checks: if `checkIntervalMs` is set, the plugin also
schedules a periodic re-validation that emits `external.schema.drift`
events on the kernel event bus (consumed by `audit` and `notification`
services).

### 5.3 Gate 3 — Write gate (data engine layer)

**Where**: `IDataEngine.insert/update/delete` (in
`packages/objectql/src/engine.ts`).

**Behaviour**:

```ts
if (datasource.schemaMode !== 'managed') {
  const dsAllows = datasource.external?.allowWrites ?? false;
  const objAllows = object.external?.writable ?? false;
  if (!(dsAllows && objAllows)) {
    throw new ExternalWriteForbiddenError(
      `Writes blocked: datasource.external.allowWrites=${dsAllows}, object.external.writable=${objAllows}.`,
    );
  }
}
```

The double opt-in (datasource **and** object) is intentional: an
administrator enabling writes on the warehouse must still annotate
each writable object explicitly.

### 5.4 Failure surface

| Gate              | Error                                | Where surfaced                                                      |
|:------------------|:-------------------------------------|:--------------------------------------------------------------------|
| DDL               | `ExternalSchemaModeViolationError`   | Migration runner, dev `pnpm dev` startup, CI `os migrate plan`.     |
| Boot validation   | `ExternalSchemaMismatchError`        | `kernel:ready` → process exits (mode=fail) or logs (mode=warn).     |
| Write             | `ExternalWriteForbiddenError`        | REST 403, ObjectQL mutation, AI tool error, returned to caller.     |

All three error classes carry a stable `code` field and are mapped to
the shared error envelope in `packages/spec/src/shared/error-map.ts`.

---

## 6. Service Layer

### 6.1 New service: `@objectstack/services/service-external-datasource`

Implements `IExternalDatasourceService` on top of the existing driver
`introspectSchema()` contract:

- `listRemoteTables(ds)` → `driver.introspectSchema()` filtered by
  `datasource.external.allowedSchemas`.
- `generateObjectDraft(ds, table, opts)` → renders a TypeScript
  `defineObject({ … })` source using the type-compat matrix; the draft
  carries an `// REVIEW:` comment on every column whose mapping is
  `'lossy'`.
- `refreshCatalog(ds)` → builds an `ExternalCatalog` record and writes
  it through `IMetadataService.upsert('external_catalog', …)`.
- `validateObject(name)` → loads the latest catalog (or refreshes if
  stale) and diffs against the object's field list using the
  type-compat matrix.
- `validateAll()` → fans out across all federated objects, parallelised
  per datasource.

The service is registered as a kernel service so plugins, the CLI, the
runtime plugin, and the REST layer can all consume it through DI.

### 6.2 REST routes

Added under `/api/v1/datasources/:name/external/...`:

```
GET    /tables                       → listRemoteTables
POST   /tables/:remote/draft         → generateObjectDraft (returns TS source)
POST   /refresh-catalog              → refreshCatalog
POST   /validate                     → validateAll for this datasource
GET    /catalog                      → latest ExternalCatalog
```

All routes require the `metadata:write` permission; reads require
`metadata:read`. The Studio UI consumes these.

### 6.3 CLI commands (`packages/cli`)

```
os datasource add        --name --driver --schema-mode --url [--credentials-ref]
os datasource list       [--mode external]
os datasource list-tables <name> [--schema]
os datasource introspect <name> --table <remote> [--out path] [--rename a=b ...]
os datasource refresh    <name>
os datasource validate   [<name> | --all]
os datasource remove     <name>
```

`os datasource introspect` is the canonical onboarding flow: it prints
the generated `*.object.ts` to stdout (or `--out`), already populated
with `datasource:` and `external: { remoteSchema, remoteName }`.

### 6.4 Studio UI (`../objectui`)

A new "External Data Sources" surface, served by the routes above:

1. **Connection wizard** — driver picker, credential entry (writes to
   secrets store, never to git), live "Test connection" button.
2. **Schema browser** — tree of catalog → schema → table → column with
   row-count estimates; "Import as Object" action per table.
3. **Mapping editor** — side-by-side remote columns vs. object fields
   with rename / type-override controls; preview pane shows the
   resulting `*.object.ts`.
4. **Validation panel** — green/yellow/red status per object with the
   diff list; "Refresh catalog" and "Re-validate" buttons.
5. **Drift inbox** — surfaces `external.schema.drift` events from the
   background checker.

The UI lives in the sibling `../objectui` repo per AGENTS.md; the
backend serves only the data plane.

---

## 7. AI Integration (the "free lunch")

The decisive design choice — keeping a federated object as a normal
`Object` — means the entire AI surface works **with one line of
prompt-side awareness** and zero changes to tools, agents, or
conversation services.

### 7.1 What just works

| Capability                                                | Why no changes needed                                                  |
|:----------------------------------------------------------|:-----------------------------------------------------------------------|
| `query_data` AI tool                                      | Resolves the object via `IMetadataService` and runs ObjectQL through `IDataEngine`; the engine routes by `object.datasource`. |
| `SchemaRetriever` schema injection                        | Iterates over all registered objects regardless of datasource.         |
| `data-chat-agent` / `metadata-assistant-agent`            | Consume `IDataEngine` + `IMetadataService` only.                       |
| Reports, dashboards, charts                               | Defined against objects, not against tables.                           |
| ObjectQL filter / sort / aggregation pushdown             | Driver capabilities already drive pushdown decisions.                  |
| REST `/api/v1/data/<object>` auto-routes                  | Generated from the object registry.                                    |
| RBAC / row-level security                                 | `plugin-security` applies the same policy graph; predicates are pushed into `WHERE`. |

### 7.2 The one prompt-side change

`SchemaRetriever.renderSnippet()` annotates each object with its
ownership and writability so the LLM does not propose unsafe actions:

```
### wh_order — Warehouse Order  [external, read-only, datasource=warehouse]
  - order_id: text (pk)
  - customer_id: text
  - amount: number
  - ordered_at: datetime
```

`data-chat-agent` and `metadata-assistant-agent` system prompts gain a
short rule:

> Objects marked `[external, read-only]` come from a customer's
> production database. You must not propose schema changes, writes, or
> destructive operations on them. Always include sensible `limit` and
> time-range filters when querying them.

### 7.3 Query safety nets for AI-generated workloads

To prevent a chatty LLM from melting a production warehouse:

- **Default LIMIT injection.** `query_data` wraps every AI-generated
  ObjectQL query with a `limit: 1000` unless the user explicitly asks
  for more.
- **Per-datasource timeout.** `Datasource.external.queryTimeoutMs`
  (default 30 s) is enforced inside the driver; the AI tool returns a
  truncated-with-hint result on timeout.
- **Read replica convention.** Documentation strongly recommends
  pointing the datasource at a read replica; this is policy, not code.
- **Audit trail.** Every ObjectQL execution against an external
  datasource emits an `external.query.executed` event (object, SQL,
  rows, ms, actor) consumed by `audit`.

---

## 8. End-to-End Example

```ts
// datasources/warehouse.datasource.ts
export default defineDatasource({
  name: 'warehouse',
  driver: 'postgres',
  schemaMode: 'external',
  config: { connectionString: process.env.WAREHOUSE_URL },
  external: {
    label: 'Analytics Warehouse (read replica)',
    allowedSchemas: ['public', 'mart'],
    allowWrites: false,
    validation: { onMismatch: 'fail', checkOnBoot: true },
    queryTimeoutMs: 15_000,
    credentialsRef: 'secret:warehouse/readonly',
  },
});
```

```bash
os datasource list-tables warehouse --schema mart
#  mart.fact_orders         (14 cols, ~12.4M rows)
#  mart.dim_customer        ( 9 cols, ~  280k rows)
#  mart.dim_product         (11 cols, ~   42k rows)

os datasource introspect warehouse --table fact_orders --out objects/wh_order.object.ts
```

```ts
// objects/wh_order.object.ts (generated, then human-reviewed)
export default defineObject({
  name: 'wh_order',
  label: 'Warehouse Order',
  datasource: 'warehouse',
  external: { remoteSchema: 'mart', remoteName: 'fact_orders' },
  fields: [
    { name: 'order_id',    type: 'text',     primaryKey: true },
    { name: 'customer_id', type: 'text' },
    { name: 'amount',      type: 'number' },
    { name: 'ordered_at',  type: 'datetime' },
    // REVIEW: remote column 'metadata jsonb' mapped lossy to 'json'
    { name: 'metadata',    type: 'json' },
  ],
});
```

```bash
os datasource validate warehouse
# ✓ wh_order matches warehouse.mart.fact_orders (5/14 mapped, 9 unmapped — ok)

pnpm dev:crm -- --fresh -p 38421
# [info] external-validation: 1 datasource, 1 object, 0 mismatches
```

User in Studio's Data Chat: *"哪些客户过去 7 天下单金额最高？前 10。"*

The data-chat-agent generates ObjectQL:

```ts
{
  object: 'wh_order',
  select: ['customer_id', { agg: 'sum', field: 'amount', as: 'total' }],
  where: { ordered_at: { $gte: '7d ago' } },
  groupBy: ['customer_id'],
  orderBy: [{ field: 'total', dir: 'desc' }],
  limit: 10,
}
```

`IDataEngine` routes to the `warehouse` driver, which pushes the entire
query down as a single `SELECT … GROUP BY … ORDER BY … LIMIT 10` into
Postgres. The LLM summarises the result; the audit log records the
SQL, the actor, and the 412 ms execution time.

---

## 9. Coexistence Matrix

The three "external data" primitives serve different needs and may all
appear in the same environment without conflict:

| Need                                              | Use                                          |
|:--------------------------------------------------|:---------------------------------------------|
| Live federation of remote tables, AI/ad-hoc query | **This ADR** — `Datasource(schemaMode=external)` + `Object`. |
| Per-field live HTTP/OData/GraphQL lookup          | `ExternalLookup` on a field.                 |
| Batch / incremental replication into a local table| `DataSync` + connector instance.             |

Example: a single environment can federate a Snowflake warehouse for
analytics, use `ExternalLookup` to enrich CRM records from a SaaS HTTP
API, and `DataSync`-mirror a slowly-changing dimension into the
managed Postgres for low-latency joins.

---

## 10. Security, Operations, Multitenancy

- **Credentials** never appear in metadata artefacts. `credentialsRef`
  points at `service-secrets`; the secrets service is the only
  component that resolves the actual connection string.
- **Connection pools** default conservatively for external mode
  (`max: 5`) to protect the remote system; `pool` may be overridden.
- **Timeouts** are enforced at the driver. AI tool calls additionally
  wrap a `Promise.race(timeout)` and report a graceful error to the
  LLM.
- **Audit**: `driver-sql` already emits `query.executed`;
  `service-audit` filters by `datasource.schemaMode === 'external'` to
  produce a dedicated external-access log.
- **Tenant scope**: a `Datasource` is environment-scoped (per ADR-0006
  v4). It is not organisation-overlay-customisable; admins of one
  environment cannot see another environment's external datasources.
- **Permissions**: ACLs apply unchanged. A new optional convenience —
  `Datasource.external.requirePermission?: string` — lets admins gate
  the entire datasource behind a single role without writing per-object
  ACLs.
- **Realtime**: where the underlying driver supports CDC (e.g.
  Postgres logical decoding), the `realtime` service may opt-in;
  otherwise federated objects fall back to poll-based change feeds.
  This is out of scope for v1.

---

## 11. Rollout Plan

Each phase is independently shippable and testable.

| Phase | Scope                                                                                              | Estimate |
|:-----:|:---------------------------------------------------------------------------------------------------|:--------:|
| **P1** | Spec changes (`schemaMode`, `object.external`, error classes) + DDL gate in `driver-sql` + tests. | 1–2 d    |
| **P2** | `IExternalDatasourceService` implementation + type-compat matrix + CLI `introspect` / `validate`. | 2–3 d    |
| **P3** | Boot validation plugin in `@objectstack/runtime` + `external_catalog` metadata type + caching.    | 1 d      |
| **P4** | `SchemaRetriever` annotation + agent prompt update + AI safety nets (LIMIT injection, timeout).   | 0.5 d    |
| **P5** | Studio UI in `../objectui` (wizard, schema browser, mapping editor, validation panel).            | ~1 w     |
| **P6** | Write gate + `allowWrites/writable` double opt-in + tests.                                        | 1 d      |
| **P7** | Additional drivers (Snowflake / BigQuery / MySQL adapters) — sized per driver.                    | 2–4 d ea |

**MVP = P1–P4**: after MVP, a user can connect a read-only Postgres
replica, register a few tables, and let the AI Data Chat query them
safely. P5 makes it a product; P6 unlocks writes; P7 expands the
driver matrix.

---

## 12. Risks & Mitigations

| Risk                                                              | Mitigation                                                                                              |
|:------------------------------------------------------------------|:--------------------------------------------------------------------------------------------------------|
| Remote schema evolves, breaking federated objects                 | `checkIntervalMs` background validator; `external.schema.drift` events into audit + notification.        |
| AI generates a runaway query against production                   | Default `limit: 1000`, per-datasource `queryTimeoutMs`, recommend read replica, audit every query.      |
| Type mapping is imperfect across dialects                         | Type-compat matrix is an explicit, unit-tested module; generated drafts carry `// REVIEW:` markers.     |
| Introspection of huge schemas is slow                             | Snapshot persisted as `external_catalog`; refresh is explicit (`os datasource refresh`) or scheduled.    |
| User expects cross-datasource joins                               | Documented limit; recommend `DataSync` to mirror dimension tables locally; revisit federation in vNext. |
| Misconfigured `schemaMode='managed'` against a real warehouse     | Connection wizard defaults to `external` for any non-`default` datasource; UI surfaces a red banner.    |
| Plugin author bypasses the DDL gate by calling knex directly      | `sql-driver` wraps knex; direct knex access is a documented private API. Lint rule in P1 enforces it.    |

---

## 13. Alternatives Considered

### 13.1 New `external_object` metadata type

**Rejected.** Doubles the protocol surface; every downstream consumer
would need to handle two object shapes; violates ADR-0005. The
`object.external` sub-record gives identical expressiveness with
strictly less surface.

### 13.2 Reuse `ExternalLookup` for tables

**Rejected.** `ExternalLookup` is field-scoped and HTTP-shaped. Table
federation needs driver-level connection pooling, query pushdown,
typed schema, and ObjectQL planner integration — all things
`ExternalLookup` deliberately omits.

### 13.3 Always materialise via `DataSync`

**Rejected as the only option.** Materialisation defeats the "live
analytics on a mature warehouse" use case and costs storage we do not
own. `DataSync` remains the right tool for *some* tables (small
dimensions, offline analysis); federation is the right tool for
*others* (huge fact tables, real-time freshness). They coexist.

### 13.4 Boolean `readOnly` on `Datasource`

**Rejected.** Conflates two orthogonal concerns: query-side pushdown
hints (already covered by `capabilities.readOnly`) and ownership /
DDL gating (introduced here). The enum `schemaMode` leaves room for a
future `'replica'` mode without re-shaping the schema.

### 13.5 Validate lazily (on first query) instead of at boot

**Rejected.** Late failures surface deep inside the AI tool call, far
from the misconfigured artefact, and only when the schema in question
is exercised. Boot-time fail-fast matches the rest of the framework's
ergonomics (manifest validation, plugin registration, settings
validation).

---

## 14. Open Questions

- **Cross-environment sharing.** Can two environments register the
  same physical datasource? (Tentative answer: yes, each environment
  has its own `Datasource` artefact; the secrets/credentials may
  coincidentally point to the same DB. Out of scope to enforce
  exclusivity.)
- **Schema-evolution autofix.** Should `os datasource validate
  --autofix` rewrite the local `*.object.ts` to match remote drift?
  (Tentative: yes, behind explicit flag, for dev only.)
- **Granular write policy.** Beyond per-object `writable: true`, do we
  need per-field write masks? Defer until a user need surfaces.
- **Realtime / CDC integration.** Out of scope for v1; tracked as a
  follow-up ADR.

---

## 15. Consequences

**Positive**

- Customers can point ObjectStack at an existing warehouse in minutes
  and immediately get AI-powered query, charting, and reporting on it.
- The protocol gains a clear, enforceable boundary between "we own
  this database" and "we are a guest in this database."
- Zero-touch reuse of every existing AI capability (`query_data`,
  agents, retrievers).
- One new metadata type, three new fields, three runtime gates — the
  blast radius is small.

**Negative**

- New service (`service-external-datasource`) and new CLI surface to
  maintain.
- Per-driver introspection quality varies; some dialects need
  significant matrix work.
- Studio UI surface grows non-trivially in `../objectui`.

**Neutral**

- `ExternalLookup` and `DataSync` are unchanged but gain a sibling;
  documentation must clarify which to use when.

---

## 16. Acceptance Criteria

The ADR is considered "delivered" when:

1. `pnpm test` passes with new unit tests for: Zod refinements on
   `schemaMode`, the DDL gate, the boot validator, the write gate, and
   the type-compat matrix.
2. `os datasource introspect` produces a `*.object.ts` for a real
   Postgres schema and `os datasource validate` reports `ok: true`.
3. Mutating any column type in the object file and re-running
   `pnpm dev:crm` fails with an `ExternalSchemaMismatchError` printing
   the diff.
4. With a federated object loaded, the data-chat-agent answers a
   natural-language question and the audit log records the
   pushed-down SQL, the actor, and the execution time.
5. Studio shows the datasource, its catalog, and validation status
   (P5 milestone).

---

## 17. References

- ADR-0003 — Package as first-class citizen.
- ADR-0005 — Metadata customization overlay (one Zod source per type).
- ADR-0006 v4 — Project / environment split (environment scoping).
- ADR-0008 — Metadata repository and change log.
- `packages/spec/src/data/datasource.zod.ts`
- `packages/spec/src/data/object.zod.ts`
- `packages/spec/src/data/external-lookup.zod.ts`
- `packages/spec/src/automation/sync.zod.ts`
- `packages/spec/src/contracts/schema-diff-service.ts`
- `packages/drivers/driver-sql/src/sql-driver.ts` (introspectSchema, createTable, alterTable)
- `packages/services/service-ai/src/tools/query-data.tool.ts`
- `packages/services/service-ai/src/schema-retriever.ts`

---

## 18. Addendum (2026-06): Federation read path honours `remoteName` / `remoteSchema`

**Status:** accepted — implements §3.1 / §8 of this ADR that shipped only partially.

### Problem

The spec, introspection (`os datasource introspect`), boot validation (§5.2), and
the write gate (§5.3) all honoured an object's `external.remoteName` /
`external.remoteSchema`. **The query-execution path did not.** Reads resolved the
physical table from the *object name* alone, ignoring the binding — so the
canonical example in §8 (object `wh_order` → `external: { remoteSchema: 'mart',
remoteName: 'fact_orders' }`) could not actually be queried.

Reproduced with the real engine + a real better-sqlite3 driver: an object
`ext_customer` bound to remote table `remote_customers` via `remoteName` failed
with `no such table: ext_customer`; only naming the object `remote_customers`
returned rows. This is a correctness gap, not a feature request — the declared
contract validated green and then queried the wrong (non-existent) table.

### Root cause

- `SqlDriver.getBuilder(object)` did `this.knex(object)` — the object name *was*
  the physical table.
- Per-object read-coercion metadata (`json`/`boolean`/`numeric`/`date`/`datetime`)
  is populated only inside `initObjects()`, whose first statement is
  `assertSchemaMutable()` (the DDL gate, §5.1) → it throws for any
  `schemaMode !== 'managed'` driver. The boot schema-sync swallowed that throw
  per-object, leaving external objects with **zero** coercion metadata and no
  table-name mapping.

### Fix

- **`SqlDriver.registerExternalObject(schema)`** — a DDL-free counterpart to
  `initObjects()`. It records the physical remote table
  (`physicalTableByObject` / `physicalSchemaByObject`) and populates the same
  coercion maps, keyed by **object name** (matching `formatInput`/`formatOutput`/
  `coerceFilterValue`), without running any DDL.
- **`getBuilder()`** now resolves `physicalTableByObject[object] ?? object`, and
  applies `.withSchema()` when a remote schema is recorded. Managed objects miss
  both maps, so the path is unchanged (one `undefined` lookup).
- **Coercion re-keying** — `applyFilters`/`applyFilterCondition` map the builder's
  physical table back to the object name (`coercionKey`) so date/datetime filter
  coercion still resolves after the table switch.
- **Engine/plugin routing** — `ObjectQLPlugin.syncRegisteredSchemas` (boot) and
  `ObjectQL.syncObjectSchema` (on-demand) route objects with `external != null`
  to `driver.registerExternalObject()` instead of the DDL `syncSchema`. The
  on-demand path lets an app register a *late* external driver (one added via an
  `onEnable` hook) and then make its objects queryable.
- **Driver contract** — `IDataDriver.registerExternalObject?()` is declared
  optional, so non-SQL drivers degrade gracefully (the engine skips external
  objects they can't serve).

### Scope

- `remoteName` is honoured on **all** dialects.
- `remoteSchema` is applied via `knex.withSchema()` on Postgres / MySQL; on
  **SQLite it is a no-op** (no schema namespace) and logs a one-time warning.
- External reads use **best-effort coercion**: with no DDL/`columnInfo`, coercion
  is driven purely by the declared field types. Keep external object fields to
  well-understood scalar types.

### `external.columnMap` (added in a follow-up)

`external.columnMap` ({ remoteColumn → localField }) is now honored on the read +
write paths. `registerExternalObject` inverts it to localField → remoteColumn;
`SqlDriver` translates WHERE + ORDER BY to the physical remote column (coercion
stays keyed by the local field), `formatOutput` renames remote-column keys back to
local field names, and write payloads are key-remapped after `formatInput`.
Managed objects and external objects without a columnMap are unchanged (the
resolver falls back to the existing per-site behavior). `field.columnName`
reconciliation (its inverse) is left untouched — `columnMap` is the
external-binding mechanism.

### Explicitly out of scope (separate follow-ups)

1. **Native-analytics SQL over external objects** — the analytics service compiles
   its own `FROM "<table>"` outside the driver and needs the same remote-table
   awareness.
3. **Auto-connecting declared datasources** as queryable ObjectQL drivers in the
   standalone runtime. Today a declared non-default datasource appears in the
   metadata registry (Setup → Datasources) but is only made queryable by
   registering a live driver under its name (e.g. via an app `onEnable` hook).

### Tests

`packages/drivers/driver-sql/src/sql-driver-external-remote-name.test.ts` (read /
filter / coercion against a differently-named remote table, no DDL leakage) and an
added case in `sql-driver-ddl-gate.test.ts` (`registerExternalObject` is DDL-free).
File-based better-sqlite3 tests require Node ≥ 25 (ABI 141) in this repo.
