// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { hasPlatformObjectPrefix } from '@objectstack/spec/system';
import {
  APPLICATION_OBJECT_FATE,
  ORGANIZATION_OWNERSHIP_INVENTORY,
  type Anchor,
  type InventoryCategory,
  type InventoryEntry,
  type OrganizationOwnershipFate,
  type RowCondition,
  type RowPredicate,
} from './organization-ownership-inventory.js';
import { physicalTableListSql, rotationBaseOf } from './unmanaged-tables.js';

/**
 * The ADR-0131 D10 ceremony's preflight — ceremony item 1, read-only.
 *
 * "Per table, the fate, the row counts each fate will touch, the rows whose
 * owner cannot be derived (listed by id), and the tables that will and will
 * not receive the NOT NULL constraint. The plan is written to a file the
 * operator keeps; nothing is changed. ⛔ A plan that cannot enumerate a table
 * refuses instead of reporting it as empty."
 *
 * ## What it reads, and only reads
 *
 * The PHYSICAL database, through one raw-SQL seam ({@link PlanReader}), with
 * SELECT statements only: the catalog's base-table list, each table's column
 * list, counts, and keyset pages of the rows whose `organization_id` is NULL.
 * Every value is bound, every identifier is checked against
 * {@link SAFE_IDENTIFIER} and quoted. Nothing here holds a write statement.
 *
 * The table set is the database's, not the registry's: an upgrade is about
 * the rows that exist. Each physical table carrying `organization_id` is met
 * with its inventory row; a platform-prefixed one with no row REFUSES the plan
 * (the inventory has a gap and no fate may be invented); any other one is an
 * application object and takes {@link APPLICATION_OBJECT_FATE}. An inventoried
 * object with no table on this database is listed as `absent` — a fact the
 * catalog answered, never a table reported as holding zero rows.
 *
 * ## Refusal, never a partial plan
 *
 * Every way of not knowing a table's rows throws
 * {@link OrganizationOwnershipPlanRefusal} naming the table: a dialect with no
 * catalog statement, a catalog that answers nothing, a table whose read fails,
 * a column a fate needs that the table lacks, a name that cannot be quoted. A
 * plan with a hole in it is not written at all.
 */

export type PlanDialect = 'sqlite' | 'postgres' | 'mysql';

/** The one seam the plan reads through. Rows already normalized across dialects. */
export interface PlanReader {
  /** The knex client spelling of the connected driver. */
  client: string | undefined;
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
}

export type PlanRefusalReason =
  | 'driver-unsupported'
  | 'catalog-unreadable'
  | 'not-an-objectstack-database'
  | 'uninventoried-platform-table'
  | 'unreadable-table'
  | 'missing-column'
  | 'unsafe-identifier';

/** The plan could not enumerate a table. Nothing is written when this is thrown. */
export class OrganizationOwnershipPlanRefusal extends Error {
  readonly code = 'PLAN_REFUSED';
  constructor(
    readonly reason: PlanRefusalReason,
    message: string,
    readonly table?: string,
  ) {
    super(message);
    this.name = 'OrganizationOwnershipPlanRefusal';
  }
}

export interface UnattributableRow {
  id: string;
  reason: string;
  /** The physical table when the object is stored in rotation shards. */
  shard?: string;
}

export interface PlannedCategory {
  id: string;
  label: string;
  citation: string;
  rows: number;
  /** Conflict categories: the number of groups. */
  groups?: number;
}

export interface PlannedDeparture {
  id: string;
  label: string;
  citation: string;
  as: 'mirror-deletion' | 'moved';
  /** NULL-organization rows this departure takes out of attribution. */
  rows: number;
}

export interface TablePlan {
  object: string;
  fate: OrganizationOwnershipFate;
  citation: string;
  /** `inventory` row, or the application-object default. */
  source: 'inventory' | 'application-default';
  census: readonly string[];
  physical: 'present' | 'absent';
  /** Physical tables read: the object's own, or its rotation shards. */
  tables: string[];
  organizationColumn: 'present' | 'absent' | null;
  rows: { total: number; organizationNull: number; stamped: number } | null;
  /** What the fate touches, in the fate's own terms. */
  fateCounts: Record<string, number | boolean>;
  departures: PlannedDeparture[];
  categories: PlannedCategory[];
  /** Fate 3: derivable rows per anchor (and `default-organization`). */
  attribution?: Record<string, number>;
  unattributable: UnattributableRow[];
  notNull: { willReceive: boolean; reason: string };
  cloudCarried?: true;
  external?: true;
  note?: string;
}

