// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  isDataMigrationFlagVerified,
  DATA_MIGRATION_FLAG_OBJECT,
  ORGANIZATION_OWNERSHIP_MIGRATION_ID,
  type DataMigrationFlag,
} from '@objectstack/spec/system';

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
 * Two questions, in order:
 *
 * 1. Does a table whose object declares NO organization column
 *    (`systemFields.tenant: false` and no declared `organization_id`) still
 *    carry a PHYSICAL `organization_id`? Schema sync only adds, so on a
 *    database a v17 runtime created the answer is yes until the ceremony's
 *    column-drops step has run. If it is, the guard reads the ceremony's
 *    `sys_migration` marker ({@link ORGANIZATION_OWNERSHIP_MIGRATION_ID});
 *    unless that marker is verified, it throws
 *    {@link OrganizationOwnershipBootRefusal}.
 * 2. With no such table left: does the marker exist and say the ceremony has
 *    not finished? A ceremony whose every step ran (the columns are gone) but
 *    whose post-check found discrepancies records `applied_at` and leaves
 *    `verified_at` NULL — rows of an organization-owned object still without
 *    their organization. D10 item 5 refuses a database the ceremony has not
 *    COMPLETED, and `verified_at` is the ceremony's completion marker, so this
 *    database is refused too, naming the re-run. Without a marker there is
 *    nothing to judge: a fresh database is never refused.
 *
 * - A FRESH database is never refused: no table it creates carries a retired
 *   column, and no ceremony wrote a marker on it.
 * - A database whose ceremony verified boots, whatever its columns.
 * - A read that fails is refused, never passed: "I could not check" is not
 *   "there is nothing to find" (the `readDataMigrationFlag` asymmetry).
 * - ⛔ No escape hatch: no `OS_ALLOW_*` / `OS_SKIP_*` variable and no flag
 *   skips the check (D10 verbatim). A 17.x runtime is the way to keep 17.x
 *   semantics on an unmigrated database.
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
 *
 * A driver with no physical columns to read (memory, MongoDB) has no v17
 * shape to find: the guard is inert there, as the recovery plugin is on a
 * kernel with no journal.
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

interface GuardEngine {
  registry?: { getAllObjects?: () => unknown[] };
  getDriverForObject?: (object: string) => unknown;
  findOne?: (object: string, query: Record<string, unknown>) => Promise<unknown>;
  getObject?: (name: string) => unknown;
}

/**
 * The tables in the v17 shape: an object that declares no organization column
 * whose physical table still carries one. Only SQL drivers are read; any other
 * driver is skipped. Throws when a column read fails.
 */
export async function findV17ShapeTables(engine: GuardEngine): Promise<string[]> {
  const objects = (engine.registry?.getAllObjects?.() ?? []) as Array<{
    name?: string;
    systemFields?: { tenant?: unknown };
    fields?: Record<string, unknown>;
  }>;
  const found: string[] = [];
  for (const object of objects) {
    const name = object?.name;
    if (typeof name !== 'string' || object.systemFields?.tenant !== false) continue;
    if (object.fields && Object.prototype.hasOwnProperty.call(object.fields, ORG)) continue;
    const driver = engine.getDriverForObject?.(name) as
      | { dialectName?: unknown; config?: { client?: unknown }; execute?: (sql: string, params?: unknown[]) => Promise<unknown> }
      | undefined;
    const dialect = dialectOfDriver(driver);
    if (!dialect || typeof driver?.execute !== 'function') continue;
    const columns = rowsOf(await driver.execute(columnListSql(dialect), [name]))
      .map(columnNameOf)
      .filter((c): c is string => c !== null);
    if (columns.includes(ORG)) found.push(name);
  }
  return found.sort();
}

/**
 * The refusal text: what was found, that the server refuses to start, the
 * command, and the 17.x way out. With no table left in the v17 shape (`tables`
 * empty), the ceremony ran every step and its marker is not verified: the
 * text says so and names the re-run instead.
 */
