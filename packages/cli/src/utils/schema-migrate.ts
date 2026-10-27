// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared boot + rendering for `os migrate` (issue #2186).
 *
 * Boots the data stack (driver + ObjectQL + the compiled artifact's objects)
 * via the supported `createStandaloneStack` programmatic entry, runs schema
 * sync, and hands back the live SQL driver so the command can call
 * `detectManagedDrift()` / `applyMigrationEntries()`.
 *
 * Migration only ever sees the objects this boot REGISTERED; tables/columns
 * outside that set are never examined or altered. The two SCHEMA commands
 * (`plan`/`apply`) therefore pass `composeHostStack` so the set is the one the
 * deployment's own `os serve` boot registers — its `objectstack.config.ts` plus
 * the platform floor `serve` composes unconditionally (#12938) — and
 * `composeServedPlatform`, so it includes what `serve` mounts around the stack:
 * the auth family behind its auth gate and the provider of every capability it
 * resolves (#22506). The DATA subcommands keep their own narrower set
 * (`./data-migration-plugins.ts`).
 * A project with neither a config nor a compiled artifact still diffs the data
 * stack alone — run `os build` first so its objects are visible.
 *
 * The boot's first input is the environment, and it is the one the serving
 * commands read: the project's `.env*` files are loaded before anything
 * resolves a database or a secret ({@link loadProjectEnvFiles}, #22581), and
 * the stack reports which database it opened and who named it
 * ({@link SchemaStack.dbSource}).
 *
 * Its datasources are the serving boot's too: when `os dev` / `os serve` would
 * keep lifecycle-classed objects in a `telemetry` sibling database (ADR-0057
 * §3.6), this boot provisions that sibling through the same helper
 * (`provisionTelemetryDatasource`, #22579), and the plan diffs and applies each
 * object against the database it lives in ({@link SchemaStack.detectManagedDrift}).
 *
 * [#24120] …and so are the datasources the deployment DECLARES. A serving boot
 * connects every managed datasource its `datasourceMapping` routes objects to
 * (or an object binds) through the `datasource-connection` service, under the
 * datasource's declared name — so a `{ default: true, datasource: 'main' }`
 * rule puts every object, platform objects included, in `main`. `os migrate
 * plan` / `apply` compose that same service ({@link DeclaredDatasourceConnectionPlugin}),
 * and plan each such datasource's driver beside the primary
 * ({@link SchemaStack.drivers}). Without it the boot resolved the declared
 * default's LOCATION as its primary but registered no driver under its name,
 * so every object the rule routed there was bound to no driver: `Examined 0
 * managed table(s)` over the database whose drift `os dev` reports, and names
 * this command for.
 */
import path from 'node:path';
import chalk from 'chalk';
import dotenvFlow from 'dotenv-flow';
import type {
  ManagedDriftEntry,
  DriftCategory,
  DriftOp,
  MediaColumnMoveScan,
  PendingSchemaWork,
} from '@objectstack/driver-sql';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID, StorageNameMapping } from '@objectstack/spec/system';
import { isDevelopmentBoot } from '@objectstack/core';
import {
  doctorNodeEnv,
  provenanceOf,
  readDotenvFiles,
  type DotenvReading,
} from '../commands/doctor.js';
import { describeDriverConnection, describeDriverSqliteFile } from './connection-display.js';
import { reserveStdoutForJson } from './json-stdout.js';
import {
  buildSchemaMigrationPlugins,
  measureComposedCoverage,
  type SchemaMigrationComposition,
} from './schema-migration-plugins.js';
import {
  provisionTelemetryDatasource,
  standaloneTelemetryPrimary,
  TELEMETRY_DATASOURCE,
} from './telemetry-datasource.js';

export type { PendingSchemaWork };

export interface SqlDriverLike {
  detectManagedDrift(): Promise<ManagedDriftEntry[]>;
  applyMigrationEntries(
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean },
  ): Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }>;
  /**
   * The ADR-0104 file-family column step's read-only planner (#15989) —
   * optional, so a driver with no media arm (every driver that is not this
   * repo's SQL one, and an older published build of it) still boots and simply
   * offers no plan. ⛔ Its absence must read as "cannot plan", never as
   * "nothing to move": the two are the same shape from here, and only the
   * caller's own refusal branch can tell an operator which it was.
   */
  planMediaColumnMove?: () => Promise<MediaColumnMoveScan>;
  /**
   * [#23816] Why this driver's drift report must not be acted on unattended,
   * or `null` / absent when it may be — `TursoDriver`'s REMOTE face declares
   * one. Read by the artifact-pinned boot gate (`./artifact-boot-migration.ts`),
   * which then neither applies nor refuses on the report.
   */
  readonly driftReportCaveat?: string | null;
  /**
   * [#23925] Why this driver's {@link applyMigrationEntries} cannot perform a
   * drift op the SQL driver's apply door performs, or `null` when it can.
   * Absent means the driver declares no such limit: its apply door applies
   * what the differ means it to. `TursoDriver`'s REMOTE face declares one (it
   * runs no SQLite table rebuild). Read by `os migrate plan` through
   * {@link SchemaStack.driftApplyLimit}, never guessed from the dialect.
   */
  driftApplyLimit?: (opType: DriftOp['type']) => string | null;
  /** Deferred-DDL surface (#3917) — optional, so a driver without it still boots. */
  setDeferredDdl?: (deferred: boolean) => void;
  previewDeferredSchemaWork?: () => Promise<PendingSchemaWork[]>;
  flushDeferredSchemaDdl?: () => Promise<PendingSchemaWork[]>;
  config?: any;
  disconnect?: () => Promise<void>;
}

export interface SchemaStack {
  /**
   * The PRIMARY datasource's SQL driver — the database {@link dbLabel} names.
   * A plan's drift is read through {@link detectManagedDrift}, which covers the
   * `telemetry` sibling as well; this is the primary alone.
   */
  driver: SqlDriverLike | null;
  dbLabel: string;
  /**
   * [#22579] The `telemetry` sibling database (ADR-0057 §3.6) this boot
   * provisioned, as the serving boot would — the file lifecycle-classed
   * objects (`audit` / `telemetry` / `event`) are planned against — or `null`
   * when the serving boot keeps them in the primary: production without
   * `OS_TELEMETRY_DB`, `OS_TELEMETRY_DB=0`, or a primary that is not a
   * file-backed SQLite database. `os migrate plan` / `apply` print it beside
   * the database in both faces.
   */
  telemetryDatabase: string | null;
  /**
   * [#22579] Every SQL driver this boot plans against, in order: the primary
   * ({@link driver}), then the `telemetry` sibling when there is one, then
   * [#24120] each declared managed datasource the boot connected for the
   * objects routed or bound to it, by name. An object whose engine-resolved
   * driver is not here is outside the plan.
   */
  drivers: readonly SqlDriverLike[];
  /**
   * [#24120] The database a planned driver ({@link drivers}) addresses, as an
   * operator reads it: {@link dbLabel} for the primary, {@link telemetryDatabase}
   * for the sibling, the connection a declared datasource's driver describes —
   * or `null` for a driver this stack does not plan.
   */
  databaseOf: (driver: SqlDriverLike) => string | null;
  /**
   * [#22579] Managed drift over every datasource this boot plans against: the
   * primary, then the `telemetry` sibling when there is one. Each entry stays
   * tied to the driver that reported it, which is where
   * {@link applyMigrationEntries} applies it. `[]` with no SQL driver.
   */
  detectManagedDrift: () => Promise<ManagedDriftEntry[]>;
  /**
   * [#22579] Apply drift {@link detectManagedDrift} returned, each entry on the
   * driver that reported it. Refuses — before applying anything — an entry
   * this stack did not report: it has no datasource to go to.
   */
  applyMigrationEntries: (
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean },
  ) => Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }>;
  /**
   * [#23925] Why {@link applyMigrationEntries} cannot perform `entry` on the
   * database that reported it, as that database's driver declares it
   * ({@link SqlDriverLike.driftApplyLimit}), or `null` when it can. Asked of
   * the driver that reported the entry, the same one the apply hands it to.
   * Refuses an entry this stack did not detect: no driver reported it.
   */
  driftApplyLimit: (entry: ManagedDriftEntry) => string | null;
  /**
   * [#22581] Who named the database {@link dbLabel} describes: `--database-url`,
   * a variable from this process's environment, one from the project's `.env*`
   * files, the config's declared datasource, or nobody (the default). `os
   * migrate plan` / `apply` print it beside the database in both faces.
   */
  dbSource: DatabaseSource;
  /**
   * [#23816] What this boot did with schema sync: `'deferred'` (held back, see
   * {@link pendingSchemaWork}), `'skipped'` (none attempted, the boot's
   * `deferredDdlUnsupported: 'skip-schema-sync'` answer for a transport that
   * cannot defer), or `'performed'` (the ordinary additive sync ran).
   */
  schemaSync: 'deferred' | 'skipped' | 'performed';
  managedTableCount: number;
  /** The booted kernel — `getService('objectql')` etc. for one-shot commands
   *  beyond schema migration. */
  kernel: any;
  /**
   * Create-table / add-column work the boot sync was held back from running
   * (#3917). Always `[]` unless the stack was booted with `deferSchemaDdl`.
   */
  pendingSchemaWork: PendingSchemaWork[];
  /**
   * [#24059] The physical tables this boot's composition declares OUTSIDE the
   * object set: the package registry's `sys_packages`, named by the same
   * `package.storage` declaration {@link pendingSchemaWork} plans it from
   * (#23022) — or `[]` when the boot composed no package registry.
   *
   * Named whether or not the table exists, and on every boot: the plan lists the
   * table as `create_table` only while it is absent, so once `os migrate apply`
   * has created it the pending work names nothing. `os migrate plan`'s
   * unmanaged-table sweep reads this, so the table the apply created is not
   * reported as declared by nothing.
   */
  nonObjectTables: readonly string[];
  /**
   * [#21529] Did this boot MEASURE `objectName`'s table as absent? `true` only
   * when the held-back sync above would CREATE it (`create_table`), which the
   * driver decides with `hasTable` — a fact about the database, not a guess
   * from a failed read. Always `false` unless the stack was booted with
   * `deferSchemaDdl`, and `false` again once {@link flushSchemaDdl} has run.
   *
   * What it is for: a read-only command does not read a table its own boot
   * deferred. A table that does not exist holds no rows, so the command
   * answers its empty work from this ("not asked") instead of issuing the read
   * and turning the refusal into a query fault. ⛔ Only `create_table` counts:
   * a table that exists but lacks a column (`add_columns`) is still read, and
   * whatever that read refuses is still reported.
   */
  tableAbsent: (objectName: string) => boolean;
  /**
   * Every object the booted stack knows about — the set the plan is computed
   * against, including objects that arrived from installed packages rather than
   * this project's `objectstack.config.ts`. Read by the ADR-0120 D5e
   * unique-scope advisory; best-effort (`[]` when no ObjectQL service composed).
   */
  allObjects: () => unknown[];
  /**
   * Perform the deferred sync — call only once the operator has confirmed the
   * plan. Returns the work it actually ran (`[]` when nothing was deferred).
   *
   * Then the organization-ownership BIRTH half the deferred boot could not
   * run ({@link recordBirthOfFlushedStore}): when this flush created the
   * ledger's store from empty, it writes the birth marker, so the first `os
   * serve` admits the database this run created. Throws when that write fails.
   */
  flushSchemaDdl: () => Promise<PendingSchemaWork[]>;
  /**
   * What the host composition added, and anything it could not (#12938) — the
   * host config it composed, whether that config actually loaded, the platform
   * floor it added, and whether the set mirrors what `os serve` registers
   * (`servedBoot`, #22580). `notes` is always `[]` unless the boot asked for
   * `composeHostStack`, and `[]` even then when there was nothing to compose,
   * so a project with neither a config nor a compiled artifact renders
   * byte-identically to before this existed.
   */
  composition: SchemaMigrationComposition;
  shutdown: () => Promise<void>;
}

/**
 * The kernel service names a SQL driver is published under, by driver: the
 * `driver.<driver.name>` key `DefaultDatasourcePlugin` / `DriverPlugin`
 * register. A name is listed per driver, never matched as a `driver.*`
 * pattern: a non-SQL driver must stay unfound, and the two methods
 * {@link findSqlDriverVia} checks are the second half of that guard.
 *
 * [#23648] `SqliteWasmDriver` (`wasm-sqlite://`, `*.wasm.db`, and the dev
 * boot's step-down from better-sqlite3) is a `SqlDriver` published as
 * `driver.com.objectstack.driver.sqlite-wasm`, measured on a `wasm-sqlite://`
 * boot. Without it every `os migrate` command found no SQL driver on such a
 * database.
 */
const SQL_DRIVER_SERVICES = [
  'driver.com.objectstack.driver.sql',
  'driver.com.objectstack.driver.turso',
  'driver.com.objectstack.driver.sqlite-wasm',
  'driver.sql',
];

/** Locate the SQL driver behind any `getService`-shaped lookup (kernel or plugin ctx). */
function findSqlDriverVia(
  getService: (name: string) => any,
  names: readonly string[] = SQL_DRIVER_SERVICES,
): SqlDriverLike | null {
  for (const name of names) {
    let d: any;
    try { d = getService(name); } catch { /* not registered */ }
    if (d && typeof d.detectManagedDrift === 'function' && typeof d.applyMigrationEntries === 'function') {
      return d as SqlDriverLike;
    }
  }
  return null;
}

function findSqlDriver(kernel: any): SqlDriverLike | null {
  return findSqlDriverVia((name) => kernel?.getService?.(name));
}

/**
 * [#22579] The `telemetry` sibling's SQL driver, under the service name its
 * `DriverPlugin` published (`driver.telemetry`) — the same instance the engine
 * routes lifecycle-classed objects to.
 */
function findTelemetryDriver(kernel: any): SqlDriverLike | null {
  return findSqlDriverVia((name) => kernel?.getService?.(name), [`driver.${TELEMETRY_DATASOURCE}`]);
}

/**
 * The same lookup, for callers that already hold a booted kernel (#8368's
 * artifact-boot migration gate) instead of booting one through
 * {@link bootSchemaStack}.
 *
 * Exported rather than re-derived at the call site so there stays ONE list of
 * SQL-driver service names: a second copy would silently stop finding a driver
 * the day a kind is added here, and "no SQL driver" is this gate's own
 * everything-is-fine answer — the quietest possible way for a boot policy to
 * stop running.
 */
export function findSqlDriverForKernel(kernel: unknown): SqlDriverLike | null {
  return findSqlDriver(kernel);
}

/**
 * The kernel services under which `ObjectQLPlugin.init()` publishes the engine.
 * Both names point at one `ObjectQL` instance; it is shadowed once.
 */
const ENGINE_SERVICES = ['objectql', 'data'] as const;

/** One order for deferred work, whichever drivers it came from: the driver's own. */
function sortPendingSchemaWork(work: PendingSchemaWork[]): PendingSchemaWork[] {
  return work.sort((a, b) => a.table.localeCompare(b.table) || a.kind.localeCompare(b.kind));
}

/**
 * [#23022] The kernel service under which `PackageServicePlugin.init()`
 * declares `sys_packages` — `@objectstack/service-package`'s
 * `PACKAGE_STORAGE_SERVICE`, read by name because the package exports no
 * constant for it.
 */
const PACKAGE_STORAGE_SERVICE = 'package.storage';

/** What {@link PACKAGE_STORAGE_SERVICE} answers with (`service-package`'s `PackageStorageDeclaration`). */
interface PackageStorageDeclaration {
  readonly table: string;
  readonly columns: readonly string[];
  /** Read-only: `true` present, `false` absent, `undefined` could not tell. */
  present(): Promise<boolean | undefined>;
  /** The package registry's own `CREATE TABLE IF NOT EXISTS` and index. */
  ensure(): Promise<void>;
}

/**
 * [#23022] The package registry's declaration of `sys_packages`, as this boot
 * composed it — or `null` when the boot composed no package registry.
 *
 * [#24059] The ONE reader of that declaration. {@link planPackageTable} plans
 * the table from what this returns, and {@link SchemaStack.nonObjectTables}
 * names the table from the same object, so `os migrate plan`'s unmanaged-table
 * sweep knows the table by the source the plan creates it from — and knows it
 * whether or not the table exists, which the plan's pending work cannot say:
 * that lists the table only while it is absent.
 *
 * Throws when the service answers in a shape this CLI does not read: the two
 * packages come from different releases, and neither the plan nor the sweep can
 * name the table.
 */
function findPackageStorage(kernel: unknown): PackageStorageDeclaration | null {
  let service: unknown;
  try {
    service = (kernel as { getService?: (name: string) => unknown }).getService?.(PACKAGE_STORAGE_SERVICE);
  } catch {
    return null; // not composed: this boot's deployment serves no package registry
  }
  if (service === undefined || service === null) return null;
  const storage = service as Partial<PackageStorageDeclaration>;
  if (
    typeof storage.table !== 'string' || !Array.isArray(storage.columns)
    || typeof storage.present !== 'function' || typeof storage.ensure !== 'function'
  ) {
    throw new Error(
      `The "${PACKAGE_STORAGE_SERVICE}" service does not have the shape this CLI reads (table, columns, present, `
      + 'ensure), so sys_packages cannot be planned. @objectstack/cli and @objectstack/service-package must come '
      + 'from the same release.',
    );
  }
  return storage as PackageStorageDeclaration;
}

/**
 * [#23022] `sys_packages` as pending schema work, when it is absent.
 *
 * ## Why the plan needs this
 *
 * `PackageServicePlugin.start()` creates `sys_packages` with raw DDL, because
 * the table cannot be a declared object (`service-package`'s
 * `package-table.ts` records the measurement: the driver's managed tables key
 * on `id` alone, and this one keys on `(id, version)`). So no driver deferral
 * ever listed it, and a deployment that sets `OS_SKIP_SCHEMA_SYNC=1` — whose
 * boot now creates nothing — was left with no way to get it from the documented
 * path. The plugin declares the table in `init()`, which a migrate boot runs,
 * and this lists it as `create_table` beside the objects' tables; `apply`'s
 * flush then runs the plugin's own statements, so `apply` creates exactly what
 * the boot creates.
 *
 * `null` when there is nothing to plan: the table exists. When its presence
 * could not be READ, that is not absence: a note says the table was not
 * examined, and nothing is planned.
 */
async function planPackageTable(
  declared: PackageStorageDeclaration,
  notes: string[],
): Promise<{ storage: PackageStorageDeclaration; work: PendingSchemaWork } | null> {
  const present = await declared.present();
  if (present === true) return null;
  if (present === undefined) {
    notes.push(
      `${declared.table} (the package registry's table) was NOT examined: its presence could not be read on this `
      + 'database, so this run does not list it and does not create it.',
    );
    return null;
  }
  return {
    storage: declared,
    work: { table: declared.table, kind: 'create_table', columns: [...declared.columns] },
  };
}

/**
 * Arms deferred-DDL mode on EVERY SQL driver the boot connects, before any of
 * them can schema-sync (#3917, #21391).
 *
 * Timing is the whole point, and it is why this is a plugin rather than a call
 * in `bootSchemaStack`. The kernel runs **every** plugin's `init()` (Phase 1)
 * before **any** `start()` (Phase 2). `DefaultDatasourcePlugin` connects the
 * driver and registers it as `driver.*` in its `init()`; `ObjectQLPlugin` runs
 * `syncRegisteredSchemas` — the create-table/add-column DDL this issue is about
 * — in its `start()`. An `init()` that depends on the datasource plugin
 * therefore lands in the one window where the driver exists and no DDL has run.
 *
 * ## Every SQL datasource, not the first one (#21391)
 *
 * This used to arm the first `driver.*` SQL service it found, which is the
 * default datasource. Any other SQL datasource reaches the engine through
 * `engine.registerDriver` alone: `DatasourceConnectionService.connect()` (how
 * `AppPlugin.start()` connects the datasources an artifact declares, and it
 * then calls `syncObjectSchema` for the objects bound to each), a host
 * plugin's `drivers.register`, or `ObjectQLPlugin.start()` handing the engine
 * a `driver.*` service some later `init()` published. Each of those schema-synced
 * on a dry run. So the deferral is armed on three paths:
 *
 *  - every `driver.*` service published so far (the default among them);
 *  - every driver the engine already holds, through its public accessors (the
 *    default by name, and the driver each registered object resolves to);
 *  - every driver registered from here on: `registerDriver` is shadowed on the
 *    engine instance the kernel publishes, and the shadow arms the driver
 *    BEFORE the engine holds it, then forwards the same instance. This is the
 *    seam `createDeclarationBootWriteGuard` uses for the same reason; that
 *    module's header states why an own property on the instance is what every
 *    caller reaches.
 *
 * {@link drivers} keeps what was armed, so the stack can report every
 * datasource's held-back work and flush all of it on the operator's say-so.
 * No driver changes: each one keeps its own deferred set and its own flush.
 *
 * Exported for its unit pin (`schema-migrate.remote-posture.test.ts`, #23816),
 * which holds the primary exemption without booting a kernel.
 */
export class DeferSchemaDdlPlugin {
  name = 'com.objectstack.cli.defer-schema-ddl';
  version = '1.0.0';
  /** Ordering, not optionality: our init must follow the one that registers `driver.*`. */
  dependencies = ['com.objectstack.runtime.default-datasource'];

  /** Every driver this boot deferred, in the order it was armed. */
  readonly drivers: SqlDriverLike[] = [];

  /** The kernel's logger, as `init()` was handed it: what the flush's birth half reports through. */
  logger: BirthLogger | undefined;

  /**
   * [#23816] `exemptPrimary`: leave the engine's DEFAULT driver un-armed. Set
   * only by a `skipSchemaSync` boot (`deferredDdlUnsupported:
   * 'skip-schema-sync'`), where the engine sends that driver no DDL at all and
   * its transport would refuse the arm. Every other driver is armed as before.
   */
  constructor(private readonly options: { exemptPrimary?: boolean } = {}) {}

  /** The driver {@link options}.exemptPrimary leaves un-armed, once `init()` has found it. */
  private exempt: unknown = null;

  /** Engines whose `registerDriver` is shadowed, and what to restore. */
  private readonly shadows: Array<{
    engine: Record<string, unknown>;
    original: PropertyDescriptor | undefined;
    shadow: (...args: unknown[]) => unknown;
  }> = [];

  init = async (ctx: any) => {
    this.logger = ctx.logger;
    if (this.options.exemptPrimary) this.exempt = defaultDriverOf(ctx);
    for (const name of SQL_DRIVER_SERVICES) {
      try { this.arm(ctx.getService(name)); } catch { /* not registered */ }
    }
    const services: Map<string, unknown> | undefined = ctx.getServices?.();
    for (const [name, service] of services?.entries?.() ?? []) {
      if (typeof name === 'string' && name.startsWith('driver.')) this.arm(service);
    }
    for (const name of ENGINE_SERVICES) {
      let engine: unknown;
      try { engine = ctx.getService(name); } catch { /* not registered */ }
      if (engine && typeof engine === 'object') this.shadowEngine(engine as Record<string, unknown>);
    }
    if (this.drivers.length === 0) {
      // No SQL driver yet (memory/mongo). Nothing has DDL to defer; a SQL
      // driver registered later is armed on arrival by the shadow above.
      ctx.logger?.debug?.('[defer-schema-ddl] no SQL driver yet — deferral armed on arrival');
    }
  };

  /** Arm one driver. Idempotent; a non-SQL driver has nothing to defer. */
  arm(driver: unknown): void {
    if (!driver || typeof driver !== 'object') return;
    if (driver === this.exempt) return;
    const d = driver as SqlDriverLike;
    if (this.drivers.includes(d)) return;
    if (typeof d.setDeferredDdl === 'function') {
      d.setDeferredDdl(true);
      this.drivers.push(d);
      return;
    }
    if (typeof d.detectManagedDrift === 'function' && typeof d.applyMigrationEntries === 'function') {
      // Fail loudly rather than silently boot-syncing: the caller asked for a
      // dry run and this driver cannot give one.
      const name = (driver as { name?: unknown }).name;
      throw new Error(
        `The SQL driver${typeof name === 'string' ? ` '${name}'` : ''} does not support deferred schema DDL, ` +
        'so this command cannot guarantee a dry run. Upgrade @objectstack/driver-sql.',
      );
    }
  }

  /** Arm what the engine holds, and every driver it is handed from now on. */
  private shadowEngine(engine: Record<string, unknown>): void {
    if (this.shadows.some((s) => s.engine === engine)) return; // `objectql` and `data` are one instance
    const registerDriver = engine.registerDriver;
    if (typeof registerDriver !== 'function') return;
    this.armHeld(engine);
    const original = Object.getOwnPropertyDescriptor(engine, 'registerDriver');
    const shadow = (...args: unknown[]): unknown => {
      // Arm BEFORE forwarding: the connect that registers a driver calls
      // `syncObjectSchema` on it in the very next statement.
      this.arm(args[0]);
      return Reflect.apply(registerDriver as (...a: unknown[]) => unknown, engine, args);
    };
    Object.defineProperty(engine, 'registerDriver', {
      value: shadow,
      writable: true,
      configurable: true,
      enumerable: original?.enumerable ?? false,
    });
    this.shadows.push({ engine, original, shadow });
  }

  /** The drivers the engine already holds, through the accessors it makes public. */
  private armHeld(engine: Record<string, unknown>): void {
    const e = engine as {
      getDefaultDriverName?: () => unknown;
      getDriverByName?: (name: string) => unknown;
      getDriverForObject?: (name: string) => unknown;
      registry?: { getAllObjects?: () => unknown };
    };
    const name = e.getDefaultDriverName?.();
    if (typeof name === 'string') this.arm(e.getDriverByName?.(name));
    if (typeof e.getDriverForObject !== 'function') return;
    const objects = e.registry?.getAllObjects?.();
    for (const obj of Array.isArray(objects) ? objects : []) {
      const objectName = (obj as { name?: unknown } | null)?.name;
      if (typeof objectName === 'string') this.arm(e.getDriverForObject(objectName));
    }
  }

  /** Put every shadowed `registerDriver` back, unless something else now sits on top of ours. */
  release(): void {
    for (const { engine, original, shadow } of this.shadows.splice(0)) {
      if (Object.getOwnPropertyDescriptor(engine, 'registerDriver')?.value !== shadow) continue;
      if (original) Object.defineProperty(engine, 'registerDriver', original);
      else delete engine.registerDriver;
    }
  }
}

/** `@objectstack/runtime`'s birth half, loaded lazily as the rest of the runtime is here. */
type RecordOrganizationOwnershipBirth = typeof import('@objectstack/runtime').recordOrganizationOwnershipBirth;

/**
 * What the birth half reports through: the runtime's own parameter, which reads
 * `info` alone. A failure is never logged on this path — it is thrown to the
 * caller ({@link recordBirthOfFlushedStore}) — so the sink has no error channel.
 */
type BirthLogger = Parameters<RecordOrganizationOwnershipBirth>[1];

/**
 * [ADR-0131 D10; ruling record 6269955919, ① A] The organization-ownership
 * BIRTH half of a deferred boot, run once {@link SchemaStack.flushSchemaDdl}
 * has performed the DDL the boot held back.
 *
 * Every boot through here composes `OrganizationOwnershipBirthMarkerPlugin`
 * (`createStandaloneStack`), which writes the birth marker when its `start()`
 * sees the ledger's store created from empty. A deferred boot creates nothing
 * by then: each driver stores its objects and skips them before counting, so
 * the store reports nothing created and the plugin writes nothing. The tables
 * are created HERE, at the flush. Without this step a fresh install whose
 * first command is `os migrate apply` carries no marker, and its first `os
 * serve` refuses it as a database an earlier release created.
 *
 * The decision is the runtime's own (`recordOrganizationOwnershipBirth`), read
 * now: the ledger store's driver counts, from its `hasTable` probe, every
 * table the flush created and every one it found, so `existing === 0 &&
 * created > 0` holds only when no declared table was there before this run.
 * ⛔ Never judged from the work the flush returns: a table already in sync
 * produces no entry there, so "every entry is a create_table" also describes
 * a populated database that merely gained a table — exactly the database
 * that must never receive a birth marker. A store the flush did not touch
 * (the Turso remote primary, whose schema sync this boot skipped) counts
 * nothing created and is left to its first serving boot.
 *
 * A failed write throws: the tables are there and the marker is not, so the
 * first `os serve` would refuse this database, and the command must not end
 * reporting success. The ceremony certifies such a database.
 *
 * Exported for its unit pin (`schema-migrate.birth-after-flush.test.ts`), which
 * holds the failed-write refusal without booting a kernel.
 */
export async function recordBirthOfFlushedStore(
  kernel: { getService?: (name: string) => unknown },
  recordBirth: RecordOrganizationOwnershipBirth,
  logger: BirthLogger | undefined,
): Promise<void> {
  let engine: unknown;
  try {
    engine = kernel.getService?.('objectql');
  } catch {
    return; // no engine — no ledger to write
  }
  if (!engine || typeof (engine as { getDriverForObject?: unknown }).getDriverForObject !== 'function') return;
  try {
    await recordBirth(engine as Parameters<RecordOrganizationOwnershipBirth>[0], logger);
  } catch (error) {
    throw new Error(
      `This run created the database from empty, and its organization-ownership birth marker (sys_migration ` +
        `'${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') could not be written ` +
        `(${error instanceof Error ? error.message : String(error)}). Without it the first 'os serve' takes this ` +
        `database for one an earlier release created and refuses it. Fix the write, then run 'os migrate ` +
        `organization-ownership --out PLAN' and 'os migrate organization-ownership --apply --plan-file PLAN ` +
        `--backup-taken', which certifies it.`,
      { cause: error },
    );
  }
}

/**
 * [#23816] The engine's DEFAULT driver — the primary datasource's — read
 * through the accessors the engine makes public, or `null` when the engine
 * names none yet.
 */
function defaultDriverOf(ctx: { getService?: (name: string) => unknown }): unknown {
  for (const name of ENGINE_SERVICES) {
    let engine: { getDefaultDriverName?: () => unknown; getDriverByName?: (name: string) => unknown } | undefined;
    try { engine = ctx.getService?.(name) as typeof engine; } catch { /* not registered */ }
    const driverName = engine?.getDefaultDriverName?.();
    if (typeof driverName === 'string') return engine?.getDriverByName?.(driverName) ?? null;
  }
  return null;
}

/**
 * [#24120] The kernel service `AppPlugin` connects a deployment's declared
 * datasources through — ADR-0062 D1's one "definition → live driver" path,
 * `DatasourceConnectionService`. `os serve` publishes it from
 * `DatasourceAdminServicePlugin`; without a publisher, `AppPlugin` leaves every
 * declared datasource metadata-only, which is how a schema-migration boot came
 * to register no driver for the datasource a `datasourceMapping` rule routes
 * its objects to.
 */
const DATASOURCE_CONNECTION_SERVICE = 'datasource-connection';

/**
 * [#24120] The connect policy of a schema-migration boot: MANAGED datasources
 * only. A datasource whose schema the remote owns (`schemaMode: 'external'` /
 * `'validate-only'`) holds no table a migration diffs — its objects are
 * federated, counted apart by the coverage pass — so a dry run opens no
 * connection to it. Every managed datasource connects as on `os serve`.
 */
const MANAGED_DATASOURCES_ONLY = {
  canConnect: (ds: { schemaMode?: string }): { allow: boolean; reason?: string } =>
    ds.schemaMode === undefined || ds.schemaMode === 'managed'
      ? { allow: true }
      : {
          allow: false,
          reason: `schemaMode '${ds.schemaMode}': the remote owns this datasource's schema, `
            + 'so a schema migration has no table to plan on it',
        },
};

/**
 * [#24120] Publishes {@link DATASOURCE_CONNECTION_SERVICE} on a schema-migration
 * boot, so `AppPlugin` connects the deployment's declared datasources by the
 * code `os serve` runs, under their declared names — ahead of the first schema
 * sync, which is where `AppPlugin` connects a datasource its mapping routes
 * registered objects to. Each connect reaches the engine through
 * `registerDriver`, so {@link DeferSchemaDdlPlugin} arms it before it syncs and
 * the declaration write guard refuses its row writes, exactly as for the
 * primary.
 *
 * Two differences from `os serve`'s publisher, both because this boot is a
 * migration and not a server: the policy is {@link MANAGED_DATASOURCES_ONLY},
 * and a read-only probe's factory opens an absent SQLite file as an empty
 * in-memory database (`sqliteAbsentFile`, #6743), as the primary's does. Not
 * composed when the composition already brings a publisher (a host config
 * listing `DatasourceAdminServicePlugin`): the kernel refuses a second.
 */
export class DeclaredDatasourceConnectionPlugin {
  name = 'com.objectstack.cli.declared-datasource-connection';
  version = '1.0.0';
  /** ADR-0116: the service `init()` registers on every path. */
  providesServices = [DATASOURCE_CONNECTION_SERVICE];

  constructor(private readonly options: { readOnlyProbe?: boolean } = {}) {}

  init = async (ctx: any) => {
    // Lazy, as every driver-adjacent import in this module is (#5726).
    const { DatasourceConnectionService, createDefaultDatasourceDriverFactory } =
      await import('@objectstack/service-datasource');
    const factory = createDefaultDatasourceDriverFactory(
      this.options.readOnlyProbe ? { sqliteAbsentFile: 'empty-in-memory' } : {},
    );
    ctx.registerService(DATASOURCE_CONNECTION_SERVICE, new DatasourceConnectionService({
      factory: () => factory,
      engine: () => {
        try { return ctx.getService('data'); } catch { return undefined; }
      },
      policy: MANAGED_DATASOURCES_ONLY,
      logger: ctx.logger,
    }));
  };
}

/** Does any of `plugins` already publish {@link DATASOURCE_CONNECTION_SERVICE}? */
function publishesDatasourceConnection(plugins: readonly unknown[]): boolean {
  return plugins.some((p) => {
    const provides = (p as { providesServices?: unknown } | null)?.providesServices;
    return Array.isArray(provides) && provides.includes(DATASOURCE_CONNECTION_SERVICE);
  });
}

/**
 * [#24120] The declared datasources this boot connected that the deployment's
 * objects live in: each SQL driver registered under a datasource name the
 * {@link DATASOURCE_CONNECTION_SERVICE} reports `available` that a registered,
 * non-federated object resolves to — the engine's own routing answers which,
 * never a re-read of the rules. `planned` (the primary and the sibling) is not
 * repeated. Sorted by name, so the plan reads in one order.
 *
 * `available`, not the `connected` status: `AppPlugin` connects a mapped
 * datasource before the first schema sync and asks again in `start()`, and the
 * service retains the LAST verdict — `already-registered` for the same live
 * driver.
 */
function findDeclaredDatasourceDrivers(
  kernel: unknown,
  planned: readonly SqlDriverLike[],
): Array<{ name: string; driver: SqlDriverLike }> {
  const service = (name: string): any => {
    try { return (kernel as { getService?: (n: string) => unknown })?.getService?.(name); } catch { return undefined; }
  };
  const states: unknown = service(DATASOURCE_CONNECTION_SERVICE)?.listConnectionStates?.();
  const connected = new Set(
    (Array.isArray(states) ? states : [])
      .filter((s: { availability?: unknown }) => s?.availability === 'available')
      .map((s: { name?: unknown }) => s.name),
  );
  if (connected.size === 0) return [];
  const engine = service('objectql');
  const objects: unknown = engine?.registry?.getAllObjects?.();
  if (!Array.isArray(objects) || typeof engine?.getDriverForObject !== 'function') return [];
  const found = new Map<string, SqlDriverLike>();
  for (const obj of objects as Array<{ name?: unknown; external?: unknown }>) {
    if (obj?.external != null || typeof obj?.name !== 'string') continue;
    const driver = engine.getDriverForObject(obj.name);
    const name = driver?.name;
    if (typeof name !== 'string' || !connected.has(name) || found.has(name) || planned.includes(driver)) continue;
    if (typeof driver.detectManagedDrift === 'function' && typeof driver.applyMigrationEntries === 'function') {
      found.set(name, driver as SqlDriverLike);
    }
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b)).map(([name, driver]) => ({ name, driver }));
}

