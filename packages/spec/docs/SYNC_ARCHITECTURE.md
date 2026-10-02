# Data Synchronization Architecture

ObjectStack has **one** protocol layer for data synchronization and integration: the
Enterprise Connector. This document describes it, and records the two layers that
were removed above it.

> **History note (v17):** this document used to describe a 3-layer architecture. Both
> of the layers above L3 have since been retired under ADR-0049 enforce-or-remove, for
> the same measured reason — **no engine ever executed either of them**:
> **"L1: Simple Sync"** (`DataSyncConfig`, `automation/sync.zod.ts`) in #4738, and
> **"L2: ETL Pipeline"** (`ETLPipeline`, `automation/etl.zod.ts`) in #6414. See
> [Retired: L1 Simple Sync](#retired-l1-simple-sync-v17) and
> [Retired: L2 ETL Pipeline](#retired-l2-etl-pipeline-v17) for what each declared and
> what to use instead. The historical L3 numbering is kept in the level heading so
> older references stay legible.
>
> ⚠️ **This document was itself part of the L2 defect.** When L1 was retired it sent
> L1's authors on to L2 — a layer with no executor either — and it advertised ten ETL
> transformation types in a table concrete enough to copy from. A document that
> recommends a layer nothing runs is how a `declared ≠ enforced` gap propagates
> instead of closing. It is corrected here, in the same change as the retirement,
> which is why the L2 section below tells you what is gone rather than how to author
> it.

## Overview

| Level | Protocol | File | Audience | Use Case | Complexity |
|-------|----------|------|----------|----------|------------|
| **L3: Enterprise Connector** | `Connector` | `integration/connector.zod.ts` | System integrators | Full SAP integration with advanced features | ⭐⭐⭐ Advanced |

---

## Retired: L1 Simple Sync (v17)

**Removed in:** #4738 (dual-source ledger #4535, clusters C13+C15)
**Was:** `DataSyncConfig` + `ConflictResolution` + the `Sync` factory in `packages/spec/src/automation/sync.zod.ts`

The L1 layer was **narrative-only**: no engine ever parsed, scheduled or executed a
`DataSyncConfig` — the schema had zero importers across objectstack, cloud and
objectui, was unreachable from the metadata-type roots (#4650 gate), and existed
solely in this document's 3-layer story. Keeping a documented authoring surface
that nothing enforces is exactly the `declared ≠ enforced` gap Prime Directive #10
forbids, and its `DataSyncConfig` / `ConflictResolution` names collided with the
live declarations in `integration/connector.zod.ts` and `ui/offline.zod.ts` (the
#4411 dual-source trap).

**What to use instead:**

- **Connector-attached sync** — ~~`ConnectorSchema.syncConfig`~~ **also retired**
  (ADR-0049): parsed, never executed. A sync is now defined on its target — see
  [Data sync is defined on the target](#data-sync-is-defined-on-the-target).
- **Transformation pipelines** — ~~`ETLPipeline` (`automation/etl.zod.ts`) for
  multi-source, multi-stage data movement~~ **also retired, at #6414** (ADR-0049), on
  the same reading this section applies to L1: zero execution-side consumers, no
  `liveness/` ledger row, no engine that ever parsed a pipeline. This bullet is the
  reason the L2 retirement had to correct this document rather than only the schema —
  it was actively forwarding displaced L1 authors to a second inert layer. There is
  no third layer to forward to; see
  [Retired: L2 ETL Pipeline](#retired-l2-etl-pipeline-v17).
- **Client offline sync** — ~~`SyncConfigSchema` / `ConflictResolution`
  (`ui/offline.zod.ts`)~~ **also retired, at #4988** (ADR-0049). That vocabulary
  had no carrier key either: no schema in the protocol declared an `offline:`
  slot, so nothing ever parsed it. Offline sync is a platform capability, and
  when it is built its vocabulary arrives on the sync engine that owns the
  queue, the conflict policy and the cache — not as a standalone `ui/` config
  shape. The bare `ConflictResolution` name is consequently published by no def
  at all, and the connector's `ConnectorConflictResolution` left with `syncConfig`.

---

## Retired: L2 ETL Pipeline (v17)

**Removed in:** #6414 (ADR-0049 enforce-or-remove; ADR-0078 no-silently-inert-metadata)
**Was:** `ETLPipeline`, `ETLPipelineRun`, `ETLSource`, `ETLDestination`,
`ETLTransformation`, the `ETLEndpointType` / `ETLTransformationType` / `ETLSyncMode` /
`ETLRunStatus` enums and the `ETL` factory, in
`packages/spec/src/automation/etl.zod.ts`

L2 was **narrative-only**, on exactly the reading that retired L1 one layer up. No
engine ever parsed, scheduled or executed an `ETLPipeline`. Measured on `origin/main`
immediately before the removal:

- the only non-spec references in this repo were two fumadocs-generated documentation
  sources (`apps/docs/.source/*.ts`) — not executors;
- objectui had no reference at all;
- there was no `packages/spec/liveness/etl.json`, so no ADR-0049 gate ever had a
  reading on the surface. The contrast that makes that absence meaningful rather than
  an oversight is in the same file family: import mapping's `transform` **is** applied
  row by row by the REST import path, and it **does** have a ledger
  (`packages/spec/liveness/mapping.json`).

What an author got was ADR-0078's asymmetry in its purest form: write a complete
ten-stage pipeline, get no error, and get no execution.

**What to use instead — layer by layer, and one honest gap:**

- **Scheduled pull from an external system** — the target-side binding
  `mapping.connectorSource` with a `job` for the cadence (pulled when a job drives it;
  the job stage that schedules it has not landed — see
  [Data sync is defined on the target](#data-sync-is-defined-on-the-target)).
- **Per-field value conversion on import** — `mapping.fieldMapping[].transform`
  (`data/mapping.zod.ts`): a string enum (`none` / `constant` / `map` / `split` /
  `join` / `lookup`) with its settings in `params`, applied row by row by the REST
  import path and recorded key by key in `packages/spec/liveness/mapping.json`.
- **Recurring execution** — `system/job.zod.ts`.
- **Multi-source aggregation, joins, custom-SQL stages: nothing.** This is the gap,
  stated plainly rather than papered over with a redirect — the mistake this section
  replaces. There is no replacement surface because there was never an implementation;
  the ten transformation types this document used to tabulate (`map`, `filter`,
  `aggregate`, `join`, `script`, `lookup`, `split`, `merge`, `normalize`,
  `deduplicate`) named capabilities no runtime had. If multi-stage movement becomes a
  real requirement it returns through ADR-0049's **enforce** route — the engine first,
  the vocabulary second — not by re-publishing the shape.

**Already authored a pipeline?** Nothing was deployed under it (that is the finding),
so there is no data migration. `tsc` reports TS2724/TS2305 at every import of a
retired name, and the D3 record is the `etl-pipeline-layer-retired` entry in
`packages/spec/src/migrations/registry.ts`, which `os migrate meta` and the generated
upgrade guide project.

---

## Level 3: Enterprise Connector

**File:** `packages/spec/src/integration/connector.zod.ts`
**Audience:** System integrators, enterprise architects
**Complexity:** ⭐⭐⭐ Advanced

### Purpose

Complete, production-grade integration with external systems. Includes authentication, security, retry policies, and full lifecycle management.

### Key Features

- ✅ **Authentication**: OAuth2, JWT, SAML, API Key, Basic Auth
- ✅ **Retry Policies**: Exponential backoff and the rest of `retryConfig` — executed; see below
- ❌ **Sync and field mapping on the connector**: **not provided** — `syncConfig` / `fieldMappings` were retired; see below
- ✅ **Security**: Signature verification, encryption
- ❌ **Health checks and circuit breaking**: **not provided** — the `health` block was retired; see below
- ❌ **Webhooks on the connector**: **not provided** — declare webhooks in the stack's top-level `webhooks:` collection; see below
- ❌ **Outbound rate limiting**: **not provided** — at this or any other level; see below

> **There is no outbound rate limiting.** This list used to carry a ticked
> "**Rate Limiting**: Token bucket, leaky bucket algorithms" line. It named two
> algorithms that never existed. `connector.rateLimitConfig` — and the entire
> `ConnectorRateLimitConfig` / `RateLimitStrategy` shape behind it — was removed
> in `@objectstack/spec` 17.0.0 (#4911, ADR-0049 D2), because **no outbound
> rate-limiting engine ever existed**. The platform's only token bucket
> (runtime `security/rate-limit.ts`) throttles **INBOUND** requests *to* us;
> nothing throttles the calls a connector makes *out*. Do **not** substitute
> `shared`'s `RateLimitConfig` — that is the inbound limiter and would cap the
> wrong direction. **Until an outbound throttle exists, rate-limit at the
> connector provider or upstream gateway.**
>
> **What you MAY reach for is `retryConfig`: ADR-0049 ruled `实现` and the
> platform now executes it.** A connector's declared policy is applied at the
> one place the platform makes an outbound call — `shared/resilientFetch` — via
> the single mapping in `src/integration/connector-fetch-policy.ts`: the backoff
> shape (`strategy`, `initialDelayMs`, `backoffMultiplier`, `maxDelayMs`,
> `jitter`), the attempt count (`maxAttempts`, counting TOTAL calls with the
> first included), what is retried (`retryableStatusCodes`, whose default
> `[408, 429, 500, 502, 503, 504]` includes `429`, and `retryOnNetworkError`),
> and `requestTimeoutMs` as each attempt's deadline. `ConnectorProviderContext`
> (`src/integration/connector-provider.ts`) carries the policy to a provider
> factory, so a custom provider doing its own I/O honours the same thing the
> built-in HTTP providers honour by construction.
>
> ⚠️ **A retry is not a throttle.** Retrying a `429` spaces out calls you have
> already made; it does not cap the rate at which you make them. The rate-limit
> advice above is unchanged: throttle at the connector provider or upstream
> gateway.
>
> **There is no health probe, no circuit breaker, no authored status and no
> connector-owned webhook.** This list used to tick "**Monitoring**: Health
> checks, metrics, logging", "**Webhooks**: Bidirectional event notifications"
> and a circuit breaker beside the retry policy. `connector.health` (the
> `healthCheck` probe and the `circuitBreaker`), `connector.status` and the
> connector-nested `webhooks` were removed in `@objectstack/spec` 17 (ADR-0049
> enforce-or-remove) — sixteen keys that nothing read: no loop ever polled a
> connector endpoint or tripped a breaker, nothing read an authored status, and a
> webhook nested in a connector was never registered, so it was never
> delivered. Put probes and circuit breaking in the connector provider or an
> upstream gateway. Whether a registered connector can be dispatched is the
> computed `state` (`ready` / `degraded`) that `GET /api/v1/automation/connectors`
> reports, and a webhook that is actually delivered is declared in the stack's
> top-level `webhooks:` collection (`src/automation/webhook.zod.ts`). Already
> authored one of them? `os migrate meta --from 17` lists the mechanical edits.
>
> `connectionTimeoutMs` was the second and is **removed** (ADR-0049, the
> narrower second decision it was owed). It was carried to a provider factory
> and echoed back onto the reported def, but never applied as a deadline
> anywhere, and it is not implementable where it was declared: a WHATWG `fetch`
> exposes one `AbortSignal` over the whole operation and never the connection
> phase alone. Use `requestTimeoutMs`, the bound the platform can keep, and put
> a connect-only bound in a provider or gateway on a transport that can separate
> the phases.

### Data sync is defined on the target

> **The connector carries no sync.** `connector.syncConfig` (strategy, direction,
> `conflictResolution`, batching, delete mode, filters) and `connector.fieldMappings`
> were removed in `@objectstack/spec` 17 (ADR-0049): no engine ever ran a
> connector-attached sync or moved a value through a connector field mapping, and
> the `latest_wins` / `soft_delete` defaults resolved and deleted nothing. The
> capability is mainstream, so it moved rather than lapsed — to the TARGET, where
> mainstream platforms bind it: a `mapping` (`data/mapping.zod.ts`)
> already names the object it writes, its field map (with an executed
> `fieldMapping[].transform`), its `mode` and its `upsertKey`, and its
> `connectorSource` adds where the rows come from — a `rest` / `openapi` connector
> instance, the read action and an optional timestamp `watermark`. A `job` sets the
> cadence; no schedule key returns to the connector. Version 1 is a one-way pull,
> full or incremental.
>
> **How a pull runs.** `@objectstack/service-automation`'s connector sync executor
> (`pullConnectorSource`) reads the mapping, resolves `connectorSource.connector` to a
> declared (`connectors[]`) `rest` / `openapi` instance, makes **one** call to the read
> action, takes the array at `recordsPath`, projects it through `fieldMapping` and writes
> it with the import door's runner — same coercion, same `mode` / `upsertKey` matching,
> same per-row verdicts. Every binding failure (a plugin-registered connector, an
> `ok: false` answer, a non-array at `recordsPath`, an `update` / `upsert` with no
> `upsertKey`, an unmapped `watermark.field`) is refused before anything is written.
>
> - **Watermark — read from the target.** Nothing stores it: the starting point sent as
>   `query[watermark.param]` is the highest value already stored in the target field a
>   `fieldMapping` entry copies `watermark.field` onto (transform `none`). Map that
>   field, or the pull is refused.
> - ⚠️ **One response per pull.** The connector's paging is not followed — no paging
>   convention is declared. A paged endpoint yields its first page only, and an
>   incremental pull over a newest-first paged endpoint moves its starting point past
>   the pages it never read. Point `connectorSource` at an endpoint that answers the
>   whole (incremental) set in one response.
> - ⚠️ **Nothing schedules a pull yet.** A `job` drives it, and that stage has not
>   landed, so the binding alone moves no rows — `connectorSource`'s own description
>   says so. It is not a lint warning: every key of the binding is `live`.
> Already authored the retired keys? `os migrate meta --from 17` lists the mechanical edits.

### Use Cases

1. **Enterprise SAP Integration** - Calling the ERP's actions from flows
2. **Financial System Integration** - PCI-compliant payment processor connector
3. **Identity Provider Integration** - SAML/OIDC integration with Okta/Auth0

### Example

> **The bare `Connector` is the AUTHOR shape.** It is `z.input` of
> `ConnectorSchema`, so every key carrying a `.default()` — `enabled`,
> `requestTimeoutMs`, `authentication` — is optional when you write a
> connector. Annotate the **result** of
> `ConnectorSchema.parse(…)` with **`ConnectorParsed`**, which is `z.infer`:
> there those keys are all present. The same convention held on L2's
> `ETLPipeline` / `ETLPipelineParsed` before that layer was retired (#6414), and
> **[ADR-0122](../../../docs/adr/0122-schema-type-alias-naming-convention.md)
> is why**: the bare name is the author state and `XParsed` is the parsed state,
> repo-wide. Earlier revisions of this note called L2's spelling "the house
> convention" and said connector had not caught up; #5551 measured the corpus and
> that was backwards — connector's spelling was the 1384-alias majority and L2's
> the 8-file minority, with neither recorded anywhere. ADR-0122 is that record.
> Its phase 1 (#5551, additive) gave every schema with two distinct shapes its
> `XParsed` name; phase 2 (#6083, protocol 17) flipped the bare names and retired
> the `XInput` synonyms the flip created — `ConnectorInput` among them, so write
> `Connector` where you used to write `ConnectorInput`, and `ConnectorParsed`
> where you used to write `Connector`. The example below states the defaulted
> keys anyway, because it is a tour of the surface; the Migration Guide's
> sketches omit them, because that is what ordinary authoring looks like.
> To have the literal validated as you write it, prefer `defineConnector(…)`,
> which takes this same input shape and returns the parsed one.

```typescript
import type { Connector } from '@objectstack/spec/integration';

const sapConnector: Connector = {
  name: 'sap_erp_connector',
  label: 'SAP ERP Integration',
  type: 'saas',
  description: 'Enterprise-grade SAP ERP integration',

  // OAuth2 Authentication
  authentication: {
    type: 'oauth2',
    authorizationUrl: 'https://sap.example.com/oauth/authorize',
    tokenUrl: 'https://sap.example.com/oauth/token',
    clientId: process.env.SAP_CLIENT_ID!,
    clientSecret: process.env.SAP_CLIENT_SECRET!,
    scopes: ['read:orders', 'write:orders']
  },

  // (`syncConfig` and `fieldMappings` sat here until ADR-0049 retired them —
  // no engine ever ran a connector-attached sync. A sync is defined on its
  // target: a `mapping` whose `connectorSource` names this connector.)

  // (`webhooks` sat here until ADR-0049 retired it — a webhook nested in a
  // connector was never registered, so it was never delivered. Declare
  // webhooks in the stack's top-level `webhooks:` collection, which is.)

  // (`rateLimitConfig` sat here until #4911 retired it — no outbound
  // rate-limiting engine ever existed. Throttle at the provider/gateway.)

  // Retry Configuration — EXECUTED (ADR-0049 ruled `实现`). The platform
  // applies this at its one outbound call, `shared/resilientFetch`, through
  // `src/integration/connector-fetch-policy.ts`. `maxAttempts` counts TOTAL
  // calls with the first included, so the 5 below is five calls, not six.
  retryConfig: {
    strategy: 'exponential_backoff',
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryOnNetworkError: true,
    jitter: true
  },

  // `requestTimeoutMs` is each attempt's deadline and is enforced.
  // ⛔ `connectionTimeoutMs` was here and is REMOVED (ADR-0049): a WHATWG
  // `fetch` exposes one `AbortSignal` over the whole operation and never the
  // connection phase alone, so the platform had nowhere to apply it and never
  // did. Authoring it is now a tsc error and a parse error carrying the
  // prescription; bound the connect phase at a provider or gateway.
  requestTimeoutMs: 60000,
  // (`status: 'active'` sat here until ADR-0049 retired the key — nothing read
  // it. `enabled` is what takes a declarative instance in or out of service.)
  enabled: true
};
```

### Authentication Methods

| Method | Type | Use Case |
|--------|------|----------|
| `oauth2` | OAuth 2.0 | Modern SaaS applications (Salesforce, Google) |
| `jwt` | JSON Web Token | Microservices, API gateways |
| `saml` | SAML 2.0 | Enterprise SSO (Okta, Azure AD) |
| `api-key` | API Key | Simple API authentication |
| `basic` | Basic Auth | Legacy systems, simple authentication |
| `bearer` | Bearer Token | Token-based APIs |
| `none` | No Auth | Public APIs |

### Best Practices

- **Security First**: Always use encrypted credentials and secure storage
- **Rate Limiting**: Respect the upstream API's limits — and enforce that at the
  connector provider or upstream gateway, since the connector shape declares no
  outbound throttle (#4911). `retryConfig` does now retry the `429` you get for
  exceeding a limit (and honours a `Retry-After` the upstream sends), but ⛔ a
  retry is not a throttle: it spaces out calls you already made rather than
  capping the rate. The throttling stays the provider's to implement
- **Error Handling**: Implement comprehensive retry logic with exponential backoff
- **Monitoring**: Set up health checks and alerting for connector failures at the
  connector provider or upstream gateway — the connector shape declares no probe
  and no breaker
- **Testing**: Exercise the connector's actions and its static `auth` against the real
  upstream (or a fixture server) before a `mapping` pulls through it — a pull refuses an
  `ok: false` answer rather than writing nothing silently
- **Field mappings live on the target**: a sync's field map is the `mapping`'s
  `fieldMapping`, not the connector's — document it there, beside the `upsertKey`
  that matches a pulled record to a stored one

---

## Choosing the Right Level

### Decision Matrix

With L1 and L2 both retired there is only one level left to choose, so this matrix now
mostly answers "which surface", and — for the two questions that used to route to L2 —
"none, and here is why".

| Question | Answer → Surface |
|----------|------------------|
| Do you need to convert a value per field on import? | **Yes** → the import mapping's `fieldMapping[].transform` (`data/mapping.zod.ts`), applied row by row by the REST import path. **Not** L3: the connector's `fieldMappings` never transformed anything and is retired (ADR-0049) |
| Do you need joins, aggregations or custom-SQL stages? | **No surface provides this.** It was L2's headline claim and L2 had no executor (#6414). Do it in the destination system, or in a `flow` / job you write. Do not author a shape hoping it runs |
| Do you need multi-source aggregation? | **Same answer**, and for the same reason — see [Retired: L2 ETL Pipeline](#retired-l2-etl-pipeline-v17) |
| Do you need real-time webhooks? | **Outbound:** the stack's top-level `webhooks:` collection (`src/automation/webhook.zod.ts`) — **not** L3: a connector's nested `webhooks` was never delivered and is retired (ADR-0049) |
| Do you need advanced authentication (OAuth2, SAML)? | **Yes** → L3 (Connector) |
| Do you need retry policies and circuit breaking? | **Retry: yes, L3.** `retryConfig` is executed at the platform's one outbound call (ADR-0049 ruled `实现`) — backoff shape, attempt count, retryable statuses, network-error retry and a per-attempt `requestTimeoutMs`. **Circuit breaking: no level provides it** — `health.circuitBreaker` was retired (ADR-0049) because no breaker ever opened; implement it in the connector provider or an upstream gateway. Outbound **rate limiting** is not a reason to pick any level either: no level provides it (#4911); throttle at the provider or gateway |
| Is it a simple pull from an external system into a local object? | The target-side binding: a `mapping` with `connectorSource` over a `rest` / `openapi` connector, cadence from a `job` — **pulled when a job drives it; the job stage has not landed** ([above](#data-sync-is-defined-on-the-target)) |
| Are you building a data warehouse pipeline? | The extraction half is that same pull binding; the warehouse-side transformation is the warehouse's own tooling. There is no ObjectStack pipeline protocol (#6414) |
| Are you integrating with an enterprise system? | **Yes** → L3 (Connector) |
| Do you need client-side offline sync? | Not this layering — and note `ui/offline.zod.ts` was itself retired at #4988 for having no carrier key |

### Common Patterns

#### Pattern 1: Enterprise Integration (L3)
```
ObjectStack ↔ Enterprise Connector ↔ SAP
                    ↓
               Auth, Retry
```
Use **L3 Enterprise Connector** for production-grade integrations — a connector
instance with simple `auth` whose actions flows call.

#### Pattern 2: Ingest, then transform where it runs
```
External API → L3 Connector → ObjectStack → (warehouse's own ELT)
```
The second arrow used to read `ObjectStack → L2 ETL → Data Warehouse`, and that hop
never executed. Land the data through a connector (the target-side pull binding, once
a job drives it), then transform it with a tool that actually runs — the
warehouse's own ELT, a `flow`, or a scheduled job.

---

## Migration Guide

### From L2 (`ETLPipeline`) to what exists

L2 was retired at #6414. Nothing was ever deployed under it — that is the finding, not
a consolation — so this is a source edit, not a data migration.

**Before** — the retired L2 shape. Shown as plain text, not a `typescript` fence, on
purpose: `ETLPipeline` no longer exists, so this snippet does not compile and must not
be picked up by the documentation compile gate as if it should.

```
import type { ETLPipeline } from '@objectstack/spec/automation';

const pipeline: ETLPipeline = {
  name: 'order_analytics_pipeline',
  source: { type: 'api', connector: 'orders', config: { endpoint: '/orders' } },
  transformations: [
    { type: 'aggregate', config: { groupBy: ['customer_id'] } }
  ],
  destination: { type: 'database', config: { table: 'analytics_order' } }
};
```

**After** — split it by which half has a runtime. The extraction half is the
target-side pull binding (pulled when a job drives it; the job stage has not landed):

```typescript
import type { Connector } from '@objectstack/spec/integration';
import type { Mapping } from '@objectstack/spec/data';

const orders: Connector = {
  name: 'orders',
  label: 'Orders API',
  type: 'api',
  provider: 'rest',
  providerConfig: { baseUrl: 'https://orders.example.com' },
};

const ordersPull: Mapping = {
  name: 'orders_pull',
  targetObject: 'order',
  fieldMapping: [{ source: 'id', target: 'external_id' }, { source: 'total', target: 'amount' }],
  mode: 'upsert',
  upsertKey: ['external_id'],
  connectorSource: {
    connector: 'orders',
    action: 'request',
    input: { method: 'GET', path: '/orders' },
    recordsPath: 'body.items',
    watermark: { field: 'updated_at', param: 'updated_since' },
  },
};
```

The `transformations` half has no runtime, and never did. Aggregations, joins and
custom-SQL stages belong to whatever actually computes: the destination warehouse's
ELT, a `flow`, or a scheduled job you write.

Per-field value conversion on import — a cast, a constant, a lookup — is the import
mapping's `fieldMapping[].transform` (`data/mapping.zod.ts`), which is executed.

### From L3 `syncConfig` / `fieldMappings`

Both keys are retired (ADR-0049) and nothing was ever executed under them, so this
is a source edit, not a data migration: move each sync you still want onto its
target as the `mapping` above, carrying `fieldMappings`' `source` → `target` pairs
into `fieldMapping` (a `defaultValue` becomes a `constant` transform). `direction`,
`conflictResolution` and `deleteMode` have no counterpart — version 1 is a one-way
pull that writes through `mode` / `upsertKey`. There is still no pipeline layer to
move up to (ADR-0049: enforce, then declare).

---

## API Reference

### Level 3: Enterprise Connector
- [Connector Schema](../src/integration/connector.zod.ts)
- [Authentication](../src/auth/config.zod.ts)
- [Webhooks](../src/automation/webhook.zod.ts)

---

## Related Documentation

- [Webhook Protocol](./WEBHOOK_PROTOCOL.md)
- [Authentication Guide](./AUTHENTICATION.md)
- [Best Practices](./BEST_PRACTICES.md)
