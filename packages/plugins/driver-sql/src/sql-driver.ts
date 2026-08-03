// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL Driver for ObjectStack
 *
 * Implements the standard IDataDriver from @objectstack/spec via Knex.js.
 * Supports PostgreSQL, MySQL, SQLite, and other SQL databases.
 */

import type { QueryAST, DriverOptions, SchemaMode } from '@objectstack/spec/data';
import { parseAutonumberFormat, renderAutonumber, missingFieldValues, isTenancyDisabled, isGlobalUnique, isUniqueDeclared, type AutonumberToken } from '@objectstack/spec/data';
import { STRUCTURED_JSON_TYPES, FILE_REFERENCE_TYPES, MULTI_OPTION_TYPES, NUMERIC_VALUE_TYPES } from '@objectstack/spec/data';
import { canonicalAstOperator } from '@objectstack/spec/data';
// `defaultValue` runtime tokens (#4560). The DDL below asks the SPEC — not a
// list of its own — which `defaultValue`s are instructions rather than literals,
// so the engine and this driver can never disagree about what may become a
// physical column DEFAULT.
import { isNowDefaultToken, isRuntimeDefaultToken } from '@objectstack/spec/data';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { StandardErrorCode } from '@objectstack/spec/api';
import { StorageNameMapping } from '@objectstack/spec/system';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import { resolveMultiOrgEnabled } from '@objectstack/types';
import { nextUtcCalendarDay } from '@objectstack/core';
import {
  buildIndexName,
  diffManagedIndexes,
  diffManagedTable,
  driftKey,
  expectedIndexes,
  fieldHasColumn,
  isIndexDriftOp,
  legacyUniqueReplacements,
  uniqueIndexesFromFields,
  type ManagedDriftEntry,
  type DriftOp,
  type PhysicalIndex,
  type SqlDialectName,
  type PhysicalColumn,
  type PendingSchemaWork,
} from './schema-drift.js';
import knex, { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { currentPerfTiming, perfNow, type PerfTiming } from '@objectstack/observability';

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
  // Spec value-shape classes (ADR-0104 D1): structured JSON payloads, the
  // (pre-D3) inline file metadata objects, and the inherently-array option
  // types. Membership is owned by @objectstack/spec — a type added there
  // becomes a JSON column here without touching this file.
  ...STRUCTURED_JSON_TYPES, ...FILE_REFERENCE_TYPES, ...MULTI_OPTION_TYPES,
  // Driver-internal aliases (external/introspected columns) — not authorable
  // FieldTypes, so they stay a local extra.
  'object', 'array',
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
  // Spec numeric value class (ADR-0104 D1) + driver-internal SQL aliases.
  ...NUMERIC_VALUE_TYPES,
  'integer', 'int', 'float',
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
 * tolerant.
 *
 * Thin alias over the spec's {@link isNowDefaultToken} — the token vocabulary
 * itself lives in `@objectstack/spec/data` so the engine's insert-time
 * resolution and this driver's DDL read one set (#4560).
 */
const isNowDefaultValue = isNowDefaultToken;

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

/**
 * The CANONICAL on-disk form of a `Field.datetime` value: a fixed-width,
 * zone-explicit UTC instant — `YYYY-MM-DDTHH:MM:SS.sssZ` (`Date#toISOString`).
 *
 * ADR-0053 already declares `datetime` to be "an instant stored as UTC"; this is
 * the function that makes the STORAGE match the declaration instead of leaving
 * it to whatever the caller happened to pass. It is applied on write
 * ({@link SqlDriver.formatInput}) and to filter comparands
 * ({@link SqlDriver.coerceFilterValue}) so both sides of every comparison are
 * the same shape, on every dialect.
 *
 * Why THIS form (#3912):
 *   - Fixed width + UTC means lexicographic order IS chronological order, so a
 *     SQLite TEXT column sorts and range-compares correctly *through an index* —
 *     no expression wrapper, which is what an epoch-integer convention forces.
 *   - `strftime`/`julianday` parse it directly, so the date-bucket expression
 *     needs no epoch↔text CASE (#3773).
 *   - It is what `formatOutput`/`normalizeSqliteDatetimeOutput` ALREADY present
 *     on read, so storage and presentation stop disagreeing.
 *   - It matches the `Field.date` convention (ISO TEXT), so the platform has one
 *     temporal storage story rather than one per field type.
 *   - Postgres parses it into `timestamptz` unambiguously, which is precisely
 *     what a zone-naive string does NOT do (it is read in the SERVER's
 *     timezone — an 8-hour shift on an Asia/Shanghai server).
 *
 * Distinct from {@link repairNaiveUtcAuditTimestamp}, which is deliberately
 * idempotent on any zone-EXPLICIT string and so preserves a `+08:00` offset.
 * That is right for a read repair and wrong for a storage canon: `'…T12:00+08:00'`
 * and `'…T04:00Z'` are the same instant but sort differently as text. Everything
 * lands in `Z` here.
 *
 * Total: `null`/`undefined`, empty strings and unparseable junk pass through
 * untouched rather than becoming `Invalid Date` — a value the driver cannot
 * interpret is never silently rewritten.
 */
function canonicalUtcDatetime(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return value;
  // A bare integer (in either JS or string form) is epoch milliseconds — the
  // shape better-sqlite3 wrote for every `Date` bound before this convention.
  if (/^-?\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // A bare calendar day means midnight UTC. Stated explicitly so it cannot be
  // re-read as midnight in the server's local zone — the Postgres divergence
  // where the same query lands a row on a different calendar day.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    // Zone-naive `YYYY-MM-DD[ T]HH:MM[:SS[.fff]]` → its wall-clock IS UTC, the
    // same rule `CURRENT_TIMESTAMP`-written rows take on read (ADR-0074).
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

/**
 * The canonical instant rendered as a MySQL datetime literal — the same UTC wall
 * clock, spelled the only way MySQL will parse it (#3942).
 *
 * MySQL/MariaDB reject the ISO-8601 the rest of the platform speaks: neither the
 * `T` separator nor the `Z` suffix is accepted in a datetime literal, so
 * `'2026-03-20T12:34:56.789Z'` fails the INSERT outright with *Incorrect datetime
 * value* (measured on MariaDB 10.11). MySQL 8.0.19+ added `±HH:MM` offsets, but
 * still not `Z`, and the platform supports older servers — so the offset is
 * dropped and the value is stored as the UTC wall clock in a `DATETIME(3)`
 * column, which does no timezone conversion of its own.
 *
 * This is a PHYSICAL spelling, not a semantic change: the column still holds the
 * same instant, and every layer above the bind — API payloads, filter authoring,
 * CEL — keeps the canonical `…Z` form. Reads convert back (the connection is
 * pinned to UTC, so mysql2 reconstructs the instant correctly).
 *
 * Total, and deliberately strict: only an exactly-canonical string is rewritten.
 * Anything else — an unparseable value `canonicalUtcDatetime` passed through, or
 * a year outside MySQL's 1000..9999 range, which `toISOString` renders in
 * expanded `+0YYYYY` form — is handed to MySQL untouched, so it fails loudly
 * rather than being silently reinterpreted.
 */
function mysqlDatetimeLiteral(canonical: unknown): unknown {
  if (typeof canonical !== 'string') return canonical;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}\.\d{3})Z$/.exec(canonical);
  return m ? `${m[1]} ${m[2]}` : canonical;
}

/**
 * The CANONICAL form of a `Field.time` value: a timezone-naive wall-clock
 * time-of-day — `HH:MM:SS`, with a `.fff` millisecond suffix only when the
 * milliseconds are non-zero (#3994).
 *
 * `Field.time` is a time-of-day, not an instant (#2004), so unlike
 * {@link canonicalUtcDatetime} there is no zone marker — but the same
 * write-unnormalised / repair-on-read drift produced the same broken window
 * filters as #3912: a bound `Date` stored INTEGER epoch ms on SQLite (sorts
 * before every TEXT row), a full ISO string stored as text beginning `'2026-…'`
 * (sorts after every bare time-of-day), and `09:00 <= t <= 18:00` silently
 * dropped both. This function is applied on write
 * ({@link SqlDriver.formatInput}), to filter comparands
 * ({@link SqlDriver.coerceFilterValue}) and on read
 * ({@link SqlDriver.toTimeOnly}), so both sides of every comparison — and the
 * presented value — are one shape.
 *
 * Why THIS form:
 *   - `.` sorts below every digit, so lexicographic order is chronological
 *     order even with the variable-width suffix (`'14:30:00.100' <
 *     '14:30:01'`), and a SQLite TEXT column range-compares through an index.
 *   - Deterministic per time-of-day: `'14:30'` and `'14:30:00'` are the same
 *     wall clock and canonicalise identically, so equality filters and
 *     `distinct()` cannot split one time into several values.
 *   - The zero-millisecond spelling is `HH:MM:SS` — the shape every dialect's
 *     native TIME emits and the field-zoo round-trip (#2022) already asserts —
 *     so converged common-case data never changes presentation.
 *   - Every dialect parses it: SQLite stores the text verbatim, Postgres
 *     `time` and MySQL `TIME(3)` both accept `HH:MM:SS[.fff]` literals — which
 *     the full-ISO spelling is precisely NOT (measured: `invalid input syntax
 *     for type time` on PG 16, `Incorrect time value` on MariaDB 10.11).
 *
 * A `Date` / epoch-ms / full-timestamp string folds to its **UTC** time-of-day
 * (ADR-0053): the platform's instants are UTC everywhere else, and it matches
 * what the SQLite read repair and `nowColumnDefault` already produced —
 * crucially it does NOT depend on the Node process's local timezone, which is
 * exactly what binding a raw `Date` to a Postgres TIME column did (pg
 * serialised `14:30Z` as `09:30-05:00` on an America/New_York host). Fractions
 * beyond milliseconds are truncated, matching `Date` resolution.
 *
 * Total: `null`/`undefined`, empty strings, out-of-range wall clocks (`'25:00'`)
 * and unparseable junk pass through untouched — a value the driver cannot
 * interpret is never silently rewritten.
 */
function canonicalTimeOfDay(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return value;
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s);
    if (m) {
      const [, hh, mm, ss = '00', frac] = m;
      if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return value;
      const ms = frac ? `${frac}000`.slice(0, 3) : '000';
      return ms === '000' ? `${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}.${ms}`;
    }
  }
  // Everything that is not a bare time-of-day — `Date`, epoch ms, full ISO or
  // zone-naive timestamp strings — is an instant: delegate its interpretation
  // to the ONE function that owns instants, then keep the UTC time-of-day.
  const instant = canonicalUtcDatetime(value);
  if (typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    const time = instant.slice(11, 23);
    return time.endsWith('.000') ? time.slice(0, 8) : time;
  }
  return value;
}

/**
 * How many times {@link SqlDriver.sqliteCanonicalTimeSql} spells its column
 * reference — the binding count a caller must supply per use of the expression.
 * (1 `typeof` + 3 per `strftime` CASE branch pair × 2 + 1 `coalesce` fallback.)
 */
const SQLITE_TIME_EXPR_REFS = 8;

/**
 * [#4436] A filter this driver cannot COMPILE — the caller sent an operator (or
 * an operand shape) outside what the backend can express.
 *
 * This is a refusal the request caused, and #4209/#4029 already made it a
 * refusal rather than a silent match-everything. What was missing is the wire
 * IDENTITY of that refusal: the thrown `Error` carried no `code`, so
 * `mapDataError`'s default branch served `{ "error": "<message>" }` with no
 * `code` at all — breaking the ADR-0112 contract that `error.code` is the
 * schema-enforced SCREAMING_SNAKE vocabulary every sibling rejection on this
 * route already speaks (`INVALID_FIELD`, `INVALID_FILTER`, `RECORD_NOT_FOUND`).
 *
 * `INVALID_FILTER` is the catalogued code for the condition, and the SAME one
 * `metadata-protocol` emits for a filter that fails to parse upstream
 * (`malformedFilterArrayError` / `unusableFilterError`): one condition — "this
 * filter cannot run" — has one wire code however the caller reached it.
 *
 * `status: 400` makes `@objectstack/rest`'s `sendError` pass the message
 * through instead of routing it to the SQL-leak heuristic, and puts the
 * rejection on the `isExpectedQueryRejection` list so a client mistake stops
 * being logged as an unhandled server error.
 *
 * The `[sql-driver]` prefix these messages used to carry is GONE from the text:
 * it is driver-internal wording, and shipping it to clients is exactly what the
 * #3867 sanitiser exists to stop. The operator/field/vocabulary detail — the
 * part a caller can act on — stays.
 */
function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
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
/**
 * How a stored column value must be reshaped to become the value a `find()` row
 * presents. One entry per rule `formatOutput` applies to a scalar column; the
 * read paths that bypass `formatOutput` (`aggregate`, `distinct`) name the rule
 * per column instead. See {@link SqlDriver.readPresentationKind}.
 */
export type ReadPresentationKind = 'datetime' | 'date' | 'time' | 'boolean' | 'number';

/**
 * Journal modes the driver knows how to ask a file-backed SQLite database for.
 * See {@link SqlDriver.applySqliteJournalMode} for why `'wal'` is the default
 * and what `'delete'` is for.
 */
