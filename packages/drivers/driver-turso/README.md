# @objectstack/driver-turso

Turso/libSQL driver for ObjectStack — edge-first SQLite with embedded replicas and cloud-only remote mode.

## Architecture

`TursoDriver` implements a **dual-transport architecture**:

- **Local/Replica modes:** Extends `SqlDriver` from `@objectstack/driver-sql`. All CRUD, schema, filtering, aggregation, window functions, introspection, and transactions are **inherited** via Knex + better-sqlite3.
- **Remote mode:** Delegates all operations to `RemoteTransport` which uses `@libsql/client` SDK directly (HTTP/WebSocket). No local SQLite or Knex dependency needed.

```
TursoDriver extends SqlDriver (dual transport)
├── Transport: local/replica (via Knex + better-sqlite3)
│   ├── Inherited: find, findOne, create, update, delete, count, upsert
│   ├── Inherited: bulkCreate, bulkUpdate, bulkDelete, updateMany, deleteMany
│   ├── Inherited: syncSchema, dropTable, introspectSchema
│   ├── Inherited: aggregate, distinct, findWithWindowFunctions
│   ├── Inherited: beginTransaction, commit, rollback
│   └── Inherited: applyFilters (MongoDB-style + array-style)
├── Transport: remote (via @libsql/client)
│   ├── RemoteTransport: find, findOne, create, update, delete, count, upsert
│   ├── RemoteTransport: bulkCreate, bulkUpdate, bulkDelete, updateMany, deleteMany
│   ├── RemoteTransport: syncSchema, dropTable
│   ├── RemoteTransport: beginTransaction, commit, rollback
│   └── RemoteTransport: execute (raw SQL)
├── Override:  name, version, supports (Turso-specific capabilities)
├── Override:  connect / disconnect (transport-aware lifecycle)
├── Added:     transportMode ('local' | 'replica' | 'remote')
├── Added:     sync() — Embedded replica sync via @libsql/client
└── Added:     TursoDriverConfig (url, authToken, syncUrl, mode, client)
```

## Installation

```bash
pnpm add @objectstack/driver-turso
```

### Dependencies by Mode

The `driver-turso` package has different dependency requirements based on the connection mode:

| Mode | Required Dependencies | Notes |
|:---|:---|:---|
| **Remote** | `@libsql/client` only | ✅ Vercel/Edge compatible — no native dependencies |
| **Local** | `@libsql/client` + `better-sqlite3` | Requires `better-sqlite3` for local SQLite access |
| **Replica** | `@libsql/client` + `better-sqlite3` | Requires `better-sqlite3` for local SQLite + sync |

**For Vercel/Edge deployments (remote mode only):**
```bash
pnpm add @objectstack/driver-turso
# better-sqlite3 is NOT required
```

**For local/replica modes:**
```bash
pnpm add @objectstack/driver-turso better-sqlite3
```

The `better-sqlite3` package is an **optional peer dependency**. If you're only using remote mode (e.g., on Vercel), you don't need to install it. npm/pnpm will show a warning that can be safely ignored.

## Connection Modes

### Local File (Embedded SQLite)

```typescript
import { TursoDriver } from '@objectstack/driver-turso';

const driver = new TursoDriver({
  url: 'file:./data/app.db',
});
await driver.connect();
```

### In-Memory (Testing)

```typescript
const driver = new TursoDriver({
  url: ':memory:',
});
await driver.connect();
```

### Embedded Replica (Hybrid)

Local SQLite file + automatic sync from Turso cloud:

```typescript
const driver = new TursoDriver({
  url: 'file:./data/replica.db',
  syncUrl: 'libsql://my-db-orgname.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  sync: {
    intervalSeconds: 60, // sync every 60 seconds
    onConnect: true,     // sync on initial connect
  },
});
await driver.connect();

// Manual sync
await driver.sync();
```

### Remote (Cloud-Only)

Pure remote queries via `@libsql/client` — no local SQLite needed.
Ideal for Vercel, Cloudflare Workers, and other serverless/edge runtimes:

