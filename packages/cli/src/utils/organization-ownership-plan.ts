// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { emailTemplateDefinitionFromRow } from '@objectstack/core';
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
import { planGrantRewrite, type GrantCollision, type LegacySetRow } from './organization-ownership-grants.js';

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

/**
 * One NULL-organization row the walk derived an owner for. The plan only
 * counts these; `--apply` hands a sink to the same walk so the owner it writes
 * is the owner the plan reported, derived once ({@link AttributionSink}).
 */
export interface AttributionAssignment {
  id: string;
  /** The physical table the row lives in (a rotation shard, or the object's own table). */
  table: string;
  organizationId: string;
  /** The anchor that answered, as the plan's `attribution` counts label it. */
  via: string;
}

/**
 * Receives each page of derived owners, after the page is classified and
 * before the walk reads the next. The plan itself never writes; a sink is the
 * one place a caller may.
 */
export type AttributionSink = (batch: { object: string; assignments: AttributionAssignment[] }) => Promise<void>;

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
  /**
   * `sys_email_template` only: the `(name, locale)` groups of the promotion
   * population whose candidate rows define the template differently. Fate 4
   * until the operator chooses one row per group; nothing is guessed.
   */
  templateConflicts?: TemplateConflict[];
  /**
   * `sys_metadata` only: the keys of the promotion population that more than
   * one row holds once the organization leaves the key — two organizations, or
   * an organization and the environment. Kept and blocking until the operator
   * keeps one row per key; nothing is guessed.
   */
  metadataConflicts?: MetadataConflict[];
  /** `sys_user_permission_set` only: what the grant's unique key holds ({@link GrantKeyPlan}). */
  grants?: GrantKeyPlan;
}

/**
 * One overlay key of `sys_metadata` (`type`, `name`, package, bundle member)
 * that the promotion cannot carry alone: every row that holds it, and whose.
 */
export interface MetadataConflict {
  type: string;
  name: string;
  packageId: string | null;
  bundleMember: string | null;
  candidates: Array<{ id: string; organizationId: string | null; state: string | null }>;
}

/**
 * `sys_user_permission_set` (C7b): the populations the unique index on
 * (`user_id`, `permission_set`, `organization_id`) refuses, which the ceremony
 * reports and never deletes. A NULL organization is keyed with NULL, as that
 * index keys it: it is declared `unique: 'organization'`, so its organization
 * key part is NULL-safe (ADR-0120 D3).
 */
export interface GrantKeyPlan {
  /** `absent` on a 17.x database this release has not booted against yet: nothing can be counted. */
  nameColumn: 'present' | 'absent';
  /** Named grants holding one set for one user in one organization: they block the legacy id column's drop. */
  duplicates: { groups: number; rows: number };
  /** Legacy grants the rewrite may not name, each with the grant that already holds its key: they block the rewrite. */
  rewriteCollisions: GrantCollision[];
  note?: string;
}

/** One `(name, locale)` the promotion cannot carry without the operator's choice. */
export interface TemplateConflict {
  name: string;
  locale: string;
  candidates: Array<{ id: string; organizationId: string | null }>;
}

/** The table whose customized and authored rows the ceremony promotes (ruling C on ADR-0131 §6 Q1). */
export const TEMPLATE_OBJECT = 'sys_email_template';
/** The permission-set grant table whose unique key the plan reads ({@link GrantKeyPlan}). */
export const GRANT_OBJECT = 'sys_user_permission_set';
const LEGACY_SET_OBJECT = 'sys_permission_set';

/** Provenance the seeders stamped: only such a row can be a copy of code. */
export const SEEDED_BY: readonly string[] = ['package', 'platform', 'system'];

/**
 * The `sys_email_template` rows the promotion carries: a customized row (or one
 * whose `customized` is unknown), and every row no seeder wrote (`managed_by`
 * NULL or outside package / platform / system), with or without an
 * organization. Every other row — seeded and uncustomized, NULL residue or an
 * organization's copy — is a copy of code: a mirror, never promoted.
 */
