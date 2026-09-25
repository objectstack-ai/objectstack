# @objectstack/driver-turso

Turso/libSQL driver for ObjectStack — edge-first SQLite with embedded replicas and cloud-only remote mode.

## Architecture

`TursoDriver` implements a **dual-transport architecture**:

- **Local/Replica modes:** Extends `SqlDriver` from `@objectstack/driver-sql`. All CRUD, schema, filtering, aggregation, window functions, introspection, and transactions are **inherited** via Knex + better-sqlite3.
- **Remote mode:** Sends CRUD, bulk writes, `aggregate`, raw `execute`, schema sync and `dropTable` to `RemoteTransport`, which uses the `@libsql/client` SDK directly (HTTP/WebSocket). Transactions and the other calls listed under [What remote mode refuses](#what-remote-mode-refuses) are refused instead.

```
TursoDriver extends SqlDriver (dual transport)
├── Transport: local/replica (via Knex + better-sqlite3)
│   ├── Inherited: find, findOne, create, update, delete, count, upsert
│   ├── Inherited: bulkCreate, bulkUpdate, bulkDelete, updateMany, deleteMany
│   ├── Inherited: syncSchema, dropTable, introspectSchema
│   ├── Inherited: aggregate, distinct, findWithWindowFunctions
│   ├── Inherited: beginTransaction, commit, rollback
│   └── Inherited: applyFilters (MongoDB-style)
├── Transport: remote (via @libsql/client)
│   ├── RemoteTransport: find, findOne, create, update, delete, count, upsert
│   ├── RemoteTransport: bulkCreate, bulkUpdate, bulkDelete, updateMany, deleteMany
│   ├── RemoteTransport: syncSchema, dropTable
│   ├── RemoteTransport: execute (raw SQL)
│   └── Refused, NOT_IMPLEMENTED / 501: beginTransaction, commit, rollback,
│       setDeferredDdl(true), detectManagedDrift, planMediaColumnMove
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

// The CRUD methods are the same as in local mode; some calls are refused (below)
const users = await driver.find('users', { where: { active: true } });
```

#### What remote mode refuses

Each call below is refused in remote mode with `code: 'NOT_IMPLEMENTED'` and
`status: 501`: the call is valid, and the remote transport does not have the
capability. The check runs before the call reads or writes anything.

| Operation | Refused call | Use instead |
|:---|:---|:---|
| Transactions | `beginTransaction()`, `commit()`, `rollback()`, and `options.transaction` passed to any `RemoteTransport` method in the tree above, to `aggregate()` or to `syncSchemasBatch()` | The local or embedded-replica transport, which run Knex transactions and honour `options.transaction` |
| Record numbers | `create()`, `bulkCreate()`, and an `upsert()` with no `id`, `_id` or `conflictKeys`, when a row leaves an `autonumber` field empty (`undefined`, `null` or `''`) | The local or embedded-replica transport, which generate record numbers, or a value you supply, which is written unchanged |
| Deferring schema DDL | `setDeferredDdl(true)`, which `os migrate plan` calls. `setDeferredDdl(false)` is accepted | Run the command against a local SQLite copy of the database (a `file:` URL) |
| Schema drift detection | `detectManagedDrift()` | `os migrate plan` against a local SQLite copy of the database (a `file:` URL) |
| Planning the ADR-0104 media column move | `planMediaColumnMove()`, the column step of `os migrate files-to-references` | The local or embedded-replica transport, which plan it |

- **Transactions.** Remote mode declares `supports.transactionsUnsupported: true`.
  When the remote driver is the engine's default datasource, `engine.transaction()`
  reads that and does not call `beginTransaction()`: it runs the callback with
  no transaction and logs a warning once per datasource, or, called with
  `require: true`, throws `TransactionUnsupportedError` before the callback runs.
- **Record numbers.** Remote mode never generates one. The check uses the
  `autonumber` fields this driver recorded when it synced the object's schema
  (`syncSchema`, `syncSchemasBatch` or `initObjects`). An `upsert()` that
  carries an `id`, `_id` or `conflictKeys` is not refused, because it may merge
  into an existing row. If it inserts instead, the row is written with the field
  empty and the driver logs a warning naming the row.
- **Aggregation.** `aggregate()` called on the driver directly also refuses,
  with the same code, a `groupBy` entry that has a `dateGranularity`, and an
  `aggregations` entry with a non-empty `filter`. `engine.aggregate()` never
  sends either one to this driver: it fetches the rows and computes both in
  memory. The local transport also refuses a per-aggregation `filter`.

### Auto-Detection

Transport mode is automatically detected from the URL:

| URL Pattern | Mode | Engine |
|:---|:---|:---|
| `file:./data/app.db` | `local` | Knex + better-sqlite3 |
| `:memory:` | `local` | Knex + better-sqlite3 |
| `file:...` + `syncUrl` | `replica` | Knex + @libsql/client sync |
| `libsql://...` | `remote` | @libsql/client only |
| `https://...` | `remote` | @libsql/client only |

`http://`, `wss://` and `ws://` are remote too. A scheme matches in any letter
case, as it does in `@libsql/client`: `LIBSQL://...` is remote and `FILE:...` is
a local file. A path to a local database file needs the `file:` prefix. A bare
path such as `./data/app.db` is not a url, and `@libsql/client` refuses it too.

An embedded replica is a local **file** kept in sync with a remote. The local and
replica modes run every read and write through the local SQLite engine, which
can open only a `file:` url or `:memory:`, and a replica needs a file for the
sync to land in. The constructor therefore refuses (`VALIDATION_ERROR` / 400):

- in a local or replica mode (auto-detected, with or without `syncUrl`, or
  forced), a `url` that is none of `file:`, `:memory:` or a remote url, such as
  a bare path or an unsupported scheme. The fix for a local database file is
  `url: 'file:./data/app.db'`;
- a remote url (`libsql://`, `https://`, `http://`, `wss://`, `ws://`, in any
  letter case) beside `syncUrl`, or under a forced `mode: 'local'` / `'replica'`;
- a replica on an in-memory url (`:memory:`, `file::memory:`). That covers a
  replica auto-detected from a `:memory:` or `file:` url beside `syncUrl`, and
  one forced with `mode: 'replica'`.

In each case the engine would otherwise run on a private in-memory database
whose writes read back and then vanish on restart, and `@libsql/client` builds
no embedded replica for a remote url anyway. For a remote database, drop
`syncUrl` and any forced `mode`. For an embedded replica, use
`url: 'file:./data/replica.db'` beside `syncUrl`. A forced `mode: 'remote'` runs
no local engine, so its url is not judged here: `@libsql/client` refuses a
url it cannot open when the driver connects.

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

In **remote** mode a pre-configured client may not be combined with a non-zero
`timeout`: the driver installs that window as the `fetch` it hands
`@libsql/client` while creating the client, so it has no way to apply it to one
you built yourself, and the constructor refuses the pair
(`VALIDATION_ERROR` / 400) instead of accepting a bound it cannot deliver. Build
the bound into your own client if you need both:

```typescript
const client = createClient({
  url: 'libsql://my-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
});
```

Replica mode is unaffected — `sync()`, the one remote operation on that arm, is
bounded by `timeout` whatever client is in use.

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
   * Schemes match in any letter case. In a local or replica mode any other
   * url (a bare path, an unsupported scheme) is refused at construction
   * (VALIDATION_ERROR / 400): spell a local file as file:./data/app.db.
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

  /** Remote sync URL for embedded replica mode (libsql:// or https://); the replica is the local file: named by `url` */
  syncUrl?: string;

  /** Sync configuration (requires syncUrl) */
  sync?: {
    intervalSeconds?: number; // Default: 60
    onConnect?: boolean;      // Default: true
  };

  /**
   * Operation timeout in milliseconds for remote operations.
   * Effective in replica and remote modes; 0 or unset = no bound.
   * - Remote mode over HTTP (libsql:// / https:// / http://): every request the
   *   client makes is aborted once the window elapses, and the operation fails
   *   as TIMEOUT / 504 instead of hanging — when THIS driver creates the
   *   client. Two remote compositions cannot carry the window, and both are
   *   REFUSED at construction (VALIDATION_ERROR / 400) rather than accepted and
   *   never delivered:
   *   - a wss:// or ws:// URL, which uses the WebSocket transport and has no
   *     such seam: drop the key, or use a libsql:// / https:// URL;
   *   - a pre-configured `client`, which arrives with its transport already
   *     built: drop `client`, or drop `timeout` and build the bound into that
   *     client yourself.
   * - Replica mode: bounds sync(), the one remote operation on that arm. A
   *   sync still running when the window closes rejects with the same
   *   envelope; the native binding's own sync is not cancelled, only no longer
   *   awaited.
   * Not the libSQL busy timeout (`Config.timeout`), which is a local-file
   * lock-contention setting that remote clients ignore.
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
   * In REMOTE mode it may not be combined with a non-zero `timeout` — the
   * constructor refuses that pair (VALIDATION_ERROR / 400), because the window
   * is installed while creating the client and a client the driver did not
   * create cannot carry it. Replica mode is unaffected: sync() is bounded
   * whatever client is in use.
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
