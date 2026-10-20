// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  isDataMigrationFlagVerified,
  organizationOwnershipShapeGenerationOf,
  DATA_MIGRATION_FLAG_OBJECT,
  ORGANIZATION_OWNERSHIP_MIGRATION_ID,
  ORGANIZATION_OWNERSHIP_SHAPE_GENERATION,
  type DataMigrationFlag,
  type OrganizationOwnershipBirthMarker,
} from '@objectstack/spec/system';
import { resolveRuntimeVersion } from './runtime-version.js';

/**
 * OrganizationOwnershipBootGuardPlugin — the v18 boot refusal (ADR-0131 D10
 * item 5; ruling 6163114098, Q3 A).
 *
 * A v18 runtime against a database still in the v17 shape would serve it with
 * v18 semantics it was never migrated for: the organization columns the D7
 * objects and the `sys_metadata` family no longer declare still hold their
 * legacy rows, and nothing reads them. The ceremony that carries those rows,
 * `os migrate organization-ownership --apply`, is an operator's act, never a
 * boot step (D10). So the runtime refuses to start until it has run, and says
 * which command to run.
 *
 * ## What is refused
 *
 * The guard reads the ceremony's `sys_migration` row
 * ({@link ORGANIZATION_OWNERSHIP_MIGRATION_ID}) and decides on ONE field of
 * it: the ownership shape generation it attests
 * (`organizationOwnershipShapeGenerationOf`), against the one this release
 * requires ({@link ORGANIZATION_OWNERSHIP_SHAPE_GENERATION}; ruling record
 * 6269955919 on the v18 epic, ① A and item 2). It never compares versions.
 *
 * 1. A VERIFIED row at the current generation — the ceremony's completion
 *    marker, or the birth marker below — boots, whatever the columns hold.
 * 2. No row, on a datastore this boot observed being CREATED FROM EMPTY: the
 *    guard writes the BIRTH MARKER (verified, `details.birth` =
 *    {@link OrganizationOwnershipBirthMarker}) exactly once and boots. The
 *    observation is the store that holds the ledger — its driver's own schema
 *    sync stats — never the sum over every driver: a `telemetry` sibling left
 *    over from an earlier boot does not make a fresh primary look old, and a
 *    fresh sibling does not make an old primary look new.
 * 3. No row on any other store: a database with no birth marker, which 17.x
 *    and the 18.0 pre-releases (18.0.0-next.*) created — refused until the
 *    ceremony has run on it. The tables still carrying a retired `organization_id` (an object that
 *    declares no organization column — `systemFields.tenant: false`,
 *    `systemFields: false` or `tenancy: { enabled: false }` — whose physical
 *    table still has one) are named when there are any.
 * 4. A verified row BELOW the current generation — a database a shorter
 *    ceremony certified, or a marker written before generations existed — is
 *    refused, naming the ceremony again: its new steps have not run there.
 * 5. A row the ceremony wrote and did not verify (its post-check found rows it
 *    has not carried) is refused, naming the re-run; so is a row that could
 *    not be read.
 *
 * - A read that fails is refused, never passed: "I could not check" is not
 *   "there is nothing to find" (the `readDataMigrationFlag` asymmetry).
 * - A birth marker that cannot be written refuses the boot: a store left
 *   without one would be taken, at its next boot, for a database an earlier
 *   release created.
 * - ⛔ No escape hatch: no `OS_ALLOW_*` / `OS_SKIP_*` variable and no flag
 *   skips the check (D10 verbatim).
 *
 * ## When it judges: in `start()`, before any plugin writes a row
 *
 * The boot the ceremony prescribes — "boot this release once against the
 * database (its schema sync adds the column)" — must write nothing before it
 * is refused. A refusal at `kernel:ready` came after every plugin's `start()`:
 * by then the auth plugin had created the Default Organization, the inline
 * seed had started stamping rows with it (the refusal's rollback cut it
 * mid-object), and the platform migrations had recorded their run — a
 * half-stamped database the ceremony's next apply then read as discrepancies.
 * So the guard judges in its own `start()`, ordered after the engine (whose
 * `start()` connects the drivers and runs the additive schema sync the
 * ceremony waits for) and the platform objects (`sys_migration`), and ahead of
 * every plugin that writes at start: the plugins that do declare it in their
 * `optionalDependencies` ({@link ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME}
 * — `AppPlugin`, whose `start()` loads the inline seed; plugin-auth's
 * `AuthPlugin` and identity-objects plugin, whose `start()` creates the
 * Default Organization), and `os serve` composes it ahead of the rest. A
 * `start()` that throws stops the kernel before the next plugin starts; the
 * kernel hands the refusal on as the `cause` of its own start-failure error
 * ("Plugin … failed to start"), so a host that inspects the boot error asks
 * {@link isOrganizationOwnershipBootRefusal} of each `cause` down the chain.
 *
 * ## Where it runs, and where it must not
 *
 * Composed by `os serve` (and so `os dev`) only, beside
 * `MigrationRecoveryPlugin`. ⛔ Never in `createStandaloneStack`'s own list:
 * every CLI data and schema boot shares that builder, the ceremony's own boot
 * among them, and a guard there would refuse the one command that clears it.
 * That builder composes the birth half alone
 * ({@link OrganizationOwnershipBirthMarkerPlugin}), which writes the marker on
 * a store it created from empty and never refuses.
 *
 * A store with no physical columns to read (memory, MongoDB), or a
 * composition with no ledger or no store serving it, has nothing to judge:
 * the guard is inert there, as the recovery plugin is on a kernel with no
 * journal.
 */

