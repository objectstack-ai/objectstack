// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D7] The legacy organization rows of a `sys_metadata`-family
 * table, read off the PHYSICAL column.
 *
 * The family declares no `organization_id` any more, and the engine shapes
 * every read to the declared columns, so a row an engine read returns never
 * carries the key. On a database the organization-ownership ceremony has not
 * migrated, the column is still on disk, and a row with a value in it is an
 * organization's, not the environment's. `os serve` refuses such a database
 * (the v18 boot refusal), but the `os migrate` boots do not, so a path they
 * reach that must tell the two apart reads the column here, through the
 * driver's raw-SQL seam.
 *
 * It replaces the row-value test this module used to export
 * (`isLegacyOrganizationRow`), which read the key off the engine row — a key
 * the engine no longer returns. Sunk here because its readers span the
 * metadata door, `@objectstack/objectql`'s authored hook and action binders,
 * `@objectstack/service-datasource` and the `os migrate` commands, which share
 * no other common home.
 *
 * ## The answers, and the refusals
 *
 * - A driver that is not a SQL driver (no `dialectName` and no
 *   `config.client`: memory, MongoDB) has no physical column, so no row of it
 *   is a legacy organization's: the empty map. A v17 MongoDB deployment is
 *   outside the v18 upgrade (maintainer, 6171271939).
 * - The column is absent (a fresh or migrated database): the empty map.
 * - The column is present: every row whose value is not NULL and not `''`,
 *   by id, mapped to its organization — the definition the retired boot report
 *   used.
 * - ⛔ Everything else THROWS, never reads as "none". A seam that returns no
 *   result set, a SQL driver whose dialect resolves to none, a SQL driver with
 *   no raw seam, or a column list that comes back EMPTY for a table the caller
 *   has established exists: each one is a question nobody answered, and
 *   "nothing to leave out" is exactly the answer that lists and deletes an
 *   organization's rows as the environment's.
 */

/** Is this what a raw SELECT returns on one of the three dialects? */
function isResultSet(result: unknown): boolean {
  if (Array.isArray(result)) return true;
  return typeof result === 'object' && result !== null && Array.isArray((result as { rows?: unknown }).rows);
}

