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
 *   - `mongodb` / `mongo`              → `@objectstack/driver-mongodb` (peer dep)
 *   - `turso` / `libsql`               → `@objectstack/driver-turso` (peer dep)
 *   - `memory` / `inmemory`            → `@objectstack/driver-memory` (ephemeral,
 *     per-datasource — see {@link buildMemoryConfig})
 *
 * The full alias table lives in `@objectstack/spec` (`resolveDriverId`), which
 * is also what selects each driver's config contract — see {@link resolveKind}.
 *
 * `sqlite-wasm` joined for ADR-0062 D1 (#3826): the standalone stack's
 * `default` datasource is a *declared definition* connected through the shared
 * `DatasourceConnectionService`, and its CI-safe wasm default must therefore be
 * a driver id this factory can build — the last bespoke construction site.
 *
 * Anything else returns `supports() === false`, so the admin service degrades
 * gracefully (testConnection → `{ ok: false }`, create skips hot pool reg).
 *
 * `turso` joined in #6345, and it HAD to: `supports()` is
 * `resolveKind() !== undefined`, so the moment turso became a builtin id this
 * factory started claiming it. Without an arm the claim would have been answered
 * by the trailing `memory` fall-through — a libSQL datasource silently built as
 * an ephemeral in-process store, which is the #3276 class with a new spelling.
 * The arm is the same shape `mongodb` and `sqlite-wasm` already use, since all
 * three ride in optional packages. The trailing fall-through is gone too: the
 * last arm is now an explicit `memory` case with an exhaustiveness throw after
 * it, so the NEXT builtin cannot inherit the same trap.
 *
 * SECURITY: the cleartext `spec.secret` is used only to open the connection and
 * is never persisted or logged here.
 */

import { join } from 'node:path';
import { resolveDriverId, type BuiltinDriverId } from '@objectstack/spec/data';
import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
} from './contracts/index.js';
import { assertDatasourcePoolSupported } from './datasource-pool-support.js';
import type { SqliteAbsentFileMode } from '@objectstack/driver-sql';

/**
 * Driver-id resolution comes from the spec since #4410 — this file used to keep
 * its own copy of the alias table.
 *
 * Two tables meant the id that selects a DRIVER and the id that selects that
 * driver's CONFIG CONTRACT could disagree: a spelling only this table knew
 * would be built while its config was validated against nothing — the exact
 * silent acceptance the config gate exists to end, reintroduced as a lookup
 * miss. One table, so "buildable" and "has a contract" are the same set by
 * construction.
 */
type ResolvedKind = BuiltinDriverId;

function resolveKind(driverId: string): ResolvedKind | undefined {
  return resolveDriverId(driverId);
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

/**
 * Postgres connection options that are neither the target nor the credentials —
 * declared on `PostgresConfigSchema` and carried onto every connection shape
 * (DSN or discrete fields alike), since `pg` accepts them next to a
 * `connectionString`.
 *
 * These were declared in the spec and read by nothing until #4410. Giving
 * `config` a gate means every key inside it now claims to be honoured, so each
 * one is either wired (here) or removed from the contract — a declared key that
 * silently does nothing is the defect this whole campaign is about.
 */
function pgConnectionExtras(cfg: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(cfg.applicationName ? { application_name: cfg.applicationName } : {}),
    ...(cfg.statementTimeout != null ? { statement_timeout: cfg.statementTimeout } : {}),
  };
}

/**
 * The `ssl` value to hand a SQL client, from the datasource's TLS block or the
 * per-driver on/off shorthand.
 *
 * `datasource.ssl` is declared, strict, documented — and until #4410 stopped at
 * the record: nothing put it on the connection spec, so a TLS block with a CA
 * certificate in it configured precisely nothing, which is the failure its own
 * schema comment warns about ("a TLS setting that never took effect looked
 * identical to one that did"). The block wins when present because it is the
 * more specific statement; `config.ssl` remains the boolean shorthand.
 */
