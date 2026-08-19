# @objectstack/driver-sql

SQL Driver for ObjectStack - Supports PostgreSQL, MySQL, SQLite via Knex.js.

## Features

- **Multi-Database Support**: PostgreSQL, MySQL, SQLite, and other Knex-supported databases
- **Query Builder**: the underlying Knex.js instance is reachable via `getKnex()`
- **Managed Schema**: tables, columns and indexes are reconciled from your object metadata
- **Connection Pooling**: Efficient connection management
- **Transactions**: Full ACID transaction support
- **Raw SQL**: Execute raw SQL when needed
- **Type-Safe**: Full TypeScript support with inferred types
- **Production-Ready**: Battle-tested Knex.js under the hood

## Installation

```bash
pnpm add @objectstack/driver-sql
```

### Database-Specific Drivers

`pg`, `mysql2` and `tedious` are **optional peer dependencies** — install the one
your database needs:

```bash
# PostgreSQL
pnpm add pg

# MySQL
pnpm add mysql2

# SQL Server
pnpm add tedious
```

SQLite needs nothing extra: `better-sqlite3` ships as an optional dependency of
this package.

## Basic Usage

A driver is not a `defineStack()` key — it is a **plugin**. Wrap it in
`DriverPlugin` from `@objectstack/runtime` and list it under `plugins`.

### PostgreSQL

```typescript
import { defineStack } from '@objectstack/spec';
import { DriverPlugin } from '@objectstack/runtime';
import { SqlDriver } from '@objectstack/driver-sql';

export default defineStack({
  manifest: {
    id: 'com.example.myapp',
    version: '1.0.0',
    type: 'app',
    name: 'My App',
  },
  plugins: [
    new DriverPlugin(
      new SqlDriver({
        client: 'pg',
        connection: {
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: process.env.DB_PASSWORD,
          database: 'myapp',
        },
        pool: {
          min: 2,
          max: 10,
        },
      }),
    ),
  ],
});
```

### MySQL

Same `plugins` entry — only the driver config changes:

```typescript
import { SqlDriver } from '@objectstack/driver-sql';

const driver = new SqlDriver({
  client: 'mysql2',
  connection: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: process.env.DB_PASSWORD,
    database: 'myapp',
  },
});
```

### SQLite

```typescript
import { SqlDriver } from '@objectstack/driver-sql';

const driver = new SqlDriver({
  client: 'better-sqlite3',
  connection: {
    filename: './data/app.db',
  },
  useNullAsDefault: true,
});
```

### Without writing any code

`os dev` / `os serve` build this driver for you from the database URL, so a
project that needs no custom driver options can set an environment variable
instead of registering a plugin:

```bash
OS_DATABASE_URL=postgres://user:pass@localhost:5432/myapp
OS_DATABASE_URL=mysql://user:pass@localhost:3306/myapp
OS_DATABASE_URL=file:./data/app.db
```

## Configuration Options

The exported config type is **`SqlDriverConfig`**. It is Knex's own
`Knex.Config` (`client`, `connection`, `pool`, `useNullAsDefault`, `debug`, …)
plus the four ObjectStack-specific keys below, which are stripped before the
config reaches Knex:

```typescript
import type { SqlDriverConfig } from '@objectstack/driver-sql';

const config: SqlDriverConfig = {
  // ── Knex.Config ──────────────────────────────────────────────────────────
  client: 'pg',
  connection: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.DB_PASSWORD,
    database: 'myapp',
  },
  pool: { min: 2, max: 10 },
  debug: false,

  // ── ObjectStack-specific ─────────────────────────────────────────────────

  /** 'managed' (default) reconciles tables from metadata; 'external' is read-only. */
  schemaMode: 'managed',

  /** Dev-only non-destructive auto-reconcile. 'off' (default) only warns. */
  autoMigrate: 'off',

  /** File-backed SQLite journal mode. Defaults to 'wal'. */
  sqliteJournalMode: 'wal',

  /** What to do when a file-backed SQLite target does not exist. Default 'create'. */
  sqliteAbsentFile: 'create',
};
```