/** The rows of a raw SELECT: a bare array (SQLite), `{ rows }` (pg) or `[rows, fields]` (mysql2). */
function normalizeRows(result: unknown): Record<string, unknown>[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    if (result.length > 0 && Array.isArray(result[0])) return result[0] as Record<string, unknown>[];
    return result as Record<string, unknown>[];
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** The `metadata-protocol` read probes' wording for the same refusal. */
const SEAM_NO_ANSWER_DETAIL =
  'the raw-SQL seam returned no result set — a seam that cannot answer is not a seam that answered "no rows"';

type Dialect = 'sqlite' | 'postgres' | 'mysql';

/** The family tables this read may name; the name is interpolated as a literal. */
const FAMILY_TABLES: ReadonlySet<string> = new Set([
  'sys_metadata',
  'sys_metadata_audit',
  'sys_metadata_commit',
  'sys_metadata_history',
]);

/** Why the read refused, with the table it was asked about. */
export class LegacyOrganizationRowsUnreadable extends Error {
  readonly code = 'LEGACY_ORGANIZATION_ROWS_UNREADABLE';
  constructor(readonly table: string, detail: string) {
    super(
      `Could not tell ${table}'s legacy organization rows from the environment's: ${detail}. ` +
        'Nothing was listed or written. Run `os migrate organization-ownership` on this database first.',
    );
    this.name = 'LegacyOrganizationRowsUnreadable';
  }
}

interface RawDriver {
  dialectName?: unknown;
  config?: { client?: unknown };
  /** `SqlDriver`'s read-only catalog read — preferred: it is not `execute()`. */
  listPhysicalColumns?: (object: string, options?: { transaction?: unknown }) => Promise<unknown>;
  execute?: (sql: string, params?: unknown[], options?: { transaction?: unknown }) => Promise<unknown>;
  raw?: (sql: string) => Promise<unknown>;
}

function dialectOfName(name: string): Dialect | null {
  const c = name.toLowerCase();
  if (c === 'sqlite' || c === 'sqlite3' || c === 'better-sqlite3') return 'sqlite';
  if (c === 'postgres' || c === 'pg' || c === 'postgresql' || c === 'pgnative') return 'postgres';
  if (c === 'mysql' || c === 'mysql2') return 'mysql';
  return null;
}

/**
 * The driver's dialect, `'none'` when it is not a SQL driver at all, or
 * `'unresolved'` when it is one whose dialect this read cannot name.
 * `dialectName` first: `SqliteWasmDriver`'s `config.client` is a class.
 */
function dialectOfDriver(driver: RawDriver | null | undefined): Dialect | 'none' | 'unresolved' {
  if (!driver) return 'none';
  if (typeof driver.dialectName === 'string') return dialectOfName(driver.dialectName) ?? 'unresolved';
  const client = driver.config?.client;
  if (client === undefined || client === null) return 'none';
  return typeof client === 'string' ? dialectOfName(client) ?? 'unresolved' : 'unresolved';
}

function columnListSql(dialect: Dialect, table: string): string {
  if (dialect === 'sqlite') return `SELECT name AS column_name FROM pragma_table_info('${table}')`;
  if (dialect === 'postgres') {
    return (
      'SELECT column_name FROM information_schema.columns ' +
      `WHERE table_schema = ANY (current_schemas(false)) AND table_name = '${table}'`
    );
  }
  return `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`;
}

function columnNameOf(row: Record<string, unknown>): string | null {
  for (const key of ['column_name', 'COLUMN_NAME', 'name']) {
    const value = row[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/**
 * The tables each driver has ANSWERED "no organization column" for. The
 * column only ever leaves (the ceremony's column-drops; a v18 runtime never
 * declares it, and its schema sync only adds declared columns), so that answer
 * cannot go stale in a process — which is what lets the request-time metadata
 * reads ask on every call and pay one catalog read per process on a migrated
 * database. Nothing else is cached: the organization VALUES move during the
 * ceremony (its promotion clears them in place).
 */
const COLUMN_ABSENT = new WeakMap<object, Set<string>>();

/** Remember `table` has no organization column on this driver; answer "none". */
function rememberAbsent(driver: object, table: string): ReadonlyMap<string, string> {
  const absent = COLUMN_ABSENT.get(driver) ?? new Set<string>();
  absent.add(table);
  COLUMN_ABSENT.set(driver, absent);
  return new Map();
}

/**
 * Every legacy organization row of `table`, id → organization (module header).
 *
 * @param driver the driver `table` is bound to (`engine.getDriverForObject`).
 * @param table one of the four family tables; the caller has established it
 *   exists, so an empty column list is refused, not read as "no column".
 * @param opts.transaction the caller's open driver transaction, when it reads
 *   inside one: the statements join it (a single-connection pool would
 *   otherwise wait on the connection the transaction holds).
 */
export async function readLegacyOrganizationRows(
  driver: unknown,
  table: string = 'sys_metadata',
  opts: { transaction?: unknown } = {},
): Promise<ReadonlyMap<string, string>> {
  if (!FAMILY_TABLES.has(table)) {
    throw new LegacyOrganizationRowsUnreadable(table, 'it is not a sys_metadata-family table');
  }
  const d = driver as RawDriver | null | undefined;
  const dialect = dialectOfDriver(d);
  if (dialect === 'none') return new Map();
  if (COLUMN_ABSENT.get(d as object)?.has(table)) return new Map();
  if (dialect === 'unresolved') {
    throw new LegacyOrganizationRowsUnreadable(table, 'the SQL driver names no dialect this read can compile a column list for');
  }
  const exec = typeof d!.execute === 'function'
    ? (sql: string) => d!.execute!(sql, [], opts.transaction !== undefined ? { transaction: opts.transaction } : undefined)
    : typeof d!.raw === 'function'
      ? (sql: string) => d!.raw!(sql)
      : null;
  if (!exec) throw new LegacyOrganizationRowsUnreadable(table, 'the SQL driver has no raw-SQL seam');

  // Is the column there? Asked on EVERY database, so through the driver's own
  // catalog read when it has one (`SqlDriver.listPhysicalColumns`): not
  // `execute()`, so a declaration boot's write guard — which counts every raw
  // statement, since it cannot tell a read from a write — has nothing to count
  // and a plan keeps its "writes nothing" claim. The catalog statement is the
  // fallback for a driver without it.
  let columns: Array<string | null>;
  if (typeof d!.listPhysicalColumns === 'function') {
    const listed = await d!.listPhysicalColumns(table, opts.transaction !== undefined ? { transaction: opts.transaction } : undefined);
    if (!Array.isArray(listed)) throw new LegacyOrganizationRowsUnreadable(table, 'the driver\'s column list is not a list');
    columns = listed.map((c) => (typeof c === 'string' && c ? c : null));
  } else {
    const columnResult = await exec(columnListSql(dialect, table));
    if (!isResultSet(columnResult)) throw new LegacyOrganizationRowsUnreadable(table, SEAM_NO_ANSWER_DETAIL);
    columns = normalizeRows(columnResult).map(columnNameOf);
  }
  if (columns.length === 0) {
    throw new LegacyOrganizationRowsUnreadable(table, 'its column list came back empty for a table that exists');
  }
  if (!columns.includes('organization_id')) return rememberAbsent(d as object, table);

  // The column is there: a database the ceremony has not migrated. The rows
  // are read with a raw statement, which every SQL face runs (a driver's
  // `find` compiles against the DECLARED columns on some faces).

  const rowResult = await exec(
    `SELECT id, organization_id FROM ${table} WHERE organization_id IS NOT NULL AND organization_id <> ''`,
  );
  if (!isResultSet(rowResult)) throw new LegacyOrganizationRowsUnreadable(table, SEAM_NO_ANSWER_DETAIL);
  const legacy = new Map<string, string>();
  for (const row of normalizeRows(rowResult)) legacy.set(String(row.id), String(row.organization_id));
  return legacy;
}
