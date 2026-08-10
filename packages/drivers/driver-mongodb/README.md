# @objectstack/driver-mongodb

MongoDB driver for ObjectStack — native document database support via the official MongoDB Node.js driver.

> ### ⚠️ Single-tenant only
>
> This driver has **no row-level tenant isolation**: it ignores
> `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are not
> stamped with a tenant column. Rather than serve a multi-tenant deployment
> without isolation, it **refuses to start** in one — see
> [Multi-tenancy](#multi-tenancy) below. Use
> [`@objectstack/driver-sql`](../driver-sql) (PostgreSQL / MySQL / SQLite) for
> multi-tenant deployments.

## Installation

```bash
pnpm add @objectstack/driver-mongodb mongodb
```

## Configuration

### Option A — Env vars (recommended for `objectstack dev` / `objectstack serve`)

```bash
export OS_DATABASE_URL=mongodb://localhost:27017/myapp
pnpm dev
```

The ObjectStack CLI auto-registers this driver when `OS_DATABASE_URL` starts with
`mongodb://` or `mongodb+srv://`. You do **not** need to set
`OS_DATABASE_DRIVER` separately — the URL scheme is enough. Set it only as an
explicit override (recognised values: `mongodb`, `mongo`).

### Option B — Programmatic via `defineStack`

```typescript
import { defineStack } from '@objectstack/spec';
import { MongoDBDriver } from '@objectstack/driver-mongodb';

export default defineStack({
  driver: new MongoDBDriver({
    url: 'mongodb://localhost:27017/myapp',
    database: 'myapp',        // Optional: overrides URI database
    maxPoolSize: 10,          // Optional: connection pool size (default: 10)
    minPoolSize: 1,           // Optional: minimum pool (default: 1)
    connectTimeoutMS: 10000,  // Optional: connection timeout
  }),
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | **required** | MongoDB connection URI |
| `database` | `string` | from URI | Database name |
| `maxPoolSize` | `number` | `10` | Max connection pool size |
| `minPoolSize` | `number` | `1` | Min connection pool size |
| `connectTimeoutMS` | `number` | `10000` | Connection timeout (ms) |
| `serverSelectionTimeoutMS` | `number` | `5000` | Server selection timeout (ms) |
| `options` | `MongoClientOptions` | `{}` | Additional MongoClient options |

## Features

### Capabilities

| Category | Capability | Supported |
|----------|-----------|-----------|
| **CRUD** | create, read, update, delete | ✅ |
| **Bulk** | bulkCreate, bulkUpdate, bulkDelete | ✅ |
| **Query** | filters, sorting, pagination, aggregations | ✅ |
| **Transactions** | Multi-document transactions | ✅ (requires replica set) |
| **Streaming** | Cursor-based async iteration | ✅ |
| **Schema** | Collection + index sync | ✅ |
| **Advanced** | Full-text search, JSON queries, geospatial | ✅ |
| **Joins** | Cross-collection joins ($lookup) | ❌ |
| **Window Functions** | ROW_NUMBER, RANK, etc. | ❌ |
| **Multi-tenancy** | Row-level tenant isolation | ❌ (boots single-tenant only) |

### Multi-tenancy

The driver is a **single-tenant / embedded** driver. Unlike
`@objectstack/driver-sql` — which resolves a tenant column per object, injects a
`WHERE tenant_field = ?` predicate on reads and stamps that column on writes —
this driver implements none of that layer. In a multi-tenant deployment every
query would read, update and delete other tenants' documents.

So instead of running unisolated, it fails fast at startup
([#3724](https://github.com/objectstack-ai/objectstack/issues/3724)):

| Signal | Where it is checked | Result |
|--------|--------------------|--------|
| Tenancy posture is not `single` — `OS_TENANCY_POSTURE=group\|isolated`, or derived from `OS_MULTI_ORG_ENABLED=true` | `new MongoDBDriver()`, re-checked in `connect()` before a socket is opened | throws `MongoDBMultiTenantUnsupportedError` |
| An object declares `tenancy.enabled: true` | `syncSchema()` / `syncSchemasBatch()` | throws, naming every offending object |

The error carries `code === 'MONGODB_MULTI_TENANT_UNSUPPORTED'` so a host can
recognise it without matching on the message:

```typescript
import {
  MongoDBMultiTenantUnsupportedError,
  MULTI_TENANT_UNSUPPORTED_CODE,
} from '@objectstack/driver-mongodb';
```

There is deliberately **no override flag** — one would restore exactly the
silent cross-tenant access the guard exists to prevent. To run MongoDB, keep the
deployment single-tenant (`OS_TENANCY_POSTURE=single` or unset, `OS_MULTI_ORG_ENABLED`
unset or `false`, no object declaring `tenancy.enabled: true`); to go
multi-tenant, switch to `@objectstack/driver-sql`.

### ID Handling

ObjectStack uses string IDs (nanoid). The driver:
- Stores `id` as a regular string field with a unique index
- Auto-generates `id` via nanoid if not provided
- **Never exposes** MongoDB's internal `_id` field in results

### Filter Operators

All ObjectStack filter operators are supported:

```typescript
// MongoDB-style filters (pass-through)
await driver.find('task', {
  where: {
    status: { $in: ['active', 'pending'] },
    priority: { $gte: 3 },
    title: { $contains: 'urgent' },
    deleted_at: { $null: true },
  }
});