/** The machine code a host discriminates this refusal by, across module instances. */
export const ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE = 'ORGANIZATION_OWNERSHIP_MIGRATION_REQUIRED' as const;

/**
 * The guard's kernel plugin name: a plugin that writes rows in its `start()`
 * names it in `optionalDependencies`, so on a kernel that composes the guard it
 * starts only once the guard has judged the database (ADR-0116 ordering).
 * Not a package entry export: each writer spells the name as a string literal
 * (`check:init-service-contract` reads `optionalDependencies` as literals only),
 * and the guard's tests pin each declaration against this constant.
 */
export const ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME = 'com.objectstack.organization-ownership-boot-guard' as const;

const ORG = 'organization_id';

/**
 * The ceremony command the refusal names, spelled for the boot that refused:
 * a development boot (`os dev`, `os serve --dev`) composes its security
 * plugin, `.env*` files and `telemetry` sibling as a development boot, and the
 * ceremony has to boot the same way to see the same database, so the command
 * it names carries `--dev`.
 */
function ceremonyCommand(dev: boolean | undefined): string {
  return dev ? 'os migrate organization-ownership --dev' : 'os migrate organization-ownership';
}

/** How the boot that runs the guard was started — what the refusal's command must match. */
export interface OrganizationOwnershipBootGuardOptions {
  /** A development boot (`os dev` / `os serve --dev`): the named ceremony command carries `--dev`. */
  dev?: boolean;
}

export class OrganizationOwnershipBootRefusal extends Error {
  readonly code = ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE;
  constructor(
    message: string,
    /** The tables still carrying a retired organization column; empty when the read itself failed. */
    readonly tables: readonly string[],
  ) {
    super(message);
    this.name = 'OrganizationOwnershipBootRefusal';
  }
}

/** Structural, not `instanceof`: a host may hold two module instances. */
export function isOrganizationOwnershipBootRefusal(error: unknown): error is OrganizationOwnershipBootRefusal {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE;
}


type Dialect = 'sqlite' | 'postgres' | 'mysql';

/**
 * The driver's dialect. `SqlDriver.dialectName` is the public, structural
 * answer, and the only one that names a driver whose knex `client` is a
 * dialect CLASS rather than a string — `SqliteWasmDriver`, the default SQLite
 * driver of a served file database. Reading `config.client` alone left the
 * guard inert on exactly that driver. The client string is the fallback for a
 * driver that exposes no `dialectName`.
 */
function dialectOfDriver(driver: { dialectName?: unknown; config?: { client?: unknown } } | undefined): Dialect | null {
  const named = driver?.dialectName;
  if (named === 'sqlite' || named === 'postgres' || named === 'mysql') return named;
  return dialectOf(driver?.config?.client);
}

function dialectOf(client: unknown): Dialect | null {
  const c = String(client ?? '').toLowerCase();
  if (['sqlite3', 'sqlite', 'better-sqlite3'].includes(c)) return 'sqlite';
  if (['postgres', 'pg', 'postgresql', 'pgnative'].includes(c)) return 'postgres';
  if (['mysql', 'mysql2'].includes(c)) return 'mysql';
  return null;
}

