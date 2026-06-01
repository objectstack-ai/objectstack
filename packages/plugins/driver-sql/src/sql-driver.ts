// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL Driver for ObjectStack
 *
 * Implements the standard IDataDriver from @objectstack/spec via Knex.js.
 * Supports PostgreSQL, MySQL, SQLite, and other SQL databases.
 */

import type { QueryAST, DriverOptions, SchemaMode } from '@objectstack/spec/data';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { StorageNameMapping } from '@objectstack/spec/system';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import knex, { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';

/**
 * Default ID length for auto-generated IDs.
 */
const DEFAULT_ID_LENGTH = 16;

/**
 * Internal table that persists per-(object, tenant, field) auto-number
 * counters so sequences are monotonic, tenant-isolated, and resilient to
 * concurrent writers. Lazily created on first autonumber-bearing insert.
 */
const SEQUENCES_TABLE = '_objectstack_sequences';

/**
 * Sentinel tenant_id used when an object has no tenant field (org-less
 * objects like Setup-side singletons). Keeps the (object, tenant, field)
 * primary key non-null.
 */
const GLOBAL_TENANT = '__global__';

// ── Introspection Types ──────────────────────────────────────────────────────

export interface IntrospectedColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: unknown;
  isPrimary?: boolean;
  isUnique?: boolean;
  maxLength?: number;
}

export interface IntrospectedForeignKey {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName?: string;
}

export interface IntrospectedTable {
  name: string;
  columns: IntrospectedColumn[];
  foreignKeys: IntrospectedForeignKey[];
  primaryKeys: string[];
}

export interface IntrospectedSchema {
  tables: Record<string, IntrospectedTable>;
}

// ── Configuration Types ──────────────────────────────────────────────────────

/**
 * SqlDriver configuration — passed directly to Knex.
 * See https://knexjs.org/guide/#configuration-options
 *
 * `schemaMode` (ADR-0015) is an ObjectStack-level concern, not a Knex
 * option: it is stripped before constructing the Knex instance and gates
 * all schema-mutating DDL. Defaults to `'managed'` when omitted, preserving
 * legacy behaviour.
 */
export type SqlDriverConfig = Knex.Config & { schemaMode?: SchemaMode };

// ── SQL Driver ───────────────────────────────────────────────────────────────

/**
 * SQL Driver for ObjectStack.
 *
 * Implements the IDataDriver contract via Knex.js for optimal SQL
 * generation against PostgreSQL, MySQL, SQLite and other SQL databases.
 */
export class SqlDriver implements IDataDriver {
  // IDataDriver metadata
  public readonly name: string = 'com.objectstack.driver.sql';
  public readonly version: string = '1.0.0';
  public get supports() {
    return {
      // Basic CRUD Operations
      create: true,
      read: true,
      update: true,
      delete: true,

      // Bulk Operations
      bulkCreate: true,
      bulkUpdate: true,
      bulkDelete: true,

      // Transaction & Connection Management
      transactions: true,
      savepoints: false,

      // Query Operations
      queryFilters: true,
      queryAggregations: true,
      /**
       * Per-granularity native date bucket support. Granularities marked
       * `false` (or absent) fall back to in-memory `bucketDateValue()` via
       * `engine.findData` — see `buildDateBucketExpr()` for the SQL emitted.
       */
      queryDateGranularity: this.dateGranularityCapabilities,
      querySorting: true,
      queryPagination: true,
      queryWindowFunctions: true,
      querySubqueries: true,
      queryCTE: false,
      joins: true,

      // Advanced Features
      fullTextSearch: false,
      jsonQuery: false,
      geospatialQuery: false,
      streaming: false,
      jsonFields: true,
      arrayFields: true,
      vectorSearch: false,

      // Schema Management
      schemaSync: true,
      batchSchemaSync: false,
      migrations: false,
      // Object-level declared `indexes` (incl. multi-column UNIQUE) are
      // materialized during `initObjects` — see `syncDeclaredIndexes`.
      indexes: true,

      // Performance & Optimization
      connectionPooling: true,
      preparedStatements: true,
      queryCache: false,
    };
  }

  protected knex: Knex;
  protected config: Knex.Config;
  protected jsonFields: Record<string, string[]> = {};
  protected booleanFields: Record<string, string[]> = {};
  protected dateFields: Record<string, Set<string>> = {};
  protected datetimeFields: Record<string, Set<string>> = {};
  protected tablesWithTimestamps: Set<string> = new Set();
  /**
   * Autonumber field configs per table, captured during initObjects.
   *
   * Each entry records:
   *   - `prefix` + `padWidth`: how to render the next value (`CTR-0007`)
   *   - `tenantField`: the column to scope the sequence by (defaults to
   *     `organization_id` if the object has that field, otherwise null →
   *     sequence is shared globally for that field)
   *
   * Numbering is backed by the `_objectstack_sequences` row keyed by
   * `(object, tenant_id, field)`, not by scanning the data table on each
   * insert. The sequence row is bootstrapped from the existing MAX on
   * first use so legacy data is respected.
   */
  protected autoNumberFields: Record<
    string,
    Array<{ name: string; format: string; prefix: string; padWidth: number; tenantField: string | null }>
  > = {};

  /** Whether the sequences table has been ensured this process. */
  protected sequencesTableReady = false;
  /** In-flight ensure promise; deduplicates concurrent first calls. */
  protected sequencesTableEnsurePromise: Promise<void> | null = null;

  /**
   * Per-table tenant-isolation column. Populated during `initObjects` by
   * detecting an `organization_id` field. When set and the caller passes
   * `DriverOptions.tenantId`, the driver automatically:
   *
   *   - scopes reads/updates/deletes/aggregates to that tenant
   *   - injects `organization_id` on inserts that omit it
   *
   * If `tenantId` is absent (admin / seed / system path) no scope is
   * applied — preserves backward compatibility for tools that legitimately
   * need cross-tenant access. Tenant enforcement is therefore opt-in by
   * the caller, not by the driver.
   */
  protected tenantFieldByTable: Record<string, string | null> = {};

  /** Throttle table for missing-tenantId warnings ({object}:{op}). */
  protected tenantAuditWarned: Set<string> = new Set();

  /**
   * Optional logger sink for security-audit warnings. Tests inject a spy;
   * production callers wire in their preferred logger. Defaults to
   * `console.warn` so warnings surface even without setup.
   */
  protected logger: { warn: (msg: string, meta?: any) => void } = {
    warn: (msg, meta) => console.warn(msg, meta ?? ''),
  };

  /** Whether the underlying database is a SQLite variant (sqlite3 or better-sqlite3). */
  protected get isSqlite(): boolean {
    const c = (this.config as any).client;
    return c === 'sqlite3' || c === 'better-sqlite3';
  }

  /** Whether the underlying database is PostgreSQL. */
  protected get isPostgres(): boolean {
    const c = (this.config as any).client;
    return c === 'pg' || c === 'postgresql';
  }

  /** Whether the underlying database is MySQL. */
  protected get isMysql(): boolean {
    const c = (this.config as any).client;
    return c === 'mysql' || c === 'mysql2';
  }

  /**
   * Per-granularity native SQL bucket support, computed from dialect.
   *
   * Must match `bucketDateValue()` in @objectstack/objectql exactly:
   *   year    → 'YYYY'
   *   month   → 'YYYY-MM'
   *   day     → 'YYYY-MM-DD'
   *   quarter → 'YYYY-Q[1-4]'
   *   week    → 'YYYY-W[01-53]' (ISO-8601)
   *
   * Granularities not listed (or set to false) fall back to in-memory bucketing
   * via engine.findData → applyInMemoryAggregation.
   */
  protected get dateGranularityCapabilities(): Record<string, boolean> {
    if (this.isPostgres) {
      return { day: true, month: true, quarter: true, year: true, week: true };
    }
    if (this.isMysql) {
      return { day: true, month: true, quarter: true, year: true, week: true };
    }
    if (this.isSqlite) {
      // SQLite's strftime gained ISO week (%V) in 3.46 (2024-05-23); play it safe
      // and bucket week in-memory. Day/month/year/quarter are universally available.
      return { day: true, month: true, quarter: true, year: true, week: false };
    }
    return {};
  }