export function templatePromotionSql(sql: Sql, cols: ReadonlySet<string>): { text: string; params: unknown[] } {
  const t = TEMPLATE_OBJECT;
  const c = sql.q('customized', t);
  const customized = cols.has('customized') ? `${c} = ? OR ${c} IS NULL` : '1 = 0';
  const params: unknown[] = cols.has('customized') ? [sql.bind(true)] : [];
  if (!cols.has('managed_by')) return { text: '1 = 1', params: [] };
  const managed = sql.q('managed_by', t);
  return {
    text: `${customized} OR ${managed} IS NULL OR ${managed} NOT IN (${SEEDED_BY.map(() => '?').join(', ')})`,
    params: [...params, ...SEEDED_BY],
  };
}

/** The table whose organization-scoped customizations the ceremony promotes (ruling record 6020163868, A). */
export const METADATA_OBJECT = 'sys_metadata';

/**
 * The five presentational types whose organization-scoped rows are promoted to
 * environment rows (ruling records 6020163868 and 6020151485, both A). The
 * inventory's `organization-presentational-promotion` category names the same
 * list, and a pin holds the two equal.
 */
export const PRESENTATIONAL_TYPES: readonly string[] = ['view', 'dashboard', 'report', 'translation', 'email_template'];

/** One `sys_metadata` row of a presentational type, by its overlay key. */
export interface MetadataKeyRow {
  id: string;
  type: string;
  name: string;
  packageId: string | null;
  bundleMember: string | null;
  /** `null` = an environment row. */
  organizationId: string | null;
  state: string | null;
}

/**
 * Every `sys_metadata` row of a presentational type, by key, keyset-paged:
 * environment rows and organization rows alike, so a key the environment
 * already holds is seen as held. No body is read.
 */
