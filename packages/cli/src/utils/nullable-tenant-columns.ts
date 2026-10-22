// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The nullable-tenant-column advisory of `os migrate plan` (ADR-0131 D1;
 * ruling record 6328195425, letter A, item 2).
 *
 * A database the published 18.0.0 created is certified at birth with its
 * tenant columns nullable, and the organization-ownership ceremony that
 * tightens them is voluntary on it (D10: a manual, operator-run migration,
 * never a boot step; the shape generation stays 1). A ceremonied database
 * keeps the few the ceremony leaves. Nothing else tells the operator that, so
 * the plan lists every tenant column still nullable and names the ceremony as
 * the remedy.
 *
 * ⛔ Advisory only. It is not drift — the tenant column's nullability is the
 * ceremony's, which is why the differ reads none for it
 * (`ceremonyOwnedNullability` in `@objectstack/driver-sql`'s `schema-drift.ts`)
 * — so it proposes no op, adds nothing to the plan's change count, and moves
 * no exit code.
 *
 * The population is the column that differ excludes, read from the same
 * place: each planned driver's tenant column per table (`tenantFieldByTable`,
 * what `resolveTenantField` answers). An object that opts out of tenancy
 * (`sys_sso_provider`, whose `organization_id` is better-auth's provider
 * relation, not the tenancy anchor) has none, so it is not listed; nor is a
 * table no object declares, which the unmanaged-table section reports. A
 * rotation shard is read through its base. Nullability is one catalog query
 * per database.
 *
 * Each column says whether the ceremony tightens it. The residue it leaves is
 * marked with the reason, so a ceremonied database is not sent back to the
 * ceremony for a column it will never tighten: a rotation shard created before
 * shards were created NOT NULL, a table its inventory row exempts or whose rows
 * are mirrors the ceremony deletes (`sys_email_template`), and every table on a
 * transport whose apply door cannot tighten a column (the Turso remote face).
 * A table still holding a NULL row the ceremony cannot attribute is not told
 * apart here — the ceremony's own plan reports it — so this read stays one
 * query.
 */

import { dialectOfDriver } from '@objectstack/metadata-core';
import { isResultSet } from '../commands/migrate/duplicates.js';
import { inventoryEntryFor } from './organization-ownership-inventory.js';
import { resolvePlannedDriverExec, rotationBaseOf } from './unmanaged-tables.js';

/** The command that tightens them: the ceremony's read-only plan, then its `--apply`. */
export const NULLABLE_TENANT_COLUMNS_REMEDY = 'os migrate organization-ownership';

/** One tenant column the database holds nullable. */
export interface NullableTenantColumn {
  table: string;
  column: string;
  /** The database beside the primary that holds it, as the plan names it (`SchemaStack.databaseOf`); absent for the primary. */
  database?: string;
  /** `tightens`: the ceremony applies NOT NULL to it. `leaves`: it does not, and {@link reason} says why. */
  ceremony: 'tightens' | 'leaves';
  reason?: string;
}

export interface NullableTenantColumnsRead {
  status: 'read';
  adr: 'ADR-0131 D1';
  remedy: typeof NULLABLE_TENANT_COLUMNS_REMEDY;
  columns: NullableTenantColumn[];
}

export interface NullableTenantColumnsUnreadable {
  status: 'unreadable';
  adr: 'ADR-0131 D1';
  detail: string;
}

/**
 * Present in the `--json` document whenever a SQL driver was found:
 * `columns: []` is "read, none nullable" and `unreadable` is "never read" —
 * the two must not be one shape.
 */
export type NullableTenantColumnsReport = NullableTenantColumnsRead | NullableTenantColumnsUnreadable;

/** One database the plan covers. */
export interface PlannedDatabase {
  driver: unknown;
  /** How the plan names it, beside the primary (`SchemaStack.databaseOf`); absent for the primary. */
  database?: string;
}

/** A name the catalog query may carry as a string literal. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The planned driver's tenant column per table — `SqlDriver.tenantFieldByTable`,
 * the map `resolveTenantField` reads — or `null` when it cannot be read. The
 * field is `protected` and reached structurally (as `readManagedTableNames`
 * reaches `managedObjectFields`), so a rename hands this an `undefined`, which
 * is "could not read", never "no tenant table".
 */