/** One table's column names, per dialect (the ceremony's own `columnListSql`). */
function columnListSql(dialect: Dialect): string {
  if (dialect === 'sqlite') return 'SELECT name AS column_name FROM pragma_table_info(?)';
  if (dialect === 'postgres') {
    return 'SELECT column_name FROM information_schema.columns WHERE table_schema = ANY (current_schemas(false)) AND table_name = ?';
  }
  return 'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?';
}

/** The rows of a raw `execute`, whatever shape the dialect hands back. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return (Array.isArray(result[0]) ? result[0] : result) as Record<string, unknown>[];
  }
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function columnNameOf(row: Record<string, unknown>): string | null {
  const v = row.column_name ?? row.COLUMN_NAME ?? row.name;
  return typeof v === 'string' ? v : null;
}

interface GuardDriver {
  dialectName?: unknown;
  config?: { client?: unknown };
  execute?: (sql: string, params?: unknown[]) => Promise<unknown>;
  getSchemaSyncStats?: () => { created: number; existing: number } | undefined;
}

interface GuardEngine {
  registry?: { getAllObjects?: () => unknown[] };
  getDriverForObject?: (object: string) => unknown;
  findOne?: (object: string, query: Record<string, unknown>) => Promise<unknown>;
  insert?: (object: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  getObject?: (name: string) => unknown;
  wasDatastoreCreatedFromEmpty?: () => boolean;
  invalidateDataMigrationFlags?: () => void;
}

/**
 * Whether an object declares that it carries no organization column: every
 * spelling the injected-column resolver honours for an object of its own —
 * `systemFields: false`, `systemFields.tenant: false`, and
 * `tenancy: { enabled: false }` (`injected-system-columns.ts`).
 */
function declaresNoOrganizationColumn(object: {
  systemFields?: unknown;
  tenancy?: { enabled?: unknown };
}): boolean {
  if (object.systemFields === false) return true;
  if ((object.systemFields as { tenant?: unknown } | undefined)?.tenant === false) return true;
  return object.tenancy?.enabled === false;
}

/**
 * The tables in the v17 shape: an object that declares no organization column
 * ({@link declaresNoOrganizationColumn}) whose physical table still carries
 * one. Only SQL drivers are read; any other driver is skipped. Throws when a
 * column read fails.
 */
export async function findV17ShapeTables(engine: GuardEngine): Promise<string[]> {
  const objects = (engine.registry?.getAllObjects?.() ?? []) as Array<{
    name?: string;
    systemFields?: unknown;
    tenancy?: { enabled?: unknown };
    fields?: Record<string, unknown>;
  }>;
  const found: string[] = [];
  for (const object of objects) {
    const name = object?.name;
    if (typeof name !== 'string' || !declaresNoOrganizationColumn(object)) continue;
    if (object.fields && Object.prototype.hasOwnProperty.call(object.fields, ORG)) continue;
    const driver = engine.getDriverForObject?.(name) as GuardDriver | undefined;
    const dialect = dialectOfDriver(driver);
    if (!dialect || typeof driver?.execute !== 'function') continue;
    const columns = rowsOf(await driver.execute(columnListSql(dialect), [name]))
      .map(columnNameOf)
      .filter((c): c is string => c !== null);
    if (columns.includes(ORG)) found.push(name);
  }
  return found.sort();
}

/** The guard's reading of the ceremony's `sys_migration` row (see {@link readMarker}). */
export type OrganizationOwnershipMarkerState = 'absent' | 'unverified' | 'unreadable' | 'outdated';

/**
 * The refusal text: what was found, that the server refuses to start, and the
 * command. It names no release line to stay on: a database an 18.0
 * pre-release (18.0.0-next.*) created is refused here exactly as a v17 one is,
 * and both take the same ceremony.
 */