/**
 * [#23816] Does the transport the boot will open for `resolved` refuse
 * deferred schema DDL? Today exactly the Turso REMOTE transport. The
 * standalone stack builds a `turso` datasource as `{ url, authToken }`, so
 * `TursoDriver.detectMode` reads the resolved URL exactly as the driver the
 * boot constructs will: the driver package answers, not a copy of its rule.
 *
 * Loaded lazily, as every driver is from this module (#5726). A package that
 * cannot be loaded answers `false`, and the boot then fails where it always
 * has, in `@objectstack/runtime`'s loader, naming the package to install.
 * Exported for its unit pin (`schema-migrate.remote-posture.test.ts`).
 */
export async function transportRefusesDeferredDdl(resolved: { driver: string; url: string }): Promise<boolean> {
  if (resolved.driver !== 'turso') return false;
  let detectMode: ((config: { url: string }) => string) | undefined;
  try {
    detectMode = (await import('@objectstack/driver-turso')).TursoDriver.detectMode;
  } catch {
    return false;
  }
  return detectMode({ url: resolved.url }) === 'remote';
}

/**
 * Name the database the migrate/resync commands are about to write to.
 *
 * Shares the startup banner's renderer (#3793): the same
 * `{ connectionString }` shape that made the banner print `(unknown)` used to
 * fall through here to a bare `pg` — and this string is what the
 * `Apply N change(s) to …?` confirm shows, so it has to name the real target.
 * Falls back to the client name only when the config carries no address at all.
 */