export function readTenantFields(driver: unknown): ReadonlyMap<string, string> | null {
  const map = (driver as { tenantFieldByTable?: unknown } | null | undefined)?.tenantFieldByTable;
  if (!map || typeof map !== 'object') return null;
  const out = new Map<string, string>();
  for (const [table, field] of Object.entries(map as Record<string, unknown>)) {
    if (typeof field === 'string' && field) out.set(table, field);
  }
  return out;
}

/**
 * The statement that answers, for every base table holding one of `columns`,
 * whether that column is NOT NULL — or `null` for a dialect it is not written
 * for. One round trip per database.
 */
export function columnNullabilitySql(dialect: string, columns: readonly string[]): string | null {
  const names = columns.filter((c) => SAFE_IDENTIFIER.test(c)).map((c) => `'${c}'`).join(', ');
  if (!names) return null;
  if (dialect === 'sqlite') {
    return 'SELECT m.name AS table_name, p.name AS column_name, p."notnull" AS not_null '
      + "FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' "
      + `AND m.name NOT LIKE 'sqlite_%' AND p.name IN (${names})`;
  }
  const schema = dialect === 'postgres' ? 'ANY (current_schemas(false))' : dialect === 'mysql' ? 'DATABASE()' : null;
  if (schema === null) return null;
  return 'SELECT c.table_name AS table_name, c.column_name AS column_name, '
    + "CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS not_null "
    + 'FROM information_schema.columns c JOIN information_schema.tables t '
    + 'ON t.table_schema = c.table_schema AND t.table_name = c.table_name '
    + `WHERE t.table_type = 'BASE TABLE' AND c.table_schema = ${schema} AND c.column_name IN (${names})`;
}

/**
 * Whether each of `columns` is NOT NULL on every base table of one database
 * that holds it: `table → column → notNull`. Reads only. A failure is a
 * `detail`, never an empty map — "could not look" is not "nothing nullable".
 */
