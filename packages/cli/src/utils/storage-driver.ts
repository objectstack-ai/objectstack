// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Storage-driver resolution for `objectstack serve`.
 *
 * Extracted from serve.ts so the driver dispatch is unit-testable in isolation
 * (mirrors utils/telemetry-datasource.ts and utils/plugin-detection.ts). Two
 * concerns:
 *
 *   1. {@link resolveDriverType} — pick a canonical driver KIND from the
 *      explicit `OS_DATABASE_DRIVER` override plus the `OS_DATABASE_URL` scheme.
 *   2. {@link resolveStorageDefinition} — translate that kind + URL into the
 *      `default` datasource DEFINITION (`{ driverId, config }`). Since #3826
 *      the CLI constructs no driver here: the runtime's
 *      `DefaultDatasourcePlugin` connects the definition at boot through the
 *      shared `DatasourceConnectionService`, so the config-load fallback shares
 *      the same connect path, failure verdict, and escape hatch as every other
 *      datasource.
 *
 * ## #3276 — the `memory` driver was advertised but had no dispatch branch
 *
 * `os dev` / `os start` / `os serve` all advertise a `memory` driver
 * (`--database-driver memory`, `OS_DATABASE_DRIVER=memory`, and a `memory://`
 * URL scheme). But the old inline dispatch had no `memory` case, so selecting it
 * silently fell through to the dev SQLite `:memory:` default — SQLite-in-memory,
 * a *different* engine — or, in production, registered no driver at all. The
 * URL-inference and construction branches below close that "declared ≠ enforced"
 * gap: `memory` now yields the mingo `InMemoryDriver`, in dev AND production,
 * exactly as requested.
 *
 * Note the deliberate distinction from SQLite's own `:memory:` pseudo-file:
 * `OS_DATABASE_URL=:memory:` stays `sqlite` (SQLite's in-memory mode), whereas
 * the `memory://` scheme and the `memory` driver select the mingo engine.
 *
 * ## #5602 — `libsql://` is now WIRED, through an optional package
 *
 * `turso`/libSQL used to be the mirror image of the #3276 bug: recognized as a
 * kind and then refused, because `@objectstack/driver-turso` shipped outside the
 * open-source distribution. #4645 moved that package into this repo, which
 * retired the reason for the refusal — while `os start`'s own help still
 * advertised `--database libsql://my-db.turso.io`, an example that exited 1.
 *
 * The maintainer's ruling (#5602, 2026-08-06) wires it as an **optional peer +
 * dynamic import**: `libsql://` / `*.turso.io` resolves to a `turso` definition,
 * and the CLI loads {@link loadTursoDriverFactory} to build the driver. The
 * package is NOT a hard dependency — it drags `@libsql/client`, so a default
 * install stays as light as it was. When it is absent the boot fails LOUDLY with
 * the exact install command ({@link MissingDriverPackageError}); it never falls
 * back to SQLite, which is the #3276 lesson kept intact: a silent step-down onto
 * a *different* engine writes an operator's data into the wrong database.
 */

import type {
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from '@objectstack/service-datasource';
import {
  type BuiltinDriverId,
  DATABASE_DRIVER_SELECTION_ALIASES,
  driverHasLocalDefault,
  resolveDatabaseDriverId,
} from '@objectstack/spec/data';

/** Engines the shared sqlite step-down (`resolveSqliteDriver`) can produce. */
export type SqliteFamilyEngine = 'better-sqlite3' | 'sqlite-wasm' | 'memory';

/** The optional package that provides the libSQL/Turso driver. */
export const TURSO_DRIVER_PACKAGE = '@objectstack/driver-turso';

/**
 * Where each no-local-default kind's connection target actually comes from —
 * the one clause that differs between their otherwise identical refusals.
 *
 * Covers exactly the kinds the shared table marks `hasLocalDefault: false`.
 * That set is runtime data from `@objectstack/spec`, not a type, so the
 * completeness of this table is pinned by a test rather than by the compiler
 * (`driver-vocabulary-parity.test.ts`) — the point either way is that a driver
 * cannot get another driver's example and send an operator to the wrong server.
 */
const MISSING_URL_EXAMPLES: Readonly<Partial<Record<BuiltinDriverId, string>>> = {
  postgres: 'postgres://user:password@host:5432/dbname',
  mysql: 'mysql://user:password@host:3306/dbname',
  mongodb: 'mongodb://host:27017/dbname (or mongodb+srv://…)',
  turso:
    'libsql://my-db.turso.io with OS_DATABASE_AUTH_TOKEN / --database-auth-token, '
    + 'or file:./data/objectstack.db for a local libSQL file',
};

/**
 * The refusal for "you named a driver whose database lives somewhere I cannot
 * guess, and then did not tell me where" (#6345 fork 2).
 *
 * Generalized from the wording `turso` has carried since #5602, because that
 * wording was already right for every one of these kinds — the maintainer's
 * ruling is that all four say it, on both hosts, instead of three of them
 * inventing a different wrong default. It is a FIX instruction: it names the
 * variable to set, shows the shape, and states what booting anyway would have
 * cost, because the failure it replaces (connecting to some localhost the
 * operator never named) is one that LOOKS like success.
 */
function missingUrlMessage(kind: BuiltinDriverId): string {
  // The fallback is deliberately TRUE rather than borrowed from another arm: a
  // driver added to the shared table with `hasLocalDefault: false` and no example
  // here still gets a correct instruction. `driver-vocabulary-parity.test.ts` pins
  // that every such id HAS an example, so the generic branch stays unused rather
  // than quietly becoming the normal answer.
  const example = MISSING_URL_EXAMPLES[kind] ?? 'the URL of the database this driver connects to';
  return (
    `The \`${kind}\` driver was selected (OS_DATABASE_DRIVER / --database-driver) but no database `
    + `URL was given, and ${kind} has no local default to fall back on — its database lives on a `
    + 'server or endpoint this process cannot guess. Set OS_DATABASE_URL (or --database) to it — '
    + `e.g. ${example}. Booting on a guessed default instead would connect you `
    + 'to a database you never named, and every write would land in the wrong place (#3276).'
  );
}

/**
 * Thrown by {@link resolveStorageDefinition} for a driver selection that cannot
 * become a datasource definition. Two cases since #6345:
 *
 *  - a spelling no builtin claims (`--database-driver sqlite3`), which used to
 *    fall through to the dev SQLite default while `os migrate` refused the same
 *    value by name;
 *  - a recognized kind with **no local default** selected with **no URL**
 *    (`postgres` / `mysql` / `mongodb` / `turso`). Only `turso` refused before;
 *    the other three guessed — `url: undefined` into `pg`, an invented
 *    `mongodb://localhost:27017/objectstack` — and connected an operator to a
 *    database they never named. The ruling generalizes the refusal instead.
 *
 * Not the "package missing" case: that is {@link MissingDriverPackageError}, which
 * says something completely different to the operator (install this, versus tell me
 * where the database is).
 *
 * The whole point of surfacing this as a *typed* error is so `serve.ts` can fail
 * LOUDLY (fatal) instead of letting the selection fall through to the SQLite
 * default. That silent fall-through is the same "declared ≠ enforced" bug as
 * #3276 (the CLI advertised `memory`/`turso` but had no dispatch branch, so both
 * silently became SQLite-in-memory).
 */
export class UnsupportedDriverError extends Error {
  /**
   * The selection that was refused.
   *
   * Read {@link recognized} before treating this as a driver id: for the
   * unknown-spelling case it is the operator's raw token (`sqlite3`), NOT a
   * canonical kind.
   */
  readonly driverType: string;
  /**
   * Was the refused selection a driver this CLI KNOWS (`turso` with no URL), or
   * a spelling nothing claims (`--database-driver sqlite3`)?
   *
   * Both are fatal and both are this class — `serve.ts` re-throws on the type,
   * and an operator needs the same "stop, do not fall back to SQLite" outcome
   * either way. But they are not the same fact, and a consumer asking "which
   * driver kinds exist" must not read an unrecognized token as one.
   *
   * That consumer is real: `commands/database-driver-allowlist.pin.test.ts`
   * (#6860) derives the canonical kinds by using {@link resolveStorageDefinition}
   * as its oracle and reading `driverType` out of this error. When #6345 taught
   * the resolver to refuse unknown spellings too, that oracle started reporting
   * every stray string literal in this file (`safe`, `on-disconnect`, `factory`)
   * as a driver kind. This flag is what keeps the two answers apart.
   */
  readonly recognized: boolean;
  constructor(driverType: string, message: string, opts: { recognized?: boolean } = {}) {
    super(message);
    this.name = 'UnsupportedDriverError';
    this.driverType = driverType;
    // Defaults to `true` so the pre-#6345 call sites (turso with no URL) keep
    // their meaning without restating it.
    this.recognized = opts.recognized ?? true;
  }
}

/**
 * Thrown by {@link loadTursoDriverFactory} when the OPTIONAL driver package the
 * selected kind needs is not installed (#5602).
 *
 * Carries the install command as data as well as prose, so a caller can render it
 * however it likes, and so the pin test asserts the command rather than a sentence
 * shape. `serve.ts` re-throws it as a fatal boot error — there is deliberately NO
 * fallback branch: degrading a `libsql://` selection to SQLite would boot the
 * server against an empty local file while the operator's remote data sits
 * untouched, and every write would land in the wrong database (#3276).
 */
export class MissingDriverPackageError extends Error {
  readonly driverType: string;
  readonly packageName: string;
  readonly installCommand: string;
  constructor(args: { driverType: string; packageName: string; installCommand: string; message: string }) {
    super(args.message);
    this.name = 'MissingDriverPackageError';
    this.driverType = args.driverType;
    this.packageName = args.packageName;
    this.installCommand = args.installCommand;
  }
}

/**
 * Infer a canonical driver kind from an `OS_DATABASE_URL` scheme.
 * Returns `''` when the URL is absent or its scheme is unrecognized (the caller
 * then falls back to the dev default / registers nothing in production).
 */
export function inferDriverTypeFromUrl(url: string | undefined): string {
  if (!url) return '';
  const u = url.trim();
  if (/^mongodb(\+srv)?:\/\//i.test(u)) return 'mongodb';
  if (/^postgres(ql)?:\/\//i.test(u)) return 'postgres';
  if (/^mysql2?:\/\//i.test(u)) return 'mysql';
  // libSQL / Turso URLs classify as `turso`, and since #5602 that classification
  // CONSTRUCTS: resolveStorageDefinition returns a `turso` definition and the CLI
  // loads @objectstack/driver-turso (an optional package) to build it. Leaving them
  // unrecognized — returning '' — would fall through to the SQLite default and
  // silently ignore the remote connection, which is the bug this branch exists for;
  // that stays true whether the driver package is installed (connect) or not (loud
  // MissingDriverPackageError).
  if (/^libsql:\/\//i.test(u)) return 'turso';
  if (/^https?:\/\//i.test(u) && /\.turso\./i.test(u)) return 'turso';
  if (/^wasm-sqlite:\/\//i.test(u) || /\.wasm\.db$/i.test(u)) return 'sqlite-wasm';
  // #3276: the mingo in-memory engine has its own URL scheme (`memory://`,
  // advertised in `os dev` / `os start` help). Kept ABOVE the sqlite test so it
  // is not shadowed, and deliberately distinct from sqlite's `:memory:`
  // pseudo-file below (which stays SQLite's own in-memory mode).
  if (/^(memory|mingo):\/\//i.test(u)) return 'memory';
  if (/^file:/i.test(u) || /^sqlite:/i.test(u) || u === ':memory:' || /\.(db|sqlite|sqlite3)$/i.test(u)) return 'sqlite';
  return '';
}

/**
 * Combine the explicit `OS_DATABASE_DRIVER` override with URL-scheme inference
 * into the canonical driver kind. An explicit driver always wins over the URL.
 */
export function resolveDriverType(
  explicitDriver: string | undefined,
  databaseUrl: string | undefined,
): string {
  const explicit = (explicitDriver ?? '').toLowerCase().trim();
  return explicit || inferDriverTypeFromUrl(databaseUrl);
}

export interface ResolveStorageDefinitionOptions {
  /** Raw `OS_DATABASE_URL` (scheme stripped per-branch, as the old constructor did). */
  databaseUrl?: string;
  /** Dev mode — arms the sqlite step-down + the loosen-only auto-migrate (#2186). */
  isDev: boolean;
  /**
   * `OS_DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN` (`--database-auth-token`) — the
   * libSQL/Turso JWT. Read only by the `turso` branch; every other kind carries its
   * credentials inside the URL. It rides in the definition's `config` exactly like
   * the postgres/mysql password rides inside `config.url`: the config reaches the
   * driver factory and nothing else — the boot banner redacts it
   * (`redactConnectionUrl`) and no code-origin definition is persisted.
   */
  authToken?: string;
}

/**
 * A `default`-datasource DEFINITION for a canonical driver kind (#3826).
 *
 * This replaced `createStorageDriver`: serve no longer constructs a driver and
 * wraps it in `DriverPlugin` — it hands `{ driverId, config }` to the runtime's
 * `DefaultDatasourcePlugin`, which connects it at boot through the shared
 * `DatasourceConnectionService` (one connect path, one failure verdict, one
 * `OS_ALLOW_DRIVER_CONNECT_FAILURE` escape hatch, retained status in
 * Setup → Datasources). URL→config translation stays here — a host concern,
 * exactly like `standalone-stack`'s.
 *
 * Two knowingly-static fields, because nothing is constructed yet:
 *  - `label`/`trackName` name the REQUESTED engine. The dev sqlite step-down
 *    (#2229) may resolve to wasm/in-memory at connect; its own banner says so.
 *  - `sqliteFilePath` keys the telemetry-sibling provisioning. The old
 *    `resolution.engine !== 'memory'` refinement is unknowable pre-connect;
 *    the telemetry provision's OWN step-down check (`telemetry.engine !==
 *    'memory'`) still guards the ABI-broken case.
 */
export interface StorageDefinitionResolution {
  /** Driver id the shared datasource factory can build. */
  driverId: string;
  /** Factory config, incl. the `autoMigrate`/`persist` host passthroughs. */
  config: Record<string, unknown>;
  /** Short name for the boot banner's plugin list (serve.ts `trackPlugin`). */
  trackName: string;
  /** Human label for the startup banner's "driver" row (requested engine). */
  label: string;
  /** Display-shaped database URL for the startup banner (e.g. `(in-memory)`). */
  displayUrl: string | undefined;
  /** On-disk sqlite path the telemetry datasource is provisioned next to. */
  sqliteFilePath?: string;
}

/**
 * Resolve the `default` datasource definition for a canonical driver kind.
 * Returns `null` when nothing matches and we are NOT in dev (production with an
 * unknown/absent driver registers no datasource, so the missing driver surfaces
 * loudly downstream — the pre-#3826 behavior).
 *
 * Throws {@link UnsupportedDriverError} for a recognized kind that cannot become a
 * definition at all — today only `turso`/libSQL selected with no URL to connect to.
 * serve.ts surfaces that as a fatal, actionable boot error so the selection never
 * silently degrades to SQLite. (The other libSQL failure — the optional driver
 * package not installed — belongs to {@link loadTursoDriverFactory}, not here: this
 * function is synchronous and does no I/O.)
 */
export function resolveStorageDefinition(
  driverType: string,
  opts: ResolveStorageDefinitionOptions,
): StorageDefinitionResolution | null {
  const { databaseUrl, isDev, authToken } = opts;
  // #2186: dev-only loosen-only self-heal, honored by the factory for the SQL
  // kinds. Never in production, never destructive.
  const autoMigrate = isDev ? ({ autoMigrate: 'safe' } as const) : {};

  // ONE vocabulary since #6345 (`@objectstack/spec`'s driver table). The arms
  // below therefore branch on the CANONICAL id and never on a spelling: the
  // hand-written `driverType === 'pg' || driverType === 'postgresql'` chains
  // were half of the fork this card closes — the standalone stack's enum had
  // its own answer, and 10 of 21 spellings disagreed.
  const kind = resolveDatabaseDriverId(driverType);

  // An EXPLICIT selection nothing claims is refused, loudly (#6345 fork 1).
  //
  // `driverType` is `explicit || inferDriverTypeFromUrl(url)`, and the inferring
  // half only ever yields a canonical id or `''` — so a non-empty value that
  // resolves to nothing can only have come from an operator naming a driver.
  // It used to fall through to the trailing dev default, i.e. `os dev
  // --database-driver sqlite3` silently booted SQLite while `os migrate` refused
  // the same value by name. #6344 killed that silent fallback on the standalone
  // side; this is its mirror, and it is what makes the two hosts answer the same
  // question the same way for EVERY input rather than only for the legal ones.
  if (driverType && !kind) {
    throw new UnsupportedDriverError(
      driverType,
      `Unsupported driver "${driverType}" (OS_DATABASE_DRIVER / --database-driver). `
        + `Supported drivers: ${DATABASE_DRIVER_SELECTION_ALIASES.join(', ')}. `
        + 'Booting on the SQLite default instead would silently ignore the driver you asked for '
        + 'and write into a local database (#3276). Fix the value, or leave the driver unset to '
        + 'let the database URL scheme select it.',
      // NOT a driver kind — `driverType` here is the operator's raw token, and a
      // caller enumerating kinds must not count it as one.
      { recognized: false },
    );
  }

  // Fork 2 (#6345): a kind with NO local default, selected with no URL. Every
  // such selection used to be answered by a guess, differently on each side:
  // postgres/mysql got `config.url === undefined` and the `pg`/`mysql2` client
  // then connected to ITS own localhost; mongodb got an invented
  // `mongodb://localhost:27017/objectstack`. Both connect an operator to a
  // database they never named, which is the #3276 class. `turso` already had
  // this refusal; the maintainer's ruling generalizes it rather than leaving
  // one kind honest and three guessing.
  if (kind && !(databaseUrl ?? '').trim() && !driverHasLocalDefault(kind)) {
    throw new UnsupportedDriverError(kind, missingUrlMessage(kind));
  }

  if (kind === 'mongodb') {
    const url = databaseUrl!;
    return {
      driverId: 'mongodb',
      config: { url },
      trackName: 'MongoDBDriver',
      label: 'MongoDBDriver',
      displayUrl: url,
    };
  }

  if (kind === 'sqlite') {
    const filePath = (databaseUrl ?? ':memory:')
      .replace(/^file:/, '')
      .replace(/^sqlite:/, '')
      .replace(/^sql:\/\//, '');
    return {
      driverId: 'sqlite',
      config: { filename: filePath, ...autoMigrate },
      trackName: 'SqlDriver',
      label: 'SqlDriver(better-sqlite3)',
      displayUrl: databaseUrl ?? ':memory:',
      // Only the explicit sqlite kind gets a telemetry sibling — never the
      // dev-default `:memory:` branch below (resolveTelemetryDbPath also
      // returns undefined for `:memory:`; both gates preserved).
      sqliteFilePath: filePath,
    };
  }

  if (kind === 'sqlite-wasm') {
    const filePath = (databaseUrl ?? ':memory:')
      .replace(/^file:/, '')
      .replace(/^wasm-sqlite:\/\//, '')
      .replace(/^sqlite:/, '');
    return {
      driverId: 'sqlite-wasm',
      // `persist` passthrough: the CLI kept `on-disconnect` semantics here
      // (the factory's default for file-backed wasm is `on-write`).
      config: { filename: filePath, persist: 'on-disconnect' },
      trackName: 'SqliteWasmDriver',
      label: 'SqliteWasmDriver',
      displayUrl: databaseUrl ?? ':memory:',
    };
  }

  if (kind === 'postgres') {
    return {
      driverId: 'postgres',
      config: { url: databaseUrl, ...autoMigrate },
      trackName: 'PostgresDriver',
      label: 'SqlDriver(pg)',
      displayUrl: databaseUrl,
    };
  }

  if (kind === 'mysql') {
    return {
      driverId: 'mysql',
      config: { url: databaseUrl, ...autoMigrate },
      trackName: 'MySQLDriver',
      label: 'SqlDriver(mysql2)',
      displayUrl: databaseUrl,
    };
  }

  // turso / libSQL (#5602): a real definition. The driver itself is built by
  // loadTursoDriverFactory() from the OPTIONAL `@objectstack/driver-turso` package,
  // injected into DefaultDatasourcePlugin as its host factory — the documented seam
  // for "a `default` whose driver the open-core factory cannot build". The connect,
  // the bootCritical fail-fast verdict, the OS_ALLOW_DRIVER_CONNECT_FAILURE escape
  // hatch and the retained Setup → Datasources status are therefore identical to
  // every other kind (#3826); only the construction differs.
  //
  // No `autoMigrate` passthrough: unlike the postgres/mysql/sqlite branches,
  // `TursoDriverConfig` declares no such key, and handing it one would be a config
  // the driver silently ignores. No `sqliteFilePath` either — the telemetry sibling
  // is provisioned next to an on-disk SQLite primary, which a libSQL endpoint is not.
  if (kind === 'turso') {
    // The no-URL refusal is the shared one above; by here a URL is present.
    const url = databaseUrl!.trim();
    return {
      driverId: 'turso',
      config: { url, ...(authToken ? { authToken } : {}) },
      trackName: 'TursoDriver',
      label: 'TursoDriver(libsql)',
      displayUrl: url,
    };
  }

  // #3276: explicit in-memory (mingo) driver. Honored in dev AND production — an
  // operator asking for `memory` gets the mingo InMemoryDriver (ephemeral, not
  // real SQL), never the SQLite `:memory:` default.
  if (kind === 'memory') {
    return {
      driverId: 'memory',
      config: {},
      trackName: 'MemoryDriver',
      label: 'InMemoryDriver',
      displayUrl: '(in-memory)',
    };
  }

  // Default (no driver configured): dev prefers native SQLite for production-like
  // SQL at native speed; the factory's step-down (#2229) degrades to wasm then
  // in-memory when the native binary is unavailable. Production returns null so
  // a missing driver surfaces loudly downstream.
  if (isDev) {
    return {
      driverId: 'sqlite',
      config: { filename: ':memory:', ...autoMigrate },
      trackName: 'SqlDriver',
      label: 'SqlDriver(better-sqlite3)',
      displayUrl: ':memory:',
      // No sqliteFilePath: the dev-default `:memory:` store never gets a
      // telemetry sibling.
    };
  }

  return null;
}

/**
 * True for the driver ids {@link loadTursoDriverFactory}'s factory builds.
 *
 * Resolved through the shared table since #6345 rather than a local `Set`, so
 * "which spellings mean libSQL" has one answer across the CLI, the standalone
 * stack and the metadata gate.
 */
export function isTursoDriverId(driverId: string): boolean {
  return resolveDatabaseDriverId(driverId) === 'turso';
}

/** The exact command an operator runs to install the optional libSQL driver. */
export const TURSO_DRIVER_INSTALL_COMMAND = `npm install ${TURSO_DRIVER_PACKAGE}`;

export interface LoadTursoDriverFactoryOptions {
  /**
   * Test seam: substitute the dynamic `import('@objectstack/driver-turso')`.
   * Production passes nothing. Tests pass a stub module (dispatch WITH the package)
   * or a rejecting thunk (dispatch WITHOUT it) — neither needs a real Turso
   * endpoint, and the missing-package path must be testable in a workspace where
   * the package happens to be installed.
   */
  importDriverPackage?: () => Promise<unknown>;
}

/**
 * Load the OPTIONAL libSQL/Turso driver package and wrap it as the host driver
 * factory `DefaultDatasourcePlugin` accepts (#5602).
 *
 * The package is an **optional peer** of the CLI: it drags `@libsql/client`
 * (native bindings included), so making it a hard dependency would weigh down every
 * `npx create-objectstack` install for a backend most projects do not use. The
 * import therefore happens here, at boot, only for a selection that actually asks
 * for libSQL.
 *
 * Absent package ⇒ {@link MissingDriverPackageError}, carrying the exact install
 * command. There is no other branch: the caller must not fall back to SQLite (see
 * the class docstring), and the failure is raised BEFORE the plugin is registered so
 * the operator gets one clear message instead of a connect error later in boot.
 */
export async function loadTursoDriverFactory(
  opts: LoadTursoDriverFactoryOptions = {},
): Promise<IDatasourceDriverFactory> {
  const load = opts.importDriverPackage ?? (() => import('@objectstack/driver-turso'));

  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    throw new MissingDriverPackageError({
      driverType: 'turso',
      packageName: TURSO_DRIVER_PACKAGE,
      installCommand: TURSO_DRIVER_INSTALL_COMMAND,
      message:
        `A libSQL/Turso database was selected, but the driver package ${TURSO_DRIVER_PACKAGE} `
        + `is not installed. Install it next to the CLI:\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`
        + `(pnpm add ${TURSO_DRIVER_PACKAGE} / yarn add ${TURSO_DRIVER_PACKAGE}.) It is an `
        + 'OPTIONAL peer dependency, so a default install stays free of @libsql/client. '
        + 'The boot refuses rather than falling back to SQLite: a silent fallback would start '
        + 'the server against an empty local database while your libSQL data stays untouched, '
        + 'and every write would land in the wrong place. To use SQLite deliberately, set '
        + 'OS_DATABASE_URL=file:./data/objectstack.db (or --database file:./data/objectstack.db). '
        + `Import error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const record = (mod ?? {}) as { TursoDriver?: unknown; default?: { TursoDriver?: unknown } };
  const TursoDriverCtor = (record.TursoDriver ?? record.default?.TursoDriver) as
    | (new (config: { url: string; authToken?: string }) => object)
    | undefined;
  if (typeof TursoDriverCtor !== 'function') {
    // Resolvable but not the module we expect (a shadowing stub, a truncated
    // install, an incompatible major that renamed its export). Same operator
    // remedy, so the same typed error — never a fallback.
    throw new MissingDriverPackageError({
      driverType: 'turso',
      packageName: TURSO_DRIVER_PACKAGE,
      installCommand: TURSO_DRIVER_INSTALL_COMMAND,
      message:
        `${TURSO_DRIVER_PACKAGE} resolved but exports no TursoDriver class, so the libSQL `
        + `database cannot be opened. Reinstall it:\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`
        + 'The boot refuses rather than falling back to SQLite, which would write your data '
        + 'into a different database than the one you configured.',
    });
  }

  return {
    supports: (driverId: string) => isTursoDriverId(driverId),
    create: (spec: DatasourceConnectionSpec): DatasourceDriverHandle => {
      const config = (spec.config ?? {}) as { url?: unknown; authToken?: unknown };
      const url = typeof config.url === 'string' ? config.url : '';
      if (!url) {
        throw new UnsupportedDriverError(
          'turso',
          `datasource '${spec.name ?? 'default'}': driver '${spec.driver}' needs a libSQL url in its `
            + 'config (e.g. libsql://my-db.turso.io or file:./data/objectstack.db).',
        );
      }
      const driver = new TursoDriverCtor({
        url,
        ...(typeof config.authToken === 'string' && config.authToken
          ? { authToken: config.authToken }
          : {}),
      }) as {
        connect?: () => Promise<void>;
        disconnect?: () => Promise<void>;
        checkHealth?: () => Promise<boolean>;
      };
      // Same handle shape the open-core factory builds (`toHandle`): ownership
      // stays the default `'factory'` — this instance was built for THIS connect,
      // so kernel teardown disconnects it.
      return {
        ...(typeof driver.connect === 'function' ? { connect: () => driver.connect!() } : {}),
        ...(typeof driver.disconnect === 'function' ? { disconnect: () => driver.disconnect!() } : {}),
        ...(typeof driver.checkHealth === 'function'
          ? { checkHealth: () => driver.checkHealth!(), ping: () => driver.checkHealth!() }
          : {}),
        driver,
      };
    },
  };
}
