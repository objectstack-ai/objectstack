// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL Driver for ObjectStack
 *
 * Implements the standard IDataDriver from @objectstack/spec via Knex.js.
 * Supports PostgreSQL, MySQL, SQLite, and other SQL databases.
 */

import type { QueryAST, DriverOptions, SchemaMode } from '@objectstack/spec/data';
import { parseAutonumberFormat, renderAutonumber, missingFieldValues, type AutonumberToken } from '@objectstack/spec/data';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { StorageNameMapping } from '@objectstack/spec/system';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import {
  diffManagedTable,
  driftKey,
  type ManagedDriftEntry,
  type DriftOp,
  type SqlDialectName,
  type PhysicalColumn,
} from './schema-drift.js';
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

/**
 * Field types whose value is an array or object and must be stored as a JSON
 * column (and JSON-(de)serialized at the driver boundary). SINGLE SOURCE for
 * both the DDL column-type switch and `isJsonField` so the two can't drift —
 * the drift between them is exactly what let array-valued fields (multiselect/
 * checkboxes/tags/repeater/vector) reach the SQLite binder un-serialized and
 * crash with "SQLite3 can only bind numbers, strings, bigints, buffers, and
 * null" (#field-zoo). `image`/`file`/`avatar`/`video`/`audio` hold structured
 * upload metadata; `composite`/`address`/`location`/`record` are objects; the
 * rest are arrays.
 */
const JSON_COLUMN_TYPES = new Set<string>([
  'json', 'object', 'array', 'record',
  'image', 'file', 'avatar', 'video', 'audio',
  'location', 'address', 'composite',
  'multiselect', 'checkboxes', 'tags', 'repeater', 'vector',
]);

/**
 * Field types whose value is a numeric scalar. SINGLE SOURCE for the DDL
 * column-type switch (these map to INTEGER/REAL columns) and the read-side
 * coercion registry (`numericFields`).
 *
 * The read coercion exists so the fix is robust on SQLite even when the column
 * predates it: a `rating`/`slider`/`progress` column created before #2025 has
 * TEXT affinity and returns '4' not 4, and SQLite never alters a column's type
 * in-place (the reconciler only ADDS columns). Coercing numeric-looking strings
 * back to numbers on read transparently repairs those legacy rows — mirroring
 * how `dateFields` repairs legacy timestamp-typed `Field.date` rows — so the
 * type fidelity no longer depends on column affinity alone. `toggle`/`record`
 * already self-heal this way via `booleanFields`/`jsonFields`; this closes the
 * gap for the numeric scalars.
 */
