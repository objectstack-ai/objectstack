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
import { resolveMultiOrgEnabled } from '@objectstack/types';
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

/**
 * The builtin audit-timestamp columns every managed object carries. They are
 * stamped to a single canonical instant format on SQLite (see
 * `stampInsertTimestamps`/`update`) and read-repaired by
 * `repairNaiveUtcAuditTimestamp`.
 */
const AUDIT_TIMESTAMP_COLUMNS = ['created_at', 'updated_at'] as const;

/**
 * Read-side repair for the builtin audit timestamps on SQLite.
 *
 * SQLite has no native timestamp type. Rows written before the canonical-format
 * fix — or by a raw insert that fell back to the `CURRENT_TIMESTAMP` column
 * default — hold a timezone-NAIVE, space-separated string
 * (`'YYYY-MM-DD HH:MM:SS[.fff]'`). `Date.parse` reads such a zone-less string as
 * LOCAL time, so a stored UTC wall-clock silently shifts by the host offset on
 * any non-UTC runtime — the bug that made the objectos freshness probe never
 * evict. Re-emit those values as canonical ISO-8601 with an explicit `Z`,
 * interpreting the stored wall-clock as UTC (exactly what `CURRENT_TIMESTAMP`
 * and the legacy UPDATE stamp both wrote).
 *
 * Idempotent and total: a value that already carries an explicit zone (`…Z` or
 * `±HH:MM`) is returned unchanged, so re-reading a normalised row is a no-op
 * (this keeps optimistic-lock `updated_at` tokens stable — see
 * objectql `assertVersionMatch`). Non-strings (e.g. a `Field.datetime`-typed
 * audit column stored as epoch-ms INTEGER) and unrecognised shapes pass
 * through untouched.
 */