## Database Operations

The SQL driver implements the standard ObjectStack driver interface:

```typescript
import type { IDataDriver } from '@objectstack/spec/contracts';

// `SqlDriver implements IDataDriver` — all standard operations are supported:
// find, findOne, create, update, delete, count
```

Every driver method takes the **object name as its first argument**; the query
AST that follows carries no `object` key.

### Advanced Queries

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Filters are the ObjectQL filter dialect: `{ field: { $op: value } }`.
const results = await driver.find('crm_opportunity', {
  where: {
    amount: { $gte: 10000 },
    stage: { $in: ['proposal', 'negotiation'] },
  },
  orderBy: [{ field: 'amount', order: 'desc' }],
  limit: 100,
  offset: 0,
});
```

## Schema Management

ObjectStack manages the physical schema **from your object metadata** — there
are no hand-written migration files. In the default `schemaMode: 'managed'`, the
driver creates each object's table on first boot and reports drift afterwards.

The physical table name **is** the object's (namespace-prefixed) name:
`crm_account` is stored in a table called `crm_account`, `sys_user` in
`sys_user`. Nothing is prefixed with `objectstack_`.

### Reviewing and applying schema changes

```bash
# Dry-run diff of metadata vs the physical database (never mutates)
os migrate plan

# Apply the reconcile
os migrate apply

# Resume an interrupted apply
os migrate resume
```

### Indexes

Declare indexes on the object, not in DDL — the driver materializes them:

```typescript
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.crm', version: '1.0.0', type: 'app', name: 'CRM' },
  objects: [
    {
      name: 'crm_opportunity',
      fields: {
        account_id: { type: 'lookup', reference: 'crm_account' },
        stage: { type: 'text' },
        amount: { type: 'number' },
      },
      indexes: [
        { fields: ['account_id'] },
        { fields: ['stage'] },
        { name: 'crm_opportunity_created_stage', fields: ['created_at', 'stage'] },
        { fields: ['external_ref'], unique: 'organization' },
      ],
    },
  ],
});
```

`unique: 'organization'` makes the constraint one-holder-per-organization;
`unique: 'global'` makes it installation-wide.

### Dev-only auto-reconcile

```typescript
import { SqlDriver } from '@objectstack/driver-sql';

const driver = new SqlDriver({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  // Applies non-destructive alters (relax NOT NULL, widen varchar) at boot.
  // Force-disabled when NODE_ENV === 'production'.
  autoMigrate: 'safe',
});
```

## Transactions

`beginTransaction()` returns the handle; pass it to every write as
`options.transaction`, then `commit()` or `rollback()`:

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

const trx = await driver.beginTransaction();
try {
  const account = await driver.create(
    'crm_account',
    { name: 'Acme Corp' },
    { transaction: trx },
  );

  await driver.create(
    'crm_contact',
    { name: 'John Doe', account_id: account.id },
    { transaction: trx },
  );

  await driver.commit(trx);
} catch (error) {
  await driver.rollback(trx);
  throw error;
}
```

## Raw SQL Queries

When ObjectQL isn't sufficient, execute raw SQL with `execute()`:

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Raw query
const rollup = await driver.execute(`
  SELECT
    c.name,
    COUNT(o.id) as opportunity_count,
    SUM(o.amount) as total_revenue
  FROM crm_account c
  LEFT JOIN crm_opportunity o ON o.account_id = c.id
  WHERE o.stage = 'closed_won'
  GROUP BY c.id, c.name
  ORDER BY total_revenue DESC
  LIMIT 10
`);

