# Data Synchronization Architecture

ObjectStack implements a **2-layer architecture** for data synchronization and integration, designed to serve different audiences and use cases.

> **History note (v17):** this document used to describe a 3-layer architecture whose
> first layer — **"L1: Simple Sync"** (`DataSyncConfig` in `automation/sync.zod.ts`) —
> was retired in #4738. See [Retired: L1 Simple Sync](#retired-l1-simple-sync-v17)
> for what happened and what to use instead. The historical L2/L3 numbering is kept
> in the level headings so older references stay legible.

## Overview

| Level | Protocol | File | Audience | Use Case | Complexity |
|-------|----------|------|----------|----------|------------|
| **L2: ETL Pipeline** | `ETLPipeline` | `automation/etl.zod.ts` | Data engineers | Aggregate 10 sources to data warehouse | ⭐⭐ Moderate |
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
- **Transformation pipelines** — `ETLPipeline` (`automation/etl.zod.ts`) for
  multi-source, multi-stage data movement.
- **Client offline sync** — ~~`SyncConfigSchema` / `ConflictResolution`
  (`ui/offline.zod.ts`)~~ **also retired, at #4988** (ADR-0049). That vocabulary
  had no carrier key either: no schema in the protocol declared an `offline:`
  slot, so nothing ever parsed it. Offline sync is a platform capability, and
  when it is built its vocabulary arrives on the sync engine that owns the
  queue, the conflict policy and the cache — not as a standalone `ui/` config
  shape. The bare `ConflictResolution` name is consequently published by no def
  at all; `ConnectorConflictResolution` above is the connector-sync one.

---

## Level 2: ETL Pipeline

**File:** `packages/spec/src/automation/etl.zod.ts`
**Audience:** Data engineers, analytics teams
**Complexity:** ⭐⭐ Moderate

### Purpose

Advanced data pipelines for complex transformations, multi-source aggregation, and data warehouse population.

### Key Features

- ✅ Multi-source, multi-stage pipelines
- ✅ Complex transformations (join, aggregate, filter, custom SQL)
- ✅ Data normalization and deduplication
- ✅ Split/merge operations
- ✅ Incremental extraction with change data capture (CDC)
- ✅ Data quality validation

### Use Cases

1. **Data Warehouse Population** - Aggregate data from 10+ sources into Snowflake
2. **Business Intelligence** - Transform operational data for analytics
3. **Data Migration** - Move data from legacy systems to modern platforms
4. **Master Data Management** - Consolidate customer data from multiple systems

### Example

```typescript
import { ETLPipeline } from '@objectstack/spec/automation';

const dataWarehousePipeline: ETLPipeline = {
  name: 'customer_360_pipeline',
  label: 'Customer 360 Data Warehouse Pipeline',

  // Extract from Salesforce
  source: {
    type: 'api',
    connector: 'salesforce',
    config: {
      object: 'Account'
    },
    incremental: {
      enabled: true,
      cursorField: 'LastModifiedDate'
    }
  },

  // Transform: Join with support tickets, aggregate metrics
  transformations: [
    {
      type: 'join',
      config: {
        source: 'zendesk',
        joinKey: 'email',
        joinType: 'left'
      }
    },
    {
      type: 'aggregate',
      config: {
        groupBy: ['customer_id'],
        metrics: {
          total_tickets: 'COUNT(ticket_id)',
          avg_satisfaction: 'AVG(satisfaction_score)'
        }
      }
    },
    {
      type: 'filter',
      config: {
        condition: 'annual_revenue > 100000'
      }
    }
  ],

  // Load to Snowflake
  destination: {
    type: 'warehouse',
    connector: 'snowflake',
    config: {
      database: 'analytics',
      schema: 'customer_360',
      table: 'customers'
    },
    writeMode: 'upsert',
    primaryKey: ['customer_id']
  },

  syncMode: 'incremental',
  schedule: '0 2 * * *', // Daily at 2 AM
  enabled: true
};
```

### Transformation Types

| Type | Description | Example |
|------|-------------|---------|
| `map` | Field mapping/renaming | `{ 'old_name': 'new_name' }` |
| `filter` | Row filtering | `status == "active"` |
| `aggregate` | Aggregation/grouping | `SUM(revenue) BY customer_id` |
| `join` | Join with other data | `LEFT JOIN orders ON customer_id` |
| `script` | Custom JavaScript/Python | `return row.price * 1.1` |
| `lookup` | Enrich with reference data | Lookup country from zip code |
| `split` | Split one record into many | Split line items from order |
| `merge` | Merge multiple records | Deduplicate customers |
| `normalize` | Data normalization | Phone number formatting |
| `deduplicate` | Remove duplicates | Based on email |

### Best Practices

- Use **incremental sync** with cursor fields for large datasets
- Add **data quality checks** in transformation pipeline
- Monitor **pipeline performance** and optimize slow transformations
- Use **staging tables** for complex multi-stage pipelines
- Configure **alerting** for pipeline failures

---

## Level 3: Enterprise Connector

**File:** `packages/spec/src/integration/connector.zod.ts`
**Audience:** System integrators, enterprise architects
**Complexity:** ⭐⭐⭐ Advanced

### Purpose

Complete, production-grade integration with external systems. Includes authentication, security, webhooks, rate limiting, and full lifecycle management.

### Key Features