```typescript
const driver = new TursoDriver({
  url: 'libsql://my-db-orgname.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await driver.connect();

// All CRUD operations work the same as local mode
const users = await driver.find('users', { where: { active: true } });
```

### Auto-Detection

Transport mode is automatically detected from the URL:

| URL Pattern | Mode | Engine |
|:---|:---|:---|
| `file:./data/app.db` | `local` | Knex + better-sqlite3 |
| `:memory:` | `local` | Knex + better-sqlite3 |
| `file:...` + `syncUrl` | `replica` | Knex + @libsql/client sync |
| `libsql://...` | `remote` | @libsql/client only |
| `https://...` | `remote` | @libsql/client only |

You can also force a specific mode:

```typescript
const driver = new TursoDriver({
  url: 'libsql://my-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  mode: 'remote', // Force remote mode
});
```

### Custom Client

Pass a pre-configured `@libsql/client` instance for advanced use cases
(custom caching, connection pooling, testing):

```typescript
import { createClient } from '@libsql/client';

const client = createClient({
  url: 'libsql://my-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const driver = new TursoDriver({
  url: 'libsql://my-db.turso.io',
  client, // Inject pre-configured client
});
await driver.connect();
```

## Multi-Tenant Routing

**Not shipped by this package.** Database-per-tenant routing on top of
`TursoDriver` is a cloud product capability and lives in the closed
`objectstack-ai/cloud` repository (objectstack#4645 decision 2). This package
ships the driver; a router that maps a tenant to a `TursoDriver` instance is
layered above it and is not part of the open Apache-2.0 surface.

## Configuration

```typescript
interface TursoDriverConfig {
  /**
   * Database URL.
   * - file:./data/local.db → local mode
   * - :memory: → local mode (ephemeral)
   * - libsql://my-db.turso.io → remote mode
   * - https://my-db.turso.io → remote mode
   */
  url: string;

  /** JWT auth token for the remote Turso database */
  authToken?: string;

  /**
   * AES-256 encryption key for local database file.
   * Only effective in local/replica modes.
   */
  encryptionKey?: string;

  /**
   * Maximum concurrent requests to the remote database.
   * Effective in replica and remote modes.
   * Default: 20
   */
  concurrency?: number;

  /** Remote sync URL for embedded replica mode (libsql:// or https://) */
  syncUrl?: string;

  /** Sync configuration (requires syncUrl) */
  sync?: {
    intervalSeconds?: number; // Default: 60
    onConnect?: boolean;      // Default: true
  };

  /**
   * Operation timeout in milliseconds for remote operations.
   * Effective in replica and remote modes.
   */
  timeout?: number;

  /**
   * Force a specific transport mode.
   * If not set, mode is auto-detected from the URL.
   */
  mode?: 'local' | 'replica' | 'remote';

  /**
   * Pre-configured @libsql/client instance.
   * Useful for custom caching, connection pooling, or testing.
   */
  client?: Client;
}
```

## Capabilities

TursoDriver declares enhanced capabilities beyond the base SqlDriver:

| Capability | SqlDriver | TursoDriver (local) | TursoDriver (remote) |
|:---|:---:|:---:|:---:|
| FTS5 Full-Text Search | ❌ | ✅ | ✅ |
| JSON1 Query | ❌ | ✅ | ✅ |
| Common Table Expressions | ❌ | ✅ | ✅ |
| Savepoints | ❌ | ✅ | ✅ |
| Indexes | ❌ | ✅ | ✅ |
| Connection Pooling | ✅ | ❌ (concurrency limits) | ❌ |
| Embedded Replica Sync | — | ✅ | — |
| Serverless/Edge | — | — | ✅ |

## Plugin Registration

```typescript
import tursoPlugin from '@objectstack/driver-turso';

// Via plugin system
await kernel.enablePlugin(tursoPlugin, {
  url: 'file:./data/app.db',
});
```

## Testing

```bash
pnpm test        # Run all tests
```

Tests run against in-memory SQLite (`:memory:`) — no external services required.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