// Raw query with parameters (prevent SQL injection)
const users = await driver.execute(
  'SELECT * FROM sys_user WHERE email = ?',
  ['user@example.com'],
);
```

> ⚠️ **Raw SQL bypasses driver-level tenant isolation.** The `WHERE
> organization_id = ?` predicate that `find` / `update` / `delete`
> auto-apply is **not** added to `driver.execute()` or `engine.execute()`
> output. Always include the tenant predicate yourself when running raw
> queries against tenant-scoped tables.

## Tenant Isolation (Row-Level)

When an object declares a tenant field (either explicitly via
`tenancy.tenantField`, or implicitly by having an `organization_id`
field), the driver auto-scopes every CRUD call by the caller's
`options.tenantId`:

| Operation | Scope behavior |
|---|---|
| `find`, `findOne`, `count`, `aggregate` | `WHERE <tenantField> = :tenantId` injected |
| `update`, `delete`, `updateMany`, `deleteMany`, `bulkDelete` | Same `WHERE` injected — cross-tenant writes silently no-op |
| `create`, `upsert`, `bulkCreate` | `<tenantField>` auto-injected on each row if absent |

The engine (`@objectstack/objectql`) threads `ExecutionContext.tenantId`
into options for you; manual `driver.find(...)` calls can pass
`{ tenantId: '...' }` directly.

### Declaring the tenant field

```ts
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.ws', version: '1.0.0', type: 'app', name: 'Workspace' },
  objects: [
    {
      name: 'ws_item',
      // Custom tenant column (default is 'organization_id')
      tenancy: { enabled: true, tenantField: 'workspace_id' },
      fields: {
        workspace_id: { type: 'text' },
        title: { type: 'text' },
      },
    },
  ],
});
```

`tenancy.strategy` and `tenancy.crossTenantAccess` were removed after spec
15.0 and are now rejected outright — the two supported modes are
database-per-tenant (a deployment choice, no object config) and row-level
isolation (`tenancy.enabled` + `tenancy.tenantField`).

### Bypasses (intentional, documented)

| Path | Tenant-scoped? | Why |
|---|---|---|
| Callers that omit `options.tenantId` | No | Seed scripts, boot-time installers, admin tooling |
| `ExecutionContext.isSystem === true` | No (auto-`bypassTenantAudit`) | Kernel-internal mirrors, scheduled hooks |
| Explicit `organization_id` on insert row | Wins | Admin tooling can target a specific tenant |
| `driver.execute()` / `engine.execute(sql)` | No | Raw SQL is on you |
| `driver.bulkUpdate` | Yes (it loops `update`) | Same scope as `update` |

### Audit warning

The driver logs **one warning per `{object}:{op}`** when a write hits a
tenant-scoped object without `options.tenantId`. Genuine system writes
(`ExecutionContext.isSystem === true`) auto-silence; everything else
surfaces as `[tenant-audit] ...` so missing-context bugs are visible.

Override per call: `options.bypassTenantAudit = true`.
Override globally: `OS_TENANT_AUDIT=0`.

## Database-Specific Features

### PostgreSQL Features

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Use PostgreSQL-specific features
const tech = await driver.execute(`
  SELECT * FROM crm_opportunity
  WHERE data @> '{"industry": "Technology"}'::jsonb
`);

// Full-text search
const articles = await driver.execute(`
  SELECT * FROM blog_article
  WHERE to_tsvector('english', title || ' ' || body) @@ to_tsquery('objectstack')
`);
```

### MySQL Features

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Use MySQL-specific features
const products = await driver.execute(`
  SELECT * FROM shop_product
  WHERE MATCH(name, description) AGAINST ('widget' IN NATURAL LANGUAGE MODE)
`);
```

## Connection Management

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Get underlying Knex instance
const knex = driver.getKnex();

// Check connection — resolves to false rather than throwing
const healthy: boolean = await driver.checkHealth();

// Close all connections
await driver.disconnect();
```

## Performance Optimization

