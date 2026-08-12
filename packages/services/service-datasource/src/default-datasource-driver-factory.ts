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
import { resolveDatasourceSchemaMode } from './datasource-schema-mode.js';
import { buildTursoDriverConfig, resolveTursoUrl } from './turso-driver-config.js';
import { MissingDriverPackageError } from './missing-driver-package-error.js';
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
 * The optional package that provides the libSQL/Turso driver, and the exact
 * command an operator runs to install it.
 *
 * Declared as constants rather than left inline so the pin test asserts the
 * COMMAND rather than a sentence shape, and so a host that wants to render the
 * remedy itself has one place to read it from. `@objectstack/runtime`'s host
 * loader (`turso-driver-factory.ts`) declared its own equal pair until #7314 and
 * now re-exports these — runtime depends on this package, so that import
 * direction is the legal one, while the reverse is not.
 */
export const TURSO_DRIVER_PACKAGE = '@objectstack/driver-turso';

/** @see {@link TURSO_DRIVER_PACKAGE} */
export const TURSO_DRIVER_INSTALL_COMMAND = `npm install ${TURSO_DRIVER_PACKAGE}`;

/**
 * What this factory says when the OPTIONAL libSQL driver package is absent
 * (#7314).
 *
 * Until #7314 this arm said only *"turso driver requested but
 * @objectstack/driver-turso is not installed (…)"* — the fault and nothing
 * else. The host loader (`@objectstack/runtime`'s `loadTursoDriverFactory`,
 * single owner since #6268) has answered the SAME missing package with the
 * install command, the consequence and the reason for refusing since #5602, so
 * an operator who booted with a libSQL url was told how to fix it while an
 * admin who added the identical datasource in Setup was not. One missing
 * package, two qualities of answer, decided by which door the request came
 * through.
 *
 * Two deliberate differences from the host loader's wording, because this arm
 * serves different doors — a datasource created in Setup, `testConnection`, a
 * declared NON-default datasource — rather than a `default` that a host boots:
 *
 *  - It names the datasource, like the url-less refusal in the same arm, since
 *    here there may be several and only one of them is libSQL.
 *  - It does NOT mention `OS_DATABASE_URL` / `--database`. Those select the
 *    HOST's `default` datasource and would do nothing for the datasource that
 *    actually failed — advice that sends the reader to a knob which cannot
 *    affect their problem is the `connect-failure-remedy.ts` failure (#5794) in
 *    a new spelling. One fix, stated once, and no escape hatch named.
 *
 * The underlying import error is interpolated at the END and in full. That is
 * load-bearing beyond context: this re-throw drops the original `code`, so
 * `isUnbuiltWorkspaceFailure` (via `isModuleNotFoundError`) can only recognise
 * an unbuilt/uninstalled workspace from the `Cannot find package` /
 * `Cannot find module` TEXT it carries — the same reason the `sqlite-wasm` and
 * `mongodb` arms interpolate theirs.
 */
export function missingTursoDriverMessage(args: { datasource?: string; cause: unknown }): string {
  const cause = args.cause instanceof Error ? args.cause.message : String(args.cause);
  return (
    `datasource '${args.datasource ?? 'default'}': a libSQL/Turso datasource was requested, but the `
    + `driver package ${TURSO_DRIVER_PACKAGE} is not installed. Install it next to the server that `
    + `opens this datasource:\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`
    + `(pnpm add ${TURSO_DRIVER_PACKAGE} / yarn add ${TURSO_DRIVER_PACKAGE}.) It is an OPTIONAL `
    + 'package, so a default install stays free of @libsql/client and its native bindings. This '
    + 'refuses rather than falling back to another engine: a silent fallback would open an empty '
    + 'local database that accepts writes while your libSQL data stays untouched, and every write '
    + `would land in the wrong database. Import error: ${cause}`
  );
}

/**
 * One optional driver package, as much of it as an operator needs to be told
 * when it turns out to be absent (#7385).
 *
 * The two prose fields are per-engine and are NOT decoration. #7384 wrote the
 * libSQL wording around a REMOTE database being shadowed by a local one — true
 * for libSQL, true for mongo, and false for `sqlite-wasm`, which has no remote
 * to shadow. Copying that sentence onto the other arms would have produced a
 * remedy that reads well and lies, so each arm states its own consequence and
 * its own reason for being an optional install.
 */
