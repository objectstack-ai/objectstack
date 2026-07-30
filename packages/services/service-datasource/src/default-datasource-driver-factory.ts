// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Default (dev/self-host) implementation of {@link IDatasourceDriverFactory}.
 *
 * The framework ships no universal "driver-by-id" registry — concrete drivers
 * are constructed by the host stack (ADR-0015 Addendum §3.5). This factory is
 * the host-side glue that lets the runtime-datasource lifecycle
 * (`IDatasourceAdminService`) build a live driver from an *unsaved* draft so it
 * can probe a connection before "Save" and hot-register a pool afterwards.
 *
 * Supported driver ids map onto the same open-core drivers the standalone
 * stack auto-detects:
 *   - `postgres` / `pg` / `postgresql` → `@objectstack/driver-sql` (client `pg`)
 *   - `sqlite` / `sqlite3`             → `@objectstack/driver-sql` (better-sqlite3)
 *   - `sqlite-wasm` / `wasm-sqlite`    → `@objectstack/driver-sqlite-wasm` (pure-JS)
 *   - `mysql` / `mysql2`               → `@objectstack/driver-sql` (client `mysql2`)
 *   - `mongodb` / `mongo`             → `@objectstack/driver-mongodb` (peer dep)
 *   - `memory` / `inmemory`           → `@objectstack/driver-memory` (ephemeral,
 *     per-datasource — see {@link buildMemoryConfig})
 *
 * `sqlite-wasm` joined for ADR-0062 D1 (#3826): the standalone stack's
 * `default` datasource is a *declared definition* connected through the shared
 * `DatasourceConnectionService`, and its CI-safe wasm default must therefore be
 * a driver id this factory can build — the last bespoke construction site.
 *
 * Anything else returns `supports() === false`, so the admin service degrades
 * gracefully (testConnection → `{ ok: false }`, create skips hot pool reg).
 *
 * SECURITY: the cleartext `spec.secret` is used only to open the connection and
 * is never persisted or logged here.
 */

import { join } from 'node:path';
import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
} from './contracts/index.js';

type ResolvedKind = 'postgres' | 'sqlite' | 'sqlite-wasm' | 'mysql' | 'mongodb' | 'memory';

const DRIVER_ID_ALIASES: Record<string, ResolvedKind> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  pg: 'postgres',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  'better-sqlite3': 'sqlite',
  'sqlite-wasm': 'sqlite-wasm',
  'wasm-sqlite': 'sqlite-wasm',
  mysql: 'mysql',
  mysql2: 'mysql',
  mongodb: 'mongodb',
  mongo: 'mongodb',
  memory: 'memory',
  inmemory: 'memory',
  'in-memory': 'memory',
};

function resolveKind(driverId: string): ResolvedKind | undefined {
  return DRIVER_ID_ALIASES[String(driverId ?? '').toLowerCase()];
}

/**
 * Wrap a concrete engine driver in a probe handle. `ping`/`checkHealth` reuse
 * the driver's own health check; `driver` is the escape hatch the admin service
 * hands to `registerDriver()`.
 */
function toHandle(driver: any, serverVersion?: () => Promise<string | undefined>): DatasourceDriverHandle {
  return {
    connect: typeof driver?.connect === 'function' ? () => driver.connect() : undefined,
    disconnect: typeof driver?.disconnect === 'function' ? () => driver.disconnect() : undefined,
    checkHealth: typeof driver?.checkHealth === 'function' ? () => driver.checkHealth() : undefined,
    ping: typeof driver?.checkHealth === 'function' ? () => driver.checkHealth() : undefined,
    ...(serverVersion ? { serverVersion } : {}),
    driver,
  };
}