- ✅ **Authentication**: OAuth2, JWT, SAML, API Key, Basic Auth
- ✅ **Webhooks**: Bidirectional event notifications
- ✅ **Rate Limiting**: Token bucket, leaky bucket algorithms
- ✅ **Retry Policies**: Exponential backoff, circuit breaker
- ✅ **Field Mapping**: With transformations and data type conversion
- ✅ **Conflict Resolution**: Multiple strategies (`ConnectorConflictResolution`)
- ✅ **Security**: Signature verification, encryption
- ✅ **Monitoring**: Health checks, metrics, logging

### Use Cases

1. **Enterprise SAP Integration** - Full bidirectional sync with complex business logic
2. **Financial System Integration** - PCI-compliant payment processor connector
3. **Identity Provider Sync** - SAML/OIDC integration with Okta/Auth0
4. **IoT Platform Integration** - Real-time data streaming from sensors

### Example

```typescript
import { Connector } from '@objectstack/spec/integration';

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

  // Field Mappings with Transformations
  fieldMappings: [
    {
      sourceField: 'customer_number',
      targetField: 'customer_id',
      dataType: 'string',
      required: true,
      syncMode: 'bidirectional'
    },
    {
      sourceField: 'order_value',
      targetField: 'order_total',
      dataType: 'number',
      transform: {
        type: 'custom',
        function: 'value => parseFloat(value) / 100' // Convert cents to dollars
      },
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
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        initialDelayMs: 1000
      },
      timeoutMs: 30000,
      isActive: true
    }
  ],

  // (`rateLimitConfig` sat here until #4911 retired it — no outbound
  // rate-limiting engine ever existed. Throttle at the provider/gateway.)

  // Retry Configuration
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
- **Rate Limiting**: Respect external API rate limits to avoid throttling
- **Error Handling**: Implement comprehensive retry logic with exponential backoff
- **Monitoring**: Set up health checks and alerting for connector failures
- **Testing**: Test authentication, sync, and webhook flows thoroughly
- **Documentation**: Document field mappings and business logic

---

## Choosing the Right Level

### Decision Matrix

| Question | Answer → Level |
|----------|----------------|
| Do you need complex transformations (joins, aggregations)? | **Yes** → L2 (ETL) |
| Do you need multi-source aggregation? | **Yes** → L2 (ETL) |
| Do you need real-time webhooks? | **Yes** → L3 (Connector) |
| Do you need advanced authentication (OAuth2, SAML)? | **Yes** → L3 (Connector) |
| Do you need rate limiting and retry policies? | **Yes** → L3 (Connector) |
| Is it a simple point-to-point sync with an external system? | **Yes** → L3 (Connector) with `syncConfig` |
| Are you building a data warehouse pipeline? | **Yes** → L2 (ETL) |
| Are you integrating with an enterprise system? | **Yes** → L3 (Connector) |
| Do you need client-side offline sync? | **Yes** → `ui/offline.zod.ts` (a separate protocol, not this layering) |

### Common Patterns

#### Pattern 1: Analytics Pipeline (L2)
```
Salesforce → ETL → Transform → Snowflake
HubSpot    ↗           ↘ Analytics Dashboard
Stripe     ↗
```
Use **L2 ETL Pipeline** for multi-source data warehousing.

#### Pattern 2: Enterprise Integration (L3)
```
ObjectStack ↔ Enterprise Connector ↔ SAP
                    ↓
               Webhooks, Auth, Rate Limiting
```
Use **L3 Enterprise Connector** for production-grade integrations — including
straightforward point-to-point sync, via a connector instance with simple `auth`
and a `syncConfig`.

#### Pattern 3: Hybrid Approach
```
External API → L3 Connector → ObjectStack
ObjectStack → L2 ETL → Data Warehouse
```
Combine levels for complex scenarios.

---

## Migration Guide

### From L3 (`syncConfig`) to L2

When a connector's declarative sync needs complex transformations:

**Before (L3 `syncConfig`):**
```typescript
const connector: Connector = {
  name: 'orders',
  type: 'saas',
  authentication: { type: 'api-key', ... },
  syncConfig: { strategy: 'incremental', direction: 'import' }
};
```

**After (L2):**
```typescript
const pipeline: ETLPipeline = {
  name: 'order_analytics_pipeline',
  source: { type: 'api', connector: 'orders' },
  transformations: [
    { type: 'aggregate', config: { groupBy: ['customer_id'] } }
  ],
  destination: { type: 'database', config: { table: 'analytics_order' } }
};
```

### From L2 to L3

When your ETL pipeline needs webhooks, advanced auth, or rate limiting:

**Before (L2):**
```typescript
const pipeline: ETLPipeline = {
  source: { type: 'api', connector: 'external_api' }
};
```

**After (L3):**
```typescript
const connector: Connector = {
  authentication: { type: 'oauth2', ... },
  webhooks: [...],
  retryConfig: { ... }
};
```

---

## API Reference

### Level 2: ETL Pipeline
- [ETLPipeline Schema](../src/automation/etl.zod.ts)
- [ETL Transformations](../src/automation/etl.zod.ts#L151)
- [ETL Run Result](../src/automation/etl.zod.ts#L316)

### Level 3: Enterprise Connector
- [Connector Schema](../src/integration/connector.zod.ts)
- [Authentication](../src/auth/config.zod.ts)
- [Webhooks](../src/automation/webhook.zod.ts)

---

## Related Documentation

- [Webhook Protocol](./WEBHOOK_PROTOCOL.md)
- [Authentication Guide](./AUTHENTICATION.md)
- [Best Practices](./BEST_PRACTICES.md)