### Query Optimization

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Ask the database for the plan behind a query
const plan = await driver.explain('crm_opportunity', {
  where: { stage: 'proposal' },
});

// Partial / covering indexes that the declaration surface does not express are
// issued at the database layer, through the Knex instance.
await driver.getKnex().raw(`
  CREATE INDEX idx_active_opportunities
  ON crm_opportunity(account_id, amount)
  WHERE stage NOT IN ('closed_won', 'closed_lost')
`);
```

## Best Practices

1. **Connection Pooling**: Configure appropriate pool size based on load
2. **Schema**: Declare fields and indexes in metadata; review changes with `os migrate plan`
3. **Transactions**: Use transactions for multi-step operations
4. **Prepared Statements**: Use parameterized queries to prevent SQL injection
5. **Indexes**: Declare indexes on frequently queried fields
6. **Monitoring**: Monitor slow query logs and connection pool metrics
7. **Backups**: Implement regular database backups

## Environment-Specific Configuration

```typescript
import { defineStack } from '@objectstack/spec';
import { DriverPlugin } from '@objectstack/runtime';
import { SqlDriver, type SqlDriverConfig } from '@objectstack/driver-sql';

// config/database.ts
const configs: Record<string, SqlDriverConfig> = {
  development: {
    client: 'better-sqlite3',
    connection: { filename: './data/dev.db' },
    useNullAsDefault: true,
    debug: true,
  },
  test: {
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  },
  production: {
    client: 'pg',
    // `ssl` belongs to the CONNECTION, not the top level of the config.
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 10 },
  },
};

export const getDatabaseConfig = (): SqlDriverConfig =>
  configs[process.env.NODE_ENV ?? 'development'] ?? configs.development;

export default defineStack({
  manifest: { id: 'com.example.myapp', version: '1.0.0', type: 'app', name: 'My App' },
  plugins: [new DriverPlugin(new SqlDriver(getDatabaseConfig()))],
});
```

## Troubleshooting

### Connection Issues

```typescript
import type { SqlDriver } from '@objectstack/driver-sql';

declare const driver: SqlDriver;

// Test database connection
if (await driver.checkHealth()) {
  console.log('Database connected successfully');
} else {
  console.error('Database connection failed');
}
```

### Schema Drift

```bash
# Review what metadata wants versus what the database has
os migrate plan

# Apply it
os migrate apply
```

### Query Debugging

```typescript
import { DriverPlugin } from '@objectstack/runtime';
import { SqlDriver } from '@objectstack/driver-sql';

// Enable query logging
const plugin = new DriverPlugin(
  new SqlDriver({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    debug: true, // Log all queries
  }),
);
```

## Deployment

### Heroku PostgreSQL

```bash
# Heroku automatically provides DATABASE_URL
heroku addons:create heroku-postgresql:hobby-dev

# ObjectStack reads it directly
OS_DATABASE_URL="$DATABASE_URL"
```

### Railway PostgreSQL

```bash
# Use Railway's DATABASE_URL
railway up
```

### Vercel PostgreSQL

```typescript
import { defineStack } from '@objectstack/spec';
import { DriverPlugin } from '@objectstack/runtime';
import { SqlDriver } from '@objectstack/driver-sql';

export default defineStack({
  manifest: { id: 'com.example.myapp', version: '1.0.0', type: 'app', name: 'My App' },
  plugins: [
    new DriverPlugin(
      new SqlDriver({
        client: 'pg',
        // Vercel Postgres pools through this URL.
        connection: process.env.POSTGRES_URL,
      }),
    ),
  ],
});
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [Knex.js Documentation](https://knexjs.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [@objectstack/driver-turso](../driver-turso/) - Edge-first SQLite alternative (extends this driver)
- [@objectstack/driver-sqlite-wasm](../driver-sqlite-wasm/) - In-process WASM SQLite (extends this driver)
- [@objectstack/driver-memory](../driver-memory/) - In-memory driver for testing
