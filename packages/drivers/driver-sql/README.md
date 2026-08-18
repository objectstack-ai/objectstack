# @objectstack/driver-sql

SQL Driver for ObjectStack - Supports PostgreSQL, MySQL, SQLite via Knex.js.

## Features

- **Multi-Database Support**: PostgreSQL, MySQL, SQLite, and other Knex-supported databases
- **Query Builder**: Powerful Knex.js query builder integration
- **Migrations**: Database schema migrations with version control
- **Connection Pooling**: Efficient connection management
- **Transactions**: Full ACID transaction support
- **Raw SQL**: Execute raw SQL when needed
- **Type-Safe**: Full TypeScript support with inferred types
- **Production-Ready**: Battle-tested Knex.js under the hood

## Installation

```bash
pnpm add @objectstack/driver-sql knex
```

### Database-Specific Drivers

Install the driver for your database:

```bash
# PostgreSQL
pnpm add pg

# MySQL
pnpm add mysql2

# SQLite
pnpm add better-sqlite3
```

## Basic Usage

### PostgreSQL

```typescript
import { defineStack } from '@objectstack/spec';
import { SqlDriver } from '@objectstack/driver-sql';

const stack = defineStack({
  driver: new SqlDriver({
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
});
```

### MySQL

```typescript
const stack = defineStack({
  driver: new SqlDriver({
    client: 'mysql2',
    connection: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: process.env.DB_PASSWORD,
      database: 'myapp',
    },
  }),
});
```

### SQLite

```typescript
const stack = defineStack({
  driver: new SqlDriver({
    client: 'better-sqlite3',
    connection: {
      filename: './data/app.db',
    },
    useNullAsDefault: true,
  }),
});
```

## Configuration Options

```typescript
interface SQLDriverConfig {
  /** Knex client (pg, mysql2, better-sqlite3, etc.) */
  client: string;

  /** Database connection config */
  connection: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    filename?: string; // For SQLite
  };

  /** Connection pool settings */
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMillis?: number;
  };

  /** Use NULL as default for unsupported features (SQLite) */
  useNullAsDefault?: boolean;

  /** Enable query debugging */
  debug?: boolean;

  /** Migrations configuration */
  migrations?: {
    directory?: string;
    tableName?: string;
  };
}
```

## Database Operations

The SQL driver implements the standard ObjectStack driver interface:

```typescript
import type { IDataDriver } from '@objectstack/spec/contracts';

// `SqlDriver implements IDataDriver` — all standard operations are supported:
// find, findOne, create, update, delete, count
```

### Advanced Queries

```typescript
// The SQL driver supports all ObjectQL query features:
const results = await kernel.getDriver().find({
  object: 'opportunity',
  filters: [
    { field: 'amount', operator: 'gte', value: 10000 },
    { field: 'stage', operator: 'in', value: ['proposal', 'negotiation'] },
  ],
  sort: [{ field: 'amount', direction: 'desc' }],
  limit: 100,
  offset: 0,
});
```

## Migrations

### Creating Migrations

```typescript
// migrations/001_create_users.ts
export async function up(knex) {
  await knex.schema.createTable('objectstack_user', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('email').notNullable().unique();
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('objectstack_user');
}
```

### Running Migrations

```bash
# Run all pending migrations
npx knex migrate:latest

# Rollback last migration
npx knex migrate:rollback

# Check migration status
npx knex migrate:status
```

### Migration Configuration

Create `knexfile.js` in your project root:

```javascript
module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: 'localhost',
      user: 'postgres',
      password: process.env.DB_PASSWORD,
      database: 'myapp_dev',
    },
    migrations: {
      directory: './migrations',
      tableName: 'objectstack_migrations',
    },
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      directory: './migrations',
      tableName: 'objectstack_migrations',
    },
  },
};
```

## Transactions

```typescript
const driver = kernel.getDriver();

await driver.transaction(async (trx) => {
  // All operations within this callback use the same transaction
  const account = await trx.insert({
    object: 'account',
    data: { name: 'Acme Corp' },
  });

  await trx.insert({
    object: 'contact',
    data: {
      name: 'John Doe',
      account_id: account.id,
    },
  });

  // If an error is thrown, all changes are rolled back
  // If successful, changes are committed
});
```

## Raw SQL Queries

When ObjectQL isn't sufficient, execute raw SQL:

```typescript
const driver = kernel.getDriver();

// Raw query
const results = await driver.raw(`
  SELECT
    c.name,
    COUNT(o.id) as opportunity_count,
    SUM(o.amount) as total_revenue
  FROM objectstack_account c
  LEFT JOIN objectstack_opportunity o ON o.account_id = c.id
  WHERE o.stage = 'closed_won'
  GROUP BY c.id, c.name
  ORDER BY total_revenue DESC
  LIMIT 10
`);

// Raw query with parameters (prevent SQL injection)
const results = await driver.raw(
  'SELECT * FROM objectstack_user WHERE email = ?',
  ['user@example.com']
);
```

