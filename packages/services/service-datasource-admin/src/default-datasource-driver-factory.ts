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
 *   - `mongodb` / `mongo`             → `@objectstack/driver-mongodb` (peer dep)
 *   - `memory` / `inmemory`           → `@objectstack/driver-memory`
 *
 * Anything else returns `supports() === false`, so the admin service degrades
 * gracefully (testConnection → `{ ok: false }`, create skips hot pool reg).
 *
 * SECURITY: the cleartext `spec.secret` is used only to open the connection and
 * is never persisted or logged here.
 */

import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
} from './contracts/index.js';

type ResolvedKind = 'postgres' | 'sqlite' | 'mongodb' | 'memory';

const DRIVER_ID_ALIASES: Record<string, ResolvedKind> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  pg: 'postgres',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  'better-sqlite3': 'sqlite',
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
export function createDefaultDatasourceDriverFactory(): IDatasourceDriverFactory {
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

      if (kind === 'postgres') {
        const { SqlDriver } = await import('@objectstack/driver-sql');
        const driver = new SqlDriver({
          client: 'pg',
          connection: buildSqlConnection(spec, 'pg') as any,
          pool: { min: 0, max: 5 },
          ...(schemaMode ? { schemaMode: schemaMode as any } : {}),
        } as any);
        return toHandle(driver, () => sqlServerVersion(driver, 'pg'));
      }

      if (kind === 'sqlite') {
        const { SqlDriver } = await import('@objectstack/driver-sql');
        const driver = new SqlDriver({
          client: 'better-sqlite3',
          connection: buildSqlConnection(spec, 'better-sqlite3') as any,
          useNullAsDefault: true,
          ...(schemaMode ? { schemaMode: schemaMode as any } : {}),
        } as any);
        return toHandle(driver, () => sqlServerVersion(driver, 'sqlite'));
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

      // memory
      const { InMemoryDriver } = await import('@objectstack/driver-memory');
      return toHandle(new InMemoryDriver());
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