function describeDb(driver: SqlDriverLike | null): string {
  const cfg: any = driver?.config;
  if (!cfg) return 'unknown';
  return describeDriverConnection(cfg) ?? String(cfg.client ?? 'unknown');
}

/**
 * [#24120] One planned driver per DATABASE, for a reading of what each
 * database holds (`os migrate plan`'s unmanaged-table sweep): the first driver
 * of each, in {@link SchemaStack.drivers} order.
 *
 * Two planned drivers can address one database. A `datasourceMapping` default
 * the primary resolves its location from is connected again under its declared
 * name, exactly as `os serve` connects it — the primary's file and the declared
 * datasource's are one file — and read twice, every table counted twice.
 * Identity is the database file a SQLite driver names
 * ({@link describeDriverSqliteFile}, resolved as SQLite opens it), otherwise
 * the connection a driver describes; a driver with neither (an in-memory
 * database, each connection its own) is never folded into another.
 */
export function distinctDatabaseDrivers(drivers: readonly SqlDriverLike[]): SqlDriverLike[] {
  const seen = new Set<string>();
  const out: SqlDriverLike[] = [];
  for (const driver of drivers) {
    const file = describeDriverSqliteFile(driver.config);
    const identity = file !== undefined
      ? `file:${path.resolve(file)}`
      : hasSqliteFilename(driver.config) ? undefined : describeDriverConnection(driver.config);
    if (identity !== undefined && seen.has(identity)) continue;
    if (identity !== undefined) seen.add(identity);
    out.push(driver);
  }
  return out;
}

