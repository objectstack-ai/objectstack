# @objectstack/driver-sqlite-wasm

SQLite-on-WASM driver for ObjectStack. Runs the same `SqlDriver` codepath as
`@objectstack/driver-sqlite` but swaps the native `better-sqlite3` N-API binding
for [`sql.js`](https://sql.js.org) (SQLite compiled to WebAssembly), so it works
in environments where native modules are unavailable — most notably
**StackBlitz WebContainer** (Node-in-browser).

- **Plugin ID:** `com.objectstack.driver.sqlite-wasm`
- **Strategy:** subclass `SqlDriver` + custom Knex dialect; no fork of upstream logic.
- **Persistence:** sql.js `db.export()` bytes → Node `fs` (`node:fs/promises`).

## When to use

| Driver | Backend | Runs in WebContainer | Native binary |
|---|---|---|---|
| `@objectstack/driver-sqlite` | `better-sqlite3` | ❌ | yes |
| **`@objectstack/driver-sqlite-wasm`** | `sql.js` (WASM) | ✅ | no |
| `@objectstack/driver-postgres` | `pg` | ✅ (with TCP) | no |

Pick the WASM driver when you need a zero-binary SQLite that boots in the
browser sandbox, in serverless edge runtimes that expose Node `fs`, or in
CI environments where building `better-sqlite3` against the host Node is
painful. For production servers, prefer the native driver.

## Install

```bash
pnpm add @objectstack/driver-sqlite-wasm
```

## Quick start

```ts
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

const driver = new SqliteWasmDriver({
  filename: './data/app.db',
  persist: 'on-disconnect', // default
});

await driver.connect();

await driver.create('users', { name: 'Alice', age: 30 });
const rows = await driver.find('users', { where: { age: { $gt: 18 } } });

await driver.disconnect(); // flushes pending writes to disk
```

Use `:memory:` (or any `:...` filename) for an ephemeral database that lives
only for the process.

## Persistence modes

sql.js holds the entire database in memory; mutations only reach disk when the
driver calls `db.export()` and writes the resulting bytes. Pick the strategy
that matches your write pattern:

| `persist` | Behavior | Use when |
|---|---|---|
| `'on-disconnect'` *(default)* | Flush once at `disconnect()` (and on `process.beforeExit`). | Batch jobs, short-lived processes, write-heavy migrations. |
| `'on-write'` | Flush after every mutation. | Safest. Few writes per second. |
| `` `debounced:${ms}` `` | Flush at most once per N ms after the last write. | Bursty writes; balance durability vs throughput. |

Call `await driver.flush()` at any time to force a synchronous flush.

In environments without `node:fs/promises` (pure browser), the driver logs a
warning and falls back to in-memory only — data is not persisted across reloads.

## Architecture

```
SqlDriver  ──► Knex  ──► Client_WasmSqlite  ──► WasmSqliteConnection  ──► sql.js  ──► fs
(unchanged)                  (custom dialect)         (sqlite-wasm-driver/src)
```

- `Client_WasmSqlite` extends Knex's upstream `Client_SQLite3`, so the SQLite
  query compiler, schema builder, and column compiler are reused as-is. Only
  `_driver`, `acquireRawConnection`, `destroyRawConnection`, and `_query` are
  overridden.
- `WasmSqliteConnection` wraps `sql.js`'s `Database` with the
  `prepare/exec/run/close` subset Knex needs, plus persistence orchestration.
- `SqliteWasmDriver` is a thin `SqlDriver` subclass that forces `isSqlite` to
  `true` (the base class string-matches `config.client`; we pass a class) and
  wires `process.beforeExit` to a best-effort flush.

## Pool

sql.js is single-threaded; the dialect defaults to `{ min: 1, max: 1 }`. Don't
raise `max` — concurrent access would corrupt the in-memory database handle.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