export function organizationOwnershipRefusalMessage(
  tables: readonly string[],
  marker: OrganizationOwnershipMarkerState,
  opts: OrganizationOwnershipBootGuardOptions & { generation?: number } = {},
): string {
  const ceremony = ceremonyCommand(opts.dev);
  const run =
    `Run '${ceremony} --out PLAN' to write and review its plan, take a backup, then run ` +
    `'${ceremony} --apply --plan-file PLAN --backup-taken', and start again.`;
  const columns = tables.length > 0
    ? ` ${tables.join(', ')} still carr${tables.length === 1 ? 'ies' : 'y'} a physical organization_id column its ` +
      'object no longer declares.'
    : '';
  if (marker === 'outdated') {
    return (
      `This database was certified by an organization-ownership ceremony of shape generation ${opts.generation ?? 0}, ` +
      `and this release requires generation ${ORGANIZATION_OWNERSHIP_SHAPE_GENERATION}: the ceremony steps added since ` +
      `have not run on it.${columns} The server refuses to start rather than serve it in a shape it was never ` +
      `migrated to. ${run}`
    );
  }
  if (marker === 'absent') {
    return (
      'This database carries no organization-ownership marker: 17.x or an 18.0 pre-release (18.0.0-next.*) ' +
      'created it, and this release serves only a database it created itself or one its ownership ceremony upgraded.' +
      `${columns} The server refuses to start rather than serve it in a shape it was never migrated to. ${run}`
    );
  }
  if (marker === 'unreadable') {
    return (
      `The organization-ownership marker (sys_migration '${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') of this database ` +
      `could not be read, and an unread answer is never taken for a migrated database.${columns} The server refuses ` +
      `to start. Fix the read, or run the ceremony: ${run}`
    );
  }
  return (
    `The organization-ownership ceremony has not finished on this database: its marker (sys_migration ` +
    `'${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') is not verified, so the post-check still found rows the ceremony has ` +
    `not carried.${columns} The server refuses to start rather than serve rows of an organization-owned object with ` +
    `no organization. Resolve what the apply report names, then run '${ceremony} --out PLAN' again, review it, run ` +
    `'${ceremony} --apply --plan-file PLAN --backup-taken', and start again.`
  );
}

export class OrganizationOwnershipBootGuardPlugin implements Plugin {
  readonly name = ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME;
  readonly type = 'standard';
  readonly version = '1.0.0';
  readonly dependencies: string[] = [];
  /**
   * Started after the engine — its `start()` connects the drivers and runs the
   * additive schema sync the ceremony's rewrite step waits for — and after the
   * platform objects, which register `sys_migration`. Order-if-present: the
   * guard still loads (inert) on a kernel with no engine.
   */
  readonly optionalDependencies: string[] = ['com.objectstack.engine.objectql', 'com.objectstack.platform-objects'];

  constructor(private readonly options: OrganizationOwnershipBootGuardOptions = {}) {}

  async init(_ctx: PluginContext): Promise<void> {}

  /**
   * [ADR-0131 D10 item 5] Judges here, not at `kernel:ready`: the plugins that
   * write rows in their own `start()` are ordered after this one, so a refused
   * boot has written none (see the module doc).
   */
  async start(ctx: PluginContext): Promise<void> {
    let engine: GuardEngine | undefined;
    try {
      engine = (ctx as any).getService?.('objectql');
    } catch {
      return; // no engine — no database to judge
    }
    if (!engine || typeof engine.getDriverForObject !== 'function') return;
    await assertOrganizationOwnershipMigrated(engine, (ctx as any)?.logger, this.options);
  }
}

/** What the guard read of the ceremony's `sys_migration` row. */
type MarkerReading =
  /** No ledger on this composition, or no SQL store serving it: nothing to judge. */
  | { state: 'inert' }
  | { state: 'absent' }
  | { state: 'unreadable' }
  | { state: 'unverified'; generation: number }
  | { state: 'verified'; generation: number };

/**
 * [Ruling record 6269955919, ① A] The birth half alone, for a boot that
 * composes no guard: every CLI data and schema boot (`createStandaloneStack`),
 * which can be the boot that creates a fresh install's store (`os migrate
 * apply`, `os seed` before the first `os serve`). It writes the birth marker
 * under exactly the guard's conditions — a ledger served by a SQL store this
 * boot created from empty, no marker on it, no table in an earlier shape — and
 * never refuses: judging the database stays the served boot's. Without it, the
 * first `os serve` of an install whose store a CLI boot created would find no
 * marker on a store it did not create, and refuse a fresh install.
 *
 * The ceremony's own boots never trip it: they hold their DDL back
 * (`deferSchemaDdl`) or skip schema sync, so their store reports nothing
 * created.
 */
export class OrganizationOwnershipBirthMarkerPlugin implements Plugin {
  readonly name = ORGANIZATION_OWNERSHIP_BIRTH_MARKER_PLUGIN_NAME;
  readonly type = 'standard';
  readonly version = '1.0.0';
  readonly dependencies: string[] = [];
  /** As the guard: after the engine's schema sync and the ledger's registration. */
  readonly optionalDependencies: string[] = ['com.objectstack.engine.objectql', 'com.objectstack.platform-objects'];