/** Does a driver config name a SQLite target at all — a file, `:memory:`, or SQLite's private temporary database? */
function hasSqliteFilename(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const cfg = config as Record<string, unknown>;
  const conn = cfg.connection;
  const bag = conn && typeof conn === 'object' ? conn as Record<string, unknown> : cfg;
  return typeof (bag.filename ?? cfg.filename) === 'string';
}

// ── The project's `.env*` files (#22581) ────────────────────────────

/**
 * One load of a project's `.env*` files: what they hold, with the file each
 * variable came from, and this process's environment as it stood BEFORE the
 * load — the environment "exported" is judged against.
 */
export interface ProjectEnvLoad {
  readonly reading: DotenvReading;
  readonly shellEnv: Readonly<NodeJS.ProcessEnv>;
}

/** `[project root, mode]` → its load, for this process. See {@link loadProjectEnvFiles}. */
const projectEnvLoads = new Map<string, ProjectEnvLoad>();

/**
 * Load the project's `.env*` files into this process as `os serve`, `os start`
 * and `os dev` do, before anything resolves a database or a secret (#22581).
 *
 * The serving commands load them first thing; a one-shot boot used to read
 * `process.env` alone. So a project keeping `OS_DATABASE_URL` in `.env` served
 * one database and migrated another, and an `OS_AUTH_SECRET` kept there left
 * the auth family out of `os migrate plan`.
 *
 * ## The serving commands' load, not a second one
 *
 * `dotenvFlow.config({ node_env, silent: true })` is the call `serve` /
 * `start` / `dev` make, with `os serve`'s mode rule: `--dev` → `development`,
 * else `NODE_ENV === 'test' ? 'test' : NODE_ENV || 'production'` — the half
 * {@link doctorNodeEnv} spells, and all of `os start`'s. `dev` is set only when
 * the boot composes as `os serve --dev` (`serveFlags.dev`: `os migrate
 * security-catalog-overlays --dev`), so that command reads the development
 * files the deployment it names serves with. dotenv-flow never overrides a
 * variable this process already has, so an exported `OS_DATABASE_URL` keeps
 * its precedence over `.env`, exactly as it does for `serve`. The file list and
 * the per-variable origin are dotenv-flow's own (`readDotenvFiles`, the reader
 * `os doctor` reports with), so the source this stack names is the file the
 * load took the value from.
 *
 * ## Once per project root and mode per process
 *
 * Called by the occupancy probe (`./migrate-occupancy-gate.ts`), which resolves
 * the target BEFORE the boot, and by {@link bootSchemaStack}; the second call
 * returns the first one's record. Not only for cost: after the load every
 * `.env` variable is in `process.env`, so a second snapshot would report all
 * of them as exported.
 *
 * The record is keyed by root AND mode, so a `--dev` load and a plain one of the
 * same root never share one. A real run never makes both: the process runs one
 * command, and that command's probe and boot are handed the same `dev`. Only a
 * test driving several commands in one process can, and it restores the
 * environment between them, as the loads cannot take each other's values back.
 */
export function loadProjectEnvFiles(
  projectRoot: string = process.cwd(),
  opts: { readonly dev?: boolean } = {},
): ProjectEnvLoad {
  const root = path.resolve(projectRoot);
  const nodeEnv = opts.dev === true ? 'development' : doctorNodeEnv();
  const key = JSON.stringify([root, nodeEnv]);
  const prior = projectEnvLoads.get(key);
  if (prior) return prior;
  const shellEnv = { ...process.env };
  const reading = readDotenvFiles(root, nodeEnv);
  dotenvFlow.config({ node_env: nodeEnv, path: root, silent: true });
  const load: ProjectEnvLoad = { reading, shellEnv };
  projectEnvLoads.set(key, load);
  return load;
}

/**
 * [#22581] Who named the database a one-shot boot opened — the `--json` face of
 * `os migrate plan` / `apply` (`databaseSource`).
 *
 *  - `flag` — `--database-url`;
 *  - `process-env` — a variable this process was started with;
 *  - `env-file` — a variable from one of the project's `.env*` files, named by
 *    its file name (dotenv-flow reads them from the project root only);
 *  - `config-datasource` — the datasource the project config declares as its
 *    default home;
 *  - `default` — nobody: the project's default database file.
 */
export type DatabaseSource =
  | { readonly kind: 'flag' }
  | { readonly kind: 'process-env'; readonly variable: string }
  | { readonly kind: 'env-file'; readonly variable: string; readonly file: string }
  | { readonly kind: 'config-datasource'; readonly datasource: string }
  | { readonly kind: 'default' };

/**
 * The variable the env rung of `resolveProjectDatabaseUrl` (`@objectstack/runtime`)
 * read: `(OS_DATABASE_URL ?? DATABASE_URL)` when that is non-blank, else
 * `TURSO_DATABASE_URL` — its own `??` order. `schema-migrate.database-source.test.ts`
 * holds the two equal over every combination of the three.
 */
export function envRungVariable(env: Readonly<NodeJS.ProcessEnv>): string {
  if ((env.OS_DATABASE_URL ?? env.DATABASE_URL)?.trim()) {
    return env.OS_DATABASE_URL !== undefined ? 'OS_DATABASE_URL' : 'DATABASE_URL';
  }
  return 'TURSO_DATABASE_URL';
}

