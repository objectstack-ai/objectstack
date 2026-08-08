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

- **Connector-attached sync** — `ConnectorSchema.syncConfig`
  (`integration/connector.zod.ts`): the live, parsed sync-strategy surface
  (strategy, direction, schedule, `conflictResolution`, batching, delete mode).
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
  at all; `ConnectorConflictResolution` above is the connector-sync one.

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

- **Scheduled, connector-attached synchronisation** — `ConnectorSchema.syncConfig`
  (`integration/connector.zod.ts`), the live, parsed surface described under L3 below:
  strategy, direction, cron schedule, `conflictResolution`, batching, delete mode.
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

Complete, production-grade integration with external systems. Includes authentication, security, webhooks, retry policies, and full lifecycle management.

### Key Features

- ✅ **Authentication**: OAuth2, JWT, SAML, API Key, Basic Auth
- ✅ **Webhooks**: Bidirectional event notifications
- ✅ **Retry Policies**: Exponential backoff, circuit breaker
- ✅ **Field Mapping**: `dataType` target type and `syncMode` per-field direction —
  **no value transformation**; see below
- ✅ **Conflict Resolution**: Multiple strategies (`ConnectorConflictResolution`)
- ✅ **Security**: Signature verification, encryption
- ✅ **Monitoring**: Health checks, metrics, logging
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
> connector provider or upstream gateway.** What L3 does declare for a
> rate-limited upstream is `retryConfig` — whose `retryableStatusCodes` default
> `[408, 429, 500, 502, 503, 504]` includes `429` — and `health.circuitBreaker`.

