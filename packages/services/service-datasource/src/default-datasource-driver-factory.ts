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
import { parse as parsePostgresConnectionString } from 'pg-connection-string';
import { resolveDriverId, urlUserinfoUsername, type BuiltinDriverId } from '@objectstack/spec/data';
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
 *
 * ⚠️ The `true` this can return is a `pg` spelling, not a universal one — see
 * {@link mysqlSslOption}, which re-expands it for `mysql2`. Do not "simplify"
 * that call away.
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

/**
 * {@link resolveSslOption}'s answer in the spelling `mysql2` accepts (#8874).
 *
 * ## `ssl: true` is not a mysql2 value — it throws
 *
 * `pg` takes a boolean; `mysql2` takes an object or the name of a bundled
 * profile, and rejects everything else outright. Measured on mysql2 3.23.1,
 * `lib/connection_config.js`:
 *
 * ```js
 * this.ssl = typeof options.ssl === 'string'
 *   ? ConnectionConfig.getSSLProfile(options.ssl)
 *   : options.ssl || false;
 * if (this.ssl) {
 *   if (typeof this.ssl !== 'object') {
 *     throw new TypeError(`SSL profile must be an object, instead it's a ${typeof this.ssl}`);
 *   }
 *   this.ssl.rejectUnauthorized = this.ssl.rejectUnauthorized !== false;
 * }
 * ```
 *
 * ```text
 * {host,port,database,user, ssl:true}  -> TypeError: SSL profile must be an object, instead it's a boolean
 * {host,port,database,user, ssl:{}}    -> ssl {rejectUnauthorized:true}
 * ```
 *
 * `true` is exactly what `resolveSslOption` answers for the two commonest
 * declarations — `ssl: { enabled: true }` with no certificate material, and the
 * `config.ssl` shorthand, whose schema (`DriverSslToggleSchema`) is
 * `z.boolean()` and so has no other authorable value. So the mysql arm's
 * DISCRETE-FIELDS branch — the one #8874 describes as honouring the
 * declaration — has been handing `mysql2` a value that makes every connection
 * acquisition throw. That is the same declared-≠-enforced defect as the dropped
 * DSN-branch block, one spelling further along, and it is fixed here rather
 * than beside it: emitting `ssl: true` onto the DSN branch to "honour" the
 * declaration would have shipped the throw to a second branch.
 *
 * ## Why `{}` is a translation and not a new policy
 *
 * `resolveSslOption` states the equivalence itself, above: the boolean IS the
 * collapsed empty-options object (*"`ssl: {}` would read as 'TLS with default
 * options' … which is what `enabled: true` with nothing else means anyway"*).
 * This re-expands the same value for the client that cannot read the collapsed
 * form. `rejectUnauthorized: true` on the result is `mysql2`'s own default for
 * an object (line 171 above), not a verification policy chosen here.
 *
 * Everything else passes through untouched — an options object stays byte for
 * byte what the TLS block resolved to, `false` stays `false` (mysql2's own
 * default, so it disables nothing that was enabled), and a stored row holding a
 * profile name (`'Amazon RDS'`) still reaches `getSSLProfile`.
 */
function mysqlSslOption(resolved: unknown): unknown {
  return resolved === true ? {} : resolved;
}

/**
 * What this factory says when `pg`'s own parser rejects a postgres DSN that
 * carries a bound credential (#8873).
 *
 * Reached only on the secret-bound path, and only for a url `pg` itself cannot
 * read: {@link postgresDsnFields} runs the client's own parser, so anything it
 * rejects would raise the identical error at connect time today (measured on
 * pg 8.22.0 — `postgresql://app@h1:5432,h2:5433/app` throws `ERR_INVALID_URL`
 * from `new ConnectionParameters` exactly as it does from `parse`). The failure
 * is therefore moved earlier and named, never invented: this datasource has
 * never been able to open a connection.
 *
 * ⚠️ The url is deliberately NOT echoed. It is the one string in this arm that
 * can still carry a credential — a stored pre-#8082 row may embed a userinfo
 * password, and a pre-#8337 row a `?password=` — which is why `pg` redacts it
 * in its own error (`input: '*****REDACTED*****'`, measured). A message that
 * quoted the url to be helpful would put that credential into every log that
 * records a failed datasource build.
 */