interface OptionalDriverPackage {
  /** Noun phrase for what was asked for: *"a MongoDB datasource"*. */
  readonly requested: string;
  /** @see {@link TURSO_DRIVER_PACKAGE} */
  readonly packageName: string;
  /** @see {@link TURSO_DRIVER_INSTALL_COMMAND} */
  readonly installCommand: string;
  /** Completes *"It is an OPTIONAL package, …"* — what a default install is spared. */
  readonly optionalBecause: string;
  /**
   * Completes *"This refuses rather than falling back to another engine: …"* —
   * what would actually happen to this engine's data if it did fall back.
   */
  readonly consequence: string;
}

/**
 * The shared shape of "the optional driver package for this arm is not here"
 * (#7385), generalised from the libSQL wording #7314 landed.
 *
 * All three of `sqlite-wasm`, `mongodb` and `turso` ride in optional packages,
 * and until #7314 all three answered an absent one with the fault and nothing
 * else. #7314 fixed the libSQL arm; an admin who added a mongo datasource in
 * Setup still got the strictly worse answer, decided by nothing but which
 * driver they picked. This builder is what makes "same class of problem, same
 * quality of answer" a property of the file rather than of whoever edits an arm
 * next.
 *
 * Every discipline point #7384 landed under is kept, because each was a fix for
 * a measured failure rather than a style choice:
 *
 *  - **Name the datasource.** Several may be declared and only one of them is
 *    this engine; the url-less refusal in the `turso` arm names it too.
 *  - **Name exactly one fix, and no escape hatch.** No `OS_DATABASE_URL` /
 *    `--database` (they select the HOST's `default` datasource and can do
 *    nothing for the one that actually failed) and no
 *    `OS_ALLOW_DRIVER_CONNECT_FAILURE` (it would only hide a package that does
 *    not exist). Naming an escape hatch is how it gets used — the
 *    `connect-failure-remedy.ts` failure (#5794).
 *  - **Interpolate the import error at the END and in full.** Load-bearing
 *    beyond context: these arms re-throw a NEW Error and so drop the original
 *    `code`, leaving `isUnbuiltWorkspaceFailure` (via `isModuleNotFoundError`)
 *    able to recognise a half-built checkout only from the `Cannot find
 *    package` / `Cannot find module` TEXT this message carries. Drop it and a
 *    contributor with an unbuilt worktree is told to install a package they
 *    already have.
 *
 * `missingTursoDriverMessage` is deliberately left as its own function rather
 * than re-expressed through this builder: it merged hours before this change
 * and its wording is pinned by #7384's own tests, so converging it is a
 * behaviour-preserving edit with nothing to gain today. The parity test asserts
 * all three answers share this skeleton, which is what makes that convergence a
 * one-line change whenever the lane wants it.
 */
function missingDriverPackageMessage(
  driver: OptionalDriverPackage,
  args: { datasource?: string; cause: unknown },
): string {
  const cause = args.cause instanceof Error ? args.cause.message : String(args.cause);
  return (
    `datasource '${args.datasource ?? 'default'}': ${driver.requested} was requested, but the `
    + `driver package ${driver.packageName} is not installed. Install it next to the server that `
    + `opens this datasource:\n\n    ${driver.installCommand}\n\n`
    + `(pnpm add ${driver.packageName} / yarn add ${driver.packageName}.) It is an OPTIONAL `
    + `package, ${driver.optionalBecause}. This refuses rather than falling back to another `
    + `engine: ${driver.consequence}. Import error: ${cause}`
  );
}

/**
 * The optional package that provides the WASM SQLite driver, and the exact
 * command an operator runs to install it.
 *
 * Optional from THIS package's side, which is the side that matters here:
 * `@objectstack/service-datasource` declares it in `devDependencies` only, so a
 * host that installs this service on its own does not get it. Hosts that go
 * through `@objectstack/runtime` or `@objectstack/cli` DO get it as a hard
 * dependency — for them the reachable case is a half-built workspace, whose
 * `Cannot find module` text `isUnbuiltWorkspaceFailure` re-routes to
 * `pnpm install && pnpm build` further down the stack.
 *
 * @see {@link TURSO_DRIVER_PACKAGE} for why these are constants and not inline.
 */