  async init(_ctx: PluginContext): Promise<void> {}

  async start(ctx: PluginContext): Promise<void> {
    let engine: GuardEngine | undefined;
    try {
      engine = (ctx as any).getService?.('objectql');
    } catch {
      return;
    }
    if (!engine || typeof engine.getDriverForObject !== 'function') return;
    const logger = (ctx as any)?.logger as { info?: (msg: string) => void; error?: (msg: string) => void } | undefined;
    try {
      await recordOrganizationOwnershipBirth(engine, logger);
    } catch (error) {
      // Durability: the store keeps looking healthy, and its first served boot
      // will refuse it as one an earlier release created.
      logger?.error?.(
        `[organization-ownership] this store was created from empty and its birth marker (sys_migration ` +
          `'${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') could not be written ` +
          `(${error instanceof Error ? error.message : String(error)}): the first 'os serve' will refuse it as a ` +
          `database an earlier release created. Fix the write and run this command again, or run 'os migrate ` +
          `organization-ownership' on it.`,
      );
    }
  }
}

/** The birth-marker plugin's kernel name. */
export const ORGANIZATION_OWNERSHIP_BIRTH_MARKER_PLUGIN_NAME = 'com.objectstack.organization-ownership-birth-marker' as const;

/**
 * Write the birth marker when, and only when, this boot created the ledger's
 * store from empty and no marker and no table in an earlier shape is there.
 * The marker written, or `null` when none was owed. Throws when the write fails.
 */
export async function recordOrganizationOwnershipBirth(
  engine: GuardEngine,
  logger?: { info?: (msg: string) => void },
  now: () => Date = () => new Date(),
): Promise<OrganizationOwnershipBirthMarker | null> {
  if (!ledgerStoreCreatedFromEmpty(engine)) return null;
  if ((await readMarker(engine)).state !== 'absent') return null;
  if ((await findV17ShapeTables(engine)).length > 0) return null;
  const birth = await writeBirthMarker(engine, now());
  logger?.info?.(
    `[organization-ownership] a datastore created from empty: birth marker written (shape generation ` +
      `${birth.shapeGeneration}, platform ${birth.platformVersion}).`,
  );
  return birth;
}

/**
 * The ceremony's marker. `inert` when this composition registers no ledger
 * object, no store serves it (`os serve` with no OS_DATABASE_URL and no driver
 * plugin), or the store that does has no physical columns to read (memory,
 * MongoDB) — nothing was ever migrated there. `unreadable` only when a store
 * serves the ledger and its read threw.
 */
async function readMarker(engine: GuardEngine): Promise<MarkerReading> {
  if (typeof engine.findOne !== 'function') return { state: 'inert' };
  if (typeof engine.getObject === 'function' && !engine.getObject(DATA_MIGRATION_FLAG_OBJECT)) return { state: 'inert' };
  const store = ledgerStore(engine);
  if (!store || !dialectOfDriver(store)) return { state: 'inert' };
  try {
    const row = (await engine.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID },
      context: { isSystem: true },
    })) as DataMigrationFlag | null;
    if (!row) return { state: 'absent' };
    const flag = { ...row, blocking: Number((row as { blocking?: unknown }).blocking) } as DataMigrationFlag;
    const generation = organizationOwnershipShapeGenerationOf(flag.details);
    return isDataMigrationFlagVerified(flag) ? { state: 'verified', generation } : { state: 'unverified', generation };
  } catch {
    return { state: 'unreadable' };
  }
}