export interface OrganizationOwnershipPlan {
  kind: 'organization-ownership-plan';
  ceremony: 'ADR-0131 D10';
  ceremonyVersion: 1;
  readOnly: true;
  generatedAt: string;
  database: string;
  client: string | null;
  posture: string;
  defaultOrganization: { id: string; slug: 'default' } | null;
  organizations: number;
  /** sha256 of the inventory this plan was computed from. */
  inventoryDigest: string;
  tables: TablePlan[];
  summary: {
    present: number;
    absent: number;
    byFate: Record<OrganizationOwnershipFate, number>;
    unattributableRows: number;
    notNull: { willReceive: string[]; willNotReceive: string[] };
    /** Physical tables with no organization column and no inventory row — outside the ceremony. */
    outsideCeremony: number;
  };
}

/** The physical tenancy anchor. */
const ORG = 'organization_id';
const ID = 'id';
const PAGE = 500;
const IN_CHUNK = 200;
const DEFAULT_ORGANIZATION_SLUG = 'default';

/** A name the plan may interpolate as a quoted identifier. */
export const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function dialectOf(client: string | undefined): PlanDialect | null {
  const c = String(client ?? '').toLowerCase();
  if (['sqlite3', 'sqlite', 'better-sqlite3'].includes(c)) return 'sqlite';
  if (['postgres', 'pg', 'postgresql', 'pgnative'].includes(c)) return 'postgres';
  if (['mysql', 'mysql2'].includes(c)) return 'mysql';
  return null;
}