export const SQLITE_WASM_DRIVER_PACKAGE = '@objectstack/driver-sqlite-wasm';

/** @see {@link SQLITE_WASM_DRIVER_PACKAGE} */
export const SQLITE_WASM_DRIVER_INSTALL_COMMAND = `npm install ${SQLITE_WASM_DRIVER_PACKAGE}`;

/**
 * The optional package that provides the MongoDB driver, and the exact command
 * an operator runs to install it.
 *
 * `@objectstack/service-datasource` declares it in `devDependencies` only and
 * `@objectstack/runtime` carries it as an `optionalDependencies` entry, so
 * `--omit=optional` and a direct install of this service both reach the missing
 * package path. (`@objectstack/cli` depends on it outright.)
 *
 * @see {@link TURSO_DRIVER_PACKAGE} for why these are constants and not inline.
 */
export const MONGODB_DRIVER_PACKAGE = '@objectstack/driver-mongodb';

/** @see {@link MONGODB_DRIVER_PACKAGE} */
export const MONGODB_DRIVER_INSTALL_COMMAND = `npm install ${MONGODB_DRIVER_PACKAGE}`;

/**
 * What this factory says when the OPTIONAL WASM SQLite package is absent
 * (#7385).
 *
 * The consequence clause is this arm's own. `sqlite-wasm` has no remote
 * database for a local one to shadow, so #7384's "your libSQL data stays
 * untouched" would be false here; what a fallback would actually cost is either
 * the durability the datasource asked for (the memory driver accepts writes and
 * drops them at shutdown, #4083) or the whole point of picking WASM in the
 * first place (the native `better-sqlite3` addon this id exists to avoid).
 */
export function missingSqliteWasmDriverMessage(args: { datasource?: string; cause: unknown }): string {
  return missingDriverPackageMessage(
    {
      requested: 'a WASM SQLite datasource',
      packageName: SQLITE_WASM_DRIVER_PACKAGE,
      installCommand: SQLITE_WASM_DRIVER_INSTALL_COMMAND,
      optionalBecause: 'so an install that pulls in only this service stays free of the sql.js WASM build',
      consequence:
        'stepping down to the in-process memory driver would accept every write and drop it at '
        + 'shutdown, leaving the file this datasource names empty, and stepping down to the native '
        + 'better-sqlite3 build would need exactly the native addon a WASM datasource is chosen to '
        + 'avoid',
    },
    args,
  );
}

/**
 * What this factory says when the OPTIONAL MongoDB package is absent (#7385).
 *
 * This arm's consequence IS the libSQL one in substance — a remote server
 * shadowed by something local — because mongo, like libSQL, is a database this
 * process connects to rather than one it opens.
 */