// Legacy array-style filters
await driver.find('task', {
  where: [['status', '=', 'active'], 'or', ['priority', '>=', 5]]
});
```

### Transactions

Transactions require a MongoDB **replica set** (including single-node replica sets for development).

```typescript
const session = await driver.beginTransaction();
try {
  await driver.create('order', { total: 100 }, { transaction: session });
  await driver.update('inventory', itemId, { stock: newStock }, { transaction: session });
  await driver.commit(session);
} catch (error) {
  await driver.rollback(session);
  throw error;
}
```

### Schema Sync

Schema sync creates collections and indexes:

Field-level `unique` and lookup fields index themselves; everything else is
declared in the object's `indexes[]` — the one surface an index is declared on
(a field-level `indexed` flag is not a `FieldSchema` key and never built an
index, #2377 / #6810).

```typescript
await driver.syncSchema('account', {
  name: 'account',
  fields: {
    name: { type: 'string', unique: true },
    email: { type: 'email' },
    company_id: { type: 'lookup', reference_to: 'company' },
  },
  indexes: [{ fields: ['email'] }],
});
// Creates: idx_id_unique, idx_name_unique, idx_email, idx_company_id_lookup
```

### Aggregation

```typescript
const results = await driver.aggregate('order', {
  where: { status: 'completed' },
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total_revenue' },
    { function: 'count', alias: 'order_count' },
  ],
  groupBy: ['region'],
});
```

## Plugin Usage

Register as an ObjectStack plugin:

```typescript
import mongodbPlugin from '@objectstack/driver-mongodb';

// The plugin registers automatically via onEnable
kernel.use(mongodbPlugin, {
  url: 'mongodb://localhost:27017/myapp',
});
```

## Development

```bash
# Run tests (the suites that need a real mongod SKIP — see below)
pnpm test

# Run every suite, including the ones that need a real mongod
OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1 pnpm test

# Build
pnpm build
```

### The mongod-backed suites are opt-in (#5517)

Seven suites here need a real MongoDB, which `mongodb-memory-server` provides by
downloading a ~123 MB binary on first use. With a cold cache, two vitest workers
downloaded it at the same time and the loser's `rename` failed as an unhandled
rejection — turning an all-green run into `exit 1` and ejecting unrelated PRs
from the merge queue. Those suites are therefore gated behind
`OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`: without it they skip, each printing
one line that names this issue and the switch, and **no download starts**.

The rest of the package's tests — filter translation, the shared filter-logic
conformance case-set over the emitted documents, sort specs, tenancy guard,
temporal helpers — run by default and need no binary. The gate lives in
`src/test-mongod.ts`, which documents the mechanism and what a default run gives
up.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