/** The driver that serves the ledger, or `undefined`. */
function ledgerStore(engine: GuardEngine): GuardDriver | undefined {
  if (typeof engine.getDriverForObject !== 'function') return undefined;
  try {
    return (engine.getDriverForObject(DATA_MIGRATION_FLAG_OBJECT) as GuardDriver | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Did THIS boot observe the store that holds the ledger being created from
 * empty? Its own driver's schema-sync stats (`getSchemaSyncStats`): every
 * table it synced it created, none it found. A driver that cannot report
 * answers through the engine's all-driver reading, and "cannot say" is no.
 */
function ledgerStoreCreatedFromEmpty(engine: GuardEngine): boolean {
  const stats = ledgerStore(engine)?.getSchemaSyncStats?.();
  if (stats) return (Number(stats.existing) || 0) === 0 && (Number(stats.created) || 0) > 0;
  try {
    return engine.wasDatastoreCreatedFromEmpty?.() === true;
  } catch {
    return false;
  }
}

/**
 * Write the birth marker: the ceremony's row, verified, with `details.birth`
 * naming the generation the store was created in. Only where no row exists.
 */
async function writeBirthMarker(engine: GuardEngine, now: Date): Promise<OrganizationOwnershipBirthMarker> {
  if (typeof engine.insert !== 'function') throw new Error('the engine offers no insert');
  const at = now.toISOString();
  // `commit` stays absent: no build of this runtime records its source commit.
  const birth: OrganizationOwnershipBirthMarker = {
    shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION,
    platformVersion: resolveRuntimeVersion(),
    createdAt: at,
  };
  await engine.insert(
    DATA_MIGRATION_FLAG_OBJECT,
    {
      id: ORGANIZATION_OWNERSHIP_MIGRATION_ID,
      last_run_at: at,
      verified_at: at,
      applied_at: null,
      blocking: 0,
      advisory: 0,
      details: JSON.stringify({ birth }),
      created_at: at,
      updated_at: at,
    },
    { context: { isSystem: true } },
  );
  engine.invalidateDataMigrationFlags?.();
  return birth;
}

/**
 * The check itself, for the plugin and for a host that composes its own boot:
 * resolves when the database may be served (writing the birth marker on a
 * store created from empty), throws {@link OrganizationOwnershipBootRefusal}
 * when it may not.
 */
export async function assertOrganizationOwnershipMigrated(
  engine: GuardEngine,
  logger?: { info?: (msg: string) => void },
  opts: OrganizationOwnershipBootGuardOptions & { now?: () => Date } = {},
): Promise<void> {
  const ceremony = ceremonyCommand(opts.dev);
  let tables: string[];
  try {
    tables = await findV17ShapeTables(engine);
  } catch (error) {
    throw new OrganizationOwnershipBootRefusal(
      `The server refuses to start: it could not read whether this database is still in an earlier organization-` +
        `ownership shape (${error instanceof Error ? error.message : String(error)}), and an unread answer is never ` +
        `taken for a migrated database. Fix the read, or run the ceremony ('${ceremony} --out PLAN', then ` +
        `'${ceremony} --apply --plan-file PLAN --backup-taken'), then start again.`,
      [],
    );
  }
  const marker = await readMarker(engine);
  if (marker.state === 'inert') return;
  if (marker.state === 'verified' && marker.generation >= ORGANIZATION_OWNERSHIP_SHAPE_GENERATION) {
    if (tables.length > 0) {
      logger?.info?.(
        `[organization-ownership] ${tables.join(', ')} still carry a physical organization_id column, and the ` +
          `marker is verified at shape generation ${marker.generation}: the server starts.`,
      );
    }
    return;
  }
  if (marker.state === 'absent' && tables.length === 0 && ledgerStoreCreatedFromEmpty(engine)) {
    let birth: OrganizationOwnershipBirthMarker;
    try {
      birth = await writeBirthMarker(engine, (opts.now ?? (() => new Date()))());
    } catch (error) {
      throw new OrganizationOwnershipBootRefusal(
        `The server refuses to start: this datastore was created from empty, and its organization-ownership birth ` +
          `marker (sys_migration '${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') could not be written ` +
          `(${error instanceof Error ? error.message : String(error)}). Without it the next boot would take this ` +
          `store for a database an earlier release created. Fix the write and start again, or run the ceremony ` +
          `('${ceremony} --out PLAN', then '${ceremony} --apply --plan-file PLAN --backup-taken').`,
        [],
      );
    }
    logger?.info?.(
      `[organization-ownership] a datastore created from empty: birth marker written (shape generation ` +
        `${birth.shapeGeneration}, platform ${birth.platformVersion}).`,
    );
    return;
  }
  const state: OrganizationOwnershipMarkerState = marker.state === 'verified' ? 'outdated' : marker.state;
  throw new OrganizationOwnershipBootRefusal(
    organizationOwnershipRefusalMessage(tables, state, {
      ...opts,
      ...('generation' in marker ? { generation: marker.generation } : {}),
    }),
    tables,
  );
}
