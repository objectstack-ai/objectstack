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
 */

/** Engines the shared sqlite step-down (`resolveSqliteDriver`) can produce. */
export type SqliteFamilyEngine = 'better-sqlite3' | 'sqlite-wasm' | 'memory';

/**
 * Thrown by {@link resolveStorageDefinition} when a driver kind is *recognized* but this
 * resolver does not construct it — currently `turso`/libSQL (`@objectstack/driver-turso`,
 * an extension of SqlDriver over `@libsql/client`). Since #4645 that package lives in
 * this repo (`packages/drivers/driver-turso`), but the CLI still does not build it from
 * a URL: it is registered explicitly in a stack config, or composed by a host's own
 * kernel factory. Whether URL inference should construct it is #5602.
 *
 * The whole point of surfacing this as a *typed* error is so `serve.ts` can fail
 * LOUDLY (fatal) instead of letting the selection fall through to the SQLite
 * default. That silent fall-through is the same "declared ≠ enforced" bug as
 * #3276 (the CLI advertised `memory`/`turso` but had no dispatch branch, so both
 * silently became SQLite-in-memory).
 */
export class UnsupportedDriverError extends Error {
  readonly driverType: string;
  constructor(driverType: string, message: string) {
    super(message);
    this.name = 'UnsupportedDriverError';
    this.driverType = driverType;
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
  // libSQL / Turso URLs are DELIBERATELY still classified as `turso` (not left
  // unrecognized). This resolver does not construct that driver, but classifying it
  // lets resolveStorageDefinition fail LOUDLY with an actionable message — if we
  // returned '' here instead, a `libsql://` URL would fall through to the SQLite
  // default and silently ignore the remote connection (the very bug we're fixing).
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
 * Throws {@link UnsupportedDriverError} for `turso`/libSQL — recognized as a kind
 * but not one this resolver constructs. (#4645 moved `@objectstack/driver-turso`
 * into this repo at `packages/drivers/driver-turso`; wiring it into URL inference
 * is a separate decision — #5602 — so the loud refusal stands unchanged.)
 * serve.ts surfaces that as a fatal, actionable boot error so the selection never
 * silently degrades to SQLite.
 */
export function resolveStorageDefinition(
  driverType: string,
  opts: ResolveStorageDefinitionOptions,
): StorageDefinitionResolution | null {
  const { databaseUrl, isDev } = opts;
  // #2186: dev-only loosen-only self-heal, honored by the factory for the SQL
  // kinds. Never in production, never destructive.
  const autoMigrate = isDev ? ({ autoMigrate: 'safe' } as const) : {};

  if (driverType === 'mongodb' || driverType === 'mongo') {
    const url = databaseUrl ?? 'mongodb://localhost:27017/objectstack';
    return {
      driverId: 'mongodb',
      config: { url },
      trackName: 'MongoDBDriver',
      label: 'MongoDBDriver',
      displayUrl: url,
    };
  }

  if (driverType === 'sqlite' || driverType === 'sql') {
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

  if (driverType === 'sqlite-wasm' || driverType === 'wasm-sqlite' || driverType === 'wasm') {
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

  if (driverType === 'postgres' || driverType === 'postgresql' || driverType === 'pg') {
    return {
      driverId: 'postgres',
      config: { url: databaseUrl, ...autoMigrate },
      trackName: 'PostgresDriver',
      label: 'SqlDriver(pg)',
      displayUrl: databaseUrl,
    };
  }

  if (driverType === 'mysql' || driverType === 'mysql2') {
    return {
      driverId: 'mysql',
      config: { url: databaseUrl, ...autoMigrate },
      trackName: 'MySQLDriver',
      label: 'SqlDriver(mysql2)',
      displayUrl: databaseUrl,
    };
  }

  // turso / libSQL: recognized but NOT constructible by the open-core CLI. The
  // driver (`@objectstack/driver-turso`) ships in the cloud / enterprise
  // distribution and is composed by the cloud runtime's own kernel factory.
  // Fail LOUDLY here rather than let the selection fall through to the SQLite
  // default (the reported "declared ≠ enforced" bug): serve.ts turns this typed
  // error into a fatal, actionable boot message.
  if (driverType === 'turso' || driverType === 'libsql') {
    throw new UnsupportedDriverError(
      'turso',
      'The `turso`/libSQL driver (@objectstack/driver-turso) is not one the CLI '
        + 'constructs from a URL — it is not bundled into the CLI\'s driver '
        + 'resolver. To use it, register it explicitly in your stack config (a '
        + "datasource with driver: 'turso' and config { url, authToken }, with "
        + '@objectstack/driver-turso installed). Otherwise select a CLI-resolvable '
        + 'driver via OS_DATABASE_DRIVER / OS_DATABASE_URL: '
        + 'sqlite | postgres | mysql | mongodb | memory.',
    );
  }

  // #3276: explicit in-memory (mingo) driver. Honored in dev AND production — an
  // operator asking for `memory` gets the mingo InMemoryDriver (ephemeral, not
  // real SQL), never the SQLite `:memory:` default.
  if (driverType === 'memory' || driverType === 'mingo' || driverType === 'in-memory') {
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