/** Build the Knex `connection` for a SQL driver from a spec's config + secret. */
function buildSqlConnection(spec: DatasourceConnectionSpec, client: 'pg' | 'better-sqlite3'): unknown {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;

  if (client === 'better-sqlite3') {
    const filename =
      (cfg.filename as string | undefined) ??
      (cfg.file as string | undefined) ??
      (cfg.database as string | undefined) ??
      ':memory:';
    return { filename };
  }

  // pg — accept either a connection string (`url`/`connectionString`) or
  // discrete fields. The secret is the password and is never part of `config`.
  const url = (cfg.url as string | undefined) ?? (cfg.connectionString as string | undefined);
  if (url) {
    // For a DSN, a separately-supplied secret overrides the embedded password.
    return spec.secret ? { connectionString: url, password: spec.secret } : { connectionString: url };
  }
  return {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user ?? cfg.username,
    ...(spec.secret ? { password: spec.secret } : cfg.password ? { password: cfg.password } : {}),
    ...(cfg.ssl != null ? { ssl: cfg.ssl } : {}),
  };
}

/**
 * Build the Knex `connection` for mysql2 from a spec's config + secret. A DSN
 * (`url`/`connectionString`) passes through as-is — knex's mysql2 dialect
 * accepts a connection string; otherwise discrete fields, with the secret as
 * the password (never part of `config`).
 */
function buildMysqlConnection(spec: DatasourceConnectionSpec): unknown {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;
  const url = (cfg.url as string | undefined) ?? (cfg.connectionString as string | undefined);
  if (url) return url;
  return {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user ?? cfg.username,
    ...(spec.secret ? { password: spec.secret } : cfg.password ? { password: cfg.password } : {}),
    ...(cfg.ssl != null ? { ssl: cfg.ssl } : {}),
  };
}

/**
 * Host-composition keys the CLI/standalone stack stamps into a `default`
 * datasource's `config` for the SQL builders (#3826). They are not memory-driver
 * config, so they are stripped before the rest of `config` is handed through.
 */
const NON_MEMORY_CONFIG_KEYS = ['schemaMode', 'autoMigrate', 'persist'] as const;

/** `.objectstack/data/memory-<datasource>.json` — one file per pool, never one for all. */
function memoryStatePath(datasource: string): string {
  return join('.objectstack', 'data', `memory-${datasource}.json`);
}

/** `objectstack:memory-db:<datasource>` — the localStorage equivalent of the above. */
function memoryStateKey(datasource: string): string {
  return `objectstack:memory-db:${datasource}`;
}

/**
 * Scope a REQUESTED persistence mode to one datasource.
 *
 * `InMemoryDriver`'s own persistence defaults are process-global — one file
 * (`.objectstack/data/memory-driver.json`), one localStorage key — so two
 * `driver: 'memory'` datasources in the same process load and save the SAME
 * store: each sees the other's tables, and the last teardown to flush clobbers
 * the other's rows. Expanding the string forms (`'auto'`/`'file'`/`'local'`) to
 * the object form is what lets the default path/key carry the datasource name.
 * An author-supplied `path`/`key` is theirs and is left alone, as is a custom
 * `adapter` — they chose the destination.
 */
function scopeMemoryPersistence(persistence: unknown, datasource: string): unknown {
  if (persistence === false) return false;
  if (typeof persistence === 'string') {
    return { type: persistence, path: memoryStatePath(datasource), key: memoryStateKey(datasource) };
  }
  if (persistence && typeof persistence === 'object' && !('adapter' in persistence)) {
    const p = persistence as { path?: string; key?: string };
    return {
      ...p,
      ...(p.path ? {} : { path: memoryStatePath(datasource) }),
      ...(p.key ? {} : { key: memoryStateKey(datasource) }),
    };
  }
  return persistence;
}

