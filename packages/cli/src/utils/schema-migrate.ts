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
 * the platform floor `serve` composes unconditionally (#12938). The DATA
 * subcommands keep their own narrower set (`./data-migration-plugins.ts`).
 * A project with neither a config nor a compiled artifact still diffs the data
 * stack alone — run `os build` first so its objects are visible.
 */
import chalk from 'chalk';
import type {
  ManagedDriftEntry,
  DriftCategory,
  MediaColumnMoveScan,
  PendingSchemaWork,
} from '@objectstack/driver-sql';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { describeDriverConnection } from './connection-display.js';
import { reserveStdoutForJson } from './json-stdout.js';
import {
  buildSchemaMigrationPlugins,
  measureComposedCoverage,
  type SchemaMigrationComposition,
} from './schema-migration-plugins.js';

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
  /** Deferred-DDL surface (#3917) — optional, so a driver without it still boots. */
  setDeferredDdl?: (deferred: boolean) => void;
  previewDeferredSchemaWork?: () => Promise<PendingSchemaWork[]>;
  flushDeferredSchemaDdl?: () => Promise<PendingSchemaWork[]>;
  config?: any;
  disconnect?: () => Promise<void>;
}

export interface SchemaStack {
  driver: SqlDriverLike | null;
  dbLabel: string;
  managedTableCount: number;
  /** The booted kernel — `getService('objectql')` etc. for one-shot commands
   *  beyond schema migration (e.g. `os meta resync`, #2705). */
  kernel: any;
  /**
   * Create-table / add-column work the boot sync was held back from running
   * (#3917). Always `[]` unless the stack was booted with `deferSchemaDdl`.
   */
  pendingSchemaWork: PendingSchemaWork[];
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
   */
  flushSchemaDdl: () => Promise<PendingSchemaWork[]>;
  /**
   * What the host composition added, and anything it could not (#12938) — the
   * host config it composed, whether that config actually loaded, the platform
   * floor it added. `notes` is always `[]` unless the boot asked for
   * `composeHostStack`, and `[]` even then when there was nothing to compose,
   * so a project with neither a config nor a compiled artifact renders
   * byte-identically to before this existed.
   */
  composition: SchemaMigrationComposition;
  shutdown: () => Promise<void>;
}

const SQL_DRIVER_SERVICES = [
  'driver.com.objectstack.driver.sql',
  'driver.com.objectstack.driver.turso',
  'driver.sql',
];

/** Locate the SQL driver behind any `getService`-shaped lookup (kernel or plugin ctx). */
function findSqlDriverVia(getService: (name: string) => any): SqlDriverLike | null {
  for (const name of SQL_DRIVER_SERVICES) {
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
 */
class DeferSchemaDdlPlugin {
  name = 'com.objectstack.cli.defer-schema-ddl';
  version = '1.0.0';
  /** Ordering, not optionality: our init must follow the one that registers `driver.*`. */
  dependencies = ['com.objectstack.runtime.default-datasource'];

  /** Every driver this boot deferred, in the order it was armed. */
  readonly drivers: SqlDriverLike[] = [];

  /** Engines whose `registerDriver` is shadowed, and what to restore. */
  private readonly shadows: Array<{
    engine: Record<string, unknown>;
    original: PropertyDescriptor | undefined;
    shadow: (...args: unknown[]) => unknown;
  }> = [];

  init = async (ctx: any) => {
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
     * meta --stored` and `os meta resync` all emitted ~60 INFO lines around
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
     * plan` and `os migrate apply`, and by nothing else.
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
     * of the data commands, `os meta resync --yes`) leaves this off.
     */
    deferSchemaDdl?: boolean;
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
  },
): Promise<SchemaStack> {
  // Taken BEFORE the first line the boot can print. `createStandaloneStack`
  // announces a missing compiled artifact on `console.log` before any plugin
  // is constructed, so a reservation installed one statement later already
  // arrives too late to keep stdout a single JSON document (commit 2b641ddd4).
  const releaseStdout = opts.jsonOutput ? reserveStdoutForJson() : () => { /* stdout is the caller's */ };

  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const defer = opts.deferSchemaDdl === true;

  const stack = await createStandaloneStack({
    projectRoot: opts.projectRoot ?? process.cwd(),
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
    //     --run`, `os secret orphans --delete`, `os meta resync --yes` — boot
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
  });

  // No HTTP, no cluster — this is a one-shot schema operation.
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) {
    await kernel.use(plugin);
  }
  const deferral = defer ? new DeferSchemaDdlPlugin() : null;
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
        cwd: opts.projectRoot ?? process.cwd(),
        // The same answer the standalone stack got above: never on this boot.
        skipSeedData: true,
      })
    : {
        plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null,
        notes: [], coverage: null,
      } satisfies SchemaMigrationComposition;
  for (const plugin of composition.plugins) {
    await kernel.use(plugin as any);
  }
  for (const plugin of opts.extraPlugins ?? []) {
    await kernel.use(plugin as any);
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

  // #13028 — the composed host declared its objects in `init()`; the pass that
  // hands them to their driver lives in `ObjectQLPlugin.start()`, which the
  // declaration-phase composition suppressed (and which a host bringing its
  // OWN engine plugin displaces outright, since duplicate registration
  // overwrites by name). Drive that pass here, over the deferral this boot
  // already armed, and record what it could NOT reach — so a partial plan says
  // so instead of reading as coverage. Runs only when this boot actually
  // composed a host; every other caller is untouched.
  if (opts.composeHostStack === true && composition.notes.length > 0) {
    const measured = await measureComposedCoverage(kernel, driver, defer);
    composition.coverage = measured.coverage;
    composition.notes.push(...measured.notes);
  }

  // Read AFTER the pass above — that is the step which fills both of them.
  const managedTableCount = driver ? (driver as any).managedObjectFields?.size ?? 0 : 0;
  // [#21391] Every datasource the deferral armed, not only the default's.
  const pendingSchemaWork: PendingSchemaWork[] = [];
  for (const d of deferral?.drivers ?? []) {
    if (d.previewDeferredSchemaWork) pendingSchemaWork.push(...(await d.previewDeferredSchemaWork()));
  }
  sortPendingSchemaWork(pendingSchemaWork);

  return {
    driver,
    dbLabel: describeDb(driver),
    managedTableCount,
    kernel,
    pendingSchemaWork,
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
      deferral?.release();
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
      try { await driver?.disconnect?.(); } catch { /* ignore */ }
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
 * invocation, and nine commands reach this file (`meta:resync`, `migrate`, and
 * seven `migrate:*`). So an unbuilt `packages/drivers/driver-sql/dist` did not
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

export function renderPlan(drift: ManagedDriftEntry[]): void {
  const grouped = groupByCategory(drift);
  for (const cat of CATEGORY_ORDER) {
    const items = grouped[cat];
    if (items.length === 0) continue;
    const meta = CATEGORY_META[cat];
    console.log(`  ${chalk.bold(meta.label)}`);
    for (const d of items) {
      console.log(`    ${meta.color(meta.icon)} ${meta.color(driftTarget(d))} ${chalk.dim(`[${d.op.type}]`)}`);
      console.log(`        ${chalk.dim(d.message)}`);
    }
    console.log('');
  }
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