export type SqliteJournalMode = 'wal' | 'delete';

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
  /**
   * Journal mode for a **file-backed** SQLite database (#3941). Defaults to
   * `'wal'`, which is what lets a dev server and a CLI command share one file
   * without serializing against each other. `'delete'` restores SQLite's
   * built-in rollback journal — the escape hatch for a database on a network
   * filesystem, where WAL cannot work. Ignored for `:memory:` and for
   * non-SQLite dialects; overridable per deployment with
   * `OS_DATABASE_SQLITE_JOURNAL_MODE`.
   *
   * @see {@link SqlDriver.applySqliteJournalMode}
   */
  sqliteJournalMode?: SqliteJournalMode;
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
  /**
   * Capability advertisement (#4634, ADR-0049): only the bits with an engine
   * reader survive — everything the old 30-bit literal declared (transactions,
   * joins, filters, …) is expressed by the methods this class implements, and
   * subclasses (`SqliteWasmDriver`, cloud's `TursoDriver`) inherit or spread
   * this getter, so keep it truthful per instance.
   */
  public get supports() {
    return {
      /**
       * Per-granularity native date bucket support. Granularities marked
       * `false` (or absent) fall back to in-memory `bucketDateValue()` via
       * `engine.findData` — see `buildDateBucketExpr()` for the SQL emitted.
       */
      queryDateGranularity: this.dateGranularityCapabilities,
      // Persistent, atomic autonumber sequences via `_objectstack_sequences`
      // (see fillAutoNumberFields / getNextSequenceValue). The engine defers
      // autonumber generation to this driver — it is the single source of truth.
      autonumber: true,
      // No syncSchemasBatch() here: the engine calls syncSchema() per object.
      // Subclasses whose transport batches (Turso) implement the method AND
      // flip this bit — the engine requires both.
      batchSchemaSync: false,
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
   * SQLite `Field.datetime` columns proven to hold ONLY canonical UTC text —
   * either backfilled by {@link backfillCanonicalDatetimes} or created empty in
   * this process. Read by {@link needsLegacyDatetimeRepair} to drop the repair
   * expression, so a migrated deployment gets plain indexable `col op ?` SQL.
   */
  protected canonicalDatetimeFields: Record<string, Set<string>> = {};
  protected timeFields: Record<string, Set<string>> = {};
  /**
   * The `Field.time` twin of {@link canonicalDatetimeFields} (#3994): columns
   * known to hold only canonical `HH:MM:SS[.fff]` text — backfilled by
   * {@link backfillCanonicalTimes} or created empty in this process. Read by
   * {@link needsLegacyTimeRepair} to drop the repair expression.
   */
  protected canonicalTimeFields: Record<string, Set<string>> = {};
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
  /** Tables this driver created since connect — see `getSchemaSyncStats`. */
  protected tablesCreatedHere: Set<string> = new Set();
  /** Tables that were already present when this driver first touched them. */
  protected tablesFoundExisting: Set<string> = new Set();
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
   *
   * Entries are overwritten on every (re-)registration; the sticky
   * {@link tenantOptOutByTable} record keeps an explicit `tenancy.enabled:false`
   * declaration from being lost to a later partial re-registration.
   */
  protected tenantFieldByTable: Record<string, string | null> = {};

  /**
   * Tables whose schema EXPLICITLY declared `tenancy.enabled === false`.
   * Sticky across re-registrations: a later registration that omits the
   * `tenancy` block (lifecycle archive `syncSchema`, schema-drift re-sync,
   * partial-schema callers) must NOT resurrect org-scoping via the implicit
   * `organization_id` heuristic — that is how a platform-global object like
   * `sys_license` ends up org-scoped and its NULL-org rows vanish for
   * org-context reads (#3249). A registration that DOES carry a `tenancy`
   * declaration is authoritative and updates/clears the entry.
   */
  protected tenantOptOutByTable: Set<string> = new Set();

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
   *
   * `table` is the coercion key of the object being aggregated (what
   * {@link coercionKey} returns for the builder). It is what makes the SQLite
   * expression storage-aware — see {@link sqliteTemporalArg}. Omitting it yields
   * the plain column form, which is correct for any TEXT-stored column.
   */
  protected buildDateBucketExpr(
    field: string,
    granularity: 'day' | 'week' | 'month' | 'quarter' | 'year',
    table?: string | null,
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
      // `arg` is a bare `??` for a TEXT-stored column and an epoch→julian-day
      // normalization for a `Field.datetime` one (#3773).
      const { sql: arg, bindings: argBindings } = this.sqliteTemporalArg(field, table);
      const fmt = (f: string) => ({ sql: `strftime('${f}', ${arg})`, bindings: [...argBindings] });
      switch (granularity) {
        case 'year':    return fmt('%Y');
        case 'month':   return fmt('%Y-%m');
        case 'day':     return fmt('%Y-%m-%d');
        case 'quarter': return { sql: `(strftime('%Y', ${arg}) || '-Q' || ((cast(strftime('%m', ${arg}) as integer) - 1) / 3 + 1))`, bindings: [...argBindings, ...argBindings] };
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
   * The journal mode the host declared, if any (#3941). Kept unresolved so an
   * absent declaration can still defer to the environment at connect time —
   * see {@link resolveSqliteJournalMode}.
   */
  protected readonly declaredJournalMode?: SqliteJournalMode;

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

  /**
   * Objects already reported as unable to keep the deterministic-paging
   * contract (objectstack#4363) — see {@link orderKeysFor}. One line per
   * object, not per query.
   */
  protected nondeterministicPagingWarned = new Set<string>();

  /** Deferred-DDL mode (#3917) — see {@link setDeferredDdl}. */
  protected deferredDdl = false;

  /** Object defs `initObjects` registered but did not physically sync while {@link deferredDdl}. */
  protected deferredSchemaObjects = new Map<string, { name: string; fields?: Record<string, any> }>();

  constructor(config: SqlDriverConfig) {
    // `schemaMode` / `autoMigrate` / `sqliteJournalMode` are ObjectStack
    // concerns, not Knex options — strip them before handing the config to Knex.
    const { schemaMode, autoMigrate, sqliteJournalMode, ...knexConfig } = config;
    this.schemaMode = schemaMode ?? 'managed';
    this.autoMigrate = autoMigrate ?? 'off';
    this.declaredJournalMode = sqliteJournalMode;
    this.config = knexConfig;
    this.knex = knex(SqlDriver.withConnectBound(knexConfig));
    this.installQueryTiming();
  }

  /**
   * Default bound on establishing ONE connection (framework#3769).
   *
   * A database endpoint that accepts the TCP connection but never completes the
   * handshake — an overloaded instance, a half-open firewall, a load balancer
   * mid-failover — is the failure mode that hurts most, because nothing fails:
   * the query just waits. Left to tarn's default that wait is **30 seconds**,
   * per query, on the request path; with a small `pool.max` a handful of them
   * saturate the pool and everything queues behind it.
   *
   * 10s matches driver-mongodb's existing `connectTimeoutMS ?? 10_000`, so both
   * drivers give up on an unreachable server at the same point. A host that
   * knows better (a deliberately slow cross-region replica) sets its own
   * `pool.createTimeoutMillis` and this leaves it alone.
   *
   * Applied in two layers, because the outer one bounds the wait but misstates
   * the cause. Knex reports its own timeout as "Timeout acquiring a connection.
   * The pool is probably full" — which sends an operator to tune `pool.max`
   * while the actual problem is the network. So each network dialect ALSO gets
   * its own connect timeout, which fails with a message that names what really
   * happened (`timeout expired` from pg, `connect ETIMEDOUT` from mysql2).
   *
   * **The two bounds must not be equal.** They race, and knex wins a tie — set
   * to the same value, the pool timeout fires first and the accurate message is
   * never seen (caught by the black-hole test, which asserts the wording). So
   * the dialect timeout is the effective bound at 10s and the pool timeout is a
   * strictly looser backstop at 15s, reached only by a dialect that has no
   * connect-timeout knob (SQLite) or ignores the one we set.
   */
  private static readonly DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
  private static readonly DEFAULT_CREATE_TIMEOUT_MS = 15_000;

  /**
   * Per-dialect connect timeout: how the driver spells "how long may
   * establishing ONE connection take", and where a URL goes once `connection`
   * has to become an object to carry it.
   *
   * SQLite (`better-sqlite3` / `sqlite3`) is deliberately absent — it opens a
   * file, so there is no handshake to time out and nothing to inject.
   */
  private static readonly DIALECT_CONNECT_TIMEOUT: Record<string, { key: string; urlKey: string }> = {
    pg: { key: 'connectionTimeoutMillis', urlKey: 'connectionString' },
    postgres: { key: 'connectionTimeoutMillis', urlKey: 'connectionString' },
    postgresql: { key: 'connectionTimeoutMillis', urlKey: 'connectionString' },
    cockroachdb: { key: 'connectionTimeoutMillis', urlKey: 'connectionString' },
    mysql: { key: 'connectTimeout', urlKey: 'uri' },
    mysql2: { key: 'connectTimeout', urlKey: 'uri' },
  };

  private static withConnectBound(knexConfig: Record<string, any>): Record<string, any> {
    const pool = knexConfig.pool as Record<string, any> | undefined;
    const bounded: Record<string, any> =
      pool?.createTimeoutMillis === undefined
        ? {
          ...knexConfig,
          pool: { ...(pool ?? {}), createTimeoutMillis: SqlDriver.DEFAULT_CREATE_TIMEOUT_MS },
        }
        : { ...knexConfig }; // host chose its own bound — respect it

    const dialect = SqlDriver.DIALECT_CONNECT_TIMEOUT[String(knexConfig.client ?? '')];
    if (!dialect) return bounded; // sqlite / unknown client — nothing to inject

    const conn = knexConfig.connection;
    if (typeof conn === 'string') {
      // The URL must move into the dialect's own URL slot so the timeout can
      // ride alongside it. Verified for both dialects: the connection attempt
      // still goes to the URL's host/port, `?sslmode=` is still honoured.
      bounded.connection = {
        [dialect.urlKey]: conn,
        [dialect.key]: SqlDriver.DEFAULT_CONNECT_TIMEOUT_MS,
      };
    } else if (conn && typeof conn === 'object' && (conn as any)[dialect.key] === undefined) {
      bounded.connection = { ...(conn as object), [dialect.key]: SqlDriver.DEFAULT_CONNECT_TIMEOUT_MS };
    }
    // A function-valued `connection` (knex's per-acquire provider) is left
    // alone: the host is building each connection itself and owns its timeouts.
    return SqlDriver.withUtcSession(bounded);
  }

  /**
   * Pin a MySQL connection to UTC, in both directions (#3942).
   *
   * MySQL is the one supported dialect where the SESSION timezone participates
   * in what a datetime means, on two independent layers, and both default to
   * something machine-dependent:
   *
   *   - **mysql2** (`connection.timezone`, default `'local'`) decides how a bound
   *     JS `Date` is rendered and how a returned `DATETIME` string is parsed back.
   *     Left at `'local'`, two app servers in different zones write the same
   *     instant as different values, and read the same row as different instants.
   *   - **The server** (`@@session.time_zone`, default `SYSTEM`) decides how a
   *     zone-naive literal is interpreted for a `TIMESTAMP` column, and what
   *     `CURRENT_TIMESTAMP` renders. Measured at 8 hours off on a server
   *     configured `+08:00`.
   *
   * Setting both to UTC makes the wall clock the driver writes *be* the instant,
   * which is what {@link mysqlDatetimeLiteral} relies on — and it keeps legacy
   * `TIMESTAMP` columns correct too, so a deployment stays right whether or not
   * the `DATETIME(3)` migration has run.
   *
   * A host that set either one explicitly is left alone; an existing
   * `pool.afterCreate` is chained rather than replaced, since it is a documented
   * knex extension point the host may already be using.
   */
  private static withUtcSession(knexConfig: Record<string, any>): Record<string, any> {
    const client = String(knexConfig.client ?? '');
    if (client !== 'mysql' && client !== 'mysql2') return knexConfig;

    const out: Record<string, any> = { ...knexConfig };
    const conn = out.connection;
    if (conn && typeof conn === 'object' && (conn as any).timezone === undefined) {
      out.connection = { ...(conn as object), timezone: 'Z' };
    }

    const pool = (out.pool ?? {}) as Record<string, any>;
    const hostAfterCreate = pool.afterCreate as
      | ((conn: unknown, done: (err?: unknown) => void) => void)
      | undefined;
    out.pool = {
      ...pool,
      afterCreate(connection: any, done: (err?: unknown, conn?: unknown) => void) {
        connection.query(`SET time_zone = '+00:00'`, (err: unknown) => {
          if (err) return done(err);
          if (!hostAfterCreate) return done(undefined, connection);
          hostAfterCreate(connection, (hostErr?: unknown) => done(hostErr, connection));
        });
      },
    };
    return out;
  }

  /**
   * Per-request SQL query timing (perf-tuning mode). Correlates knex's
   * `query` → `query-response` / `query-error` events by `__knexQueryUid` and
   * folds each query's wall time into the ambient request collector's `db`
   * aggregate — one `Server-Timing` member carrying total DB time **and** a
   * query count, the number most useful for spotting N sequential round-trips
   * in DevTools → Network → Timing.
   *
   * Attribution is captured at `query` time, which runs inside the initiating
   * request's `AsyncLocalStorage` scope (knex emits it synchronously from the
   * runner after connection acquisition, still on the awaited call chain), so
   * concurrent requests never cross-attribute. When perf-tuning is off,
   * {@link currentPerfTiming} is `undefined` and the listener returns at once —
   * nothing is tracked and the map stays empty, so the cost is a single ALS
   * lookup per query.
   *
   * The aggregate records only durations and a count — never SQL text — so the
   * `Server-Timing` header can be surfaced without leaking query shapes to
   * non-admins. When an admin opts into DETAIL mode (`X-OS-Debug-Timing: json`,
   * admin-gated), each query's PARAMETRIZED statement (knex's `q.sql`, which
   * carries `?` placeholders — the bindings live separately and are NEVER
   * recorded) is additionally captured so the admin-only detail payload can list
   * the slowest queries by shape. Literal row values never enter the collector.
   */
  private installQueryTiming(): void {
    // uid → { start, collector }, populated only while a collector is active,
    // and always removed when the query settles (bounded by in-flight queries).
    const inflight = new Map<string, { t0: number; timing: PerfTiming }>();
    this.knex.on('query', (q: any) => {
      const timing = currentPerfTiming();
      if (!timing) return;
      const uid = q?.__knexQueryUid;
      if (typeof uid === 'string') inflight.set(uid, { t0: perfNow(), timing });
    });
    const settle = (q: any): void => {
      const uid = q?.__knexQueryUid;
      if (typeof uid !== 'string') return;
      const rec = inflight.get(uid);
      if (!rec) return;
      inflight.delete(uid);
      const dur = perfNow() - rec.t0;
      rec.timing.count('db', dur, 'queries');
      // Admin-gated detail mode: keep the query SHAPE (parametrized SQL, no
      // bindings) so the slowest queries can be surfaced. `recordDetail` is a
      // no-op unless detail capture is on, so this is free on the normal path.
      if (rec.timing.detailEnabled && typeof q?.sql === 'string') {
        rec.timing.recordDetail('db', q.sql, dur);
      }
    };
    this.knex.on('query-response', (_response: any, q: any) => settle(q));
    this.knex.on('query-error', (_error: any, q: any) => settle(q));
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

    if (this.isSqlite) {
      // Both pragmas below are persistent properties of the FILE, so one
      // connection setting them is enough for every process that follows.
      // A `false` means the very first statement on this connection failed —
      // in practice a native addon that cannot load — so asking it for another
      // pragma would only repeat the same warning.
      if (await this.applyAutoVacuumIncremental()) {
        await this.applySqliteJournalMode();
      }
    }
  }

  /**
   * SQLite space hygiene (ADR-0057). With the default `auto_vacuum=NONE`,
   * freed pages are never returned to the OS — a database that briefly grew
   * (e.g. high-frequency telemetry before retention sweeps run) stays at its
   * high-water mark forever. INCREMENTAL lets a later `PRAGMA incremental_vacuum`
   * (run by the lifecycle Reaper, or manually) reclaim that space without a
   * full blocking VACUUM. NOTE: auto_vacuum only changes layout on a *fresh*
   * database or after a one-time full VACUUM, so this benefits new dev DBs;
   * existing files need a single `VACUUM` to adopt it. Harmless / no-op on
   * :memory: and on already-incremental databases. Unaffected by the journal
   * mode: an INCREMENTAL database keeps reclaiming under WAL.
   *
   * @returns whether the PRAGMA went through. This is the first statement any
   * connection runs, so `false` says the connection itself is not answering —
   * not merely that space hygiene is unavailable.
   */
  private async applyAutoVacuumIncremental(): Promise<boolean> {
    try {
      await this.knex.raw('PRAGMA auto_vacuum = INCREMENTAL');
      return true;
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
      return false;
    }
  }

  /**
   * Env override for the SQLite journal mode — the ops-side escape hatch for a
   * deployment whose filesystem cannot host WAL.
   */
  private static readonly SQLITE_JOURNAL_MODE_ENV = 'OS_DATABASE_SQLITE_JOURNAL_MODE';

  /**
   * Which journal mode to ask this file-backed database for.
   *
   * An explicit `sqliteJournalMode` in the driver config outranks the
   * environment: it is a decision the host made about this datasource, while
   * the env var is a blanket per-deployment setting. Anything unrecognised is
   * reported and ignored rather than silently treated as an opt-out — a typo
   * must not quietly leave a database serialized.
   */
  protected resolveSqliteJournalMode(): SqliteJournalMode {
    const fromEnv = (process.env[SqlDriver.SQLITE_JOURNAL_MODE_ENV] ?? '').trim().toLowerCase();
    const requested = this.declaredJournalMode ?? (fromEnv || undefined);
    if (requested === undefined) return 'wal';
    if (requested === 'wal' || requested === 'delete') return requested;
    this.logger.warn(
      `Ignoring SQLite journal mode '${requested}' (expected 'wal' or 'delete') — using 'wal'`,
    );
    return 'wal';
  }

  /**
   * Whether this transport can hold its database in WAL mode.
   *
   * True for a real SQLite file. Overridden to `false` by a transport whose
   * "file" is a byte image it serializes itself (`SqliteWasmDriver`): no other
   * process reads its live database, so a persistent mode change made for
   * cross-process concurrency buys it nothing.
   */
  protected get supportsWalJournal(): boolean {
    return true;
  }

  /**
   * Put a file-backed SQLite database in WAL mode (#3941).
   *
   * ObjectStack's normal shape is **several processes on one file**: a dev
   * server, `os migrate`, `os meta resync`, a test run. SQLite's built-in
   * default — `journal_mode = delete`, a rollback journal — is the worst mode
   * for that, in two measured ways:
   *
   *   - **A writer must wait for every reader.** Committing a rollback journal
   *     takes an EXCLUSIVE lock, which cannot coexist with a reader, so an
   *     `os migrate` write serializes behind whatever the live server is
   *     reading (`SQLITE_BUSY`). Under WAL neither direction blocks: readers
   *     see the last committed snapshot while a writer appends.
   *   - **An attached connection leaves no trace.** Rollback-journal locks
   *     exist only for the duration of a transaction, so an idle `os serve` is
   *     invisible to SQL — which is what defeated the first cut of the
   *     `os migrate` occupancy check (#3924) and forced it onto file-descriptor
   *     inspection (#3940). Under WAL the SQL probe
   *     (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE`) reports `SQLITE_BUSY`
   *     against an idle attached connection, so it becomes authoritative
   *     instead of a fallback.
   *
   * Journal mode is a **persistent property of the file**, not of a connection:
   * setting it once is enough, and it stays set after every process detaches.
   * That is also why the opt-out has to *apply* `delete` rather than skip —
   * skipping would leave an already-converted database in WAL forever. Only
   * `journal_mode` changes here; `synchronous` is untouched, so durability is
   * exactly what it was before.
   *
   * Two failure modes, both handled because neither is loud on its own:
   *
   *   1. **A refusal is an answer, not an error.** `PRAGMA journal_mode = X`
   *      replies with the mode actually in force — `:memory:` answers `memory`,
   *      and a filesystem that cannot host WAL answers `delete` — without
   *      raising anything. So the reply is always read back, never assumed.
   *   2. **Accepted, then unusable.** WAL needs a shared-memory index beside
   *      the database, which network filesystems (NFS/SMB) do not provide; the
   *      mode change can succeed and the first read *through* the WAL then
   *      fail. The mode is persisted by that point, so leaving it would strand
   *      the database — hence the read-back probe and the revert to `delete`.
   *
   * Never throws and never blocks the boot: a database that stays on a rollback
   * journal is slower under concurrency, not broken, and refusing to start over
   * a pragma would be worse than the problem this solves.
   */
  protected async applySqliteJournalMode(): Promise<void> {
    if (!this.supportsWalJournal) return;

    // No file means nobody to share it with: `:memory:` (and every other
    // `:`-prefixed pseudo-filename) is private to this process.
    const filename = this.sqliteFilename();
    if (!filename) return;

    const target = this.resolveSqliteJournalMode();

    let current: string | null;
    try {
      current = SqlDriver.journalModeOf(await this.knex.raw('PRAGMA journal_mode'));
    } catch (e) {
      this.logger.warn(`Failed to read SQLite journal_mode on ${filename}`, e);
      return;
    }

    // `memory` / `off` is a deliberate no-journal transport, not a rollback
    // journal worth migrating — leave whatever the host chose in place.
    if (current === null || current === 'memory' || current === 'off') return;

    if (current === target) {
      // Nothing to change — but when the mode is already WAL, still prove it is
      // usable. A database an earlier boot left in WAL on a filesystem that
      // cannot serve it (failure mode 2) would otherwise fail every query with
      // nothing pointing at the cause, and the revert that would fix it only
      // ever gets one attempt.
      if (target === 'wal') await this.verifyWalReadable(filename);
      return;
    }

    let applied: string | null;
    try {
      applied = SqlDriver.journalModeOf(
        await this.knex.raw(`PRAGMA journal_mode = ${target.toUpperCase()}`),
      );
    } catch (e) {
      // SQLITE_BUSY is the benign case: a mode change needs the file to itself,
      // and another process has it open. Whoever wins the race sets the mode
      // and everyone else reads it back on their next boot.
      this.logger.warn(
        `Failed to set SQLite journal_mode=${target} on ${filename} (it stays '${current}')`,
        e,
      );
      return;
    }

    if (applied !== target) {
      this.logger.warn(
        `SQLite kept journal_mode='${applied ?? 'unknown'}' on ${filename} instead of '${target}' — ` +
          (target === 'wal'
            ? `WAL needs a local filesystem (it does not work on NFS/SMB), so this database stays serialized between processes. ` +
              `Set ${SqlDriver.SQLITE_JOURNAL_MODE_ENV}=delete to stop asking.`
            : `close every other connection and retry, or run \`sqlite3 ${filename} "PRAGMA journal_mode=delete"\` with nothing attached.`),
      );
      return;
    }

    if (target === 'wal') await this.verifyWalReadable(filename);
  }

  /**
   * Prove a WAL database can actually be read through, and undo the mode if
   * not — see failure mode 2 in {@link applySqliteJournalMode}. Runs on every
   * connect to a WAL database, not only right after a switch, so a database
   * some earlier boot stranded still gets recovered.
   *
   * Any read on a WAL database opens the shared-memory index, which is the part
   * a network filesystem cannot provide; `sqlite_master` is the cheapest such
   * read and needs no schema to exist.
   */
  private async verifyWalReadable(filename: string): Promise<void> {
    try {
      await this.knex.raw('SELECT count(*) FROM sqlite_master');
      return;
    } catch (e) {
      // Busy is not unusable. Another connection in EXCLUSIVE locking mode — the
      // `os migrate` occupancy probe takes exactly that, briefly — makes this
      // read fail for a reason that passes on its own, and changing the journal
      // mode underneath it would be both wrong and impossible.
      if (SqlDriver.isSqliteBusyError(e)) return;

      const detail = e instanceof Error ? e.message : String(e);
      let reverted: string | null = null;
      try {
        reverted = SqlDriver.journalModeOf(await this.knex.raw('PRAGMA journal_mode = DELETE'));
      } catch {
        // Leaving `reverted` null — reported as "did not take" below, which is
        // the honest outcome either way.
      }
      this.logger.warn(
        `SQLite accepted WAL on ${filename} but cannot read through it (${detail}) — ` +
          (reverted === 'delete'
            ? `reverted to journal_mode=delete. Set ${SqlDriver.SQLITE_JOURNAL_MODE_ENV}=delete to skip this on every boot.`
            : `and the revert did not take (journal_mode='${reverted ?? 'unknown'}'). Run ` +
              `\`sqlite3 ${filename} "PRAGMA journal_mode=delete"\` with nothing attached, then set ` +
              `${SqlDriver.SQLITE_JOURNAL_MODE_ENV}=delete.`),
      );
    }
  }

  /**
   * Whether an error is SQLite reporting contention rather than a broken
   * database. Mirrors `isBusyError` in the CLI's occupancy probe, which asks the
   * same question of the same engine from the other side of the package graph.
   */
  private static isSqliteBusyError(e: unknown): boolean {
    const code = (e as { code?: string } | null | undefined)?.code ?? '';
    const message = e instanceof Error ? e.message : String(e ?? '');
    return code.startsWith('SQLITE_BUSY') || /database is locked|SQLITE_BUSY/i.test(message);
  }

  /**
   * The `journal_mode` a PRAGMA reply carries, lower-cased.
   *
   * Both SQLite dialects answer a PRAGMA with rows (`[{ journal_mode: 'wal' }]`)
   * — a reply shaped any other way yields `null`, which every caller treats as
   * "leave the database alone" rather than guessing.
   */
  private static journalModeOf(result: unknown): string | null {
    const rows: unknown = Array.isArray(result) ? result : (result as { rows?: unknown })?.rows;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const value =
      row && typeof row === 'object' ? (row as { journal_mode?: unknown }).journal_mode : row;
    return typeof value === 'string' ? value.toLowerCase() : null;
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
    return this.findRows(object, query, options);
  }

  /**
   * The body of {@link find}, shared with {@link findOne}.
   *
   * `singleRowLookup` marks the caller as `findOne` rather than a page, and the
   * only thing it changes is that no ordering is imposed on an unsorted read
   * (objectstack#4363). `findOne` reaches here as `limit: 1`, which is
   * indistinguishable from "page one of a walk with page size 1" — and the two
   * want opposite things:
   *
   * - The paged read needs a total order, or its pages are not a partition.
   * - `findOne` needs the plan its predicate earned. `ORDER BY id LIMIT 1` is
   *   the shape that makes a planner abandon the predicate's own index and walk
   *   the primary key applying a filter instead, because at `LIMIT 1` that
   *   looks like it will stop early. Measured on Postgres 16 over 2M rows,
   *   `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms (~100×) and swapped
   *   `ticket_owner_idx` for `ticket_pkey`; at `LIMIT 5` and up the planner
   *   keeps the right index and pays only a top-N sort (~2 ms). Nothing is
   *   bought for that: `findOne` promises *a* matching record, never a position
   *   in a sequence, so there is no partition to preserve.
   *
   * `MongoDBDriver.findOne` carries the same flag into its own `buildSortSpec`,
   * so both drivers now read a `findOne` the same way: honour the caller's
   * `orderBy`, impose nothing when there is none. (Mongo used to translate
   * `where` and drop `orderBy` outright — an earlier version of this comment
   * cited that as agreement, which it was not; objectstack#4419.) The
   * obligation the contract states is on `find`, and this keeps it there.
   */
  private async findRows(
    object: string,
    query: QueryAST,
    options?: DriverOptions,
    singleRowLookup = false,
  ): Promise<any[]> {
    // The whole ORDER BY, decided once: the caller's keys plus whatever this
    // driver has to add to make a paged read deterministic. Derived out here
    // rather than inside `buildBase` so the recovery ladder below can ask
    // whether the statement HAS a sort to drop, instead of asking whether the
    // caller supplied one — since #4363 those are different questions.
    const orderKeys = this.orderKeysFor(object, query, { singleRowLookup });

    // Build everything EXCEPT the SELECT list, so the unknown-column retry
    // below can rebuild without re-deriving where/order/pagination.
    const buildBase = (opts?: { withOrderBy?: boolean }) => {
      const withOrderBy = opts?.withOrderBy !== false;
      const b = this.getBuilder(object, options);
      this.applyTenantScope(b, object, options);

      // WHERE
      if (query.where) {
        this.applyFilters(b, query.where);
      }

      // ORDER BY
      if (withOrderBy) {
        for (const key of orderKeys) {
          b.orderBy(this.remoteColumn(object, key.field, this.mapSortField(key.field)), key.direction);
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
      builder.select(query.fields.map((f) => this.mapSortField(f)));
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
        //
        // An unknown ORDER BY column is the same footgun one clause over
        // (objectstack#3821): a client that sorts by a field the table lacks
        // used to get an empty page with a non-zero `total` — "the rows are
        // there but none are shown". Rows matter more than their order, so
        // drop the sort and return them unordered rather than nothing. Ladder:
        // projection first (it is the likelier culprit and the cheaper thing
        // to lose), then the sort, then give up.
        const retries: Array<() => any> = [];
        if (query.fields) retries.push(() => buildBase().select('*'));
        if (orderKeys.length > 0) {
          retries.push(() => buildBase({ withOrderBy: false }).select('*'));
        }
        results = [];
        let recovered = false;
        for (const retry of retries) {
          try {
            results = await retry();
            recovered = true;
            break;
          } catch {
            // Try the next, broader fallback.
          }
        }
        if (!recovered) return [];
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

  /**
   * `IDataDriver.findOne` — find a single record BY QUERY.
   *
   * This also accepted a bare id (`findOne('task', 't1')`) through an
   * undeclared `typeof query === 'string' | 'number'` branch until #4311. No
   * caller outside this package's own tests used it, it was on no contract, and
   * the other two drivers answer that same call differently: `MemoryDriver`
   * spreads the argument (`{ ...query }` over a string yields `{0:'t',1:'1'}`)
   * and `MongoDriver` reads `query.where` (undefined → an unfiltered findOne,
   * i.e. an arbitrary row). One spelling meaning three things across three
   * drivers is the second de-facto contract Prime Directive #12 exists to
   * prevent — and the branch also bypassed the shared `findRows()` path
   * (field selection, temporal coercion, unknown-column recovery, and the
   * `singleRowLookup` ORDER BY decision).
   * Spell an id lookup as what it is: `{ object, where: { id } }`.
   */
  async findOne(object: string, query: QueryAST, options?: DriverOptions): Promise<any> {
    if (!query || typeof query !== 'object') return null;
    const results = await this.findRows(object, { ...query, limit: 1 }, options, true);
    return results[0] || null;
  }

  // `findStream` was removed with the contract method in 17.0.0 (#4484). This driver's
  // implementation awaited `find()` in full and then yielded row by row, so it never
  // avoided the memory it was declared to avoid; nothing called it. Page through
  // `find()` with `limit`/`offset` until a real Knex `.stream()` read is built to a
  // caller's requirement.

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
    const timezone = options?.timezone;
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
      const optTenant = options?.tenantId;
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

  /**
   * True when the UPDATE path must KEEP a caller-supplied `updated_at` rather
   * than force-advancing it to `now` (#3493). Only for an opt-in "historical"
   * import (`DriverOptions.preserveAudit`, threaded from
   * `ExecutionContext.preserveAudit`) that carries an explicit `updated_at` —
   * mirroring how `stampInsertTimestamps` preserves an explicit value on insert.
   * A normal update leaves the flag unset, so `updated_at` always advances.
   */
  protected keepSuppliedUpdatedAt(formatted: Record<string, any>, options?: DriverOptions): boolean {
    return options?.preserveAudit === true && formatted.updated_at != null;
  }

  async update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<any> {
    this.auditMissingTenant(object, 'update', options);
    const rotationShards = this.rotationShardsOf(object);
    if (rotationShards) return this.rotatedUpdateById(object, rotationShards, id, data, options);
    const builder = this.getBuilder(object, options).where('id', id);
    this.applyTenantScope(builder, object, options);
    const formatted = this.applyWriteColumnMap(object, this.formatInput(object, data));

    if (this.tablesWithTimestamps.has(object) && !this.keepSuppliedUpdatedAt(formatted, options)) {
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
    if (this.tablesWithTimestamps.has(object) && !this.keepSuppliedUpdatedAt(formatted, options)) {
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

    // The same coercion key `applyFilters` just used, so every part of this
    // statement agrees on how each column is stored — the WHERE window, the
    // GROUP BY bucket expression (#3773) and the result presentation (#3797).
    const table = this.coercionKey(builder);

    // Result columns that carry a raw column VALUE (rather than a count/total
    // derived from one), keyed by the column name the caller will read.
    // Collected while the statement is built because that is the only point
    // where a column name and its meaning are both known: a `min()` lands under
    // its alias (never under the field name), and a date-BUCKETED column lands
    // under the field name while holding a label (`'2026-01'`), not a value.
    // Matching on names after the fact gets both of those backwards.
    // See {@link presentReadColumns}.
    const presentedOutput = new Map<string, ReadPresentationKind>();

    if (query.groupBy) {
      // groupBy items may be plain strings ('region') or structured objects
      // ({ field: 'closed_at', dateGranularity: 'quarter' }). For structured
      // items we emit a dialect-specific bucket expression aliased as the
      // field name so the resulting row keys match in-memory bucketDateValue.
      for (const g of query.groupBy as Array<string | { field: string; dateGranularity?: string }>) {
        if (typeof g === 'string') {
          builder.groupBy(g);
          builder.select(g);
          const kind = this.readPresentationKind(table, g);
          if (kind) presentedOutput.set(g, kind);
        } else if (g && typeof g === 'object' && g.field) {
          if (g.dateGranularity) {
            const bucket = this.buildDateBucketExpr(g.field, g.dateGranularity as any, table);
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
            const kind = this.readPresentationKind(table, g.field);
            if (kind) presentedOutput.set(g.field, kind);
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
          // `min`/`max` are the only supported functions that hand back a value
          // OF the column rather than a count/total derived from it, so they are
          // the only ones whose result still needs the column's presentation.
          // `alias` is required by `AggregationNodeSchema`; the unaliased branch
          // below lands under a dialect-dependent column name
          // (`max("closed_at")` on SQLite, `max` on Postgres) and is defensive
          // only, so it is deliberately not tracked.
          if ((funcName === 'min' || funcName === 'max') && agg.field) {
            const kind = this.readPresentationKind(table, agg.field);
            if (kind) presentedOutput.set(agg.alias, kind);
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

    const rows = await builder;
    return this.presentReadColumns(rows, presentedOutput);
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
    const values = results.map((row: any) => row[field]);

    // Same presentation `find()` gives the column (#3797, #3849) — a caller
    // listing a datetime's values should not get epoch integers here and ISO
    // strings there, nor `0`/`1` for a boolean. Re-deduplicate afterwards: SQL
    // `DISTINCT` compares STORED values, and one SQLite `Field.datetime` column
    // holds both INTEGER epoch ms and ISO TEXT, so two rows recording the same
    // instant survive as two rows and then collapse to the same presented value.
    const kind = this.readPresentationKind(this.coercionKey(builder), field);
    if (!kind) return values;
    return [...new Set(values.map((v: any) => this.presentReadValue(kind, v)))];
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
        this.createAuditTimestampColumn(table, 'created_at');
        this.createAuditTimestampColumn(table, 'updated_at');
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
    if (this.tenantOptOutByTable.has(base)) this.tenantOptOutByTable.add(shard);
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
    if (isTenancyDisabled(schema)) return null;
    const fields = schema?.fields;
    if (tenancyDecl?.tenantField) {
      const declared = String(tenancyDecl.tenantField);
      if (fields && Object.prototype.hasOwnProperty.call(fields, declared)) return declared;
    }
    if (fields && Object.prototype.hasOwnProperty.call(fields, 'organization_id')) return 'organization_id';
    return null;
  }

  /**
   * {@link computeTenantField} + maintenance of the sticky explicit-opt-out
   * record (#3249). Key by the same key the caller uses for
   * `tenantFieldByTable` (table name in `initObjects`, object name in
   * `registerExternalObject` — {@link resolveTenantField} checks both).
   *
   * A schema that carries a `tenancy` declaration is authoritative: it sets or
   * clears the opt-out and is computed normally. A schema WITHOUT one (partial
   * re-registration — e.g. the lifecycle archive path passes only
   * `{ name, fields }` to `syncSchema`) preserves a previously declared
   * opt-out instead of letting the implicit `organization_id` heuristic
   * re-scope a platform-global table.
   */
  protected computeAndRecordTenantField(
    key: string,
    schema: { fields?: Record<string, any>; tenancy?: any },
  ): string | null {
    if (schema?.tenancy != null) {
      if (isTenancyDisabled(schema)) this.tenantOptOutByTable.add(key);
      else this.tenantOptOutByTable.delete(key);
      return this.computeTenantField(schema);
    }
    if (this.tenantOptOutByTable.has(key)) return null;
    return this.computeTenantField(schema);
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

    const tenantField = this.computeAndRecordTenantField(key, schema);
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

  // `tenancy` is part of what this method READS — each object flows into
  // `computeAndRecordTenantField`, which consumes `obj.tenancy` to pick the
  // tenant column and to set or clear the sticky explicit-opt-out. It went
  // undeclared here until #4311 (`registerExternalObject` and
  // `computeAndRecordTenantField` both had it), so a caller spelling the key
  // correctly was rejected by the type while the driver read it regardless.
  async initObjects(objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any }>): Promise<void> {
    // DDL gate (ADR-0015 §5.1): createTable/alterTable below mutate schema.
    // Also covers `syncSchema`, which delegates here.
    this.assertSchemaMutable('initObjects');
    await this.ensureDatabaseExists();

    for (const obj of objects) {
      const tableName = StorageNameMapping.resolveTableName(obj);
      // #2186: remember the authoritative metadata field set for this table so
      // drift detection / `os migrate` can diff the physical schema against it.
      this.managedObjectFields.set(tableName, obj.fields ?? {});
      // Always overwrite — a metadata change that REMOVES `indexes` must clear
      // the previous entry, or drift detection keeps expecting an index nobody
      // declares any more (and never reports it as orphaned).
      if (Array.isArray((obj as any).indexes)) {
        this.managedObjectIndexes.set(tableName, (obj as any).indexes);
      } else {
        this.managedObjectIndexes.delete(tableName);
      }

      const jsonCols: string[] = [];
      const booleanCols: string[] = [];
      const numericCols: string[] = [];
      const autoNumberCols: Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }> = [];
      // Tenant-isolation column: explicit tenancy opt-out → declared field →
      // implicit `organization_id`. See {@link computeAndRecordTenantField}
      // (shared with registerExternalObject so the two paths can't drift).
      const tenantField = this.computeAndRecordTenantField(tableName, obj);
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

      // Deferred-DDL mode (#3917): everything above is in-memory metadata
      // registration — coercion maps, tenancy, and the `managedObjectFields`
      // entry `detectManagedDrift()` diffs against. Everything below issues
      // DDL. `os migrate plan` / `apply` boot with the deferral armed so the
      // plan is computed against the database as it actually is, and nothing
      // is created until the operator has seen (and confirmed) the plan.
      if (this.deferredDdl) {
        this.deferredSchemaObjects.set(tableName, { ...obj, name: tableName });
        continue;
      }

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
      // Recorded BEFORE the legacy-`_id` rebuild below can flip `exists`: a
      // table that was here when we arrived stays "found" even if we then drop
      // and recreate it. Re-syncing a table we made ourselves this boot — boot
      // runs the sync more than once, and objects registered later sync on
      // demand — is not evidence of anything preceding us, so it is ignored.
      // See `getSchemaSyncStats`.
      if (!exists) this.tablesCreatedHere.add(tableName);
      else if (!this.tablesCreatedHere.has(tableName)) this.tablesFoundExisting.add(tableName);

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
          this.createAuditTimestampColumn(table, 'created_at');
          this.createAuditTimestampColumn(table, 'updated_at');
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

      // Materialize the table's index set: field-level `unique` (tenancy-aware
      // — #3696) plus object-level declared indexes (`indexes: [{ fields,
      // unique }]`, carrying the multi-column UNIQUE guarantees dedup/
      // convergence paths rely on, ADR-0030). Both go through one path so the
      // create and alter branches above cannot produce different constraints
      // for the same metadata. Done after the table is created/altered so every
      // referenced column physically exists — which is also why field-level
      // `unique` can no longer be emitted inline by `createColumn`: a composite
      // needs the tenant column to already be there.
      const declaredIndexes = (obj as any).indexes;
      const uniqueFields = Object.values<any>(obj.fields ?? {}).some((f) =>
        isUniqueDeclared(f?.unique),
      );
      if (uniqueFields || (Array.isArray(declaredIndexes) && declaredIndexes.length > 0)) {
        const colInfo = await this.knex(tableName).columnInfo();
        const physicalColumns = new Set(Object.keys(colInfo));
        await this.syncTableIndexes(
          tableName,
          obj.fields ?? {},
          declaredIndexes,
          tenantField,
          physicalColumns,
        );
      }

      // #2186: the additive sync above only ever ADDs tables/columns/indexes.
      // For a table that already existed, detect (and in dev, auto-reconcile)
      // any non-additive divergence between metadata and the physical schema —
      // relaxed NOT NULL, widened varchar, orphaned column, and since #3728 the
      // index dimension too (a legacy global unique that is now tenant-scoped,
      // a redefined or orphaned index).
      if (exists) {
        await this.reconcileAndWarnDrift(tableName, obj.fields ?? {}, declaredIndexes);
      }

      // #3912: converge this table's `Field.datetime` columns on the canonical
      // UTC-text storage form. A table this call just CREATED has no rows, so it
      // is canonical by construction — record that without touching the disk.
      await this.backfillCanonicalDatetimes(tableName, exists);
      // #3994: the `Field.time` twin of the line above.
      await this.backfillCanonicalTimes(tableName, exists);
      // #3942: the MySQL twin — widen legacy `TIMESTAMP` columns to `DATETIME(3)`.
      if (exists) await this.migrateMysqlDatetimeColumns(tableName, obj.fields ?? {});
      // #3994: widen legacy MySQL `TIME` columns to `TIME(3)`.
      if (exists) await this.migrateMysqlTimeColumns(tableName, obj.fields ?? {});
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
    if (usesAutoNumber && !this.deferredDdl) {
      await this.ensureSequencesTable();
    }
  }

  /**
   * Converge one table's `Field.datetime` columns on the canonical UTC-text
   * storage form (#3912), then mark them clean so the read paths can drop their
   * repair expression.
   *
   * SQLite only, and this is the whole reason the convention is affordable.
   * Postgres/MySQL store a real temporal type, so their rows are already one
   * shape — there is nothing on disk to rewrite. (What Postgres CANNOT recover is
   * an instant written from a zone-naive string before this change: it was
   * resolved against the server's timezone at write time and the original wall
   * clock is gone. `formatInput` stops producing those going forward; existing
   * rows are simply the instants the server recorded.)
   *
   * ONE `UPDATE` per column, whose SET expression is the very same
   * {@link sqliteCanonicalDatetimeSql} the read paths use — so "what canonical
   * means" has a single definition and the migration cannot drift from the repair
   * it retires. It converts every non-canonical shape in one pass: INTEGER/REAL
   * epoch ms, zone-naive `CURRENT_TIMESTAMP` output, an offset-bearing `+08:00`
   * value, a bare `YYYY-MM-DD`.
   *
   * `col IS NOT <canonical>` is the whole `WHERE`. `IS NOT` rather than `<>`
   * because it is null-safe AND type-aware: an INTEGER value is never equal to
   * the text the expression yields, so epoch rows match; an already-canonical
   * string equals it exactly and is skipped. A value SQLite cannot parse falls
   * through the expression's `coalesce` unchanged, compares equal to itself, and
   * is left alone rather than destroyed. So a converged table costs one scan and
   * zero writes, and re-running is a no-op.
   *
   * Failures are logged and swallowed: the column simply stays un-marked, the
   * read paths keep their repair, and queries stay CORRECT (just unindexed). A
   * migration that cannot run must never be able to take the process down at
   * boot, and correctness must never be contingent on one having run.
   */
  protected async backfillCanonicalDatetimes(table: string, tableExisted: boolean): Promise<void> {
    const fields = this.datetimeFields[table];
    if (!this.isSqlite || !fields || fields.size === 0) return;

    const clean = (this.canonicalDatetimeFields[table] ??= new Set<string>());
    // A table created by this very call is empty, so every datetime column in it
    // is canonical without a single row being read.
    if (!tableExisted) {
      for (const field of fields) clean.add(field);
      return;
    }

    const canonical = this.sqliteCanonicalDatetimeSql('??');
    // The expression spells `??` 4×, and the statement uses it twice (the SET
    // value and the WHERE guard) — hence the column name repeated per use.
    const exprBindings = (field: string) => [field, field, field, field];
    for (const field of fields) {
      try {
        const res = await this.knex.raw(
          `update ?? set ?? = ${canonical} where ?? is not null and ?? is not ${canonical}`,
          [table, field, ...exprBindings(field), field, field, ...exprBindings(field)],
        );
        const converted = (res as any)?.changes ?? 0;
        if (converted) {
          this.logger.info?.(
            `[sql-driver] canonicalised datetime storage (#3912) for ${table}.${field}`,
            { rowsConverted: converted },
          );
        }
        clean.add(field);
      } catch (err) {
        // Correctness does not depend on this succeeding — only performance does.
        this.logger.warn(
          `[sql-driver] could not canonicalise datetime storage for ${table}.${field}; ` +
          `queries stay correct via the read-side repair`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }

  /**
   * Converge one table's `Field.time` columns on the canonical time-of-day text
   * form (#3994) — the `Field.time` twin of {@link backfillCanonicalDatetimes},
   * built the same way for the same reasons.
   *
   * SQLite only: Postgres/MySQL store a native TIME, so their rows are already
   * one shape. ONE `UPDATE` per column whose SET expression IS
   * {@link sqliteCanonicalTimeSql} — the very expression the read paths use —
   * with the null-safe, type-aware `IS NOT` guard as the whole `WHERE`. It
   * converts INTEGER/REAL epoch ms, full-timestamp text (ISO or zone-naive) and
   * under-specified `HH:MM` in one pass; canonical rows compare equal and cost
   * nothing; unparseable values fall through the expression's `coalesce`
   * unchanged and are left alone.
   *
   * What it CANNOT repair, exactly like the datetime backfill: a wall clock the
   * old write path never recorded correctly. An epoch row folds to its UTC
   * time-of-day — the same answer reads have always given for it.
   *
   * Failures are logged and swallowed: the column stays un-marked, the read and
   * filter paths keep their repair expression, and queries stay correct (just
   * unindexed). A migration must never take boot down.
   */
  protected async backfillCanonicalTimes(table: string, tableExisted: boolean): Promise<void> {
    const fields = this.timeFields[table];
    if (!this.isSqlite || !fields || fields.size === 0) return;

    const clean = (this.canonicalTimeFields[table] ??= new Set<string>());
    if (!tableExisted) {
      for (const field of fields) clean.add(field);
      return;
    }

    const canonical = this.sqliteCanonicalTimeSql('??');
    const exprBindings = (field: string) => Array(SQLITE_TIME_EXPR_REFS).fill(field);
    for (const field of fields) {
      try {
        const res = await this.knex.raw(
          `update ?? set ?? = ${canonical} where ?? is not null and ?? is not ${canonical}`,
          [table, field, ...exprBindings(field), field, field, ...exprBindings(field)],
        );
        const converted = (res as any)?.changes ?? 0;
        if (converted) {
          this.logger.info?.(
            `[sql-driver] canonicalised time-of-day storage (#3994) for ${table}.${field}`,
            { rowsConverted: converted },
          );
        }
        clean.add(field);
      } catch (err) {
        this.logger.warn(
          `[sql-driver] could not canonicalise time storage for ${table}.${field}; ` +
          `queries stay correct via the read-side repair`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }

  /**
   * The `Field.datetime` (and audit) columns of `table` that MySQL still stores
   * as a legacy `TIMESTAMP`, with the nullability each must keep.
   *
   * Shared by {@link migrateMysqlDatetimeColumns}, which widens them, and
   * {@link previewDatetimeConvergence}, which reports them into `os migrate
   * plan` (#3954) — so what the plan lists and what apply does are the same set
   * by construction, not by two filters that agree today.
   *
   * `[]` on any dialect but MySQL, and on a table declaring no datetime column.
   */
  protected async legacyMysqlTimestampColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<Array<{ name: string; nullable: boolean }>> {
    if (!this.isMysql) return [];
    const candidates = new Set<string>(AUDIT_TIMESTAMP_COLUMNS);
    for (const [name, field] of Object.entries(fields)) {
      if ((field?.type ?? 'string') === 'datetime' && !field?.multiple) candidates.add(name);
    }
    if (candidates.size === 0) return [];

    const res: any = await this.knex.raw(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = database() and table_name = ? and data_type = 'timestamp'`,
      [table],
    );
    // mysql2 returns [rows, fields]; column names vary in case by server.
    const rows: any[] = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
    return rows
      .map((r) => ({
        name: String(r.COLUMN_NAME ?? r.column_name ?? ''),
        nullable: String(r.IS_NULLABLE ?? r.is_nullable ?? 'YES').toUpperCase() !== 'NO',
      }))
      .filter((c) => c.name && candidates.has(c.name));
  }

  /**
   * Widen a table's legacy MySQL `TIMESTAMP` datetime columns to `DATETIME(3)`
   * (#3942) — the MySQL counterpart of {@link backfillCanonicalDatetimes}.
   *
   * `TIMESTAMP` cannot hold an instant past 2038-01-19 or before 1970, keeps no
   * milliseconds, and converts using the session timezone. `ALTER … MODIFY` moves
   * the column to `DATETIME(3)`, which has none of those properties. The instants
   * survive because the connection pins `@@session.time_zone` to UTC
   * ({@link withUtcSession}): MySQL renders each `TIMESTAMP` in the session zone
   * to produce the `DATETIME` wall clock, so UTC in gives the UTC wall clock the
   * driver's own writes use.
   *
   * Only the audit columns and declared `Field.datetime` columns are touched, and
   * only when they are still `timestamp` — so this is idempotent and re-running
   * costs one `information_schema` lookup.
   *
   * Failures are logged and swallowed, like the SQLite backfill and for the same
   * reason: a `TIMESTAMP` column keeps working (the driver binds the same UTC
   * wall-clock literal either way, and the session is pinned to UTC), it merely
   * keeps the range and precision limits. Correctness must not depend on a
   * migration having run, and a migration must never take boot down.
   */
  protected async migrateMysqlDatetimeColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<void> {
    if (!this.isMysql) return;
    try {
      const legacy = await this.legacyMysqlTimestampColumns(table, fields);
      if (legacy.length === 0) return;

      for (const col of legacy) {
        // The default is re-stated because MySQL drops a column's DEFAULT when
        // MODIFY does not repeat it, and an audit column without
        // `CURRENT_TIMESTAMP(3)` would start inserting NULL.
        const isAudit = (AUDIT_TIMESTAMP_COLUMNS as readonly string[]).includes(col.name);
        const nullClause = col.nullable ? 'null' : 'not null';
        const defaultClause = isAudit ? ' default current_timestamp(3)' : '';
        await this.knex.raw(
          `alter table ?? modify column ?? datetime(3) ${nullClause}${defaultClause}`,
          [table, col.name],
        );
      }
      this.logger.info?.(
        `[sql-driver] widened MySQL TIMESTAMP → DATETIME(3) (#3942) on ${table}`,
        { columns: legacy.map((c) => c.name) },
      );
    } catch (err) {
      this.logger.warn(
        `[sql-driver] could not widen MySQL datetime columns on ${table}; ` +
        `writes stay correct, but the 2038 ceiling and millisecond truncation remain`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * The declared `Field.time` columns of `table` that MySQL still stores as a
   * zero-precision `TIME`, with the nullability each must keep. Shared by
   * {@link migrateMysqlTimeColumns} and {@link previewTimeConvergence} — the
   * plan and the migration are the same set by construction (#3954 pattern).
   */
  protected async legacyMysqlTimeColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<Array<{ name: string; nullable: boolean }>> {
    if (!this.isMysql) return [];
    const candidates = new Set<string>();
    for (const [name, field] of Object.entries(fields)) {
      if ((field?.type ?? 'string') === 'time' && !field?.multiple) candidates.add(name);
    }
    if (candidates.size === 0) return [];

    const res: any = await this.knex.raw(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = database() and table_name = ? and data_type = 'time'
         and coalesce(datetime_precision, 0) = 0`,
      [table],
    );
    const rows: any[] = Array.isArray(res) ? res[0] : (res?.rows ?? []);
    return rows
      .map((r) => ({
        name: String(r.COLUMN_NAME ?? r.column_name ?? ''),
        nullable: String(r.IS_NULLABLE ?? r.is_nullable ?? 'YES').toUpperCase() !== 'NO',
      }))
      .filter((c) => c.name && candidates.has(c.name));
  }

  /**
   * Widen a table's legacy MySQL `TIME` columns to `TIME(3)` (#3994) — the
   * `Field.time` twin of {@link migrateMysqlDatetimeColumns}.
   *
   * A zero-precision `TIME` does not truncate a fractional literal — it ROUNDS
   * it, so the canonical `'14:30:00.500'` would land as `14:30:01`: the write
   * path would be changing the wall clock it was asked to store. `TIME(3)`
   * keeps the milliseconds instead, matching the canonical form's resolution
   * and the `DATETIME(3)` precedent (#3942).
   *
   * Failures are logged and swallowed for the usual reason; the only cost of a
   * `TIME(0)` column that could not be widened is second-rounding of fractional
   * writes — which is today's behaviour.
   */
  protected async migrateMysqlTimeColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<void> {
    if (!this.isMysql) return;
    try {
      const legacy = await this.legacyMysqlTimeColumns(table, fields);
      if (legacy.length === 0) return;

      for (const col of legacy) {
        // MODIFY drops a default it does not restate. A `defaultValue: 'NOW()'`
        // column gets the canonical UTC expression default (`nowColumnDefault`);
        // its legacy `current_timestamp()` default read the SESSION's zone, so
        // dropping-and-replacing it is a fix, not collateral.
        const isNowDefault = isNowDefaultValue(fields[col.name]?.defaultValue);
        const defaultClause = isNowDefault ? ' default (cast(utc_timestamp(3) as time(3)))' : '';
        await this.knex.raw(
          `alter table ?? modify column ?? time(3) ${col.nullable ? 'null' : 'not null'}${defaultClause}`,
          [table, col.name],
        );
      }
      this.logger.info?.(
        `[sql-driver] widened MySQL TIME → TIME(3) (#3994) on ${table}`,
        { columns: legacy.map((c) => c.name) },
      );
    } catch (err) {
      this.logger.warn(
        `[sql-driver] could not widen MySQL time columns on ${table}; ` +
        `fractional-second writes keep rounding to whole seconds`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  // ── Deferred schema DDL (#3917) ────────────────────────────────────────────

  /**
   * Arm/disarm DDL deferral for {@link initObjects}.
   *
   * `os migrate plan` promises a dry run and `os migrate apply` promises a
   * confirmation prompt, but both booted the full plugin set first — and boot
   * schema-sync ran create-table / add-column DDL against the target database
   * *before* either promise was kept (#3917). With the deferral armed,
   * `initObjects` still registers all in-memory metadata (so drift detection
   * sees the same authoritative field set) but records the physical work
   * instead of performing it. {@link previewDeferredSchemaWork} renders it into
   * the plan; {@link flushDeferredSchemaDdl} performs it once the operator has
   * said yes.
   *
   * Off by default: every other boot (serve/dev/start) wants the additive sync
   * to run exactly as before.
   */
  setDeferredDdl(deferred: boolean): void {
    this.deferredDdl = deferred;
  }

  /** How many objects are waiting for {@link flushDeferredSchemaDdl}. */
  get deferredSchemaObjectCount(): number {
    return this.deferredSchemaObjects.size;
  }

  /**
   * Tables this driver created vs found already present since `connect()` —
   * the `IDataDriver.getSchemaSyncStats` contract. `existing === 0 &&
   * created > 0` is the platform's only observation that a datastore was
   * empty when this process reached it (#3438 / ADR-0104).
   */
  getSchemaSyncStats(): { created: number; existing: number } {
    return { created: this.tablesCreatedHere.size, existing: this.tablesFoundExisting.size };
  }

  /**
   * What the deferred sync *would* do, without doing it.
   *
   * Read-only: `hasTable` + `columnInfo` decide between create and alter (the
   * same two probes the additive sync uses), then
   * {@link previewDatetimeConvergence} asks whether the datetime storage steps
   * have anything left to do. Tables that already match metadata and hold
   * canonical data produce no entry, so an in-sync database returns `[]`.
   *
   * The convergence probe COUNTS rows, so this is more than metadata lookups on
   * a database that has not been migrated yet. That is the right trade for a
   * command the operator ran to be told the size of the job — and it is paid
   * once, by `plan`/`apply`, never on a normal boot.
   *
   * The obligation runs both ways (#3978). #3954 closed "the plan understates
   * what apply does"; this closes its mirror image — the plan must not promise
   * work apply CANNOT do. Only fields that materialize a column are listed,
   * decided by {@link fieldHasColumn}, the same helper `createColumn` and the
   * column differ use. A virtual `formula` field has no column, so listing it
   * produced an `add_columns` entry `apply` reported as performed without doing
   * anything and the next `plan` reported again: a finding no invocation could
   * ever clear, making a freshly-applied database look un-migrated.
   */
  async previewDeferredSchemaWork(): Promise<PendingSchemaWork[]> {
    const out: PendingSchemaWork[] = [];
    for (const [tableName, obj] of this.deferredSchemaObjects) {
      const declared = Object.entries<any>(obj.fields ?? {})
        .filter(([, field]) => fieldHasColumn(field ?? {}))
        .map(([name]) => name);
      if (!(await this.knex.schema.hasTable(tableName))) {
        // A table that does not exist yet is created empty, so nothing to converge.
        out.push({ table: tableName, kind: 'create_table', columns: declared });
        continue;
      }
      const existing = new Set(Object.keys(await this.knex(tableName).columnInfo()));
      const missing = declared.filter((c) => !existing.has(c));
      if (missing.length > 0) {
        out.push({ table: tableName, kind: 'add_columns', columns: missing });
      }
      out.push(...(await this.previewDatetimeConvergence(tableName, obj.fields ?? {}, existing)));
      out.push(...(await this.previewTimeConvergence(tableName, obj.fields ?? {}, existing)));
    }
    out.sort((a, b) => a.table.localeCompare(b.table) || a.kind.localeCompare(b.kind));
    return out;
  }

  /**
   * The datetime storage-convergence work {@link backfillCanonicalDatetimes} and
   * {@link migrateMysqlDatetimeColumns} would do for `table` — measured, not
   * performed (#3954).
   *
   * Both steps run inside `initObjects` alongside the create/alter path, so
   * `apply` performs them; without an entry here `plan` would show a two-column
   * change and `apply` would additionally rewrite every row of a datetime column
   * or rebuild one on a large table. The plan promises to show what apply does.
   *
   * Each probe reuses the very predicate its migration uses, so the preview
   * cannot claim work the migration will not do (or miss work it will):
   *   - SQLite counts rows matching `col IS NOT <canonical>` — the backfill's
   *     entire `WHERE`.
   *   - MySQL lists the candidate columns still typed `timestamp` — the
   *     migration's own `information_schema` filter.
   *
   * Failures are swallowed to `[]`, matching the migrations themselves: a probe
   * that cannot run must not fail the plan, and under-reporting here costs an
   * unlisted step rather than a wrong one.
   */
  protected async previewDatetimeConvergence(
    table: string,
    fields: Record<string, any>,
    existingColumns: Set<string>,
  ): Promise<PendingSchemaWork[]> {
    try {
      if (this.isSqlite) {
        const declared = [...(this.datetimeFields[table] ?? [])].filter((c) => existingColumns.has(c));
        if (declared.length === 0) return [];
        const canonical = this.sqliteCanonicalDatetimeSql('??');
        const columns: string[] = [];
        let rows = 0;
        for (const field of declared) {
          const res: any = await this.knex.raw(
            `select count(*) as n from ?? where ?? is not null and ?? is not ${canonical}`,
            [table, field, field, field, field, field, field],
          );
          const n = Number((Array.isArray(res) ? res[0] : res)?.n ?? 0);
          if (n > 0) { columns.push(field); rows += n; }
        }
        return columns.length === 0
          ? []
          : [{ table, kind: 'normalize_datetime_storage', columns, rows }];
      }

      if (this.isMysql) {
        const legacy = await this.legacyMysqlTimestampColumns(table, fields);
        if (legacy.length === 0) return [];
        const res: any = await this.knex.raw(`select count(*) as n from ??`, [table]);
        const counted = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
        const rows = Number((counted[0] as any)?.n ?? (counted as any)?.n ?? 0);
        return [{ table, kind: 'widen_datetime_columns', columns: legacy.map((c) => c.name), rows }];
      }

      return [];
    } catch {
      return [];
    }
  }

  /**
   * The `Field.time` storage-convergence work {@link backfillCanonicalTimes} and
   * {@link migrateMysqlTimeColumns} would do for `table` — measured, not
   * performed. The time twin of {@link previewDatetimeConvergence}, with the
   * same probe-reuses-the-migration's-predicate construction and the same
   * swallow-to-`[]` failure policy.
   */
  protected async previewTimeConvergence(
    table: string,
    fields: Record<string, any>,
    existingColumns: Set<string>,
  ): Promise<PendingSchemaWork[]> {
    try {
      if (this.isSqlite) {
        const declared = [...(this.timeFields[table] ?? [])].filter((c) => existingColumns.has(c));
        if (declared.length === 0) return [];
        const canonical = this.sqliteCanonicalTimeSql('??');
        const columns: string[] = [];
        let rows = 0;
        for (const field of declared) {
          const res: any = await this.knex.raw(
            `select count(*) as n from ?? where ?? is not null and ?? is not ${canonical}`,
            [table, field, field, ...Array(SQLITE_TIME_EXPR_REFS).fill(field)],
          );
          const n = Number((Array.isArray(res) ? res[0] : res)?.n ?? 0);
          if (n > 0) { columns.push(field); rows += n; }
        }
        return columns.length === 0
          ? []
          : [{ table, kind: 'normalize_time_storage', columns, rows }];
      }

      if (this.isMysql) {
        const legacy = await this.legacyMysqlTimeColumns(table, fields);
        if (legacy.length === 0) return [];
        const res: any = await this.knex.raw(`select count(*) as n from ??`, [table]);
        const counted = Array.isArray(res?.[0]) ? res[0] : (res?.rows ?? res ?? []);
        const rows = Number((counted[0] as any)?.n ?? (counted as any)?.n ?? 0);
        return [{ table, kind: 'widen_time_columns', columns: legacy.map((c) => c.name), rows }];
      }

      return [];
    } catch {
      return [];
    }
  }

  /**
   * Run the deferred sync and disarm the deferral. Returns the work that was
   * outstanding (captured before the DDL ran, so the caller can report what it
   * just did). A no-op when nothing was deferred.
   */
  async flushDeferredSchemaDdl(): Promise<PendingSchemaWork[]> {
    const pending = [...this.deferredSchemaObjects.values()];
    if (pending.length === 0) {
      this.deferredDdl = false;
      return [];
    }
    const performed = await this.previewDeferredSchemaWork();
    this.deferredSchemaObjects.clear();
    this.deferredDdl = false;
    // Re-entering initObjects re-registers the same metadata (idempotent) and
    // this time takes the DDL path, so create/alter/index/rotation handling
    // stays in exactly one place.
    await this.initObjects(pending);
    return performed;
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

  /**
   * Diff one table's metadata (fields + indexes) against its physical schema.
   *
   * `declaredIndexes` is authoritative and complete: `undefined` means the
   * object declares none, NOT "look it up". Every caller already holds the
   * object it is diffing, and falling back to the last-synced set would make a
   * removed `indexes[]` undetectable as an orphan.
   */
  protected async detectTableDrift(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes?: any[],
  ): Promise<ManagedDriftEntry[]> {
    const cols = await this.introspectColumns(tableName);
    const physical: PhysicalColumn[] = cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      maxLength: c.maxLength,
      // The raw, dialect-decorated DEFAULT — the only evidence that a column was
      // created by a build which turned a `defaultValue` runtime token into a
      // literal (#4560).
      defaultValue: c.defaultValue,
    }));
    const out = diffManagedTable({ table: tableName, fields, columns: physical, dialect: this.dialectName });
    out.push(...(await this.detectTableIndexDrift(tableName, fields, declaredIndexes, new Set(cols.map((c) => c.name)))));
    return out;
  }

  /**
   * Diff one table's expected index set against the physical one (#3728).
   *
   * Kept separate from {@link diffManagedTable} because it needs a second
   * introspection round-trip (indexes, not columns) and two inputs the column
   * differ has no use for: the object's declared `indexes[]` and its tenant
   * column.
   */
  protected async detectTableIndexDrift(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes: any[] | undefined,
    physicalColumns: Set<string>,
  ): Promise<ManagedDriftEntry[]> {
    const tenantField = this.resolveTenantField(tableName);
    return diffManagedIndexes({
      table: tableName,
      expected: expectedIndexes({ table: tableName, fields, tenantField, declaredIndexes, physicalColumns }),
      // `declaredIndexes` goes to BOTH: it is what the table should have, and
      // therefore also what must never be mistaken for legacy debt (#3955).
      legacy: legacyUniqueReplacements({ table: tableName, fields, tenantField, physicalColumns, declaredIndexes }),
      physical: await this.introspectIndexes(tableName),
    });
  }

  /**
   * Detect every managed-schema divergence between metadata and the physical
   * database. Metadata is the source of truth. Returns one entry per drift,
   * sorted by table then column. Used by `os migrate` (P3) and tests.
   *
   * Covers both the column dimension ({@link diffManagedTable}) and, since
   * #3728, the index dimension ({@link detectTableIndexDrift}).
   *
   * @param objects optional explicit object list — `fields` and `indexes` are
   *   then authoritative for those tables. Defaults to whatever `initObjects`
   *   last synced (captured in {@link managedObjectFields} /
   *   {@link managedObjectIndexes}).
   */
  async detectManagedDrift(
    objects?: Array<{ name: string; fields?: Record<string, any>; indexes?: any[] }>,
  ): Promise<ManagedDriftEntry[]> {
    const tables = new Map<string, { fields: Record<string, any>; indexes?: any[] }>();
    if (objects) {
      for (const o of objects) {
        tables.set(StorageNameMapping.resolveTableName(o), {
          fields: o.fields ?? {},
          indexes: (o as any).indexes,
        });
      }
    } else {
      for (const [t, f] of this.managedObjectFields) {
        tables.set(t, { fields: f, indexes: this.managedObjectIndexes.get(t) });
      }
    }

    const out: ManagedDriftEntry[] = [];
    for (const [tableName, meta] of tables) {
      if (!(await this.knex.schema.hasTable(tableName))) continue;
      out.push(...(await this.detectTableDrift(tableName, meta.fields, meta.indexes)));
    }
    out.sort((a, b) => (a.table === b.table ? (a.column ?? '').localeCompare(b.column ?? '') : a.table.localeCompare(b.table)));
    return out;
  }

  /**
   * Boot-time per-table drift handling (P1 + P2): detect divergence, in dev
   * auto-reconcile the *safe* (loosening) subset when `autoMigrate==='safe'`,
   * then WARN once per remaining divergence with an actionable hint.
   */
  protected async reconcileAndWarnDrift(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes?: any[],
  ): Promise<void> {
    let drift: ManagedDriftEntry[];
    try {
      drift = await this.detectTableDrift(tableName, fields, declaredIndexes);
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
            (this.logger.info ?? this.logger.warn)(`[schema-drift] auto-reconciled ${d.op.type} on ${d.table}.${d.column ?? ''}`);
          }
          // Re-detect so the warnings below reflect the post-reconcile state.
          drift = await this.detectTableDrift(tableName, fields, declaredIndexes);
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

    // Index ops (#3728) are portable DDL on every dialect — no ALTER COLUMN, no
    // SQLite table rebuild — so they take their own path. Column ops run FIRST:
    // a `drop_column` takes its indexes with it, and on SQLite the rebuild
    // re-materializes the whole index set from metadata, which may already
    // satisfy the index entries below (they are idempotent, so that is fine).
    const columnEntries = candidates.filter((d) => !isIndexDriftOp(d.op));
    const indexEntries = candidates.filter((d) => isIndexDriftOp(d.op));

    // Group by table — SQLite reconciles a whole table in one rebuild.
    const byTable = new Map<string, ManagedDriftEntry[]>();
    for (const d of columnEntries) {
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

    for (const d of indexEntries) {
      try {
        const ok = await this.applyIndexDriftOp(d.op);
        (ok ? applied : skipped).push(d);
      } catch (e: any) {
        this.logger.warn(`[schema-drift] failed to reconcile index on '${d.table}'`, e?.message ?? e);
        skipped.push(d);
      }
    }
    return { applied, skipped };
  }

  /**
   * Apply one index drift op (#3728). Portable across dialects: index DDL needs
   * neither `ALTER COLUMN` nor the SQLite table rebuild that column ops do.
   */
  protected async applyIndexDriftOp(op: DriftOp): Promise<boolean> {
    const physicalColumns = new Set(Object.keys(await this.knex(op.table).columnInfo()));
    const ensure = (name: string, columns: string[], unique: boolean) =>
      this.syncDeclaredIndexes(op.table, [{ name, fields: columns, unique }], physicalColumns);

    switch (op.type) {
      case 'replace_unique_index': {
        // CREATE before DROP: the composite and the legacy index have different
        // names, so uniqueness is never unenforced in between. If the create
        // fails we have not dropped anything yet and the schema is untouched.
        await ensure(op.createIndexName, op.createColumns, true);
        // …and only drop once the replacement is confirmed present. This is a
        // relaxation, not a removal: if `syncDeclaredIndexes` skipped the create
        // (a column it references is not materialized), dropping the legacy
        // index would leave the field with NO uniqueness at all.
        if (!(await this.getExistingIndexNames(op.table)).has(op.createIndexName)) {
          this.logger.warn(
            `[schema-drift] keeping legacy unique index(es) ${op.dropIndexNames.join(', ')} on '${op.table}' — ` +
              `the replacement '${op.createIndexName}' could not be created.`,
          );
          return false;
        }
        for (const name of op.dropIndexNames) {
          await this.dropIndexIfExists(op.table, name);
        }
        return true;
      }
      case 'create_index':
        await ensure(op.indexName, op.columns, op.unique);
        return true;
      case 'drop_index':
        return await this.dropIndexIfExists(op.table, op.indexName);
      case 'recreate_index':
        // Same name on both sides — the drop has to come first, and a UNIQUE
        // target can fail on existing duplicates. That is why this op is
        // categorised destructive when unique (see `diffManagedIndexes`).
        await this.dropIndexIfExists(op.table, op.indexName);
        await ensure(op.indexName, op.columns, op.unique);
        return true;
      default:
        return false;
    }
  }

  /** Apply a single drift op in place (Postgres / MySQL). Returns false if unsupported. */
  protected async applyDriftOpInPlace(op: DriftOp): Promise<boolean> {
    // Index ops need no dialect-specific ALTER — route them to the portable path.
    if (isIndexDriftOp(op)) return this.applyIndexDriftOp(op);
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
        case 'drop_column_default':
          await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP DEFAULT', [table, column]);
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
        case 'drop_column_default':
          // `ALTER … ALTER COLUMN … DROP DEFAULT` — the one ALTER COLUMN form
          // MySQL accepts without restating the type, so it cannot lose a
          // varchar length the way MODIFY can.
          await this.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP DEFAULT', [table, column]);
          return true;
      }
    }
    this.logger.warn(`[schema-drift] ${op.type} on ${table}.${column} is unsupported on dialect '${this.dialectName}' — skipped`);
    return false;
  }

  /**
   * Rebuild a SQLite table applying a set of column edits (relax/tighten NOT
   * NULL, drop column, drop a column DEFAULT), preserving all other columns and
   * their data. Follows the official SQLite procedure: create patched table →
   * copy → drop → rename. varchar widen/narrow are no-ops on SQLite (dynamic
   * typing) and ignored.
   *
   * SQLite cannot alter a column's DEFAULT in place, so `drop_column_default`
   * (#4560) is reconciled here too — by re-materializing every column's default
   * from METADATA through {@link applyDeclaredColumnDefault} and simply not
   * re-emitting the dropped one. Rebuilding from metadata rather than copying
   * the physical DEFAULT is what makes this safe both ways: the token default
   * the op targets is gone because metadata never declared it, and a sibling
   * `defaultValue: 'NOW()'` column keeps the default it always had instead of
   * silently losing it to the rebuild.
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
    const dropDefault = new Set<string>();
    for (const e of ents) {
      if (e.op.type === 'relax_not_null') relax.add(e.op.column);
      else if (e.op.type === 'tighten_not_null') tighten.add(e.op.column);
      else if (e.op.type === 'drop_column') drop.add(e.op.column);
      else if (e.op.type === 'drop_column_default') dropDefault.add(e.op.column);
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
            if (c.name === 'created_at' || c.name === 'updated_at') {
              col.defaultTo(this.knex.fn.now());
            } else if (!dropDefault.has(c.name)) {
              // Re-emit the METADATA-declared default. The rebuild dropped the
              // original table, so a column whose default is not restated here
              // comes back without one — which is precisely what a
              // `drop_column_default` op wants, and precisely what a
              // `defaultValue: 'NOW()'` sibling must not suffer.
              const f = (fields as Record<string, any>)[c.name];
              if (f) this.applyDeclaredColumnDefault(col, f, f.type || 'string');
            }
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

    // Recreate unique constraints + declared indexes from metadata. The rebuild
    // dropped the original table, so every index went with it — this is a fresh
    // materialization, and it must produce the SAME constraints as
    // `initObjects` would. It used to inline its own `uniq_<table>_<col>`
    // single-column DDL, which is how a tenant-scoped field could silently
    // regain a global unique index after any drift rebuild (#3696); both paths
    // now share {@link syncTableIndexes}.
    try {
      const keptSet = new Set(keptNames);
      await this.syncTableIndexes(
        table,
        fields,
        this.managedObjectIndexes.get(table),
        this.resolveTenantField(table),
        keptSet,
      );
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
   * already-materialized index by name).
   *
   * Delegates to the shared {@link buildIndexName} so the names the driver
   * *creates* and the names the drift differ *looks for* can never diverge.
   */
  protected buildIndexName(tableName: string, fields: string[], unique: boolean): string {
    return buildIndexName(tableName, fields, unique);
  }

  /**
   * Read the indexes that physically exist on a table — name, ordered columns,
   * uniqueness, and whether it backs the PRIMARY KEY — per dialect.
   *
   * Used both for sync idempotency ({@link getExistingIndexNames}) and for index
   * drift detection (#3728), which needs the full definition rather than just
   * the name. Failures are swallowed: at worst we attempt a create and absorb
   * the "already exists" error in {@link syncDeclaredIndexes}.
   *
   * Postgres reads `pg_index` rather than `pg_indexes` so indexes backing a
   * UNIQUE CONSTRAINT (which is exactly what knex's old `col.unique()` produced)
   * are returned too — the drift detector cannot see the #3696 legacy shape
   * otherwise.
   */
  protected async introspectIndexes(tableName: string): Promise<PhysicalIndex[]> {
    const byName = new Map<string, PhysicalIndex>();
    const upsert = (name: string, unique: boolean, primary: boolean): PhysicalIndex => {
      let e = byName.get(name);
      if (!e) byName.set(name, (e = { name, columns: [], unique, primary }));
      return e;
    };
    try {
      if (this.isSqlite) {
        const safe = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const list: any = await this.knex.raw(`PRAGMA index_list(${safe})`);
        for (const r of list) {
          const entry = upsert(r.name, r.unique === 1 || r.unique === true, r.origin === 'pk');
          const info: any = await this.knex.raw(`PRAGMA index_info(${JSON.stringify(r.name)})`);
          // An expression index reports a null column name — skip those parts;
          // a partial column list only ever makes the differ *less* eager.
          for (const c of info) if (c.name != null) entry.columns.push(c.name);
        }
      } else if (this.isPostgres) {
        const res: any = await this.knex.raw(
          `SELECT i.relname AS index_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
                  a.attname AS column_name
             FROM pg_class t
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_index ix ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
             JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
            WHERE t.relname = ? AND n.nspname = 'public'
            ORDER BY i.relname, k.ord`,
          [tableName],
        );
        for (const r of res.rows) {
          upsert(r.index_name, r.is_unique === true, r.is_primary === true).columns.push(r.column_name);
        }
      } else if (this.isMysql) {
        const res: any = await this.knex.raw(
          `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
             FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
          [tableName],
        );
        for (const r of res[0]) {
          upsert(
            r.INDEX_NAME,
            Number(r.NON_UNIQUE) === 0,
            r.INDEX_NAME === 'PRIMARY',
          ).columns.push(r.COLUMN_NAME);
        }
      }
    } catch {
      // Best-effort — fall through and let creation handle conflicts.
    }
    return [...byName.values()];
  }

  /**
   * Names of the indexes that already exist on a table. Used to make
   * declared-index sync idempotent across repeated runs.
   */
  protected async getExistingIndexNames(tableName: string): Promise<Set<string>> {
    return new Set((await this.introspectIndexes(tableName)).map((i) => i.name));
  }

  /**
   * Translate field-level `unique` declarations into concrete index
   * descriptors, applying tenant scoping (#3696). Delegates to the shared
   * {@link uniqueIndexesFromFields} — see there for the scoping rule.
   */
  protected uniqueIndexesFromFields(
    tableName: string,
    fields: Record<string, any>,
    tenantField: string | null,
  ): Array<{ name: string; fields: string[]; unique: true }> {
    return uniqueIndexesFromFields(tableName, fields, tenantField).map((i) => ({
      name: i.name,
      fields: i.columns,
      unique: true as const,
    }));
  }

  /**
   * Drop an index (or the constraint backing it) by name if present, across
   * dialects.
   *
   * Postgres materializes knex's `col.unique()` as a table CONSTRAINT (not a
   * bare index), so `DROP INDEX` alone silently leaves it in place — the exact
   * failure that would have made the #3696 migration a no-op on the deployments
   * that matter most. Try the constraint form first, then the index form.
   *
   * Returns true when something was actually dropped.
   */
  protected async dropIndexIfExists(tableName: string, indexName: string): Promise<boolean> {
    const attempts: string[] = this.isPostgres
      ? [
          `ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`,
          `DROP INDEX IF EXISTS ??`,
        ]
      : this.isMysql
        ? [`ALTER TABLE ?? DROP INDEX ??`]
        : [`DROP INDEX IF EXISTS ??`];

    let dropped = false;
    for (const sql of attempts) {
      try {
        const bindings = sql.startsWith('ALTER TABLE') ? [tableName, indexName] : [indexName];
        await this.knex.raw(sql, bindings);
        dropped = true;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // "does not exist" / "check that column/key exists" — nothing to drop.
        if (/does not exist|doesn't exist|no such index|check that column/i.test(msg)) continue;
        throw e;
      }
    }
    return dropped;
  }

  /**
   * Materialize a table's full index set: field-level `unique` (tenancy-aware,
   * see {@link uniqueIndexesFromFields}) plus the object's declared `indexes`.
   * Single entry point so every caller — create, alter, SQLite rebuild — lands
   * on identical DDL.
   *
   * ADDITIVE ONLY (#3728). This creates indexes; it never drops or rewrites
   * one. Retiring the legacy platform-wide unique index a tenant-scoped field
   * used to carry (#3696) used to happen right here, unconditionally, at every
   * boot — a DROP that `os migrate plan` could not show and an operator could
   * not pre-inspect, and which altered a managed schema in production in
   * violation of the #2186 contract. That DROP is now a
   * `replace_unique_index` drift entry: detected by
   * {@link detectManagedDrift}, rendered by `os migrate plan`, applied by
   * `os migrate apply` — and still auto-reconciled at boot in dev, via the same
   * `autoMigrate: 'safe'` policy that governs every other safe drift.
   */
  protected async syncTableIndexes(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes: any[] | undefined,
    tenantField: string | null,
    physicalColumns: Set<string>,
  ): Promise<void> {
    const fromFields = this.uniqueIndexesFromFields(tableName, fields, tenantField);
    const declared = Array.isArray(declaredIndexes) ? declaredIndexes : [];
    if (fromFields.length === 0 && declared.length === 0) return;
    await this.syncDeclaredIndexes(tableName, [...fromFields, ...declared], physicalColumns);
  }

  /**
   * Materialize declared object-level indexes.
   *
   * - Multi-column and single-column indexes are both supported.
   * - `unique: true` emits a UNIQUE index. NULL-distinct semantics are the
   *   default across SQLite/Postgres/MySQL, so multiple NULL rows remain
   *   allowed while non-NULL duplicates are rejected — matching the
   *   convergence-on-conflict pattern the messaging pipeline relies on.
   * - The column list is taken VERBATIM — no tenant column is injected here.
   *   Field-level `unique` is tenancy-scoped upstream in
   *   {@link uniqueIndexesFromFields}; a declared index already names its
   *   columns and is frequently platform-wide on purpose (a DNS hostname, a
   *   reserved slug, an external provider id), so guessing would break it.
   * - Idempotent: indexes already present (by deterministic name) are
   *   skipped, and an "already exists" race is absorbed.
   * - Indexes referencing a column that wasn't materialized (e.g. a virtual
   *   `formula` field) are skipped with a warning rather than failing sync.
   */
  protected async syncDeclaredIndexes(
    tableName: string,
    indexes: Array<{ name?: string; fields?: string[]; unique?: boolean | 'global' }>,
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

      const unique = isUniqueDeclared(idx.unique);
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
    const tenantId = options?.tenantId;
    if (tenantId === undefined || tenantId === null || tenantId === '') return builder;
    const field = this.resolveTenantField(object);
    if (!field) return builder;
    // [ADR-0105 D2 / #3623] Union tenant scope: under the `group` posture the
    // engine threads the caller's whole membership set as `tenantIds`, and the
    // native wall widens to `IN (...)` — the SAME union the Layer 0
    // authorization wall enforces above. Equality here would AND under that
    // union and collapse group reads to active-org reach. A malformed or
    // empty set falls through to the equality path: fail toward isolation,
    // never toward exposure. Insert-side injection (injectTenantOnInsert)
    // deliberately keeps `tenantId` — the active org is the write target (D5).
    const rawIds = options?.tenantIds;
    const tenantIds = Array.isArray(rawIds)
      ? rawIds.filter((v: unknown) => typeof v === 'string' && v !== '')
      : [];
    if (tenantIds.length > 0) {
      return builder.where((b) => {
        void b.whereIn(field, tenantIds.map(String)).orWhereNull(field);
      });
    }
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
    const tenantId = options?.tenantId;
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
    if (options?.bypassTenantAudit === true) return;
    // Only meaningful in multi-tenant deployments. Single-tenant stacks have no
    // tenant isolation, yet the kernel now ALWAYS provisions an `organization_id`
    // column (its existence is decoupled from the tenant flag). Column presence
    // alone therefore no longer implies "tenant-scoped" — without this gate every
    // system/sudo write (e.g. the notification/http delivery dispatchers' claim
    // updates) would spam a meaningless warning on single-tenant boots.
    if (!this.isMultiTenantMode()) return;
    const tenantId = options?.tenantId;
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
   * Present a `Field.time` value as its canonical wall-clock time-of-day
   * (`HH:MM:SS[.fff]` — {@link canonicalTimeOfDay}). Shared by the filter
   * (`coerceFilterValue`), write (`formatInput`) and read (`formatOutput`,
   * `presentReadValue`) paths, exactly like {@link toDateOnly} for `Field.date`
   * — one definition of what a time *is* on all three, which is the #3994 fix.
   * On read it transparently repairs legacy rows (full-timestamp text from the
   * old `CURRENT_TIMESTAMP` default, epoch ms from a bound `Date`) with no data
   * migration, and re-pads a dialect's trimmed fraction (Postgres returns
   * `.5` for the stored `.500`).
   */
  protected toTimeOnly(value: any): any {
    return canonicalTimeOfDay(value);
  }

  /**
   * Put a filter comparand into the same canonical form the column is STORED in,
   * so a comparison can never be decided by the two sides' shapes disagreeing.
   *
   * `Field.datetime` → canonical UTC ISO ({@link canonicalUtcDatetime}), the
   * exact function `formatInput` applies on write. One rule, every dialect:
   *   - It is what a SQLite column now holds, as TEXT that sorts chronologically,
   *     so the comparison is a plain indexable string compare.
   *   - It is unambiguous for a Postgres `timestamptz`. This part is a FIX, not a
   *     no-op: the comparand used to be passed through untouched there, so a bare
   *     `YYYY-MM-DD` from a `{30_days_ago}` token meant midnight in the SERVER's
   *     timezone. Measured on an `Asia/Shanghai` server, the identical query put
   *     the identical instant on a different calendar day than SQLite did — a
   *     silently wrong window rather than an empty one.
   *
   * The previous rule coerced to an epoch INTEGER on SQLite only, which assumed
   * a storage form the write path never guaranteed; see #3912 for why that could
   * not be made correct without also rewriting what the writer produces.
   *
   * `Field.date` keeps ISO TEXT, normalised to `YYYY-MM-DD` (ADR-0053 Phase 1).
   */
  protected coerceFilterValue(table: string | null, field: string, value: any): any {
    if (value == null || !table) return value;
    if (Array.isArray(value)) return value.map((v) => this.coerceFilterValue(table, field, v));

    const kind = this.temporalFieldKind(table, field);
    if (!kind) return value;
    if (kind === 'datetime') return this.storageDatetimeValue(value);
    // `Field.time` (#3994) takes the same treatment for the same reason: the
    // comparand must be the canonical time-of-day text the column stores.
    if (kind === 'time') return canonicalTimeOfDay(value);
    return this.toDateOnly(value);
  }

  /**
   * The exclusive upper-bound instant for a bare calendar-day comparand on a
   * `datetime` column — next day's midnight UTC, in this dialect's storage
   * form — or `null` when the calendar-day reading does not apply.
   *
   * This is the missing half of the calendar-day convention (#3777). A bare
   * `YYYY-MM-DD` anchors to midnight UTC ({@link storageDatetimeValue}), which
   * is exactly right for a LOWER bound (`>= {today}` means "from the moment
   * the day starts") and exactly wrong for an UPPER bound: `<= {today}` from a
   * dashboard's date-range filter means "including today", but midnight
   * anchoring turns it into "up to the first instant of today", silently
   * dropping every row created after 00:00 — with `created_at` (a system
   * `Field.datetime`) as the filter's default field, the default dashboard
   * configuration loses the current day.
   *
   * The translation is operator-sensitive, so it lives at the comparison
   * emitters (which know their operator) rather than inside the operator-blind
   * {@link coerceFilterValue}: an upper-bound `$lte`/`<=`/`between`-max with a
   * bare-day comparand compiles to the half-open `< next-day-midnight` — the
   * same `[gte, lt)` shape the analytics drill ranges emit — never to an
   * inclusive `23:59:59.999`, which re-opens the gap at whatever precision the
   * dialect stores beyond milliseconds.
   *
   * Deliberately narrow, mirroring the semantics table on #3777:
   *   - `date` / `time` / non-temporal columns → null (a bare day on a `date`
   *     column is already whole-day-correct under `<=`);
   *   - full ISO timestamps and `Date` objects → null (an instant comparand
   *     keeps instant semantics — only the day-granular STRING carries
   *     calendar-day intent);
   *   - `$gte` / `$gt` / `$lt` keep their midnight anchoring (correct today).
   */
  protected calendarDayExclusiveUpperBound(
    table: string | null,
    field: string,
    value: unknown,
  ): unknown | null {
    if (this.temporalFieldKind(table, field) !== 'datetime') return null;
    const next = nextUtcCalendarDay(value);
    if (next == null) return null;
    return this.storageDatetimeValue(`${next}T00:00:00.000Z`);
  }

  /**
   * Rewrite one upper-bound comparison for calendar-day intent: `$lte`/`<=`
   * with a bare `YYYY-MM-DD` on a `datetime` column becomes `$lt`/`<` against
   * {@link calendarDayExclusiveUpperBound}. Returns `null` — "not applicable,
   * compile as-is" — for every other operator/comparand/column combination.
   */
  protected calendarDayUpperBoundRewrite(
    table: string | null,
    field: string,
    op: string,
    value: unknown,
  ): { op: string; value: unknown } | null {
    if (op !== '$lte' && op !== '<=') return null;
    const upper = this.calendarDayExclusiveUpperBound(table, field, value);
    if (upper == null) return null;
    return { op: op === '$lte' ? '$lt' : '<', value: upper };
  }

  /**
   * The `between` companion of {@link calendarDayUpperBoundRewrite}: a
   * `[min, max]` range whose max is a bare calendar day on a `datetime` column
   * decomposes into the half-open pair `>= min AND < next-day(max)` — knex's
   * `whereBetween` is inclusive on both ends, so it inherits the same
   * midnight-anchored upper bound `$lte` had. Returns `null` when the range is
   * malformed (caller keeps its descriptive error) or the rewrite does not
   * apply.
   */
  protected calendarDayBetweenRewrite(
    table: string | null,
    field: string,
    value: unknown,
  ): { lower: unknown; upper: unknown } | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const upper = this.calendarDayExclusiveUpperBound(table, field, value[1]);
    if (upper == null) return null;
    return { lower: this.coerceFilterValue(table, field, value[0]), upper };
  }

  /**
   * Might this SQLite `Field.datetime` column still hold values written BEFORE
   * the canonical-UTC-text convention (#3912) — an INTEGER/REAL epoch from a
   * bound JS `Date`, a zone-naive `CURRENT_TIMESTAMP` string, an offset-bearing
   * `+08:00` string — and therefore need
   * {@link sqliteCanonicalDatetimeSql} wrapped around it before it is compared
   * or bucketed?
   *
   * This is the ONE predicate for that question. Every consumer of it has already
   * been bitten by disagreeing about storage — the filter comparand (#2034, then
   * #3912) and the aggregate bucket expression (#3773) — so they share it rather
   * than each carrying a copy of the rule.
   *
   * `false` in three cases, and the third is the point of the whole exercise:
   *   - not SQLite (Postgres/MySQL have a real temporal type);
   *   - not a declared `Field.datetime`;
   *   - the column has been BACKFILLED to the canonical form in this process
   *     ({@link backfillCanonicalDatetimes}), so every row is already canonical
   *     text and the repair would only cost an unindexable expression.
   *
   * That last exit is what makes the convention pay off rather than just move the
   * cost around: after migration the emitted SQL is a plain `col >= ?` again.
   */
  /**
   * The physical form a `Field.datetime` value takes on THIS dialect — what is
   * actually bound, on both the write path (`formatInput`) and the filter path
   * (`coerceFilterValue`), so the two can never disagree.
   *
   * The logical canon is {@link canonicalUtcDatetime}'s `…Z` string everywhere.
   * MySQL is the one dialect that cannot parse it, so it gets the same instant
   * spelled as a MySQL literal (see {@link mysqlDatetimeLiteral}); SQLite stores
   * the canonical string as-is and Postgres parses it straight into `timestamptz`.
   */
  protected storageDatetimeValue(value: unknown): unknown {
    const canonical = canonicalUtcDatetime(value);
    return this.isMysql ? mysqlDatetimeLiteral(canonical) : canonical;
  }

  protected needsLegacyDatetimeRepair(table: string | null | undefined, field: string): boolean {
    if (!table || !this.isSqlite) return false;
    if (this.datetimeFields[table]?.has(field) !== true) return false;
    return this.canonicalDatetimeFields[table]?.has(field) !== true;
  }

  /**
   * Read a possibly-legacy SQLite `Field.datetime` column as canonical UTC text
   * — the SQL twin of {@link canonicalUtcDatetime}, for rows written before the
   * convention existed and not yet backfilled.
   *
   * `strftime('%Y-%m-%dT%H:%M:%fZ', …)` is the same format string
   * {@link nowColumnDefault} already writes, so a repaired value is
   * byte-identical to a freshly written one — which is what lets the comparison
   * be a plain text compare. The `typeof()` dispatch is load-bearing: an epoch
   * INTEGER handed to `strftime` unconverted is read as a Julian day (#3773),
   * while `'unixepoch'` applied to text would read its leading year as seconds.
   *
   * `coalesce(…, col)` preserves genuinely uninterpretable junk instead of
   * turning it into NULL, matching `canonicalUtcDatetime`'s totality — a value
   * the driver cannot parse keeps failing the comparison, rather than silently
   * becoming "no value".
   */
  protected sqliteCanonicalDatetimeSql(columnSql: string): string {
    return (
      `(case when typeof(${columnSql}) in ('integer','real') ` +
      `then strftime('%Y-%m-%dT%H:%M:%fZ', ${columnSql}/1000.0, 'unixepoch') ` +
      `else coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ${columnSql}), ${columnSql}) end)`
    );
  }

  /**
   * The `Field.time` twin of {@link needsLegacyDatetimeRepair} (#3994): might
   * this SQLite `Field.time` column still hold pre-canonical values and
   * therefore need {@link sqliteCanonicalTimeSql} wrapped around it?
   */
  protected needsLegacyTimeRepair(table: string | null | undefined, field: string): boolean {
    if (!table || !this.isSqlite) return false;
    if (this.timeFields[table]?.has(field) !== true) return false;
    return this.canonicalTimeFields[table]?.has(field) !== true;
  }

  /**
   * Read a possibly-legacy SQLite `Field.time` column as canonical time-of-day
   * text — the SQL twin of {@link canonicalTimeOfDay}, for rows written before
   * the convention existed and not yet backfilled.
   *
   * `strftime` parses every legacy text shape in one call — bare `HH:MM`,
   * full-ISO, zone-naive `CURRENT_TIMESTAMP` output — and the `typeof()`
   * dispatch converts epoch INTEGER/REAL through `'unixepoch'`, exactly as in
   * {@link sqliteCanonicalDatetimeSql}. The extra `like '%.000'` CASE trims the
   * zero-millisecond suffix `%f` always emits, so the SQL spelling of
   * "canonical" is byte-identical to the JS one — the property the backfill's
   * `IS NOT` guard and the plan's row count both lean on.
   *
   * `coalesce(…, col)` preserves uninterpretable junk, matching
   * `canonicalTimeOfDay`'s totality. The column reference appears
   * {@link SQLITE_TIME_EXPR_REFS} times; callers bind accordingly.
   */
  protected sqliteCanonicalTimeSql(columnSql: string): string {
    const canonText = (args: string) =>
      `case when strftime('%H:%M:%f', ${args}) like '%.000' ` +
      `then strftime('%H:%M:%S', ${args}) ` +
      `else strftime('%H:%M:%f', ${args}) end`;
    return (
      `(case when typeof(${columnSql}) in ('integer','real') ` +
      `then ${canonText(`${columnSql}/1000.0, 'unixepoch'`)} ` +
      `else coalesce(${canonText(columnSql)}, ${columnSql}) end)`
    );
  }

  /**
   * Which temporal presentation rule, if any, a declared field takes —
   * `null` for everything that is not a `Field.datetime` / `Field.date` /
   * `Field.time`.
   */
  protected temporalFieldKind(
    table: string | null | undefined,
    field: string,
  ): 'datetime' | 'date' | 'time' | null {
    if (!table) return null;
    if (this.datetimeFields[table]?.has(field)) return 'datetime';
    if (this.dateFields[table]?.has(field)) return 'date';
    if (this.timeFields[table]?.has(field)) return 'time';
    return null;
  }

  /**
   * Which read-presentation rule, if any, a declared field takes — the same
   * question {@link formatOutput} answers implicitly while walking a `find()`
   * row, asked one field at a time so the paths that return raw builder output
   * can ask it too. `null` means the stored form already IS the presented form.
   *
   * The boolean / numeric rules are SQLite-only because `formatOutput` gates
   * them that way: SQLite is the dialect without a native boolean, and the
   * numeric repair only exists for legacy TEXT-affinity columns.
   */
  protected readPresentationKind(
    table: string | null | undefined,
    field: string,
  ): ReadPresentationKind | null {
    if (!table) return null;
    const temporal = this.temporalFieldKind(table, field);
    if (temporal) return temporal;
    if (!this.isSqlite) return null;
    if (this.booleanFields[table]?.includes(field)) return 'boolean';
    if (this.numericFields[table]?.includes(field)) return 'number';
    return null;
  }

  /**
   * Present one value exactly the way `formatOutput` presents it on a `find()`
   * row, for the read paths that return raw builder output instead
   * (`aggregate`, `distinct` — #3797 for instants, #3849 for scalars).
   *
   * The dialect gating mirrors `formatOutput`: the `Field.datetime` repair and
   * the boolean / numeric coercions are SQLite-only (it is the one dialect where
   * storage ≠ presentation), while the `Field.date` → `YYYY-MM-DD` collapse runs
   * everywhere. {@link readPresentationKind} does the SQLite gating for the
   * scalar kinds, so by the time one arrives here the dialect is settled.
   */
  protected presentReadValue(kind: ReadPresentationKind, value: any): any {
    if (value == null) return value;
    switch (kind) {
      case 'date':
        return this.toDateOnly(value);
      case 'time':
        // Every dialect, like `date`: canonicalising also re-pads the fraction
        // Postgres trims (`.5` → `.500`), so `distinct()`/`aggregate()` present
        // exactly what `find()` presents (#3994, the F6 gap of the #3849 fix).
        return this.toTimeOnly(value);
      case 'datetime':
        return this.isSqlite ? normalizeSqliteDatetimeOutput(value) : value;
      case 'boolean':
        return Boolean(value);
      case 'number': {
        // Only strings are repaired, exactly as in `formatOutput`: a fresh
        // REAL/INTEGER column already yields a number, and genuinely
        // non-numeric legacy junk is left intact rather than turned into NaN.
        if (typeof value === 'string' && value.trim() !== '') {
          const n = Number(value);
          if (!Number.isNaN(n)) return n;
        }
        return value;
      }
    }
  }

  /**
   * Apply {@link presentReadValue} to the result columns a caller of
   * `aggregate()` will read as column VALUES — group keys, and `min`/`max`.
   *
   * Which columns those are cannot be recovered from the rows — the driver has
   * to be told, because the mapping from column name to meaning is only
   * unambiguous while the statement is being built (a `min()` lands under its
   * alias; a date-BUCKETED column lands under the field name but holds a label).
   * Rows are mutated in place, as `formatOutput` does.
   */
  protected presentReadColumns(rows: any, columns: Map<string, ReadPresentationKind>): any {
    if (columns.size === 0 || !Array.isArray(rows)) return rows;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const [column, kind] of columns) {
        if (row[column] !== undefined) row[column] = this.presentReadValue(kind, row[column]);
      }
    }
    return rows;
  }

  /**
   * The value expression to hand SQLite's `strftime()` for a bucketed column.
   *
   * Canonical UTC text (#3912) is passed straight through — `strftime` parses it,
   * `YYYY-MM-DD`, and the zone-naive `CURRENT_TIMESTAMP` form alike. A column
   * that may still hold PRE-canonical values gets {@link sqliteCanonicalDatetimeSql}
   * wrapped around it, which is likewise text, so `strftime` sees one shape
   * either way.
   *
   * Without that repair an epoch INTEGER reaches `strftime` as a bare number,
   * which SQLite reads as a Julian DAY — epoch ms is far outside the legal range,
   * so every row buckets as NULL and a trend chart collapses to one `(null)` bar
   * (#3773). The `typeof()` dispatch inside the repair is equally load-bearing in
   * the other direction: dividing a TEXT timestamp by 1000 coerces it to its
   * leading year (`'2026-01-10T…'/1000.0` = 2.026 seconds past the epoch),
   * bucketing live rows into 1970 — strictly worse than the NULL it replaces.
   */
  protected sqliteTemporalArg(
    field: string,
    table: string | null | undefined,
  ): { sql: string; bindings: any[] } {
    if (!this.needsLegacyDatetimeRepair(table, field)) return { sql: '??', bindings: [field] };
    return { sql: this.sqliteCanonicalDatetimeSql('??'), bindings: [field, field, field, field] };
  }

  /**
   * The left-hand side of a filter comparison on `column`, read in the same
   * canonical form {@link coerceFilterValue} puts the comparand in.
   *
   * `null` — the answer for every dialect, every non-datetime column, and every
   * SQLite datetime column that has been backfilled — means the plain identifier
   * is already correct, so the caller keeps the ordinary Knex builder call and
   * its indexable `col op ?` SQL. Only a column that may still hold PRE-canonical
   * values ({@link needsLegacyDatetimeRepair}) is wrapped.
   */
  protected filterColumnExpr(
    table: string | null | undefined,
    field: string,
    column: string,
  ): { sql: string; bindings: any[] } | null {
    if (this.needsLegacyDatetimeRepair(table, field)) {
      return {
        sql: this.sqliteCanonicalDatetimeSql('??'),
        bindings: [column, column, column, column],
      };
    }
    if (this.needsLegacyTimeRepair(table, field)) {
      return {
        sql: this.sqliteCanonicalTimeSql('??'),
        bindings: Array(SQLITE_TIME_EXPR_REFS).fill(column),
      };
    }
    return null;
  }

  /**
   * Compile one VALUE comparison against a storage-normalised column expression
   * ({@link filterColumnExpr}), for the operators where the stored form actually
   * matters.
   *
   * Returns `false` — "not handled, carry on" — for everything else, so the
   * caller's normal Knex path still owns: null predicates (`IS NULL` reads the
   * raw column and is form-independent), the `LIKE` family (a substring match on
   * an instant is meaningless, and the raw column is what the user typed
   * against), an empty `in`/`nin` set (Knex's `1 = 0` / `1 = 1` shortcuts), and a
   * malformed `between` (so the caller still throws its descriptive error).
   */
  private applyNormalizedComparison(
    builder: any,
    join: 'and' | 'or',
    expr: { sql: string; bindings: any[] },
    op: string,
    value: unknown,
  ): boolean {
    const raw = join === 'or' ? 'orWhereRaw' : 'whereRaw';
    const binary = (sqlOp: string): boolean => {
      // A null comparand is a null PREDICATE, not a comparison — hand it back so
      // the caller compiles `IS NULL` / `IS NOT NULL` as it always has.
      if (value == null) return false;
      builder[raw](`${expr.sql} ${sqlOp} ?`, [...expr.bindings, value]);
      return true;
    };
    const list = (sqlOp: 'in' | 'not in'): boolean => {
      if (!Array.isArray(value) || value.length === 0) return false;
      const placeholders = value.map(() => '?').join(', ');
      builder[raw](`${expr.sql} ${sqlOp} (${placeholders})`, [...expr.bindings, ...value]);
      return true;
    };

    switch (op) {
      case '=': case '==': case '$eq':
        return binary('=');
      case '!=': case '<>': case '$ne':
        return binary('<>');
      case '>': case '$gt':
        return binary('>');
      case '>=': case '$gte':
        return binary('>=');
      case '<': case '$lt':
        return binary('<');
      case '<=': case '$lte':
        return binary('<=');
      case 'in': case '$in':
        return list('in');
      case 'nin': case 'not_in': case 'notin': case '$nin':
        return list('not in');
      case 'between': case '$between': {
        if (!Array.isArray(value) || value.length !== 2) return false;
        builder[raw](`${expr.sql} between ? and ?`, [...expr.bindings, value[0], value[1]]);
        return true;
      }
      default:
        return false;
    }
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
   *
   * Deliberately operator-blind — it translates FORM, never bound semantics.
   * A caller compiling an upper bound from a bare calendar day (`<= {today}`,
   * a `dateRange` end) must apply `nextUtcCalendarDay` from `@objectstack/core`
   * and emit `<` — the half-open translation the driver's own `find()` path
   * performs via {@link calendarDayUpperBoundRewrite} (#3777). Folding that in
   * here would silently widen every `<=`-bound value whether or not the caller
   * flips its operator, which is exactly the ambiguity the emitter-side rule
   * avoids.
   */
  public temporalFilterValue(objectName: string, field: string, value: any): any {
    return this.coerceFilterValue(objectName, field, value);
  }

  /**
   * The companion of {@link temporalFilterValue} for the same outside-the-builder
   * callers: given the SQL they were going to put on the LEFT of the comparison
   * (an already-quoted, possibly join-qualified column reference), return the SQL
   * they must use instead so the column reads in the storage form the coerced
   * comparand is in.
   *
   * Everything but a SQLite `Field.datetime` gets its `columnSql` back verbatim.
   * That one case gets the {@link sqliteEpochMsSql} CASE, because the column is
   * mixed INTEGER-epoch / ISO-TEXT and coercing only the value matches whichever
   * half the writer happened to produce (#3912). Coercing the value is therefore
   * necessary but NOT sufficient — a caller that binds `temporalFilterValue`
   * must wrap its column with this too, or it keeps half the bug.
   */
  public temporalFilterColumnSql(objectName: string, field: string, columnSql: string): string {
    if (this.needsLegacyDatetimeRepair(objectName, field)) {
      return this.sqliteCanonicalDatetimeSql(columnSql);
    }
    if (this.needsLegacyTimeRepair(objectName, field)) {
      return this.sqliteCanonicalTimeSql(columnSql);
    }
    return columnSql;
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
        const column = this.remoteColumn(table, key, key);
        const coerced = this.coerceFilterValue(table, key, value);
        const expr = this.filterColumnExpr(table, key, column);
        if (expr && this.applyNormalizedComparison(builder, 'and', expr, '=', coerced)) continue;
        builder.where(column, coerced as any);
      }
      return;
    }

    if (!Array.isArray(filters) || filters.length === 0) return;

    let nextJoin: 'and' | 'or' = 'and';

    for (const item of filters) {
      if (typeof item === 'string') {
        const lower = item.toLowerCase();
        if (lower === 'or') { nextJoin = 'or'; continue; }
        if (lower === 'and') { nextJoin = 'and'; continue; }
        // Anything else is not a join keyword, and the only way a bare string
        // reaches here is a comparison triple that `isFilterAST()` refused —
        // its operator is outside `VALID_AST_OPERATORS`, so `parseFilterAST()`
        // never converted it and the raw array arrived as `where`. Skipping it
        // (the old behaviour) emitted NO predicate at all: the caller asked to
        // filter and silently got every row. Fail loudly instead. #3948.
        throw unsupportedFilterError(
          `Unrecognized filter operator "${item}" in a comparison triple. ` +
            `A filter array is either a logical node (["and"|"or", …]) or nested ` +
            `conditions ([[field, op, value], …]); a bare [field, op, value] only ` +
            `reaches the driver when its operator is outside @objectstack/spec ` +
            `VALID_AST_OPERATORS, which leaves the filter unparsed. ` +
            `Filter was: ${JSON.stringify(filters)}`,
        );
      }

      if (Array.isArray(item)) {
        const [fieldRaw, op, value] = item;
        const isCriterion = typeof fieldRaw === 'string' && typeof op === 'string';

        if (isCriterion) {
          const localField = this.mapSortField(fieldRaw);
          const field = this.remoteColumn(table, fieldRaw, localField);
          const opLower = String(op).toLowerCase();
          const columnExpr = this.filterColumnExpr(table, localField, field);
          // Calendar-day upper bounds (#3777) — same translation the
          // Mongo-operator path applies, for the array (`[field, op, value]`)
          // spelling of the identical comparison.
          const dayRange = opLower === 'between'
            ? this.calendarDayBetweenRewrite(table, localField, value) : null;
          if (dayRange) {
            (builder as any)[nextJoin === 'or' ? 'orWhere' : 'where']((qb: any) => {
              if (columnExpr) {
                this.applyNormalizedComparison(qb, 'and', columnExpr, '$gte', dayRange.lower);
                this.applyNormalizedComparison(qb, 'and', columnExpr, '$lt', dayRange.upper);
              } else {
                qb.where(field, '>=', dayRange.lower).andWhere(field, '<', dayRange.upper);
              }
            });
          } else {
            const rewrite = this.calendarDayUpperBoundRewrite(table, localField, opLower, value);
            const coerced = rewrite ? rewrite.value : this.coerceFilterValue(table, localField, value);
            this.applyAstComparison(
              builder, nextJoin, field, rewrite?.op ?? op, value, coerced,
              columnExpr,
            );
          }
        } else {
          const method = nextJoin === 'or' ? 'orWhere' : 'where';
          (builder as any)[method]((qb: any) => {
            this.applyFilters(qb, item);
          });
        }

        nextJoin = 'and';
        continue;
      }

      // Neither a join keyword nor a condition. Previously fell out of both
      // branches and was dropped, so a malformed element silently narrowed
      // nothing. Same reasoning as above: an unapplied filter must not look
      // like a satisfied one. #3948.
      throw unsupportedFilterError(
        `Unrecognized filter element of type "${item === null ? 'null' : typeof item}" — ` +
          `expected a logical keyword ("and"/"or") or a condition array. ` +
          `Filter was: ${JSON.stringify(filters)}`,
      );
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
   *
   * `columnExpr` (from {@link filterColumnExpr}) is the storage-normalised form
   * of `field` — non-null only for a SQLite `Field.datetime`, where comparing the
   * raw column would compare against whichever of the two stored forms the writer
   * happened to produce (#3912). It is optional so the protected signature stays
   * source-compatible for subclasses; omitting it just keeps the raw column.
   */
  protected applyAstComparison(
    builder: any,
    join: 'and' | 'or',
    field: string,
    op: string,
    rawValue: unknown,
    coerced: unknown,
    columnExpr?: { sql: string; bindings: any[] } | null,
  ): void {
    const where = join === 'or' ? 'orWhere' : 'where';
    const whereNull = join === 'or' ? 'orWhereNull' : 'whereNull';
    const whereNotNull = join === 'or' ? 'orWhereNotNull' : 'whereNotNull';
    // Fold every accepted spelling of one comparison onto a single infix form so
    // the switch below has one case per comparison rather than one per spelling.
    // `VALID_AST_OPERATORS` accepts `>`, `gt`, `greater_than`, `greaterthan` and
    // `after` for the same thing; growing a private alias list here is how this
    // driver and driver-memory drifted apart. #3948.
    const opLower = canonicalAstOperator(String(op));

    // Value comparisons on a mixed-storage column read it through the CASE; every
    // other operator (null predicates, the LIKE family, a malformed `between`)
    // declines and falls through to the ordinary handling below.
    if (columnExpr && this.applyNormalizedComparison(builder, join, columnExpr, opLower, coerced)) return;

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
          throw unsupportedFilterError(`Operator "between" on field "${field}" requires a [min, max] value array.`);
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
        throw unsupportedFilterError(
          `Unsupported filter operator "${op}" on field "${field}". Supported operators: ` +
            `=, !=, <, <=, >, >=, in, nin, between, contains, not_contains, starts_with, ends_with, ` +
            `is_null, is_not_null (see @objectstack/spec VALID_AST_OPERATORS).`,
        );
    }
  }

  /**
   * Compiles a Filter Protocol condition onto `builder`.
   *
   * `logicalOp` controls only how this condition attaches to `builder`
   * (`where` vs `orWhere`) — never how its contents combine. It is never
   * `'or'` on any in-repo path: the sole caller passes `'and'` and every
   * combinator recurses with `'and'`, because all keys in one filter object
   * AND at every depth. The `orWhere` that OR-s `$or`'s branches is applied
   * to each branch's own sub-builder; handing `'or'` down instead is exactly
   * what widened every `$or` filter (#3774 — see sql-driver-or-filter.test.ts).
   *
   * So the `logicalOp === 'or'` arms below are unreachable **by design**, not
   * dead weight to prune: the method is `protected`, i.e. subclass API, and
   * the flag is the seam an override needs to attach a condition into an OR
   * group. Do not "fix" them by making a branch propagate `'or'` again.
   */
  protected applyFilterCondition(builder: Knex.QueryBuilder, condition: any, logicalOp: 'and' | 'or' = 'and', tableHint?: string | null) {
    if (!condition || typeof condition !== 'object') return;
    const table = tableHint ?? this.coercionKey(builder);

    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        // Attach this group to the parent the way `logicalOp` asks, matching
        // `$or`/`$not` below. Nothing passes 'or' today (the sole caller uses
        // 'and' and no branch propagates 'or' any more), but leaving one of the
        // four combinators deaf to the flag is how the rules drift apart again.
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method]((qb: any) => {
          for (const sub of value) {
            qb.where((subQb: any) => {
              this.applyFilterCondition(subQb, sub, 'and', table);
            });
          }
        });
      } else if (key === '$or' && Array.isArray(value)) {
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method]((qb: any) => {
          for (const sub of value) {
            // The `orWhere` on THIS line is what OR-s the branches together.
            // The branch body is still compiled with 'and', because every key
            // inside one filter object is AND-ed at every depth (Filter
            // Protocol / Mongo). Passing 'or' down instead made a branch's own
            // field keys OR each other, so `{$or:[{a,b}]}` compiled to
            // `a = ? OR b = ?`. That widens the result set, so an RLS/sharing
            // read scope of the shape `{$or:[{owner,status},{shared_with}]}`
            // returned rows the scope excluded — see sql-driver-or-filter.test.ts.
            qb.orWhere((subQb: any) => {
              this.applyFilterCondition(subQb, sub, 'and', table);
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
        // Non-null only for a SQLite `Field.datetime`, whose two stored forms
        // (INTEGER epoch / ISO TEXT) must be unified before comparing (#3912).
        const columnExpr = this.filterColumnExpr(table, localField, field);
        for (const [rawOp, opValue] of Object.entries(value as Record<string, any>)) {
          const method = logicalOp === 'or' ? 'orWhere' : 'where';
          // Calendar-day upper bounds first (#3777): `$lte` on a bare
          // `YYYY-MM-DD` against a datetime column compiles half-open, and a
          // `$between` whose max is a bare day decomposes into the same pair —
          // grouped, so an `$or` branch stays one predicate.
          if (rawOp === '$between') {
            const dayRange = this.calendarDayBetweenRewrite(table, localField, opValue);
            if (dayRange) {
              (builder as any)[method]((qb: any) => {
                if (columnExpr) {
                  this.applyNormalizedComparison(qb, 'and', columnExpr, '$gte', dayRange.lower);
                  this.applyNormalizedComparison(qb, 'and', columnExpr, '$lt', dayRange.upper);
                } else {
                  qb.where(field, '>=', dayRange.lower).andWhere(field, '<', dayRange.upper);
                }
              });
              continue;
            }
          }
          const rewrite = this.calendarDayUpperBoundRewrite(table, localField, rawOp, opValue);
          const op = rewrite?.op ?? rawOp;
          const coerced = rewrite ? rewrite.value : this.coerceFilterValue(table, localField, opValue);
          if (columnExpr && this.applyNormalizedComparison(builder, logicalOp, columnExpr, op, coerced)) continue;
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
                throw unsupportedFilterError(`Operator "$between" on field "${field}" requires a [min, max] value array.`);
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
              throw unsupportedFilterError(
                `Unsupported filter operator "${op}" on field "${field}". Supported operators: ` +
                  `$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $between, $contains, $notContains, ` +
                  `$startsWith, $endsWith, $regex, $null, $exists.`,
              );
          }
        }
      } else {
        const localField = this.mapSortField(key);
        const field = this.remoteColumn(table, key, localField);
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        const coerced = this.coerceFilterValue(table, localField, value);
        const columnExpr = this.filterColumnExpr(table, localField, field);
        if (columnExpr && this.applyNormalizedComparison(builder, logicalOp, columnExpr, '=', coerced)) continue;
        (builder as any)[method](field, coerced as any);
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
   * The unique column this driver orders a paged read by, so that paging is a
   * partition of the result set rather than five independent queries that
   * happen to share a WHERE clause (objectui#3106, contract on
   * `IDataDriver.find`).
   *
   * `ORDER BY status LIMIT 50 OFFSET 50` names a key that does not identify a
   * row, and SQL promises nothing about how equal keys are arranged — nor that
   * two executions arrange them the same way. Page 2 can then repeat a row
   * page 1 already showed and skip one nobody ever sees. Every page looks
   * perfect on its own, which is why this is found by a user counting records
   * and not by reading a response.
   *
   * "Tie-breaker" stays the right word when the caller sent **no** `orderBy` at
   * all (objectstack#4363): on an empty sort key every row ties with every
   * other, so the same column that was breaking ties within a `status` group
   * ends up carrying the entire order. That is why one method answers both call
   * sites — the question is the same one, and a driver that could answer it for
   * a sorted page but not an unsorted one would be fixing the rarer half.
   *
   * Returns `null` — no ordering column, prior behavior exactly — unless this
   * driver **created** the table and therefore knows it carries the `id`
   * primary key (`initObjects` populates {@link managedObjectFields} for
   * exactly those). Guessing on a federated table (ADR-0015) would be worse
   * than doing nothing: an `id` column that isn't there raises an unknown-column
   * error, and the #3821 recovery ladder answers that by retrying with **no
   * ORDER BY at all** — trading a reshuffle among ties for the loss of the
   * caller's whole sort.
   *
   * Returns the LOGICAL field name; the call site maps it to a physical column
   * like any other sort key.
   */
  protected paginationTieBreaker(object: string): string | null {
    const tableName = StorageNameMapping.resolveTableName({ name: object } as any);
    const managed =
      this.managedObjectFields.has(tableName) || this.managedObjectFields.has(object);
    return managed ? 'id' : null;
  }

  /**
   * The complete ORDER BY for a `find()`: the caller's sort keys, followed by
   * {@link paginationTieBreaker} when the read needs one to be deterministic.
   * Logical field names — the call site maps each to a physical column.
   *
   * Three shapes, and the third is objectstack#4363:
   *
   * | `orderBy` | paged | result |
   * |---|---|---|
   * | non-empty | either | caller's keys + `id` |
   * | empty | `limit`/`offset` present | `id` alone |
   * | empty | neither present | **nothing** — the statement gets no ORDER BY |
   *
   * The last row is the deliberate carve-out, and it is why this asks about
   * pagination at all rather than sorting every read. An unpaged read hands
   * back the whole matching set: the caller sees every row whatever order they
   * arrive in, so there is no partial view to be wrong about, and an imposed
   * ORDER BY would only change plan selection for the majority of reads in the
   * system. The moment `limit`/`offset` appear the caller is being shown a
   * *slice*, and which rows fall in it stops being a matter of presentation.
   *
   * `limit` alone counts as paged, without waiting for an `offset`. Page one of
   * a walk is routinely `limit=50` with no offset at all, and a page one that
   * disagrees with the ordering pages two onward use is exactly the defect —
   * ordering only the later pages would leave the bug fully intact while
   * looking like a fix. `singleRowLookup` is how {@link findOne}'s own
   * `limit: 1` stays out of that reading; see {@link findRows}.
   *
   * The tie-breaker goes on in the LAST requested key's direction (`asc` when
   * there is none): determinism holds either way, but a same-direction suffix
   * is the one a compound index can still walk in a single pass.
   *
   * When the read is paged, unsorted, and {@link paginationTieBreaker} has no
   * column to offer, this warns once for that object. The behavior is unchanged
   * — the statement goes out exactly as it did before — but the contract states
   * determinism as a MUST, and a MUST that quietly does not hold is the same
   * invisible failure the rule exists to remove.
   */
  protected orderKeysFor(
    object: string,
    query: QueryAST,
    opts?: { singleRowLookup?: boolean },
  ): Array<{ field: string; direction: 'asc' | 'desc' }> {
    const keys: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
    if (Array.isArray(query.orderBy)) {
      for (const item of query.orderBy) {
        if (item.field) {
          keys.push({ field: item.field, direction: item.order === 'desc' ? 'desc' : 'asc' });
        }
      }
    }

    const paged =
      !opts?.singleRowLookup && (query.limit !== undefined || query.offset !== undefined);
    if (keys.length === 0 && !paged) return keys;

    const tieBreaker = this.paginationTieBreaker(object);
    if (tieBreaker && !keys.some((k) => k.field === tieBreaker)) {
      keys.push({ field: tieBreaker, direction: keys[keys.length - 1]?.direction ?? 'asc' });
    } else if (!tieBreaker && keys.length === 0) {
      // Paged, unsorted, and no column this driver can trust to order by: the
      // read goes out exactly as before, and its pages are not a partition.
      // Say so once per object rather than leave it to be discovered by a user
      // counting records — a guarantee the contract states as MUST, quietly
      // unavailable, is the same invisible failure it was written against.
      // (Sorted reads on such a table keep the caller's own ORDER BY, so only
      // the ties within it reshuffle; this case has nothing at all.)
      if (!this.nondeterministicPagingWarned.has(object)) {
        this.nondeterministicPagingWarned.add(object);
        this.logger.warn(
          `Paged read of '${object}' is NOT deterministic: this driver did not create the table, `
            + 'so it cannot name a unique column to order by, and the query asked for no sort of '
            + 'its own. Walking the pages may serve one row twice and never serve another '
            + '(objectstack#4363). Give the query an `orderBy` on a unique column, or declare the '
            + 'object so this driver manages its table.',
        );
      }
    }
    return keys;
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
    if (!this.isSqlite) {
      // A `time` column deserves the same reasoning on the native dialects
      // (#3994): `knex.fn.now()` compiles to CURRENT_TIMESTAMP, which a TIME
      // column resolves in the SERVER's timezone on Postgres and the INSERTING
      // session's timezone on MySQL — measured as three different wall clocks
      // for one instant across the three dialects. Pin the default to the UTC
      // time-of-day, matching what the driver's own writes and the SQLite
      // branch below produce. (MySQL 8.0 additionally REJECTS a plain
      // CURRENT_TIMESTAMP default on a TIME column — only the parenthesised
      // expression form, MySQL 8.0.13+/MariaDB 10.2+, is legal there at all.)
      if (type === 'time') {
        if (this.isMysql) return this.knex.raw('(cast(utc_timestamp(3) as time(3)))');
        if (this.isPostgres) return this.knex.raw("(timezone('utc', now())::time(3))");
      }
      // `date` has the same two problems one type over (#4022): a bare
      // CURRENT_TIMESTAMP default resolves the calendar day in the SERVER's
      // timezone on Postgres (measured: a UTC-12 server records YESTERDAY),
      // and MySQL 8.0 rejects it on a DATE column outright (MariaDB is merely
      // permissive; the driver's UTC-pinned session masked the semantic half
      // there). Same fix as `time`: an expression default reading the UTC
      // clock, which is also what `formatInput`'s NOW() safety-net and the
      // SQLite branch below store.
      if (type === 'date') {
        if (this.isMysql) return this.knex.raw('(cast(utc_timestamp() as date))');
        if (this.isPostgres) return this.knex.raw("(timezone('utc', now())::date)");
      }
      return this.knex.fn.now();
    }
    switch (type) {
      case 'date': return this.knex.raw("(strftime('%Y-%m-%d', 'now'))");
      // The CASE trims a zero-millisecond `.000` so a defaulted row is
      // byte-canonical ({@link canonicalTimeOfDay}) — `%f` alone would store
      // `'01:55:08.000'` once in a thousand inserts, and that row would then
      // miss an equality filter against the canonical `'01:55:08'`. SQLite
      // fixes `'now'` per statement, so the three calls cannot straddle a
      // millisecond boundary.
      case 'time': return this.knex.raw(
        "(case when strftime('%H:%M:%f', 'now') like '%.000' " +
        "then strftime('%H:%M:%S', 'now') else strftime('%H:%M:%f', 'now') end)",
      );
      // datetime (and any non-temporal field that opts into NOW()): canonical instant.
      default:     return this.knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
    }
  }

  /**
   * DDL for a builtin `created_at` / `updated_at` audit column.
   *
   * These are created directly rather than through {@link createColumn} (they are
   * not declared fields), but the objectql registry DOES declare them as
   * `Field.datetime` on every audited object — so they are filtered, sorted and
   * bucketed like one, and must take the same physical type or they inherit the
   * `TIMESTAMP` problems on MySQL: no milliseconds, and a 2038 ceiling on the
   * column every list view sorts by (#3942). `CURRENT_TIMESTAMP` has to carry
   * matching precision for a `DATETIME(3)` default, hence `now(3)`.
   */
  protected createAuditTimestampColumn(table: Knex.CreateTableBuilder, name: string): void {
    if (this.isMysql) {
      table.datetime(name, { precision: 3 }).defaultTo(this.knex.fn.now(3));
      return;
    }
    table.timestamp(name).defaultTo(this.knex.fn.now());
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
        // MySQL's `TIMESTAMP` is a 32-bit epoch: it cannot represent an instant
        // outside 1970-01-01..2038-01-19 (a contract end date, a subscription
        // expiry, a retention horizon — all rejected outright), it carries no
        // fractional seconds by default so the canonical form's milliseconds are
        // silently truncated, and it CONVERTS on read/write using the session
        // timezone, which makes the stored instant depend on server config.
        // `DATETIME(3)` has none of those properties: 1000..9999, milliseconds
        // kept, and stored verbatim — so the column holds the UTC wall clock the
        // driver writes, exactly as ServiceNow stores its MySQL timestamps
        // (#3942). Postgres deliberately keeps `table.timestamp` → `timestamptz`:
        // asking for precision 3 there would REDUCE it from microseconds.
        col = this.isMysql ? table.datetime(name, { precision: 3 }) : table.timestamp(name);
        break;
      case 'time':
        // MySQL's bare `TIME` is zero-precision and ROUNDS a fractional literal
        // (`'14:30:00.500'` → `14:30:01`), so the canonical form's milliseconds
        // would change the stored wall clock. `TIME(3)` keeps them — the
        // `DATETIME(3)` precedent (#3942) applied to time-of-day (#3994). Knex's
        // `time()` takes no precision, hence the explicit type.
        col = this.isMysql ? table.specificType(name, 'time(3)') : table.time(name);
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
      // NOTE: field-level `unique` is deliberately NOT emitted here (#3696).
      // A column builder can only express a SINGLE-column constraint, but on a
      // tenant-scoped object `unique: true` means unique *within the tenant* —
      // a composite `(tenantField, field)` index. Emitting `col.unique()` here
      // is what made every tenant share one global namespace, which collided
      // head-on with the per-tenant autonumber sequence (each tenant counts
      // from 1, so the second tenant's `PROD-00001` was rejected by an index it
      // could not see). All unique materialization now goes through the single
      // tenancy-aware path — {@link uniqueIndexesFromFields} +
      // {@link syncDeclaredIndexes} — which runs after the table exists and can
      // therefore build composites. `createColumn` owns type/nullability/
      // defaults only.
      //
      // ADR-0113: the physical NOT NULL comes from the EXPLICIT storage
      // constraint, not from `required` — `required` is the write-time
      // contract enforced by the record validator at the engine seam, and
      // binding the DDL to it made every post-deploy tightening a
      // destructive migration. Sources authored before protocol 17 carry
      // `storage.notNull` explicitly via the `field-required-notnull-explicit`
      // conversion, so their columns come out exactly as they always did.
      if ((field as { storage?: { notNull?: boolean } }).storage?.notNull) col.notNullable();
      this.applyDeclaredColumnDefault(col, field, type);
    }
  }

  /**
   * Emit the physical column DEFAULT a field's `defaultValue` calls for — or,
   * deliberately, none at all.
   *
   * The single place `defaultValue` becomes DDL. `createColumn` uses it for a
   * fresh column and {@link rebuildSqliteTablePatched} for a re-materialized
   * one, so a SQLite table rebuild cannot quietly hand back a column whose
   * default differs from the one metadata declares.
   *
   * Four cases, in order:
   *
   * 1. **`'NOW()'`** — the one runtime token with a database counterpart.
   *    Translated to the driver-native canonical default
   *    ({@link nowColumnDefault}) so the column gets a real, zone-explicit
   *    default instead of the literal string `'NOW()'` for whatever upstream
   *    code happens to write — and, on SQLite, instead of the timezone-naive
   *    `CURRENT_TIMESTAMP` that `knex.fn.now()` emits.
   * 2. **Any other runtime token** (`current_user`, and anything the spec adds
   *    to `DEFAULT_VALUE_TOKENS` later) — resolved by the ENGINE at insert time
   *    against the request context, with **no** database counterpart, so this
   *    emits NOTHING. That omission is the contract, not an oversight: the
   *    engine deliberately leaves a `current_user` field UNSET when there is no
   *    authenticated user (system/anonymous writes), and a column DEFAULT
   *    silently overrode that decision — writing the literal string
   *    `'current_user'` into `lookup('sys_user')` columns (#4560). Checking the
   *    spec's predicate rather than an open-coded name keeps a future token
   *    from leaking its own spelling the same way.
   * 3. **Objects** — Expression envelopes (`{ dialect, source }`), evaluated
   *    app-side; never a column DEFAULT.
   * 4. **Everything else** — a real literal, emitted verbatim.
   */
  protected applyDeclaredColumnDefault(col: Knex.ColumnBuilder, field: any, type: string): void {
    const dv = field?.defaultValue;
    if (dv === undefined || dv === null) return;
    if (isNowDefaultValue(dv)) {
      col.defaultTo(this.nowColumnDefault(type));
      return;
    }
    if (isRuntimeDefaultToken(dv)) return;
    if (typeof dv === 'object') return;
    col.defaultTo(dv as any);
  }

  // ── Database helpers ────────────────────────────────────────────────────────

  /**
   * The on-disk path backing this SQLite datasource, or `null` when there is
   * none: a non-SQLite dialect, `:memory:` (and any other `:`-prefixed
   * pseudo-filename), or a function-valued `connection` where the host builds
   * each connection itself and the target is not ours to read.
   */
  protected sqliteFilename(): string | null {
    if (!this.isSqlite) return null;
    const conn = (this.config as any).connection;
    const filename = typeof conn === 'string' ? conn : conn?.filename;
    if (typeof filename !== 'string' || filename === '') return null;
    return filename.startsWith(':') ? null : filename;
  }

  protected async ensureDatabaseExists() {
    // SQLite auto-creates database files but NOT parent directories.
    // Ensure the directory exists so better-sqlite3 can create the file.
    if (this.isSqlite) {
      const filename = this.sqliteFilename();
      if (filename) {
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

    // Same connect bound as the main pool (#3769) — this admin connection is
    // opened during boot against the very server we already suspect might be
    // unreachable, so it must not be the one place that waits 30s.
    const adminKnex = knex(SqlDriver.withConnectBound(adminConfig));
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

    // ADR-0053: a `Field.datetime` is an instant stored as UTC. Make the STORAGE
    // say so — collapse every accepted input shape (JS `Date`, epoch number, ISO
    // string, zone-naive wall clock, bare calendar day) to one canonical
    // `YYYY-MM-DDTHH:MM:SS.sssZ` before it hits the wire (#3912).
    //
    // This is the write half of the fix; `coerceFilterValue` applies the SAME
    // function to comparands, so the two sides of a comparison can no longer
    // disagree about shape. It runs on EVERY dialect, for two different reasons:
    //   - SQLite has no temporal type, so whatever is bound is what is stored. A
    //     `Date` landed as INTEGER epoch and a REST/JSON write as ISO TEXT, in
    //     the same column — the mixed storage that made every window filter
    //     return the wrong rows, and that still makes ORDER BY sort all INTEGER
    //     rows before all TEXT ones (#3928).
    //   - Postgres/MySQL do have one, but a zone-NAIVE string bound into it is
    //     interpreted in the SERVER's timezone, not UTC — measured at 8 hours off
    //     on an `Asia/Shanghai` server. Sending an explicit `Z` removes the
    //     server's timezone from the write path entirely.
    const datetimeFields = this.datetimeFields[object];
    if (datetimeFields && datetimeFields.size > 0 && copy && typeof copy === 'object') {
      for (const field of datetimeFields) {
        const v = copy[field];
        if (v == null) continue;
        // `NOW()` was already replaced with an ISO instant above; anything else
        // that is not interpretable as a time passes through untouched.
        const normalized = this.storageDatetimeValue(v);
        if (normalized !== v) {
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = normalized;
        }
      }
    }

    // ADR-0053 Phase 1: a `Field.date` is a timezone-naive calendar day, not
    // an instant. Collapse any `Date` or full-ISO value to `YYYY-MM-DD` before
    // it hits the wire so storage matches the date-only contract the filter
    // layer (`coerceFilterValue`) already enforces — the write/filter
    // asymmetry was the root cause of the silent date-equality miss.
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

    // #3994: a `Field.time` is a wall-clock time-of-day. Collapse every accepted
    // input shape (bare `HH:MM[:SS[.fff]]`, JS `Date`, epoch number, full ISO or
    // zone-naive timestamp) to the canonical `HH:MM:SS[.fff]` before it hits the
    // wire — the write half of the same fix `coerceFilterValue` applies to
    // comparands. On SQLite this ends the mixed TEXT/INTEGER storage that broke
    // window filters and ORDER BY; on Postgres/MySQL it turns shapes the native
    // TIME type rejects outright (full ISO — measured failing on both) or
    // resolves against the process's local timezone (a bound `Date` on pg) into
    // the one literal every dialect parses the same way.
    const timeFields = this.timeFields[object];
    if (timeFields && timeFields.size > 0 && copy && typeof copy === 'object') {
      for (const field of timeFields) {
        const v = copy[field];
        if (v == null) continue;
        const normalized = canonicalTimeOfDay(v);
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

    // Present `Field.time` as the canonical wall-clock time-of-day (#2004,
    // #3994) — the same `canonicalTimeOfDay` the write and filter paths apply,
    // so storage, comparand and presentation are one shape. On read this
    // transparently repairs legacy rows (full-timestamp text from the old
    // `CURRENT_TIMESTAMP` default, epoch ms from a bound `Date`) with no data
    // migration, and re-pads the fraction Postgres trims (`.5` → `.500`). Runs
    // for every dialect. See `toTimeOnly`.
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
