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
 * At `kernel:ready` — the reader shape of {@link MigrationRecoveryPlugin},
 * refusing where that plugin warns — the guard asks one question: does a
 * table whose object declares NO organization column (`systemFields.tenant:
 * false` and no declared `organization_id`) still carry a PHYSICAL
 * `organization_id`? Schema sync only adds, so on a database a v17 runtime
 * created the answer is yes until the ceremony's column-drops step has run. If
 * it is, the guard reads the ceremony's `sys_migration` marker
 * ({@link ORGANIZATION_OWNERSHIP_MIGRATION_ID}); unless that marker is
 * verified, it throws {@link OrganizationOwnershipBootRefusal}, which stops
 * the boot before `kernel:listening` opens the socket.
 *
 * - A FRESH database is never refused: no table it creates carries a retired
 *   column, so the question answers no without a marker.
 * - A database whose ceremony verified boots, whatever its columns.
 * - A read that fails is refused, never passed: "I could not check" is not
 *   "there is nothing to find" (the `readDataMigrationFlag` asymmetry).
 * - ⛔ No escape hatch: no `OS_ALLOW_*` / `OS_SKIP_*` variable and no flag
 *   skips the check (D10 verbatim). A 17.x runtime is the way to keep 17.x
 *   semantics on an unmigrated database.
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

/** The refusal text: what was found, that the server refuses to start, the command, and the 17.x way out. */
export function organizationOwnershipRefusalMessage(
  tables: readonly string[],
  marker: 'absent' | 'unverified' | 'unreadable',
  opts: OrganizationOwnershipBootGuardOptions = {},
): string {
  const ceremony = ceremonyCommand(opts.dev);
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
  readonly name = 'com.objectstack.organization-ownership-boot-guard';
  readonly type = 'standard';
  readonly version = '1.0.0';
  readonly dependencies: string[] = [];
  /** Needs the engine to read columns and the marker; still loads (inert) without it. */
  readonly optionalDependencies: string[] = ['com.objectstack.engine.objectql'];

  constructor(private readonly options: OrganizationOwnershipBootGuardOptions = {}) {}

  async init(_ctx: PluginContext): Promise<void> {}

  async start(ctx: PluginContext): Promise<void> {
    (ctx as any)?.hook?.('kernel:ready', async () => {
      let engine: GuardEngine | undefined;
      try {
        engine = (ctx as any).getService?.('objectql');
      } catch {
        return; // no engine — no database to judge
      }
      if (!engine || typeof engine.getDriverForObject !== 'function') return;
      await assertOrganizationOwnershipMigrated(engine, (ctx as any)?.logger, this.options);
    });
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
  if (tables.length === 0) return;
  let marker: 'absent' | 'unverified' | 'unreadable' = 'absent';
  try {
    const row = typeof engine.findOne === 'function'
      ? ((await engine.findOne(DATA_MIGRATION_FLAG_OBJECT, {
        where: { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID },
        context: { isSystem: true },
      })) as DataMigrationFlag | null)
      : null;
    if (row) {
      const flag = { ...row, blocking: Number((row as { blocking?: unknown }).blocking) } as DataMigrationFlag;
      if (isDataMigrationFlagVerified(flag)) {
        logger?.info?.(
          `[organization-ownership] ${tables.join(', ')} still carry a physical organization_id column, and the ` +
            `ceremony's marker is verified: the server starts.`,
        );
        return;
      }
      marker = 'unverified';
    }
  } catch {
    marker = 'unreadable';
  }
  throw new OrganizationOwnershipBootRefusal(organizationOwnershipRefusalMessage(tables, marker, opts), tables);
}
