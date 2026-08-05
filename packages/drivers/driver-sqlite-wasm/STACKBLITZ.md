# Running `@objectstack/driver-sqlite-wasm` in StackBlitz / WebContainers

`@objectstack/driver-sqlite-wasm` is the only first-party SQL driver that runs
inside [WebContainers](https://webcontainers.io/) (StackBlitz, Bolt, etc.). The
default SQLite driver (`@objectstack/driver-sql` with `better-sqlite3`) ships a
native `*.node` binary that the WebContainer runtime cannot load.

This document is the recipe for running an ObjectStack project entirely in
the browser.

## Why it works in WebContainers

- **Pure JS + WASM** — backed by [`sql.js`](https://github.com/sql-js/sql.js),
  a [SQLite](https://sqlite.org/) build compiled to WebAssembly. No native
  bindings, no `node-gyp`, no postinstall scripts.
- **Single dependency** — only `sql.js` is required at runtime; everything
  else (Knex dialect glue, persistence) is bundled in this package.
- **Reuses the upstream SQLite Knex dialect** — query compiler, schema
  builder and column types are inherited from
  `knex/lib/dialects/sqlite3`, so behaviour matches the production
  better-sqlite3 driver.

## Install

```bash
pnpm add @objectstack/driver-sqlite-wasm sql.js
# or
npm install @objectstack/driver-sqlite-wasm sql.js
```

`sql.js` is declared as a peer dependency so applications can pin the WASM
version themselves.

## Minimal config (`objectstack.config.ts`)

```ts
import { defineStack } from '@objectstack/spec';
import { DriverPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

export default defineStack({
  plugins: [
    new DriverPlugin(
      new SqliteWasmDriver({
        // ":memory:" for ephemeral; any path for on-disk persistence.
        filename: '.objectstack/data/app.wasm.db',
        // 'on-write' flushes after every mutation — safest in WebContainers
        // because the runtime can be torn down at any moment.
        persist: 'on-write',
      }),
    ),
  ],
});
```

### Auto-detection from CLI

The standalone stack (used by `objectstack serve` when no
`objectstack.config.ts` is present) auto-selects `SqliteWasmDriver` for any of:

- `OS_DATABASE_URL=wasm-sqlite:///path/to/file.db`
- `OS_DATABASE_URL=/path/to/file.wasm.db` (any URL ending in `.wasm.db`)
- `OS_DATABASE_DRIVER=sqlite-wasm` (explicit override)

See `packages/runtime/src/standalone-stack.ts` for the detection table.

## Locating the WASM binary

`sql.js` loads `sql-wasm.wasm` at runtime via a `locateFile(name)` callback.
On Node and inside WebContainers the package's `dist/` directory contains the
binary; resolve it via the package's main entry (its `exports` map does not
expose `package.json`):

```ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sqlJsDir = dirname(require.resolve('sql.js'));   // .../sql.js/dist
const locateFile = (name: string) => join(sqlJsDir, name);

new SqliteWasmDriver({ filename: ':memory:', locateFile });
```

If `locateFile` is omitted the driver attempts the same resolution
automatically — it only needs to be passed explicitly when bundling for the
browser or when `sql.js` is hoisted to an unusual location.

## Persistence modes

Set via the `persist` constructor option on `SqliteWasmDriver`.

| Mode | Behaviour | When to use |
|------|-----------|-------------|
| `'on-disconnect'` *(default)* | Flushes once when `disconnect()` is called. | Unit tests; long-running processes that exit gracefully. |
| `'on-write'` | Flushes after every mutation (`insert`/`update`/`del`/DDL). | **WebContainers, demos, anything where the process may be killed unexpectedly.** Safest, with the highest write amplification. |
| `'debounced:<ms>'` | Flushes `<ms>` after the last mutation (default 250ms when no number given). | Batch-heavy workloads where `on-write` would I/O-thrash. |

In all modes `await driver.flush()` forces an immediate write.

## Verified round-trip

`scripts/restart-proof.mjs` in this package writes a row through
`SqliteWasmDriver`, closes the driver, then re-opens the on-disk file in a
**fresh `sql.js` instance** (and a **fresh process** when run as
`node scripts/restart-proof.mjs read`) to confirm the bytes survived a
process boundary. Use it as a sanity check after upgrading `sql.js`.

```bash
# write + read in one process
node scripts/restart-proof.mjs

# cross-process: run write, then read in a fresh node invocation
node scripts/restart-proof.mjs write
node scripts/restart-proof.mjs read
```

## Limitations

- **Single connection.** `sql.js` is single-threaded WASM; the Knex pool is
  fixed to `{ min: 1, max: 1 }`. Concurrent transactions serialise.
- **Whole-file flush.** Every flush re-serialises the entire database via
  `db.export()` and writes the bytes atomically. Fine for SaaS-style
  workloads (KB–MB), expensive for multi-GB datasets.
- **No `RETURNING` for the WASM driver beyond what upstream SQLite supports.**
  Knex's standard `.returning()` semantics for SQLite apply.
- **No filesystem in pure-browser builds.** When `node:fs/promises` is
  unavailable the driver falls back to an in-memory database and logs a
  warning — explicit, never silent data loss.

## Troubleshooting

- **`Dynamic require of "knex/lib/dialects/sqlite3" is not supported`** —
  a downstream bundler (tsup/esbuild) collapsed our lazy `createRequire`
  chain. Add the following to that bundler's `external` list:

  ```ts
  external: [/^@objectstack\//, 'sql.js', 'knex', 'better-sqlite3']
  ```

  The CLI's `BUNDLE_REQUIRE_EXTERNALS` (`packages/cli/src/utils/config.ts`)
  already includes these.

- **`ERR_PACKAGE_PATH_NOT_EXPORTED` on `sql.js/package.json`** — `sql.js`
  v1.14+ does not expose `package.json` in its `exports` map. Resolve
  `require.resolve('sql.js')` and `dirname()` it instead.