export function organizationOwnershipRefusalMessage(
  tables: readonly string[],
  marker: 'absent' | 'unverified' | 'unreadable',
  opts: OrganizationOwnershipBootGuardOptions = {},
): string {
  const ceremony = ceremonyCommand(opts.dev);
  if (tables.length === 0) {
    const state = marker === 'unreadable'
      ? `its marker (sys_migration '${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') could not be read`
      : `its marker (sys_migration '${ORGANIZATION_OWNERSHIP_MIGRATION_ID}') is not verified: the post-check ` +
        'still found rows the ceremony has not carried';
    return (
      `The organization-ownership ceremony has not finished on this database: ${state}. The server refuses to start ` +
      'rather than serve rows of an organization-owned object with no organization. Resolve what the apply report ' +
      `names, then run '${ceremony} --out PLAN' again, review it, run '${ceremony} --apply --plan-file PLAN ` +
      "--backup-taken', and start again."
    );
  }
  const state = marker === 'absent'
    ? 'the ceremony has not run on it'
    : marker === 'unverified'
      ? 'the ceremony has not finished on it (its marker is not verified)'
      : 'its marker could not be read';
  return (
    `This database is still in the v17 organization-ownership shape: ${tables.join(', ')} still carr` +
    `${tables.length === 1 ? 'ies' : 'y'} a physical organization_id column, and ${state}. The server refuses to ` +
    `start rather than serve v17 data with v18 semantics. Run '${ceremony} --out PLAN' to write and review its ` +
    `plan, take a backup, then run '${ceremony} --apply --plan-file PLAN --backup-taken', and start again. ` +
    'To keep 17.x semantics, run a 17.x runtime.'
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

/**
 * The ceremony's marker: `absent` (no ledger on this composition, no store
 * serving it, or no row), `verified`, `unverified`, or `unreadable` (a store
 * serves the ledger and its read threw).
 */
async function readMarker(engine: GuardEngine): Promise<'absent' | 'verified' | 'unverified' | 'unreadable'> {
  if (typeof engine.findOne !== 'function') return 'absent';
  // A composition that registers no ledger object has no marker to hold.
  if (typeof engine.getObject === 'function' && !engine.getObject(DATA_MIGRATION_FLAG_OBJECT)) return 'absent';
  // A boot with no storage (no driver serves the ledger — `os serve` with no
  // OS_DATABASE_URL and no driver plugin) has no database to judge, exactly as
  // the column probe skips an object no driver serves: nothing was ever
  // migrated there. Only a store that serves the ledger and fails its read is
  // `unreadable`.
  if (typeof engine.getDriverForObject === 'function' && !engine.getDriverForObject(DATA_MIGRATION_FLAG_OBJECT)) return 'absent';
  try {
    const row = (await engine.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID },
      context: { isSystem: true },
    })) as DataMigrationFlag | null;
    if (!row) return 'absent';
    const flag = { ...row, blocking: Number((row as { blocking?: unknown }).blocking) } as DataMigrationFlag;
    return isDataMigrationFlagVerified(flag) ? 'verified' : 'unverified';
  } catch {
    return 'unreadable';
  }
}

/**
 * The check itself, for the plugin and for a host that composes its own boot:
 * resolves when the database may be served, throws
 * {@link OrganizationOwnershipBootRefusal} when it may not.
 */
export async function assertOrganizationOwnershipMigrated(
  engine: GuardEngine,
  logger?: { info?: (msg: string) => void },
  opts: OrganizationOwnershipBootGuardOptions = {},
): Promise<void> {
  const ceremony = ceremonyCommand(opts.dev);
  let tables: string[];
  try {
    tables = await findV17ShapeTables(engine);
  } catch (error) {
    throw new OrganizationOwnershipBootRefusal(
      `The server refuses to start: it could not read whether this database is still in the v17 organization-ownership ` +
        `shape (${error instanceof Error ? error.message : String(error)}), and an unread answer is never taken for a ` +
        `migrated database. Fix the read, or run the ceremony ('${ceremony} --out PLAN', then ` +
        `'${ceremony} --apply --plan-file PLAN --backup-taken'), then start again.`,
      [],
    );
  }
  const marker = await readMarker(engine);
  if (marker === 'verified') {
    if (tables.length > 0) {
      logger?.info?.(
        `[organization-ownership] ${tables.join(', ')} still carry a physical organization_id column, and the ` +
          `ceremony's marker is verified: the server starts.`,
      );
    }
    return;
  }
  // No table left in the v17 shape: only a marker the ceremony wrote and did
  // not verify refuses (its post-check found rows it has not carried). No
  // marker is a database no ceremony ran on — a fresh one — and it boots.
  if (tables.length === 0 && marker === 'absent') return;
  throw new OrganizationOwnershipBootRefusal(organizationOwnershipRefusalMessage(tables, marker, opts), tables);
}