function resolveSslOption(spec: DatasourceConnectionSpec): unknown {
  const block = spec.ssl as
    | { enabled?: boolean; rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string }
    | undefined;
  if (block) {
    if (block.enabled === false) return false;
    const options = {
      ...(block.rejectUnauthorized !== undefined ? { rejectUnauthorized: block.rejectUnauthorized } : {}),
      ...(block.ca ? { ca: block.ca } : {}),
      ...(block.cert ? { cert: block.cert } : {}),
      ...(block.key ? { key: block.key } : {}),
    };
    // `ssl: {}` would read as "TLS with default options" to `pg`, which is what
    // `enabled: true` with nothing else means anyway — but an empty object is
    // an odd thing to hand a client, so collapse it to the boolean.
    return Object.keys(options).length > 0 ? options : true;
  }
  const shorthand = (spec.config ?? {}).ssl;
  return shorthand == null ? undefined : shorthand;
}

/** Build the Knex `connection` for a SQL driver from a spec's config + secret. */
function buildSqlConnection(spec: DatasourceConnectionSpec, client: 'pg' | 'better-sqlite3'): unknown {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;

  if (client === 'better-sqlite3') {
    // `filename` is the whole contract (`SqliteConfigSchema`). The legacy
    // `file`/`database` spellings are rewritten to it at load by the ADR-0087
    // conversion `datasource-config-driver-key-aliases` (#4456), so no `??`
    // tolerance survives here; authoring rejects them with a rename hint.
    return { filename: (cfg.filename as string | undefined) ?? ':memory:' };
  }

  // pg — accept either a connection string (`url`) or discrete fields. The
  // secret is the password and is never part of `config`.
  const ssl = resolveSslOption(spec);
  const url = cfg.url as string | undefined;
  if (url) {
    // For a DSN, a separately-supplied secret overrides the embedded password.
    // TLS still applies: `sslmode` in a DSN and the `ssl` option are separate
    // channels to `pg`, and a datasource that declares one should get it.
    return {
      connectionString: url,
      ...(spec.secret ? { password: spec.secret } : {}),
      ...(ssl !== undefined ? { ssl } : {}),
      ...pgConnectionExtras(cfg),
    };
  }
  return {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    ...(spec.secret ? { password: spec.secret } : cfg.password ? { password: cfg.password } : {}),
    ...(ssl !== undefined ? { ssl } : {}),
    ...pgConnectionExtras(cfg),
  };
}

/**
 * Knex pool options for a SQL driver, from the datasource's own `pool` block.
 *
 * `datasource.pool` is declared, strict, documented and — until #4410 — read by
 * nobody: `toSpec` carried it into the connection spec and this factory then
 * hardcoded `{ min: 0, max: 5 }` over the top, so an author who sized their pool
 * got the defaults and no indication. Those defaults are preserved for the
 * unspecified case, so nothing that did not set `pool` changes behaviour.
 */