  /**
   * Build SQL fragment + bindings for a date bucket expression.
   * Returns `null` when the current dialect does not support the requested
   * granularity — callers must fall back to in-memory bucketing.
   *
   * Exposed as `{sql, bindings}` (not `Knex.Raw`) so callers can both
   * `groupByRaw()` and embed the same expression inside a `select() as alias`
   * with correctly forwarded identifier bindings.
   */
  protected buildDateBucketExpr(
    field: string,
    granularity: 'day' | 'week' | 'month' | 'quarter' | 'year',
  ): { sql: string; bindings: any[] } | null {
    if (!this.dateGranularityCapabilities[granularity]) return null;

    if (this.isPostgres) {
      switch (granularity) {
        case 'year':    return { sql: `to_char((??)::timestamptz AT TIME ZONE 'UTC', 'YYYY')`, bindings: [field] };
        case 'month':   return { sql: `to_char((??)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')`, bindings: [field] };
        case 'day':     return { sql: `to_char((??)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, bindings: [field] };
        case 'quarter': return { sql: `to_char((??)::timestamptz AT TIME ZONE 'UTC', 'YYYY"-Q"Q')`, bindings: [field] };
        case 'week':    return { sql: `to_char((??)::timestamptz AT TIME ZONE 'UTC', 'IYYY"-W"IW')`, bindings: [field] };
      }
    }

    if (this.isMysql) {
      switch (granularity) {
        case 'year':    return { sql: `date_format(convert_tz(??, @@session.time_zone, '+00:00'), '%Y')`, bindings: [field] };
        case 'month':   return { sql: `date_format(convert_tz(??, @@session.time_zone, '+00:00'), '%Y-%m')`, bindings: [field] };
        case 'day':     return { sql: `date_format(convert_tz(??, @@session.time_zone, '+00:00'), '%Y-%m-%d')`, bindings: [field] };
        case 'quarter': return { sql: `concat(date_format(convert_tz(??, @@session.time_zone, '+00:00'), '%Y'), '-Q', quarter(convert_tz(??, @@session.time_zone, '+00:00')))`, bindings: [field, field] };
        case 'week':    return { sql: `date_format(convert_tz(??, @@session.time_zone, '+00:00'), '%x-W%v')`, bindings: [field] };
      }
    }

    if (this.isSqlite) {
      switch (granularity) {
        case 'year':    return { sql: `strftime('%Y', ??)`, bindings: [field] };
        case 'month':   return { sql: `strftime('%Y-%m', ??)`, bindings: [field] };
        case 'day':     return { sql: `strftime('%Y-%m-%d', ??)`, bindings: [field] };
        case 'quarter': return { sql: `(strftime('%Y', ??) || '-Q' || ((cast(strftime('%m', ??) as integer) - 1) / 3 + 1))`, bindings: [field, field] };
        case 'week':    return null; // see capabilities note
      }
    }

    return null;
  }

  /**
   * Schema ownership mode (ADR-0015). When not `'managed'`, all
   * schema-mutating DDL is rejected by {@link assertSchemaMutable}. The
   * runtime injects this from `Datasource.schemaMode`; defaults to
   * `'managed'` so existing callers are unaffected.
   */
  protected readonly schemaMode: SchemaMode;

  constructor(config: SqlDriverConfig) {
    // `schemaMode` is an ObjectStack concern, not a Knex option — strip it
    // before handing the config to Knex.
    const { schemaMode, ...knexConfig } = config;
    this.schemaMode = schemaMode ?? 'managed';
    this.config = knexConfig;
    this.knex = knex(knexConfig);
  }

  /**
   * DDL gate (ADR-0015 §5.1). Single choke-point asserting that
   * schema-mutating DDL is only performed on a `managed` datasource.
   * Federated datasources (`external` / `validate-only`) are guests in a
   * database ObjectStack does not own and must never run DDL against.
   */
  protected assertSchemaMutable(operation: string): void {
    if (this.schemaMode !== 'managed') {
      throw new ExternalSchemaModeViolationError(
        `DDL operation '${operation}' is forbidden: datasource schemaMode='${this.schemaMode}'. ` +
          `ObjectStack never mutates the schema of an external database.`,
      );
    }
  }

  // ===================================
  // Lifecycle
  // ===================================

  async connect(): Promise<void> {
    // Ensure the database directory exists before any query can trigger
    // better-sqlite3 to open the file (e.g. loadMetaFromDb on startup).
    await this.ensureDatabaseExists();
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.knex.raw('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.knex.destroy();
  }

  // ===================================
  // CRUD — DriverInterface core
  // ===================================

  async find(object: string, query: QueryAST, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

    // SELECT
    if (query.fields) {
      builder.select((query.fields as string[]).map((f: string) => this.mapSortField(f)));
    } else {
      builder.select('*');
    }

    // WHERE
    if (query.where) {
      this.applyFilters(builder, query.where);
    }

    // ORDER BY
    if (query.orderBy && Array.isArray(query.orderBy)) {
      for (const item of query.orderBy) {
        if (item.field) {
          builder.orderBy(this.mapSortField(item.field), item.order || 'asc');
        }
      }
    }

    // PAGINATION
    if (query.offset !== undefined) builder.offset(query.offset);
    if (query.limit !== undefined) builder.limit(query.limit);

    let results: any[];
    try {
      results = await builder;
    } catch (error: any) {
      if (
        error.message &&
        (error.message.includes('no such column') ||
          (error.message.includes('column') && error.message.includes('does not exist')))
      ) {
        return [];
      }
      throw error;
    }

    if (!Array.isArray(results)) {
      return [];
    }

    if (this.isSqlite) {
      for (const row of results) {
        this.formatOutput(object, row);
      }
    }
    return results;
  }

  async findOne(object: string, query: QueryAST, options?: DriverOptions): Promise<any> {
    // When called with a string/number id fall back gracefully
    if (typeof query === 'string' || typeof query === 'number') {
      const builder = this.getBuilder(object, options).where('id', query);
      this.applyTenantScope(builder, object, options);
      const res = await builder.first();
      return this.formatOutput(object, res) || null;
    }

    if (query && typeof query === 'object') {
      const results = await this.find(object, { ...query, limit: 1 }, options);
      return results[0] || null;
    }

    return null;
  }

  /**
   * Stream records matching a structured query.
   * NOTE: Current implementation fetches all results then yields them.
   * TODO: Use Knex .stream() for true cursor-based streaming on large datasets.
   */
  async *findStream(object: string, query: QueryAST, options?: DriverOptions): AsyncGenerator<Record<string, any>> {
    const results = await this.find(object, query, options);
    for (const row of results) {
      yield row;
    }
  }

  async create(object: string, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    const { _id, ...rest } = data;
    const toInsert = { ...rest };

    if (_id !== undefined && toInsert.id === undefined) {
      toInsert.id = _id;
    } else if (toInsert.id === undefined) {
      toInsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    this.auditMissingTenant(object, 'create', options);
    this.injectTenantOnInsert(object, toInsert, options);
    await this.fillAutoNumberFields(object, toInsert, options);

    const builder = this.getBuilder(object, options);
    const formatted = this.formatInput(object, toInsert);

    const result = await builder.insert(formatted).returning('*');
    return this.formatOutput(object, result[0]);
  }

  /**
   * Ensure the sequence-counter table exists. Idempotent and cheap after
   * the first call (cached via `sequencesTableReady`).
   */
  protected async ensureSequencesTable(): Promise<void> {
    if (this.sequencesTableReady) return;
    if (this.sequencesTableEnsurePromise) {
      await this.sequencesTableEnsurePromise;
      return;
    }
    this.sequencesTableEnsurePromise = (async () => {
      const exists = await this.knex.schema.hasTable(SEQUENCES_TABLE);
      if (!exists) {
        try {
          await this.knex.schema.createTable(SEQUENCES_TABLE, (t) => {
            t.string('object').notNullable();
            t.string('tenant_id').notNullable();
            t.string('field').notNullable();
            t.bigInteger('last_value').notNullable().defaultTo(0);
            t.timestamp('updated_at').defaultTo(this.knex.fn.now());
            t.primary(['object', 'tenant_id', 'field']);
          });
        } catch (err: any) {
          // Race or cross-process create — re-check existence; ignore
          // "already exists" errors from any dialect.
          const stillMissing = !(await this.knex.schema.hasTable(SEQUENCES_TABLE));
          if (stillMissing) throw err;
        }
      }
      this.sequencesTableReady = true;
    })();
    try {
      await this.sequencesTableEnsurePromise;
    } finally {
      this.sequencesTableEnsurePromise = null;
    }
  }

  /**
   * Bootstrap helper: scan the data table for the highest numeric suffix
   * matching `prefix` (optionally scoped to a tenant). Used the first time
   * a sequence row is created so legacy/seeded data continues monotonically.
   */
  protected async scanMaxNumericTail(
    queryRunner: Knex | Knex.Transaction,
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
  ): Promise<number> {
    const escapedPrefix = prefix.replace(/([\\%_])/g, '\\$1');
    let builder = queryRunner(tableName).select(field).where(field, 'like', `${escapedPrefix}%`).whereNotNull(field);
    if (tenantField && tenantId !== null) {
      builder = builder.where(tenantField, tenantId);
    }
    const rows = await builder;
    let maxN = 0;
    for (const r of rows as any[]) {
      const v: string = (r as any)[field];
      if (typeof v !== 'string') continue;
      const tail = v.slice(prefix.length);
      const n = parseInt(tail.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
    return maxN;
  }

  /**
   * Atomically reserve and return the next sequence value for
   * `(object, tenantId, field)`. Bootstraps from the data-table MAX on
   * first call so existing seeded records continue monotonically.
   *
   * Concurrency:
   *   - SQLite: a write transaction (`BEGIN IMMEDIATE` via knex) serializes
   *     all writers; safe in-process. Cross-process SQLite is out of scope.
   *   - Postgres/MySQL: `SELECT … FOR UPDATE` row lock ensures only one
   *     transaction reads-modifies-writes at a time. A PK-violation race on
   *     first insert is retried as an UPDATE.
   *
   * Gaps are tolerated by design — a rolled-back insert "burns" a number,
   * matching standard sequence semantics.
   */
  protected async getNextSequenceValue(
    object: string,
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    parentTrx?: Knex.Transaction,
  ): Promise<number> {
    await this.ensureSequencesTable();
    const resolvedTenantId = tenantField && tenantId ? String(tenantId) : GLOBAL_TENANT;
    const key = { object: tableName, tenant_id: resolvedTenantId, field };

    const runner: Knex | Knex.Transaction = parentTrx ?? this.knex;

    return runner.transaction(async (trx) => {
      // Lock the row (no-op on SQLite, real lock on Postgres/MySQL).
      let existing: any;
      try {
        existing = await trx(SEQUENCES_TABLE).where(key).forUpdate().first();
      } catch {
        // Some dialects/versions reject .forUpdate() on a missing row in
        // weird ways; fall back to plain SELECT then rely on transaction
        // isolation. Postgres/MySQL behave normally here.
        existing = await trx(SEQUENCES_TABLE).where(key).first();
      }

      if (!existing) {
        const seedMax = await this.scanMaxNumericTail(
          trx,
          tableName,
          field,
          prefix,
          tenantField,
          resolvedTenantId === GLOBAL_TENANT ? null : resolvedTenantId,
        );
        const initial = seedMax + 1;
        try {
          await trx(SEQUENCES_TABLE).insert({ ...key, last_value: initial });
          return initial;
        } catch (err) {
          // Another writer raced us to the first INSERT. Fall through to
          // the UPDATE path with the now-present row.
          existing = await trx(SEQUENCES_TABLE).where(key).forUpdate().first();
          if (!existing) throw err;
        }
      }

      const next = Number(existing.last_value) + 1;
      await trx(SEQUENCES_TABLE).where(key).update({ last_value: next, updated_at: this.knex.fn.now() });
      return next;
    });
  }

  /**
   * For each `auto_number` field on the object that the caller did not
   * provide a value for, reserve the next sequence value scoped to the
   * record's tenant (or globally if the object has no tenant field) and
   * render `prefix + zero-padded(value)`.
   */
  protected async fillAutoNumberFields(
    object: string,
    row: Record<string, any>,
    options?: DriverOptions,
  ): Promise<void> {
    const tableName = StorageNameMapping.resolveTableName({ name: object } as any);
    const cfgs = this.autoNumberFields[tableName] || this.autoNumberFields[object];
    if (!cfgs || cfgs.length === 0) return;
    const parentTrx = options?.transaction as Knex.Transaction | undefined;
    for (const cfg of cfgs) {
      if (row[cfg.name] !== undefined && row[cfg.name] !== null && row[cfg.name] !== '') continue;
      // Resolve tenant for this row: explicit field on the record wins,
      // then driver options, else null → global sequence.
      const rowTenant = cfg.tenantField ? row[cfg.tenantField] : undefined;
      const optTenant = (options as any)?.tenantId;
      const tenantId = rowTenant != null && rowTenant !== ''
        ? String(rowTenant)
        : optTenant != null && optTenant !== ''
          ? String(optTenant)
          : null;
      const next = await this.getNextSequenceValue(
        object,
        tableName,
        cfg.name,
        cfg.prefix,
        cfg.tenantField,
        tenantId,
        parentTrx,
      );
      row[cfg.name] = `${cfg.prefix}${String(next).padStart(cfg.padWidth, '0')}`;
    }
  }

  async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    this.auditMissingTenant(object, 'update', options);
    const builder = this.getBuilder(object, options).where('id', id);
    this.applyTenantScope(builder, object, options);
    const formatted = this.formatInput(object, data);

    if (this.tablesWithTimestamps.has(object)) {
      if (this.isSqlite) {
        const now = new Date();
        formatted.updated_at = now.toISOString().replace('T', ' ').replace('Z', '');
      } else {
        formatted.updated_at = this.knex.fn.now();
      }
    }

    await builder.update(formatted);

    const readback = this.getBuilder(object, options).where('id', id);
    this.applyTenantScope(readback, object, options);
    const updated = await readback.first();
    return this.formatOutput(object, updated) || null;
  }

  async upsert(object: string, data: Record<string, any>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, any>> {
    const { _id, ...rest } = data;
    const toUpsert = { ...rest };

    if (_id !== undefined && toUpsert.id === undefined) {
      toUpsert.id = _id;
    } else if (toUpsert.id === undefined) {
      toUpsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    this.auditMissingTenant(object, 'upsert', options);
    this.injectTenantOnInsert(object, toUpsert, options);
    await this.fillAutoNumberFields(object, toUpsert, options);

    const formatted = this.formatInput(object, toUpsert);
    const mergeKeys = conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'];

    const builder = this.getBuilder(object, options);
    await builder.insert(formatted).onConflict(mergeKeys).merge();

    const readback = this.getBuilder(object, options).where('id', toUpsert.id);
    this.applyTenantScope(readback, object, options);
    const result = await readback.first();
    return this.formatOutput(object, result) || toUpsert;
  }

  async delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    this.auditMissingTenant(object, 'delete', options);
    const builder = this.getBuilder(object, options).where('id', id);
    this.applyTenantScope(builder, object, options);
    const count = await builder.delete();
    return count > 0;
  }

  // ===================================
  // Bulk & Batch Operations
  // ===================================

  async bulkCreate(object: string, data: any[], options?: DriverOptions): Promise<any> {
    this.auditMissingTenant(object, 'bulkCreate', options);
    for (const row of data) {
      if (row && typeof row === 'object') this.injectTenantOnInsert(object, row, options);
    }
    const builder = this.getBuilder(object, options);
    return await builder.insert(data).returning('*');
  }

  /**
   * Batch-update multiple records by ID.
   * NOTE: Current implementation performs sequential updates for correctness.
   * TODO: Optimize with SQL CASE statements or batched transactions for performance.
   */
  async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: DriverOptions): Promise<Record<string, any>[]> {
    const results: Record<string, any>[] = [];
    for (const { id, data } of updates) {
      const updated = await this.update(object, id, data, options);
      if (updated) results.push(updated);
    }
    return results;
  }

  async bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void> {
    this.auditMissingTenant(object, 'bulkDelete', options);
    const builder = this.getBuilder(object, options).whereIn('id', ids);
    this.applyTenantScope(builder, object, options);
    await builder.delete();
  }

  async updateMany(object: string, query: QueryAST, data: any, options?: DriverOptions): Promise<number> {
    this.auditMissingTenant(object, 'updateMany', options);
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);
    if (query.where) this.applyFilters(builder, query.where);
    const count = await builder.update(data);
    return count || 0;
  }

  async deleteMany(object: string, query: QueryAST, options?: DriverOptions): Promise<number> {
    this.auditMissingTenant(object, 'deleteMany', options);
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);
    if (query.where) this.applyFilters(builder, query.where);
    const count = await builder.delete();
    return count || 0;
  }

  async count(object: string, query?: QueryAST, options?: DriverOptions): Promise<number> {
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

    if (query?.where) {
      this.applyFilters(builder, query.where);
    }

    const result = await builder.count<{ count: number }[]>('* as count');
    if (result && result.length > 0) {
      const row: any = result[0];
      return Number(row.count ?? row['count(*)'] ?? 0);
    }
    return 0;
  }

  // ===================================
  // Raw Execution
  // ===================================

  /**
   * Run a raw SQL string or knex builder through the underlying knex
   * connection.
   *
   * ⚠️ **Tenant isolation bypass.** Unlike `find`/`update`/`delete` etc.,
   * raw `execute()` does NOT inject the `organization_id` predicate. The
   * caller is responsible for either:
   *   - inlining the tenant filter into the SQL (`WHERE organization_id = ?`),
   *   - or restricting `execute()` to genuinely global queries
   *     (schema introspection, sys_* tables that opt out of tenancy).
   *
   * Prefer the typed CRUD APIs whenever the operation can be expressed
   * through them — they handle tenancy, soft-delete, and audit warnings
   * automatically. See `README.md > Tenant Isolation` for the full bypass
   * matrix.
   */
  async execute(command: any, params?: any[], options?: DriverOptions): Promise<any> {
    if (typeof command !== 'string') {
      return command;
    }

    const builder =
      options?.transaction
        ? this.knex.raw(command, params || []).transacting(options.transaction as Knex.Transaction)
        : this.knex.raw(command, params || []);

    return await builder;
  }

  // ===================================
  // Transactions
  // ===================================

  async beginTransaction(): Promise<Knex.Transaction> {
    return await this.knex.transaction();
  }

  /** IDataDriver standard */
  async commit(transaction: unknown): Promise<void> {
    await (transaction as Knex.Transaction).commit();
  }

  /** IDataDriver standard */
  async rollback(transaction: unknown): Promise<void> {
    await (transaction as Knex.Transaction).rollback();
  }

  /** @deprecated Use commit() instead */
  async commitTransaction(trx: Knex.Transaction): Promise<void> {
    await this.commit(trx);
  }

  /** @deprecated Use rollback() instead */
  async rollbackTransaction(trx: Knex.Transaction): Promise<void> {
    await this.rollback(trx);
  }

  // ===================================
  // Aggregation
  // ===================================

  async aggregate(object: string, query: any, options?: DriverOptions): Promise<any> {
    const builder = this.getBuilder(object, options);
    this.applyTenantScope(builder, object, options);

    if (query.where) {
      this.applyFilters(builder, query.where);
    }

    if (query.groupBy) {
      // groupBy items may be plain strings ('region') or structured objects
      // ({ field: 'closed_at', dateGranularity: 'quarter' }). For structured
      // items we emit a dialect-specific bucket expression aliased as the
      // field name so the resulting row keys match in-memory bucketDateValue.
      for (const g of query.groupBy as Array<string | { field: string; dateGranularity?: string }>) {
        if (typeof g === 'string') {
          builder.groupBy(g);
          builder.select(g);
        } else if (g && typeof g === 'object' && g.field) {
          if (g.dateGranularity) {
            const bucket = this.buildDateBucketExpr(g.field, g.dateGranularity as any);
            if (!bucket) {
              throw new Error(
                `SqlDriver: dateGranularity '${g.dateGranularity}' not supported on dialect ` +
                  `'${(this.config as any).client}'. Engine must fall back to in-memory bucketing.`,
              );
            }
            builder.groupByRaw(bucket.sql, bucket.bindings);
            builder.select(this.knex.raw(`${bucket.sql} as ??`, [...bucket.bindings, g.field]));
          } else {
            builder.groupBy(g.field);
            builder.select(g.field);
          }
        }
      }
    }

    const aggregates = query.aggregations || query.aggregate;
    if (aggregates) {
      for (const agg of aggregates) {
        const funcName = agg.function || agg.func;
        const rawFunc = this.mapAggregateFunc(funcName);
        // Spec: `field` is optional for COUNT (means COUNT(*)).
        const fieldExpr = agg.field ?? '*';
        if (agg.alias) {
          if (fieldExpr === '*') {
            builder.select(this.knex.raw(`${rawFunc}(*) as ??`, [agg.alias]));
          } else {
            builder.select(this.knex.raw(`${rawFunc}(??) as ??`, [fieldExpr, agg.alias]));
          }
        } else {
          if (fieldExpr === '*') {
            builder.select(this.knex.raw(`${rawFunc}(*)`));
          } else {
            builder.select(this.knex.raw(`${rawFunc}(??)`, [fieldExpr]));
          }
        }
      }
    }

    return await builder;
  }

  // ===================================
  // Distinct
  // ===================================

  async distinct(object: string, field: string, filters?: any, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);

    if (filters) {
      this.applyFilters(builder, filters);
    }

    builder.distinct(field);
    const results = await builder;
    return results.map((row: any) => row[field]);
  }

  // ===================================
  // Window Functions
  // ===================================

  async findWithWindowFunctions(object: string, query: any, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);

    builder.select('*');

    if (query.where) {
      this.applyFilters(builder, query.where);
    }

    if (query.windowFunctions && Array.isArray(query.windowFunctions)) {
      for (const wf of query.windowFunctions) {
        const windowFunc = this.buildWindowFunction(wf);
        builder.select(this.knex.raw(`${windowFunc} as ??`, [wf.alias]));
      }
    }

    if (query.orderBy && Array.isArray(query.orderBy)) {
      for (const sort of query.orderBy) {
        builder.orderBy(this.mapSortField(sort.field), sort.order || 'asc');
      }
    }

    if (query.limit) builder.limit(query.limit);
    if (query.offset) builder.offset(query.offset);

    return await builder;
  }

  // ===================================
  // Query Plan Analysis
  // ===================================

  /** IDataDriver standard: analyze query performance */
  async explain(object: string, query: any, options?: DriverOptions): Promise<any> {
    return this.analyzeQuery(object, query, options);
  }

  async analyzeQuery(object: string, query: any, options?: DriverOptions): Promise<any> {
    const builder = this.getBuilder(object, options);

    if (query.fields) {
      builder.select(query.fields);
    } else {
      builder.select('*');
    }

    if (query.where) {
      this.applyFilters(builder, query.where);
    }

    if (query.orderBy && Array.isArray(query.orderBy)) {
      for (const sort of query.orderBy) {
        builder.orderBy(this.mapSortField(sort.field), sort.order || 'asc');
      }
    }

    if (query.limit) builder.limit(query.limit);
    if (query.offset) builder.offset(query.offset);

    const sql = builder.toSQL();
    const client = (this.config as any).client;
    let explainResults: any;

    try {
      if (this.isPostgres) {
        explainResults = await this.knex.raw(`EXPLAIN (FORMAT JSON, ANALYZE) ${sql.sql}`, sql.bindings);
      } else if (this.isMysql) {
        explainResults = await this.knex.raw(`EXPLAIN FORMAT=JSON ${sql.sql}`, sql.bindings);
      } else if (this.isSqlite) {
        explainResults = await this.knex.raw(`EXPLAIN QUERY PLAN ${sql.sql}`, sql.bindings);
      } else {
        return {
          sql: sql.sql,
          bindings: sql.bindings,
          client,
          note: 'EXPLAIN not supported for this database client',
        };
      }

      return { sql: sql.sql, bindings: sql.bindings, client, plan: explainResults };
    } catch (error: any) {
      return {
        sql: sql.sql,
        bindings: sql.bindings,
        client,
        error: error.message,
        note: 'Failed to execute EXPLAIN.',
      };
    }
  }

  // ===================================
  // Schema Sync (syncSchema / init)
  // ===================================

  async syncSchema(object: string, schema: unknown, _options?: DriverOptions): Promise<void> {
    const objectDef = schema as { name: string; fields?: Record<string, any> };
    // The caller passes the resolved physical table name as `object`. Override
    // the def's `name` to ensure DDL targets the physical table even if the
    // schema's `name` is the canonical object name (e.g. 'account').
    await this.initObjects([{ ...objectDef, name: object }]);
  }

  async dropTable(object: string, _options?: DriverOptions): Promise<void> {
    this.assertSchemaMutable('dropTable');
    await this.knex.schema.dropTableIfExists(object);
  }

  /**
   * Batch-initialise tables from an array of object definitions.
   */
  async initObjects(objects: Array<{ name: string; fields?: Record<string, any> }>): Promise<void> {
    // DDL gate (ADR-0015 §5.1): createTable/alterTable below mutate schema.
    // Also covers `syncSchema`, which delegates here.
    this.assertSchemaMutable('initObjects');
    await this.ensureDatabaseExists();

    for (const obj of objects) {
      const tableName = StorageNameMapping.resolveTableName(obj);

      const jsonCols: string[] = [];
      const booleanCols: string[] = [];
      const autoNumberCols: Array<{ name: string; format: string; prefix: string; padWidth: number; tenantField: string | null }> = [];
      // Auto-detect tenant field. Convention: the field named
      // `organization_id` (matching tenantPolicy default) scopes the
      // Resolve tenant scope declaratively first (obj.tenancy.{enabled,
      // tenantField}) — that's the user's explicit intent. Fall back to the
      // implicit "has an organization_id field" detection so legacy objects
      // (whose multi-tenant column was injected by the kernel implicitly)
      // keep working without a spec migration.
      const tenancyDecl = (obj as any)?.tenancy;
      let tenantField: string | null = null;
      if (tenancyDecl && tenancyDecl.enabled !== false && tenancyDecl.tenantField) {
        const declared = String(tenancyDecl.tenantField);
        if (obj.fields && Object.prototype.hasOwnProperty.call(obj.fields, declared)) {
          tenantField = declared;
        }
      }
      if (!tenantField) {
        const hasOrgField = !!(obj.fields && Object.prototype.hasOwnProperty.call(obj.fields, 'organization_id'));
        tenantField = hasOrgField ? 'organization_id' : null;
      }
      if (obj.fields) {
        for (const [name, field] of Object.entries<any>(obj.fields)) {
          const type = field.type || 'string';
          if (this.isJsonField(type, field)) {
            jsonCols.push(name);
          }
          if (type === 'boolean') {
            booleanCols.push(name);
          }
          if (type === 'date') {
            (this.dateFields[tableName] ??= new Set()).add(name);
          }
          if (type === 'datetime') {
            (this.datetimeFields[tableName] ??= new Set()).add(name);
          }
          if (type === 'auto_number' || type === 'autonumber') {
            const fmt = typeof field.format === 'string' && field.format
              ? field.format
              : '{0000}';
            const m = fmt.match(/\{(0+)\}/);
            const padWidth = m ? m[1].length : 4;
            const prefix = m ? fmt.slice(0, m.index ?? 0) : fmt;
            autoNumberCols.push({ name, format: fmt, prefix, padWidth, tenantField });
          }
        }
      }
      this.jsonFields[tableName] = jsonCols;
      this.booleanFields[tableName] = booleanCols;
      this.autoNumberFields[tableName] = autoNumberCols;
      this.tenantFieldByTable[tableName] = tenantField;

      let exists = await this.knex.schema.hasTable(tableName);

      if (exists) {
        const columnInfo = await this.knex(tableName).columnInfo();
        const existingColumns = Object.keys(columnInfo);

        if (existingColumns.includes('_id') && !existingColumns.includes('id')) {
          await this.knex.schema.dropTable(tableName);
          exists = false;
        }
      }

      // Columns created unconditionally by initObjects — skip them when
      // iterating obj.fields to avoid duplicate-column errors (e.g. SQLite
      // rejects CREATE TABLE with two columns of the same name).
      const builtinColumns = new Set(['id', 'created_at', 'updated_at']);

      if (!exists) {
        await this.knex.schema.createTable(tableName, (table) => {
          table.string('id').primary();
          table.timestamp('created_at').defaultTo(this.knex.fn.now());
          table.timestamp('updated_at').defaultTo(this.knex.fn.now());
          if (obj.fields) {
            for (const [name, field] of Object.entries(obj.fields)) {
              if (builtinColumns.has(name)) continue;
              this.createColumn(table, name, field);
            }
          }
        });
        this.tablesWithTimestamps.add(tableName);
      } else {
        const columnInfo = await this.knex(tableName).columnInfo();
        const existingColumns = Object.keys(columnInfo);

        if (existingColumns.includes('updated_at')) {
          this.tablesWithTimestamps.add(tableName);
        }

        await this.knex.schema.alterTable(tableName, (table) => {
          if (obj.fields) {
            for (const [name, field] of Object.entries(obj.fields)) {
              if (!existingColumns.includes(name)) {
                this.createColumn(table, name, field);
              }
            }
          }
        });
      }

      // Materialize object-level declared indexes (`indexes: [{ fields,
      // unique }]`). These are distinct from field-level `unique` (handled
      // in `createColumn`) and carry the multi-column UNIQUE guarantees that
      // dedup/convergence paths rely on (ADR-0030). Done after the table is
      // created/altered so every referenced column physically exists.
      const declaredIndexes = (obj as any).indexes;
      if (Array.isArray(declaredIndexes) && declaredIndexes.length > 0) {
        const colInfo = await this.knex(tableName).columnInfo();
        const physicalColumns = new Set(Object.keys(colInfo));
        await this.syncDeclaredIndexes(tableName, declaredIndexes, physicalColumns);
      }
    }
  }

  /**
   * Build a deterministic index name for a declared index so repeated
   * `initObjects` runs converge on the same identifier (and can detect an
   * already-materialized index by name). Long names are hash-suffixed to
   * stay within the 63/64-char identifier limits of Postgres/MySQL.
   */
  protected buildIndexName(tableName: string, fields: string[], unique: boolean): string {
    const prefix = unique ? 'uniq' : 'idx';
    const base = `${prefix}_${tableName}_${fields.join('_')}`;
    const MAX = 60;
    if (base.length <= MAX) return base;
    const hash = createHash('sha1').update(base).digest('hex').slice(0, 8);
    return `${`${prefix}_${tableName}`.slice(0, MAX - 9)}_${hash}`;
  }

  /**
   * Read the names of indexes that already exist on a table, per dialect.
   * Used to make declared-index sync idempotent across repeated runs.
   * Failures are swallowed — at worst we attempt a create and absorb the
   * "already exists" error in `syncDeclaredIndexes`.
   */
  protected async getExistingIndexNames(tableName: string): Promise<Set<string>> {
    const names = new Set<string>();
    try {
      if (this.isSqlite) {
        const safe = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const rows: any = await this.knex.raw(`PRAGMA index_list(${safe})`);
        for (const r of rows) names.add(r.name);
      } else if (this.isPostgres) {
        const res: any = await this.knex.raw(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ?`,
          [tableName],
        );
        for (const r of res.rows) names.add(r.indexname);
      } else if (this.isMysql) {
        const res: any = await this.knex.raw(
          `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [tableName],
        );
        for (const r of res[0]) names.add(r.INDEX_NAME);
      }
    } catch {
      // Best-effort — fall through and let creation handle conflicts.
    }
    return names;
  }

  /**
   * Materialize declared object-level indexes.
   *
   * - Multi-column and single-column indexes are both supported.
   * - `unique: true` emits a UNIQUE index. NULL-distinct semantics are the
   *   default across SQLite/Postgres/MySQL, so multiple NULL rows remain
   *   allowed while non-NULL duplicates are rejected — matching the
   *   convergence-on-conflict pattern the messaging pipeline relies on.
   * - Idempotent: indexes already present (by deterministic name) are
   *   skipped, and an "already exists" race is absorbed.
   * - Indexes referencing a column that wasn't materialized (e.g. a virtual
   *   `formula` field) are skipped with a warning rather than failing sync.
   */
  protected async syncDeclaredIndexes(
    tableName: string,
    indexes: Array<{ name?: string; fields?: string[]; unique?: boolean }>,
    physicalColumns: Set<string>,
  ): Promise<void> {
    const existing = await this.getExistingIndexNames(tableName);

    for (const idx of indexes) {
      const fields = Array.isArray(idx?.fields)
        ? idx.fields.filter((f): f is string => typeof f === 'string' && f.length > 0)
        : [];
      if (fields.length === 0) continue;

      const missing = fields.filter((f) => !physicalColumns.has(f));
      if (missing.length > 0) {
        this.logger.warn(
          `[sql-driver] skipping declared index on "${tableName}" — column(s) not materialized: ${missing.join(', ')}`,
          { tableName, fields },
        );
        continue;
      }

      const unique = idx.unique === true;
      const name =
        typeof idx.name === 'string' && idx.name.trim()
          ? idx.name.trim()
          : this.buildIndexName(tableName, fields, unique);

      if (existing.has(name)) continue;

      try {
        await this.knex.schema.alterTable(tableName, (table) => {
          if (unique) {
            table.unique(fields, { indexName: name });
          } else {
            table.index(fields, name);
          }
        });
        existing.add(name);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // A concurrent creator or a pre-existing equivalent index under a
        // different name can race us here — both are benign for our intent
        // (the index exists). Anything else is a real failure.
        if (/already exists|duplicate key name|exists/i.test(msg)) continue;
        throw e;
      }
    }
  }

  // ===================================
  // Schema Introspection
  // ===================================

  async introspectSchema(): Promise<IntrospectedSchema> {
    const tables: Record<string, IntrospectedTable> = {};
    let tableNames: string[] = [];

    if (this.isPostgres) {
      const result = await this.knex.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      `);
      tableNames = result.rows.map((row: any) => row.table_name);
    } else if (this.isMysql) {
      const result = await this.knex.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      `);
      tableNames = result[0].map((row: any) => row.TABLE_NAME);
    } else if (this.isSqlite) {
      const result = await this.knex.raw(`
        SELECT name as table_name
        FROM sqlite_master
        WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
      `);
      tableNames = result.map((row: any) => row.table_name);
    }

    for (const tableName of tableNames) {
      const columns = await this.introspectColumns(tableName);
      const foreignKeys = await this.introspectForeignKeys(tableName);
      const primaryKeys = await this.introspectPrimaryKeys(tableName);
      const uniqueConstraints = await this.introspectUniqueConstraints(tableName);

      for (const col of columns) {
        if (primaryKeys.includes(col.name)) col.isPrimary = true;
        if (uniqueConstraints.includes(col.name)) col.isUnique = true;
      }

      tables[tableName] = { name: tableName, columns, foreignKeys, primaryKeys };
    }

    return { tables };
  }

  // ===================================
  // Internal helpers
  // ===================================

  /** Expose the underlying Knex instance for advanced usage. */
  getKnex(): Knex {
    return this.knex;
  }

  protected getBuilder(object: string, options?: DriverOptions) {
    let builder = this.knex(object);
    if (options?.transaction) {
      builder = builder.transacting(options.transaction as Knex.Transaction);
    }
    return builder;
  }

  /**
   * Resolve the tenant column for the given object, if any.
   *
   * Lookup falls back to both the storage-mapped table name and the raw
   * object name so callers that pass either form get the same answer.
   * Returns `null` when the object has no tenant-isolation field.
   */
  protected resolveTenantField(object: string): string | null {
    const tableName = StorageNameMapping.resolveTableName({ name: object } as any);
    const cached =
      this.tenantFieldByTable[tableName] ?? this.tenantFieldByTable[object];
    return cached ?? null;
  }

  /**
   * Apply a `WHERE tenant_field = ?` clause to the given query builder
   * when:
   *   1. `options.tenantId` is provided by the caller, AND
   *   2. the object actually has a tenant-isolation field
   *      (`organization_id` by convention).
   *
   * Without a tenantId the call is treated as an unscoped/admin path —
   * keeps legacy callers, seed scripts, and cross-org tooling working.
   * This is the single chokepoint for read-side tenant isolation in the
   * SQL driver; every CRUD method routes through it.
   */
  protected applyTenantScope(
    builder: Knex.QueryBuilder,
    object: string,
    options?: DriverOptions,
  ): Knex.QueryBuilder {
    const tenantId = (options as any)?.tenantId;
    if (tenantId === undefined || tenantId === null || tenantId === '') return builder;
    const field = this.resolveTenantField(object);
    if (!field) return builder;
    return builder.where(field, String(tenantId));
  }

  /**
   * Auto-inject the tenant column on insert rows when:
   *   1. `options.tenantId` is provided, AND
   *   2. the object has a tenant-isolation field, AND
   *   3. the row does not already set that field.
   *
   * Explicit values are never overwritten — admins writing to a specific
   * tenant via raw row data keep that authority.
   */
  protected injectTenantOnInsert(
    object: string,
    row: Record<string, any>,
    options?: DriverOptions,
  ): void {
    const tenantId = (options as any)?.tenantId;
    if (tenantId === undefined || tenantId === null || tenantId === '') return;
    const field = this.resolveTenantField(object);
    if (!field) return;
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      row[field] = String(tenantId);
    }
  }

  /**
   * Surface writes that target a tenant-scoped object but don't carry a
   * `tenantId`. These are almost always system / seed / admin paths that
   * forgot to thread the active session context — easy to miss in code
   * review and impossible to find after a breach.
   *
   * Throttled to one warning per `${object}:${op}` so background workers
   * don't spam the log. Set `options.bypassTenantAudit = true` (or env
   * `OS_TENANT_AUDIT=0`) to silence intentionally.
   */
  protected auditMissingTenant(
    object: string,
    op: 'create' | 'update' | 'delete' | 'bulkCreate' | 'bulkDelete' | 'updateMany' | 'deleteMany' | 'upsert',
    options?: DriverOptions,
  ): void {
    if (process.env.OS_TENANT_AUDIT === '0') return;
    if ((options as any)?.bypassTenantAudit === true) return;
    const tenantId = (options as any)?.tenantId;
    if (tenantId !== undefined && tenantId !== null && tenantId !== '') return;
    const field = this.resolveTenantField(object);
    if (!field) return;
    const key = `${object}:${op}`;
    if (this.tenantAuditWarned.has(key)) return;
    this.tenantAuditWarned.add(key);
    this.logger.warn(
      `[tenant-audit] ${op} on tenant-scoped object "${object}" without options.tenantId — writes will not be tenant-isolated. Pass tenantId via ExecutionContext or set bypassTenantAudit:true to silence.`,
      { object, op, tenantField: field },
    );
  }

  // ── Filter helpers ──────────────────────────────────────────────────────────

  /**
   * Resolve the underlying table name for a Knex query builder so we can
   * look up column type metadata (date/datetime maps populated during
   * `initObjects`). Returns null when the builder is not table-scoped yet.
   */
  protected tableNameForBuilder(builder: any): string | null {
    const t = builder?._single?.table;
    if (typeof t === 'string') return t;
    return null;
  }

  /**
   * Normalise a filter value for a single column so the comparison the
   * driver sends to SQLite matches the on-disk representation.
   *
   * The platform stores `Field.datetime()` values as INTEGER milliseconds
   * (the result of passing a JS `Date` through better-sqlite3) but date
   * macros like `{last_quarter_start}` expand to an ISO `YYYY-MM-DD` string
   * client-side. Without coercion the SQL becomes `published_at >= '2026-…'`
   * which collapses to a TEXT-vs-INTEGER affinity compare and never
   * matches. We translate the ISO/Date/numeric inputs into the storage
   * type so the comparison works.
   *
   * For `Field.date()` we keep ISO TEXT but normalise Date objects to
   * `YYYY-MM-DD` for the same reason.
   */
  protected coerceFilterValue(table: string | null, field: string, value: any): any {
    if (value == null || !table) return value;
    if (Array.isArray(value)) return value.map((v) => this.coerceFilterValue(table, field, v));

    const isDatetime = this.datetimeFields[table]?.has(field);
    const isDate = this.dateFields[table]?.has(field);
    if (!isDatetime && !isDate) return value;

    const toMs = (v: any): number | null => {
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed === '') return null;
        if (/^-?\d+$/.test(trimmed)) {
          const n = Number(trimmed);
          if (Number.isFinite(n)) return n;
        }
        // Treat bare YYYY-MM-DD as start-of-day UTC; full ISO is parsed
        // as-is so timezones round-trip correctly.
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
        const n = Date.parse(iso);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };

    if (isDatetime) {
      const ms = toMs(value);
      return ms == null ? value : ms;
    }

    // Field.date — normalise to YYYY-MM-DD.
    if (value instanceof Date) {
      const y = value.getUTCFullYear();
      const m = String(value.getUTCMonth() + 1).padStart(2, '0');
      const d = String(value.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    }
    return value;
  }

  protected applyFilters(builder: Knex.QueryBuilder, filters: any) {
    if (!filters) return;
    const table = this.tableNameForBuilder(builder);

    if (!Array.isArray(filters) && typeof filters === 'object') {
      const hasMongoOperators = Object.keys(filters).some(
        (k) =>
          k.startsWith('$') ||
          (typeof filters[k] === 'object' &&
            filters[k] !== null &&
            Object.keys(filters[k]).some((op) => op.startsWith('$'))),
      );

      if (hasMongoOperators) {
        this.applyFilterCondition(builder, filters, 'and', table);
        return;
      }

      for (const [key, value] of Object.entries(filters)) {
        if (['limit', 'offset', 'fields', 'orderBy'].includes(key)) continue;
        builder.where(key, this.coerceFilterValue(table, key, value) as any);
      }
      return;
    }

    if (!Array.isArray(filters) || filters.length === 0) return;

    let nextJoin: 'and' | 'or' = 'and';

    for (const item of filters) {
      if (typeof item === 'string') {
        if (item.toLowerCase() === 'or') nextJoin = 'or';
        else if (item.toLowerCase() === 'and') nextJoin = 'and';
        continue;
      }

      if (Array.isArray(item)) {
        const [fieldRaw, op, value] = item;
        const isCriterion = typeof fieldRaw === 'string' && typeof op === 'string';

        if (isCriterion) {
          const field = this.mapSortField(fieldRaw);
          const coerced = this.coerceFilterValue(table, field, value);
          const apply = (b: any) => {
            const method = nextJoin === 'or' ? 'orWhere' : 'where';
            const methodIn = nextJoin === 'or' ? 'orWhereIn' : 'whereIn';
            const methodNotIn = nextJoin === 'or' ? 'orWhereNotIn' : 'whereNotIn';

            if (op === 'contains') {
              b[method](field, 'like', `%${value}%`);
              return;
            }

            switch (op) {
              case '=':
                b[method](field, coerced);
                break;
              case '!=':
                b[method](field, '<>', coerced);
                break;
              case 'in':
                b[methodIn](field, coerced);
                break;
              case 'nin':
                b[methodNotIn](field, coerced);
                break;
              default:
                b[method](field, op, coerced);
            }
          };
          apply(builder);
        } else {
          const method = nextJoin === 'or' ? 'orWhere' : 'where';
          (builder as any)[method]((qb: any) => {
            this.applyFilters(qb, item);
          });
        }

        nextJoin = 'and';
      }
    }
  }

  protected applyFilterCondition(builder: Knex.QueryBuilder, condition: any, logicalOp: 'and' | 'or' = 'and', tableHint?: string | null) {
    if (!condition || typeof condition !== 'object') return;
    const table = tableHint ?? this.tableNameForBuilder(builder);

    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        builder.where((qb) => {
          for (const sub of value) {
            qb.where((subQb) => {
              this.applyFilterCondition(subQb, sub, 'and', table);
            });
          }
        });
      } else if (key === '$or' && Array.isArray(value)) {
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method]((qb: any) => {
          for (const sub of value) {
            qb.orWhere((subQb: any) => {
              this.applyFilterCondition(subQb, sub, 'or', table);
            });
          }
        });
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const field = this.mapSortField(key);
        for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
          const method = logicalOp === 'or' ? 'orWhere' : 'where';
          const coerced = this.coerceFilterValue(table, field, opValue);
          switch (op) {
            case '$eq':
              (builder as any)[method](field, coerced);
              break;
            case '$ne':
              (builder as any)[method](field, '<>', coerced);
              break;
            case '$gt':
              (builder as any)[method](field, '>', coerced);
              break;
            case '$gte':
              (builder as any)[method](field, '>=', coerced);
              break;
            case '$lt':
              (builder as any)[method](field, '<', coerced);
              break;
            case '$lte':
              (builder as any)[method](field, '<=', coerced);
              break;
            case '$in': {
              const mIn = logicalOp === 'or' ? 'orWhereIn' : 'whereIn';
              (builder as any)[mIn](field, coerced as any[]);
              break;
            }
            case '$nin': {
              const mNotIn = logicalOp === 'or' ? 'orWhereNotIn' : 'whereNotIn';
              (builder as any)[mNotIn](field, coerced as any[]);
              break;
            }
            case '$contains':
              (builder as any)[method](field, 'like', `%${opValue}%`);
              break;
            default:
              (builder as any)[method](field, coerced);
          }
        }
      } else {
        const field = this.mapSortField(key);
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method](field, this.coerceFilterValue(table, field, value) as any);
      }
    }
  }

  // ── Field mapping ───────────────────────────────────────────────────────────

  protected mapSortField(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

  protected mapAggregateFunc(func: string): string {
    switch (func) {
      case 'count':
        return 'count';
      case 'sum':
        return 'sum';
      case 'avg':
        return 'avg';
      case 'min':
        return 'min';
      case 'max':
        return 'max';
      default:
        throw new Error(`Unsupported aggregate function: ${func}`);
    }
  }

  // ── Window function builder ─────────────────────────────────────────────────

  protected buildWindowFunction(spec: any): string {
    const func = spec.function.toUpperCase();
    let sql = `${func}()`;

    const overParts: string[] = [];

    if (spec.partitionBy && Array.isArray(spec.partitionBy) && spec.partitionBy.length > 0) {
      const partitionFields = spec.partitionBy.map((f: string) => this.mapSortField(f)).join(', ');
      overParts.push(`PARTITION BY ${partitionFields}`);
    }

    if (spec.orderBy && Array.isArray(spec.orderBy) && spec.orderBy.length > 0) {
      const orderFields = spec.orderBy
        .map((s: any) => {
          const field = this.mapSortField(s.field);
          const order = (s.order || 'asc').toUpperCase();
          return `${field} ${order}`;
        })
        .join(', ');
      overParts.push(`ORDER BY ${orderFields}`);
    }

    sql += overParts.length > 0 ? ` OVER (${overParts.join(' ')})` : ` OVER ()`;
    return sql;
  }

  // ── Column creation helper ──────────────────────────────────────────────────

  protected createColumn(table: Knex.CreateTableBuilder, name: string, field: any) {
    if (field.multiple) {
      table.json(name);
      return;
    }

    const type = field.type || 'string';
    let col: any;
    switch (type) {
      case 'string':
      case 'email':
      case 'url':
      case 'phone':
      case 'password':
        col = table.string(name);
        break;
      case 'text':
      case 'textarea':
      case 'html':
      case 'markdown':
        col = table.text(name);
        break;
      case 'integer':
      case 'int':
        col = table.integer(name);
        break;
      case 'float':
      case 'number':
      case 'currency':
      case 'percent':
        col = table.float(name);
        break;
      case 'boolean':
        col = table.boolean(name);
        break;
      case 'date':
        col = table.date(name);
        break;
      case 'datetime':
        col = table.timestamp(name);
        break;
      case 'time':
        col = table.time(name);
        break;
      case 'json':
      case 'object':
      case 'array':
      case 'image':
      case 'file':
      case 'avatar':
      case 'location':
        col = table.json(name);
        break;
      case 'lookup':
        col = table.string(name);
        if (field.reference_to) {
          table.foreign(name).references('id').inTable(field.reference_to);
        }
        break;
      case 'summary':
        col = table.float(name);
        break;
      case 'auto_number':
      case 'autonumber':
        col = table.string(name);
        break;
      case 'formula':
        return; // Virtual — no column
      default:
        col = table.string(name);
    }

    if (col) {
      if (field.unique) col.unique();
      if (field.required) col.notNullable();
      // `defaultValue: 'NOW()'` is a framework convention for "use the
      // database clock at insert time". Translate it to the driver-native
      // CURRENT_TIMESTAMP equivalent so the column gets a real default
      // instead of leaving the literal string 'NOW()' for whatever
      // upstream code happens to write.
      if (
        (type === 'datetime' || type === 'date' || type === 'time') &&
        typeof field.defaultValue === 'string' &&
        /^now\(\)$/i.test(field.defaultValue.trim())
      ) {
        col.defaultTo(this.knex.fn.now());
      } else if (field.defaultValue !== undefined && field.defaultValue !== null) {
        const dv = field.defaultValue;
        if (typeof dv === 'string' && /^now\(\)$/i.test(dv.trim())) {
          col.defaultTo(this.knex.fn.now());
        } else if (typeof dv !== 'object') {
          col.defaultTo(dv as any);
        }
      }
    }
  }

  // ── Database helpers ────────────────────────────────────────────────────────

  protected async ensureDatabaseExists() {
    // SQLite auto-creates database files but NOT parent directories.
    // Ensure the directory exists so better-sqlite3 can create the file.
    if (this.isSqlite) {
      const conn = (this.config as any).connection;
      const filename = typeof conn === 'string' ? conn : conn?.filename;
      if (filename && filename !== ':memory:' && !filename.startsWith(':')) {
        const { dirname } = await import('node:path');
        const { mkdir } = await import('node:fs/promises');
        const dir = dirname(filename);
        if (dir && dir !== '.') {
          await mkdir(dir, { recursive: true });
        }
      }
      return;
    }

    // Only PostgreSQL and MySQL support programmatic database creation
    if (!this.isPostgres && !this.isMysql) return;

    try {
      await this.knex.raw('SELECT 1');
    } catch (e: any) {
      // PostgreSQL: '3D000' = database does not exist
      // MySQL:      'ER_BAD_DB_ERROR' (errno 1049) = unknown database
      if (
        e.code === '3D000' ||
        e.code === 'ER_BAD_DB_ERROR' ||
        e.errno === 1049
      ) {
        await this.createDatabase();
      } else {
        throw e;
      }
    }
  }

  protected async createDatabase() {
    const config = this.config as any;
    const connection = config.connection;
    let dbName = '';
    const adminConfig = { ...config };

    if (this.isPostgres) {
      // PostgreSQL: connect to the 'postgres' maintenance database
      if (typeof connection === 'string') {
        const url = new URL(connection);
        dbName = url.pathname.slice(1);
        url.pathname = '/postgres';
        adminConfig.connection = url.toString();
      } else {
        dbName = connection.database;
        adminConfig.connection = { ...connection, database: 'postgres' };
      }
    } else if (this.isMysql) {
      // MySQL: connect without specifying a database
      if (typeof connection === 'string') {
        const url = new URL(connection);
        dbName = url.pathname.slice(1);
        url.pathname = '/';
        adminConfig.connection = url.toString();
      } else {
        dbName = connection.database;
        const { database: _db, ...rest } = connection;
        adminConfig.connection = rest;
      }
    } else {
      return; // Unsupported dialect for auto-creation
    }

    const adminKnex = knex(adminConfig);
    try {
      if (this.isPostgres) {
        await adminKnex.raw(`CREATE DATABASE "${dbName}"`);
      } else if (this.isMysql) {
        await adminKnex.raw(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
      }
    } finally {
      await adminKnex.destroy();
    }
  }

  protected isJsonField(type: string, field: any): boolean {
    return ['json', 'object', 'array', 'image', 'file', 'avatar', 'location'].includes(type) || field.multiple;
  }

  // ── SQLite serialisation ────────────────────────────────────────────────────

  protected formatInput(object: string, data: any): any {
    let copy: any = data;
    let copied = false;

    // Insert/update-time safety net: any caller that passes the literal
    // string 'NOW()' (often because a field defaultValue leaked unresolved)
    // gets it replaced with a real ISO timestamp here, before it hits the
    // wire. Applies to every driver, not just SQLite.
    if (data && typeof data === 'object') {
      const now = new Date().toISOString();
      for (const key of Object.keys(data)) {
        const v = (data as any)[key];
        if (typeof v === 'string' && /^now\(\)$/i.test(v.trim())) {
          if (!copied) { copy = { ...data }; copied = true; }
          copy[key] = now;
        }
      }
    }

    if (!this.isSqlite) return copy;

    const fields = this.jsonFields[object];
    if (!fields || fields.length === 0) return copy;

    if (!copied) { copy = { ...copy }; copied = true; }
    for (const field of fields) {
      if (copy[field] !== undefined && typeof copy[field] === 'object' && copy[field] !== null) {
        copy[field] = JSON.stringify(copy[field]);
      }
    }
    return copy;
  }

  protected formatOutput(object: string, data: any): any {
    if (!data) return data;

    if (this.isSqlite) {
      const jsonFields = this.jsonFields[object];
      if (jsonFields && jsonFields.length > 0) {
        for (const field of jsonFields) {
          if (data[field] !== undefined && typeof data[field] === 'string') {
            try {
              data[field] = JSON.parse(data[field]);
            } catch {
              // keep as string
            }
          }
        }
      }

      const booleanFields = this.booleanFields[object];
      if (booleanFields && booleanFields.length > 0) {
        for (const field of booleanFields) {
          if (data[field] !== undefined && data[field] !== null) {
            data[field] = Boolean(data[field]);
          }
        }
      }
    }

    return data;
  }

  // ── Introspection internals ─────────────────────────────────────────────────

  protected async introspectColumns(tableName: string): Promise<IntrospectedColumn[]> {
    const columnInfo = await this.knex(tableName).columnInfo();
    const columns: IntrospectedColumn[] = [];

    for (const [colName, info] of Object.entries<any>(columnInfo)) {
      let type = 'string';
      let maxLength: number | undefined;

      if (this.isSqlite) {
        type = info.type?.toLowerCase() || 'string';
      } else {
        type = info.type || 'string';
      }

      if (info.maxLength) {
        maxLength = info.maxLength;
      }

      columns.push({
        name: colName,
        type,
        nullable: info.nullable !== false,
        defaultValue: info.defaultValue,
        isPrimary: false,
        isUnique: false,
        maxLength,
      });
    }

    return columns;
  }

  protected async introspectForeignKeys(tableName: string): Promise<IntrospectedForeignKey[]> {
    const foreignKeys: IntrospectedForeignKey[] = [];

    try {
      if (this.isPostgres) {
        const result = await this.knex.raw(
          `
          SELECT
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            tc.constraint_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = ?
        `,
          [tableName],
        );

        for (const row of result.rows) {
          foreignKeys.push({
            columnName: row.column_name,
            referencedTable: row.referenced_table,
            referencedColumn: row.referenced_column,
            constraintName: row.constraint_name,
          });
        }
      } else if (this.isMysql) {
        const result = await this.knex.raw(
          `
          SELECT
            COLUMN_NAME as column_name,
            REFERENCED_TABLE_NAME as referenced_table,
            REFERENCED_COLUMN_NAME as referenced_column,
            CONSTRAINT_NAME as constraint_name
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND REFERENCED_TABLE_NAME IS NOT NULL
        `,
          [tableName],
        );

        for (const row of result[0]) {
          foreignKeys.push({
            columnName: row.column_name,
            referencedTable: row.referenced_table,
            referencedColumn: row.referenced_column,
            constraintName: row.constraint_name,
          });
        }
      } else if (this.isSqlite) {
        const tableExistsResult = await this.knex.raw(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          [tableName],
        );

        if (!Array.isArray(tableExistsResult) || tableExistsResult.length === 0) {
          return foreignKeys;
        }

        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const result = await this.knex.raw(`PRAGMA foreign_key_list(${safeTableName})`);

        for (const row of result) {
          foreignKeys.push({
            columnName: row.from,
            referencedTable: row.table,
            referencedColumn: row.to,
            constraintName: `fk_${tableName}_${row.from}`,
          });
        }
      }
    } catch {
      // silently ignore introspection errors
    }

    return foreignKeys;
  }

  protected async introspectPrimaryKeys(tableName: string): Promise<string[]> {
    const primaryKeys: string[] = [];

    try {
      if (this.isPostgres) {
        const result = await this.knex.raw(
          `
          SELECT a.attname as column_name
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid
            AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = ?::regclass
            AND i.indisprimary
        `,
          [tableName],
        );

        for (const row of result.rows) {
          primaryKeys.push(row.column_name);
        }
      } else if (this.isMysql) {
        const result = await this.knex.raw(
          `
          SELECT COLUMN_NAME as column_name
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND CONSTRAINT_NAME = 'PRIMARY'
        `,
          [tableName],
        );

        for (const row of result[0]) {
          primaryKeys.push(row.column_name);
        }
      } else if (this.isSqlite) {
        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

        const tablesResult = await this.knex.raw("SELECT name FROM sqlite_master WHERE type = 'table'");
        const tableNames = Array.isArray(tablesResult) ? tablesResult.map((row: any) => row.name) : [];

        if (!tableNames.includes(safeTableName)) {
          return primaryKeys;
        }

        const result = await this.knex.raw(`PRAGMA table_info(${safeTableName})`);

        for (const row of result) {
          if (row.pk === 1) {
            primaryKeys.push(row.name);
          }
        }
      }
    } catch {
      // silently ignore
    }

    return primaryKeys;
  }

  protected async introspectUniqueConstraints(tableName: string): Promise<string[]> {
    const uniqueColumns: string[] = [];

    try {
      if (this.isPostgres) {
        const result = await this.knex.raw(
          `
          SELECT c.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage AS ccu
            ON tc.constraint_schema = ccu.constraint_schema
            AND tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'UNIQUE'
            AND tc.table_name = ?
        `,
          [tableName],
        );

        for (const row of result.rows) {
          uniqueColumns.push(row.column_name);
        }
      } else if (this.isMysql) {
        const result = await this.knex.raw(
          `
          SELECT COLUMN_NAME
          FROM information_schema.TABLE_CONSTRAINTS tc
          JOIN information_schema.KEY_COLUMN_USAGE kcu
            USING (CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME)
          WHERE CONSTRAINT_TYPE = 'UNIQUE'
            AND TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
        `,
          [tableName],
        );

        for (const row of result[0]) {
          uniqueColumns.push(row.COLUMN_NAME);
        }
      } else if (this.isSqlite) {
        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

        const tablesResult = await this.knex.raw("SELECT name FROM sqlite_master WHERE type = 'table'");
        const tableNames = Array.isArray(tablesResult) ? tablesResult.map((row: any) => row.name) : [];

        if (!tableNames.includes(safeTableName)) {
          return uniqueColumns;
        }

        const indexes = await this.knex.raw(`PRAGMA index_list(${safeTableName})`);

        for (const idx of indexes) {
          if (idx.unique === 1) {
            const info = await this.knex.raw(`PRAGMA index_info(${idx.name})`);
            if (info.length === 1) {
              uniqueColumns.push(info[0].name);
            }
          }
        }
      }
    } catch {
      // silently ignore
    }

    return uniqueColumns;
  }
}