/**
 * Name the source of the database the resolution answered, from the rung it
 * answered on (`resolveStandaloneDatabase`'s `source`) and the env load.
 */
export function resolveDatabaseSource(
  load: ProjectEnvLoad,
  resolved: { readonly source: string; readonly datasourceName?: string },
  explicitUrl: string | undefined,
): DatabaseSource {
  /** A variable's source: the `.env*` file it was loaded from, or the process environment. */
  const fromVariable = (variable: string): DatabaseSource => {
    const provenance = provenanceOf(load.reading, variable, load.shellEnv);
    return provenance.source === 'file' && provenance.file
      ? { kind: 'env-file', variable, file: path.basename(provenance.file) }
      : { kind: 'process-env', variable };
  };
  switch (resolved.source) {
    case 'explicit':
      // Every caller's `--database-url` declares `env: 'OS_DATABASE_URL'`, so
      // oclif hands the variable's value over as the flag's. An explicit URL
      // equal to it is the variable, wherever that came from.
      return explicitUrl !== undefined && process.env.OS_DATABASE_URL === explicitUrl
        ? fromVariable('OS_DATABASE_URL')
        : { kind: 'flag' };
    case 'env':
      return fromVariable(envRungVariable(process.env));
    case 'config-datasource':
      return { kind: 'config-datasource', datasource: resolved.datasourceName ?? 'default' };
    default:
      // `unified-default`, and `legacy-file` — its compat read, which the boot
      // announces itself.
      return { kind: 'default' };
  }
}

/** {@link DatabaseSource} as an operator reads it, beside the database. */
export function describeDatabaseSource(source: DatabaseSource): string {
  switch (source.kind) {
    case 'flag':
      return 'from --database-url';
    case 'process-env':
      return `${source.variable} from this process's environment`;
    case 'env-file':
      return `${source.variable} from ${source.file}`;
    case 'config-datasource':
      return `the project config's default datasource "${source.datasource}"`;
    case 'default':
      return 'the default: no --database-url, environment variable, .env file or config datasource names one';
  }
}

/**
 * [#22579] The line `os migrate plan` / `apply` print under the database when
 * the boot planned against a `telemetry` sibling ({@link SchemaStack.telemetryDatabase}).
 */
export function describeTelemetryDatabase(file: string): string {
  return `Telemetry database: ${chalk.white(file)} ${chalk.dim(
    '(audit, telemetry and event objects — where os serve keeps them; OS_TELEMETRY_DB=0 turns it off)',
  )}`;
}

/**
 * [#23848] What a boot whose schema sync was SKIPPED ({@link SchemaStack.schemaSync}
 * `'skipped'`, the `deferredDdlUnsupported: 'skip-schema-sync'` answer) did not
 * examine, as `os migrate plan` / `apply` print it under the database. Their
 * `--json` documents carry `schemaSync: 'skipped'` for the same fact, so an
 * empty `pending` there reads as "not examined", never as "nothing to create".
 */
export const SKIPPED_SCHEMA_SYNC_NOTE =
  'Additive schema work was NOT examined: this database\'s transport (the Turso REMOTE transport) cannot hold '
  + 'schema DDL back for a preview, so this run reads and applies drift only. A table or column the metadata '
  + 'declares and the database lacks is neither listed nor created here; on this transport the serving boot '
  + '(os serve / os start) creates it.';