function buildSqlPool(spec: DatasourceConnectionSpec): Record<string, unknown> {
  const pool = (spec.pool ?? {}) as Record<string, unknown>;
  return {
    min: typeof pool.min === 'number' ? pool.min : 0,
    max: typeof pool.max === 'number' ? pool.max : 5,
    ...(typeof pool.idleTimeoutMillis === 'number' ? { idleTimeoutMillis: pool.idleTimeoutMillis } : {}),
    ...(typeof pool.connectionTimeoutMillis === 'number'
      ? { acquireTimeoutMillis: pool.connectionTimeoutMillis }
      : {}),
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
  const mysqlSsl = resolveSslOption(spec);
  const url = cfg.url as string | undefined;
  if (url) return url;
  return {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    ...(spec.secret ? { password: spec.secret } : cfg.password ? { password: cfg.password } : {}),
    ...(mysqlSsl !== undefined ? { ssl: mysqlSsl } : {}),
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

/**
 * Build a mongodb connection URL from a spec's config + secret.
 *
 * Two keys became real here in #4410. `password` was declared on
 * `MongoConfigSchema` and ignored — a mongo datasource carrying one composed
 * `user:@host`, i.e. connected with an EMPTY password, which fails as an auth
 * error nobody would trace back to a config key. `authSource` was declared and
 * dropped the same way. Both now behave the way the SQL builders already did:
 * a datasource secret wins, the config value is the fallback.
 */
function buildMongoUrl(spec: DatasourceConnectionSpec): string {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;
  // `url` is the one spelling (`MongoConfigSchema`); the legacy `uri`/`user`
  // are rewritten to `url`/`username` at load by the ADR-0087 conversion
  // `datasource-config-driver-key-aliases` (#4456), and authoring rejects
  // them with a rename hint.
  const explicit = cfg.url as string | undefined;
  if (explicit) return explicit;
  const host = (cfg.host as string | undefined) ?? 'localhost';
  const port = (cfg.port as number | string | undefined) ?? 27017;
  const db = (cfg.database as string | undefined) ?? '';
  const user = cfg.username as string | undefined;
  const password = spec.secret ?? (cfg.password as string | undefined) ?? '';
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : '';
  const authSource = cfg.authSource as string | undefined;
  const query = authSource ? `?authSource=${encodeURIComponent(authSource)}` : '';
  return `mongodb://${auth}${host}:${port}/${db}${query}`;
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
  /**
   * What a `sqlite` construction does when its file does not exist (#6743).
   * `'empty-in-memory'` opens an ephemeral database instead of creating the
   * file — for hosts that only READ (`os migrate plan`). Defaults to
   * `'create'`, so no existing host changes behaviour.
   *
   * A host-composition option rather than a datasource `config` key on
   * purpose: it describes what THIS BOOT is allowed to do, not a property of
   * the datasource, and `SqliteConfigSchema` is strict — an authorable key
   * here would invite `objectstack.config.ts` to declare a database that
   * silently never persists.
   *
   * Applies to the `sqlite` kind only. `sqlite-wasm` is constructed directly
   * from a filename and is deliberately left alone; every other kind connects
   * to a server that this process cannot bring into existence anyway.
   */
  sqliteAbsentFile?: SqliteAbsentFileMode;
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

      // A `pool` block this driver cannot honour is rejected here rather than
      // dropped on the floor two arms down (#5714). This is the LAST door — the
      // wizard's create/update and the boot-time pre-pass in
      // `DatasourceConnectionService` reject it earlier and with better context
      // — but it is the one every host that builds through this factory passes
      // through, so it is where "declared = honoured" is actually guaranteed.
      assertDatasourcePoolSupported({ driver: spec.driver, pool: spec.pool, name: spec.name });

      // ADR-0015's ownership mode. `spec.schemaMode` — the datasource's own
      // declared key — is FIRST since #4410; before that the first two arms
      // were all there was, and neither could ever hold it: `external` is the
      // federation-settings block (no `schemaMode` key), and nothing wrote the
      // `config` copy. So `schemaMode: 'external'` on a datasource reached the
      // driver as `undefined` and a database ObjectStack is a guest in was
      // treated as managed — DDL ungated at the driver.
      const schemaMode = spec.schemaMode
        ?? (spec.external as { schemaMode?: string } | undefined)?.schemaMode
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
        // `searchPath` is knex's own key for postgres' default schema — the
        // landing site for `config.schema`, declared since the protocol's first
        // postgres shape and read by nothing until #4410.
        const searchPath = cfg.schema as string | undefined;
        const driver = new SqlDriver({
          client: 'pg',
          connection: buildSqlConnection(spec, 'pg') as any,
          pool: buildSqlPool(spec),
          ...(searchPath ? { searchPath } : {}),
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
          ...(options.sqliteAbsentFile ? { sqliteAbsentFile: options.sqliteAbsentFile } : {}),
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
          pool: buildSqlPool(spec),
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
        // `options` (the MongoClient passthrough) and the datasource's `pool`
        // block reach the client since #4410 — the driver has always read
        // `options` / `minPoolSize` / `maxPoolSize`; only `url` was ever passed.
        const pool = (spec.pool ?? {}) as Record<string, unknown>;
        const driver = new MongoDBDriver({
          url: buildMongoUrl(spec),
          ...(cfg.database ? { database: cfg.database } : {}),
          ...(cfg.options && typeof cfg.options === 'object' ? { options: cfg.options } : {}),
          ...(typeof pool.min === 'number' ? { minPoolSize: pool.min } : {}),
          ...(typeof pool.max === 'number' ? { maxPoolSize: pool.max } : {}),
        });
        return toHandle(driver);
      }

      if (kind === 'turso') {
        // libSQL/Turso (#6345). Lazy + caught exactly like `mongodb` and
        // `sqlite-wasm` above: all three ship in optional packages, and a driver
        // being an optional INSTALL has never meant it lacks a contract.
        //
        // This arm exists because `supports()` is `resolveKind() !== undefined`.
        // Giving turso a config contract made it a `BuiltinDriverId`, so the
        // factory began claiming it; before this arm that claim was answered by
        // the trailing `memory` fall-through, i.e. a libSQL datasource built as
        // an ephemeral in-process store that reports success and loses every
        // write (#3276). The CLI and standalone stack still INJECT their own
        // turso factory for the `default` datasource (#5602's host-factory
        // seam), which wins over this one; this arm is what serves every OTHER
        // door — a runtime datasource created in Setup, `testConnection`, a
        // declared non-default datasource.
        let TursoDriver: any;
        try {
          ({ TursoDriver } = await import('@objectstack/driver-turso' as any));
        } catch (err: any) {
          throw new Error(
            `turso driver requested but @objectstack/driver-turso is not installed (${err?.message ?? err}).`,
          );
        }
        const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
        if (!url) {
          // `TursoConfigSchema.url` is required, so the authoring and wizard
          // gates already refuse this. A stored row written before #6345 had no
          // gate at all, and refusing here is the difference between a named
          // failure and `@libsql/client` opening something unexpected.
          throw new Error(
            `datasource '${spec.name ?? 'default'}': the turso driver needs a libSQL url in its `
            + 'config (e.g. libsql://my-db.turso.io or file:./data/objectstack.db).',
          );
        }
        const driver = new TursoDriver({
          url,
          ...(typeof cfg.authToken === 'string' && cfg.authToken ? { authToken: cfg.authToken } : {}),
          ...(typeof cfg.encryptionKey === 'string' && cfg.encryptionKey
            ? { encryptionKey: cfg.encryptionKey }
            : {}),
          ...(typeof cfg.concurrency === 'number' ? { concurrency: cfg.concurrency } : {}),
          ...(typeof cfg.syncUrl === 'string' && cfg.syncUrl ? { syncUrl: cfg.syncUrl } : {}),
          ...(cfg.sync && typeof cfg.sync === 'object' ? { sync: cfg.sync } : {}),
          ...(typeof cfg.timeout === 'number' ? { timeout: cfg.timeout } : {}),
          ...(typeof cfg.mode === 'string' ? { mode: cfg.mode } : {}),
          ...(schemaMode ? { schemaMode } : {}),
        });
        return toHandle(driver, () => sqlServerVersion(driver, 'sqlite'));
      }

      if (kind === 'memory') {
        // memory — ephemeral per datasource unless the author opts into
        // persistence, and then into a destination of its own (#4083).
        //
        // `spec.pool` is not read here and never was: `InMemoryDriver` opens no
        // connection, so there is nothing for one to size. It used to be dropped
        // in silence; since #5931 the guard above rejects it, which is why this
        // arm needs no pool handling of its own rather than merely having none.
        const { InMemoryDriver } = await import('@objectstack/driver-memory');
        return toHandle(new InMemoryDriver(buildMemoryConfig(spec)));
      }

      // Every `BuiltinDriverId` must have an arm above (#6345). Until then this
      // was `memory`'s implicit position: an id the spec table knew and this
      // switch did not silently became an in-process store that accepted writes
      // and lost them. `kind` is `never` here, so adding a builtin without an
      // arm is a TYPE error at build time and a named refusal at run time —
      // never a different engine.
      return assertEveryBuiltinDriverHasAnArm(kind);
    },
  };
}

/**
 * The exhaustiveness stop for {@link createDefaultDatasourceDriverFactory}'s
 * dispatch — see the comment at its only call site.
 *
 * Takes `never`, so it cannot be reached while every builtin has an arm; it
 * still throws rather than returning, because the type guarantee is erased at
 * run time and a stale published `@objectstack/spec` beside a newer consumer is
 * exactly the case that would reach it.
 */
function assertEveryBuiltinDriverHasAnArm(kind: never): never {
  throw new Error(
    `Driver id '${String(kind)}' is a built-in with a config contract but has no construction arm `
    + 'in the shared datasource driver factory. This is a platform bug — refusing rather than '
    + 'falling back, because falling back would build a different engine than the one requested.',
  );
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
