// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Custom Knex SQLite dialect backed by sql.js (WASM SQLite).
 *
 * Mimics the surface that `Client_BetterSQLite3` presents to Knex so the
 * upstream SQLite3 dialect's query compiler, schema builder, and column
 * compiler all keep working unchanged. Only the transport layer —
 * `_driver` / `acquireRawConnection` / `_query` — is swapped out.
 *
 * ## Why the dialect class is built lazily
 *
 * The class `Client_WasmSqlite extends Client_SQLite3` needs the upstream
 * SQLite3 dialect at class-definition time. Resolving it at module
 * top-level breaks when this file is re-bundled by another tsup/esbuild
 * pass (e.g. `packages/runtime`), because that pass rewrites our runtime
 * `createRequire(import.meta.url)` chain back into a static `__require2`
 * Proxy stub that throws `Dynamic require of "X" is not supported`.
 *
 * Building the class inside a lazy factory (`getClient_WasmSqlite()`)
 * keeps the `require` call out of module-init code, so the re-bundler
 * cannot intercept it.
 */

import { createRequire } from 'node:module';

import type { SqlJsStatic } from 'sql.js';

import {
  WasmSqliteConnection,
  type PersistMode,
  type WasmConnectionOptions,
} from './wasm-connection.js';

// Built lazily — `node:module` is a Node builtin and is left untouched
// by esbuild/tsup, so the `createRequire` import survives downstream
// re-bundling. We defer the actual `createRequire(...)` call so that the
// CJS build (where `import.meta.url` is empty) doesn't blow up at module
// init; the CJS path uses `globalThis.require` directly anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedEsmRequire: any = null;
function getEsmRequire(): any {
  if (cachedEsmRequire) return cachedEsmRequire;
  // `import.meta.url` is replaced with an empty string in CJS output;
  // fall back to the current file/cwd in that case.
  const anchor =
    typeof import.meta !== 'undefined' && (import.meta as any).url
      ? (import.meta as any).url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  cachedEsmRequire = createRequire(anchor);
  return cachedEsmRequire;
}

/** Connection settings recognised by the WASM SQLite dialect. */
export interface WasmSqliteConnectionSettings {
  filename: string;
  persist?: PersistMode;
  sqlJs?: SqlJsStatic;
  locateFile?: (file: string) => string;
  logger?: WasmConnectionOptions['logger'];
}

/**
 * Coerce JS values that sql.js cannot bind directly. Mirrors
 * `Client_BetterSQLite3._formatBindings`.
 *
 * `undefined` is mapped to `null`: sql.js's binder only accepts
 * string/number/bigint/boolean/null (and array/blob) and `throw`s a *raw
 * string* — `"Wrong API use : tried to bind a value of an unknown type
 * (undefined)."` — for anything else. Because it throws a string rather than
 * an `Error`, it logs as a garbled char-indexed object and aborts the whole
 * write. Mapping to `null` matches the `useNullAsDefault` semantics the
 * dialect is configured with, so a missing/undefined value persists as SQL
 * `NULL` exactly as it would through better-sqlite3.
 */
function formatBindings(bindings: unknown[] | undefined): unknown[] {
  if (!bindings) return [];
  return bindings.map((b) => {
    if (b === undefined) return null;
    if (b instanceof Date) return b.valueOf();
    if (typeof b === 'boolean') return Number(b);
    return b;
  });
}

/**
 * Mirrors the dispatch in upstream `Client_SQLite3._query`: only
 * `insert/update/counter/del` go through the row-less write path (and even
 * those switch to the read path when a `RETURNING` clause is requested).
 * Everything else — `select`, `first`, `pluck`, `columnInfo`, raw PRAGMA,
 * DDL with no `method` — is read with `all`/row iteration so Knex sees the
 * same response shape it would from better-sqlite3.
 */
function isReadMethod(method?: string, returning?: unknown): boolean {
  if (method === 'insert' || method === 'update') return !!returning ? true : false;
  if (method === 'counter' || method === 'del') return false;
  return true;
}

/**
 * Resolve the upstream `knex/lib/dialects/sqlite3` class at runtime.
 *
 * Tries every escape hatch we have so that this works in:
 *   - Plain Node ESM (use `createRequire(import.meta.url)`).
 *   - Plain Node CJS (use the ambient `require` on `globalThis`).
 *   - Re-bundled ESM where esbuild/tsup has stubbed `__require` — we
 *     fall back to `new Function('return require')()` which evades static
 *     analysis and grabs the real Node `require` at runtime.
 *
 * Wrapped in a function so the bundler cannot execute it at module init.
 */
function resolveKnexSqlite3Dialect(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.require === 'function') {
    try {
      return g.require('knex/lib/dialects/sqlite3');
    } catch {
      /* fall through */
    }
  }
  // ESM-safe path: `createRequire` was imported statically at the top of
  // this module from `node:module`. In a pure-ESM process there is no
  // ambient `require`, so this is the only reliable way to load a CJS
  // package like `knex/lib/dialects/sqlite3`.
  return getEsmRequire()('knex/lib/dialects/sqlite3');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedDialect: any = null;