> ⚠️ **Raw SQL bypasses driver-level tenant isolation.** The `WHERE
> organization_id = ?` predicate that `find` / `update` / `delete`
> auto-apply is **not** added to `driver.raw()` or `engine.execute()`
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
// Custom tenant column (default is 'organization_id')
{
  name: 'workspace_item',
  tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id' },
  fields: {
    workspace_id: { type: 'string' },
    /* ... */
  },
}
```

### Bypasses (intentional, documented)

| Path | Tenant-scoped? | Why |
|---|---|---|
| Callers that omit `options.tenantId` | No | Seed scripts, boot-time installers, admin tooling |
| `ExecutionContext.isSystem === true` | No (auto-`bypassTenantAudit`) | Kernel-internal mirrors, scheduled hooks |
| Explicit `organization_id` on insert row | Wins | Admin tooling can target a specific tenant |
| `driver.raw()` / `engine.execute(sql)` | No | Raw SQL is on you |
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
// Use PostgreSQL-specific features
const results = await driver.raw(`
  SELECT * FROM objectstack_opportunity
  WHERE data @> '{"industry": "Technology"}'::jsonb
`);

// Full-text search
const results = await driver.raw(`
  SELECT * FROM objectstack_article
  WHERE to_tsvector('english', title || ' ' || body) @@ to_tsquery('objectstack')
`);
```

### MySQL Features

```typescript
// Use MySQL-specific features
const results = await driver.raw(`
  SELECT * FROM objectstack_product
  WHERE MATCH(name, description) AGAINST ('widget' IN NATURAL LANGUAGE MODE)
`);
```

## Connection Management

```typescript
// Get underlying Knex instance
const knex = driver.getKnex();

// Check connection
await driver.checkConnection();

// Close all connections
await driver.destroy();
```

## Performance Optimization

### Indexes

```typescript
// Create index migration
export async function up(knex) {
  await knex.schema.table('objectstack_opportunity', (table) => {
    table.index('account_id');
    table.index('stage');
    table.index(['created_at', 'stage']); // Composite index
  });
}
```

### Query Optimization

```typescript
// Use explain to analyze queries
const plan = await driver.raw('EXPLAIN ANALYZE SELECT ...');

// Create covering indexes for frequently accessed columns
// Use partial indexes for filtered queries (PostgreSQL)
await knex.raw(`
  CREATE INDEX idx_active_opportunities
  ON objectstack_opportunity(account_id, amount)
  WHERE stage NOT IN ('closed_won', 'closed_lost')
`);
```

## Best Practices

1. **Connection Pooling**: Configure appropriate pool size based on load
2. **Migrations**: Always use migrations for schema changes, never raw DDL
3. **Transactions**: Use transactions for multi-step operations
4. **Prepared Statements**: Use parameterized queries to prevent SQL injection
5. **Indexes**: Create indexes on frequently queried fields
6. **Monitoring**: Monitor slow query logs and connection pool metrics
7. **Backups**: Implement regular database backups

## Environment-Specific Configuration

```typescript
// config/database.ts
export const getDatabaseConfig = () => {
  const env = process.env.NODE_ENV || 'development';

  const configs = {
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
      connection: process.env.DATABASE_URL,
      pool: { min: 2, max: 10 },
      ssl: { rejectUnauthorized: false },
    },
  };

  return configs[env] || configs.development;
};

const stack = defineStack({
  driver: DriverSQL.configure(getDatabaseConfig()),
});
```

## Troubleshooting

### Connection Issues

```typescript
// Test database connection
try {
  await driver.checkConnection();
  console.log('Database connected successfully');
} catch (error) {
  console.error('Database connection failed:', error);
}
```

### Migration Errors

```bash
# Check migration status
npx knex migrate:status

# Rollback and re-run
npx knex migrate:rollback
npx knex migrate:latest
```

### Query Debugging

```typescript
// Enable query logging
const stack = defineStack({
  driver: DriverSQL.configure({
    client: 'pg',
    connection: { /* ... */ },
    debug: true, // Log all queries
  }),
});
```

## Deployment

### Heroku PostgreSQL

```bash
# Heroku automatically provides DATABASE_URL
heroku addons:create heroku-postgresql:hobby-dev

# Run migrations on deployment
echo "npx knex migrate:latest" > Procfile.release
```

### Railway PostgreSQL

```bash
# Use Railway's DATABASE_URL
railway up
```

### Vercel PostgreSQL

```typescript
// Vercel uses connection pooling
import { createClient } from '@vercel/postgres';

const stack = defineStack({
  driver: DriverSQL.configure({
    client: 'pg',
    connection: process.env.POSTGRES_URL,
  }),
});
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [Knex.js Documentation](https://knexjs.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [@objectstack/driver-turso](../driver-turso/) - Edge-first SQLite alternative (extends this driver)
- [@objectstack/driver-memory](../driver-memory/) - In-memory driver for testing