function repairNaiveUtcAuditTimestamp(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return value;
  // Already zone-explicit (`…Z` or `±HH:MM`) — leave as-is (idempotent).
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return value;
  // Zone-naive `YYYY-MM-DD[ T]HH:MM:SS[.fff]` → interpret the wall-clock as UTC.
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  if (!m) return value;
  const d = new Date(`${m[1]}T${m[2]}Z`);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/**
 * Whether a field's `defaultValue` is the framework's `'NOW()'` convention
 * ("use the database clock at insert time"). Case-insensitive, whitespace
 * tolerant. Single source for the two places `createColumn` checks it.
 */
function isNowDefaultValue(v: unknown): v is string {
  return typeof v === 'string' && /^now\(\)$/i.test(v.trim());
}

/**
 * Read-side normalization for user-declared `Field.datetime` columns on SQLite.
 *
 * SQLite has no native timestamp type, so one `datetime` column can hold MIXED
 * storage:
 *   - an explicitly-written value bound through better-sqlite3 as a JS `Date`
 *     lands as INTEGER epoch milliseconds;
 *   - a value left to a `defaultValue: 'NOW()'` column default lands as TEXT —
 *     canonical ISO-8601-`Z` for columns created after this fix
 *     (`SqlDriver.nowColumnDefault`), or a legacy timezone-NAIVE
 *     `'YYYY-MM-DD HH:MM:SS'` (`CURRENT_TIMESTAMP`) for columns created before it.
 *
 * Present every shape as one canonical instant — full ISO-8601 with an explicit
 * `Z` (`new Date(...).toISOString()`) — so reads are uniform and unambiguous
 * regardless of how/when the row was written. A NAIVE string's wall-clock is
 * interpreted as UTC, exactly what `CURRENT_TIMESTAMP` wrote; without this a
 * zone-less string is read back by `Date.parse` as LOCAL time and the stored
 * instant shifts by the host offset on a non-UTC runtime (the same class of bug
 * ADR-0074 fixed for the builtin `created_at`/`updated_at` audit columns, and
 * ADR-0053's "`datetime` is an instant stored as UTC" applied to user fields).
 *
 * Idempotent (an already zone-explicit `…Z`/`±HH:MM` string is preserved) and
 * total (`null`/`undefined`/unparseable shapes pass through untouched). Reuses
 * ADR-0074's `repairNaiveUtcAuditTimestamp` for the string shapes (the single
 * source of the zone-naive→UTC rules) and adds the INTEGER epoch-ms / `Date`
 * folding, mirroring the read-repair the `Field.date`/numeric-scalar paths do.
 * SQLite-only: Postgres/MySQL store a real zone-aware TIMESTAMP and never carry
 * this ambiguity.
 */
function normalizeSqliteDatetimeOutput(value: unknown): unknown {
  if (value == null) return value;
  // INTEGER/REAL epoch milliseconds — what better-sqlite3 binds a JS `Date` to.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // A JS `Date` is never returned by better-sqlite3 here, but normalize one
  // defensively so any caller-shaped row also reads back canonical.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return value;
  // A bare integer rendered as TEXT (defensive) — treat as epoch milliseconds.
  if (/^-?\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // Any other string — zone-explicit or zone-naive `YYYY-MM-DD HH:MM:SS` — takes
  // the same shape rules as an audit timestamp; reuse that repair as the single
  // source for the string-handling logic (idempotent on zone-explicit values).
  return repairNaiveUtcAuditTimestamp(s);
}

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
  protected timeFields: Record<string, Set<string>> = {};
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
   * Count of transactions currently open through `beginTransaction`. On SQLite
   * the pool holds a single connection, so while this is > 0 that connection is
   * busy and any bare `this.knex` query would dead-lock acquiring a second one.
   * Used only by the dev/test guard `assertBareKnexSafe`. Incremented in
   * `beginTransaction`, decremented in `commit`/`rollback`; the `openTransactions`
   * set makes the decrement idempotent so a double commit/rollback can't drive
   * the count negative or double-count.
   */
  protected activeTransactions = 0;
  /** Transactions counted in `activeTransactions` and not yet released. */
  protected openTransactions = new WeakSet<object>();

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
        // A native better-sqlite3 load failure surfaces HERE first — this PRAGMA
        // is the first query that forces the lazy `.node` addon to load. Two
        // real-world variants, both handled by `resolveSqliteDriver`'s probe,
        // which catches the failure and steps down to wasm SQLite with a clean
        // one-line notice (#2229):
        //   • ABI mismatch  — `ERR_DLOPEN_FAILED` / "…NODE_MODULE_VERSION 127…"
        //                      (a stale prebuilt binary after a Node upgrade)
        //   • not built     — "Could not locate the bindings file" (native addon
        //                      never compiled, e.g. a fresh clone / blocked build)
        // Dumping the full multi-line stack for either looks like a fatal crash
        // to the reader (it isn't), so log a concise, actionable one-liner and
        // let the step-down message that follows explain the outcome. Any OTHER
        // PRAGMA failure keeps the full warning (with stack) as before.
        const code = (e as { code?: string } | null | undefined)?.code;
        const msg = e instanceof Error ? e.message : String(e);
        const isNativeLoadFailure =
          code === 'ERR_DLOPEN_FAILED' ||
          code === 'MODULE_NOT_FOUND' ||
          code === 'ERR_MODULE_NOT_FOUND' ||
          /NODE_MODULE_VERSION|could not locate the bindings|was compiled against a different/i.test(msg);
        if (isNativeLoadFailure) {
          this.logger.warn(
            'native better-sqlite3 unavailable (ABI mismatch or not built) — will step down to wasm SQLite; run `pnpm rebuild better-sqlite3` for native speed',
          );
        } else {
          this.logger.warn('Failed to set PRAGMA auto_vacuum=INCREMENTAL', e);
        }
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
  // CRUD — IDataDriver core
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
    if (Array.isArray(query.fields) && query.fields.length > 0) {
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

    // Rotation (ADR-0057 P2): the base name is a read-only view — new rows
    // land in the current shard.
    const builder = this.getBuilder(this.rotationWriteTarget(object) ?? object, options);
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, toInsert));
    this.stampInsertTimestamps(object, formatted);

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
  protected async ensureSequencesTable(parentTrx?: Knex.Transaction): Promise<void> {
    if (this.sequencesTableReady) return;
    if (this.sequencesTableEnsurePromise) {
      await this.sequencesTableEnsurePromise;
      return;
    }
    // Which connection runs the DDL below. Normally a fresh pooled connection
    // (`this.knex`), because `initObjects` pre-creates the table outside any data
    // transaction. This lazy path is the fallback (e.g. an external object, or a
    // consumer that writes without `initObjects`). If we are already inside the
    // caller's transaction AND the pool can only ever hand out one connection
    // (SQLite, pool max=1), that connection is busy with the open transaction —
    // a bare `this.knex` here would block forever acquiring a second one and then
    // fail with a Knex acquire-timeout (the reported batch/autonumber deadlock).
    // Run the DDL on the caller's own transaction instead; SQLite permits DDL
    // inside a transaction. We deliberately do NOT route DDL through `parentTrx`
    // on MySQL, where DDL implicitly commits the caller's transaction; there the
    // roomy pool (max=10) lets a fresh connection create the table safely.
    const runner: Knex | Knex.Transaction = parentTrx && this.isSqlite ? parentTrx : this.knex;
    // If we are about to run DDL on a fresh pooled connection while a SQLite
    // transaction holds the only one, fail fast with a clear message instead of
    // dead-locking. This catches the "caller opened a transaction but did not
    // thread it through as parentTrx" regression at the call site (dev/test only).
    if (runner === this.knex) this.assertBareKnexSafe('ensureSequencesTable');
    this.sequencesTableEnsurePromise = (async () => {
      const exists = await runner.schema.hasTable(SEQUENCES_TABLE);
      if (!exists) {
        try {
          await this.createSequencesTable(SEQUENCES_TABLE, runner);
          this.sequencesHasKeyHash = true;
        } catch (err: any) {
          // Race or cross-process create — re-check existence; ignore
          // "already exists" errors from any dialect.
          const stillMissing = !(await runner.schema.hasTable(SEQUENCES_TABLE));
          if (stillMissing) throw err;
          // A racing creator may have used an older schema. Migrate in place.
          await this.ensureSequencesKeyHashShape(runner);
        }
      } else {
        // Pre-existing table may predate the `key_hash`/`scope` shape. Migrate.
        await this.ensureSequencesKeyHashShape(runner);
      }
      // Cache "ready" only when the DDL ran on a durable connection. If it rode
      // the caller's transaction (the SQLite in-tx fallback above), the table is
      // commit-conditional — a rollback would drop it — so leave the flag unset
      // and re-verify (a cheap `hasTable`) on the next write rather than trusting
      // a stale process-level flag. `initObjects` sets it durably up front, so
      // the hot path is unaffected.
      if (runner === this.knex) this.sequencesTableReady = true;
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

  /**
   * Create the current `key_hash`-keyed sequences table shape. `runner` is the
   * connection the DDL runs on (a fresh pooled connection by default, or the
   * caller's transaction on SQLite — see {@link ensureSequencesTable}).
   */
  protected async createSequencesTable(
    table: string,
    runner: Knex | Knex.Transaction = this.knex,
  ): Promise<void> {
    await runner.schema.createTable(table, (t) => {
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
  protected async ensureSequencesKeyHashShape(
    runner: Knex | Knex.Transaction = this.knex,
  ): Promise<void> {
    if (await runner.schema.hasColumn(SEQUENCES_TABLE, 'key_hash')) {
      this.sequencesHasKeyHash = true;
      return;
    }
    const hasScope = await runner.schema.hasColumn(SEQUENCES_TABLE, 'scope');
    const TMP = `${SEQUENCES_TABLE}__rebuild`;
    try {
      const rows: any[] = await runner(SEQUENCES_TABLE).select('*');
      await runner.schema.dropTableIfExists(TMP);
      await this.createSequencesTable(TMP, runner);
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
      if (migrated.length > 0) await runner(TMP).insert(migrated);
      await runner.schema.dropTable(SEQUENCES_TABLE);
      await runner.schema.renameTable(TMP, SEQUENCES_TABLE);
      this.sequencesHasKeyHash = true;
    } catch (err) {
      // Leave the original table intact; fall back to legacy keying for
      // fixed-prefix sequences and refuse per-scope writes until migrated.
      this.sequencesHasKeyHash = false;
      await runner.schema.dropTableIfExists(TMP).catch(() => {});
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
    // Pass the caller's transaction so a cold-cache first write inside a batch
    // transaction ensures the table on the right connection instead of dead-
    // locking on a second one (SQLite pool max=1). `initObjects` normally warms
    // this up front, making the call a no-op — this only bites the lazy path.
    await this.ensureSequencesTable(parentTrx);
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

  /**
   * Stamp the builtin audit timestamps to one canonical ISO-8601-with-`Z`
   * instant on the SQLite write paths (`create`/`bulkCreate`/`upsert`), so
   * INSERT and UPDATE agree on a single zone-explicit format.
   *
   * Without this, an insert that omits `created_at`/`updated_at` falls back to
   * the column's `CURRENT_TIMESTAMP` default, which on SQLite renders a
   * zone-NAIVE, space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone) —
   * the same ambiguity the old UPDATE stamp had. Stamping app-side (rather than
   * changing the column default) fixes this for EXISTING tenant databases
   * immediately, since their tables keep the legacy default. Legacy/raw rows
   * still written zone-naive are repaired on read by
   * `repairNaiveUtcAuditTimestamp`.
   *
   * Only fills a slot the caller left empty — an explicit value (a seed fixture,
   * the sys_metadata writer, a service outbox) is preserved. No-op for
   * timestamp-less objects and for Postgres/MySQL, whose native `now()` column
   * default already stores a zone-aware TIMESTAMP.
   */
  protected stampInsertTimestamps(object: string, formatted: Record<string, any>): void {
    if (!this.isSqlite || !this.tablesWithTimestamps.has(object)) return;
    const iso = new Date().toISOString();
    for (const col of AUDIT_TIMESTAMP_COLUMNS) {
      if (formatted[col] === undefined || formatted[col] === null) formatted[col] = iso;
    }
  }

  async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    this.auditMissingTenant(object, 'update', options);
    const rotationShards = this.rotationShardsOf(object);
    if (rotationShards) return this.rotatedUpdateById(object, rotationShards, id, data, options);
    const builder = this.getBuilder(object, options).where('id', id);
    this.applyTenantScope(builder, object, options);
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data));

    if (this.tablesWithTimestamps.has(object)) {
      // Canonical instant format. On SQLite (no native timestamp type) stamp
      // full ISO-8601 WITH an explicit `Z` — matching the insert paths
      // (`stampInsertTimestamps`) so create and update agree on one
      // zone-explicit format. The previous `…replace('T',' ').replace('Z','')`
      // wrote a zone-NAIVE, space-separated string that `Date.parse` reads as
      // LOCAL time, silently shifting the instant by the host offset on a
      // non-UTC runtime (the objectos freshness-probe miss). Postgres/MySQL keep
      // native `now()` — a real zone-aware TIMESTAMP that never had the issue.
      formatted.updated_at = this.isSqlite ? new Date().toISOString() : this.knex.fn.now();
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
    this.stampInsertTimestamps(object, formatted);
    const mergeKeys = conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'];

    // Rotation: conflict-merge is scoped to the CURRENT shard (telemetry is
    // effectively append-only; a cross-shard upsert would need a probe-first
    // strategy nothing on the platform requires today).
    const builder = this.getBuilder(this.rotationWriteTarget(object) ?? object, options);
    // `created_at` is insert-only — never overwrite it when an existing row is
    // merged on conflict (the stamped/seeded value belongs to the original
    // insert). Everything else (incl. `updated_at`) merges as before, so an
    // upsert that updates a row still advances `updated_at`.
    const mergeColumns = Object.keys(formatted).filter((c) => c !== 'created_at');
    const insertion = builder.insert(formatted).onConflict(mergeKeys);
    await (mergeColumns.length > 0 ? insertion.merge(mergeColumns) : insertion.merge());

    const readback = this.getBuilder(object, options).where('id', toUpsert.id);
    this.applyTenantScope(readback, object, options);
    const result = await readback.first();
    return this.formatOutput(object, result) || toUpsert;
  }

  async delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    this.auditMissingTenant(object, 'delete', options);
    const rotationShards = this.rotationShardsOf(object);
    if (rotationShards) {
      // The row lives in exactly one shard — probe newest-first.
      for (const shard of rotationShards) {
        const builder = this.getBuilder(shard, options).where('id', id);
        this.applyTenantScope(builder, object, options);
        const count = await builder.delete();
        if (count > 0) return true;
      }
      return false;
    }
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
    // Same client-side id assignment as create() (id/_id normalization,
    // nanoid fallback when neither is supplied) — a row missing an id must
    // not be silently inserted with a NULL primary key just because the
    // engine batched it into an array. This path used to be rarely
    // exercised; framework#2678 made it the common case for seed/import.
    const rows = data.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const { _id, ...rest } = row;
      const toInsert: Record<string, any> = { ...rest };
      if (_id !== undefined && toInsert.id === undefined) {
        toInsert.id = _id;
      } else if (toInsert.id === undefined) {
        toInsert.id = nanoid(DEFAULT_ID_LENGTH);
      }
      return toInsert;
    });
    for (const row of rows) {
      if (row && typeof row === 'object') {
        this.injectTenantOnInsert(object, row, options);
        // Reserve a persistent sequence value for each row's autonumber
        // field(s) — the engine no longer pre-fills these (see #1603).
        await this.fillAutoNumberFields(object, row, options);
      }
    }
    // Same write-side marshaling as create() (#2735): JSON-typed and
    // object-valued fields must be serialized per row before they reach the
    // knex binder — the raw batch used to hand `{lat, lng}` objects straight
    // to SQLite ("Wrong API use: tried to bind a value of an unknown type"),
    // silently failing the whole seed batch. Timestamp stamping runs on the
    // FORMATTED copy, mirroring create().
    const formattedRows = rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const formatted = this.applyWriteColumnMap(object, this.formatInput(object, row));
      this.stampInsertTimestamps(object, formatted);
      return formatted;
    });
    const builder = this.getBuilder(this.rotationWriteTarget(object) ?? object, options);
    const result = await builder.insert(formattedRows).returning('*');
    // Read-back parity with create(): JSON columns come back as their stored
    // strings from `returning('*')` — decode them so batch callers see the
    // same shapes single-insert callers do.
    return Array.isArray(result)
      ? result.map((r) => this.formatOutput(object, r))
      : result;
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
    for (const target of this.rotationShardsOf(object) ?? [object]) {
      const builder = this.getBuilder(target, options).whereIn('id', ids);
      this.applyTenantScope(builder, object, options);
      await builder.delete();
    }
  }

  async updateMany(object: string, query: QueryAST, data: any, options?: DriverOptions): Promise<number> {
    this.auditMissingTenant(object, 'updateMany', options);
    let total = 0;
    for (const target of this.rotationShardsOf(object) ?? [object]) {
      const builder = this.getBuilder(target, options);
      this.applyTenantScope(builder, object, options);
      if (query.where) this.applyFilters(builder, query.where);
      total += (await builder.update(data)) || 0;
    }
    return total;
  }

  async deleteMany(object: string, query: QueryAST, options?: DriverOptions): Promise<number> {
    this.auditMissingTenant(object, 'deleteMany', options);
    let total = 0;
    for (const target of this.rotationShardsOf(object) ?? [object]) {
      const builder = this.getBuilder(target, options);
      this.applyTenantScope(builder, object, options);
      if (query.where) this.applyFilters(builder, query.where);
      total += (await builder.delete()) || 0;
    }
    return total;
  }

  /** By-id update for a rotation-managed object: the row lives in exactly one
   * shard — probe newest-first, mirroring the un-rotated {@link update}. */
  protected async rotatedUpdateById(
    object: string,
    shards: string[],
    id: string | number,
    data: Record<string, any>,
    options?: DriverOptions,
  ): Promise<any> {
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data));
    if (this.tablesWithTimestamps.has(object)) {
      formatted.updated_at = this.isSqlite ? new Date().toISOString() : this.knex.fn.now();
    }
    for (const shard of shards) {
      const builder = this.getBuilder(shard, options).where('id', id);
      this.applyTenantScope(builder, object, options);
      const count = await builder.update(formatted);
      if (count > 0) {
        const readback = this.getBuilder(shard, options).where('id', id);
        this.applyTenantScope(readback, object, options);
        const updated = await readback.first();
        return this.formatOutput(object, updated) || null;
      }
    }
    return null;
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
    const trx = await this.knex.transaction();
    this.openTransactions.add(trx as unknown as object);
    this.activeTransactions++;
    return trx;
  }

  /** Idempotently drop a transaction from the open-count (safe on double close). */
  protected releaseTransaction(transaction: unknown): void {
    const key = transaction as object;
    if (key && this.openTransactions.has(key)) {
      this.openTransactions.delete(key);
      this.activeTransactions = Math.max(0, this.activeTransactions - 1);
    }
  }

  /**
   * Dev/test guard against the SQLite single-connection dead-lock. SQLite's pool
   * hands out exactly one connection, so issuing a bare `this.knex` query while a
   * transaction holds that connection blocks forever acquiring a second one and
   * finally fails with an opaque `Knex: Timeout acquiring a connection`. This
   * turns that into an immediate, actionable error at the call site.
   *
   * No-op in production (zero overhead on the hot path) and on every non-SQLite
   * dialect, whose roomy pools (max ≥ 10) cannot exhibit the single-connection
   * dead-lock. Callers that legitimately need the connection during a
   * transaction must bind the operation to that transaction instead of
   * `this.knex`.
   */
  protected assertBareKnexSafe(op: string): void {
    if (this.isProductionEnv()) return;
    if (!this.isSqlite) return;
    if (this.activeTransactions === 0) return;
    throw new Error(
      `[driver-sql] refusing to run '${op}' on a fresh pooled connection while a ` +
        `transaction is open: SQLite's pool has a single connection, so acquiring a ` +
        `second one would dead-lock (surfacing later as "Knex: Timeout acquiring a ` +
        `connection"). Bind this operation to the active transaction instead of using ` +
        `this.knex.`,
    );
  }

  /** IDataDriver standard */
  async commit(transaction: unknown): Promise<void> {
    try {
      await (transaction as Knex.Transaction).commit();
    } finally {
      this.releaseTransaction(transaction);
    }
  }

  /** IDataDriver standard */
  async rollback(transaction: unknown): Promise<void> {
    try {
      await (transaction as Knex.Transaction).rollback();
    } finally {
      this.releaseTransaction(transaction);
    }
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
   * Reclaim free pages after bulk deletions (ADR-0057 §3.4). On SQLite this
   * issues `PRAGMA incremental_vacuum`, returning freelist pages to the OS —
   * it pairs with the `auto_vacuum=INCREMENTAL` default set in {@link connect}
   * (files created before that default need one full `VACUUM` to adopt it).
   * Postgres/MySQL manage space via their own vacuum/purge machinery, so this
   * is a no-op there.
   */
  async reclaimSpace(_options?: DriverOptions): Promise<void> {
    if (!this.isSqlite) return;
    await this.knex.raw('PRAGMA incremental_vacuum');
  }

  // ── Data-lifecycle rotation (ADR-0057 P2) ─────────────────────────────────
  //
  // High-frequency telemetry declared with `lifecycle.storage.strategy =
  // 'rotation'` is physically time-sharded: writes land in the CURRENT shard
  // table (`<table>__r<key>`), reads go through a UNION ALL view named after
  // the base table (so every query path is unchanged), and expiry is an O(1)
  // `DROP TABLE` of the oldest shard — real space reclamation with no
  // row-by-row delete (the ServiceNow Table Rotation model, ADR-0057 §3.3).
  //
  // The view is READ-ONLY by design (SQLite views reject writes and don't
  // support RETURNING): the driver redirects every write path shard-wise
  // instead — inserts to the current shard; by-id updates/deletes probe each
  // live shard; bulk updates/deletes fan out and sum. SQLite-only
  // ({@link supportsRotation}); on other dialects the LifecycleService falls
  // back to an age-based reap, so the declared bound holds everywhere — only
  // the reclamation mechanics differ.

  /** table → live rotation state (shard names newest-first + write target). */
  protected rotationStateByTable = new Map<string, { shards: string[]; current: string }>();

  get supportsRotation(): boolean {
    return this.isSqlite;
  }

  /** Live shard set (newest first) when `object` is rotation-managed. */
  protected rotationShardsOf(object: string): string[] | undefined {
    return this.rotationStateByTable.get(object)?.shards;
  }

  /** The shard new rows land in when `object` is rotation-managed. */
  protected rotationWriteTarget(object: string): string | undefined {
    return this.rotationStateByTable.get(object)?.current;
  }

  /**
   * Shard key for an instant: `day` → UTC `YYYYMMDD`, `week` → the UTC
   * Monday's `YYYYMMDD`, `month` → `YYYYMM`. Keys of one unit sort
   * lexicographically = chronologically, which `ensureRotation` relies on.
   */
  protected rotationShardKey(nowMs: number, unit: 'day' | 'week' | 'month'): string {
    const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    if (unit === 'month') return ymd(nowMs).slice(0, 6);
    if (unit === 'week') {
      const dow = (new Date(nowMs).getUTCDay() + 6) % 7; // Monday = 0
      return ymd(nowMs - dow * 86_400_000);
    }
    return ymd(nowMs);
  }

  /**
   * Public Rotator entry point (called by the LifecycleService each sweep and
   * by {@link initObjects} at boot). Idempotent: ensures the current shard +
   * read view exist, adopts a legacy pre-rotation base table as the current
   * shard, column-syncs every retained shard so the UNION stays uniform, and
   * drops shards past the `shards × unit` window.
   */
  async rotateShards(
    objectDef: { name: string; fields?: Record<string, any>; lifecycle?: any },
    nowMs: number = Date.now(),
  ): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
    this.assertSchemaMutable('rotateShards');
    const policy = objectDef.lifecycle?.storage;
    if (!policy || policy.strategy !== 'rotation') {
      throw new Error(`[sql-driver] rotateShards: '${objectDef.name}' declares no lifecycle.storage rotation policy`);
    }
    if (!this.supportsRotation) {
      throw new Error(`[sql-driver] rotateShards: rotation is not supported on dialect '${this.dialectName}'`);
    }
    const tableName = StorageNameMapping.resolveTableName(objectDef as any);
    return this.ensureRotation(tableName, objectDef, policy, nowMs);
  }

  protected async ensureRotation(
    tableName: string,
    obj: { name: string; fields?: Record<string, any> },
    policy: { shards: number; unit: 'day' | 'week' | 'month' },
    nowMs: number = Date.now(),
  ): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
    const current = `${tableName}__r${this.rotationShardKey(nowMs, policy.unit)}`;

    // Physical inventory: the base name (table before adoption, view after)
    // and every existing shard.
    const esc = tableName.replace(/[\\%_]/g, '\\$&');
    const raw: any = await this.knex.raw(
      `SELECT name, type FROM sqlite_master WHERE name = ? OR (name LIKE ? ESCAPE '\\')`,
      [tableName, `${esc}\\_\\_r%`],
    );
    const rows: Array<{ name: string; type: string }> = Array.isArray(raw) ? raw : raw?.rows ?? [];
    const baseType = rows.find((r) => r.name === tableName)?.type as 'table' | 'view' | undefined;
    const shardNames = new Set(
      rows.map((r) => r.name).filter((n) => n !== tableName && /__r\d{6,8}$/.test(n)),
    );

    // Adopt a legacy pre-rotation table: its whole history becomes the
    // current shard (coarse, but safe — it then ages out of the window).
    if (baseType === 'table') {
      if (!shardNames.has(current)) {
        await this.knex.schema.renameTable(tableName, current);
      } else {
        // Partial-failure recovery: both exist — merge, then drop the base.
        await this.knex.raw(`INSERT INTO "${current}" SELECT * FROM "${tableName}"`);
        await this.knex.schema.dropTable(tableName);
      }
      shardNames.add(current);
    }
    shardNames.add(current);

    // Time-based window: retain shards whose period falls inside the last
    // `shards × unit` (ends at the current period); everything older is the
    // O(1) reclaim. Count-based retention would silently stretch the window
    // when rotation cadence has gaps.
    const unitMs = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }[policy.unit];
    const oldestRetainedKey = this.rotationShardKey(nowMs - (Math.max(1, policy.shards) - 1) * unitMs, policy.unit);
    const parsed = [...shardNames].sort((a, b) => b.localeCompare(a));
    const keyOf = (n: string) => n.slice(tableName.length + 3);
    const retained = parsed.filter((n) => keyOf(n) >= oldestRetainedKey);
    const dropped = parsed.filter((n) => keyOf(n) < oldestRetainedKey);

    // Column-sync every retained shard (creates the current one; adds any
    // newly declared columns to older shards so the UNION stays uniform).
    for (const shard of retained) {
      await this.ensureShardTable(shard, obj);
      this.aliasShardBookkeeping(tableName, shard);
    }

    for (const d of dropped) {
      await this.knex.schema.dropTableIfExists(d);
    }

    // Rebuild the read view over the retained set, newest shard first. An
    // explicit column list (not `*`) keeps the view stable when old shards
    // carry orphaned columns.
    const cols = this.rotationColumnList(obj);
    await this.knex.raw(`DROP VIEW IF EXISTS "${tableName}"`);
    await this.knex.raw(
      `CREATE VIEW "${tableName}" AS ` + retained.map((s) => `SELECT ${cols} FROM "${s}"`).join(' UNION ALL '),
    );

    this.rotationStateByTable.set(tableName, { shards: retained, current });
    if (dropped.length > 0) {
      (this.logger as { info?: (msg: string) => void }).info?.(
        `[sql-driver] rotated ${tableName}: ${retained.length} shard(s) live, dropped ${dropped.join(', ')}`,
      );
    }
    return { object: tableName, current, shards: retained, dropped };
  }

  /** Create/column-sync one physical shard table (mirrors the managed-table
   * branch of {@link initObjects}, scoped to a shard). */
  protected async ensureShardTable(shardName: string, obj: { fields?: Record<string, any> }): Promise<void> {
    const builtinColumns = new Set(['id', 'created_at', 'updated_at']);
    const exists = await this.knex.schema.hasTable(shardName);
    if (!exists) {
      await this.knex.schema.createTable(shardName, (table) => {
        table.string('id').primary();
        table.timestamp('created_at').defaultTo(this.knex.fn.now());
        table.timestamp('updated_at').defaultTo(this.knex.fn.now());
        for (const [name, field] of Object.entries(obj.fields ?? {})) {
          if (builtinColumns.has(name)) continue;
          this.createColumn(table, name, field);
        }
      });
    } else {
      const columnInfo = await this.knex(shardName).columnInfo();
      const existingColumns = Object.keys(columnInfo);
      await this.knex.schema.alterTable(shardName, (table) => {
        for (const [name, field] of Object.entries(obj.fields ?? {})) {
          if (!existingColumns.includes(name)) {
            this.createColumn(table, name, field);
          }
        }
      });
    }

    // Declared indexes per shard. Auto-derived names already embed the shard
    // name; explicit names get a shard prefix so they can't collide across
    // shards in the same database.
    const declared = (obj as any).indexes;
    if (Array.isArray(declared) && declared.length > 0) {
      const colInfo = await this.knex(shardName).columnInfo();
      const perShard = declared.map((idx: any) => ({
        ...idx,
        name: typeof idx?.name === 'string' && idx.name.trim() ? `${shardName}__${idx.name.trim()}` : undefined,
      }));
      await this.syncDeclaredIndexes(shardName, perShard, new Set(Object.keys(colInfo)));
    }
  }

  /** Quoted, deterministic column list for the rotation view. */
  protected rotationColumnList(obj: { fields?: Record<string, any> }): string {
    const builtin = ['id', 'created_at', 'updated_at'];
    const declared = Object.keys(obj.fields ?? {}).filter((f) => !builtin.includes(f));
    return [...builtin, ...declared].map((c) => `"${c}"`).join(', ');
  }

  /**
   * Point every per-table bookkeeping map (read coercion, JSON/boolean
   * columns, tenant scope, timestamp stamping) for a shard at the base
   * table's entries, so a builder targeting a shard behaves exactly like one
   * targeting the view.
   */
  protected aliasShardBookkeeping(base: string, shard: string): void {
    this.jsonFields[shard] = this.jsonFields[base] ?? [];
    this.booleanFields[shard] = this.booleanFields[base] ?? [];
    this.numericFields[shard] = this.numericFields[base] ?? [];
    this.autoNumberFields[shard] = this.autoNumberFields[base] ?? [];
    if (this.dateFields[base]) this.dateFields[shard] = this.dateFields[base];
    if (this.datetimeFields[base]) this.datetimeFields[shard] = this.datetimeFields[base];
    if (this.timeFields[base]) this.timeFields[shard] = this.timeFields[base];
    this.tenantFieldByTable[shard] = this.tenantFieldByTable[base] ?? null;
    this.tablesWithTimestamps.add(shard);
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
    const timeCols: string[] = [];
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
        if (type === 'time') timeCols.push(name);
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
    if (timeCols.length) this.timeFields[key] = new Set(timeCols);
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
          if (type === 'time') {
            (this.timeFields[tableName] ??= new Set()).add(name);
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

      // ADR-0057 P2: rotation-declared telemetry is physically time-sharded —
      // the Rotator owns its DDL (shard tables + a read view under the base
      // name); the plain create/alter path below would collide with the view.
      const rotationPolicy = (obj as any).lifecycle?.storage;
      if (rotationPolicy?.strategy === 'rotation' && this.supportsRotation) {
        this.tablesWithTimestamps.add(tableName);
        await this.ensureRotation(tableName, obj, rotationPolicy);
        continue;
      }

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

    // Pre-create the auto_number counter table now, while we hold a fresh pooled
    // connection and are NOT inside any data transaction. Creating it lazily on
    // the first autonumber INSERT dead-locks a `/api/v1/batch` write on SQLite
    // (pool max=1: the open batch transaction owns the only connection, so the
    // lazy `ensureSequencesTable` blocks forever acquiring a second one) and
    // risks the same pool exhaustion under concurrent first-writes on
    // Postgres/MySQL. Idempotent and skipped entirely when nothing uses
    // auto_number, so it costs one `hasTable` at boot in the common case.
    const usesAutoNumber = Object.values(this.autoNumberFields).some(
      (cols) => Array.isArray(cols) && cols.length > 0,
    );
    if (usesAutoNumber) {
      await this.ensureSequencesTable();
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
   * `OS_MULTI_ORG_ENABLED`, matching how
   * the SchemaRegistry / SecurityPlugin pick the mode. Used to gate the
   * tenant-audit warning: it's only meaningful where tenant isolation is
   * actually enforced (org-scoping installed).
   */
  private _multiTenantMode?: boolean;
  protected isMultiTenantMode(): boolean {
    if (this._multiTenantMode === undefined) {
      // Single source of truth (shared with auth/registry/CLI) — previously
      // this read `process.env` inline instead of the shared resolver.
      this._multiTenantMode = resolveMultiOrgEnabled();
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
    // `(field = :tenantId OR field IS NULL)` — a NULL tenant column marks a
    // GLOBAL/platform row (bootstrap-seeded positions and permission sets,
    // business units, pre-org first-boot seeds). Such a row belongs to no
    // OTHER tenant, so the cross-tenant wall must not hide it: with strict
    // equality every tenant admin saw ZERO RBAC rows on a fresh deployment,
    // because every platform row is org-less (#2734). Rows stamped with a
    // DIFFERENT tenant stay invisible exactly as before; authorization on
    // global rows remains the job of the layers above (RBAC, RLS,
    // managed_by gates).
    return builder.where((b) => {
      void b.where(field, String(tenantId)).orWhereNull(field);
    });
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
   * Read-side repair for a `Field.time` value to its wall-clock time-of-day
   * (`Field.time` is a tz-naive time-of-day, not an instant — #2004). This is a
   * deliberately NARROW, read-only normalization (no write/filter counterpart):
   * it only strips a leading `YYYY-MM-DD` date — exactly what a legacy
   * `defaultValue: 'NOW()'` column took when the default was still the full
   * `CURRENT_TIMESTAMP` (or a full ISO datetime that leaked into the column) —
   * and any trailing zone, leaving the time portion. A value that is ALREADY a
   * bare time-of-day (`HH:MM[:SS[.fff]]`, with or without `Z`/offset) is returned
   * untouched, so the common case never changes and no write/read asymmetry is
   * introduced. A `Date`/epoch-ms (defensive — a Date bound to a time column)
   * maps to its UTC time-of-day. `null`/unrecognised shapes pass through.
   */
  protected toTimeOnly(value: any): any {
    if (value == null) return value;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? value : value.toISOString().slice(11, 19);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(11, 19);
    }
    if (typeof value !== 'string') return value;
    // Legacy full date+time → keep just the time-of-day (strip date + any zone).
    // A bare time-of-day is left exactly as stored.
    const m = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:[Zz]|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
    return m ? m[1] : value;
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
          this.applyAstComparison(builder, nextJoin, field, op, value, coerced);
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
    this.applyLike(builder, method, field, value, 'contains');
  }

  /**
   * Parameterized `LIKE`/`NOT LIKE` match with the LIKE metacharacters `%` / `_`
   * (and the escape char `\`) escaped in the user value so they match literally
   * — otherwise a value of `%` matches every row (a filter-bypass, P0). Binds an
   * explicit `ESCAPE '\'` because SQLite does not honour a default escape
   * character (MySQL/Postgres do, but the explicit clause is correct for all
   * three). `shape` positions the wildcard: `contains` → `%v%`, `starts` → `v%`,
   * `ends` → `%v`.
   */
  private applyLike(
    builder: any,
    method: string,
    field: string,
    value: unknown,
    shape: 'contains' | 'starts' | 'ends',
    negate = false,
  ): void {
    const escaped = String(value).replace(/[\\%_]/g, '\\$&');
    const pattern = shape === 'starts' ? `${escaped}%` : shape === 'ends' ? `%${escaped}` : `%${escaped}%`;
    const keyword = negate ? 'NOT LIKE' : 'LIKE';
    const rawMethod = method.startsWith('or') ? 'orWhereRaw' : 'whereRaw';
    builder[rawMethod](`?? ${keyword} ? ESCAPE ?`, [field, pattern, '\\']);
  }

  /**
   * Apply one comparison node from the array-format (`[field, op, value]`)
   * `where` to the Knex builder, honouring the operator whitelist from
   * `@objectstack/spec` (`VALID_AST_OPERATORS`) plus the alias spellings the
   * ObjectUI client emits (`isnull` / `isnotnull` / `is_empty`, …).
   *
   * Why this is NOT a thin `builder.where(field, op, value)` passthrough
   * (issue #2704): an unrecognised operator used to be forwarded to Knex
   * verbatim. Knex then either rejected it with a 400 (`is_empty` →
   * "operator not permitted", blanking the whole grid) or — when the comparand
   * was `null` — silently compiled a clause that matched EVERY row
   * (`isnull` / `is`). On a permission- or assignment-scoped list view that
   * silent full-table scan is a data leak, strictly worse than an error. So
   * null predicates compile to a real `IS NULL` / `IS NOT NULL` (unified with
   * the `{field, equals, null}` path), and any operator off the whitelist
   * throws instead of ever reaching Knex.
   */
  protected applyAstComparison(
    builder: any,
    join: 'and' | 'or',
    field: string,
    op: string,
    rawValue: unknown,
    coerced: unknown,
  ): void {
    const where = join === 'or' ? 'orWhere' : 'where';
    const whereNull = join === 'or' ? 'orWhereNull' : 'whereNull';
    const whereNotNull = join === 'or' ? 'orWhereNotNull' : 'whereNotNull';
    const opLower = String(op).toLowerCase();

    switch (opLower) {
      // Equality — 2-arg form so Knex renders `IS NULL` for a null comparand,
      // keeping the `{field, equals, null}` path working.
      case '=':
      case '==':
        builder[where](field, coerced);
        return;
      case '!=':
      case '<>':
        // `<> NULL` matches nothing; a null comparand means "has any value".
        if (coerced == null) builder[whereNotNull](field);
        else builder[where](field, '<>', coerced);
        return;
      case '>':
      case '>=':
      case '<':
      case '<=':
      case 'like':
      case 'ilike':
        builder[where](field, opLower, coerced);
        return;
      case 'in':
        builder[join === 'or' ? 'orWhereIn' : 'whereIn'](field, coerced as any[]);
        return;
      case 'nin':
      case 'not_in':
      case 'notin':
        builder[join === 'or' ? 'orWhereNotIn' : 'whereNotIn'](field, coerced as any[]);
        return;
      case 'between': {
        const arr = Array.isArray(coerced) ? coerced : [];
        if (arr.length !== 2) {
          throw new Error(`[sql-driver] operator "between" on field "${field}" requires a [min, max] value array.`);
        }
        builder[join === 'or' ? 'orWhereBetween' : 'whereBetween'](field, arr as [any, any]);
        return;
      }
      case 'contains':
        this.applyLike(builder, where, field, rawValue, 'contains');
        return;
      case 'notcontains':
      case 'not_contains':
        this.applyLike(builder, where, field, rawValue, 'contains', true);
        return;
      case 'startswith':
      case 'starts_with':
        this.applyLike(builder, where, field, rawValue, 'starts');
        return;
      case 'endswith':
      case 'ends_with':
        this.applyLike(builder, where, field, rawValue, 'ends');
        return;
      // Null / empty predicates — value-independent, unified with `equals`+null.
      case 'is_null':
      case 'isnull':
      case 'is_empty':
      case 'isempty':
      case 'empty':
        builder[whereNull](field);
        return;
      case 'is_not_null':
      case 'isnotnull':
      case 'is_not_empty':
      case 'isnotempty':
      case 'not_empty':
      case 'notempty':
      case 'is_set':
      case 'set':
        builder[whereNotNull](field);
        return;
      default:
        throw new Error(
          `[sql-driver] Unsupported filter operator "${op}" on field "${field}". Supported operators: ` +
            `=, !=, <, <=, >, >=, in, nin, between, contains, not_contains, starts_with, ends_with, ` +
            `is_null, is_not_null (see @objectstack/spec VALID_AST_OPERATORS).`,
        );
    }
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
      } else if (key === '$not' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // Spec LOGICAL_OPERATORS declares `$not` alongside `$and`/`$or`; both
        // driver-mongodb and driver-memory implement it, and CEL `!expr` in a
        // permission/scope rule compiles to `{ $not: {...} }` (cel-to-filter.ts).
        // Without this branch `$not` fell through to the field handler, was
        // treated as a column named "$not", and produced wrong SQL — the same
        // class of silent filter-bypass this fix (issue #2704) closes.
        const notMethod = logicalOp === 'or' ? 'orWhereNot' : 'whereNot';
        (builder as any)[notMethod]((qb: any) => {
          this.applyFilterCondition(qb, value, 'and', table);
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
              // `<> NULL` matches nothing; a null comparand means "has any value".
              if (coerced == null) (builder as any)[logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull'](field);
              else (builder as any)[method](field, '<>', coerced);
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
            // `$regex` reaches SQL only via the better-auth adapter, which emits
            // it for a `contains` search (a plain substring, not a real regex).
            // SQL has no portable regex, so compile the intended substring LIKE
            // — correct for that producer and safe (the value is LIKE-escaped),
            // where the old equality default silently made it an exact match.
            case '$regex':
              this.applyContainsLike(builder, method, field, opValue);
              break;
            case '$notContains':
              this.applyLike(builder, method, field, opValue, 'contains', true);
              break;
            case '$startsWith':
              this.applyLike(builder, method, field, opValue, 'starts');
              break;
            case '$endsWith':
              this.applyLike(builder, method, field, opValue, 'ends');
              break;
            case '$between': {
              const arr = Array.isArray(coerced) ? coerced : [];
              if (arr.length !== 2) {
                throw new Error(`[sql-driver] operator "$between" on field "${field}" requires a [min, max] value array.`);
              }
              (builder as any)[logicalOp === 'or' ? 'orWhereBetween' : 'whereBetween'](field, arr as [any, any]);
              break;
            }
            // `{ $null: true }` → IS NULL, `{ $null: false }` → IS NOT NULL.
            // Also the SQL rendering of the AST `is_null`/`is_not_null` operators
            // (spec `parseFilterAST` maps those to `$null`). Previously this fell
            // to the equality default and compiled `field = true`, silently
            // returning the wrong rows (issue #2704).
            case '$null':
              (builder as any)[opValue === false
                ? (logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull')
                : (logicalOp === 'or' ? 'orWhereNull' : 'whereNull')](field);
              break;
            // Mongo `$exists`: a present field is a non-null column in SQL.
            case '$exists':
              (builder as any)[opValue === false
                ? (logicalOp === 'or' ? 'orWhereNull' : 'whereNull')
                : (logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull')](field);
              break;
            default:
              throw new Error(
                `[sql-driver] Unsupported filter operator "${op}" on field "${field}". Supported operators: ` +
                  `$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $between, $contains, $notContains, ` +
                  `$startsWith, $endsWith, $regex, $null, $exists.`,
              );
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

  /**
   * The driver-native column DEFAULT for a `defaultValue: 'NOW()'` field.
   *
   * Postgres/MySQL use native `now()` — a real zone-aware TIMESTAMP that never
   * had the ambiguity below. SQLite has no timestamp type and `knex.fn.now()`
   * compiles to `CURRENT_TIMESTAMP`, which renders a timezone-NAIVE,
   * space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone). `Date.parse`
   * reads such a zone-less string as LOCAL time, so a stored UTC wall-clock
   * shifts by the host offset on a non-UTC runtime — the same class of bug
   * ADR-0074 fixed for the builtin audit columns. Emit a canonical instead:
   *   - datetime → ISO-8601 with explicit `Z` (`2026-06-26T10:34:13.891Z`),
   *                matching `new Date().toISOString()` and the value
   *                `formatInput`'s `NOW()` safety-net writes;
   *   - date     → `YYYY-MM-DD` UTC calendar day (matches `toDateOnly`, so the
   *                stored default already equals what an explicit write stores);
   *   - time     → `HH:MM:SS.fff` UTC time-of-day (not a full timestamp).
   *
   * NOTE: a DDL default only governs NEWLY-created columns. An existing column
   * keeps its legacy `CURRENT_TIMESTAMP` default and still emits naive text on a
   * defaulted insert; `formatOutput` repairs those to canonical on read
   * (`normalizeSqliteDatetimeOutput` for datetime, `toDateOnly` for date), so
   * reads are uniform without a schema migration.
   */
  protected nowColumnDefault(type: string): Knex.Raw {
    if (!this.isSqlite) return this.knex.fn.now();
    switch (type) {
      case 'date': return this.knex.raw("(strftime('%Y-%m-%d', 'now'))");
      case 'time': return this.knex.raw("(strftime('%H:%M:%f', 'now'))");
      // datetime (and any non-temporal field that opts into NOW()): canonical instant.
      default:     return this.knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
    }
  }

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
      // `user` is a lookup specialized to sys_user (ADR: lookup → sys_user). Same
      // physical storage as any lookup: a string column holding the related row id
      // (multiple ⇒ JSON, handled at the top of createColumn). No bespoke storage
      // primitive — it shares this exact DDL path so reads/$expand/FK stay uniform.
      case 'lookup':
      case 'user':
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
      // canonical default (`nowColumnDefault`) so the column gets a real,
      // zone-explicit default instead of leaving the literal string 'NOW()'
      // for whatever upstream code happens to write — and, on SQLite, instead
      // of the timezone-naive `CURRENT_TIMESTAMP` that `knex.fn.now()` emits.
      if (
        (type === 'datetime' || type === 'date' || type === 'time') &&
        isNowDefaultValue(field.defaultValue)
      ) {
        col.defaultTo(this.nowColumnDefault(type));
      } else if (field.defaultValue !== undefined && field.defaultValue !== null) {
        const dv = field.defaultValue;
        if (isNowDefaultValue(dv)) {
          col.defaultTo(this.nowColumnDefault(type));
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

    // JSON field serialisation: PostgreSQL native jsonb columns require
    // valid JSON for ALL values (strings, numbers, booleans, objects).
    // SQLite stores JSON as plain TEXT so only objects/arrays need
    // stringification (better-sqlite3 can only bind primitives).
    const jsonFields = this.jsonFields[object];
    if (jsonFields && jsonFields.length > 0) {
      for (const field of jsonFields) {
        if (copy[field] === undefined || copy[field] === null) continue;
        if (this.isSqlite) {
          // SQLite: only objects/arrays need JSON.stringify; primitives
          // are stored as-is and re-parsed on read by formatOutput.
          if (typeof copy[field] === 'object') {
            if (!copied) { copy = { ...copy }; copied = true; }
            copy[field] = JSON.stringify(copy[field]);
          }
        } else {
          // PostgreSQL: every value must be valid JSON so the native
          // jsonb column accepts it. JSON.stringify wraps strings in
          // quotes, leaves numbers/booleans unchanged as literals.
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = JSON.stringify(copy[field]);
        }
      }
    }

    if (!this.isSqlite) return copy;

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

      // Builtin audit timestamps: repair any legacy/raw row stored as a
      // zone-naive, space-separated string (CURRENT_TIMESTAMP or the pre-fix
      // UPDATE stamp) to canonical ISO-8601 with `Z`, so reads are unambiguous
      // and uniform regardless of when/how the row was written. Idempotent on
      // already-canonical values; mirrors the legacy-row read-repair the
      // `Field.date`/numeric paths already do. See `repairNaiveUtcAuditTimestamp`.
      for (const col of AUDIT_TIMESTAMP_COLUMNS) {
        if (data[col] !== undefined) data[col] = repairNaiveUtcAuditTimestamp(data[col]);
      }

      // Present every `Field.datetime` value as one canonical instant —
      // ISO-8601 with an explicit `Z` — regardless of its on-disk storage form.
      // A SQLite `datetime` column mixes forms: an explicit value bound as a JS
      // `Date` is stored as INTEGER epoch ms, while a `defaultValue: 'NOW()'`
      // slot is TEXT (canonical ISO-`Z` post-fix, or a legacy timezone-naive
      // `CURRENT_TIMESTAMP` string). Without this, reads leak the raw integer or
      // a zone-naive string that `Date.parse` mis-reads as LOCAL time. Folds all
      // shapes to UTC ISO-`Z` and transparently repairs legacy rows with no data
      // migration — mirroring the `Field.date`/numeric read-repairs above and
      // the audit-column repair just above. See `normalizeSqliteDatetimeOutput`.
      const datetimeFields = this.datetimeFields[object];
      if (datetimeFields && datetimeFields.size > 0) {
        for (const field of datetimeFields) {
          if (data[field] !== undefined) {
            data[field] = normalizeSqliteDatetimeOutput(data[field]);
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

    // Present `Field.time` as a wall-clock time-of-day (#2004), repairing a
    // legacy row stored as a full timestamp — what a `defaultValue: 'NOW()'`
    // column took when the SQLite default was still the full `CURRENT_TIMESTAMP`
    // — to just its time portion. A value already stored as a bare time-of-day
    // is left untouched, so this is read-only and asymmetry-free. Runs for every
    // dialect (a native TIME column already returns a time-of-day → no-op). See
    // `toTimeOnly`.
    const timeFields = this.timeFields[object];
    if (timeFields && timeFields.size > 0) {
      for (const field of timeFields) {
        const v = data[field];
        if (v == null) continue;
        const normalized = this.toTimeOnly(v);
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