export function missingMongodbDriverMessage(args: { datasource?: string; cause: unknown }): string {
  return missingDriverPackageMessage(
    {
      requested: 'a MongoDB datasource',
      packageName: MONGODB_DRIVER_PACKAGE,
      installCommand: MONGODB_DRIVER_INSTALL_COMMAND,
      optionalBecause: 'so a default install stays free of the mongodb Node.js client',
      consequence:
        'a silent fallback would open a local database that accepts writes while the MongoDB server '
        + 'this datasource points at stays untouched, and every write would land in the wrong '
        + 'database',
    },
    args,
  );
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

      // ADR-0015's ownership mode. The three-source fallback moved to
      // `resolveDatasourceSchemaMode` in #7314 — unchanged in behaviour, but it
      // now has a second caller (the shared libSQL config builder, which
      // `@objectstack/runtime`'s host loader also uses) and an inline read would
      // have been hand-copied into it.
      const schemaMode = resolveDatasourceSchemaMode(spec);
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
          // Until #7385 this said only "sqlite-wasm driver requested but
          // @objectstack/driver-sqlite-wasm is not installed (…)" — the fault
          // and no next step, while the `turso` arm below has stated the
          // command, the consequence and the refusal since #7314.
          throw new Error(missingSqliteWasmDriverMessage({ datasource: spec.name, cause: err }));
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
          // Same generalisation as the `sqlite-wasm` arm above (#7385): this
          // said "mongodb driver requested but @objectstack/driver-mongodb is
          // not installed (…)" and stopped, so an admin who added a mongo
          // datasource in Setup was told less than one who added a libSQL one.
          throw new Error(missingMongodbDriverMessage({ datasource: spec.name, cause: err }));
        }
        // `options` (the MongoClient passthrough) and the datasource's `pool`
        // block reach the client since #4410 — the driver has always read
        // `options` / `minPoolSize` / `maxPoolSize`; only `url` was ever passed.
        //
        // `min` / `max` are the ONLY keys taken out of the block, and that is
        // now enforced rather than merely true: `pool.idleTimeoutMillis` and
        // `pool.connectionTimeoutMillis` used to be dropped here in silence —
        // half a block honoured, which reads to the author as a whole one — and
        // since #7243 the guard at the top of `create()` rejects them by name
        // (`POOL_UNREAD_KEYS_BY_DRIVER`). Wiring them onto the MongoClient's
        // `maxIdleTimeMS` / `connectTimeoutMS` was the option NOT taken
        // (maintainer ruling 2026-08-11): no measured consumer asked for them.
        // Adding a key here therefore means deleting it from that table in the
        // same change — the pin in `datasource-pool-support.test.ts` reads this
        // arm's source and fails if the two disagree.
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
        //
        // The missing-package message states the install command, the
        // consequence and the refusal — the same quality of answer the host
        // loader has given since #5602, which this arm did not (#7314).
        //
        // It is now also the SAME CLASS. `MissingDriverPackageError` used to be
        // declared in `@objectstack/runtime`, which DEPENDS on this package, so
        // this arm could neither import it (dependency inversion) nor declare
        // its own (the identity hazard #6268 closed — `serve.ts` decides boot
        // fatality with `instanceof`). #7314 moved the one class DOWN to
        // `missing-driver-package-error.ts` here; runtime re-exports it from its
        // old home, so both loaders now raise an error that satisfies the same
        // `instanceof` no matter which door the request came through.
        //
        // The CONFIG READ is single-sourced too, and that was the half a user
        // could hit: this arm read nine keys while the host loader read `url`
        // and `authToken`, so an encrypted or embedded-replica `default`
        // silently lost `encryptionKey` / `syncUrl` / `sync` / `concurrency` /
        // `timeout` / `mode`. Both now call `buildTursoDriverConfig`.
        //
        // `spec.pool` is not read here and never was: `TursoDriverConfig` has
        // no `min` / `max` — a `file:` url runs the local better-sqlite3 engine
        // (one connection per database, the very engine the sqlite arms are
        // rejected for) and a `libsql://` url is a request transport capped by
        // `config.concurrency`, not a pool. It used to be dropped in silence;
        // since #7243 the guard at the top of `create()` rejects it whole-arm,
        // which is why this arm needs no pool handling of its own rather than
        // merely having none. Whole-arm and NOT forked by url mode: maintainer
        // ruling 2026-08-11 — both modes reach the same verdict, so a fork would
        // buy branching and no author-visible difference.
        let TursoDriver: any;
        try {
          ({ TursoDriver } = await import('@objectstack/driver-turso' as any));
        } catch (err: any) {
          throw new MissingDriverPackageError({
            driverType: 'turso',
            packageName: TURSO_DRIVER_PACKAGE,
            installCommand: TURSO_DRIVER_INSTALL_COMMAND,
            message: missingTursoDriverMessage({ datasource: spec.name, cause: err }),
          });
        }
        const url = resolveTursoUrl(spec);
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
        // `schemaMode` is read by the builder (from all three of its sources),
        // not taken from the local `schemaMode` above — one read, so the host
        // loader cannot be handed a narrower one.
        const driver = new TursoDriver(buildTursoDriverConfig(spec, url));
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