function unparseablePostgresDsnMessage(args: { datasource?: string; cause: unknown }): string {
  const where = args.datasource ? `datasource '${args.datasource}'` : 'this postgres datasource';
  const cause = args.cause instanceof Error ? args.cause.message : String(args.cause);
  return (
    `The postgres ${where} binds a credential to a connection url that pg's own parser rejects `
    + `(${cause}). The url is not shown here because it may itself embed a credential. `
    + `pg raises the same error when it opens a connection, so this datasource cannot connect `
    + `with or without the bound secret — correct \`config.url\` to a form pg accepts `
    + `(\`postgresql://[user@][host][:port][/dbname][?params]\`, single host only).`
  );
}

/**
 * `pg`'s own decomposition of a DSN, used as the connection config itself.
 *
 * Parsing with the client's parser rather than a hand-rolled one is the whole
 * safety argument for {@link buildSqlConnection}'s postgres DSN branch: the
 * fields handed to `pg` are the fields `pg` would have derived from the same
 * string, by construction, so there is no second dialect of `postgresql://…`
 * in this repo to drift out of agreement with the client. It also carries the
 * parts a partial parse would silently drop — `pg-connection-string` copies
 * EVERY query parameter into the config, which is how `?sslmode=`,
 * `?application_name=`, `?options=` and `?connect_timeout=` reach the client at
 * all (the same mechanism that makes `?password=` a credential spelling, which
 * `PostgresConfigSchema` refuses at authoring since #8337).
 */