export async function readColumnNullability(
  driver: unknown,
  columns: readonly string[],
  normalize: (result: unknown) => Record<string, unknown>[],
): Promise<{ tables: Map<string, Map<string, boolean>> } | { detail: string }> {
  const exec = resolvePlannedDriverExec(driver);
  if (exec === null) return { detail: 'the planned driver exposes no raw SQL seam, so its column catalog could not be read' };
  const dialect = dialectOfDriver(driver as never);
  const sql = columnNullabilitySql(dialect, columns);
  if (sql === null) return { detail: `the connected dialect (${dialect}) is not one this read is written for (sqlite / postgres / mysql)` };
  let result: unknown;
  try {
    result = await exec(sql, []);
  } catch (error: unknown) {
    return { detail: `the column-catalog read failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isResultSet(result)) return { detail: 'the raw SQL seam returned no result set, so no column was read' };
  const tables = new Map<string, Map<string, boolean>>();
  for (const row of normalize(result)) {
    const table = row.table_name ?? row.TABLE_NAME;
    const column = row.column_name ?? row.COLUMN_NAME;
    if (typeof table !== 'string' || typeof column !== 'string') continue;
    const byColumn = tables.get(table) ?? new Map<string, boolean>();
    byColumn.set(column, Number(row.not_null ?? row.NOT_NULL) === 1);
    tables.set(table, byColumn);
  }
  return { tables };
}

/**
 * Why the ceremony leaves `table`'s tenant column nullable, or `null` when it
 * tightens it. `shardOf` is the declared base a rotation shard belongs to.
 */
function ceremonyLeaves(table: string, shardOf: string | null, driver: unknown): string | null {
  if (shardOf !== null) {
    return `a rotation shard of ${shardOf}, created before shards were created NOT NULL: the ceremony rebuilds no ` +
      `shard, and it is dropped when its period leaves ${shardOf}'s retention`;
  }
  const limit = (driver as { driftApplyLimit?: (op: string) => string | null } | null | undefined)?.driftApplyLimit?.('tighten_not_null') ?? null;
  if (limit) return `this database's apply door cannot tighten a column: ${limit}`;
  const entry = inventoryEntryFor(table);
  if (entry?.notNullExempt) return entry.notNullExempt;
  if (entry?.fate === 'mirror-deletion') {
    return 'its rows are mirrors the ceremony deletes, and the table retires (ADR-0131 D10 fate 2, D13), so the ceremony does not tighten it';
  }
  return null;
}

/**
 * Every tenant column the databases the plan covers hold nullable. Reads only,
 * and never throws: one database that cannot be read makes the report
 * `unreadable`, since a `read` answer is a claim about every database.
 *
 * @param databases the distinct databases the plan read, the primary first.
 * @param tenantDrivers every driver the plan composed: a table's tenant column
 *   is the one any of them declares, since two drivers on one file each manage
 *   their own objects.
 * @param mirrored whether the plan composed the object set the deployment
 *   serves; when it did not, which columns are tenant columns is not known.
 * @param normalize `normalizeRows` — flattens the three dialect result shapes.
 */
export async function collectNullableTenantColumns(opts: {
  databases: readonly PlannedDatabase[];
  tenantDrivers: readonly unknown[];
  mirrored: boolean;
  normalize: (result: unknown) => Record<string, unknown>[];
}): Promise<NullableTenantColumnsReport> {
  const unreadable = (detail: string): NullableTenantColumnsUnreadable => ({ status: 'unreadable', adr: 'ADR-0131 D1', detail });
  if (!opts.mirrored) {
    return unreadable('this plan did not compose the object set the deployment serves, so which columns are tenant columns is not known');
  }
  if (opts.databases.length === 0) return unreadable('the plan holds no SQL driver, so no column was read');
  const tenantField = new Map<string, string>();
  for (const driver of opts.tenantDrivers) {
    const fields = readTenantFields(driver);
    if (fields === null) return unreadable('a planned driver exposes no readable tenant-column map, so the tenant columns are not known');
    for (const [table, field] of fields) if (!tenantField.has(table)) tenantField.set(table, field);
  }
  const fieldNames = [...new Set(tenantField.values())];
  const columns: NullableTenantColumn[] = [];
  if (fieldNames.length > 0) {
    for (const { driver, database } of opts.databases) {
      const read = await readColumnNullability(driver, fieldNames, opts.normalize);
      if ('detail' in read) return unreadable(database ? `${database}: ${read.detail}` : read.detail);
      for (const [table, byColumn] of read.tables) {
        const base = tenantField.has(table) ? null : rotationBaseOf(table);
        const field = tenantField.get(table) ?? (base !== null ? tenantField.get(base) : undefined);
        if (field === undefined || byColumn.get(field) !== false) continue;
        const reason = ceremonyLeaves(table, base, driver);
        columns.push({
          table,
          column: field,
          ...(database ? { database } : {}),
          ceremony: reason === null ? 'tightens' : 'leaves',
          ...(reason === null ? {} : { reason }),
        });
      }
    }
  }
  columns.sort((a, b) => (a.database ?? '').localeCompare(b.database ?? '') || a.table.localeCompare(b.table));
  return { status: 'read', adr: 'ADR-0131 D1', remedy: NULLABLE_TENANT_COLUMNS_REMEDY, columns };
}

/** A column as an operator-facing line (no bullet, no colour). */
export function describeNullableTenantColumn(column: NullableTenantColumn): string {
  const name = `${column.database ? `${column.database}: ` : ''}${column.table}.${column.column}`;
  return column.ceremony === 'leaves' ? `${name} — the ceremony leaves it nullable: ${column.reason}` : name;
}

/**
 * The advisory section as `os migrate plan` prints it, or `[]` when every
 * tenant column is NOT NULL. Loud when it could not read, because "did not
 * look" must never read as "none nullable".
 */
export function renderNullableTenantColumns(report: NullableTenantColumnsReport): string[] {
  if (report.status === 'unreadable') return [`Nullable tenant-column advisory did not run: ${report.detail}.`];
  if (report.columns.length === 0) return [];
  const tightens = report.columns.filter((c) => c.ceremony === 'tightens').length;
  return [
    `${report.columns.length} tenant column(s) are still nullable (ADR-0131 D1). This is advisory: it is not drift, ` +
      'and nothing in this plan or in "os migrate apply" changes it.',
    ...report.columns.map((c) => `  • ${describeNullableTenantColumn(c)}`),
    tightens > 0
      ? `The voluntary organization-ownership ceremony tightens ${tightens} of them: run "${report.remedy} --out PLAN", ` +
        `review it, then "${report.remedy} --apply --plan-file PLAN --backup-taken". The server starts either way.`
      : 'None of them is one the organization-ownership ceremony tightens; each line says why it stays nullable.',
  ];
}