const NUMERIC_SCALAR_TYPES = new Set<string>([
  'integer', 'int',
  'float', 'number', 'currency', 'percent', 'summary',
  'rating', 'slider', 'progress',
]);

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
export type SqlDriverConfig = Knex.Config & {
  schemaMode?: SchemaMode;
  /**
   * Dev-only schema auto-reconcile (issue #2186). When `'safe'`, `initObjects`
   * automatically applies *non-destructive* alters (relax NOT NULL, widen
   * varchar) so an existing database self-heals after a metadata change
   * loosens a constraint. `'off'` (default) only warns. Never applies
   * destructive DDL, and is force-disabled when `NODE_ENV==='production'`.
   */
  autoMigrate?: 'off' | 'safe';
};

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
      // Persistent, atomic autonumber sequences via `_objectstack_sequences`
      // (see fillAutoNumberFields / getNextSequenceValue). The engine defers
      // autonumber generation to this driver — it is the single source of truth.
      autonumber: true,

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
  protected numericFields: Record<string, string[]> = {};
  protected dateFields: Record<string, Set<string>> = {};
  protected datetimeFields: Record<string, Set<string>> = {};
  /**
   * Federation read path (ADR-0015). For external objects whose physical
   * remote table differs from the object name, these map between the two so
   * {@link getBuilder} targets the remote table while the coercion maps above
   * stay keyed by OBJECT name (matching formatInput/formatOutput). Empty for
   * managed objects, so the managed query path is unchanged.
   */
  protected physicalTableByObject: Record<string, string> = {};
  protected physicalSchemaByObject: Record<string, string> = {};
  protected objectByPhysicalTable: Record<string, string> = {};
  /** External columnMap (ADR-0015): logical field -> physical remote column (for WHERE/ORDER BY/writes). */
  protected fieldColumnByObject: Record<string, Record<string, string>> = {};
  /** External columnMap inverse: physical remote column -> logical field (for read output remap). */
  protected columnFieldByObject: Record<string, Record<string, string>> = {};
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
    Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }>
  > = {};

  /** Whether the sequences table has been ensured this process. */
  protected sequencesTableReady = false;
  /**
   * Whether `_objectstack_sequences` is the current `key_hash`-keyed shape.
   * Set on a fresh create or a successful in-place migration. If a legacy table
   * could NOT be migrated, this stays false: fixed-prefix sequences (empty
   * scope) keep working via the legacy `(object, tenant_id, field)` key, while a
   * per-scope write raises an actionable error rather than corrupting counters.
   */
  protected sequencesHasKeyHash = false;
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
  protected logger: {
    warn: (msg: string, meta?: any) => void;
    info?: (msg: string, meta?: any) => void;
  } = {
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

  /**
   * Dev-only auto-reconcile policy (issue #2186). See {@link SqlDriverConfig.autoMigrate}.
   */
  protected readonly autoMigrate: 'off' | 'safe';

  /**
   * Metadata field defs for every table this driver manages, captured during
   * `initObjects` (tableName → fields). The source of truth that
   * {@link detectManagedDrift} diffs the physical schema against.
   */
  protected managedObjectFields = new Map<string, Record<string, any>>();

  /** Declared indexes per managed table (tableName → indexes[]), captured in `initObjects`. Used to recreate indexes after a SQLite table rebuild. */
  protected managedObjectIndexes = new Map<string, any[]>();

  /** De-dup set for boot-time drift warnings (keyed by {@link driftKey}). */
  protected driftWarned = new Set<string>();

  constructor(config: SqlDriverConfig) {
    // `schemaMode` / `autoMigrate` are ObjectStack concerns, not Knex options —
    // strip them before handing the config to Knex.
    const { schemaMode, autoMigrate, ...knexConfig } = config;
    this.schemaMode = schemaMode ?? 'managed';
    this.autoMigrate = autoMigrate ?? 'off';
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

    // SQLite space hygiene (ADR-0057). With the default `auto_vacuum=NONE`,
    // freed pages are never returned to the OS — a database that briefly grew
    // (e.g. high-frequency telemetry before retention sweeps run) stays at its
    // high-water mark forever. INCREMENTAL lets a later `PRAGMA incremental_vacuum`
    // (run by the lifecycle Reaper, or manually) reclaim that space without a
    // full blocking VACUUM. NOTE: auto_vacuum only changes layout on a *fresh*
    // database or after a one-time full VACUUM, so this benefits new dev DBs;
    // existing files need a single `VACUUM` to adopt it. Harmless / no-op on
    // :memory: and on already-incremental databases.
    if (this.isSqlite) {
      try {
        await this.knex.raw('PRAGMA auto_vacuum = INCREMENTAL');
      } catch (e) {
        this.logger.warn('Failed to set PRAGMA auto_vacuum=INCREMENTAL', e);
      }
    }
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
    // Build everything EXCEPT the SELECT list, so the unknown-column retry
    // below can rebuild without re-deriving where/order/pagination.
    const buildBase = () => {
      const b = this.getBuilder(object, options);
      this.applyTenantScope(b, object, options);

      // WHERE
      if (query.where) {
        this.applyFilters(b, query.where);
      }

      // ORDER BY
      if (query.orderBy && Array.isArray(query.orderBy)) {
        for (const item of query.orderBy) {
          if (item.field) {
            b.orderBy(this.remoteColumn(object, item.field, this.mapSortField(item.field)), item.order || 'asc');
          }
        }
      }

      // PAGINATION
      if (query.offset !== undefined) b.offset(query.offset);
      if (query.limit !== undefined) b.limit(query.limit);

      return b;
    };

    const builder = buildBase();

    // SELECT
    if (query.fields) {
      builder.select((query.fields as string[]).map((f: string) => this.mapSortField(f)));
    } else {
      builder.select('*');
    }

    let results: any[];
    try {
      results = await builder;
    } catch (error: any) {
      const isUnknownColumn =
        error.message &&
        (error.message.includes('no such column') ||
          (error.message.includes('column') && error.message.includes('does not exist')));
      if (isUnknownColumn) {
        // A `$select` projection naming a column the table lacks (e.g. a
        // generic list view auto-requesting `status`/`due_date`/`image` on an
        // object without them) makes the WHOLE query fail. Swallowing that
        // into an empty result — the old behavior — reads to the UI as "no
        // records exist" even though rows are there: a silent data-loss
        // footgun. When the failure came from the projection, retry once
        // selecting all columns so the real rows still come back; the unknown
        // field is simply absent from each row (it never existed). The
        // engine's unknown-field filter is the first line of defense, but it
        // only fires when the object's schema is populated in the registry —
        // this driver backstop holds even when it isn't (notably the cloud
        // multi-tenant runtime, where the projection otherwise zeroes the list).
        if (query.fields) {
          try {
            results = await buildBase().select('*');
          } catch {
            return [];
          }
        } else {
          return [];
        }
      } else {
        throw error;
      }
    }

    if (!Array.isArray(results)) {
      return [];
    }

    // formatOutput is dialect-agnostic for `Field.date` (ADR-0053 Phase 1);
    // its json/boolean deserialisation stays SQLite-gated internally. Run it
    // for every dialect so reads match `findOne` and date columns come back
    // as `YYYY-MM-DD`.
    for (const row of results) {
      this.formatOutput(object, row);
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
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, toInsert));

    const result = await builder.insert(formatted).returning('*');
    return this.formatOutput(object, result[0]);
  }

  /**
   * Ensure the sequence-counter table exists. Idempotent and cheap after
   * the first call (cached via `sequencesTableReady`).
   *
   * The row key is `key_hash` — a SHA-256 of `(object, tenant_id, field, scope)`
   * where `scope` is the rendered autonumber prefix (date/field tokens before
   * the `{0000}` slot), so a new day/group/parent starts a fresh counter. A
   * single 64-char hashed primary key (rather than the four raw columns, which
   * blow past MySQL's 3072-byte index limit under utf8mb4 and bound how long a
   * `{field}` scope may be) keys every dialect uniformly and lets `scope` be a
   * generous non-indexed column. Fixed-prefix formats use the empty scope and
   * keep their single global counter (backward compatible).
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
          await this.createSequencesTable(SEQUENCES_TABLE);
          this.sequencesHasKeyHash = true;
        } catch (err: any) {
          // Race or cross-process create — re-check existence; ignore
          // "already exists" errors from any dialect.
          const stillMissing = !(await this.knex.schema.hasTable(SEQUENCES_TABLE));
          if (stillMissing) throw err;
          // A racing creator may have used an older schema. Migrate in place.
          await this.ensureSequencesKeyHashShape();
        }
      } else {
        // Pre-existing table may predate the `key_hash`/`scope` shape. Migrate.
        await this.ensureSequencesKeyHashShape();
      }
      this.sequencesTableReady = true;
    })();
    try {
      await this.sequencesTableEnsurePromise;
    } finally {
      this.sequencesTableEnsurePromise = null;
    }
  }

  /** SHA-256 of the composite counter key — the table's single-column PK. */
  protected sequenceKeyHash(object: string, tenantId: string, field: string, scope: string): string {
    return createHash('sha256')
      .update(`${object}\u001f${tenantId}\u001f${field}\u001f${scope}`)
      .digest('hex');
  }

  /** Create the current `key_hash`-keyed sequences table shape. */
  protected async createSequencesTable(table: string): Promise<void> {
    await this.knex.schema.createTable(table, (t) => {
      t.string('key_hash', 64).notNullable().primary();
      t.string('object').notNullable();
      t.string('tenant_id').notNullable();
      t.string('field').notNullable();
      // Non-indexed, so it is free of the PK length limit — a long `{plan_no}`
      // composite scope fits. 1024 is far above any realistic rendered prefix.
      t.string('scope', 1024).notNullable().defaultTo('');
      t.bigInteger('last_value').notNullable().defaultTo(0);
      t.timestamp('updated_at').defaultTo(this.knex.fn.now());
    });
  }

  /**
   * Migrate a pre-existing `_objectstack_sequences` table to the current
   * `key_hash`-keyed shape. Handles both the original 3-column table (no
   * `scope`) and an interim 4-column `(object, tenant_id, field, scope)` table:
   * every legacy row is read, its `key_hash` computed in app code (no portable
   * SQL hash exists), and re-inserted into a freshly built table that then
   * replaces the original. Idempotent — a no-op once `key_hash` is present.
   *
   * If the rebuild fails, `sequencesHasKeyHash` stays false: fixed-prefix
   * sequences keep working via the legacy key and per-scope writes error
   * actionably (see getNextSequenceValue), rather than corrupting data.
   */
  protected async ensureSequencesKeyHashShape(): Promise<void> {
    if (await this.knex.schema.hasColumn(SEQUENCES_TABLE, 'key_hash')) {
      this.sequencesHasKeyHash = true;
      return;
    }
    const hasScope = await this.knex.schema.hasColumn(SEQUENCES_TABLE, 'scope');
    const TMP = `${SEQUENCES_TABLE}__rebuild`;
    try {
      const rows: any[] = await this.knex(SEQUENCES_TABLE).select('*');
      await this.knex.schema.dropTableIfExists(TMP);
      await this.createSequencesTable(TMP);
      const migrated = rows.map((r) => {
        const scope = hasScope && r.scope != null ? String(r.scope) : '';
        return {
          key_hash: this.sequenceKeyHash(String(r.object), String(r.tenant_id), String(r.field), scope),
          object: r.object,
          tenant_id: r.tenant_id,
          field: r.field,
          scope,
          last_value: r.last_value ?? 0,
          updated_at: r.updated_at ?? this.knex.fn.now(),
        };
      });
      if (migrated.length > 0) await this.knex(TMP).insert(migrated);
      await this.knex.schema.dropTable(SEQUENCES_TABLE);
      await this.knex.schema.renameTable(TMP, SEQUENCES_TABLE);
      this.sequencesHasKeyHash = true;
    } catch (err) {
      // Leave the original table intact; fall back to legacy keying for
      // fixed-prefix sequences and refuse per-scope writes until migrated.
      this.sequencesHasKeyHash = false;
      await this.knex.schema.dropTableIfExists(TMP).catch(() => {});
      this.logger.warn(
        `[autonumber] Failed to migrate ${SEQUENCES_TABLE} to the key_hash shape. ` +
          `Fixed-prefix autonumbers keep working; date/{field}/per-parent formats will ` +
          `error until the table is migrated.`,
        { error: String(err) },
      );
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
    scope = '',
  ): Promise<number> {
    await this.ensureSequencesTable();
    const resolvedTenantId = tenantField && tenantId ? String(tenantId) : GLOBAL_TENANT;
    if (scope !== '' && !this.sequencesHasKeyHash) {
      // The legacy sequences table could not be migrated to the key_hash shape,
      // so it cannot represent per-scope counters. Fail with a clear, actionable
      // message instead of corrupting the single legacy counter.
      throw new Error(
        `Cannot generate a per-scope autonumber for "${object}.${field}": the ` +
          `${SEQUENCES_TABLE} table is still the legacy shape. ` +
          `Migrate it to the key_hash shape before using date/{field}/per-parent formats.`,
      );
    }
    // `scope` (rendered date/field prefix, boundary-delimited) gives each
    // period/group its own counter; '' keeps the single global counter for
    // fixed-prefix formats. `prefix` is the full rendered prefix used to
    // bootstrap from existing data. The row is keyed by a hash of the composite;
    // on an un-migrated legacy table only fixed-prefix (scope '') reaches here,
    // so fall back to the original `(object, tenant_id, field)` key for it.
    const key = this.sequencesHasKeyHash
      ? { key_hash: this.sequenceKeyHash(tableName, resolvedTenantId, field, scope) }
      : { object: tableName, tenant_id: resolvedTenantId, field };
    const insertRow = this.sequencesHasKeyHash
      ? { ...key, object: tableName, tenant_id: resolvedTenantId, field, scope }
      : { ...key };

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
          await trx(SEQUENCES_TABLE).insert({ ...insertRow, last_value: initial });
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
   * For each `auto_number` field the caller left empty, render the format and
   * reserve the next counter value. The counter is scoped to the rendered
   * prefix (date tokens like `{YYYYMMDD}` in the request's business timezone,
   * plus `{field}` interpolation from the row), so it resets per period/group;
   * the full rendered prefix bootstraps the counter from existing data, and the
   * tenant scopes it for isolation.
   */
  protected async fillAutoNumberFields(
    object: string,
    row: Record<string, any>,
    options?: DriverOptions,
  ): Promise<void> {
    // Scan/seed the physical (remote) table for an external object; managed
    // objects fall through to the storage-mapped name. Config lookup stays
    // keyed by object name (matching initObjects/registerExternalObject).
    const tableName = this.physicalTableByObject[object] ?? StorageNameMapping.resolveTableName({ name: object } as any);
    const cfgs = this.autoNumberFields[object] || this.autoNumberFields[tableName];
    if (!cfgs || cfgs.length === 0) return;
    const parentTrx = options?.transaction as Knex.Transaction | undefined;
    const timezone = (options as any)?.timezone as string | undefined;
    const now = new Date();
    for (const cfg of cfgs) {
      if (row[cfg.name] !== undefined && row[cfg.name] !== null && row[cfg.name] !== '') continue;
      // A `{field}` token with no value would render to an empty prefix and
      // silently merge this record into the wrong counter scope, so refuse to
      // generate rather than emit a wrong record number (the referenced field
      // must be populated before the autonumber — see field.zod docs).
      const missing = missingFieldValues(cfg.tokens, row);
      if (missing.length > 0) {
        throw new Error(
          `Cannot generate autonumber "${object}.${cfg.name}" (format "${cfg.format}"): ` +
            `referenced field(s) [${missing.join(', ')}] are empty on the record. ` +
            `Fields interpolated into an autonumber format must be set before the record is created.`,
        );
      }
      // Resolve tenant for this row: explicit field on the record wins,
      // then driver options, else null → global sequence.
      const rowTenant = cfg.tenantField ? row[cfg.tenantField] : undefined;
      const optTenant = (options as any)?.tenantId;
      const tenantId = rowTenant != null && rowTenant !== ''
        ? String(rowTenant)
        : optTenant != null && optTenant !== ''
          ? String(optTenant)
          : null;
      // Resolve the scope/prefix for this row (counter-value-independent),
      // reserve the next value under that scope, then render the final string.
      const probe = renderAutonumber({ tokens: cfg.tokens, seq: 0, record: row, now, timezone });
      const next = await this.getNextSequenceValue(
        object,
        tableName,
        cfg.name,
        probe.prefix,
        cfg.tenantField,
        tenantId,
        parentTrx,
        probe.scope,
      );
      row[cfg.name] = renderAutonumber({ tokens: cfg.tokens, seq: next, record: row, now, timezone }).value;
    }
  }

  async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    this.auditMissingTenant(object, 'update', options);
    const builder = this.getBuilder(object, options).where('id', id);
    this.applyTenantScope(builder, object, options);
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data));

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

    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, toUpsert));
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
      if (row && typeof row === 'object') {
        this.injectTenantOnInsert(object, row, options);
        // Reserve a persistent sequence value for each row's autonumber
        // field(s) — the engine no longer pre-fills these (see #1603).
        await this.fillAutoNumberFields(object, row, options);
      }
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
   * Resolve the per-table tenant-isolation column for a schema, honoring an
   * explicit tenancy opt-out. Single source of truth for both {@link initObjects}
   * and {@link registerExternalObject} (they previously inlined this logic and
   * drifted).
   *
   * Precedence:
   *  1. `tenancy.enabled === false` → `null` (NO driver-level org scope), even
   *     when the object carries an `organization_id` column. Platform-global
   *     objects (e.g. `sys_license`) keep an optional, often-NULL org FK but must
   *     NOT be tenant-scoped: otherwise an authenticated caller's active-org
   *     `DriverOptions.tenantId` injects `WHERE organization_id = <org>` and every
   *     NULL-org / cross-org row silently disappears (the platform admin then
   *     reads zero licenses while an unscoped/anonymous read still sees them).
   *     The declarative branch below already respected `enabled !== false`; the
   *     implicit `organization_id` fallback did not — this closes that gap.
   *  2. Declared `tenancy.tenantField` (when that field exists on the object).
   *  3. Implicit `organization_id` column detection (legacy objects whose
   *     multi-tenant column was injected by the kernel without a spec migration).
   */
  protected computeTenantField(schema: { fields?: Record<string, any>; tenancy?: any }): string | null {
    const tenancyDecl = (schema as any)?.tenancy;
    // Explicit opt-out wins over any column-presence heuristic.
    if (tenancyDecl?.enabled === false) return null;
    const fields = schema?.fields;
    if (tenancyDecl?.tenantField) {
      const declared = String(tenancyDecl.tenantField);
      if (fields && Object.prototype.hasOwnProperty.call(fields, declared)) return declared;
    }
    if (fields && Object.prototype.hasOwnProperty.call(fields, 'organization_id')) return 'organization_id';
    return null;
  }

  /**
   * Batch-initialise tables from an array of object definitions.
   */
  /**
   * DDL-free metadata registration for a federated (external) object — the
   * read-path counterpart to {@link initObjects} (ADR-0015 federation).
   *
   * `initObjects` is gated by `assertSchemaMutable` and therefore throws for
   * any non-`managed` driver, which left external objects with NO read-coercion
   * metadata and the query path resolving to a table named after the object
   * instead of its remote table. This populates the same coercion maps (keyed
   * by OBJECT name, matching formatInput/formatOutput/coerceFilterValue) and
   * records the physical remote table (`external.remoteName`, optionally
   * `external.remoteSchema`) so {@link getBuilder} targets it — WITHOUT running
   * any DDL (createTable/alterTable/columnInfo). Keep the field-classification
   * below in sync with initObjects() if the field-type -> storage mapping changes.
   */
  registerExternalObject(schema: {
    name: string;
    fields?: Record<string, any>;
    tenancy?: any;
    external?: { remoteName?: string; remoteSchema?: string; columnMap?: Record<string, string> };
  }): void {
    const key = schema.name;
    const remoteName = schema.external?.remoteName || schema.name;
    const remoteSchema = schema.external?.remoteSchema;
    this.physicalTableByObject[key] = remoteName;
    this.objectByPhysicalTable[remoteName] = key;
    if (remoteSchema) {
      if (this.isSqlite) {
        this.logger.warn(
          `[sql-driver] external object "${key}" declares remoteSchema="${remoteSchema}" but SQLite has no schema namespace; ignoring (treating "${remoteName}" as a bare table).`,
        );
      } else {
        this.physicalSchemaByObject[key] = remoteSchema;
      }
    }

    // External columnMap (ADR-0015) is declared as { remoteColumn -> localField }.
    // Keep it for read-output remap, and invert to { localField -> remoteColumn }
    // for WHERE/ORDER BY/write translation. Absent => managed-identical behavior.
    const columnMap = schema.external?.columnMap;
    if (columnMap && typeof columnMap === 'object' && Object.keys(columnMap).length > 0) {
      const fieldToCol: Record<string, string> = {};
      const colToField: Record<string, string> = {};
      for (const [remoteCol, localField] of Object.entries(columnMap)) {
        if (typeof localField === 'string' && localField) {
          fieldToCol[localField] = remoteCol;
          colToField[remoteCol] = localField;
        }
      }
      this.fieldColumnByObject[key] = fieldToCol;
      this.columnFieldByObject[key] = colToField;
    }

    const jsonCols: string[] = [];
    const booleanCols: string[] = [];
    const numericCols: string[] = [];
    const dateCols: string[] = [];
    const datetimeCols: string[] = [];
    const autoNumberCols: Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }> = [];

    const tenantField = this.computeTenantField(schema);
    if (schema.fields) {
      for (const [name, field] of Object.entries<any>(schema.fields)) {
        const type = field.type || 'string';
        if (this.isJsonField(type, field)) jsonCols.push(name);
        if (type === 'boolean' || type === 'toggle') booleanCols.push(name);
        if (NUMERIC_SCALAR_TYPES.has(type) && !field.multiple) numericCols.push(name);
        if (type === 'date') dateCols.push(name);
        if (type === 'datetime') datetimeCols.push(name);
        if (type === 'auto_number' || type === 'autonumber') {
          const rawFmt = (typeof field.autonumberFormat === 'string' && field.autonumberFormat)
            ? field.autonumberFormat
            : (typeof field.format === 'string' && field.format ? field.format : '');
          const fmt = rawFmt || '{0000}';
          autoNumberCols.push({ name, format: fmt, tokens: parseAutonumberFormat(fmt), tenantField });
        }
      }
    }
    this.jsonFields[key] = jsonCols;
    this.booleanFields[key] = booleanCols;
    this.numericFields[key] = numericCols;
    this.autoNumberFields[key] = autoNumberCols;
    this.tenantFieldByTable[key] = tenantField;
    if (dateCols.length) this.dateFields[key] = new Set(dateCols);
    if (datetimeCols.length) this.datetimeFields[key] = new Set(datetimeCols);
  }

  async initObjects(objects: Array<{ name: string; fields?: Record<string, any> }>): Promise<void> {
    // DDL gate (ADR-0015 §5.1): createTable/alterTable below mutate schema.
    // Also covers `syncSchema`, which delegates here.
    this.assertSchemaMutable('initObjects');
    await this.ensureDatabaseExists();

    for (const obj of objects) {
      const tableName = StorageNameMapping.resolveTableName(obj);
      // #2186: remember the authoritative metadata field set for this table so
      // drift detection / `os migrate` can diff the physical schema against it.
      this.managedObjectFields.set(tableName, obj.fields ?? {});
      if (Array.isArray((obj as any).indexes)) {
        this.managedObjectIndexes.set(tableName, (obj as any).indexes);
      }

      const jsonCols: string[] = [];
      const booleanCols: string[] = [];
      const numericCols: string[] = [];
      const autoNumberCols: Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }> = [];
      // Tenant-isolation column: explicit tenancy opt-out → declared field →
      // implicit `organization_id`. See {@link computeTenantField} (shared with
      // registerExternalObject so the two paths can't drift).
      const tenantField = this.computeTenantField(obj);
      if (obj.fields) {
        for (const [name, field] of Object.entries<any>(obj.fields)) {
          const type = field.type || 'string';
          if (this.isJsonField(type, field)) {
            jsonCols.push(name);
          }
          // `toggle` shares boolean storage/affinity, so it needs the same
          // read coercion (stored 1/0 → JS true/false) or it leaks back as a
          // number/string instead of a boolean (#field-zoo).
          if (type === 'boolean' || type === 'toggle') {
            booleanCols.push(name);
          }
          // Numeric scalars are coerced back to JS numbers on read so legacy
          // TEXT-affinity columns (created before they were mapped to a numeric
          // column) still return numbers, not strings — see NUMERIC_SCALAR_TYPES.
          if (NUMERIC_SCALAR_TYPES.has(type) && !field.multiple) {
            numericCols.push(name);
          }
          if (type === 'date') {
            (this.dateFields[tableName] ??= new Set()).add(name);
          }
          if (type === 'datetime') {
            (this.datetimeFields[tableName] ??= new Set()).add(name);
          }
          if (type === 'auto_number' || type === 'autonumber') {
            // Honor either the spec-canonical `autonumberFormat` or the
            // shorthand `format` (both appear in metadata) — see #1603.
            const rawFmt = (typeof field.autonumberFormat === 'string' && field.autonumberFormat)
              ? field.autonumberFormat
              : (typeof field.format === 'string' && field.format ? field.format : '');
            const fmt = rawFmt || '{0000}';
            // Tokenize once: the renderer resolves date tokens (`{YYYYMMDD}`),
            // field interpolation (`{island_zone}`) and the sequence slot at
            // fill time. The counter scopes to whatever renders before the slot.
            const tokens = parseAutonumberFormat(fmt);
            autoNumberCols.push({ name, format: fmt, tokens, tenantField });
          }
        }
      }
      this.jsonFields[tableName] = jsonCols;
      this.booleanFields[tableName] = booleanCols;
      this.numericFields[tableName] = numericCols;
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

      // #2186: the additive sync above only ever ADDs tables/columns. For a
      // table that already existed, detect (and in dev, auto-reconcile) any
      // non-additive divergence (relaxed NOT NULL, widened varchar, orphaned
      // column) between metadata and the physical schema.
      if (exists) {
        await this.reconcileAndWarnDrift(tableName, obj.fields ?? {});
      }
    }
  }

  // ── Managed-schema drift & reconcile (#2186) ───────────────────────────────

  /** Canonical dialect name for the drift differ. */
  protected get dialectName(): SqlDialectName {
    if (this.isSqlite) return 'sqlite';
    if (this.isPostgres) return 'postgres';
    if (this.isMysql) return 'mysql';
    return 'unknown';
  }

  /** True only when running under `NODE_ENV=production` — auto-DDL is force-disabled there. */
  protected isProductionEnv(): boolean {
    try {
      return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    } catch {
      return false;
    }
  }

  /** Diff one table's metadata fields against its physical columns. */
  protected async detectTableDrift(
    tableName: string,
    fields: Record<string, any>,
  ): Promise<ManagedDriftEntry[]> {
    const cols = await this.introspectColumns(tableName);
    const physical: PhysicalColumn[] = cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      maxLength: c.maxLength,
    }));
    return diffManagedTable({ table: tableName, fields, columns: physical, dialect: this.dialectName });
  }

  /**
   * Detect every managed-schema divergence between metadata and the physical
   * database. Metadata is the source of truth. Returns one entry per drift,
   * sorted by table then column. Used by `os migrate` (P3) and tests.
   *
   * @param objects optional explicit object list; defaults to whatever
   *   `initObjects` last synced (captured in {@link managedObjectFields}).
   */
  async detectManagedDrift(
    objects?: Array<{ name: string; fields?: Record<string, any> }>,
  ): Promise<ManagedDriftEntry[]> {
    const tables = new Map<string, Record<string, any>>();
    if (objects) {
      for (const o of objects) tables.set(StorageNameMapping.resolveTableName(o), o.fields ?? {});
    } else {
      for (const [t, f] of this.managedObjectFields) tables.set(t, f);
    }

    const out: ManagedDriftEntry[] = [];
    for (const [tableName, fields] of tables) {
      if (!(await this.knex.schema.hasTable(tableName))) continue;
      out.push(...(await this.detectTableDrift(tableName, fields)));
    }
    out.sort((a, b) => (a.table === b.table ? (a.column ?? '').localeCompare(b.column ?? '') : a.table.localeCompare(b.table)));
    return out;
  }

  /**
   * Boot-time per-table drift handling (P1 + P2): detect divergence, in dev
   * auto-reconcile the *safe* (loosening) subset when `autoMigrate==='safe'`,
   * then WARN once per remaining divergence with an actionable hint.
   */
  protected async reconcileAndWarnDrift(tableName: string, fields: Record<string, any>): Promise<void> {
    let drift: ManagedDriftEntry[];
    try {
      drift = await this.detectTableDrift(tableName, fields);
    } catch (e: any) {
      this.logger.warn(`[schema-drift] could not introspect '${tableName}' for drift detection`, e?.message ?? e);
      return;
    }
    if (drift.length === 0) return;

    const autoOn = this.autoMigrate === 'safe' && this.schemaMode === 'managed';
    if (autoOn && this.isProductionEnv()) {
      this.logger.warn(
        `[schema-drift] autoMigrate='safe' is ignored under NODE_ENV=production — schema is never auto-altered in production. Run 'os migrate' deliberately.`,
      );
    } else if (autoOn) {
      const safe = drift.filter((d) => d.category === 'safe');
      if (safe.length > 0) {
        try {
          const { applied } = await this.applyMigrationEntries(safe, { allowDestructive: false });
          for (const d of applied) {
            (this.logger.info ?? this.logger.warn)(`[schema-drift] auto-reconciled ${d.op.type} on ${d.table}.${d.column}`);
          }
          // Re-detect so the warnings below reflect the post-reconcile state.
          drift = await this.detectTableDrift(tableName, fields);
        } catch (e: any) {
          this.logger.warn(`[schema-drift] dev auto-reconcile failed for '${tableName}' — falling back to warning`, e?.message ?? e);
        }
      }
    }

    for (const d of drift) {
      const k = driftKey(d);
      if (this.driftWarned.has(k)) continue;
      this.driftWarned.add(k);
      this.logger.warn(`[schema-drift] ${d.message}`);
    }
  }

  /**
   * Apply a set of drift entries to the physical schema. Destructive entries
   * are skipped unless `allowDestructive` is set. Postgres/MySQL alter columns
   * in place; SQLite (which cannot alter constraints in place) rebuilds each
   * affected table (copy → swap) applying only the requested edits.
   *
   * @returns the entries actually applied and those skipped (e.g. destructive
   *   without `allowDestructive`, or unsupported on the dialect).
   */
  async applyMigrationEntries(
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean } = {},
  ): Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }> {
    this.assertSchemaMutable('reconcileManagedSchema');
    const allowDestructive = opts.allowDestructive === true;

    const applied: ManagedDriftEntry[] = [];
    const skipped: ManagedDriftEntry[] = [];

    const candidates = entries.filter((d) => {
      if (d.category === 'destructive' && !allowDestructive) {
        skipped.push(d);
        return false;
      }
      return true;
    });
    if (candidates.length === 0) return { applied, skipped };

    // Group by table — SQLite reconciles a whole table in one rebuild.
    const byTable = new Map<string, ManagedDriftEntry[]>();
    for (const d of candidates) {
      (byTable.get(d.table) ?? byTable.set(d.table, []).get(d.table)!).push(d);
    }

    for (const [table, ents] of byTable) {
      try {
        if (this.isSqlite) {
          await this.rebuildSqliteTablePatched(table, ents);
          applied.push(...ents);
        } else {
          for (const d of ents) {
            const ok = await this.applyDriftOpInPlace(d.op);
            (ok ? applied : skipped).push(d);
          }
        }
      } catch (e: any) {
        this.logger.warn(`[schema-drift] failed to reconcile '${table}'`, e?.message ?? e);
        for (const d of ents) if (!applied.includes(d)) skipped.push(d);
      }
    }
    return { applied, skipped };
  }

  /** Apply a single drift op in place (Postgres / MySQL). Returns false if unsupported. */
  protected async applyDriftOpInPlace(op: DriftOp): Promise<boolean> {
    const { table, column } = op;
    if (this.isPostgres) {
      switch (op.type) {
        case 'relax_not_null':
          await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL', [table, column]);
          return true;
        case 'tighten_not_null':
          await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL', [table, column]);
          return true;
        case 'widen_varchar':
        case 'narrow_varchar':
          await this.knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? TYPE varchar(${op.to})`, [table, column]);
          return true;
        case 'drop_column':
          await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [table, column]);
          return true;
      }
    }
    if (this.isMysql) {
      // MySQL MODIFY restates the FULL column definition — reconstruct the
      // type (with length for char types, so a nullability change never
      // silently drops a varchar's declared length) from columnInfo.
      const info: any = await this.knex(table).columnInfo();
      const ci: any = info?.[column];
      const colType: string | undefined = ci?.type
        ? (/char/i.test(ci.type) && ci.maxLength ? `${ci.type}(${ci.maxLength})` : ci.type)
        : undefined;
      switch (op.type) {
        case 'relax_not_null':
          if (!colType) return false;
          await this.knex.raw(`ALTER TABLE ?? MODIFY ?? ${colType} NULL`, [table, column]);
          return true;
        case 'tighten_not_null':
          if (!colType) return false;
          await this.knex.raw(`ALTER TABLE ?? MODIFY ?? ${colType} NOT NULL`, [table, column]);
          return true;
        case 'widen_varchar':
        case 'narrow_varchar':
          await this.knex.raw(`ALTER TABLE ?? MODIFY ?? varchar(${op.to})`, [table, column]);
          return true;
        case 'drop_column':
          await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [table, column]);
          return true;
      }
    }
    this.logger.warn(`[schema-drift] ${op.type} on ${table}.${column} is unsupported on dialect '${this.dialectName}' — skipped`);
    return false;
  }

  /**
   * Rebuild a SQLite table applying a set of column edits (relax/tighten NOT
   * NULL, drop column), preserving all other columns and their data. Follows
   * the official SQLite procedure: create patched table → copy → drop → rename.
   * varchar widen/narrow are no-ops on SQLite (dynamic typing) and ignored.
   *
   * Unique field-level constraints and declared indexes are recreated from
   * metadata afterwards (the source of truth). DB-level foreign keys declared
   * by `lookup` fields are not re-added (ObjectStack enforces relationships at
   * the application layer, not via SQLite FK constraints).
   */
  protected async rebuildSqliteTablePatched(table: string, ents: ManagedDriftEntry[]): Promise<void> {
    const relax = new Set<string>();
    const tighten = new Set<string>();
    const drop = new Set<string>();
    for (const e of ents) {
      if (e.op.type === 'relax_not_null') relax.add(e.op.column);
      else if (e.op.type === 'tighten_not_null') tighten.add(e.op.column);
      else if (e.op.type === 'drop_column') drop.add(e.op.column);
      // widen/narrow varchar: SQLite ignores declared length — nothing to do.
    }

    const physical = await this.introspectColumns(table);
    const kept = physical.filter((c) => !drop.has(c.name));
    const keptNames = kept.map((c) => c.name);
    const fields = this.managedObjectFields.get(table) ?? {};
    const tmp = `__os_mig_${table}`;

    // FK enforcement must be toggled OUTSIDE the transaction (SQLite ignores
    // the PRAGMA inside one). Off during the swap so the rename doesn't trip
    // any dangling references mid-flight.
    await this.knex.raw('PRAGMA foreign_keys = OFF');
    try {
      await this.knex.transaction(async (trx) => {
        await trx.schema.dropTableIfExists(tmp);
        await trx.schema.createTable(tmp, (t) => {
          for (const c of kept) {
            const col = this.buildRebuiltColumn(t, c);
            if (!col) continue;
            const nullable = relax.has(c.name) ? true : tighten.has(c.name) ? false : c.nullable;
            if (!nullable && c.name !== 'id') col.notNullable();
            if (c.name === 'created_at' || c.name === 'updated_at') col.defaultTo(this.knex.fn.now());
          }
        });
        const colList = keptNames.map((n) => `"${n}"`).join(', ');
        await trx.raw(`INSERT INTO "${tmp}" (${colList}) SELECT ${colList} FROM "${table}"`);
        await trx.schema.dropTable(table);
        await trx.schema.renameTable(tmp, table);
      });
    } finally {
      await this.knex.raw('PRAGMA foreign_keys = ON');
    }

    // Recreate unique constraints + declared indexes from metadata.
    try {
      const keptSet = new Set(keptNames);
      for (const [name, field] of Object.entries<any>(fields)) {
        if (field?.unique && keptSet.has(name)) {
          const idx = `uniq_${table}_${name}`;
          await this.knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS ?? ON ?? (??)', [idx, table, name]);
        }
      }
      const declared = this.managedObjectIndexes.get(table);
      if (Array.isArray(declared) && declared.length > 0) {
        await this.syncDeclaredIndexes(table, declared, keptSet);
      }
    } catch (e: any) {
      this.logger.warn(`[schema-drift] could not fully recreate indexes for '${table}' after rebuild`, e?.message ?? e);
    }
  }

  /** Map an introspected SQLite column to a knex builder for the rebuilt table. */
  protected buildRebuiltColumn(t: Knex.CreateTableBuilder, c: IntrospectedColumn): any {
    if (c.name === 'id') return t.string('id').primary();
    const ty = (c.type || 'text').toLowerCase();
    if (ty.includes('int')) return t.integer(c.name);
    if (/(real|floa|doub|num|dec)/.test(ty)) return t.float(c.name);
    if (ty.includes('bool')) return t.boolean(c.name);
    if (ty.includes('datetime') || ty.includes('timestamp')) return t.timestamp(c.name);
    if (ty === 'date') return t.date(c.name);
    if (ty === 'time') return t.time(c.name);
    if (ty.includes('json')) return t.json(c.name);
    if (ty.includes('blob') || ty.includes('binary')) return t.binary(c.name);
    if (ty.includes('text')) return t.text(c.name);
    return t.string(c.name);
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
    // Federation (ADR-0015): an external object resolves to its remote table
    // (`external.remoteName`, optionally schema-qualified). Managed objects miss
    // both maps, so this is `this.knex(object)` — unchanged. `.withSchema()` is
    // applied on the builder (not via `knex.withSchema().from()`) so the builder
    // type is identical to the managed path for every downstream caller.
    const physical = this.physicalTableByObject[object] ?? object;
    let builder = this.knex(physical);
    const remoteSchema = this.physicalSchemaByObject[object];
    if (remoteSchema) {
      builder = builder.withSchema(remoteSchema);
    }
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
   * Whether the host kernel runs in multi-tenant mode — read once from
   * `OS_MULTI_ORG_ENABLED` (or the deprecated `OS_MULTI_TENANT`), matching how
   * the SchemaRegistry / SecurityPlugin pick the mode. Used to gate the
   * tenant-audit warning: it's only meaningful where tenant isolation is
   * actually enforced (org-scoping installed).
   */
  private _multiTenantMode?: boolean;
  protected isMultiTenantMode(): boolean {
    if (this._multiTenantMode === undefined) {
      const raw =
        process.env.OS_MULTI_ORG_ENABLED ?? process.env.OS_MULTI_TENANT ?? 'false';
      this._multiTenantMode = String(raw).toLowerCase() !== 'false';
    }
    return this._multiTenantMode;
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
    // Only meaningful in multi-tenant deployments. Single-tenant stacks have no
    // tenant isolation, yet the kernel now ALWAYS provisions an `organization_id`
    // column (its existence is decoupled from the tenant flag). Column presence
    // alone therefore no longer implies "tenant-scoped" — without this gate every
    // system/sudo write (e.g. the notification/http delivery dispatchers' claim
    // updates) would spam a meaningless warning on single-tenant boots.
    if (!this.isMultiTenantMode()) return;
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
   * Coercion-map key for a builder. Coercion maps (date/datetime) are keyed by
   * OBJECT name, but after the federation change {@link getBuilder} targets the
   * physical remote table, so a builder reports the remote name. Map it back to
   * the object name for external objects; identity for managed ones (no reverse
   * entry). Note datetime coercion is a SQLite-only concern (see
   * coerceFilterValue), and SQLite external tables are bare-named, so this is
   * exact where it matters.
   */
  protected coercionKey(builder: any): string | null {
    const physical = this.tableNameForBuilder(builder);
    if (physical == null) return null;
    return this.objectByPhysicalTable[physical] ?? physical;
  }

  /**
   * Collapse a `Field.date` value to a timezone-naive `YYYY-MM-DD`
   * calendar-day string (ADR-0053 Phase 1). A `Date` collapses to its UTC
   * calendar day; a string keeps its leading date and drops any time
   * component. Anything else (and `null`/`undefined`) passes through
   * unchanged. This is the single source of truth for date-only truncation,
   * shared by the filter (`coerceFilterValue`), write (`formatInput`) and
   * read (`formatOutput`) paths so all three agree on what a date *is*.
   */
  protected toDateOnly(value: any): any {
    if (value == null) return value;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return value;
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
      // Only SQLite stores `Field.datetime` as an INTEGER epoch (better-sqlite3
      // binds a JS `Date` as `.getTime()`); there the ISO/text comparand MUST be
      // coerced to epoch ms or it collapses to a TEXT-vs-INTEGER affinity compare
      // that never matches. Postgres/MySQL map datetime to a native TIMESTAMP
      // (see `defineColumn` → `table.timestamp`), where Knex binds an ISO string
      // or `Date` correctly — coercing to an epoch integer there would compare an
      // INTEGER against a TIMESTAMP and break the query. So gate on dialect.
      if (!this.isSqlite) return value;
      const ms = toMs(value);
      return ms == null ? value : ms;
    }

    // Field.date — normalise the comparand to YYYY-MM-DD (ADR-0053 Phase 1).
    return this.toDateOnly(value);
  }

  /**
   * Public, dialect-correct temporal filter-value coercion for callers that
   * build SQL *outside* the normal `find()`/`applyFilters()` path — chiefly the
   * analytics native-SQL strategy, which compiles a raw `SELECT … WHERE col >= $N`
   * and binds the value directly, bypassing `coerceFilterValue`.
   *
   * Given a logical object (table) name, a field name and a filter value
   * (typically an ISO date/datetime string from a dashboard relative-date
   * token like `{12_months_ago}`), this returns the value in the column's
   * on-disk storage form:
   *   - SQLite `Field.datetime` → epoch milliseconds (INTEGER), so the
   *     comparison matches the stored integer rather than failing a
   *     TEXT-vs-INTEGER affinity compare.
   *   - `Field.date` (any dialect)   → `YYYY-MM-DD` text.
   *   - Native-timestamp dialects / non-temporal fields → value unchanged.
   *
   * This is a thin, intentionally narrow wrapper over the same `coerceFilterValue`
   * the driver already uses, so there is exactly one source of truth for the
   * storage convention and the analytics path can never drift from CRUD.
   */
  public temporalFilterValue(objectName: string, field: string, value: any): any {
    return this.coerceFilterValue(objectName, field, value);
  }

  protected applyFilters(builder: Knex.QueryBuilder, filters: any) {
    if (!filters) return;
    const table = this.coercionKey(builder);

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
        builder.where(this.remoteColumn(table, key, key), this.coerceFilterValue(table, key, value) as any);
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
          const localField = this.mapSortField(fieldRaw);
          const field = this.remoteColumn(table, fieldRaw, localField);
          const coerced = this.coerceFilterValue(table, localField, value);
          const apply = (b: any) => {
            const method = nextJoin === 'or' ? 'orWhere' : 'where';
            const methodIn = nextJoin === 'or' ? 'orWhereIn' : 'whereIn';
            const methodNotIn = nextJoin === 'or' ? 'orWhereNotIn' : 'whereNotIn';

            if (op === 'contains') {
              this.applyContainsLike(b, method, field, value);
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

  /**
   * Apply a `contains` substring match as a parameterized `LIKE '%…%'`, escaping
   * the LIKE metacharacters `%` / `_` (and the escape char `\`) in the user value
   * so they match literally instead of acting as wildcards — otherwise a value of
   * `%` matches every row (a filter-bypass, P0). Binds an explicit `ESCAPE '\'`
   * because SQLite does not honour a default escape character (MySQL/Postgres do,
   * but the explicit clause is correct for all three).
   */
  private applyContainsLike(builder: any, method: string, field: string, value: unknown): void {
    const escaped = String(value).replace(/[\\%_]/g, '\\$&');
    const rawMethod = method.startsWith('or') ? 'orWhereRaw' : 'whereRaw';
    builder[rawMethod]('?? LIKE ? ESCAPE ?', [field, `%${escaped}%`, '\\']);
  }

  protected applyFilterCondition(builder: Knex.QueryBuilder, condition: any, logicalOp: 'and' | 'or' = 'and', tableHint?: string | null) {
    if (!condition || typeof condition !== 'object') return;
    const table = tableHint ?? this.coercionKey(builder);

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
        const localField = this.mapSortField(key);
        const field = this.remoteColumn(table, key, localField);
        for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
          const method = logicalOp === 'or' ? 'orWhere' : 'where';
          const coerced = this.coerceFilterValue(table, localField, opValue);
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
              this.applyContainsLike(builder, method, field, opValue);
              break;
            default:
              (builder as any)[method](field, coerced);
          }
        }
      } else {
        const localField = this.mapSortField(key);
        const field = this.remoteColumn(table, key, localField);
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method](field, this.coerceFilterValue(table, localField, value) as any);
      }
    }
  }

  // ── Field mapping ───────────────────────────────────────────────────────────

  protected mapSortField(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

  /**
   * Physical column for a logical field on an external object that declares an
   * `external.columnMap` (ADR-0015). Returns `fallback` (the caller's existing
   * per-site resolution) when the object has no columnMap, so managed objects
   * and external objects without a columnMap are byte-for-byte unchanged.
   */
  protected remoteColumn(object: string | null | undefined, field: string, fallback: string): string {
    const m = object ? this.fieldColumnByObject[object] : undefined;
    return (m && m[field]) || fallback;
  }

  /**
   * Remap a write payload's logical field keys to physical remote columns for an
   * external object with a columnMap. No-op otherwise. Applied AFTER formatInput
   * (whose value coercion is keyed by logical field name).
   */
  protected applyWriteColumnMap(object: string, data: any): any {
    const m = this.fieldColumnByObject[object];
    if (!m || !data || typeof data !== 'object') return data;
    const out: any = {};
    for (const [k, v] of Object.entries(data)) out[m[k] ?? k] = v;
    return out;
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
      // `rating`/`slider`/`progress` are authored as numeric scalars (a star
      // count, a slider position, a percent-of-completion). Without an explicit
      // case they fell to `default → table.string`, giving the column TEXT
      // affinity so SQLite coerced the written number to a string ('4' not 4) —
      // a silent type-fidelity leak the value-loss tests didn't catch. REAL
      // affinity round-trips them as JS numbers (#field-zoo).
      case 'rating':
      case 'slider':
      case 'progress':
        col = table.float(name);
        break;
      // `toggle` is a boolean rendered as a switch. Same leak as above (TEXT
      // affinity stored '1'); a boolean column gives NUMERIC affinity and the
      // `booleanFields` read-coercion below converts the stored 1/0 back to a
      // real JS boolean.
      case 'boolean':
      case 'toggle':
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
        // Array/object-valued types are stored as a JSON column. Driven by the
        // single `JSON_COLUMN_TYPES` source so this DDL switch and `isJsonField`
        // (the read-side deserializer) can never drift — the drift between them
        // is exactly what let array-valued fields reach the binder un-serialized
        // (#field-zoo). Everything else is a plain string.
        col = JSON_COLUMN_TYPES.has(type) ? table.json(name) : table.string(name);
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
    return JSON_COLUMN_TYPES.has(type) || !!field.multiple;
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

    // ADR-0053 Phase 1: a `Field.date` is a timezone-naive calendar day, not
    // an instant. Collapse any `Date` or full-ISO value to `YYYY-MM-DD` before
    // it hits the wire so storage matches the date-only contract the filter
    // layer (`coerceFilterValue`) already enforces — the write/filter
    // asymmetry was the root cause of the silent date-equality miss.
    // `Field.datetime` is untouched (it keeps full-instant semantics).
    const dateFields = this.dateFields[object];
    if (dateFields && dateFields.size > 0 && copy && typeof copy === 'object') {
      for (const field of dateFields) {
        const v = copy[field];
        if (v == null) continue;
        const normalized = this.toDateOnly(v);
        if (normalized !== v) {
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = normalized;
        }
      }
    }

    if (!this.isSqlite) return copy;

    const fields = this.jsonFields[object];
    if (fields && fields.length > 0) {
      if (!copied) { copy = { ...copy }; copied = true; }
      for (const field of fields) {
        if (copy[field] !== undefined && typeof copy[field] === 'object' && copy[field] !== null) {
          copy[field] = JSON.stringify(copy[field]);
        }
      }
    }

    // Safety net: better-sqlite3 can only bind numbers/strings/bigints/buffers/
    // null. Any value still an array or plain object here (a field type not
    // classified as JSON, a `Field.multiple` we didn't catch, or an ad-hoc
    // payload) would otherwise throw a raw TypeError mid-insert. Serialize it
    // to JSON so the write degrades to a stored string instead of a 500.
    for (const key of Object.keys(copy)) {
      const v = copy[key];
      if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
        if (!copied) { copy = { ...copy }; copied = true; }
        copy[key] = JSON.stringify(v);
      }
    }
    return copy;
  }

  protected formatOutput(object: string, data: any): any {
    if (!data) return data;

    // External columnMap (ADR-0015): rename physical remote-column keys to local
    // field names BEFORE coercion (which is keyed by local field). No-op for
    // managed objects and external objects without a columnMap.
    const colToField = this.columnFieldByObject[object];
    if (colToField && typeof data === 'object') {
      for (const [remoteCol, localField] of Object.entries(colToField)) {
        if (remoteCol !== localField && Object.prototype.hasOwnProperty.call(data, remoteCol)) {
          // Explicit columnMap wins: the remote column is the source of truth for
          // this local field, even if a same-named native column also exists.
          data[localField] = data[remoteCol];
          delete data[remoteCol];
        }
      }
    }

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

      // Numeric scalars stored on a legacy TEXT-affinity column come back as
      // strings ('4'); coerce numeric-looking strings back to numbers so the
      // declared type wins regardless of when the column was created. Only
      // touch strings — a fresh REAL/INTEGER column already yields a number,
      // and a genuinely non-numeric value (junk legacy data) is left intact
      // rather than turned into NaN. See NUMERIC_SCALAR_TYPES.
      const numericFields = this.numericFields[object];
      if (numericFields && numericFields.length > 0) {
        for (const field of numericFields) {
          const v = data[field];
          if (typeof v === 'string' && v.trim() !== '') {
            const n = Number(v);
            if (!Number.isNaN(n)) data[field] = n;
          }
        }
      }
    }

    // ADR-0053 Phase 1: present `Field.date` as a timezone-naive `YYYY-MM-DD`
    // string, slicing any stored time component. This transparently repairs
    // legacy rows written as a full timestamp before this normalization, so
    // date-equality works without a data migration. Runs for every dialect.
    const dateFields = this.dateFields[object];
    if (dateFields && dateFields.size > 0) {
      for (const field of dateFields) {
        const v = data[field];
        if (v == null) continue;
        const normalized = this.toDateOnly(v);
        if (normalized !== v) data[field] = normalized;
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