/** Boot the schema stack. Caller MUST call `shutdown()` when done. */
export async function bootSchemaStack(
  opts: {
    /**
     * `true` when this run's stdout belongs to a machine-readable payload
     * (`--json`) — the boot then sends everything the kernel and its plugins
     * write to **stderr** so `JSON.parse(stdout)` succeeds on the whole
     * stream, with no heuristic extraction (commit 2b641ddd4).
     *
     * REQUIRED, and required on purpose. Every command in this family declares
     * a `--json` flag, and each of them re-introduced the same defect
     * independently: `os migrate plan` / `apply` / `resume` / `recorded-by` /
     * `summary-nulls` / `value-shapes` / `files-to-references`, `os migrate
     * meta --stored` and the since-retired `os meta resync` all emitted ~60 INFO lines around
     * their payload. Booting the stack is what makes a command a member of
     * this family, so this is the one place a new member cannot avoid — and
     * with no default, a new member has to *decide* rather than inherit the
     * bug. Pass `false` from anything that owns stdout itself (every
     * human-mode run, and every test).
     *
     * The reservation is NOT lifted when the boot fails: a half-started kernel
     * can still log, and the command's next act on that path is to emit its
     * error payload. Lifting it would put those two on the same stream, which
     * is the defect. `shutdown()` lifts it on the success path, once the kernel
     * is down and nothing is left to write. See `./json-stdout.ts`.
     */
    jsonOutput: boolean;
    databaseUrl?: string;
    /**
     * Service plugins to register after the data stack (driver/metadata/
     * objectql/app) and before start — e.g. `os migrate files-to-references`
     * adds settings + storage so `sys_file` and the deployment's real storage
     * adapter are present. Plain schema commands pass nothing.
     */
    extraPlugins?: unknown[];
    /**
     * Compose the SAME object set this deployment's `os serve` boot registers —
     * its `objectstack.config.ts` and the platform floor `serve` composes
     * unconditionally (#12938). Set by the two SCHEMA commands, `os migrate
     * plan` and `os migrate apply`; by the commands whose subject is that same
     * set (`unmapped-columns`, `security-catalog-overlays`); and by `os migrate
     * organization-ownership --apply`, whose column drops are that set's drift
     * and whose security catalog is the one the deployment serves.
     *
     * Off by default and opted into at the call site rather than deduced here:
     * the DATA subcommands declare their own, narrower set through
     * `buildDataMigrationPlugins`, and a capability that appears because of a
     * default nobody wrote down is invisible at every call site (AGENTS.md →
     * Route & surface ownership §2).
     *
     * What it composes, why exactly that, and the Phase-2 suppression that keeps
     * a `plan` from writing are all in `./schema-migration-plugins.ts`'s header.
     * With neither a host config nor a compiled artifact present it composes
     * NOTHING, so an artifact-less run is unchanged.
     */
    composeHostStack?: boolean;
    /**
     * Boot WITHOUT touching the target database's schema (#3917).
     *
     * Boot schema-sync issues create-table / add-column DDL, which used to
     * happen before `os migrate plan` rendered its "dry run" and before
     * `os migrate apply` asked `[y/N]`. With this set, every SQL driver the
     * boot connects registers metadata but records the physical work instead
     * of performing it ({@link SchemaStack.pendingSchemaWork}), so the plan
     * describes the database as it actually is. Call
     * {@link SchemaStack.flushSchemaDdl} after confirmation to perform the work.
     * (The artifact's inline seed is off on every boot through here, set or
     * not: see the `skipSeedData` note in the body.)
     *
     * [#21391] **Every no-write mode sets this, with {@link readOnlyProbe}**:
     * the read-only boot. A command's writes happen only in its own apply step,
     * and a dry run, a scan or a report never reaches schema sync. The
     * enumeration pin `schema-migrate.one-shot-family.integration.test.ts` runs
     * every caller's no-write modes against a database and fails on any byte
     * that moves, and fails by file name on a caller it has not been told
     * about.
     *
     * A WRITE mode that needs the tables to exist before it writes (`--apply`
     * of the data commands) leaves this off.
     */
    deferSchemaDdl?: boolean;
    /**
     * [#23816] With {@link deferSchemaDdl}: what the boot does when the
     * PRIMARY datasource's transport cannot defer schema DDL — the Turso REMOTE
     * transport (`TursoDriver.detectMode` answers `remote` for the URL this boot
     * resolved), whose driver refuses the deferral.
     *
     *  - `'refuse'` (the default): arm the deferral anyway, so the boot fails
     *    with the driver's own refusal. Right for a command whose answer reads
     *    the held-back work or a table its boot measured absent: a boot that
     *    holds nothing back can list neither.
     *  - `'skip-schema-sync'`: boot with schema sync SKIPPED instead
     *    (`skipSchemaSync`, the posture `OS_SKIP_SCHEMA_SYNC=1` names). No DDL is
     *    held back because none is attempted, and each object is told to its
     *    driver DDL-free (`registerObjectMetadata`), so drift detection still
     *    diffs the declared set. The boot reports it ({@link SchemaStack.schemaSync}),
     *    {@link SchemaStack.pendingSchemaWork} is `[]` and
     *    {@link SchemaStack.tableAbsent} measures nothing. Only a command that
     *    needs no table this release would CREATE may ask for it, or one that
     *    says, in both faces, that it did not examine that work. Today:
     *    `os migrate organization-ownership`, which runs against an environment
     *    whose own boot has already run the additive sync; and [#23848]
     *    `os migrate plan` / `apply`, which on such a boot read and apply drift
     *    only and print {@link SKIPPED_SCHEMA_SYNC_NOTE} (`--json`:
     *    `schemaSync: 'skipped'`). On this transport the serving boot creates
     *    what they do not, and their drift half is the only remedy a
     *    destructive entry has there.
     *
     * Decided from the resolved URL before anything connects, never by catching
     * the driver's refusal, and only for the primary: any other datasource the
     * boot connects is still armed, and refuses as before if it cannot defer.
     */
    deferredDdlUnsupported?: 'refuse' | 'skip-schema-sync';
    /**
     * Boot WITHOUT BRINGING A DATABASE INTO EXISTENCE (#6743).
     *
     * `deferSchemaDdl` stopped the boot from writing DDL and seed rows, but the
     * sqlite driver still opened its target in SQLite's default create-if-absent
     * mode — so `os migrate plan` on a never-started project left a 0-table
     * `.objectstack/data/objectstack.db` (plus its `-wal`/`-shm` on an unclean
     * exit) behind: a write side effect from a command that calls itself a dry
     * run, and one that makes "this project has no database yet" unobservable
     * to the next command.
     *
     * With this set, a missing sqlite file is opened as an empty `:memory:`
     * database instead. A database with zero tables is exactly what a freshly
     * created empty file is, so the plan is byte-for-byte the one printed
     * before — the report was never the defect and must not pay for the fix.
     *
     * ⚠️ NOT implied by `deferSchemaDdl`, and it must not become so:
     * `os migrate apply` also boots deferred, then FLUSHES the deferred DDL
     * once the operator confirms. Writes into the `:memory:` stand-in would be
     * discarded at disconnect, so `apply` keeps the default.
     */
    readOnlyProbe?: boolean;
    /**
     * Project root the booted stack scopes its on-disk state to — the default
     * sqlite database and the metadata FileSystemRepository
     * (`<projectRoot>/.objectstack/…`). Defaults to `process.cwd()`, which is
     * correct for every real `os migrate` invocation: the CLI runs from the
     * project directory.
     *
     * Tests that assemble a fixture project in a tempdir must pass it, or the
     * boot scopes its database to the tempdir while writing metadata into
     * whatever directory the test runner happens to be standing in (#4065).
     */
    projectRoot?: string;
    /**
     * [#22371] Boot WITHOUT reading `sys_metadata` back into the registry.
     * Default `true` — every caller before this one diffs and scans the object
     * set the serving boot registers, and that includes what it hydrates.
     *
     * `false` is the boot `os migrate security-catalog-overlays` takes: it
     * lists the environment-wide rows the cold boot's catalog check refuses
     * (ADR-0048 N.3), and that check judges what hydration wrote, so a boot of
     * such a deployment that hydrates is refused before the command can run.
     * Hydration off, the check meets an empty environment half and the boot
     * comes up; the command reads the rows itself (maintainer ruling letter B
     * on #22371, record 6074838935).
     */
    hydrateMetadata?: boolean;
    /**
     * [#22371] With {@link composeHostStack}, also compose the security plugin
     * when `os serve` would — behind its auth gate (`resolvePlatformAuthComposition`
     * in `@objectstack/core`, the one rule both answer) — for its declarations
     * only. Its `init()` declares the platform's shipped permission sets on its
     * own manifest, which is what makes them package-held names at boot.
     *
     * Off by default and opted into at the call site, like `composeHostStack`:
     * `os migrate plan` / `apply` compose no tier-gated plugin, and this does
     * not change that. `os migrate organization-ownership --apply` sets it so
     * the platform's shipped permission sets are names its catalog resolves. See `buildSchemaMigrationPlugins`'s `authGatedSecurity`.
     */
    composeAuthGatedSecurity?: boolean;
    /**
     * [#22371] With {@link composeHostStack}: the `os serve` flags the
     * composition answers for — `--dev` (the config's `devPlugins`, and a
     * development boot for the auth gate) and `--preset` (the tiers the gate
     * falls back to), with `serve`'s meaning. See `buildSchemaMigrationPlugins`'s
     * `serveFlags`. For the composition, and for which `.env*` files are read
     * (`--dev` reads the development ones, as `serve --dev` does, #22581): the
     * data stack itself is booted as every one-shot command boots it — no `dev`
     * key, so no dev schema self-heal.
     */
    serveFlags?: { readonly dev?: boolean; readonly preset?: string };
    /**
     * [#22506] With {@link composeHostStack}, also compose what `os serve`
     * mounts AROUND the stack, each piece for its declarations only: the auth
     * family behind its auth gate, the provider of every capability its
     * resolver mounts (the stack's `requires` and the always-on slate), and
     * the REST API plugin. Set by `os migrate plan` and `os migrate apply`,
     * whose subject is the deployment's whole object set, by `os migrate
     * unmapped-columns`, which reads the plan's own findings over that set,
     * and by `os migrate organization-ownership --apply`, which drops the
     * ceremony's columns through that set's drift — and by nothing else.
     * See `buildSchemaMigrationPlugins`'s `servedPlatform`.
     */
    composeServedPlatform?: boolean;
    /**
     * [#24120] Connect the deployment's declared MANAGED datasources as `os
     * serve` connects them — through the `datasource-connection` service,
     * under their declared names ({@link DeclaredDatasourceConnectionPlugin})
     * — and plan each one the deployment's objects live in beside the primary
     * ({@link SchemaStack.drivers}). Set by `os migrate plan` and `os migrate
     * apply`, so the plan an operator reads and the apply that confirms it
     * cover the same datasources, by `os migrate unmapped-columns`, a
     * filter over that plan's own findings, by `os migrate
     * audit-mail-bodies`, which masks the archive datasource a declaration
     * names (#24899), and by its twin `os migrate audit-key-material`, which
     * rewrites the same archive; by nothing else.
     *
     * Without it a `datasourceMapping` rule routing objects to a declared
     * datasource left them bound to no driver here, the declared DEFAULT's
     * included: the boot opened that datasource's database as its primary and
     * examined none of its tables.
     */
    composeDeclaredDatasources?: boolean;
  },
): Promise<SchemaStack> {
  // Taken BEFORE the first line the boot can print. `createStandaloneStack`
  // announces a missing compiled artifact on `console.log` before any plugin
  // is constructed, so a reservation installed one statement later already
  // arrives too late to keep stdout a single JSON document (commit 2b641ddd4).
  const releaseStdout = opts.jsonOutput ? reserveStdoutForJson() : () => { /* stdout is the caller's */ };

  // [#22581] The environment the serving commands boot with, before the
  // database, the auth secret or anything else is read from it.
  const projectRoot = opts.projectRoot ?? process.cwd();
  const envLoad = loadProjectEnvFiles(projectRoot, { dev: opts.serveFlags?.dev === true });

  const { createStandaloneStack, Runtime, resolveStandaloneDatabase, recordOrganizationOwnershipBirth } =
    await import('@objectstack/runtime');

  // The inputs the database is resolved from — by `createStandaloneStack`
  // below, the occupancy probe before it, and the telemetry sibling's key.
  const databaseInput = { projectRoot, ...(opts.databaseUrl ? { databaseUrl: opts.databaseUrl } : {}) };
  const resolvedDatabase = resolveStandaloneDatabase(databaseInput);

  // [#23816] Deferred, skipped, or performed: see `deferredDdlUnsupported`.
  const skipSchemaSync = opts.deferSchemaDdl === true
    && opts.deferredDdlUnsupported === 'skip-schema-sync'
    && (await transportRefusesDeferredDdl(resolvedDatabase));
  const defer = opts.deferSchemaDdl === true && !skipSchemaSync;

  // [#22581] Who named the database: the resolution `createStandaloneStack`
  // makes below (and the occupancy probe made before it), from the same inputs.
  const dbSource = resolveDatabaseSource(
    envLoad,
    resolvedDatabase,
    opts.databaseUrl || undefined,
  );

  const stack = await createStandaloneStack({
    projectRoot,
    ...(opts.databaseUrl ? { databaseUrl: opts.databaseUrl } : {}),
    // [#21391] No seed loader on a one-shot CLI boot — unconditional, and NOT
    // keyed on `deferSchemaDdl`, for the reason `runPlatformMigrations` below
    // is not. The artifact's inline seed UPSERTS every seeded row on every
    // boot (`updated_at` bumped, `organization_id` stamped, an operator's edit
    // put back to the seed's value). Keyed on `defer`, it ran under every
    // no-write mode that booted plain, and it still runs under every `--apply`
    // / `--delete`: a write the operator never saw in the preview, riding along
    // with the one they confirmed. Seeding stays with the boots that serve.
    skipSeedData: true,
    ...(opts.readOnlyProbe ? { sqliteAbsentFile: 'empty-in-memory' as const } : {}),
    // [#21391] No lifecycle sweep either. A one-shot boot used to arm it on an
    // unref'd timer whose first run is a minute out, so "it never sweeps" was
    // a timing fact. Not armed, it is a structural one.
    armLifecycleSweep: false,
    // [#9380] No boot repair migrations on a one-shot CLI boot — unconditional,
    // and NOT keyed on `deferSchemaDdl`.
    //
    // #9380 armed the three `kernel:ready` platform-table migrations on the
    // standalone stack (they had never run on a self-hosted install, because
    // the assembly deduced "cloud per-project kernel" from the `'proj_local'`
    // the stack stamped then — `'env_local'` since #13366). Every boot through
    // THIS function inherits that default unless it is turned off here, and
    // every one of them is a command that reports or applies exactly what the
    // operator asked for:
    //
    //   • every no-write mode — `os migrate plan` / `duplicates`, and the
    //     default mode of every other command booted here — boots deferred +
    //     read-only (#21391) and is a declared dry run or report;
    //   • the write modes — `--apply` of `os migrate meta --stored` /
    //     `value-shapes` / `recorded-by` / `summary-nulls` /
    //     `files-to-references` / `audit-metadata-bodies`, `os migrate resume
    //     --run`, `os secret orphans --delete` — boot
    //     NOT deferred, so a `defer`-keyed policy would have left all of them
    //     repairing rows. They write, but only the change the operator
    //     confirmed; `os migrate apply` likewise. A repair riding along is a
    //     change they never saw in the plan (which is #8725's separate
    //     complaint).
    //
    // The serving boots — `os dev`, `os serve`, `os start` — do not come
    // through here and take the default, which is where an install gets
    // repaired. `duplicates.integration.test.ts` pins this end of it: boot
    // included, the run must leave the database byte-identical.
    runPlatformMigrations: false,
    // [#22371] Off only when the caller asks; see the option.
    ...(opts.hydrateMetadata === false ? { hydrateMetadataFromDb: false } : {}),
    // [#23816] See `deferredDdlUnsupported`.
    ...(skipSchemaSync ? { skipSchemaSync: true } : {}),
  });

  // No HTTP, no cluster — this is a one-shot schema operation.
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) {
    await kernel.use(plugin);
  }
  // [#22579] The `telemetry` sibling datasource (ADR-0057 §3.6), exactly when
  // the serving boot provisions it and through the same helper. Without it,
  // every lifecycle-classed object a development boot (or an `OS_TELEMETRY_DB`
  // deployment) keeps in the sibling resolved to the primary here, so `plan`
  // listed it as a table to create and `apply` created it there — an empty
  // orphan beside the one the served boot uses.
  //
  //  - WHETHER and WHERE is the serving boot's answer: its `dev` reading
  //    (`isDevelopmentBoot` — `--dev`, or `NODE_ENV=development`, the reading
  //    the composition's auth gate takes too), `OS_TELEMETRY_DB` from the
  //    environment loaded above, and the primary the standalone stack declares
  //    (`standaloneTelemetryPrimary`, `serve`'s own key for it).
  //  - HOW it opens is this boot's: never under the dev self-heal, and on a
  //    read-only probe an absent file opens empty in memory — the posture the
  //    primary has here (`oneShot`).
  //
  // Registered before the deferral below, which arms it with the primary.
  const telemetryDatabase = (await provisionTelemetryDatasource({
    primaryPath: await standaloneTelemetryPrimary(databaseInput),
    env: process.env,
    dev: isDevelopmentBoot(opts.serveFlags?.dev),
    use: (plugin) => kernel.use(plugin as any),
    warn: (message) => console.warn(message),
    oneShot: { readOnlyProbe: opts.readOnlyProbe === true },
  })) ?? null;
  // [#23816] A skip-sync boot still arms every driver but the primary: any
  // other datasource's DDL stays held back, as on a deferred boot.
  const deferral = defer || skipSchemaSync ? new DeferSchemaDdlPlugin({ exemptPrimary: skipSchemaSync }) : null;
  if (deferral) {
    await kernel.use(deferral as any);
  }
  // #12938 — the deployment's own object set, when this command asked for it.
  // Registered here, after the data stack, for the same reason `extraPlugins`
  // is: the presence tests it performs read what `createStandaloneStack`
  // produced, and the DDL deferral above must already be armed.
  const composition = opts.composeHostStack === true
    ? await buildSchemaMigrationPlugins({
        basePlugins: stack.plugins,
        cwd: projectRoot,
        // The same answer the standalone stack got above: never on this boot.
        skipSeedData: true,
        // [#22371] The compiled artifact's `requires`, as `serve`'s merge lays
        // them over the config's, for the auth gate's tier reading.
        ...(opts.composeAuthGatedSecurity === true
          ? { authGatedSecurity: { artifactRequires: stack.requires } }
          : {}),
        ...(opts.serveFlags ? { serveFlags: opts.serveFlags } : {}),
        // [#22506] The compiled artifact's `requires`, as `serve`'s merge lays
        // them over the config's, for the auth gate and the provider tokens.
        ...(opts.composeServedPlatform === true
          ? { servedPlatform: { artifactRequires: stack.requires } }
          : {}),
      })
    : {
        plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null,
        // [#22580] The data stack alone: this boot was not asked for the deployment's set.
        servedBoot: { mirrored: false, reason: 'not-composed' },
        notes: [], coverage: null,
      } satisfies SchemaMigrationComposition;
  for (const plugin of composition.plugins) {
    await kernel.use(plugin as any);
  }
  for (const plugin of opts.extraPlugins ?? []) {
    await kernel.use(plugin as any);
  }
  // [#24120] The publisher `AppPlugin` connects declared datasources through,
  // unless the composition already brought one.
  if (
    opts.composeDeclaredDatasources === true
    && !publishesDatasourceConnection([...stack.plugins, ...composition.plugins, ...(opts.extraPlugins ?? [])])
  ) {
    await kernel.use(new DeclaredDatasourceConnectionPlugin({ readOnlyProbe: opts.readOnlyProbe === true }) as any);
  }
  await runtime.start();

  // #13332 — the kernel bootstrap is over, and with it the window the
  // declaration boot's write guard covers. `composeForDeclarations` suppresses
  // a host plugin's `start()` and its post-declaration hooks (#21054), but
  // `kernel.ts` fires `kernel:ready` unconditionally afterwards, so a hook
  // REGISTERED from `init()` on that phase runs on a plan; the guard refuses
  // its writes at the driver instead of at a list of phase names. Everything
  // from this line on is work the command was ASKED for — `apply`'s confirmed
  // DDL flush, the #13028 coverage pass — so the guard comes off here and
  // reports whatever it refused, which the plan prints and `--json` carries.
  const refusalNote = composition.writeGuard?.disarm() ?? null;
  if (refusalNote) composition.notes.push(refusalNote);
  // #21054 — and what the boot did not run for host code at all: the
  // post-declaration hooks its `init()`s asked for, and the config's
  // `onEnable`. Read now, after `start()` has decided the latter.
  const lifecycleNote = composition.lifecycle?.describe() ?? null;
  if (lifecycleNote) composition.notes.push(lifecycleNote);

  const driver = findSqlDriver(kernel);
  // [#22579] Every SQL driver this boot plans against: the primary, then the
  // sibling it provisioned, then [#24120] each declared datasource this boot
  // connected that objects live in. Nothing else — a datasource registered
  // by any other path stays outside the plan, reported by its coverage.
  const telemetryDriver = telemetryDatabase !== null ? findTelemetryDriver(kernel) : null;
  const servedDrivers: SqlDriverLike[] = [driver, telemetryDriver]
    .filter((d): d is SqlDriverLike => d !== null);
  const declaredDrivers = opts.composeDeclaredDatasources === true
    ? findDeclaredDatasourceDrivers(kernel, servedDrivers)
    : [];
  const plannedDrivers: SqlDriverLike[] = [...servedDrivers, ...declaredDrivers.map((d) => d.driver)];

  // #13028 — the composed host declared its objects in `init()`; the pass that
  // hands them to their driver lives in `ObjectQLPlugin.start()`, which the
  // declaration-phase composition suppressed (and which a host bringing its
  // OWN engine plugin displaces outright, since duplicate registration
  // overwrites by name). Drive that pass here, over the deferral this boot
  // already armed, and record what it could NOT reach — so a partial plan says
  // so instead of reading as coverage. Runs only when this boot actually
  // composed a host; every other caller is untouched.
  const composedHost = opts.composeHostStack === true && composition.notes.length > 0;
  // [#24120] Which database each declared datasource's objects are planned
  // against, in both faces — `Database:` names the primary alone.
  if (declaredDrivers.length > 0) {
    composition.notes.push(
      `Planned ${declaredDrivers.length} declared datasource(s) against the database os serve keeps their objects in — `
      + `${declaredDrivers.map((d) => `${d.name} (${describeDb(d.driver)})`).join(', ')} — connected under the `
      + 'declared name, as os serve connects them.',
    );
  }
  if (composedHost) {
    const measured = await measureComposedCoverage(kernel, plannedDrivers, defer, { ddlFree: skipSchemaSync });
    composition.coverage = measured.coverage;
    composition.notes.push(...measured.notes);
  }

  // Read AFTER the pass above — that is the step which fills both of them.
  // [#22579] Every planned driver's managed set: the sibling's objects are
  // examined too.
  const managedTableCount = plannedDrivers
    .reduce((n, d) => n + ((d as any).managedObjectFields?.size ?? 0), 0);
  // [#21391] Every datasource the deferral armed, not only the default's.
  const pendingSchemaWork: PendingSchemaWork[] = [];
  for (const d of deferral?.drivers ?? []) {
    if (d.previewDeferredSchemaWork) pendingSchemaWork.push(...(await d.previewDeferredSchemaWork()));
  }
  // [#23022] …and the one table outside the object set, `sys_packages`, which
  // no driver deferral can see. Read-only here; `flushSchemaDdl` creates it.
  // Not on a skip-sync boot: the table lives on the primary, which held nothing back.
  // [#24059] The declaration itself is read on every boot, a skip-sync one
  // included: `nonObjectTables` below names the table from it whether or not
  // anything is planned for it.
  const packageStorage = findPackageStorage(kernel);
  let packageTable = defer && packageStorage ? await planPackageTable(packageStorage, composition.notes) : null;
  if (packageTable) pendingSchemaWork.push(packageTable.work);
  sortPendingSchemaWork(pendingSchemaWork);
  // [#21529] The tables the held-back sync would create: measured absent.
  const absentTables = new Set(
    pendingSchemaWork.filter((w) => w.kind === 'create_table').map((w) => w.table),
  );

  // [#22579] Which driver reported each drift entry — where it is applied.
  const driftOwners = new Map<ManagedDriftEntry, SqlDriverLike>();

  return {
    driver,
    dbLabel: describeDb(driver),
    dbSource,
    schemaSync: defer ? 'deferred' : skipSchemaSync ? 'skipped' : 'performed',
    telemetryDatabase: telemetryDriver ? telemetryDatabase : null,
    drivers: plannedDrivers,
    databaseOf: (d: SqlDriverLike): string | null => {
      if (d === driver) return describeDb(driver);
      if (d === telemetryDriver) return telemetryDatabase;
      return declaredDrivers.some((x) => x.driver === d) ? describeDb(d) : null;
    },
    detectManagedDrift: async (): Promise<ManagedDriftEntry[]> => {
      const drift: ManagedDriftEntry[] = [];
      for (const d of plannedDrivers) {
        for (const entry of await d.detectManagedDrift()) {
          driftOwners.set(entry, d);
          drift.push(entry);
        }
      }
      return drift;
    },
    applyMigrationEntries: async (entries, applyOpts) => {
      const unowned = entries.filter((e) => !driftOwners.has(e));
      if (unowned.length > 0) {
        throw new Error(
          `Refusing to apply ${unowned.length} drift entr${unowned.length === 1 ? 'y' : 'ies'} this migration did not `
          + `detect (${unowned.map((e) => e.table).join(', ')}): there is no datasource to apply ${unowned.length === 1 ? 'it' : 'them'} to.`,
        );
      }
      const applied: ManagedDriftEntry[] = [];
      const skipped: ManagedDriftEntry[] = [];
      for (const d of plannedDrivers) {
        const own = entries.filter((e) => driftOwners.get(e) === d);
        // The primary is asked every time, as it was before there was a
        // sibling; the sibling only for entries of its own.
        if (own.length === 0 && d !== driver) continue;
        const result = await d.applyMigrationEntries(own, applyOpts);
        applied.push(...result.applied);
        skipped.push(...result.skipped);
      }
      return { applied, skipped };
    },
    driftApplyLimit: (entry: ManagedDriftEntry): string | null => {
      const owner = driftOwners.get(entry);
      if (!owner) {
        throw new Error(
          `No driver reported the drift entry on ${entry.table} (${entry.op.type}): only an entry this migration detected `
          + 'has a database whose apply limit can be read.',
        );
      }
      // The entry's own limit first (a unique index its rows violate, ADR-0120
      // D4), then the driver's for its op type; neither, and it applies.
      return entry.applyLimit ?? (owner.driftApplyLimit ? owner.driftApplyLimit(entry.op.type) : null);
    },
    managedTableCount,
    kernel,
    pendingSchemaWork,
    nonObjectTables: packageStorage ? [packageStorage.table] : [],
    // The driver keys its deferred work by physical table, so ask in the same
    // name (`StorageNameMapping`, the mapping the driver itself applies).
    tableAbsent: (objectName: string): boolean =>
      absentTables.has(StorageNameMapping.resolveTableName({ name: objectName })),
    /**
     * Every object this booted stack knows about — the same set the plan is
     * computed against.
     *
     * Exposed for the ADR-0120 D5e advisory in `os migrate plan`: the advisory
     * must describe the objects the migration is actually planning for, not a
     * re-read of `objectstack.config.ts`, which on a runtime serving installed
     * marketplace packages is a strict subset. Best-effort — a stack with no
     * ObjectQL service reports none, and the advisory then simply says nothing.
     */
    allObjects: (): unknown[] => {
      try {
        // The `objectql` slot's contract is `IObjectQLEngine` (#4251) — read it
        // through that rather than erasing the lookup to `any`, so a rename of
        // `registry` / `getAllObjects` breaks this at compile time instead of
        // silently reporting zero objects and turning the D5e advisory mute.
        const getService = (kernel as { getService?: (name: string) => unknown })?.getService;
        const ql = getService?.call(kernel, 'objectql') as IObjectQLEngine | undefined;
        return ql?.registry?.getAllObjects?.() ?? [];
      } catch {
        return [];
      }
    },
    flushSchemaDdl: async () => {
      // [#21391] Every armed datasource, in the order it was armed; then the
      // stack stops deferring drivers registered from here on.
      const performed: PendingSchemaWork[] = [];
      for (const d of deferral?.drivers ?? []) {
        if (d.flushDeferredSchemaDdl) performed.push(...(await d.flushDeferredSchemaDdl()));
      }
      // [#23022] The package registry's own DDL — the statements its boot runs.
      if (packageTable) {
        await packageTable.storage.ensure();
        performed.push(packageTable.work);
        packageTable = null;
      }
      // [#21529] The tables exist now; nothing is measured absent any more.
      absentTables.clear();
      deferral?.release();
      // [ADR-0131 D10] The birth half the deferred boot could not run: only a
      // deferred boot holds DDL back, so only it can have created the store here.
      if (deferral) await recordBirthOfFlushedStore(kernel, recordOrganizationOwnershipBirth, deferral.logger);
      return sortPendingSchemaWork(performed);
    },
    composition,
    /**
     * Tear the one-shot stack down through the kernel's own teardown — the
     * same `kernel.shutdown()` `os serve` runs on SIGTERM, so a one-shot
     * command and a server take ONE path out (#4747).
     *
     * It used to call `(runtime as any).stop?.()`. `Runtime` has no `stop` —
     * the optional-call swallowed that fact, so every `os migrate` subcommand
     * closed its driver while leaving the kernel fully "running": no plugin
     * ever got `destroy()`, and the ADR-0057 lifecycle sweep stayed armed. 60s
     * later it woke inside the still-alive process and read through the pool
     * this line had already closed, which is why a successful command ended in
     * `ERROR Find operation failed` and a #4551 report naming `sys_metadata` /
     * `sys_view_definition` as unreadable. A cast plus `?.` is how a missing
     * teardown looks exactly like a performed one; there is no version of that
     * call that could ever have worked.
     *
     * The explicit `disconnect()` stays as the backstop for a driver this
     * kernel did not register through `DefaultDatasourcePlugin` (whose own
     * `destroy()` closes the ones it owns); a second disconnect is a no-op.
     */
    shutdown: async () => {
      deferral?.release();
      try { await kernel.shutdown(); } catch { /* teardown is best-effort */ }
      // [#22579] The sibling is a `DriverPlugin` driver, which owns no teardown
      // of its own: the same backstop as the primary's.
      for (const d of plannedDrivers) {
        try { await d.disconnect?.(); } catch { /* ignore */ }
      }
      // Only now — `kernel.shutdown()` is itself two INFO lines ("Graceful
      // shutdown started" / "complete"), and under `--json` those printed
      // BELOW the payload, which is half of what made stdout unparseable
      // (before commit 2b641ddd4). Released after the kernel is down, when nothing is left to
      // write; a failed boot never reaches here on purpose.
      releaseStdout();
    },
  };
}

