# Design Document: driver-turso — Turso/libSQL Driver for ObjectStack

> **Author:** ObjectStack Core Team  
> **Created:** 2026-02-15  
> **Status:** Proposal  
> **Target Version:** v3.1 (Q2 2026)

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Background & Motivation](#2-background--motivation)
- [3. Architecture Impact Analysis](#3-architecture-impact-analysis)
  - [3.1 Server-Side Impact](#31-server-side-impact)
  - [3.2 Client-Side Impact](#32-client-side-impact)
  - [3.3 Cloud / Edge Impact](#33-cloud--edge-impact)
- [4. Turso/libSQL Capabilities Mapping](#4-tursolibsql-capabilities-mapping)
  - [4.1 IDataDriver Interface Mapping](#41-idatadriver-interface-mapping)
  - [4.2 ISchemaDriver Interface Mapping](#42-ischemadriver-interface-mapping)
  - [4.3 Capability Matrix Comparison](#43-capability-matrix-comparison)
- [5. Connection Modes](#5-connection-modes)
- [6. Embedded Replica & Sync Protocol](#6-embedded-replica--sync-protocol)
- [7. Multi-Tenancy with Database-per-Tenant](#7-multi-tenancy-with-database-per-tenant)
- [8. Integration with Existing ObjectStack Services](#8-integration-with-existing-objectstack-services)
- [9. Package Structure](#9-package-structure)
- [10. Configuration Schema](#10-configuration-schema)
- [11. Migration & Deployment Strategy](#11-migration--deployment-strategy)
- [12. Implementation Phases](#12-implementation-phases)
- [13. Risks & Mitigations](#13-risks--mitigations)
- [14. Decision Log](#14-decision-log)

---

## 1. Executive Summary

This document evaluates the architectural impact of developing `@objectstack/driver-turso`, a data
driver backed by **Turso/libSQL** — a fork of SQLite designed for edge-first, globally distributed
deployments. The driver brings three transformative capabilities to ObjectStack:

1. **Edge Deployment** — Run ObjectStack data layer at the edge with microsecond read latency
2. **Embedded Replicas** — Local SQLite files that sync with a remote primary (offline-first)
3. **Database-per-Tenant** — Native multi-tenancy via lightweight per-tenant databases

Unlike PostgreSQL or MongoDB drivers (which require persistent server-side infrastructure), the
Turso driver is uniquely positioned for **serverless**, **edge**, and **local-first** use cases —
making ObjectStack viable for Cloudflare Workers, Vercel Edge Functions, mobile apps, and
offline-capable desktop applications.

---

## 2. Background & Motivation

### Why Turso/libSQL?

| Factor | PostgreSQL | MongoDB | Turso/libSQL |
|:---|:---|:---|:---|
| **Deployment** | Server-only | Server-only | Server, Edge, Embedded, Serverless |
| **Latency (reads)** | 1-10ms (network) | 1-10ms (network) | <1ms (embedded replica) |
| **Offline Support** | ❌ | ❌ | ✅ (embedded replicas) |
| **Multi-Tenancy** | Schema/Row isolation | Database per tenant | **Native DB-per-tenant** (10k+ DBs) |
| **Cold Start** | Connection pool init | Connection pool init | Near-zero (local file) |
| **Edge Runtime** | ❌ | ❌ | ✅ (WASM, Cloudflare Workers) |
| **Cost Model** | Per-instance | Per-instance | Per-query (serverless-friendly) |
| **SQLite Compatibility** | ❌ | ❌ | ✅ Full SQLite SQL |

### Strategic Alignment

- **ObjectStack's "Post-SaaS Operating System" vision** requires database virtualization across
  deployment targets (cloud, edge, device). Turso is the first driver that can run in ALL targets.
- **Local-first architecture** is a growing trend. Embedded replicas enable ObjectStack apps to
  work offline and sync when connectivity returns.
- **Serverless cost optimization** — Turso's pay-per-query model eliminates idle connection costs
  that plague PostgreSQL in serverless environments.

---

## 3. Architecture Impact Analysis

### 3.1 Server-Side Impact

#### Changes Required

| Component | Impact | Description |
|:---|:---:|:---|
| `@objectstack/spec` | 🟢 Minimal | Add `TursoConfigSchema` + `TursoDriverSpec` (already done) |
| `@objectstack/core` | 🟢 None | Kernel is driver-agnostic; no changes needed |
| `@objectstack/objectql` | 🟢 None | ObjectQL dispatches via `IDataDriver`; no changes needed |
| `@objectstack/runtime` | 🟢 None | `DriverPlugin` wraps any `IDataDriver`; works as-is |
| `@objectstack/rest` | 🟢 None | REST API is driver-agnostic |
| `@objectstack/metadata` | 🟢 None | Metadata service is storage-agnostic |
| `@objectstack/cli` | 🟡 Minor | Add `driver-turso` to `create-objectstack` templates |
| Framework Adapters | 🟢 None | The Hono adapter is driver-agnostic |

**Key Insight:** The microkernel architecture means adding a new driver has **zero impact** on
the server-side stack. The `IDataDriver` contract completely decouples the data layer.

#### Server-Side Usage Pattern

```typescript
import { defineStack } from '@objectstack/spec';
import { createTursoDriver } from '@objectstack/driver-turso';

export default defineStack({
  datasources: [{
    name: 'default',
    driver: 'turso',
    config: {
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    },
  }],
  objects: [/* ... */],
});
```

### 3.2 Client-Side Impact

#### Changes Required

| Component | Impact | Description |
|:---|:---:|:---|
| `@objectstack/client` | 🟢 None | Client SDK communicates via REST/GraphQL; driver-agnostic |
| `@objectstack/client-react` | 🟢 None | React hooks use client SDK; no changes |

**New Capability Unlocked:** With embedded replicas, a future `@objectstack/client-local` package
could provide direct libSQL access in the browser (via WASM), enabling:

- **Offline-first React/Vue/Svelte apps** with local ObjectQL queries
- **Optimistic UI updates** with background sync
- **Zero-latency reads** from local embedded replica

This does NOT require changes to existing client packages — it would be a new, optional package.

### 3.3 Cloud / Edge Impact

#### Changes Required

| Component | Impact | Description |
|:---|:---:|:---|
| `@objectstack/cloud` (spec) | 🟡 Minor | Add Turso as a supported datasource in marketplace metadata |
| Deployment Targets | 🟢 Expansion | Enables Cloudflare Workers, Deno Deploy, Vercel Edge |
| Studio IDE | 🟢 None | Object Designer is driver-agnostic |

#### New Deployment Topologies

```
┌──────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT TOPOLOGY A                      │
│                 "Traditional Server + Turso"                  │
│                                                              │
│  ┌─────────┐         ┌──────────────┐      ┌─────────────┐  │
│  │ Browser │ ──REST──▶│ Node.js/Hono │ ────▶│ Turso Cloud │  │
│  │  (SPA)  │         │  ObjectStack │      │  (Primary)  │  │
│  └─────────┘         └──────────────┘      └─────────────┘  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT TOPOLOGY B                      │
│              "Edge + Embedded Replica"                        │
│                                                              │
│  ┌─────────┐    ┌──────────────────┐    ┌─────────────┐     │
│  │ Browser │───▶│ Cloudflare Worker │───▶│ Turso Cloud │     │
│  │         │    │ ObjectStack +     │    │  (Primary)  │     │
│  │         │    │ Embedded Replica  │    │             │     │
│  └─────────┘    │ (local reads)    │    │  (writes)   │     │
│                 └──────────────────┘    └─────────────┘     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT TOPOLOGY C                      │
│                "Local-First / Offline"                        │
│                                                              │
│  ┌──────────────────────┐          ┌─────────────┐          │
│  │    Desktop / Mobile   │   sync   │ Turso Cloud │          │
│  │  ┌─────────────────┐ │ ◀──────▶ │  (Primary)  │          │
│  │  │  ObjectStack    │ │          └─────────────┘          │
│  │  │  + libSQL local │ │                                    │
│  │  │  (full offline) │ │                                    │
│  │  └─────────────────┘ │                                    │
│  └──────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT TOPOLOGY D                      │
│           "Multi-Tenant Database-per-Tenant"                  │
│                                                              │
│  ┌─────────┐    ┌──────────────┐    ┌─────────────────────┐ │
│  │ Tenant A│───▶│              │───▶│ Turso DB: tenant_a  │ │
│  └─────────┘    │  ObjectStack │    ├─────────────────────┤ │
│  ┌─────────┐    │   Gateway    │───▶│ Turso DB: tenant_b  │ │
│  │ Tenant B│───▶│              │    ├─────────────────────┤ │
│  └─────────┘    │              │───▶│ Turso DB: tenant_c  │ │
│  ┌─────────┐    └──────────────┘    └─────────────────────┘ │
│  │ Tenant C│───▶        │                                    │
│  └─────────┘            │                                    │
│                  ┌──────▼──────┐                             │
│                  │ Tenant DB   │                             │
│                  │ Router      │                             │
│                  └─────────────┘                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Turso/libSQL Capabilities Mapping

### 4.1 IDataDriver Interface Mapping

| IDataDriver Method | Turso/libSQL Support | Implementation Notes |
|:---|:---:|:---|
| `connect()` | ✅ | `createClient()` from `@libsql/client` |
| `disconnect()` | ✅ | `client.close()` |
| `checkHealth()` | ✅ | `SELECT 1` probe |
| `getPoolStats()` | 🟡 | Concurrency tracking (no traditional pool) |
| `execute()` | ✅ | `client.execute(sql, args)` |
| `find()` | ✅ | SQL SELECT with QueryAST→SQL compiler |
| `findOne()` | ✅ | `SELECT ... LIMIT 1` |
| `create()` | ✅ | `INSERT INTO ... RETURNING *` |
| `update()` | ✅ | `UPDATE ... WHERE id = ? RETURNING *` |
| `upsert()` | ✅ | `INSERT ... ON CONFLICT DO UPDATE` |
| `delete()` | ✅ | `DELETE FROM ... WHERE id = ?` |
| `count()` | ✅ | `SELECT COUNT(*) FROM ...` |
| `bulkCreate()` | ✅ | `client.batch()` with INSERT statements |
| `bulkUpdate()` | ✅ | `client.batch()` with UPDATE statements |
| `bulkDelete()` | ✅ | `client.batch()` with DELETE statements |
| `updateMany()` | ✅ | `UPDATE ... WHERE <conditions>` |
| `deleteMany()` | ✅ | `DELETE FROM ... WHERE <conditions>` |
| `beginTransaction()` | ✅ | `client.transaction()` (interactive) |
| `commit()` | ✅ | `tx.commit()` |
| `rollback()` | ✅ | `tx.rollback()` |
| `syncSchema()` | ✅ | `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` |
| `dropTable()` | ✅ | `DROP TABLE IF EXISTS` |
| `explain()` | ✅ | `EXPLAIN QUERY PLAN` |

### 4.2 ISchemaDriver Interface Mapping

| ISchemaDriver Method | Turso/libSQL Support | Implementation Notes |
|:---|:---:|:---|
| `createCollection()` | ✅ | `CREATE TABLE IF NOT EXISTS` |
| `dropCollection()` | ✅ | `DROP TABLE IF EXISTS` |
| `addColumn()` | ✅ | `ALTER TABLE ... ADD COLUMN` |
| `modifyColumn()` | 🟡 | SQLite limitation: requires table rebuild |
| `dropColumn()` | ✅ | `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) |
| `createIndex()` | ✅ | `CREATE INDEX IF NOT EXISTS` |
| `dropIndex()` | ✅ | `DROP INDEX IF EXISTS` |
| `executeRaw()` | ✅ | Direct SQL execution |

### 4.3 Capability Matrix Comparison

| Capability | Memory | PostgreSQL | MongoDB | **Turso** |
|:---|:---:|:---:|:---:|:---:|
| **CRUD** | ✅ | ✅ | ✅ | ✅ |
| **Bulk Ops** | ✅ | ✅ | ✅ | ✅ (batch API) |
| **Transactions** | ✅ | ✅ | ✅ | ✅ |
| **Savepoints** | ❌ | ✅ | ❌ | ✅ |
| **Query Filters** | ✅ | ✅ | ✅ | ✅ |
| **Aggregations** | ✅ | ✅ | ✅ | ✅ |
| **Sorting** | ✅ | ✅ | ✅ | ✅ |
| **Pagination** | ✅ | ✅ | ✅ | ✅ |
| **Window Functions** | ❌ | ✅ | ❌ | ✅ |
| **Subqueries** | ❌ | ✅ | ❌ | ✅ |
| **CTE (WITH)** | ❌ | ✅ | ❌ | ✅ |
| **JOINs** | ❌ | ✅ | ❌ | ✅ |
| **Full-Text Search** | ❌ | ✅ | ✅ | ✅ (FTS5) |
| **JSON Query** | ❌ | ✅ (JSONB) | ✅ | ✅ (JSON1) |
| **Vector Search** | ❌ | ✅ (pgvector) | ❌ | ✅ (libSQL vectors) |
| **Streaming** | ✅ | ✅ | ✅ | 🟡 (cursor-based) |
| **Schema Sync** | ❌ | ✅ | ❌ | ✅ |
| **Migrations** | ❌ | ✅ | ❌ | ✅ |
| **Indexes** | ❌ | ✅ | ✅ | ✅ |
| **Connection Pooling** | N/A | ✅ | ✅ | 🟡 (concurrency limit) |
| **Prepared Statements** | ❌ | ✅ | ❌ | ✅ |
| **Edge Runtime** | ✅ | ❌ | ❌ | ✅ |
| **Offline Support** | ✅ | ❌ | ❌ | ✅ |
| **DB-per-Tenant** | ❌ | ❌ | ✅ | ✅ (native) |

---

## 5. Connection Modes

The Turso driver supports three connection modes, selectable by configuration:

### Mode 1: Remote (Cloud)

```typescript
// Connect to Turso cloud or self-hosted libSQL server
const driver = createTursoDriver({
  url: 'libsql://my-db-orgname.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

Best for: Standard server deployments, serverless functions.

### Mode 2: Local (Embedded)

```typescript
// Local SQLite file — no network required
const driver = createTursoDriver({
  url: 'file:./data/local.db',
});
```

Best for: Desktop apps, CI/CD testing, development environments.

### Mode 3: Embedded Replica (Hybrid)

```typescript
// Local file syncing with remote primary
const driver = createTursoDriver({
  url: 'file:./data/replica.db',
  syncUrl: 'libsql://my-db-orgname.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  sync: {
    intervalSeconds: 60,
    onConnect: true,
  },
});
```

Best for: Edge workers, offline-first apps, low-latency read scenarios.

---

## 6. Embedded Replica & Sync Protocol

### How It Works

```
                    ┌──────────────────┐
                    │   Turso Primary   │
                    │   (Cloud/Server)  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │    Sync Layer     │
                    │  (libSQL proto)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
      │  Edge Node 1 │ │ Edge 2   │ │ Edge 3      │
      │  ┌────────┐  │ │ ┌──────┐ │ │ ┌────────┐  │
      │  │Replica │  │ │ │Replica│ │ │ │Replica │  │
      │  │ (.db)  │  │ │ │(.db) │ │ │ │ (.db)  │  │
      │  └────────┘  │ │ └──────┘ │ │ └────────┘  │
      └──────────────┘ └──────────┘ └─────────────┘
```

### Consistency Model

| Operation | Behavior |
|:---|:---|
| **Reads** | Always from local replica (microsecond latency) |
| **Writes** | Forwarded to primary; acknowledged after primary confirms |
| **Read-Your-Writes** | Guaranteed for the writer; other replicas see on next sync |
| **Sync Trigger** | Periodic (configurable) + on-connect + manual `driver.sync()` |

### ObjectStack Integration

The driver exposes a `sync()` method for manual synchronization:

```typescript
// Trigger manual sync (useful after write operations)
await driver.sync();
```

This integrates with ObjectStack's hook system:

```typescript
// After data mutation, sync the embedded replica
kernel.hook('data:record:afterCreate', async () => {
  await driver.sync();
});
```

---

## 7. Multi-Tenancy with Database-per-Tenant

Turso natively supports creating thousands of lightweight databases, making it ideal
for ObjectStack's multi-tenancy model.

### Architecture

```typescript
// Multi-tenant configuration
const tenantRouter = createTursoMultiTenantDriver({
  // Base URL template — {tenant} is replaced with tenant ID
  urlTemplate: 'libsql://{tenant}-orgname.turso.io',
  authToken: process.env.TURSO_GROUP_AUTH_TOKEN,
  
  // Tenant lifecycle
  onTenantCreate: async (tenantId) => {
    // Turso API: create new database in group
    await tursoApi.createDatabase(tenantId);
  },
  onTenantDelete: async (tenantId) => {
    await tursoApi.deleteDatabase(tenantId);
  },
});
```

### Comparison with Other Strategies

| Strategy | PostgreSQL | MongoDB | Turso |
|:---|:---|:---|:---|
| **Row-Level** | ✅ RLS policies | ✅ Query filters | ✅ But not recommended |
| **Schema-per-Tenant** | ✅ pg schemas | N/A | N/A |
| **DB-per-Tenant** | 🟡 Heavy (full DB) | ✅ Lightweight | ✅ **Native** (10k+ DBs) |
| **Isolation Level** | Medium-High | High | **Complete** |
| **Cost per Tenant** | High (connections) | Medium | **Low** (per-query) |

### Integration with ObjectStack Multi-Tenancy

The driver maps to ObjectStack's `tenantId` in `DriverOptions`:

```typescript
// ObjectStack automatically passes tenantId from security context
const results = await engine.find('accounts', query, {
  tenantId: 'tenant_abc',  // → Routes to libsql://tenant_abc-org.turso.io
});
```

---

## 8. Integration with Existing ObjectStack Services

### Service Compatibility Matrix

| Service | Compatibility | Notes |
|:---|:---:|:---|
| `ICacheService` | ✅ | Independent service; no driver dependency |
| `IQueueService` | ✅ | Independent service |
| `IJobService` | ✅ | Independent service |
| `IStorageService` | ✅ | Independent service |
| `IAuthService` | ✅ | better-auth supports SQLite/Turso |
| `IMetadataService` | ✅ | Metadata stored in ObjectQL (driver-agnostic) |
| `ISearchService` | ✅ | FTS5 built into libSQL; native full-text search |
| `IRealtimeService` | ✅ | WebSocket layer is driver-independent |
| `IAIService` | ✅ | Vector search supported natively in libSQL |

### Special Integration: better-auth + Turso

ObjectStack's `plugin-auth` uses `better-auth` which already has official Turso adapter support.
This means authentication tables (users, sessions, accounts) can live in the same Turso database
as application data — eliminating the need for a separate auth database in edge deployments.

### Special Integration: Vector Search + RAG

libSQL supports native vector search, enabling ObjectStack's `IAIService` and RAG Pipeline
to store embeddings directly in the same database:

```sql
-- Create vector column
ALTER TABLE documents ADD COLUMN embedding F32_BLOB(1536);

-- Similarity search
SELECT * FROM vector_top_k('documents_idx', vector('[0.1, 0.2, ...]'), 10);
```

---

## 9. Package Structure

```
packages/plugins/driver-turso/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/
│   ├── index.ts                    # Public exports
│   ├── turso-driver.ts             # IDataDriver implementation
│   ├── turso-schema-driver.ts      # ISchemaDriver implementation
│   ├── turso-driver-plugin.ts      # ObjectStack plugin wrapper
│   ├── query-compiler.ts           # QueryAST → SQL compiler
│   ├── type-mapper.ts              # ObjectStack field types → SQLite types
│   ├── result-mapper.ts            # SQLite rows → ObjectStack records
│   ├── multi-tenant.ts             # Database-per-tenant router (optional)
│   └── __tests__/
│       ├── turso-driver.test.ts
│       ├── turso-schema-driver.test.ts
│       ├── query-compiler.test.ts
│       ├── type-mapper.test.ts
│       └── multi-tenant.test.ts
```

### Dependencies

```json
{
  "name": "@objectstack/driver-turso",
  "version": "3.1.0",
  "dependencies": {
    "@libsql/client": "^0.17.0",
    "@objectstack/core": "workspace:*",
    "@objectstack/spec": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^4.0.0",
    "tsup": "^8.0.0"
  }
}
```

---

## 10. Configuration Schema

The `TursoConfigSchema` is defined in `packages/spec/src/data/driver/turso.zod.ts` and supports:

| Property | Type | Default | Description |
|:---|:---|:---:|:---|
| `url` | `string` | (required) | Database URL (`libsql://`, `https://`, `file:`, `:memory:`) |
| `authToken` | `string?` | — | JWT auth token for remote databases |
| `encryptionKey` | `string?` | — | AES-256 encryption key for local files |
| `concurrency` | `number` | `20` | Maximum concurrent requests |
| `syncUrl` | `string?` | — | Remote sync URL for embedded replica mode |
| `localPath` | `string?` | — | Local file path for embedded replica |
| `sync.intervalSeconds` | `number` | `60` | Periodic sync interval (0 = manual only) |
| `sync.onConnect` | `boolean` | `true` | Sync immediately on connect |
| `timeout` | `number?` | — | Operation timeout in milliseconds |
| `wasm` | `boolean?` | — | Use WASM build for edge/browser environments |

---

## 11. Migration & Deployment Strategy

### For New Projects

```bash
# Scaffold with Turso driver
npx create-objectstack my-app --driver turso

# Set environment variables
export TURSO_DATABASE_URL="libsql://my-db-orgname.turso.io"
export TURSO_AUTH_TOKEN="eyJhbGciOi..."

# Start development
pnpm dev
```

### For Existing Projects (Migration from Memory Driver)

```typescript
// Before (development with memory driver)
import { createMemoryDriver } from '@objectstack/driver-memory';

// After (production with Turso)
import { createTursoDriver } from '@objectstack/driver-turso';

export default defineStack({
  datasources: [{
    name: 'default',
    driver: 'turso',
    config: {
      url: process.env.NODE_ENV === 'production'
        ? process.env.TURSO_DATABASE_URL
        : 'file:./dev.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    },
  }],
});
```

### Schema Migration

The driver implements `ISchemaDriver` for automatic DDL operations:

```bash
# Generate migration from object definitions
objectstack migrate generate

# Apply migrations to Turso database
objectstack migrate apply --driver turso
```

---

## 12. Implementation Phases

### Phase A — Core Driver (v3.1, Q2 2026)

| Task | Priority | Effort |
|:---|:---:|:---:|
| `TursoDriver` implementing `IDataDriver` | **P0** | 2 weeks |
| QueryAST → SQL compiler (SQLite dialect) | **P0** | 1 week |
| Type mapper (ObjectStack fields → SQLite types) | **P0** | 3 days |
| Transaction support (interactive + batch) | **P0** | 3 days |
| `TursoSchemaDriver` implementing `ISchemaDriver` | **P1** | 1 week |
| `TursoDriverPlugin` (ObjectStack plugin wrapper) | **P0** | 2 days |
| Test suite (unit + integration) | **P0** | 1 week |
| Documentation and examples | **P1** | 3 days |

**Total Estimated Effort: ~5 weeks**

### Phase B — Edge & Sync (v3.2, Q3 2026)

| Task | Priority | Effort |
|:---|:---:|:---:|
| Embedded replica mode with sync | **P1** | 1 week |
| WASM build support for Cloudflare/Deno | **P1** | 1 week |
| Offline write queue and sync reconciliation | **P2** | 2 weeks |
| Edge deployment guides (Cloudflare, Vercel, Deno) | **P2** | 3 days |

### Phase C — Multi-Tenancy (v3.3, Q4 2026)

| Task | Priority | Effort |
|:---|:---:|:---:|
| Database-per-tenant router | **P2** | 1 week |
| Turso Platform API integration (create/delete DB) | **P2** | 1 week |
| Tenant migration tools | **P3** | 1 week |

### Phase D — Advanced Features (v4.0, Q1 2027)

| Task | Priority | Effort |
|:---|:---:|:---:|
| Vector search integration with `IAIService` | **P2** | 1 week |
| FTS5 integration with `ISearchService` | **P2** | 1 week |
| better-auth Turso adapter for `IAuthService` | **P2** | 3 days |
| Performance benchmarks vs. other drivers | **P3** | 1 week |

---

## 13. Risks & Mitigations

| Risk | Severity | Likelihood | Mitigation |
|:---|:---:|:---:|:---|
| SQLite `ALTER TABLE` limitations (no `MODIFY COLUMN`) | Medium | High | Table rebuild strategy in `ISchemaDriver` |
| Embedded replica sync conflicts | Low | Medium | Read-your-writes consistency; last-write-wins for conflicts |
| `@libsql/client` breaking changes | Low | Low | Pin version; monitor changelog |
| WASM performance in edge runtimes | Medium | Medium | Benchmark and optimize; fallback to remote mode |
| libSQL/Turso service availability | Low | Low | Embedded replica provides offline fallback |
| Concurrent write limitations | Medium | Low | libSQL fork supports concurrent writes via MVCC |

---

## 14. Decision Log

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use `@libsql/client` as underlying client | Official TypeScript SDK with best feature coverage | `better-sqlite3` (no remote), `sql.js` (WASM only) |
| SQLite dialect in SQL compiler | Turso/libSQL is SQLite-compatible | N/A |
| Implement both `IDataDriver` and `ISchemaDriver` | Full driver capability for production use | IDataDriver only (no migrations) |
| Support three connection modes | Maximum flexibility across deployment targets | Remote-only (loses edge/offline value) |
| Database-per-tenant as recommended multi-tenancy | Turso's native strength; complete isolation | Row-level (weaker isolation) |
| WASM support as Phase B | Not needed for initial server-side use | Day 1 (higher initial effort) |

---

## Related Documents

| Document | Description |
|:---|:---|
| [`ROADMAP.md`](../../ROADMAP.md) | Project roadmap with Turso driver timeline |
| [`ARCHITECTURE.md`](../../ARCHITECTURE.md) | Microkernel design and package structure |
| [`packages/spec/src/data/driver/turso.zod.ts`](../../packages/spec/src/data/driver/turso.zod.ts) | Turso configuration schema (Zod) |
| [`packages/spec/src/contracts/data-driver.ts`](../../packages/spec/src/contracts/data-driver.ts) | IDataDriver interface contract |
| [`packages/spec/src/contracts/schema-driver.ts`](../../packages/spec/src/contracts/schema-driver.ts) | ISchemaDriver interface contract |