/**
 * Build the `InMemoryDriver` config for a `memory` datasource (#4083).
 *
 * Two things the bare `new InMemoryDriver()` this replaces got wrong:
 *
 *  - **It was not ephemeral.** `InMemoryDriver`'s own `persistence` default is
 *    `'auto'`, which in Node resolves to a file adapter at the *relative* path
 *    `.objectstack/data/memory-driver.json`. Every memory datasource therefore
 *    flushed its whole store into the server's CWD at teardown and reloaded it
 *    on the next boot — the opposite of what this driver id promises the
 *    operator who asks for it ("ephemeral, not real SQL", see
 *    `cli/src/utils/storage-driver.ts`), and why the ADR-0062 D1 federated-read
 *    acceptance read 2 rows on a clean checkout and 2×N on the Nth run (#4083).
 *  - **Every pool shared one destination.** See {@link scopeMemoryPersistence}.
 *
 * So: default to no persistence, honor the datasource's own `config` (dropped on
 * the floor entirely before — `initialData`/`strictMode` never reached the
 * driver), and scope the destination per datasource when an author *does* ask
 * for persistence without naming a path/key of their own.
 */
function buildMemoryConfig(spec: DatasourceConnectionSpec): Record<string, unknown> {
  const cfg = { ...((spec.config ?? {}) as Record<string, unknown>) };
  for (const key of NON_MEMORY_CONFIG_KEYS) delete cfg[key];
  if (cfg.persistence === undefined) return { ...cfg, persistence: false };
  return { ...cfg, persistence: scopeMemoryPersistence(cfg.persistence, spec.name ?? 'default') };
}

/** Build a mongodb connection URL from a spec's config + secret. */
function buildMongoUrl(spec: DatasourceConnectionSpec): string {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;
  const explicit = (cfg.url as string | undefined) ?? (cfg.uri as string | undefined);
  if (explicit) return explicit;
  const host = (cfg.host as string | undefined) ?? 'localhost';
  const port = (cfg.port as number | string | undefined) ?? 27017;
  const db = (cfg.database as string | undefined) ?? '';
  const user = (cfg.user as string | undefined) ?? (cfg.username as string | undefined);
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(spec.secret ?? '')}@` : '';
  return `mongodb://${auth}${host}:${port}/${db}`;
}

/**
 * Create the default datasource driver factory. Driver packages are imported
 * lazily so a host that never builds (e.g.) a mongo connection doesn't pay for
 * the mongo SDK.
 */
export interface DefaultDatasourceDriverFactoryOptions {
  /**
   * Enables the dev-only native-`better-sqlite3` → wasm → in-memory step-down
   * for sqlite construction (#2229). When omitted, defaults per call to
   * `process.env.NODE_ENV === 'development'`. In production a native load
   * failure is NOT silently swapped for a different engine (fail-closed).
   */
  dev?: boolean;
}