// ── Rendering ───────────────────────────────────────────────────────

/**
 * Load the driver's additive/in-place classifier at the moment it is used,
 * rather than when this module is loaded (#5726).
 *
 * `isInPlaceSchemaWork` is the ONLY thing this module needs from
 * `@objectstack/driver-sql` at runtime — everything else it takes from that
 * package is `import type`, which erases. A *static* value import for it was
 * not a local cost, because this file is not loaded only when someone migrates:
 * oclif's `findCommand` `import()`s every command module on **every** CLI
 * invocation, and nine commands reached this file (then `meta:resync`, `migrate`,
 * and seven `migrate:*`). So an unbuilt `packages/drivers/driver-sql/dist` did not
 * merely break those nine — running *any* command, `os dev` included, printed
 * one `MODULE_NOT_FOUND` block per command in front of the output you asked for
 * (and `os dev` forks a child, so you saw each one twice), while the nine
 * dropped out of the command table entirely: `os migrate plan` answered
 * `Command migrate:plan not found.` None of that noise named the real cause
 * (`pnpm build`) and the one actionable line it ended on pointed elsewhere.
 *
 * Deliberately a lazy import of the driver's own predicate rather than a copy
 * of it here. The additive/in-place split is a fact about
 * `PendingSchemaWorkKind`, declared next to that union in the driver; a second
 * copy in the CLI would be free to disagree the day a kind is added — and the
 * way it would disagree is by listing a row rewrite under a heading that
 * promises the work is never data-losing (#3954). One definition, loaded later.
 *
 * By the time either renderer runs, the caller is holding a live SQL driver
 * (the entries it renders came from `previewDeferredSchemaWork()`), so the
 * module is already in the loader cache and this costs nothing. It is
 * deliberately not wrapped in a `try`: if it ever did fail, rendering must fail
 * loudly rather than fall back to a guess about which work rewrites data.
 */