export async function readMetadataKeyRows(sql: Sql, table: string, columns: ReadonlySet<string>): Promise<MetadataKeyRow[]> {
  for (const column of ['type', 'name', ORG]) requireColumn(table, columns, column);
  const select = ['id', 'type', 'name', ORG, ...['package_id', 'bundle_member', 'state'].filter((c) => columns.has(c))];
  const t = sql.q(table, table);
  const id = sql.q(ID, table);
  const types = PRESENTATIONAL_TYPES.map(() => '?').join(', ');
  const out: MetadataKeyRow[] = [];
  let after: unknown;
  for (;;) {
    const rows = await sql.read(
      table,
      `SELECT ${select.map((c) => `${sql.q(c, table)} AS ${sql.q(c, table)}`).join(', ')} FROM ${t} ` +
        `WHERE ${sql.q('type', table)} IN (${types})${after === undefined ? '' : ` AND ${id} > ?`} ORDER BY ${id} LIMIT ${PAGE}`,
      after === undefined ? [...PRESENTATIONAL_TYPES] : [...PRESENTATIONAL_TYPES, after],
    );
    for (const row of rows) {
      out.push({
        id: String(row.id),
        type: String(row.type),
        name: String(row.name),
        packageId: nonEmptyId(row.package_id),
        bundleMember: nonEmptyId(row.bundle_member),
        organizationId: nonEmptyId(row[ORG]),
        state: nonEmptyId(row.state),
      });
    }
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * Split the promotion population by overlay key: a key held by exactly one
 * row, an organization's, is promotable in place; a key held by an
 * organization's row and any other row (another organization's, or the
 * environment's) is a conflict. Keys only the environment holds are not the
 * ceremony's.
 */
export function groupMetadataKeyRows(rows: readonly MetadataKeyRow[]): { promotable: MetadataKeyRow[]; conflicts: MetadataConflict[] } {
  const byKey = new Map<string, MetadataKeyRow[]>();
  for (const row of rows) {
    const key = [row.type, row.name, row.packageId ?? '', row.bundleMember ?? ''].join('\u0000');
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const promotable: MetadataKeyRow[] = [];
  const conflicts: MetadataConflict[] = [];
  for (const group of byKey.values()) {
    if (!group.some((r) => r.organizationId !== null)) continue;
    if (group.length === 1) {
      promotable.push(group[0]!);
      continue;
    }
    const first = group[0]!;
    conflicts.push({
      type: first.type,
      name: first.name,
      packageId: first.packageId,
      bundleMember: first.bundleMember,
      candidates: group.map((r) => ({ id: r.id, organizationId: r.organizationId, state: r.state })),
    });
  }
  return { promotable, conflicts };
}

/** The JSON of a definition's own keys, for comparing two bodies. */
export const definitionKey = (body: Readonly<Record<string, unknown>>, keys: readonly string[]): string =>
  JSON.stringify(keys.map((k) => [k, body[k] ?? null]));

/** One `(name, locale)` of the promotion population, its rows and the bodies they define. */
export interface TemplateGroup {
  name: string;
  locale: string;
  rows: Record<string, unknown>[];
  bodies: Record<string, unknown>[];
  /** The rows define the template differently. */
  conflict: boolean;
}

/** Group population rows by `(name, locale)`; a row whose mapped body carries no name is listed apart. */
export function groupTemplateRows(rows: readonly Record<string, unknown>[]): { groups: TemplateGroup[]; nameless: string[] } {
  const byKey = new Map<string, TemplateGroup>();
  const nameless: string[] = [];
  for (const row of rows) {
    const body = emailTemplateDefinitionFromRow(row);
    const name = typeof body.name === 'string' && body.name !== '' ? body.name : null;
    if (name === null) {
      nameless.push(String(row.id));
      continue;
    }
    const locale = String(body.locale);
    const key = `${name}\u0000${locale}`;
    const group = byKey.get(key) ?? { name, locale, rows: [], bodies: [], conflict: false };
    group.rows.push(row);
    group.bodies.push(body);
    byKey.set(key, group);
  }
  for (const group of byKey.values()) {
    const keys = [...new Set(group.bodies.flatMap(Object.keys))];
    group.conflict = new Set(group.bodies.map((b) => definitionKey(b, keys))).size > 1;
  }
  return { groups: [...byKey.values()], nameless };
}

const nonEmptyId = (value: unknown): string | null =>
  value === null || value === undefined || String(value) === '' ? null : String(value);

/** The conflicts among the promotion population of one physical template table. */
async function readTemplateConflicts(sql: Sql, table: string, columns: ReadonlySet<string>): Promise<TemplateConflict[]> {
  const where = templatePromotionSql(sql, columns);
  const rows = await sql.read(table, `SELECT * FROM ${sql.q(table, table)} WHERE ${where.text} ORDER BY ${sql.q('id', table)}`, where.params);
  return groupTemplateRows(rows)
    .groups.filter((g) => g.conflict)
    .map((g) => ({
      name: g.name,
      locale: g.locale,
      candidates: g.rows.map((r) => ({ id: String(r.id), organizationId: nonEmptyId(r[ORG]) })),
    }));
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

/** Identifier quoting, value binding and refusing reads, shared with the apply step. */
export class Sql {
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

export function columnNameOf(row: Record<string, unknown>): string | null {
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

export function columnListSql(dialect: PlanDialect): string {
  if (dialect === 'sqlite') return 'SELECT name AS column_name FROM pragma_table_info(?)';
  if (dialect === 'postgres') {
    return 'SELECT column_name FROM information_schema.columns WHERE table_schema = ANY (current_schemas(false)) AND table_name = ?';
  }
  return 'SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?';
}

/** The SQL of one predicate, its columns required present on `table`. */
export function predicateSql(sql: Sql, table: string, columns: ReadonlySet<string>, predicate: RowPredicate): { text: string; params: unknown[] } {
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

export function requireColumn(table: string, columns: ReadonlySet<string>, column: string): void {
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

async function readCatalog(sql: Sql, reader: PlanReader, inventoried: ReadonlySet<string>): Promise<Catalog> {
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
  if (![...bases.keys()].some((base) => hasPlatformObjectPrefix(base) && inventoried.has(base))) {
    throw new OrganizationOwnershipPlanRefusal(
      'not-an-objectstack-database',
      `This database holds none of the platform tables the inventory names (${rows.length} table(s) listed), so it is ` +
        'not an ObjectStack database the ceremony can plan — check --database-url / $OS_DATABASE_URL.',
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
  onAttribution?: AttributionSink;
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
async function applyAnchor(
  ctx: PlanContext,
  anchor: Anchor,
  rows: PendingRow[],
  derived: Record<string, number>,
  assigned: AttributionAssignment[],
): Promise<PendingRow[]> {
  const label = anchorLabel(anchor);
  const left: PendingRow[] = [];
  const derive = (row: PendingRow, organizationId: string): void => {
    derived[label] = (derived[label] ?? 0) + 1;
    assigned.push({ id: row.id, table: row.shard, organizationId, via: label });
  };
  if (anchor.kind === 'parent') {
    const keys = [...new Set(rows.map((r) => nonEmpty(r.values[anchor.childKey])).filter((k): k is string => k !== null))];
    const orgs = keys.length ? await organizationsById(ctx, anchor.parentObject, keys) : new Map<string, string | null>();
    for (const row of rows) {
      const key = nonEmpty(row.values[anchor.childKey]);
      if (key === null) left.push({ ...row, reason: `no ${anchor.childKey}` });
      else if (typeof orgs === 'string') left.push({ ...row, reason: orgs });
      else if (!orgs.has(key)) left.push({ ...row, reason: `${anchor.parentObject} row ${key} not found` });
      else if (orgs.get(key) === null) left.push({ ...row, reason: `${anchor.parentObject} row ${key} has no organization` });
      else derive(row, orgs.get(key)!);
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
        else derive(row, orgs.get(id)!);
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
    else derive(row, [...orgs][0]!);
  }
  return left;
}

/**
 * Overlay-key columns that arrived after 17.x: `sys_metadata.bundle_member`
 * first shipped in 18.0.0-next.0. Both the plan and the apply boot with schema
 * changes held, so on the 17.x databases this ceremony migrates the column is
 * absent, which the overlay key reads as NULL (its NULL-folded part).
 */
const FOLDED_KEY_COLUMNS: ReadonlySet<string> = new Set(['bundle_member']);

async function planCategory(sql: Sql, table: string, columns: ReadonlySet<string>, category: InventoryCategory): Promise<{ rows: number; groups?: number }> {
  // A category that selects on the organization column has no rows left once
  // the column is gone (the ceremony's post-check reads a dropped table too).
  if (!columns.has(ORG) && conditionColumns(category.where).includes(ORG)) {
    return category.conflictBy ? { rows: 0, groups: 0 } : { rows: 0 };
  }
  const t = sql.q(table, table);
  const where = predicateSql(sql, table, columns, category.where ?? []);
  if (!category.conflictBy) {
    return { rows: await sql.count(table, `SELECT COUNT(*) AS n FROM ${t} WHERE ${where.text}`, where.params) };
  }
  // A key column a 17.x database never had (see FOLDED_KEY_COLUMNS) reads as
  // NULL on every row there, and grouping by a constant is no grouping: it is
  // grouped by only where it exists. Every other column is required.
  const groupBy = category.conflictBy.groupBy
    .filter((c) => columns.has(c) || !FOLDED_KEY_COLUMNS.has(c))
    .map((c) => {
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

/** {@link GrantKeyPlan}: read-only, keyed like the index. */
async function planGrantKeys(ctx: PlanContext, table: string, columns: ReadonlySet<string>): Promise<GrantKeyPlan> {
  const { sql } = ctx;
  if (!columns.has('permission_set') || !columns.has('user_id')) {
    return {
      nameColumn: 'absent',
      duplicates: { groups: 0, rows: 0 },
      rewriteCollisions: [],
      note:
        `${table} has no permission_set column yet, so no grant names its set and nothing here can be counted. ` +
        'Boot this release once against the database (its schema sync adds the column), then re-run the plan.',
    };
  }
  const keyColumns = ['user_id', 'permission_set', ...(columns.has(ORG) ? [ORG] : [])];
  const duplicates = await planCategory(sql, table, columns, {
    id: 'duplicate-grants',
    label: 'grants holding one permission set for one user in one organization',
    citation: 'seat answers 6162538253, Q5 A',
    where: [{ column: 'permission_set', isNull: false }],
    conflictBy: { groupBy: keyColumns },
  });
  const rewriteCollisions: GrantCollision[] = [];
  if (columns.has('permission_set_id')) {
    const t = sql.q(table, table);
    const nameCol = sql.q('permission_set', table);
    const select = ['id', 'user_id', 'permission_set', 'permission_set_id', ...(columns.has(ORG) ? [ORG] : [])]
      .map((c) => sql.q(c, table)).join(', ');
    const rows = await sql.read(table, `SELECT ${select} FROM ${t}`, []);
    const named = rows.filter((r) => nonEmptyId(r.permission_set) !== null);
    const legacy = rows.filter((r) => nonEmptyId(r.permission_set) === null);
    const sets = new Map<string, LegacySetRow>();
    const setColumns = ctx.catalog.columns.get(LEGACY_SET_OBJECT);
    if (legacy.length && setColumns?.has('name')) {
      const setSelect = ['id', 'name', ...(setColumns.has(ORG) ? [ORG] : [])].map((c) => sql.q(c, LEGACY_SET_OBJECT)).join(', ');
      for (const r of await sql.read(LEGACY_SET_OBJECT, `SELECT ${setSelect} FROM ${sql.q(LEGACY_SET_OBJECT, LEGACY_SET_OBJECT)}`, [])) {
        sets.set(String(r.id), { name: nonEmptyId(r.name), organizationId: nonEmptyId(r[ORG]) });
      }
    }
    rewriteCollisions.push(...planGrantRewrite(
      legacy.map((r) => ({ id: String(r.id), userId: nonEmptyId(r.user_id), organizationId: nonEmptyId(r[ORG]), setId: nonEmptyId(r.permission_set_id) })),
      named.map((r) => ({ id: String(r.id), userId: nonEmptyId(r.user_id), organizationId: nonEmptyId(r[ORG]), name: String(r.permission_set) })),
      sets,
    ).collisions);
  }
  return { nameColumn: 'present', duplicates: { groups: duplicates.groups ?? 0, rows: duplicates.rows }, rewriteCollisions };
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
  if (entry.object === METADATA_OBJECT && hasOrg) {
    const conflicts: MetadataConflict[] = [];
    for (const table of tables) conflicts.push(...groupMetadataKeyRows(await readMetadataKeyRows(sql, table, ctx.catalog.columns.get(table)!)).conflicts);
    plan.metadataConflicts = conflicts;
  }
  if (entry.object === TEMPLATE_OBJECT) {
    const conflicts: TemplateConflict[] = [];
    for (const table of tables) conflicts.push(...(await readTemplateConflicts(sql, table, ctx.catalog.columns.get(table)!)));
    plan.templateConflicts = conflicts;
  }
  if (entry.object === GRANT_OBJECT) plan.grants = await planGrantKeys(ctx, tables[0]!, columns);

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
    const assigned: AttributionAssignment[] = [];
    if (entry.fate === 'attribution') {
      for (const anchor of entry.anchors ?? []) {
        if (pending.length === 0) break;
        pending = await applyAnchor(ctx, anchor, pending, derived, assigned);
      }
      if (pending.length > 0 && ctx.posture === 'single' && ctx.defaultOrganizationId !== null) {
        derived['default-organization'] = (derived['default-organization'] ?? 0) + pending.length;
        for (const row of pending) {
          assigned.push({ id: row.id, table: row.shard, organizationId: ctx.defaultOrganizationId, via: 'default-organization' });
        }
        pending = [];
      }
    }
    if (ctx.onAttribution && assigned.length > 0) await ctx.onAttribution({ object: entry.object, assignments: assigned });
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
  /**
   * `--apply`'s attribution step: receives every owner the walk derives. The
   * plan's own run passes none and stays SELECT-only.
   */
  onAttribution?: AttributionSink;
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
  const byObject = new Map(inventory.map((e) => [e.object, e]));
  const catalog = await readCatalog(sql, opts.reader, new Set(byObject.keys()));

  // No sys_organization table (a deployment composed without the auth family)
  // holds no organization at all: nothing derives to a Default Organization.
  const hasOrganizations = catalog.bases.has('sys_organization');
  const organizations = hasOrganizations
    ? await sql.count('sys_organization', `SELECT COUNT(*) AS n FROM ${sql.q('sys_organization', 'sys_organization')}`)
    : 0;
  let defaultOrganizationId: string | null = null;
  if (hasOrganizations && catalog.columns.get('sys_organization')?.has('slug')) {
    const rows = await sql.read(
      'sys_organization',
      `SELECT ${sql.q(ID, 'sys_organization')} AS id FROM ${sql.q('sys_organization', 'sys_organization')} WHERE ${sql.q('slug', 'sys_organization')} = ?`,
      [DEFAULT_ORGANIZATION_SLUG],
    );
    defaultOrganizationId = rows.length > 0 ? nonEmpty(rows[0]!.id) : null;
  }
  const ctx: PlanContext = {
    sql,
    catalog,
    posture: opts.posture,
    defaultOrganizationId,
    ...(opts.onAttribution ? { onAttribution: opts.onAttribution } : {}),
  };

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
            'guess one: the inventory (packages/cli/src/utils/organization-ownership-inventory.ts) owes it a row, or, ' +
            'when the host provides the object, the host declares its fate in a fate supplement passed with ' +
            '--fate-supplement FILE.',
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