export function createDefaultDatasourceDriverFactory(
  options: DefaultDatasourceDriverFactoryOptions = {},
): IDatasourceDriverFactory {
  return {
    supports(driverId: string): boolean {
      return resolveKind(driverId) !== undefined;
    },

    async create(spec: DatasourceConnectionSpec): Promise<DatasourceDriverHandle> {
      const kind = resolveKind(spec.driver);
      if (!kind) {
        throw new Error(`Unsupported driver id '${spec.driver}'.`);
      }

      const schemaMode = (spec.external as { schemaMode?: string } | undefined)?.schemaMode
        ?? ((spec.config as Record<string, unknown> | undefined)?.schemaMode as string | undefined);
      // Host-composition passthroughs (#3826): the CLI's declared `default`
      // definition carries the dev loosen-only self-heal (#2186) and the wasm
      // persistence mode in `config`. Connection builders ignore both keys, so
      // they never leak into a DSN.
      const cfg = (spec.config ?? {}) as Record<string, unknown>;
      const autoMigrate = cfg.autoMigrate as 'safe' | undefined;
      const persistOverride = cfg.persist as string | undefined;

      if (kind === 'postgres') {
        const { SqlDriver } = await import('@objectstack/driver-sql');
        const driver = new SqlDriver({
          client: 'pg',
          connection: buildSqlConnection(spec, 'pg') as any,
          pool: { min: 0, max: 5 },
          ...(schemaMode ? { schemaMode: schemaMode as any } : {}),
          ...(autoMigrate ? { autoMigrate } : {}),
        } as any);
        return toHandle(driver, () => sqlServerVersion(driver, 'pg'));
      }

      if (kind === 'sqlite') {
        // better-sqlite3 loads its native addon lazily (first query), so an ABI
        // mismatch is invisible at construction and crashes later. resolveSqliteDriver
        // probes up-front and, IN DEV ONLY, steps down to wasm SQLite (real SQL +
        // on-disk persistence) then in-memory; in production it returns the native
        // driver unprobed so a failure surfaces loudly (fail-closed). (#2229)
        const conn = buildSqlConnection(spec, 'better-sqlite3') as { filename?: string };
        const { resolveSqliteDriver } = await import('./sqlite-driver-fallback.js');
        const resolved = await resolveSqliteDriver({
          filename: conn.filename ?? ':memory:',
          dev: options.dev,
          ...(schemaMode ? { schemaMode } : {}),
          ...(autoMigrate ? { autoMigrate } : {}),
        });
        return toHandle(resolved.driver, () => sqlServerVersion(resolved.driver, 'sqlite'));
      }

      if (kind === 'sqlite-wasm') {
        // Pure-JS WASM sqlite: real SQL with no native build. File-backed
        // databases persist on write; `:memory:` stays ephemeral. Mirrors the
        // construction the standalone stack used before its `default` became a
        // declared datasource (#3826). Lazy + caught like mongodb: the wasm
        // driver rides as an optional install for published consumers.
        let SqliteWasmDriver: any;
        try {
          ({ SqliteWasmDriver } = await import('@objectstack/driver-sqlite-wasm' as any));
        } catch (err: any) {
          throw new Error(
            `sqlite-wasm driver requested but @objectstack/driver-sqlite-wasm is not installed (${err?.message ?? err}).`,
          );
        }
        const conn = buildSqlConnection(spec, 'better-sqlite3') as { filename?: string };
        const filename = conn.filename ?? ':memory:';
        const driver = new SqliteWasmDriver({
          filename,
          persist: persistOverride ?? (filename !== ':memory:' ? 'on-write' : undefined),
          ...(schemaMode ? { schemaMode } : {}),
        });
        return toHandle(driver, () => sqlServerVersion(driver, 'sqlite'));
      }

      if (kind === 'mysql') {
        const { SqlDriver } = await import('@objectstack/driver-sql');
        const driver = new SqlDriver({
          client: 'mysql2',
          connection: buildMysqlConnection(spec) as any,
          pool: { min: 0, max: 5 },
          ...(schemaMode ? { schemaMode: schemaMode as any } : {}),
          ...(autoMigrate ? { autoMigrate } : {}),
        } as any);
        return toHandle(driver);
      }

      if (kind === 'mongodb') {
        let MongoDBDriver: any;
        try {
          ({ MongoDBDriver } = await import('@objectstack/driver-mongodb' as any));
        } catch (err: any) {
          throw new Error(
            `mongodb driver requested but @objectstack/driver-mongodb is not installed (${err?.message ?? err}).`,
          );
        }
        const driver = new MongoDBDriver({ url: buildMongoUrl(spec) });
        return toHandle(driver);
      }

      // memory — ephemeral per datasource unless the author opts into
      // persistence, and then into a destination of its own (#4083).
      const { InMemoryDriver } = await import('@objectstack/driver-memory');
      return toHandle(new InMemoryDriver(buildMemoryConfig(spec)));
    },
  };
}

/** Best-effort server version via a raw query; swallows everything. */
async function sqlServerVersion(driver: any, client: 'pg' | 'sqlite'): Promise<string | undefined> {
  if (typeof driver?.execute !== 'function') return undefined;
  try {
    const sql = client === 'pg' ? 'SELECT version() AS v' : 'SELECT sqlite_version() AS v';
    const rows: any = await driver.execute(sql);
    const first = Array.isArray(rows) ? rows[0] : Array.isArray(rows?.rows) ? rows.rows[0] : rows;
    const v = first?.v ?? first?.version ?? first?.['sqlite_version()'];
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}