async function loadIsInPlaceSchemaWork(): Promise<(kind: PendingSchemaWork['kind']) => boolean> {
  const { isInPlaceSchemaWork } = await import('@objectstack/driver-sql');
  return isInPlaceSchemaWork;
}

const CATEGORY_ORDER: DriftCategory[] = ['safe', 'needs_confirm', 'destructive'];

const CATEGORY_META: Record<DriftCategory, { label: string; color: (s: string) => string; icon: string }> = {
  safe: { label: 'Safe (loosening — applied without --allow-destructive)', color: chalk.green, icon: '✓' },
  needs_confirm: { label: 'Needs confirmation', color: chalk.yellow, icon: '~' },
  destructive: { label: 'Destructive (requires --allow-destructive)', color: chalk.red, icon: '✗' },
};

export function groupByCategory(drift: ManagedDriftEntry[]): Record<DriftCategory, ManagedDriftEntry[]> {
  const out: Record<DriftCategory, ManagedDriftEntry[]> = { safe: [], needs_confirm: [], destructive: [] };
  for (const d of drift) out[d.category].push(d);
  return out;
}

/**
 * What a drift entry acts on. Column ops read `table.column`; index ops (#3728)
 * name the index instead — a composite unique spans several columns, so the
 * leading column alone would misrepresent what is about to change.
 */
export function driftTarget(d: ManagedDriftEntry): string {
  const op = d.op as { indexName?: string; createIndexName?: string };
  const indexName = op.indexName ?? op.createIndexName;
  return indexName ? `${d.table} [${indexName}]` : `${d.table}.${d.column ?? ''}`;
}

export function renderPlan(
  drift: ManagedDriftEntry[],
  /**
   * [#23925] The line under each entry: its message, unless the caller knows
   * better. `os migrate plan` passes one for a database whose driver declares
   * it cannot apply an entry (the finding with that limit, not the remedy).
   */
  describe: (d: ManagedDriftEntry) => string = (d) => d.message,
): void {
  const grouped = groupByCategory(drift);
  for (const cat of CATEGORY_ORDER) {
    const items = grouped[cat];
    if (items.length === 0) continue;
    const meta = CATEGORY_META[cat];
    console.log(`  ${chalk.bold(meta.label)}`);
    for (const d of items) {
      console.log(`    ${meta.color(meta.icon)} ${meta.color(driftTarget(d))} ${chalk.dim(`[${d.op.type}]`)}`);
      console.log(`        ${chalk.dim(describe(d))}`);
    }
    console.log('');
  }
}

/**
 * [#23925] The entries whose reporting driver declares its apply door cannot
 * perform them ({@link SchemaStack.driftApplyLimit}), each with that limit.
 * Empty when every reporting driver declares nothing, and then `os migrate
 * plan` and `os migrate apply` render exactly as they always have.
 */
export function collectDriftApplyLimits(
  stack: Pick<SchemaStack, 'driftApplyLimit'>,
  drift: readonly ManagedDriftEntry[],
): Map<ManagedDriftEntry, string> {
  const limits = new Map<ManagedDriftEntry, string>();
  for (const d of drift) {
    const limit = stack.driftApplyLimit(d);
    if (limit !== null) limits.set(d, limit);
  }
  return limits;
}

/**
 * [#23925] The {@link renderPlan} `describe` for those entries: the finding
 * without its `--allow-destructive` sentence, then the driver's limit, so the
 * listing never offers a remedy that database does not have. Every other
 * entry keeps its message. One spelling, read by `os migrate plan` and by the
 * listing `os migrate apply` prints before its prompt. The driver package is
 * imported at the point of use, never statically
 * (`schema-migrate.lazy-driver-import.test.ts`).
 */
export async function describeWithApplyLimits(
  limits: ReadonlyMap<ManagedDriftEntry, string>,
): Promise<(d: ManagedDriftEntry) => string> {
  const { driftFindingWithoutRemedy } = await import('@objectstack/driver-sql');
  return (d) => {
    const limit = limits.get(d);
    return limit === undefined
      ? d.message
      : `${driftFindingWithoutRemedy(d)} "os migrate apply" cannot apply it on this database: ${limit}.`;
  };
}

export function summarize(drift: ManagedDriftEntry[]): string {
  const g = groupByCategory(drift);
  return `${drift.length} change(s): ${g.safe.length} safe, ${g.needs_confirm.length} needs-confirm, ${g.destructive.length} destructive`;
}

/**
 * Render the work the boot sync was held back from doing (#3917), in two
 * sections split by whether it touches existing data (#3954).
 *
 * Deliberately its own block rather than a `DriftCategory`: this is not
 * divergence between metadata and an existing column — it is what used to
 * happen silently at boot, now shown before it runs.
 *
 * The split matters. The additive section tells the operator the work is never
 * data-losing, and that promise must not quietly come to cover the datetime
 * convergence, which rewrites rows (SQLite) or rebuilds a column (MySQL). Those
 * get their own heading, and their row counts, because "how long will this hold
 * the table" is the question they raise and the additive kinds do not.
 */
export async function renderPendingSchemaWork(pending: PendingSchemaWork[]): Promise<void> {
  if (pending.length === 0) return;

  const isInPlaceSchemaWork = await loadIsInPlaceSchemaWork();
  const additive = pending.filter((p) => !isInPlaceSchemaWork(p.kind));
  const inPlace = pending.filter((p) => isInPlaceSchemaWork(p.kind));

  if (additive.length > 0) {
    console.log(`  ${chalk.bold('New (additive — created when you apply)')}`);
    for (const p of additive) {
      const detail = p.kind === 'create_table'
        ? `[create_table, ${p.columns.length} column(s)]`
        : `[add_columns: ${p.columns.join(', ')}]`;
      console.log(`    ${chalk.cyan('+')} ${chalk.cyan(p.table)} ${chalk.dim(detail)}`);
    }
    console.log('');
  }

  if (inPlace.length > 0) {
    console.log(`  ${chalk.bold('In place (existing rows converged when you apply)')}`);
    for (const p of inPlace) {
      // A MySQL widen is `ALTER … MODIFY`, i.e. a full table rebuild holding a
      // metadata lock — worth saying outright, not just implying via the count.
      const cost = p.kind === 'widen_datetime_columns' || p.kind === 'widen_time_columns'
        ? `${formatRows(p.rows)} row table rebuild`
        : `${formatRows(p.rows)} row update(s)`;
      console.log(
        `    ${chalk.yellow('~')} ${chalk.yellow(p.table)} ` +
        `${chalk.dim(`[${p.kind}: ${p.columns.join(', ')} — ${cost}]`)}`,
      );
    }
    console.log('');
  }
}

/** `rows` is optional on the type; an unmeasured count reads as unknown, not zero. */
function formatRows(rows: number | undefined): string {
  return rows === undefined ? '?' : rows.toLocaleString('en-US');
}

export async function summarizePendingSchemaWork(pending: PendingSchemaWork[]): Promise<string> {
  const creates = pending.filter((p) => p.kind === 'create_table').length;
  const columns = pending
    .filter((p) => p.kind === 'add_columns')
    .reduce((n, p) => n + p.columns.length, 0);
  const parts = [`${creates} table(s) to create`, `${columns} column(s) to add`];

  // Only mentioned when there is some, so the common in-sync summary is
  // unchanged — but never omitted when there is, which is the #3954 point.
  const isInPlaceSchemaWork = await loadIsInPlaceSchemaWork();
  const inPlace = pending.filter((p) => isInPlaceSchemaWork(p.kind));
  if (inPlace.length > 0) {
    const cols = inPlace.reduce((n, p) => n + p.columns.length, 0);
    const rows = inPlace.reduce((n, p) => n + (p.rows ?? 0), 0);
    parts.push(`${cols} temporal column(s) to converge in place (~${formatRows(rows)} rows)`);
  }
  return parts.join(', ');
}