/**
 * Build (and cache) the `Client_WasmSqlite` class. Building lazily keeps
 * the `require('knex/lib/dialects/sqlite3')` call out of module-init
 * code so downstream re-bundlers (e.g. `packages/runtime`) cannot collapse
 * it into a Dynamic-require stub.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getClient_WasmSqlite(): any {
  if (cachedDialect) return cachedDialect;
  const Client_SQLite3 = resolveKnexSqlite3Dialect();

  class Client_WasmSqlite extends Client_SQLite3 {
    // sql.js has no shared "driver module" the way better-sqlite3 does. Knex
    // only uses `this.driver` to construct connections, and we override
    // `acquireRawConnection`, so a sentinel object is enough.
    _driver(): { name: 'sql.js' } {
      return { name: 'sql.js' };
    }

    async acquireRawConnection(): Promise<WasmSqliteConnection> {
      const settings = (this as any)
        .connectionSettings as WasmSqliteConnectionSettings;

      const conn = new WasmSqliteConnection({
        filename: settings.filename,
        persist: settings.persist,
        sqlJs: settings.sqlJs,
        locateFile: settings.locateFile,
        logger: settings.logger,
      });
      await conn.open(settings.sqlJs, settings.locateFile);
      return conn;
    }

    async destroyRawConnection(connection: WasmSqliteConnection): Promise<void> {
      await connection.close();
    }

    async _query(
      connection: WasmSqliteConnection,
      obj: any,
    ): Promise<any> {
      if (!obj.sql) throw new Error('The query is empty');
      if (!connection) throw new Error('No connection provided');

      const db = connection.raw;
      const bindings = formatBindings(obj.bindings);

      // DDL / transactional control statements have no Knex `method`. sql.js's
      // `prepare`+`step` silently no-ops on many of these (e.g. CREATE TABLE),
      // so route them through `run` which is implemented via `exec` and
      // actually mutates the database. PRAGMA is intentionally excluded — many
      // PRAGMA forms (e.g. `PRAGMA table_info(...)`, `foreign_key_list(...)`)
      // return rows used by Knex's schema introspection/columnInfo, and
      // `db.run` discards those rows.
      const isDdl =
        /^\s*(CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|REINDEX|VACUUM|ATTACH|DETACH|TRUNCATE)\b/i.test(
          obj.sql,
        );
      if (isDdl) {
        db.run(obj.sql, bindings as any);
        obj.response = [];
        // Transaction-control statements are routed through
        // `noteTransactionControl`, which owns flushing for the transaction
        // lifecycle: it suppresses flushes while a transaction is open (sql.js
        // `export()` closes+reopens the db, which would abort the txn) and
        // performs a single flush once the transaction fully closes. Routing
        // them away from `markDirty` avoids a second, racing flush on COMMIT.
        if (/^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(obj.sql)) {
          connection.noteTransactionControl(obj.sql);
        } else {
          connection.markDirty('run');
        }
        return obj;
      }

      if (isReadMethod(obj.method, obj.returning) || /^\s*PRAGMA\b/i.test(obj.sql)) {
        const stmt = db.prepare(obj.sql);
        try {
          if (bindings.length) stmt.bind(bindings as any);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          obj.response = rows;
        } finally {
          stmt.free();
        }
        return obj;
      }

      // Write path: execute via `run` (no row iteration needed) and capture
      // SQLite's per-connection lastID / changes counters.
      db.run(obj.sql, bindings as any);
      const changes = db.getRowsModified();
      let lastID: number | bigint = 0;
      if (obj.method === 'insert') {
        const r = db.exec('SELECT last_insert_rowid() AS id');
        lastID = (r?.[0]?.values?.[0]?.[0] as number) ?? 0;
      }
      obj.response = [];
      obj.context = { lastID, changes };
      connection.markDirty(obj.method);
      return obj;
    }
  }

  Object.assign(Client_WasmSqlite.prototype, {
    dialect: 'sqlite3',
    driverName: 'wasm-sqlite',
  });

  cachedDialect = Client_WasmSqlite;
  return Client_WasmSqlite;
}

/**
 * Back-compat re-export. Prefer `getClient_WasmSqlite()` so the dialect
 * is resolved lazily; the named export triggers the factory on first
 * access of any static property.
 *
 * Note: importing this binding will execute the factory at import time
 * in some bundlers, which defeats the lazy pattern. New code should call
 * `getClient_WasmSqlite()` directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Client_WasmSqlite: any = new Proxy(function () {} as any, {
  get(_t, prop) {
    return (getClient_WasmSqlite() as any)[prop];
  },
  construct(_t, args) {
    const Klass = getClient_WasmSqlite();
    return new Klass(...args);
  },
  apply(_t, thisArg, args) {
    const Klass = getClient_WasmSqlite();
    return Reflect.apply(Klass, thisArg, args);
  },
});

export default Client_WasmSqlite;