> **Field mapping does not transform values.** The ticked line above used to read
> "With transformations and data type conversion". Only the second half was ever
> true: `ConnectorFieldMappingSchema` (`integration/connector.zod.ts`) extends the
> base mapping with exactly three keys — `dataType`, `required` and `syncMode`.
> `FieldMapping.transform` — authored as `connector.fieldMappings[].transform` and
> `externalLookup.fieldMappings[].transform` — was removed in `@objectstack/spec`
> 17.0.0 (#5552, ADR-0049), and the whole `FieldMappingTransform` union went with
> it (`constant` / `cast` / `lookup` / `javascript` / `map`) — **no runtime ever
> executed any of the five**, and the `javascript` member advertised
> `dialect: "js"`, a dialect retired in #3278. An L3 connector mapping moves a
> value from `source` to `target`; it does not compute one. **Value conversion
> belongs on a surface that runs it:** the import mapping's own `transform`
> (`mapping.fieldMapping[].transform` in `data/mapping.zod.ts` — a string enum,
> `none`/`constant`/`map`/`split`/`join`/`lookup`, with its settings in `params`),
> applied row by row by the REST import path, which rejects its own `javascript`
> value with a 400 rather than pretending to run it. That is now the ONLY such
> surface: this note used to offer "or an ETL transformation step (L2 above)" as a
> second option, and L2 was retired at #6414 for having no executor — the second
> option was the same defect this note is about, one layer up. Already authored the
> retired key? `os migrate meta --from 16` rewrites it.

### Use Cases

1. **Enterprise SAP Integration** - Full bidirectional sync with complex business logic
2. **Financial System Integration** - PCI-compliant payment processor connector
3. **Identity Provider Sync** - SAML/OIDC integration with Okta/Auth0
4. **IoT Platform Integration** - Real-time data streaming from sensors

### Example

> **The bare `Connector` is the AUTHOR shape.** It is `z.input` of
> `ConnectorSchema`, so every key carrying a `.default()` — `enabled`,
> `status`, `connectionTimeoutMs`, `requestTimeoutMs`, all of `syncConfig`'s
> `strategy` / `direction` / `realtimeSync` / `conflictResolution` /
> `batchSize` / `deleteMode`, a mapping's `required` / `syncMode`, a webhook's
> `method` / `timeoutMs` / `isActive` / `signatureAlgorithm` — is optional when
> you write a connector, and `syncConfig.schedule` takes the bare cron string
> the schema wraps for you. Annotate the **result** of
> `ConnectorSchema.parse(…)` with **`ConnectorParsed`**, which is `z.infer`:
> there those keys are all present and `schedule` is already the
> `{ dialect: 'cron', source }` envelope. The same convention held on L2's
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

  // Data Sync Configuration
  syncConfig: {
    strategy: 'incremental',
    direction: 'bidirectional',
    schedule: '*/15 * * * *', // Every 15 minutes
    realtimeSync: true,
    timestampField: 'updated_at',
    conflictResolution: 'latest_wins',
    batchSize: 1000,
    deleteMode: 'soft_delete'
  },

  // Field Mappings — `dataType` target type and `syncMode` direction. There is
  // no value transformation here; see the tombstone on the second entry.
  // The keys are `source` / `target` — the canonical spelling of the base
  // protocol in `shared/mapping.zod.ts`, which every mapping surface extends.
  fieldMappings: [
    {
      source: 'customer_number',
      target: 'customer_id',
      dataType: 'string',
      required: true,
      syncMode: 'bidirectional'
    },
    {
      source: 'order_value',
      target: 'order_total',
      dataType: 'number',
      // (`transform` sat here until #5552 retired it, together with the whole
      // five-member `FieldMappingTransform` union — `constant` / `cast` /
      // `lookup` / `javascript` / `map`. None of the five ever had an executor:
      // an L3 connector mapping moves a value from `source` to `target`, and
      // nothing anywhere read the transform. The `javascript` member is what
      // made the gap visible — it recommended the retired `js` dialect
      // (#3278), so the only spelling that parsed was a bare string, which
      // means CEL. Value conversion belongs on a surface that runs it: the
      // import mapping's own `transform` (`data/mapping.zod.ts`). The "or an ETL
      // transformation step" this used to add is gone — L2 was retired at #6414
      // for having no executor, which is the very defect this comment is about.)
      syncMode: 'bidirectional'
    }
  ],

  // Webhooks for Real-time Events
  webhooks: [
    {
      name: 'order_created_webhook',
      url: 'https://api.objectstack.com/webhooks/sap/orders',
      events: ['record.created', 'record.updated'],
      secret: process.env.WEBHOOK_SECRET!,
      signatureAlgorithm: 'hmac_sha256',
      // (`retryPolicy` sat here until #3494 retired it — webhook delivery
      // retries are owned by the messaging outbox on a fixed schedule, and the
      // authored policy was never read. There is no replacement, and it is a
      // different thing from `retryConfig` below, which governs the calls this
      // connector MAKES.)
      timeoutMs: 30000,
      isActive: true
    }
  ],

  // (`rateLimitConfig` sat here until #4911 retired it — no outbound
  // rate-limiting engine ever existed. Throttle at the provider/gateway.)

  // Retry Configuration — for the connector's own outbound requests
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

  connectionTimeoutMs: 30000,
  requestTimeoutMs: 60000,
  status: 'active',
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
  outbound throttle (#4911). `retryConfig` handles the `429` you get for exceeding a
  limit; it does not keep you under one
- **Error Handling**: Implement comprehensive retry logic with exponential backoff
- **Monitoring**: Set up health checks and alerting for connector failures
- **Testing**: Test authentication, sync, and webhook flows thoroughly
- **Documentation**: Document field mappings and business logic

---

## Choosing the Right Level

### Decision Matrix

With L1 and L2 both retired there is only one level left to choose, so this matrix now
mostly answers "which surface", and — for the two questions that used to route to L2 —
"none, and here is why".

| Question | Answer → Surface |
|----------|------------------|
| Do you need to convert a value per field on import? | **Yes** → the import mapping's `fieldMapping[].transform` (`data/mapping.zod.ts`), applied row by row by the REST import path. **Not** L3: a connector's `fieldMappings` declares `dataType` and `syncMode` and performs no value transformation (#5552) |
| Do you need joins, aggregations or custom-SQL stages? | **No surface provides this.** It was L2's headline claim and L2 had no executor (#6414). Do it in the destination system, or in a `flow` / job you write. Do not author a shape hoping it runs |
| Do you need multi-source aggregation? | **Same answer**, and for the same reason — see [Retired: L2 ETL Pipeline](#retired-l2-etl-pipeline-v17) |
| Do you need real-time webhooks? | **Yes** → L3 (Connector) |
| Do you need advanced authentication (OAuth2, SAML)? | **Yes** → L3 (Connector) |
| Do you need retry policies and circuit breaking? | **Yes** → L3 (Connector) — `retryConfig`, `health.circuitBreaker`. Outbound **rate limiting** is not a reason to pick any level: no level provides it (#4911); throttle at the provider or gateway |
| Is it a simple point-to-point sync with an external system? | **Yes** → L3 (Connector) with `syncConfig` |
| Are you building a data warehouse pipeline? | The extraction half is L3 (`syncConfig`); the warehouse-side transformation is the warehouse's own tooling. There is no ObjectStack pipeline protocol (#6414) |
| Are you integrating with an enterprise system? | **Yes** → L3 (Connector) |
| Do you need client-side offline sync? | Not this layering — and note `ui/offline.zod.ts` was itself retired at #4988 for having no carrier key |

### Common Patterns

#### Pattern 1: Enterprise Integration (L3)
```
ObjectStack ↔ Enterprise Connector ↔ SAP
                    ↓
               Webhooks, Auth, Retry / Circuit Breaker
```
Use **L3 Enterprise Connector** for production-grade integrations — including
straightforward point-to-point sync, via a connector instance with simple `auth`
and a `syncConfig`.

#### Pattern 2: Ingest, then transform where it runs
```
External API → L3 Connector → ObjectStack → (warehouse's own ELT)
```
The second arrow used to read `ObjectStack → L2 ETL → Data Warehouse`, and that hop
never executed. Land the data with a connector, then transform it with a tool that
actually runs — the warehouse's own ELT, a `flow`, or a scheduled job.

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

**After** — split it by which half had a runtime. The extraction half does:

```typescript
import type { Connector } from '@objectstack/spec/integration';

const orders: Connector = {
  name: 'orders',
  label: 'Orders API',
  type: 'saas',
  syncConfig: { strategy: 'incremental', direction: 'import' }
};
```

The `transformations` half has no runtime, and never did. Aggregations, joins and
custom-SQL stages belong to whatever actually computes: the destination warehouse's
ELT, a `flow`, or a scheduled job you write.

Per-field value conversion on import — a cast, a constant, a lookup — is the import
mapping's `fieldMapping[].transform` (`data/mapping.zod.ts`), which is executed.

### From L3 (`syncConfig`) to a pipeline

There is no pipeline layer to move up to. This section used to describe exactly that
move — "when a connector's declarative sync needs to transform values … **After (L2)**"
— and the destination did not run. If `syncConfig` plus `fieldMapping[].transform` does
not cover the case, the work belongs outside the sync protocol until an engine exists
to receive it (ADR-0049: enforce, then declare).

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