/** sha256 over the inventory, so a plan names the table it was computed from. */
export function inventoryDigest(inventory: readonly InventoryEntry[] = ORGANIZATION_OWNERSHIP_INVENTORY): string {
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

class Sql {
  constructor(
    private readonly reader: PlanReader,
    readonly dialect: PlanDialect,
  ) {}

  q(name: string, table: string): string {
    if (!SAFE_IDENTIFIER.test(name)) {
      throw new OrganizationOwnershipPlanRefusal(
        'unsafe-identifier',
        `The name ${JSON.stringify(name)} on ${table} cannot be quoted safely, so the plan cannot read it.`,
        table,
      );
    }
    return this.dialect === 'mysql' ? `\`${name}\`` : `"${name}"`;
  }

  bind(value: string | number | boolean): unknown {
    if (typeof value === 'boolean' && this.dialect !== 'postgres') return value ? 1 : 0;
    return value;
  }

  async read(table: string, sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
    try {
      return await this.reader.query(sql, params);
    } catch (error) {
      throw new OrganizationOwnershipPlanRefusal(
        'unreadable-table',
        `Could not read ${table}: ${error instanceof Error ? error.message : String(error)}. ` +
          'The plan refuses rather than report a table it could not enumerate.',
        table,
      );
    }
  }

  /** One `COUNT(*)`. A seam that returns no row has not answered, and is refused. */
  async count(table: string, sql: string, params: readonly unknown[] = []): Promise<number> {
    const rows = await this.read(table, sql, params);
    const n = rows.length === 1 ? Number(firstValue(rows[0]!)) : Number.NaN;
    if (!Number.isFinite(n)) {
      throw new OrganizationOwnershipPlanRefusal(
        'unreadable-table',
        `The count of ${table} came back without a number — a seam that answers nothing is not a table with no rows.`,
        table,
      );
    }
    return n;
  }
}

function firstValue(row: Record<string, unknown>): unknown {
  for (const key of ['n', 'N', 'count']) if (key in row) return row[key];
  return Object.values(row)[0];
}

function columnNameOf(row: Record<string, unknown>): string | null {
  for (const key of ['column_name', 'COLUMN_NAME', 'name']) {
    const value = row[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function tableNameOf(row: Record<string, unknown>): string | null {
  for (const key of ['table_name', 'TABLE_NAME', 'name']) {
    const value = row[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function columnListSql(dialect: PlanDialect): string {
  if (dialect === 'sqlite') return 'SELECT name AS column_name FROM pragma_table_info(?)';
  if (dialect === 'postgres') {
    return 'SELECT column_name FROM information_schema.columns WHERE table_schema = ANY (current_schemas(false)) AND table_name = ?';
  }
  return 'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?';
}

/** The SQL of one predicate, its columns required present on `table`. */
function predicateSql(sql: Sql, table: string, columns: ReadonlySet<string>, predicate: RowPredicate): { text: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const condition of predicate) {
    requireColumn(table, columns, condition.column);
    const c = sql.q(condition.column, table);
    if ('equals' in condition) {
      parts.push(`${c} = ?`);
      params.push(sql.bind(condition.equals));
    } else if ('in' in condition) {
      parts.push(`${c} IN (${condition.in.map(() => '?').join(', ')})`);
      params.push(...condition.in);
    } else if ('notIn' in condition) {
      parts.push(`(${c} IS NULL OR ${c} NOT IN (${condition.notIn.map(() => '?').join(', ')}))`);
      params.push(...condition.notIn);
    } else if ('isNull' in condition) {
      parts.push(condition.isNull ? `${c} IS NULL` : `${c} IS NOT NULL`);
    } else {
      parts.push(`(${c} IS NULL OR ${c} <> ?)`);
      params.push(sql.bind(true));
    }
  }
  return { text: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

function requireColumn(table: string, columns: ReadonlySet<string>, column: string): void {
  if (!columns.has(column)) {
    throw new OrganizationOwnershipPlanRefusal(
      'missing-column',
      `${table} has no column ${column}, which its inventory fate reads. The plan refuses rather than count a ` +
        'population it cannot select.',
      table,
    );
  }
}

const conditionColumns = (predicate: RowPredicate | undefined): string[] =>
  (predicate ?? []).map((c: RowCondition) => c.column);

function anchorLabel(anchor: Anchor): string {
  if (anchor.kind === 'parent') return `parent:${anchor.childKey}->${anchor.parentObject}`;
  if (anchor.kind === 'subject') return `subject:${anchor.objectColumn}/${anchor.idColumn}`;
  return `holder:${anchor.holderObject}.${anchor.holderKey}`;
}

function anchorColumns(anchor: Anchor): string[] {
  if (anchor.kind === 'parent') return [anchor.childKey];
  if (anchor.kind === 'subject') return [anchor.objectColumn, anchor.idColumn];
  return [];
}

const nonEmpty = (value: unknown): string | null =>
  value === null || value === undefined || String(value) === '' ? null : String(value);

/** The physical layout the catalog answered: base object → its tables, and each table's columns. */
interface Catalog {
  bases: Map<string, string[]>;
  columns: Map<string, Set<string>>;
}

async function readCatalog(sql: Sql, reader: PlanReader): Promise<Catalog> {
  const listSql = physicalTableListSql(reader.client);
  if (!listSql) {
    throw new OrganizationOwnershipPlanRefusal(
      'driver-unsupported',
      `The connected driver (${reader.client ?? 'unknown client'}) has no catalog statement this plan can run, so ` +
        'no table can be enumerated. The ceremony supports SQLite, PostgreSQL and MySQL.',
    );
  }
  let rows: Record<string, unknown>[];
  try {
    rows = await reader.query(listSql);
  } catch (error) {
    throw new OrganizationOwnershipPlanRefusal(
      'catalog-unreadable',
      `The database catalog could not be read: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  const bases = new Map<string, string[]>();
  for (const row of rows) {
    const table = tableNameOf(row);
    if (!table) continue;
    const base = rotationBaseOf(table) ?? table;
    const list = bases.get(base) ?? [];
    list.push(table);
    bases.set(base, list);
  }
  if (!bases.has('sys_organization')) {
    throw new OrganizationOwnershipPlanRefusal(
      'not-an-objectstack-database',
      `This database holds no sys_organization table (${rows.length} table(s) listed), so it is not an ObjectStack ` +
        'database the ceremony can plan — check --database-url / $OS_DATABASE_URL.',
    );
  }
  const columns = new Map<string, Set<string>>();
  for (const tables of bases.values()) {
    tables.sort();
    for (const table of tables) {
      // A table whose name cannot be quoted is a table whose columns cannot be
      // read — and so one the plan cannot say is outside the ceremony.
      sql.q(table, table);
      const cols = await sql.read(table, columnListSql(sql.dialect), [table]);
      const names = new Set(cols.map(columnNameOf).filter((c): c is string => c !== null));
      if (names.size === 0) {
        throw new OrganizationOwnershipPlanRefusal(
          'unreadable-table',
          `The catalog lists ${table} but answers no column for it, so the plan cannot tell what it holds.`,
          table,
        );
      }
      columns.set(table, names);
    }
  }
  return { bases, columns };
}

/** Context one table's attribution reads beyond the table itself. */
interface PlanContext {
  sql: Sql;
  catalog: Catalog;
  posture: string;
  defaultOrganizationId: string | null;
}

/** The organization of each id in `ids` on `object`'s own table, or a reason it cannot be read. */
async function organizationsById(
  ctx: PlanContext,
  object: string,
  ids: string[],
): Promise<Map<string, string | null> | string> {
  const tables = ctx.catalog.bases.get(object);
  if (!tables || tables.length !== 1 || tables[0] !== object) return `${object} has no table on this database`;
  const cols = ctx.catalog.columns.get(object);
  if (!cols?.has(ID) || !cols.has(ORG)) return `${object} carries no ${ORG} to derive from`;
  const out = new Map<string, string | null>();
  const t = ctx.sql.q(object, object);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await ctx.sql.read(
      object,
      `SELECT ${ctx.sql.q(ID, object)} AS id, ${ctx.sql.q(ORG, object)} AS org FROM ${t} WHERE ${ctx.sql.q(ID, object)} IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    );
    for (const row of rows) out.set(String(row.id), nonEmpty(row.org));
  }
  return out;
}

interface PendingRow {
  id: string;
  values: Record<string, unknown>;
  reason: string;
  shard: string;
}

/** Resolve rows through one anchor; returns the rows it could not derive. */
async function applyAnchor(ctx: PlanContext, anchor: Anchor, rows: PendingRow[], derived: Record<string, number>): Promise<PendingRow[]> {
  const label = anchorLabel(anchor);
  const left: PendingRow[] = [];
  if (anchor.kind === 'parent') {
    const keys = [...new Set(rows.map((r) => nonEmpty(r.values[anchor.childKey])).filter((k): k is string => k !== null))];
    const orgs = keys.length ? await organizationsById(ctx, anchor.parentObject, keys) : new Map<string, string | null>();
    for (const row of rows) {
      const key = nonEmpty(row.values[anchor.childKey]);
      if (key === null) left.push({ ...row, reason: `no ${anchor.childKey}` });
      else if (typeof orgs === 'string') left.push({ ...row, reason: orgs });
      else if (!orgs.has(key)) left.push({ ...row, reason: `${anchor.parentObject} row ${key} not found` });
      else if (orgs.get(key) === null) left.push({ ...row, reason: `${anchor.parentObject} row ${key} has no organization` });
      else derived[label] = (derived[label] ?? 0) + 1;
    }
    return left;
  }
  if (anchor.kind === 'subject') {
    const byObject = new Map<string, PendingRow[]>();
    for (const row of rows) {
      const object = nonEmpty(row.values[anchor.objectColumn]);
      const id = nonEmpty(row.values[anchor.idColumn]);
      if (object === null || id === null) {
        left.push({ ...row, reason: `no ${anchor.objectColumn} / ${anchor.idColumn}` });
        continue;
      }
      const list = byObject.get(object) ?? [];
      list.push(row);
      byObject.set(object, list);
    }
    for (const [object, group] of byObject) {
      const orgs = SAFE_IDENTIFIER.test(object)
        ? await organizationsById(ctx, object, [...new Set(group.map((r) => String(r.values[anchor.idColumn])))])
        : `the subject object name ${JSON.stringify(object)} is not a table name`;
      for (const row of group) {
        const id = String(row.values[anchor.idColumn]);
        if (typeof orgs === 'string') left.push({ ...row, reason: orgs });
        else if (!orgs.has(id)) left.push({ ...row, reason: `${object} row ${id} not found` });
        else if (orgs.get(id) === null) left.push({ ...row, reason: `${object} row ${id} has no organization` });
        else derived[label] = (derived[label] ?? 0) + 1;
      }
    }
    return left;
  }
  // holder
  const holderTables = ctx.catalog.bases.get(anchor.holderObject);
  const cols = ctx.catalog.columns.get(anchor.holderObject);
  if (!holderTables || holderTables.length !== 1 || !cols?.has(anchor.holderKey) || !cols.has(ORG)) {
    return rows.map((row) => ({ ...row, reason: `${anchor.holderObject} holds no ${anchor.holderKey} / ${ORG} to derive from` }));
  }
  const holders = new Map<string, Set<string>>();
  const t = ctx.sql.q(anchor.holderObject, anchor.holderObject);
  const k = ctx.sql.q(anchor.holderKey, anchor.holderObject);
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const found = await ctx.sql.read(
      anchor.holderObject,
      `SELECT ${k} AS k, ${ctx.sql.q(ORG, anchor.holderObject)} AS org FROM ${t} WHERE ${k} IN (${chunk.map(() => '?').join(', ')}) AND ${ctx.sql.q(ORG, anchor.holderObject)} IS NOT NULL`,
      chunk,
    );
    for (const row of found) {
      const set = holders.get(String(row.k)) ?? new Set<string>();
      set.add(String(row.org));
      holders.set(String(row.k), set);
    }
  }
  for (const row of rows) {
    const orgs = holders.get(row.id);
    if (!orgs) left.push({ ...row, reason: `no stamped ${anchor.holderObject} holder` });
    else if (orgs.size > 1) left.push({ ...row, reason: `${anchor.holderObject} holders disagree (${orgs.size} organizations)` });
    else derived[label] = (derived[label] ?? 0) + 1;
  }
  return left;
}

async function planCategory(sql: Sql, table: string, columns: ReadonlySet<string>, category: InventoryCategory): Promise<{ rows: number; groups?: number }> {
  const t = sql.q(table, table);
  const where = predicateSql(sql, table, columns, category.where ?? []);
  if (!category.conflictBy) {
    return { rows: await sql.count(table, `SELECT COUNT(*) AS n FROM ${t} WHERE ${where.text}`, where.params) };
  }
  const groupBy = category.conflictBy.groupBy.map((c) => {
    requireColumn(table, columns, c);
    return sql.q(c, table);
  });
  const distinct = category.conflictBy.distinct;
  if (distinct) requireColumn(table, columns, distinct);
  const having = distinct ? `COUNT(DISTINCT ${sql.q(distinct, table)}) > 1` : 'COUNT(*) > 1';
  const rows = await sql.read(
    table,
    `SELECT COUNT(*) AS g, COALESCE(SUM(c), 0) AS r FROM (SELECT ${groupBy.join(', ')}, COUNT(*) AS c FROM ${t} ` +
      `WHERE ${where.text} GROUP BY ${groupBy.join(', ')} HAVING ${having}) conflict_groups`,
    where.params,
  );
  const groups = Number(rows[0]?.g ?? rows[0]?.G);
  const count = Number(rows[0]?.r ?? rows[0]?.R);
  if (rows.length !== 1 || !Number.isFinite(groups) || !Number.isFinite(count)) {
    throw new OrganizationOwnershipPlanRefusal('unreadable-table', `The conflict count on ${table} came back without a number.`, table);
  }
  return { rows: count, groups };
}

async function planPresentTable(ctx: PlanContext, entry: InventoryEntry, source: TablePlan['source'], tables: string[]): Promise<TablePlan> {
  const { sql } = ctx;
  const columns = ctx.catalog.columns.get(tables[0]!)!;
  for (const table of tables.slice(1)) {
    const shardColumns = ctx.catalog.columns.get(table)!;
    if (shardColumns.has(ORG) !== columns.has(ORG)) {
      throw new OrganizationOwnershipPlanRefusal('unreadable-table', `The shards of ${entry.object} disagree on ${ORG}; the plan cannot read them as one table.`, table);
    }
  }
  const hasOrg = columns.has(ORG);
  const plan: TablePlan = {
    object: entry.object,
    fate: entry.fate,
    citation: entry.citation,
    source,
    census: entry.census,
    physical: 'present',
    tables,
    organizationColumn: hasOrg ? 'present' : 'absent',
    rows: { total: 0, organizationNull: 0, stamped: 0 },
    fateCounts: {},
    departures: (entry.departures ?? []).map((d) => ({ id: d.id, label: d.label, citation: d.citation, as: d.as, rows: 0 })),
    categories: [],
    unattributable: [],
    notNull: { willReceive: false, reason: '' },
    ...(entry.cloudCarried ? { cloudCarried: true as const } : {}),
    ...(entry.external ? { external: true as const } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };

  // Every column a fate reads must exist before any row is counted.
  requireColumn(tables[0]!, columns, ID);
  for (const column of [
    ...conditionColumns(entry.mirror),
    ...(entry.departures ?? []).flatMap((d) => conditionColumns(d.where)),
    ...(entry.anchors ?? []).flatMap(anchorColumns),
  ]) {
    for (const table of tables) requireColumn(table, ctx.catalog.columns.get(table)!, column);
  }

  let mirrorRows = 0;
  const derived: Record<string, number> = {};
  for (const table of tables) {
    const t = sql.q(table, table);
    const tableColumns = ctx.catalog.columns.get(table)!;
    const total = await sql.count(table, `SELECT COUNT(*) AS n FROM ${t}`);
    const organizationNull = hasOrg ? await sql.count(table, `SELECT COUNT(*) AS n FROM ${t} WHERE ${sql.q(ORG, table)} IS NULL`) : 0;
    plan.rows!.total += total;
    plan.rows!.organizationNull += organizationNull;
    plan.rows!.stamped += hasOrg ? total - organizationNull : 0;

    if (entry.fate === 'mirror-deletion') {
      if (entry.mirror) {
        const where = predicateSql(sql, table, tableColumns, entry.mirror);
        mirrorRows += await sql.count(table, `SELECT COUNT(*) AS n FROM ${t} WHERE ${where.text}`, where.params);
      } else {
        mirrorRows += total;
      }
    }

    if ((entry.fate === 'attribution' || entry.fate === 'report') && hasOrg && organizationNull > 0) {
      await walkNullRows(ctx, entry, plan, table, tableColumns, derived);
    }
  }

  for (const category of entry.categories ?? []) {
    let rows = 0;
    let groups: number | undefined;
    for (const table of tables) {
      const counted = await planCategory(sql, table, ctx.catalog.columns.get(table)!, category);
      rows += counted.rows;
      if (counted.groups !== undefined) groups = (groups ?? 0) + counted.groups;
    }
    plan.categories.push({ id: category.id, label: category.label, citation: category.citation, rows, ...(groups !== undefined ? { groups } : {}) });
  }

  const rows = plan.rows!;
  const departing = plan.departures.reduce((n, d) => n + d.rows, 0);
  switch (entry.fate) {
    case 'column-drop':
      plan.fateCounts = { columnPresent: hasOrg, rowsLosingTheirStamp: rows.stamped, rowsWithNullOrganization: rows.organizationNull };
      plan.notNull = { willReceive: false, reason: hasOrg ? 'the column is dropped (fate 1)' : 'no organization column, nothing to drop (fate 1)' };
      break;
    case 'mirror-deletion':
      plan.fateCounts = { mirrorRows, nonMirrorRows: rows.total - mirrorRows };
      plan.notNull = { willReceive: false, reason: 'the table retires once its mirrors are deleted after the verified id-to-name rewrite (D10 fate 2, D13)' };
      break;
    case 'attribution': {
      const attributed = Object.values(derived).reduce((n, v) => n + v, 0);
      plan.attribution = derived;
      plan.fateCounts = { rowsToAttribute: attributed, departingRows: departing, unattributableRows: plan.unattributable.length };
      plan.notNull = !hasOrg
        ? { willReceive: false, reason: 'the table carries no organization_id column' }
        : plan.unattributable.length === 0
          ? { willReceive: true, reason: 'every NULL row is attributed or departs' }
          : { willReceive: false, reason: `${plan.unattributable.length} row(s) whose owner cannot be derived stay NULL and are reported` };
      break;
    }
    case 'report':
      plan.fateCounts = { reportedRows: plan.unattributable.length, departingRows: departing };
      plan.notNull = entry.notNullExempt
        ? { willReceive: false, reason: entry.notNullExempt }
        : !hasOrg
          ? { willReceive: false, reason: 'the table carries no organization_id column' }
          : plan.unattributable.length === 0
            ? { willReceive: true, reason: 'no NULL row remains' }
            : { willReceive: false, reason: `${plan.unattributable.length} reported row(s) stay NULL` };
      break;
  }
  return plan;
}

/** Keyset-walk the NULL-organization rows of one physical table and classify each. */
async function walkNullRows(
  ctx: PlanContext,
  entry: InventoryEntry,
  plan: TablePlan,
  table: string,
  columns: ReadonlySet<string>,
  derived: Record<string, number>,
): Promise<void> {
  const { sql } = ctx;
  const t = sql.q(table, table);
  const id = sql.q(ID, table);
  const anchorCols = [...new Set((entry.anchors ?? []).flatMap(anchorColumns))];
  const departureSql = (entry.departures ?? []).map((d, i) => {
    const where = predicateSql(sql, table, columns, d.where);
    return { text: `CASE WHEN ${where.text} THEN 1 ELSE 0 END AS ${sql.q(`dep_${i}`, table)}`, params: where.params };
  });
  const select = [
    `${id} AS ${sql.q('row_id', table)}`,
    ...anchorCols.map((c) => `${sql.q(c, table)} AS ${sql.q(c, table)}`),
    ...departureSql.map((d) => d.text),
  ].join(', ');
  const selectParams = departureSql.flatMap((d) => d.params);

  let after: unknown = undefined;
  for (;;) {
    const rows = await sql.read(
      table,
      `SELECT ${select} FROM ${t} WHERE ${sql.q(ORG, table)} IS NULL${after === undefined ? '' : ` AND ${id} > ?`} ORDER BY ${id} LIMIT ${PAGE}`,
      after === undefined ? selectParams : [...selectParams, after],
    );
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.row_id;

    let pending: PendingRow[] = [];
    for (const row of rows) {
      const departure = (entry.departures ?? []).findIndex((_, i) => Number(row[`dep_${i}`]) === 1);
      if (departure >= 0) {
        plan.departures[departure]!.rows++;
        continue;
      }
      pending.push({ id: String(row.row_id), values: row, reason: entry.fate === 'report' ? 'fate 4: reported, never guessed' : 'no anchor names the owner', shard: table });
    }
    if (entry.fate === 'attribution') {
      for (const anchor of entry.anchors ?? []) {
        if (pending.length === 0) break;
        pending = await applyAnchor(ctx, anchor, pending, derived);
      }
      if (pending.length > 0 && ctx.posture === 'single' && ctx.defaultOrganizationId !== null) {
        derived['default-organization'] = (derived['default-organization'] ?? 0) + pending.length;
        pending = [];
      }
    }
    for (const row of pending) {
      plan.unattributable.push({
        id: row.id,
        reason:
          entry.fate === 'attribution' && ctx.posture === 'single' && ctx.defaultOrganizationId === null
            ? `${row.reason}; no Default Organization (slug '${DEFAULT_ORGANIZATION_SLUG}') exists to fall back to`
            : row.reason,
        ...(plan.tables.length > 1 ? { shard: row.shard } : {}),
      });
    }
    if (rows.length < PAGE) break;
  }
}

function absentTable(entry: InventoryEntry): TablePlan {
  return {
    object: entry.object,
    fate: entry.fate,
    citation: entry.citation,
    source: 'inventory',
    census: entry.census,
    physical: 'absent',
    tables: [],
    organizationColumn: null,
    rows: null,
    fateCounts: {},
    departures: [],
    categories: [],
    unattributable: [],
    notNull: { willReceive: false, reason: 'no table for this object on this database' },
    ...(entry.cloudCarried ? { cloudCarried: true as const } : {}),
    ...(entry.external ? { external: true as const } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };
}

/**
 * Compute the plan. Reads only; throws {@link OrganizationOwnershipPlanRefusal}
 * on any table it cannot enumerate.
 */
export async function buildOrganizationOwnershipPlan(opts: {
  reader: PlanReader;
  posture: string;
  database: string;
  now?: Date;
  inventory?: readonly InventoryEntry[];
}): Promise<OrganizationOwnershipPlan> {
  const inventory = opts.inventory ?? ORGANIZATION_OWNERSHIP_INVENTORY;
  const dialect = dialectOf(opts.reader.client);
  if (!dialect) {
    throw new OrganizationOwnershipPlanRefusal(
      'driver-unsupported',
      `The connected driver (${opts.reader.client ?? 'unknown client'}) has no catalog statement this plan can run, so ` +
        'no table can be enumerated. The ceremony supports SQLite, PostgreSQL and MySQL.',
    );
  }
  const sql = new Sql(opts.reader, dialect);
  const catalog = await readCatalog(sql, opts.reader);
  const byObject = new Map(inventory.map((e) => [e.object, e]));

  const organizations = await sql.count('sys_organization', `SELECT COUNT(*) AS n FROM ${sql.q('sys_organization', 'sys_organization')}`);
  let defaultOrganizationId: string | null = null;
  if (catalog.columns.get('sys_organization')?.has('slug')) {
    const rows = await sql.read(
      'sys_organization',
      `SELECT ${sql.q(ID, 'sys_organization')} AS id FROM ${sql.q('sys_organization', 'sys_organization')} WHERE ${sql.q('slug', 'sys_organization')} = ?`,
      [DEFAULT_ORGANIZATION_SLUG],
    );
    defaultOrganizationId = rows.length > 0 ? nonEmpty(rows[0]!.id) : null;
  }
  const ctx: PlanContext = { sql, catalog, posture: opts.posture, defaultOrganizationId };

  const tables: TablePlan[] = [];
  let outsideCeremony = 0;
  for (const [base, physical] of [...catalog.bases].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = byObject.get(base);
    const hasOrg = physical.some((t) => catalog.columns.get(t)?.has(ORG));
    if (!entry) {
      if (!hasOrg) {
        outsideCeremony++;
        continue;
      }
      if (hasPlatformObjectPrefix(base)) {
        throw new OrganizationOwnershipPlanRefusal(
          'uninventoried-platform-table',
          `${base} carries ${ORG} but the ADR-0131 D10 inventory gives it no fate. The plan refuses rather than ` +
            'guess one: the inventory (packages/cli/src/utils/organization-ownership-inventory.ts) owes it a row.',
          base,
        );
      }
      tables.push(await planPresentTable(ctx, { object: base, census: [], ...APPLICATION_OBJECT_FATE }, 'application-default', physical));
      continue;
    }
    tables.push(await planPresentTable(ctx, entry, 'inventory', physical));
  }
  for (const entry of inventory) {
    if (!catalog.bases.has(entry.object)) tables.push(absentTable(entry));
  }
  tables.sort((a, b) => a.object.localeCompare(b.object));

  const byFate = { 'column-drop': 0, 'mirror-deletion': 0, attribution: 0, report: 0 } as Record<OrganizationOwnershipFate, number>;
  for (const t of tables) if (t.physical === 'present') byFate[t.fate]++;
  const present = tables.filter((t) => t.physical === 'present');
  return {
    kind: 'organization-ownership-plan',
    ceremony: 'ADR-0131 D10',
    ceremonyVersion: 1,
    readOnly: true,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    database: opts.database,
    client: opts.reader.client ?? null,
    posture: opts.posture,
    defaultOrganization: defaultOrganizationId === null ? null : { id: defaultOrganizationId, slug: 'default' },
    organizations,
    inventoryDigest: inventoryDigest(inventory),
    tables,
    summary: {
      present: present.length,
      absent: tables.length - present.length,
      byFate,
      unattributableRows: tables.reduce((n, t) => n + t.unattributable.length, 0),
      notNull: {
        willReceive: present.filter((t) => t.notNull.willReceive).map((t) => t.object),
        willNotReceive: present.filter((t) => !t.notNull.willReceive && t.organizationColumn === 'present').map((t) => t.object),
      },
      outsideCeremony,
    },
  };
}