function postgresDsnFields(url: string, datasource?: string): Record<string, unknown> {
  try {
    return parsePostgresConnectionString(url) as unknown as Record<string, unknown>;
  } catch (err) {
    throw new Error(unparseablePostgresDsnMessage({ datasource, cause: err }));
  }
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
    // The sibling keys, in the order they have always been layered. `pg` lets
    // a DSN's own `sslmode` override the datasource's `ssl` block and a DSN's
    // `?application_name=` override `config.applicationName`; both branches
    // below keep that precedence by putting the DSN's contribution last.
    const siblings = {
      ...(ssl !== undefined ? { ssl } : {}),
      ...pgConnectionExtras(cfg),
    };

    // Nothing bound: byte-for-byte the shape this arm has always emitted. The
    // blast radius of #8873 is "a secret was bound", so a datasource that binds
    // none must not change at all — including keeping the DSN unparsed here, so
    // a url `pg` rejects still fails where it fails today.
    if (!spec.secret) return { connectionString: url, ...siblings };

    // A bound secret, on the DSN branch (#8873).
    //
    // ## Why `connectionString` is gone rather than accompanied
    //
    // This arm used to return `{ connectionString: url, password: spec.secret }`
    // and it was the one arm that LOOKED right — an explicit secret branch and a
    // comment declaring the intent — while dropping the credential one layer
    // below, where no assertion on this function's output can see it. `pg`
    // merges a DSN over the config rather than under it:
    //
    // ```js
    // // pg 8.22.0, lib/connection-parameters.js
    // if (config.connectionString) {
    //   config = Object.assign({}, config, parse(config.connectionString))
    // }
    // ```
    //
    // So the injected password is destroyed TWICE over, by two independent
    // mechanisms (both measured on pg 8.22.0 + knex 3.3.0):
    //
    //  1. `parse()` emits a `password` key for every url — `''` when the DSN
    //     carries no userinfo password — and `Object.assign` copies it over the
    //     injected value. `val('password', …)` then reads `''`, falls through to
    //     `PGPASSWORD` and `defaults`, and the effective password is `null`.
    //  2. knex hides the key first: `setHiddenProperty` makes `password` a
    //     NON-ENUMERABLE own property of `connectionSettings`, and
    //     `Object.assign` copies only enumerable ones — so it never reaches the
    //     merge in the first place.
    //
    // Measured before this change, `postgresql://app@db.internal:5432/app` with
    // a secret bound: effective password `null`. With a stored pre-#8082 url
    // embedding `app:embedded-legacy@`: effective password `'embedded-legacy'`
    // — the DSN beating the credential an operator deliberately bound.
    //
    // ⛔ Not fixable by symmetry with either sibling arm, and this is the whole
    // point of the card: `mysql2` merges a `uri` UNDER its sibling keys (the
    // explicit key wins, which is why `buildMysqlConnection` returns
    // `{ uri, password }`), and the mongo arm rides beside an untouched url in
    // `options.auth`. `pg` merges the other way, so the only place a credential
    // survives is a config the client will not re-parse.
    //
    // ## Why pg's own parse, and not a re-serialised userinfo
    //
    // The competing remedy — keep `connectionString` and splice the secret into
    // the userinfo — was measured and rejected on two counts:
    //
    //  - **It does not even fix the defect.** `pg-connection-string` honours a
    //    `?password=` query parameter OVER the userinfo (the reason #8337
    //    refuses that spelling at authoring). Measured: a stored pre-#8337 url
    //    `postgresql://app@db.internal:5432/app?password=from-query-param`
    //    with the secret spliced into the userinfo still resolves to
    //    `'from-query-param'`. Overriding the parsed `password` key wins over
    //    every spelling, because it is applied after the parse.
    //  - **It would materialise the cleartext credential into a string nothing
    //    hides.** Measured on knex 3.3.0: with the secret in a discrete
    //    `password`, `JSON.stringify(client.connectionSettings)` prints
    //    `{"host":…,"user":"app"}` and the secret is absent; with the secret
    //    spliced into the url it prints the whole DSN, credential included.
    //    That is also the shape #8082 refuses to let anyone author and
    //    `redactUrlPassword` exists to scrub — synthesising it at connect time
    //    would push the platform's own hardest-to-redact credential spelling
    //    back into circulation.
    //
    // Everything except `password` is therefore what `pg` would have computed
    // from the same url: verified key-by-key (`user`/`database`/`port`/`host`/
    // `ssl`/`application_name`/`statement_timeout`/`options`/`connect_timeout`/
    // `client_encoding`) across the sslmode, unix-socket, `?options=`,
    // credential-free, embedded-password and no-userinfo forms — identical in
    // every case.
    //
    // A url naming no user still gets the credential, unlike the mongo arm's
    // deliberate no-op there. The asymmetry is mechanical, not a second policy:
    // `MongoClient` cannot carry a password without a username and would turn a
    // working anonymous connection into a guaranteed failure, whereas `pg` sends
    // a password only when the server asks for one — so injecting cannot break
    // a datasource that connects today, and refusing would drop a credential the
    // operator bound. Making that contradictory pair loud belongs at the
    // authoring door, where both halves are visible at once (#9041).
    return {
      ...siblings,
      ...postgresDsnFields(url, spec.name),
      password: spec.secret,
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
 * (`url`) selects the connection-string form; otherwise discrete fields, with
 * the secret as the password (never part of `config`).
 *
 * ## A bound secret reaches the client on the DSN branch too (#8696)
 *
 * This arm used to be `if (url) return url;` — the DSN string became the whole
 * knex `connection` and an injected `spec.secret` was dropped on the floor,
 * with no diagnostic. That is the declared-≠-enforced shape one layer below
 * Prime Directive #10: `MysqlConfigSchema.url` states the contract this code
 * failed to keep, verbatim — *"bind the secret (`external.credentialsRef` /
 * the connection form's secret field) and it is injected at connect time. A
 * bare username (`user@host`) stays writable."* Since #8082 refuses a
 * `user:password@` userinfo at the publish door, that bare-username DSN plus a
 * bound secret is the ONLY authorable shape for a URL-shaped mysql datasource
 * — so the dropped secret meant it connected with no credential at all, or
 * failed with a driver-level auth error naming nothing about the binding.
 *
 * ## Why `{ uri, password }` and not a hand-parsed DSN
 *
 * `mysql2` merges a `uri` with sibling keys itself, and the EXPLICIT key wins
 * (`ConnectionConfig`: uri-derived values are only filled in for keys the
 * caller supplied no TRUTHY value for — see the falsy-value note under #8874
 * below, which matters for `ssl` and not for a bound secret). So the DSN keeps
 * being parsed by the client that
 * owns its grammar — no URL parsing, no re-encoding, no second dialect of
 * `mysql://…` in this repo — and the bound secret overrides even a legacy
 * embedded password on a stored pre-#8082 row. Measured on mysql2 3.23.1:
 *
 * ```text
 * {uri:'mysql://app@db.internal:3306/app', password:'INJECTED'}
 *   -> user=app host=db.internal port=3306 database=app password=INJECTED
 * {uri:'mysql://app:embedded@db.internal:3306/app', password:'INJECTED'}
 *   -> password=INJECTED          (the bound secret wins, as postgres' arm declares)
 * ```
 *
 * ⚠️ knex hides the key rather than passing it visibly: `Client`'s constructor
 * calls `setHiddenProperty`, so `password` survives on `connectionSettings` as
 * a NON-ENUMERABLE own property (measured on knex 3.3.0). `JSON.stringify` and
 * `Object.keys` therefore both report a bare `{uri}` — a probe that serialises
 * this object reads as "the secret was dropped" when it was not. Assert it with
 * direct property access.
 *
 * ⛔ Do NOT copy this shape to the postgres arm. `pg` does the OPPOSITE merge —
 * `Object.assign({}, config, parse(config.connectionString))`, i.e. the DSN
 * overrides the explicit key — so `{connectionString, password}` there resolves
 * to the DSN's own (absent) password. That was a live defect for as long as this
 * comment described it as one; #8873 closed it by dropping `connectionString`
 * entirely on that branch and handing `pg` its own parse of the url with the
 * credential attached. It was NOT fixed by symmetry with this arm, and the two
 * clients disagreeing is exactly why each arm's precedence is measured rather
 * than assumed.
 *
 * ## A declared `ssl` reaches the client on the DSN branch too (#8874)
 *
 * The gap the paragraph above used to describe as "filed separately". This arm
 * resolved the TLS option and then returned before anything could use it, so a
 * mysql datasource that declared TLS **and** wrote a `config.url` negotiated no
 * TLS at all — declared, resolved, dropped, with no diagnostic, while the
 * discrete-fields branch of the same arm carried it. Whether a connection was
 * encrypted therefore depended on which branch of one arm the datasource
 * happened to take, which is the `datasource.pool` failure shape #5714 / #7243
 * closed for a different key.
 *
 * `MysqlConfigSchema` declares the key honoured with no branch caveat (*"TLS
 * settings, passed to `mysql2`"*), and its `sslmode` / `tls` / `usessl` aliases
 * all rewrite to it — where the schema means "not honoured, put it in the url"
 * it says so in as many words, as the `charset` guidance does. The mongo arm's
 * *"TLS is a connection-string concern here"* guidance is that arm's, not this
 * one's. So the triage ruling (honour the declared channel; refuse only if the
 * branch genuinely cannot) applies with nothing to refuse: `mysql2` reads a
 * DSN and the `ssl` option as separate channels, exactly as `pg` does, and the
 * explicit key is the one it keeps.
 *
 * ```text
 * mysql2 3.23.1, no connection opened
 * {uri:'mysql://app@db.internal:3306/app'}                    -> ssl false      (before)
 * {uri:'mysql://app@db.internal:3306/app', ssl:{}}            -> ssl {rejectUnauthorized:true}
 * {uri:…, ssl:{rejectUnauthorized:false}, password:'INJECTED'} -> ssl {rejectUnauthorized:false}, password INJECTED
 * ```
 *
 * ⚠️ mysql2's merge skips a **falsy** explicit value, not merely an absent one
 * — `if (options[key]) continue;` in `lib/connection_config.js`, which is
 * looser than a hasOwnProperty rule would be. It costs nothing here: a
 * declared `ssl: false` is also mysql2's own default, so the only value it
 * cannot override is a DSN's own `?ssl=`, and mysql2 parses that to a boolean
 * and throws on it with or without this change.
 *
 * ## The shape only changes for datasources that were broken
 *
 * A bare DSN string is what knex has always parsed for the no-secret case, and
 * `ssl` cannot be attached to a string — so honouring a declaration there means
 * returning an object instead. That return is therefore made **only when a
 * declared `ssl` actually resolved**; a datasource that declared none still
 * gets the bare string, byte for byte. The switch is safe where it does happen:
 * knex's own parse of the string and mysql2's parse of the same value as `uri`
 * were compared key-by-key (`host`/`port`/`user`/`password`/`database`/
 * `charset`/`timezone`/`connectTimeout`/`flags`/`socketPath`/
 * `multipleStatements`) across the bare-username, embedded-password,
 * no-userinfo, portless, percent-encoded-username and query-parameter
 * (`?charset=`, `?connectTimeout=`, `?timezone=`) forms — **identical in every
 * case**. That sweep is pinned in `mysql-dsn-ssl.test.ts`, not merely done once
 * here.
 */
function buildMysqlConnection(spec: DatasourceConnectionSpec): unknown {
  const cfg = (spec.config ?? {}) as Record<string, unknown>;
  const mysqlSsl = mysqlSslOption(resolveSslOption(spec));
  const url = cfg.url as string | undefined;
  if (url) {
    // Nothing to carry beside the DSN: the bare-string passthrough this arm has
    // always emitted, unchanged. The blast radius of both #8696 and #8874 is
    // "something was declared", so a datasource that declared neither a secret
    // nor TLS must not move at all.
    if (mysqlSsl === undefined && !spec.secret) return url;
    return {
      uri: url,
      ...(spec.secret ? { password: spec.secret } : {}),
      ...(mysqlSsl !== undefined ? { ssl: mysqlSsl } : {}),
    };
  }
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
 *
 * The DSN branch's half of that is closed by {@link buildMongoAuth} (#8696),
 * NOT here: this function still returns the authored `config.url` byte for
 * byte. The credential rides beside it in the client options, so nothing in
 * this repo re-encodes or rewrites a `mongodb://…` — the client keeps owning
 * its own grammar, the same reason the mysql arm hands `mysql2` a `uri` rather
 * than parsed fields.
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
 * The `MongoClient` `auth` block that carries a bound `spec.secret` onto the
 * DSN branch of the mongo arm (#8696) — the half {@link buildMongoUrl} does
 * not, and cannot, do.
 *
 * ## The defect this closes
 *
 * `DatasourceConnectionService` resolves `external.credentialsRef` to a
 * cleartext secret and hands it here as `spec.secret`. With a `config.url`
 * present the arm returned that url verbatim and applied the secret nowhere:
 * measured on `origin/main` @ 792524c22, `mongodb://app@db.internal:27017/app`
 * plus a bound secret reached `MongoClient` as
 * `credentials{username:'app', password:''}`. Since #8082 refuses a
 * `user:password@` userinfo at the publish door, that bare-username DSN plus a
 * bound secret is the ONLY authorable URL shape for an authenticated mongo
 * datasource — so the arm dropped the credential of exactly the configuration
 * `MongoConfigSchema.url` tells operators to write (*"bind the secret … and it
 * is injected at connect time. A bare username (`user@host1`) stays
 * writable."*), and the datasource then connected with no credential at all.
 * Declared, resolved, injected, dropped at the last call site — Prime
 * Directive #10 one layer down.
 *
 * ## Why `options.auth` and not a URL rewrite
 *
 * Measured on mongodb 7.5.0, no connection opened (the `MongoClient`
 * constructor resolves credentials eagerly):
 *
 * ```text
 * url 'mongodb://app@db.internal:27017/app'   + auth{app,BOUND} -> password BOUND
 * url 'mongodb://app:embedded-legacy@h/app'   + auth{app,BOUND} -> password BOUND
 * url 'mongodb://app@h1:27017,h2:27017/app'   + auth{app,BOUND} -> password BOUND
 * url 'mongodb+srv://app@c0.example.net/app'  + auth{app,BOUND} -> password BOUND
 * url 'mongodb://app@h/app?authSource=admin'  + auth{app,BOUND} -> source admin
 * ```
 *
 * So the authored url is handed over untouched — no rewrite, no re-encoding of
 * the secret, no second dialect of `mongodb://…` in this repo — and the bound
 * secret wins over a legacy embedded userinfo password, the same precedence the
 * mysql arm states. Multi-host and `+srv` forms ride through unharmed, which a
 * rewrite could not have promised: `new URL()` cannot even PARSE the multi-host
 * form this schema documents (measured `ERR_INVALID_URL`), which is why the
 * username is read through the platform's own DSN grammar
 * ({@link urlUserinfoUsername}, #8876) rather than WHATWG parsing, and why
 * hand-rolling that parse here would have been the second copy of the userinfo
 * boundaries #8082's ruling rejects by name.
 *
 * ⛔ Do NOT reach this shape by symmetry from the mysql arm. The clients merge
 * a DSN against explicit keys in OPPOSITE directions — `pg` merges
 * `parse(connectionString)` OVER the explicit config, which is why the postgres
 * arm looked correct while being broken one layer lower, and why #8873 had to
 * close it with a THIRD shape again (no `connectionString` at all). Each arm's
 * precedence is measured against its own client.
 *
 * ## Why a userinfo-free url gets NOTHING, deliberately
 *
 * `auth` is not constructible from a password alone — `{password}` without a
 * username throws `MongoParseError: credentials must be an object with
 * 'username' and 'password' properties` — and inventing one is worse than
 * silence in the one direction that matters: measured,
 * `mongodb://db.internal:27017/app` carries NO credentials at all, while the
 * same url with `auth{'',BOUND}` carries `credentials{username:''}`. Injecting
 * on a url that declares no userinfo would therefore turn a datasource that
 * connects anonymously today into a guaranteed handshake failure. So the rule
 * is: inject only where the url already declares authenticated intent.
 *
 * That leaves "secret bound, url names no user" a silent no-op, and that is
 * chosen rather than merely inherited. It is what the COMPOSED branch above
 * has always done with the same input (`const auth = user ? … : ''` — no
 * username, no credential, secret unused), so making this branch loud would
 * plant a second per-branch asymmetry inside one function, which is the exact
 * defect class this change closes. And the loud half cannot live here anyway:
 * `MongoConfigSchema` declares injection on `url`, so refusing at connect
 * would contradict a published contract and reject the shape #8155's landed
 * migration instructs operators to write. Making the contradictory pair
 * (`external.credentialsRef` bound + a url with no userinfo) loud belongs at
 * the authoring door, where both halves are visible at once — filed, not
 * guessed at here.
 *
 * @returns the `auth` block, or `undefined` when nothing should be injected —
 *   no secret bound, no DSN (the composed branch injects through the url it
 *   builds), or a url naming no user.
 */
function buildMongoAuth(spec: DatasourceConnectionSpec): { username: string; password: string } | undefined {
  if (!spec.secret) return undefined;
  const cfg = (spec.config ?? {}) as Record<string, unknown>;
  const url = cfg.url as string | undefined;
  if (!url) return undefined;
  const username = urlUserinfoUsername(url);
  // `''` (present-but-empty userinfo) is deliberately NOT excluded here: the
  // accessor keeps it distinct from `undefined` precisely so this call site can
  // decide, and the decision is that userinfo present = authenticated intent.
  // It is inert either way — `MongoClient` refuses `mongodb://:p@h/db` and
  // `mongodb://@h/db` outright ('URI contained empty userinfo section'), with
  // or without `auth` — so the client renders that verdict, not this function.
  if (username === undefined) return undefined;
  return { username: decodeUserinfoUsername(username), password: spec.secret };
}

/**
 * Percent-decode a userinfo username for `MongoClient`'s `auth.username`.
 *
 * The spec accessor answers with the RAW component by contract (byte-level
 * alignment with the redaction half), and the client decodes the same
 * component when it reads it from the url itself — `mongodb://a%2Fb@h/db`
 * authenticates as `a/b`, measured. Handing the raw value through would
 * authenticate a DSN-branch datasource as a DIFFERENT user (`a%2Fb`) than the
 * url names, so decoding is required, not cosmetic.
 *
 * A malformed escape falls back to the raw component instead of throwing.
 * `decodeURIComponent('100%')` raises `URIError: URI malformed`, and
 * `MongoClient` raises `MongoParseError: URI malformed` on that same url one
 * line later — measured, both. The url is fatal either way; the only thing
 * decided here is WHICH error the operator reads, and the client's names the
 * client and the URI. Nothing is tolerated: an unusable url stays unusable.
 */
function decodeUserinfoUsername(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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
        // #8696 — the bound secret rides into the SAME passthrough on the DSN
        // branch (see `buildMongoAuth`), so it is merged rather than assigned:
        // the author's `options` keep arriving verbatim, and the injected
        // `auth` is spread LAST so a resolved `external.credentialsRef` wins
        // over an `auth` block someone wrote into the passthrough by hand —
        // the same precedence the mysql arm gives it over a legacy embedded
        // password. A fresh object every time: `cfg.options` is the stored
        // config's own object and the cleartext secret must never be written
        // back onto it.
        const mongoAuth = buildMongoAuth(spec);
        const mongoOptions = {
          ...(cfg.options && typeof cfg.options === 'object' ? (cfg.options as Record<string, unknown>) : {}),
          ...(mongoAuth ? { auth: mongoAuth } : {}),
        };
        const driver = new MongoDBDriver({
          url: buildMongoUrl(spec),
          ...(cfg.database ? { database: cfg.database } : {}),
          ...(Object.keys(mongoOptions).length > 0 ? { options: mongoOptions } : {}),
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
