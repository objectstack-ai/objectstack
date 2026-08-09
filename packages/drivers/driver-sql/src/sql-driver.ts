// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL Driver for ObjectStack
 *
 * Implements the standard IDataDriver from @objectstack/spec via Knex.js.
 * Supports PostgreSQL, MySQL, SQLite, and other SQL databases.
 */

import type { DriverOptions, FilterCondition, SchemaMode } from '@objectstack/spec/data';
import { parseAutonumberFormat, renderAutonumber, missingFieldValues, isTenancyDisabled, type AutonumberToken } from '@objectstack/spec/data';
// The DECLARED aggregate vocabulary (#5907). Read from the spec so this driver's
// "the protocol has no such function" refusal cannot drift from what
// `AggregationNodeSchema.function` actually admits.
import { AggregationFunction } from '@objectstack/spec/data';
import { STRUCTURED_JSON_TYPES, FILE_REFERENCE_TYPES, MULTI_OPTION_TYPES, NUMERIC_VALUE_TYPES } from '@objectstack/spec/data';
// [#5659] The Filter Protocol's boolean identity reduction — `$and: []` is TRUE,
// `$or: []` is FALSE, `{}` is a TRUE disjunct, `$not: {}` is FALSE. One
// implementation for all four consumers, proven against the same
// `FILTER_LOGIC_CASES` table this driver's conformance suite runs; this file
// supplies only its own refusals. See `reduceFilterNode` below.
import {
  reduceFilterVerdict,
  reduceFilterKeyVerdict,
  type FilterVerdict as SharedFilterVerdict,
  type FilterVerdictHooks,
} from '@objectstack/spec/data';
// `defaultValue` runtime tokens (#4560). The DDL below asks the SPEC — not a
// list of its own — which `defaultValue`s are instructions rather than literals,
// so the engine and this driver can never disagree about what may become a
// physical column DEFAULT.
import { isNowDefaultToken, isRuntimeDefaultToken } from '@objectstack/spec/data';
// [#5702] The retired filter operators and the prescription each refusal
// prints. Read from the spec rather than restated here for the reason the
// #5701 table itself gives: five refusal sites that each write their own
// sentence about `$regex` are five sentences that drift apart. This driver
// prints `why` VERBATIM.
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import { StandardErrorCode } from '@objectstack/spec/api';
import { StorageNameMapping } from '@objectstack/spec/system';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import { isUniqueViolationError, resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { nextUtcCalendarDay } from '@objectstack/core';
import {
  applyIndexKeyParts,
  buildIndexName,
  diffManagedIndexes,
  diffManagedTable,
  driftKey,
  expectedIndexes,
  fieldHasColumn,
  GLOBAL_TENANT,
  isIndexDriftOp,
  isUniqueScopeDeclared,
  legacyUniqueReplacements,
  normalizeDeclaredIndex,
  organizationKeyPartSql,
  parseIndexDdl,
  uniqueIndexesFromFields,
  type DeclaredIndexInput,
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

// ── Raw index DDL the driver executes on the framework's behalf (#4884) ──────
/** An SQL identifier in any dialect's quoting, or bare. */
const SQL_IDENTIFIER = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_$]*)';
/** Cheap prefilter so ordinary `execute()` traffic never touches the parsers below. */
const INDEX_DDL_PREFIX = /^\s*(?:create|drop)\s+(?:unique\s+)?index\b/i;
const CREATE_INDEX_DDL = new RegExp(
  `^\\s*create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?` +
    `(${SQL_IDENTIFIER})\\s+on\\s+(${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})?)`,
  'i',
);
const DROP_INDEX_DDL = new RegExp(
  `^\\s*drop\\s+index\\s+(?:concurrently\\s+)?(?:if\\s+exists\\s+)?` +
    `(${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})?)`,
  'i',
);

/** Peel one layer of `"…"` / `` `…` `` / `[…]` quoting off an identifier. */
function unquoteSqlIdentifier(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === '`' && last === '`') || (first === '[' && last === ']')) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * The unquoted final segment of a possibly schema-qualified reference —
 * `"public"."sys_metadata"` → `sys_metadata`. Tokenised rather than split on
 * `.`, so a dot INSIDE a quoted identifier does not become a separator.
 */
function lastIdentifierSegment(raw: string): string {
  const parts = raw.match(new RegExp(SQL_IDENTIFIER, 'g'));
  return unquoteSqlIdentifier(parts && parts.length > 0 ? parts[parts.length - 1] : raw);
}

/**
 * Internal table that persists per-(object, tenant, field) auto-number
 * counters so sequences are monotonic, tenant-isolated, and resilient to
 * concurrent writers. Lazily created on first autonumber-bearing insert.
 */
const SEQUENCES_TABLE = '_objectstack_sequences';

// GLOBAL_TENANT ('__global__') — the sentinel for the NULL-organization
// ("platform") bucket — is defined ONCE in schema-drift.ts and imported here:
// since ADR-0120 D3 it names the same bucket in two subsystems (the autonumber
// sequence table's tenant key, and the COALESCE organization key part of every
// organization-scoped unique index), and #3696's root lesson was two
// subsystems naming one concept differently. Storage stays NULL — see the
// definition site.

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
 * `status: 400` puts the rejection on `@objectstack/rest`'s
 * `isExpectedQueryRejection` list, so a client mistake stops being logged as an
 * unhandled server error.
 *
 * It does NOT decide whether the message text survives, and the claim that it
 * "makes `sendError` pass the message through instead of routing it to the
 * SQL-leak heuristic" was backwards (#5423): WITHOUT a status these messages
 * already reached the client verbatim through `mapDataError`'s final
 * `{ status: 400, body: { error: raw } }` — the leak heuristics do not match
 * this wording. WITH the status they entered the explicit-status passthrough,
 * whose 500-character bound used to swap the whole body text for
 * `'Request failed'` — so in that band adding the status made the message LESS
 * readable, the opposite of what this comment promised. That bound now
 * truncates instead of replacing, so the main clause survives either way; the
 * tail (attribution, issue numbers) may be cut. Keep the actionable part —
 * operator, field, path, what arrived, what the spec declares — at the FRONT.
 *
 * [#5489] The "without a status it reached the client verbatim" half is now
 * history: that terminal branch answers a sanitised 500 (`INTERNAL_ERROR`).
 * Declaring `status` + `code` at the throw site is therefore the ONLY way a
 * refusal's words reach the caller at all — which is the contract-first
 * arrangement #4436 wanted, no longer relying on a fallback that leaked.
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

/**
 * [#6409] How one declared aggregate function lowers into SQL.
 *
 * `sql` is the function NAME; `distinct` decides whether the argument list
 * carries the `DISTINCT` keyword. Two fields rather than one string because
 * `count_distinct` is the first entry in the vocabulary whose lowering is not a
 * function name at all — `COUNT(DISTINCT x)` puts a keyword INSIDE the argument
 * list, so a table of bare names has nowhere to say it. Encoding it as a
 * template (`'count(distinct %s)'`) was the alternative and was rejected: the
 * emitter binds the column as a knex identifier (`??`), and a template would
 * have moved that binding into data.
 *
 * `distinct` also decides whether a FIELD is mandatory, which is why there is no
 * third flag saying so: `COUNT(*)` is the spelling `AggregationNodeSchema`
 * explicitly allows by making `field` optional, and `COUNT(DISTINCT *)` is a
 * syntax error in every dialect this driver targets — there is nothing to
 * deduplicate without a column. See {@link refuseDistinctAggregateWithoutField}.
 */
interface SqlAggregateLowering {
  readonly sql: string;
  readonly distinct: boolean;
}

/**
 * [#5907] The aggregate functions this driver LOWERS into SQL, and what each
 * becomes.
 *
 * The refusals below read their "compiled here" list off THIS table instead of
 * repeating it. A hand-written copy agrees with the compiler on the day it is
 * typed and never again — the note already sitting over `driver-memory`'s
 * `SUPPORTED_FIELD_OPERATORS` (#5345), applied to the aggregate vocabulary.
 *
 * A `Map` rather than a plain object on purpose: a caller-supplied name is
 * looked up here, and `{}['constructor']` answers with a function.
 *
 * [#6409] `count_distinct` joined the table, and with it the table gained the
 * `distinct` column. It is the ENFORCE leg of #6188's split ruling
 * (2026-08-07): `array_agg`/`string_agg` left `AggregationFunction` because no
 * SQL backend compiled them and none had one portable shape to compile TO,
 * while `count_distinct` has exactly one — `COUNT(DISTINCT x)`, already the
 * lowering `service-analytics`'s `AGGREGATE_SQL` uses for the Cube face — and
 * stayed declared on the strength of it. With this entry the declared
 * vocabulary and this driver's compiled vocabulary are the SAME SET; the values
 * are pinned against the remote face by `AGGREGATION_CASES`.
 */
const SQL_AGGREGATE_FUNCTIONS: ReadonlyMap<string, SqlAggregateLowering> = new Map([
  ['count', { sql: 'count', distinct: false }],
  ['sum', { sql: 'sum', distinct: false }],
  ['avg', { sql: 'avg', distinct: false }],
  ['min', { sql: 'min', distinct: false }],
  ['max', { sql: 'max', distinct: false }],
  ['count_distinct', { sql: 'count', distinct: true }],
]);

/**
 * [#5907] The aggregate vocabulary the Query Protocol DECLARES, read from the
 * spec rather than restated — `AggregationNodeSchema.function` is this enum, so
 * "declared" has exactly one definition and this driver cannot drift from it.
 */
const DECLARED_AGGREGATE_FUNCTIONS: readonly string[] = AggregationFunction.options;

/**
 * [#5907] Class 1 — a function name the Query Protocol does not declare.
 *
 * The caller wrote something no backend can run (`median`), so this is a
 * request-shaped mistake: `INVALID_QUERY` / 400, the catalogued
 * `StandardErrorCode` for "malformed query syntax" and a member of
 * `@objectstack/rest`'s `isExpectedQueryRejection` list, so a client mistake
 * stops being logged as an unhandled server fault.
 *
 * `INVALID_QUERY` is not a new spelling for this condition — it is the one the
 * PROTOCOL DOOR already gives it. `metadata-protocol`'s `invalidQueryError`
 * refuses "a function outside the spec enum" on the aggregations axis with
 * exactly `400 INVALID_QUERY` (#4254), so a caller who reaches this driver
 * in-process gets the same wire identity as one who came through REST: one
 * condition, one code, however the caller arrived — the argument
 * {@link unsupportedFilterError} makes for `INVALID_FILTER`.
 *
 * The FIRST SENTENCE is shared verbatim with the twin in `driver-turso`'s
 * `remote-transport.ts` (#5240 — one condition, one wording): a caller must not
 * be able to tell which transport answered from the words it used. The parity is
 * pinned by a test that compares the two RUNTIME messages, not two copies of a
 * literal (`remote-transport-aggregate-function-refusal.test.ts`).
 *
 * Judged against the declared enum CASE-SENSITIVELY, which is what the enum is:
 * `COUNT_DISTINCT` is not `count_distinct`, and answering "declared but not
 * implemented" for it would be false. When this was written the remote transport
 * still lowercased the name before its own lookup while this driver read it raw,
 * so classifying on each face's post-normalisation name would have handed
 * `COUNT_DISTINCT` a 400 here and a 501 there for one query. #6203 has since
 * removed that lowercasing, so the two faces now normalise alike — but the
 * case-sensitive judgement here is not merely a survivor of that fork: the enum
 * IS case-sensitive (`AggregationFunction.parse('COUNT')` throws), so this is
 * what "declared" means, whatever any transport does before asking.
 */
function undeclaredAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is not a declared aggregate function. ` +
    `Declared functions: ${DECLARED_AGGREGATE_FUNCTIONS.join(', ')} ` +
    `(@objectstack/spec AggregationFunction). Fix the "function" key of the aggregations[] ` +
    `entry — the Query Protocol has no such function, so this is a query no backend can run, ` +
    `not a gap in this one (#5907).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  return err;
}

/**
 * [#5907] Class 2 — a DECLARED function this backend cannot compile.
 *
 * Distinct from {@link undeclaredAggregateFunctionError} on purpose, and this is
 * the half that must not be collapsed into it: `count_distinct` is declared by
 * `AggregationFunction` and implemented by other backends (`driver-mongodb`,
 * and `driver-memory`'s analytics face), so telling a dashboard author their
 * `count_distinct` is a typo would be false — the same line #5345 drew in
 * `driver-memory`'s `filter-refusal.ts` between `unknownFieldOperatorError` and
 * `uncompilableFieldOperatorError`.
 *
 * `array_agg` and `string_agg` used to belong to this class too. #6188 retired
 * both from `AggregationFunction` (ADR-0049 — declared by the spec, compiled by
 * no SQL backend), so they now fall to class 1 and answer 400: the protocol no
 * longer has those names, which is a different fact from "this backend cannot
 * lower them" and deserves the different answer. `count_distinct` was
 * deliberately kept and took the enforce leg instead.
 *
 * ⚠️ [#6409] **This class is now EMPTY, and the producer is kept deliberately.**
 * `count_distinct` was its last inhabitant; with its lowering landed,
 * `SQL_AGGREGATE_FUNCTIONS` covers every member of `AggregationFunction` and
 * nothing reaches this branch — pinned as a positive assertion by
 * `sql-driver-out-of-contract-aggregate-function.test.ts` ("the
 * declared-but-uncompiled set is empty"), not left to be rediscovered.
 *
 * Deleting it as dead code was considered and rejected. The branch is not an
 * unenforced DECLARATION — the ADR-0049 shape — it is the classifier that
 * decides which of two truths a future name gets told. Removing it does not
 * remove the condition; it makes {@link refuseAggregateFunction} answer 400 for
 * the FIRST function a later spec bump adds, telling the author of a
 * correctly-spelled `median` that the protocol has no such function. That is
 * precisely the misreport #5907 exists to prevent, and it would land in the
 * window between a spec change and a driver change — the window this repo
 * opens on purpose whenever it takes ADR-0049's enforce leg, as #6188 just did
 * for this very name. The cost of keeping it is one unreachable branch; the
 * cost of dropping it is a wrong answer at exactly the moment the vocabulary
 * grows.
 *
 * `NOT_IMPLEMENTED` / 501 is the answer, from the ADR-0112 STANDARD catalog
 * ("Feature not yet implemented"), whose own `HttpStatusErrorCodeMap` pairs it
 * with 501 — so code and status are each other's mirror by construction rather
 * than by this function's choice. It is the spelling the repo already uses for
 * every "not supported by this protocol/runtime" answer, and the ledger's rule
 * for a generic condition is the standard catalog over a registered synonym.
 * The registered alternatives were measured and rejected: `UNSUPPORTED` is a
 * 400 in both places that emit it (a share link that does not expose messages),
 * `UNSUPPORTED_QUERY_PARAM` is a 400 on the client-mistake list, and
 * `UNSUPPORTED_TRANSFORM` belongs to `@objectstack/rest`'s import mapper.
 *
 * Measured consequence, recorded so it is not rediscovered as a bug: on the
 * `/data` routes `mapDataError`'s generic status passthrough is 4xx-ONLY, so
 * this declared 501 does not survive to the wire — it falls to
 * `UNCLASSIFIED_FAULT`'s `500 INTERNAL_ERROR`. That is a gap in the REST
 * boundary — #5582, which this is the first live producer for — not a reason
 * for the driver to misdescribe the fault as the caller's. The driver's job is
 * to state the condition truthfully at the throw site (ADR-0112), which is also
 * what reaches every in-process caller and the operator log.
 */
function uncompilableAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is declared but not implemented by this backend. ` +
    `Compiled here: ${[...SQL_AGGREGATE_FUNCTIONS.keys()].join(', ')}. The name is spelled ` +
    `correctly and @objectstack/spec AggregationFunction declares it — this is a capability gap ` +
    `in the backend, not a mistake in the query, which is why it answers NOT_IMPLEMENTED/501 ` +
    `rather than a 400. Aggregate with a function this backend compiles; whether the declaration ` +
    `itself should stand is ADR-0049's enforce-or-remove question (#5907).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  return err;
}

/**
 * [#6409] `count_distinct` written with no `field` — nothing to deduplicate.
 *
 * `AggregationNodeSchema` makes `field` optional because `COUNT(*)` is a real
 * spelling, and the schema has no way to say "optional for this function,
 * required for that one". So the aggregation parses, reaches this driver, and
 * asks for `COUNT(DISTINCT *)` — which no dialect this driver targets accepts.
 *
 * Refused HERE rather than emitted and left to the database, for the reason
 * #5907 gives at length one function up: a syntax error raised by SQLite or
 * Postgres arrives with the driver's SQL in it and no `code`/`status`, so
 * `mapDataError` serves an opaque 500 for what is a completely legible mistake
 * in the request. The class is 1, not 2 — `INVALID_QUERY` / 400: the FUNCTION
 * is compiled here, it is this aggregation node that is malformed, and the
 * remedy is a key the caller can add.
 *
 * The twin lives in `driver-turso`'s `remote-transport.ts`, first sentence for
 * first sentence (#5240 — one condition, one wording), and the two are compared
 * as runtime messages by `remote-transport-aggregate-function-refusal.test.ts`.
 */
function refuseDistinctAggregateWithoutField(func: string): never {
  const err = new Error(
    `Aggregate function "${func}" needs a "field" — there is nothing to deduplicate. ` +
    `COUNT(*) counts rows and is the spelling that takes no field; a distinct count has to name ` +
    `the column whose values are deduplicated. Add "field" to the aggregations[] entry (#6409).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  throw err;
}

/**
 * [#5907] Which refusal a name that this face cannot compile deserves.
 *
 * The classification is written ONCE per face and shared by both faces'
 * throw sites, so "is this the caller's mistake or ours?" cannot be answered two
 * ways for one query. `func` is the name the CALLER wrote — not a normalised
 * form — because that is what the enum is judged against and what the message
 * has to quote back.
 */
function refuseAggregateFunction(func: string): never {
  throw DECLARED_AGGREGATE_FUNCTIONS.includes(func)
    ? uncompilableAggregateFunctionError(func)
    : undeclaredAggregateFunctionError(func);
}

/**
 * [#6212] A `groupBy` entry asks for a date BUCKET this face cannot emit.
 *
 * `GroupByNodeSchema` declares `{ field, dateGranularity }` and `DateGranularity`
 * declares all five names, so a granularity this dialect has no expression for is
 * a CAPABILITY GAP in the backend, not a mistake in the query — the same 501
 * class {@link uncompilableAggregateFunctionError} answers for a
 * declared-but-uncompiled aggregate function, and for the same reason (#5907,
 * ADR-0112). It used to be a bare `throw new Error(...)`: `code`/`status` both
 * `undefined`, so `mapDataError` served an opaque 500 for a named condition.
 *
 * WHICH granularities a backend buckets natively is PUBLISHED, per driver, as
 * `supports.queryDateGranularity`, and the engine reads that record and falls
 * back to in-memory bucketing for anything absent from it (objectql `engine.ts`,
 * aggregate dispatch). Reaching this throw therefore means a caller went around
 * that bit, so the message names the bit rather than the SQL.
 *
 * Written once per FACE — `RemoteTransport` carries the twin, first sentence for
 * first sentence — because `TursoDriver` picks its face from `url` and one
 * condition may not have two wire identities (#5240 / #5907). The two faces
 * refuse different populations (this one refuses what its DIALECT cannot bucket,
 * the remote transport refuses every granularity because it buckets none), but
 * both refuse exactly `supports.queryDateGranularity[g] !== true`, which is one
 * condition stated per face.
 */
function refuseDateBucketedGroupBy(granularity: string, bucketedHere: string[], face: string): never {
  const err = new Error(
    `Date bucketing by '${granularity}' is not supported by this backend. ` +
    `Bucketed here: ${bucketedHere.length > 0 ? bucketedHere.join(', ') : 'none'} (${face}). ` +
    `The query is spelled correctly and @objectstack/spec DateGranularity declares it — this is ` +
    `a capability gap in the backend, not a mistake in the query, which is why it answers ` +
    `NOT_IMPLEMENTED/501 rather than a 400. A driver publishes the granularities it buckets ` +
    `natively as \`supports.queryDateGranularity\`; the engine reads that record and buckets ` +
    `in memory for every granularity absent from it, which is always correct (#6212).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

/**
 * [#5158] A `FilterArray` reached the driver unlowered.
 *
 * `where` is a `FilterCondition` — `QueryASTSchema.where: FilterConditionSchema`
 * — and `FilterArray` is INPUT-ONLY authoring sugar the spec declares separately
 * (`spec/data/filter.zod.ts`, #5285). Both doors into the runtime lower it
 * through `parseFilterAST` before any driver is reached: the protocol face
 * (`metadata-protocol`, since #4121) and the engine (`ObjectQL`, ruling C).
 *
 * Until ruling C this driver carried a SECOND filter compiler for the array
 * spelling — one that also accepted an INFIX join form (`[condA, 'or', condB]`)
 * no schema ever declared and `parseFilterAST` cannot express. Two compilers
 * for one query is the ADR-0053 D-A1 divergence, and it had already produced a
 * live product fork: cloud's `RemoteTransport.buildWhereSQL` refuses the exact
 * input this method used to compile (cloud#1075), with zero tests on either
 * side of the split. Deleting the dialect converges them.
 *
 * The message names the lowering, not the SQL builder, because the fix is
 * always at the caller: lower the value (or go through the engine, which does).
 */
function filterArrayReachedDriverError(filters: unknown[]): Error {
  return unsupportedFilterError(
    `A filter ARRAY reached the driver: ${JSON.stringify(filters)}. ` +
    `'where' is a FilterCondition object; the array form ('FilterArray') is input-only ` +
    `authoring sugar and is lowered by @objectstack/spec parseFilterAST() at the engine ` +
    `and protocol doors before any driver sees it (#5158). This driver no longer carries a ` +
    `second compiler for it — call through ObjectQL, or lower the value yourself with ` +
    `parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no lowering at ` +
    `all: write the prefix form ["or", condA, condB].`,
  );
}

/**
 * [#5702] A RETIRED filter operator reached the compiler.
 *
 * Separate from {@link unknownFieldOperatorMessage}'s "this name is not in the
 * vocabulary" on purpose: `$regex` and `$options` were not typos, they were
 * spellings this driver ANSWERED until #4706 retired them, and the author who
 * wrote one needs the replacement rather than a list to search. The
 * prescription is `RETIRED_FILTER_OPERATORS[op].why`, printed verbatim — the
 * spec table exists so that the five refusal sites stop each composing their
 * own sentence about the same retirement.
 *
 * `siblings` are the other keys of the SAME field constraint, and every retired
 * one among them is named too. `{ $regex: '^acme', $options: 'i' }` is ONE
 * mistake with ONE fix (write `$icontains`), so a message naming only the key
 * the loop happened to reach first would send its author back for a second
 * round-trip on the other one.
 *
 * Returns `null` when `op` is not retired, so the caller can fall through to
 * the ordinary unknown-operator refusal with one expression.
 */
function retiredFilterOperatorError(op: string, field: string, siblings: readonly string[] = []): Error | null {
  const guidance = RETIRED_FILTER_OPERATORS[op];
  if (!guidance) return null;
  const replacement = guidance.to ? ` Write "${guidance.to}" instead.` : '';
  const alsoRetired = siblings.filter((key) => key !== op && RETIRED_FILTER_OPERATORS[key]);
  const also = alsoRetired.length
    ? ` The same field constraint also carries the retired ` +
      `${alsoRetired.map((key) => `"${key}"`).join(', ')} — one "${guidance.to}" replaces the whole ` +
      `shape, so this is ONE mistake with ONE fix, not one per key.`
    : '';
  return unsupportedFilterError(
    `Filter operator "${op}" on field "${field}" is RETIRED and is no longer evaluated by this ` +
      `driver.${replacement} ${guidance.why}${also}`,
  );
}

/**
 * [#5702] `$icontains` received a comparand that is not a non-empty string.
 *
 * Two rejections, one constructor, because they are one mistake at the
 * comparand position and the repair is the same sentence:
 *
 * - **non-string** — `StringOperatorSchema` declares `$icontains: z.string()`.
 *   Coercing `42` to `"42"` answers a query nobody wrote (the reading
 *   `applyLike`'s `String(value)` would otherwise give it).
 * - **empty string** — every row contains the empty substring, so the predicate
 *   constrains nothing. A dropped predicate WIDENS a result set, and on an RLS
 *   read scope that is a permission bypass rather than a degraded filter
 *   (#3948) — the same reason #5240 refused `{ field: {} }` one level up.
 */
function icontainsComparandError(field: string, value: unknown, path: string): Error {
  const shown = typeof value === 'string' ? `""` : JSON.stringify(value) ?? String(value);
  return unsupportedFilterError(
    `Operator "$icontains" on field "${field}" at ${path} requires a NON-EMPTY string comparand, ` +
      `received ${shown}. "$icontains" is a case-insensitive LITERAL substring search, so its ` +
      `comparand is the text to look for — an empty one matches every row (a predicate that ` +
      `constrains nothing), and a non-string one would have to be coerced into text this query ` +
      `never asked for.`,
  );
}

/**
 * [#5041] The referenced field name when `value` is a Filter Protocol FIELD
 * REFERENCE (`{ $field: 'other_column' }` — spec `FieldReferenceSchema` in
 * `data/filter.zod.ts`), else `null`.
 *
 * The predicate deliberately mirrors `@objectstack/formula`'s `resolveValue`
 * (`matches-filter.ts`): an object, not an array, carrying a `$field` key. The
 * two execution paths must agree on **what a field reference is**; they differ
 * only in what they DO with one — the in-memory evaluator resolves it against
 * the record, this driver refuses it (below). A driver that recognised a
 * narrower shape than the evaluator would silently bind the remainder as
 * literal values again, which is precisely the defect being closed.
 */
function fieldReferenceOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ref = (value as Record<string, unknown>).$field;
  return typeof ref === 'string' ? ref : null;
}

/**
 * [#5041] `{ $field }` reached a comparison this driver compiles to SQL.
 *
 * `FieldReferenceSchema` is declared in the spec and really is PRODUCED —
 * `compileCelToFilter` emits `{ $field: path }` for a field-to-field comparison
 * in a CEL permission/RLS rule — but the only implementation in the repo is the
 * in-memory evaluator. Pushed down to SQL, the reference object was handed to
 * Knex as a BIND VALUE, so sqlite answered with a bare `TypeError` ("can only
 * bind numbers, strings, bigints, buffers, and null") carrying no `code` and no
 * `status` — outside the ADR-0112 envelope every sibling filter refusal in this
 * driver speaks, and therefore served as an opaque 500-shaped body.
 *
 * Refusing loudly is the whole fix here (maintainer adjudication on #5041):
 * column-to-column compilation is a capability tracked separately, and until it
 * lands the honest answer to "this filter cannot run on this backend" is the
 * catalogued `INVALID_FILTER`, not a crash and not a silent wrong answer.
 */
function crossFieldComparisonError(field: string, op: string, ref: string, index?: number): Error {
  const position = index === undefined ? '' : ` at index ${index} of its value list`;
  return unsupportedFilterError(
    `Operator "${op}" on field "${field}" compares against another field ` +
      `({ "$field": "${ref}" })${position}. Cross-field comparison is currently supported ` +
      `only on the in-memory evaluation path (matchesFilter); it cannot be compiled to SQL, ` +
      `so this filter cannot be pushed down to the database. Compare against a literal value ` +
      `instead, or evaluate the rule in memory.`,
  );
}

/**
 * [#5041] Operators whose comparand is a single bound VALUE, in the Filter
 * Protocol `$`-form read by {@link SqlDriver.applyFilterCondition} — the one
 * spelling this driver still compiles. It also listed the canonicalised infix
 * form, read by an `applyAstComparison` emitter deleted with the array dialect
 * in #5158; the infix spellings stay in the set because
 * {@link assertCompilableComparand} is called with an already-canonicalised
 * operator on the reduction path.
 *
 * The list-shaped operators (`$in` / `$nin` / `$between`) are deliberately
 * ABSENT: an array is their legitimate comparand, and they compile through
 * their own `whereIn` / `whereBetween` arms. Only their MEMBERS are inspected —
 * for `$field` (#5041) and, since #5234, for bindability — never their arity:
 * the existing descriptive `$between` refusal stays the one that answers a
 * malformed range. See {@link LIST_COMPARAND_OPERATORS}.
 */
const SCALAR_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '=', '==', '!=', '<>', '>', '>=', '<', '<=', 'like', 'ilike',
]);

/**
 * Can this value be handed to a driver as a bound parameter at all?
 *
 * Same classification the write path applies in `formatInput` — anything that
 * is not a primitive, a `Date` or a binary buffer is a shape better-sqlite3
 * refuses outright and the other dialects mangle. (`ArrayBuffer.isView` covers
 * `Buffer`, which is a `Uint8Array`.)
 */
function isBindableComparand(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
  return value instanceof Date || ArrayBuffer.isView(value);
}

/**
 * [#5234] Operators whose comparand becomes the TEXT of a `LIKE` pattern, i.e.
 * the ones {@link SqlDriver.applyLike} serves. Kept separate from
 * {@link SCALAR_COMPARAND_OPERATORS} because the two ask different questions of
 * the same value: a scalar operator needs a value a driver can BIND, a pattern
 * operator needs one that has a faithful TEXT rendering. Every value in the
 * first set except a binary buffer is also in the second, but the reason is not
 * the same reason, and the messages a caller needs differ.
 *
 * `like` / `ilike` are absent on purpose: they arrive already carrying a
 * pattern and compile through the scalar bind arm, which already refuses an
 * object.
 */
const TEXT_PATTERN_OPERATORS: ReadonlySet<string> = new Set([
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
]);

/**
 * [#5234] Operators for which an ARRAY is the legitimate comparand, so it is
 * each MEMBER that must be individually compilable.
 *
 * Scoping the member scan to these three is what keeps a scalar operator that
 * received an array answering with its own message ("requires a single
 * comparable value") instead of reporting the first bad member of a list it
 * should never have been given.
 */
const LIST_COMPARAND_OPERATORS: ReadonlySet<string> = new Set(['$in', '$nin', '$between']);

/**
 * [#5234] Does this value have a faithful rendering as the text of a LIKE
 * pattern?
 *
 * An ALLOW-list, deliberately, and the same one `driver-turso`'s
 * `RemoteTransport.serializeComparand` settled on for the identical question in
 * remote mode (cloud#1004 / #1058): a deny-list silently re-admits whatever
 * value form is invented next, which is exactly how that bug survived its first
 * fix. `undefined` is inside the fence only because it is not authorable (JSON
 * has no `undefined`) and the analytics door normalises it to `null` rather than
 * refusing it (#5526) — refusing it HERE would invent a disagreement rather than
 * close one. See {@link unrenderableTextComparandError} for the rest.
 */
function isRenderableTextComparand(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
  return value instanceof Date;
}

/**
 * [#5041] The one gate every comparison comparand passes before it becomes a
 * bind parameter, covering both halves of the gap the issue measured:
 *
 * 1. **`{ $field }`** — declared, produced, and implemented only in memory.
 *    Refused wherever it appears, including inside an `$in` / `$nin` / `$between`
 *    list. The list case matters more than it looks: a `$field` member did not
 *    even crash — the query compiled, ran, and returned ZERO ROWS. A silent
 *    wrong answer is what #3948 / #4209 settled is strictly worse than an error
 *    on a permission-scoped read.
 *
 * 2. **The general arm** — a known operator whose comparand is a shape no
 *    dialect can bind (a plain object, an array where one value belongs). The
 *    issue noted this branch had no rejection arm at all; measured, every such
 *    shape produced the same bare `TypeError`. Scoped to
 *    {@link SCALAR_COMPARAND_OPERATORS} so the legitimate array binds keep
 *    working untouched.
 *
 * 3. **[#5234] The two shapes #5041 deliberately left out** — a non-`$field`
 *    OBJECT member of an `$in`/`$nin` list, and an object comparand on the
 *    `LIKE` family. #5041 read them as a lesser class ("a filter applied
 *    nonsensically, not one that cannot be applied") whose direction was
 *    fail-closed, and stopped. Both halves of that reading were measured wrong
 *    on `main` before this change:
 *
 *    - The direction is not uniformly fail-closed. `{status: {$nin: [{…}]}}`
 *      compiles to `NOT IN ('[object Object]')`, which excludes NOTHING — an
 *      exclusion the caller wrote that silently does not happen. On a
 *      read-scope lowering that is over-reach, the same direction #5347 / #5324
 *      ruled on. `$notContains` does it too: it EXCLUDED the one fixture row
 *      whose text happened to be `[object Object]`.
 *    - The answers were never merely "zero rows". Against a row literally
 *      named `[object Object]`, `{name: {$contains: {}}}` MATCHED it. That is
 *      not a narrowed result set, it is a wrong one.
 *
 *    Two more measurements decided the exact fence:
 *
 *    - An ARRAY comparand on the LIKE family already forked INSIDE
 *      `service-analytics`: `{name: {$contains: ['al','be']}}` binds `%al,be%`
 *      through `read-scope-sql` (and here, via `String(array)`) but `%al%`
 *      through the analytics `where` door, which reads `values[0]`. Refusing
 *      the array closes a live split rather than opening one.
 *    - `driver-turso`'s `RemoteTransport` has refused BOTH of these shapes
 *      since cloud#1004 / #1058, with the reasoning written out: refusing an
 *      uncompilable comparand "in one family while tolerating it in the other
 *      would leave the failure mode alive at a different spelling." So local
 *      SQLite and remote SQLite answered the same query differently. This
 *      change is what converges them, and it copies that fix's ALLOW-list
 *      shape (see {@link isRenderableTextComparand}) rather than inventing a
 *      second policy.
 *
 *    What stays accepted is measured, not assumed: `{$contains: 5}` → `%5%`
 *    and `{$contains: null}` → `%null%` agree across this driver,
 *    `driver-memory` and both analytics faces today, and #5526 pinned the
 *    `null` reading deliberately. Primitives are therefore untouched; only
 *    objects — for which `String()` has no faithful answer — are refused.
 */
function assertCompilableComparand(field: string, op: string, value: unknown): void {
  const ref = fieldReferenceOf(value);
  if (ref !== null) throw crossFieldComparisonError(field, op, ref);

  // [#5234] The pattern family answers first: an array IS an object here, so
  // the member scan below would otherwise report `{$contains: ['a', {}]}` as a
  // bad LIST member — a message about a list the operator never takes.
  if (TEXT_PATTERN_OPERATORS.has(op) && !isRenderableTextComparand(value)) {
    throw unrenderableTextComparandError(field, op, value);
  }

  if (Array.isArray(value)) {
    for (const [index, member] of value.entries()) {
      const memberRef = fieldReferenceOf(member);
      if (memberRef !== null) throw crossFieldComparisonError(field, op, memberRef, index);
      // [#5234] Every member of a list operator's array is a comparand in its
      // own right and gets the same bind test the whole comparand gets. Scoped
      // to the operators for which an array is legitimate, so a scalar operator
      // handed an array keeps answering with its own message below.
      if (LIST_COMPARAND_OPERATORS.has(op) && !isBindableComparand(member)) {
        throw unbindableListMemberError(field, op, member, index);
      }
    }
    // An array IS the comparand for the list operators; only a scalar operator
    // is wrong to receive one, and that falls through to the check below.
  }

  if (!SCALAR_COMPARAND_OPERATORS.has(op) || isBindableComparand(value)) return;

  throw unsupportedFilterError(
    `Operator "${op}" on field "${field}" requires a single comparable value, but received ` +
      `${Array.isArray(value) ? 'an array' : `an object (${safeShapePreview(value)})`}, which cannot be ` +
      `bound as a SQL parameter. Use a string, number, boolean, null, Date or binary value; ` +
      `for a list use $in/$nin, and for a range use $between.`,
  );
}

/**
 * [#5234] A member of an `$in` / `$nin` / `$between` list that cannot become a
 * bind parameter.
 *
 * The list case is the one that hides. A scalar operator handed an object fails
 * to bind and at least says so; a LIST simply loses the member — Knex binds it,
 * the statement is valid, and the offending entry can never equal any stored
 * value. So `{status: {$in: ['a', {…}]}}` answers exactly as if the author had
 * written `{$in: ['a']}`, and `{status: {$nin: [{…}]}}` excludes nothing at all
 * while claiming to exclude something. Neither is reported anywhere.
 *
 * The message names the INDEX because that is the only thing distinguishing the
 * bad entry from its legitimate neighbours — the same reason
 * {@link crossFieldComparisonError} takes one.
 */
function unbindableListMemberError(field: string, op: string, value: unknown, index: number): Error {
  return unsupportedFilterError(
    `Operator "${op}" on field "${field}" has a value at index ${index} of its list that cannot be ` +
      `bound as a SQL parameter: ${safeShapePreview(value)}. Every member of an $in/$nin/$between ` +
      `list is a comparand in its own right — use a string, number, boolean, null, Date or binary ` +
      `value. Refusing rather than binding it: the member can equal no stored value, so the list ` +
      `silently loses that entry (and a $nin loses the exclusion the caller wrote).`,
  );
}

/**
 * [#5234] An object where the `LIKE` family expects the text of a pattern.
 *
 * `applyLike` reaches the comparand through `String(value)`, and `String({})` is
 * the literal `'[object Object]'`. The result is a syntactically perfect,
 * parameterised `LIKE` against a string the author never wrote — and it is not
 * merely always-false: a stored value that happens to READ `[object Object]`
 * matches it, which is how this was measured. `$notContains` inverts that into
 * excluding a real row for a reason nothing records.
 *
 * `filter.zod.ts`'s `StringOperatorSchema` declares every one of these
 * comparands `z.string()`, so this refusal enforces a declaration that already
 * exists rather than adding a rule (Prime Directive #12 — declared = enforced).
 * It stops at OBJECTS on purpose: a number, boolean or `null` renders to text
 * the same way on this driver, on `driver-memory` and on both `service-analytics`
 * faces, and #5526 pinned `{$contains: null}` → `%null%` deliberately. Refusing
 * those would break agreement instead of creating it.
 */
function unrenderableTextComparandError(field: string, op: string, value: unknown): Error {
  return unsupportedFilterError(
    `Operator "${op}" on field "${field}" matches against the TEXT of a pattern, but received ` +
      `${Array.isArray(value) ? 'an array' : 'an object'} (${safeShapePreview(value)}). The spec ` +
      `declares this comparand a string (filter.zod.ts StringOperatorSchema); a string, number, ` +
      `boolean, null or Date is accepted. Refusing rather than stringifying it: String({}) is ` +
      `"[object Object]", so the pattern that ran was one the caller never wrote — valid SQL, ` +
      `and a row storing that literal text would have matched it.`,
  );
}

/** A short, non-throwing rendering of an offending comparand for the message. */
function safeShapePreview(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return typeof value;
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return typeof value;
  }
}

/**
 * Where the wildcard sits relative to the comparand. Named exactly as
 * `service-analytics`'s `LikeShape` names its own, so the twin implementations
 * read alike: `contains` → `%v%`, `starts` → `v%`, `ends` → `%v`.
 */
type TextMatchShape = 'contains' | 'starts' | 'ends';

/**
 * The ASCII case map, written out as data.
 *
 * [#6518] Spelled as two 26-character constants rather than reached through a
 * locale-aware `LOWER()` because "ASCII only" is the CONTRACT (#4706 Q1 = A),
 * and a locale can be configured to fold more. Measured on a live Postgres 16
 * (both a `C.utf8` database and an ICU one): `lower('CAFÉ')` is `café` — the
 * over-fold — while `translate('CAFÉ', <upper>, <lower>)` is `cafÉ`. The
 * mapping being visible in the emitted SQL is the point: a reviewer can see
 * that exactly 26 characters fold, without knowing the server's locale.
 */
const ASCII_UPPER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASCII_LOWER_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The character bound into every `ESCAPE` clause this driver emits. */
const LIKE_ESCAPE_CHARACTER = '\\';

/**
 * Escape the LIKE metacharacters (`%`, `_`) and the escape character itself
 * (`\`) so a comparand matches literally.
 *
 * This is the expression `service-analytics`'s `escapeLikePattern` is held to
 * character for character by its `like-metacharacter-escape.test.ts`. Changing
 * it here without changing it there forks one `$contains` into two.
 */
function escapeLikeComparand(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

/**
 * [#6518] Escape the GLOB metacharacters (`*`, `?`, `[`) so a comparand matches
 * literally, using GLOB's ONLY escape mechanism: a single-character class.
 *
 * GLOB has no `ESCAPE` clause — SQLite's grammar simply does not have one for
 * it — so `[*]`, `[?]` and `[[]` are how a literal metacharacter is spelled.
 * `]` needs no escape and deliberately gets none: every `[` this function sees
 * is turned into a class that closes itself, so no unclosed class can survive
 * for a later `]` to terminate. `%` and `_` are ordinary characters to GLOB and
 * are likewise left alone — the escaped class here is NOT the LIKE one, and
 * writing the two as one shared regex is the mistake to refuse.
 *
 * Measured before it was written (better-sqlite3 3.53.4, the nine-row
 * `FILTER_TEXT_ROWS` fixture plus `a*b` / `a?b` / `a[b`): the unescaped pattern
 * `*a*b*` returned six rows where `*a[*]b*` returns the one. An unescaped `*`
 * is the same filter bypass an unescaped `%` is under LIKE, which is why this
 * function exists at the same level as its LIKE sibling rather than inline.
 */
function escapeGlobComparand(value: unknown): string {
  return String(value).replace(/[*?[]/g, '[$&]');
}

/** Wrap an already-escaped comparand in the wildcards `shape` calls for. */
function wrapTextMatchShape(escaped: string, shape: TextMatchShape, wildcard: string): string {
  if (shape === 'starts') return `${escaped}${wildcard}`;
  if (shape === 'ends') return `${wildcard}${escaped}`;
  return `${wildcard}${escaped}${wildcard}`;
}

/**
 * [#6518] MySQL's ASCII-only case fold: 26 `REPLACE`s over the BINARY rendering
 * of an expression.
 *
 * Ugly, and the alternatives are all wrong rather than merely uglier — that is
 * the whole justification, so it is written down:
 *
 *   - `LOWER(x)` folds the full Unicode range (the defect this closes).
 *   - `LOWER(x)` on a binary string is documented as INEFFECTIVE, so casting
 *     first and folding after simply does not fold.
 *   - `CONVERT(x USING ascii)` maps every non-ASCII character to `?`, which
 *     COLLIDES `café` with `cafÉ` — strictly worse than over-folding.
 *   - No MySQL collation is case-insensitive for ASCII and exact elsewhere.
 *
 * Operating on `CAST(x AS BINARY)` rather than on the text is what makes it
 * provable without a live server: in binary space `REPLACE` matches bytes, so
 * no collation participates, and UTF-8 is self-synchronising — a byte in
 * `0x41..0x5A` can only ever be a real ASCII `A`..`Z`, never part of a
 * multi-byte character. Byte-wise ASCII lowering therefore IS the ruled fold.
 */
function mysqlAsciiLowerBinary(expr: string): string {
  let out = `CAST(${expr} AS BINARY)`;
  for (let i = 0; i < ASCII_UPPER_LETTERS.length; i++) {
    out = `REPLACE(${out}, '${ASCII_UPPER_LETTERS[i]}', '${ASCII_LOWER_LETTERS[i]}')`;
  }
  return out;
}

/**
 * [#6518] The one place a text predicate becomes SQL — `{sql, bindings}` for
 * knex's `whereRaw`, with `??` the column and `?` the pattern.
 *
 * # The defect this closes
 *
 * Before this, every dialect got `col LIKE ? ESCAPE ?` (and `LOWER()` on both
 * sides for `$icontains`), which made case sensitivity the DIALECT's answer
 * where #4706 rules it the CONTRACT's. Both halves over-matched — they returned
 * rows the filter excludes, which on an RLS read scope is over-reach (#3948),
 * not a loose filter:
 *
 * | | `$contains` family (must be case-SENSITIVE, Q2=A) | `$icontains` (folds ASCII ONLY, Q1=A) |
 * |---|---|---|
 * | SQLite | ✗ `LIKE` folds ASCII | ✓ `lower()` is ASCII-only |
 * | Postgres | ✓ `LIKE` is case-exact | ✗ `LOWER()` folds all of Unicode |
 * | MySQL | ✗ follows the collation | ✗ `LOWER()` folds all of Unicode |
 *
 * # What is emitted now, and why each cell
 *
 * - **SQLite → `GLOB`.** `LIKE`'s ASCII fold cannot be turned off per-statement;
 *   `PRAGMA case_sensitive_like` is a CONNECTION-global switch, so one query
 *   would change every other query's meaning. Of the operand-level tricks,
 *   `CAST(col AS BLOB) LIKE ?` was measured to return NOTHING at all (SQLite's
 *   LIKE is false for a BLOB operand), so the operator has to change. `GLOB` is
 *   case-exact by definition and carries its own escape mechanism
 *   ({@link escapeGlobComparand}). `lower()` in front of it is still the
 *   `$icontains` fold, and still ASCII-only: measured, `lower('CAFÉ')` is
 *   `'cafÉ'`, so `lower(name) GLOB '*café*'` answers row 4 and `'*cafÉ*'`
 *   answers row 3 — the Q1 = A boundary, executed rather than argued.
 * - **Postgres → `LIKE`, unchanged**, because `LIKE` there is already exact.
 *   Only the fold moves, from `LOWER()` to {@link ASCII_UPPER_LETTERS}-driven
 *   `translate()`. Measured live (PG 16, ICU database): `LOWER(name) LIKE
 *   LOWER('%café%')` returned rows 3 AND 4; the `translate()` form returns row
 *   4, and its `'%CAFÉ%'` mirror returns row 3.
 * - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, which is byte-wise and
 *   therefore case-exact whatever the column's collation says. The fold adds
 *   {@link mysqlAsciiLowerBinary} on top. NOT executed here: no MySQL server was
 *   provisionable in the container that wrote this, so the mysql cell is a
 *   declared skip in the live matrix rather than a claimed pass, and the
 *   reasoning is written out on that helper instead.
 * - **`'unknown'` → the pre-#6518 `LIKE`/`LOWER()` shape.** `dialectName` is
 *   `'unknown'` for a knex client this driver does not model (mssql, oracle),
 *   where `GLOB` is a syntax error and `CAST(… AS BINARY)` means something
 *   else. Emitting the old shape is not an endorsement of it — it is the only
 *   answer that still RUNS, and it is the residue the conformance ledger names.
 *
 * # Why one function and not four emitters
 *
 * The escaping is the P0 (#5567: an unescaped `%` matches every row), the fold
 * is the contract, and the two interact — the SQLite arm needs a DIFFERENT
 * escaped character class from the other three, which is exactly the kind of
 * divergence a second emitter drops on the floor. Every arm below therefore
 * builds its pattern from one of two named escape functions and one shared
 * {@link wrapTextMatchShape}, so "which characters are literal" is answered per
 * dialect in one readable place and can never be answered by accident.
 */
function textMatchPredicate(
  dialect: SqlDialectName,
  field: string,
  value: unknown,
  shape: TextMatchShape,
  negate: boolean,
  fold: boolean,
): { sql: string; bindings: unknown[] } {
  if (dialect === 'sqlite') {
    // GLOB takes no ESCAPE clause, so this arm binds two values, not three.
    const pattern = wrapTextMatchShape(escapeGlobComparand(value), shape, '*');
    const column = fold ? 'lower(??)' : '??';
    const comparand = fold ? 'lower(?)' : '?';
    return {
      sql: `${column} ${negate ? 'NOT GLOB' : 'GLOB'} ${comparand}`,
      bindings: [field, pattern],
    };
  }

  const pattern = wrapTextMatchShape(escapeLikeComparand(value), shape, '%');
  const keyword = negate ? 'NOT LIKE' : 'LIKE';
  // The `ESCAPE` character is BOUND, never written as a literal: MySQL applies C
  // escape syntax inside string literals, so `'\'` and `'\\'` are the same
  // backslash spelled two ways per dialect, while a bound value has one
  // spelling everywhere (#5567).
  const bindings = [field, pattern, LIKE_ESCAPE_CHARACTER];

  if (dialect === 'postgres') {
    const asciiLower = (expr: string) =>
      fold ? `translate(${expr}, '${ASCII_UPPER_LETTERS}', '${ASCII_LOWER_LETTERS}')` : expr;
    return { sql: `${asciiLower('??')} ${keyword} ${asciiLower('?')} ESCAPE ?`, bindings };
  }

  if (dialect === 'mysql') {
    const caseExact = (expr: string) =>
      fold ? mysqlAsciiLowerBinary(expr) : `CAST(${expr} AS BINARY)`;
    return { sql: `${caseExact('??')} ${keyword} ${caseExact('?')} ESCAPE ?`, bindings };
  }

  const column = fold ? 'LOWER(??)' : '??';
  const comparand = fold ? 'LOWER(?)' : '?';
  return { sql: `${column} ${keyword} ${comparand} ESCAPE ?`, bindings };
}

/**
 * [#5134] What a filter node is worth as a boolean, before any SQL is emitted.
 *
 * - `'true'`  — matches every row; the compiler emits NO clause for it.
 * - `'false'` — matches no row; the compiler emits the dialect FALSE constant.
 * - `'clause'` — carries at least one real predicate; compile it normally.
 *
 * [#5659] The vocabulary is `@objectstack/spec`'s now, because the REDUCTION
 * that produces it is — see {@link reduceFilterNode}. Kept as a local alias so
 * every use site below still reads `FilterVerdict`.
 */
type FilterVerdict = SharedFilterVerdict;

/**
 * [#5134] Is `value` a Filter Protocol NODE — the shape `FilterConditionSchema`
 * declares for every element of `$and`/`$or` and for the operand of `$not`?
 *
 * The prototype check is the load-bearing half, not pedantry. The identity
 * reduction below turns "this node has no predicates" into "matches every row",
 * so any object whose OWN ENUMERABLE KEYS are empty is read as TRUE. A `Date`,
 * a `RegExp`, a `Map` or a class instance all satisfy `typeof x === 'object' &&
 * !Array.isArray(x)` while enumerating to nothing — accepting them would
 * PROMOTE garbage from "silently ignored" (the old bug) to "matches all rows"
 * (strictly worse). A filter condition always arrives as JSON or as the output
 * of `compileCelToFilter`, i.e. a plain object, so requiring one costs nothing
 * real and makes the reduction total.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A short type name for an operand the filter compiler refuses. */
function describeFilterOperand(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind !== 'object') return kind;
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name && ctor.name !== 'Object' ? ctor.name : 'object';
}

/**
 * [#5134] The gate that gives "this group compiled to empty" exactly ONE cause.
 *
 * Identity reduction is only sound once an empty compile can mean "the author
 * wrote an empty group" and nothing else. Before this gate, `$or: [null]`,
 * `$or: ['x']`, `$or: [[…]]` and `$or: [new Date()]` also produced no clause and
 * vanished without a trace; reducing on top of that would have turned each of
 * them into "matches every row". Refusing them here — loudly, in the ADR-0112
 * envelope every sibling filter refusal in this driver speaks — is what makes
 * the reduction safe. Same discipline as cloud#1073 on Turso's
 * `RemoteTransport.buildWhereSQL`.
 */
function assertFilterNode(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (isFilterNode(value)) return;
  throw unsupportedFilterError(
    `Filter node at ${path} is a ${describeFilterOperand(value)} (${safeShapePreview(value)}), not a filter ` +
      `condition object. Every element of "$and"/"$or" and the operand of "$not" must be a plain object of ` +
      `field constraints (e.g. { "status": "active" }) or nested combinators — @objectstack/spec ` +
      `FilterConditionSchema declares this position as a FilterCondition. It is refused rather than skipped ` +
      `because skipping it would silently change which rows match.`,
  );
}

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators.
 *
 * One declared shape, three answers across this repo: THIS driver refused it at
 * the top level (the #5041 comparand gate) while DROPPING it inside
 * `$and`/`$or`/`$not` — where a predicate that emits nothing means "matches
 * every row" — and `driver-memory` / `@objectstack/formula` both answered
 * "matches nothing". So `{ $or: [ { a: {} }, { b: 2 } ] }` returned a different
 * row set per backend, and this driver contradicted ITSELF depending on whether
 * the same constraint sat at the top level or one combinator deep.
 *
 * Ruled on #5240: refuse it everywhere, in the ADR-0112 envelope every sibling
 * filter refusal here speaks. Not TRUE and not FALSE — because the shape is
 * almost always an authoring accident (a filter builder that recorded a field
 * and no operator, or generated metadata that lost its operator), and both
 * silent readings answer it with a row count the author never asked for. The
 * same reasoning #5041 applied one position over: a filter that cannot be given
 * one meaning is refused at the producer, loudly, at authoring time.
 */
function emptyFieldConstraintError(field: string, path: string): Error {
  return unsupportedFilterError(
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field constraint ` +
      `must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a direct ` +
      `comparand (e.g. { "${field}": "value" }). It is refused rather than ignored because the ` +
      `backends disagreed on what it means — this driver dropped it inside $and/$or/$not (matching ` +
      `EVERY row) while refusing it at the top level, and driver-memory / @objectstack/formula ` +
      `answered "matches nothing". #5240.`,
  );
}

/** [#5240] Is this field spec the zero-operator constraint refused above? */
function isEmptyFieldConstraint(spec: unknown): boolean {
  return isFilterNode(spec) && Object.keys(spec).length === 0;
}

/**
 * [#5348] A `$`-prefixed key in a NODE position that is not a declared
 * combinator.
 *
 * `FilterConditionSchema` declares exactly three (`LOGICAL_OPERATORS`: `$and`,
 * `$or`, `$not`); every other key of a node is a FIELD NAME. This driver's
 * emitter is written on that assumption and nothing checked it, so `$where`,
 * `$nor`, `$expr` and friends fell through to the field arms and were compiled
 * as COLUMNS — `remoteColumn(table, '$where', …)`. On SQLite a double-quoted
 * name that resolves to no column degrades to a string literal, so the query
 * compiled, ran, and returned ZERO ROWS:
 *
 * ```
 * WHERE {"$where":"return true"}   → SELECT … WHERE "$where" = 'return true'  → []
 * WHERE {"$nor":[{"stage":"won"}]} → (its array value missed the object arm)  → []
 * ```
 *
 * Measured on better-sqlite3 in #5348. Other dialects reject the unknown
 * identifier instead — a different symptom, the same cause, and neither is an
 * answer to the filter that was asked.
 *
 * The refusal is this driver's FIELD-LEVEL posture (#3948 / #4436) finally
 * reaching the node position: `{ stage: { $sounds_like: 'x' } }` has answered
 * `INVALID_FILTER` / 400 for two releases while `{ $sounds_like: 'x' }` one
 * level up answered "no rows". One driver, two positions, two answers — the
 * same internal contradiction #5240 closed for `{ field: {} }`.
 *
 * The wording is `driver-memory`'s `unknownLogicalOperatorError`, verbatim
 * through the vocabulary sentence, because #3948 made the backends AGREE that
 * an uncompilable filter is a refusal and #5240 made one condition speak one
 * wording. Only the closing clause differs: it names what THIS driver used to
 * do with the key.
 */
function unknownLogicalOperatorError(key: string, path: string): Error {
  return unsupportedFilterError(
    `Unsupported filter combinator "${key}" at ${path}. A filter node's $-prefixed keys are the ` +
      `declared logical operators $and, $or and $not (@objectstack/spec LOGICAL_OPERATORS); every ` +
      `other key is a field name. It is refused rather than compiled as a COLUMN of that name, ` +
      `which is what this driver used to do — producing a predicate that matched no row and ` +
      `reported nothing, so a caller could not tell "no rows matched" from "the filter never ` +
      `compiled" (#5348).`,
  );
}

/**
 * [#5347] `$null` whose comparand is not a boolean.
 *
 * `FieldOperatorsSchema` declares `$null: z.boolean()`, and nothing between an
 * authored `where` and this driver validates against it — so a non-boolean
 * really does arrive here. Every backend then read it, and they did NOT agree;
 * measured in #5347 against one row with `stage: 'won'` and one with
 * `stage: null`, on `{ stage: { $null: 'yes' } }`:
 *
 * | backend | compiled to | rows |
 * |---|---|---|
 * | driver-sql / driver-sqlite-wasm / Turso local | `IS NULL` (anything but `false`) | the NULL row |
 * | driver-memory live path (mingo), driver-mongodb | `IS NOT NULL` (anything but `true`) | the valued row |
 * | driver-memory reference matcher | nothing at all — the constraint vanished | BOTH rows |
 *
 * Three readings of one declared operator, and two of them are each other's
 * exact complement. The cause is a pair of default branches hung on opposite
 * sides: this driver's emitter asked `opValue === false`, the JS drivers asked
 * `val === true`. Neither is a rule anyone wrote down; both are what a
 * two-branch conditional does with a third value.
 *
 * Ruled on #5347: REFUSED, in every position, on every backend — the same
 * disposition #5240 gave `{ field: {} }` and for the same reason. `$null: 0`
 * read as IS NULL (this driver's rule) is almost certainly not what the author
 * meant, `$null: 0` read as IS NOT NULL (the JS rule) is no better, and the
 * string `"false"` — which an AI-authored or JSON-round-tripped scope produces
 * readily — is truthy, so it lands on the opposite side from the `false` it was
 * written to mean. There is no reading of a non-boolean here that is not a
 * guess about the author's intent, so the driver stops guessing.
 *
 * `$exists` carries the identical `=== false` identity read one arm below and
 * is deliberately NOT touched here: it diverges too, but on its own axis (what
 * "exists" means for a null-valued key is #5299's open question), and #5347
 * ruled on `$null`. Filed separately rather than settled as a rider.
 */
/**
 * [#5369, applying #5347's ruling A] `$exists` whose comparand is not a boolean.
 *
 * The symmetric twin of {@link nonBooleanNullComparandError}, and deliberately
 * a copy of its disposition rather than a fresh judgement: `FieldOperatorsSchema`
 * declares `$exists: z.boolean()` exactly as it declares `$null`, nothing between
 * an authored `where` and this driver validates against it, and the backends
 * split the same way on a third value — this emitter's `opValue === false`
 * identity reads anything but `false` as IS NOT NULL, while the `=== true`
 * spelling used elsewhere reads anything but `true` as IS NULL. Two complements,
 * neither a rule anyone wrote down.
 *
 * #5347 ruled that shape REFUSED for `$null`; #5369 asked whether the same
 * applies here and the 2026-08-06 ruling on #5298 said yes, "照 #5347-A". So the
 * gate lands beside `$null`'s in {@link reduceFilterKey}, not in the emitter —
 * same evaluation-order reason, same `INVALID_FILTER` envelope.
 *
 * Note what does NOT change with it: the emitter's `opValue === false` arm and
 * {@link nullValueSatisfiesOperator}'s `value === false` arm stay exactly as
 * they are. Once the gate holds, `true` and `false` are the only comparands that
 * reach either, so both tests are already exhaustive two-way choices — the
 * lenient-vs-strict question #5347 had to answer for `$null` does not arise
 * here, because both spellings agree on the two surviving values.
 */
function nonBooleanExistsComparandError(field: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Operator "$exists" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $exists as a boolean. It is refused rather ` +
      `than coerced for the same reason $null is (#5347): a non-boolean lands on whichever side ` +
      `the backend's two-branch conditional happens to default to, and those defaults point in ` +
      `OPPOSITE directions — this driver's \`=== false\` test compiles IS NOT NULL for anything ` +
      `but false, a \`=== true\` test compiles IS NULL for anything but true. Note "false" the ` +
      `STRING is truthy, so it lands on the side opposite the false it was written to mean (#5369).`,
  );
}

function nonBooleanNullComparandError(field: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Operator "$null" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather ` +
      `than coerced because the backends read a non-boolean in OPPOSITE directions — this driver ` +
      `compiled IS NULL (anything but false), driver-memory's query path and driver-mongodb ` +
      `compiled IS NOT NULL (anything but true), and driver-memory's matcher dropped the ` +
      `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite ` +
      `the false it was written to mean (#5347).`,
  );
}

/**
 * [#6050] `undefined` in a COMPARAND position.
 *
 * Ruled REFUSED on 2026-08-07 (ruling B on #6050), the same disposition #5347-A
 * gave a non-boolean `$null`, and for a sharper version of the same reason:
 * there is no reading of `undefined` here that is not a guess, and the two
 * candidate readings are each other's opposite.
 *
 * `undefined` cannot survive a JSON round trip, so it only ever arrives from
 * IN-PROCESS code — which is exactly what makes it dangerous rather than
 * academic. `{ owner_id: ctx.user?.id }` with a missing id is the shape that
 * produced this issue: measured on `origin/main` (`cba7454df`, four rows, `d`
 * valued on 1-2 and NULL on 3-4), the SAME `TursoDriver` answered it two ways,
 * chosen by the `url` it was constructed with:
 *
 * | filter | LOCAL (this compiler) | REMOTE (`RemoteTransport`) |
 * |---|---|---|
 * | `{ d: undefined }`             | bare knex `Undefined binding(s)` | `['3','4']` |
 * | `{ d: { $eq: undefined } }`    | bare knex `Undefined binding(s)` | `['3','4']` |
 * | `{ $not: { d: undefined } }`   | bare knex `Undefined binding(s)` | `['1','2']` |
 * | `{ d: { $ne: undefined } }`    | `['1','2']`                      | `['1','2']` |
 * | `{ $not: { d: { $ne: undefined } } }` | `[]`                      | `['3','4']` |
 * | `{ d: { $in: [undefined] } }`  | bare knex `Undefined binding(s)` | `[]` |
 * | `{ d: { $gt: undefined } }`    | bare knex `Undefined binding(s)` | `[]` |
 *
 * Two defects in one gate:
 *
 * 1. The thrown rows carried NO ADR-0112 envelope — knex's `Undefined
 *    binding(s) detected when compiling SELECT` has neither `code` nor
 *    `status`, so `mapDataError` served an opaque 500 for what is a caller
 *    mistake in a filter (#1116 / #4436 catalogued this exact shape for other
 *    inputs; this one was missing from the list).
 * 2. The `$not: { $ne: undefined }` row is this driver contradicting ITSELF:
 *    the `$ne` emitter reads `coerced == null` (LOOSE — so `undefined` compiled
 *    `IS NOT NULL`, a TOTAL predicate), while {@link operatorIsNullTotal} and
 *    {@link nullValueSatisfiesOperator} read `value === null` (STRICT — so they
 *    judged the same leaf non-total AND satisfied by a NULL row). The guard
 *    then wrapped a total predicate in `d IS NULL OR d IS NOT NULL`, a
 *    tautology, whose negation is FALSE — the `[]` above. That is the #5298
 *    invariant broken at its own definition: a polarity table pins the spelling
 *    of ITS OWN emitter.
 *
 * Refusing the comparand kills both at once and does it BEFORE either can act:
 * knex never sees an undefined binding, and guard-vs-emitter disagreement about
 * `undefined` becomes unreachable rather than merely repaired.
 *
 * ⛔ What deliberately does NOT move: `null`. `{ f: null }`, `{ $eq: null }`,
 * `{ $ne: null }` and `$null` keep their exact behaviour — `null` IS a declared
 * comparand and IS the null predicate. The refusal is about the JS value that
 * the language cannot distinguish from an ABSENT key: `{ f: undefined }` and
 * `{}` are the same object to every reader, and they mean opposite things (a
 * predicate vs no constraint at all).
 */
function undefinedComparandError(field: string, path: string): Error {
  return unsupportedFilterError(
    `Comparand at ${path} is undefined. @objectstack/spec FieldOperatorsSchema declares no ` +
      `undefined comparand, and in JavaScript { "${field}": undefined } cannot be told apart from ` +
      `omitting the key — yet the two mean OPPOSITE things (a predicate versus no constraint at ` +
      `all), so there is no reading of it that is not a guess. Write null if you meant the null ` +
      `predicate ({ "${field}": null } or { "${field}": { "$null": true } }), or omit the key when ` +
      `the value is genuinely absent (e.g. \`if (id !== undefined) where.${field} = id\`). It is ` +
      `refused rather than compiled because the backends disagreed: driver-sql handed it to knex ` +
      `and got a bare "Undefined binding(s)" Error carrying no code, while Turso's remote transport ` +
      `compiled it to IS NULL — so \`{ owner_id: ctx.user?.id }\` with a missing id silently ` +
      `matched every env-wide row instead of failing (#6050).`,
  );
}

/**
 * [#6050] Refuse every `undefined` sitting in a comparand position of ONE field
 * constraint.
 *
 * The positions are enumerated rather than swept, because "comparand" is a
 * position and not a type:
 *
 * - the DIRECT comparand — `{ d: undefined }`, the implicit `=`;
 * - an OPERATOR's comparand — `{ d: { $eq: undefined } }`, `$ne`, `$gt`, the
 *   LIKE family, and every other single-value operator;
 * - a MEMBER of a list operator's array — `{ d: { $in: [undefined] } }`,
 *   `$nin`, `$between`. The array itself IS `$in`'s legitimate comparand; each
 *   element is a comparand in its own right, which is the same split
 *   {@link assertCompilableComparand} makes for `$field`.
 *
 * Two positions are deliberately NOT swept:
 *
 * - `$null` / `$exists`. Their comparand is a declared BOOLEAN — a flag, not a
 *   value to compare against — and `undefined` there is already refused by
 *   {@link nonBooleanNullComparandError} / {@link nonBooleanExistsComparandError}
 *   with a message that names the declared domain. Re-answering it here would
 *   swap a better message for a worse one and give one condition two wordings,
 *   which is what #5240 ruled against.
 * - a bare ARRAY in DIRECT comparand position (`{ d: [1, undefined] }`). An
 *   array is not a comparand outside a list operator, and
 *   {@link assertCompilableComparand} already refuses it as a whole for that
 *   reason; inspecting its members here would relabel a shape that is refused
 *   either way.
 */
function assertDefinedComparands(field: string, spec: unknown, path: string): void {
  if (spec === undefined) throw undefinedComparandError(field, path);
  if (!isFilterNode(spec)) return;
  for (const [op, opValue] of Object.entries(spec)) {
    if (op === '$null' || op === '$exists') continue;
    const opPath = `${path}.${op}`;
    if (opValue === undefined) throw undefinedComparandError(field, opPath);
    if (!Array.isArray(opValue)) continue;
    opValue.forEach((member, index) => {
      if (member === undefined) throw undefinedComparandError(field, `${opPath}[${index}]`);
    });
  }
}

/** [#5134] `$and`/`$or` take a list; anything else is refused, never coerced. */
function assertFilterNodeList(value: unknown, key: string, path: string): asserts value is unknown[] {
  if (Array.isArray(value)) return;
  throw unsupportedFilterError(
    `Filter combinator "${key}" at ${path} requires an array of filter conditions, but received a ` +
      `${describeFilterOperand(value)} (${safeShapePreview(value)}). @objectstack/spec FilterConditionSchema ` +
      `declares "${key}" as FilterCondition[].`,
  );
}

/**
 * [#5134] Reduce one filter node to its boolean verdict, validating shapes on
 * the way down.
 *
 * A node is the AND of its entries, so FALSE dominates, and a node with no
 * entries at all is TRUE (the empty conjunction) — which is why `{}` is a TRUE
 * disjunct inside `$or` and why `{ $not: {} }` is FALSE.
 *
 * This walks the WHOLE tree without short-circuiting: a `$or: []` sibling must
 * not stop the walk from reaching — and refusing — a malformed node further
 * along, or the shape gate would be conditional on evaluation order.
 *
 * Deciding structurally, rather than by compiling and then asking Knex whether
 * anything came out, is deliberate. The old defect WAS an observation of
 * emptiness ("the group callback added nothing"), and an observation cannot tell
 * "empty because the author wrote nothing" from "empty because something failed
 * to compile". A structural verdict has no such blind spot, and it lets the
 * emitter guarantee that every group it opens receives at least one clause.
 *
 * ## [#5659] The algebra is `@objectstack/spec`'s; the REFUSALS are this driver's
 *
 * Everything above describes a ruling (#5322/#5134) that four consumers had to
 * agree on and implemented four times — here, in `driver-mongodb`, in
 * `driver-memory`'s matcher, and nearly a fifth time inside `@objectstack/lint`,
 * which declined to hand-write it and filed #5659 instead. The reduction now
 * lives once, in {@link reduceFilterVerdict}, proven against the same
 * `FILTER_LOGIC_CASES` table this driver's conformance suite runs.
 *
 * What stays here is what is genuinely this driver's: WHICH shapes it refuses
 * and with which message. They are handed to the shared walk as
 * {@link SQL_FILTER_VERDICT_HOOKS} and are invoked from exactly the positions
 * they were invoked from before, so no wording, code or status moved — the
 * conformance case-set is green on both sides of the change.
 */
function reduceFilterNode(node: Record<string, unknown>, path: string): FilterVerdict {
  return reduceFilterVerdict(node, { ...SQL_FILTER_VERDICT_HOOKS, path });
}

/** [#5134] The verdict of ONE key of a filter node. */
function reduceFilterKey(key: string, value: unknown, path: string): FilterVerdict {
  return reduceFilterKeyVerdict(key, value, { ...SQL_FILTER_VERDICT_HOOKS, path });
}

/**
 * [#5659] This driver's half of the reduction: the shape refusals, at the
 * positions the shared walk visits them.
 *
 * `assertFilterNodeList` / `assertFilterNode` are wrapped in arrows rather than
 * passed by reference because they are TypeScript assertion functions, whose
 * narrowing is meaningless — and whose declaration requirements are a nuisance
 * — through a property reference. Nothing else about the call changes.
 */
const SQL_FILTER_VERDICT_HOOKS: FilterVerdictHooks = {
  assertNodeList: (value, key, path) => assertFilterNodeList(value, key, path),
  assertNode: (value, path) => assertFilterNode(value, path),
  classifyKey: (key, value, here) => classifyFilterKey(key, value, here),
};

/**
 * [#5134] The verdict of ONE **non-combinator** key — and this driver's gate on
 * everything a field constraint may not be.
 *
 * `here` is the already-joined path of the key, exactly as the reduction hands
 * it over; the three combinator arms this used to open with are the shared
 * walk's now, and the refusals below are unchanged from when they sat under
 * them.
 */
function classifyFilterKey(key: string, value: unknown, here: string): FilterVerdict {
  // [#5348] Everything still `$`-prefixed at this point is an UNDECLARED
  // combinator — the shared walk resolved the three declared ones before this
  // key ever reached the hook (#5659). Refused here and
  // not in the emitter for exactly the reason the two lines below are here, and
  // the reason #5327 gave for `{ field: {} }`: this walk is exhaustive and does
  // not short-circuit, while the emitter is skipped wholesale by a boolean
  // identity. `{ $or: [ {}, { $where: '…' } ] }` reduces to TRUE on its first
  // disjunct, so an emitter-side gate would refuse the `$where` or ignore it
  // depending on its SIBLINGS — "a gate conditional on evaluation order", which
  // this function's own doc comment warns against.
  //
  // It must also come BEFORE the field arms below, because that is precisely
  // what those arms did wrong: they accepted `$where` as a field name.
  if (key.startsWith('$')) throw unknownLogicalOperatorError(key, here);

  // [#5240] `{ field: {} }` is refused HERE — on the validating walk, beside
  // `assertFilterNode` / `assertFilterNodeList` — rather than in the emitter
  // below, for the same reason those two sit here: the walk is exhaustive and
  // does NOT short-circuit, so the refusal cannot be skipped by an identity that
  // resolves the enclosing node first. Gating it in the compile branch instead
  // would let `{ $or: [ { a: {} }, {} ] }` slip through untouched — the `{}`
  // disjunct reduces the whole `$or` to TRUE, the emitter returns before it ever
  // reaches `{ a: {} }`, and the shape would be refused or ignored depending on
  // its SIBLINGS. That is the "gate conditional on evaluation order" this
  // function's own doc comment warns against.
  //
  // Note what is deliberately NOT changed: the VERDICT. A field key still
  // contributes `'clause'`, exactly as #5134 classified it. This adds a refusal,
  // it does not reclassify a surviving shape, so every filter that compiled
  // before compiles byte-identically now.
  if (isEmptyFieldConstraint(value)) throw emptyFieldConstraintError(key, here);

  // [#6050] `undefined` in a comparand position, refused on THIS walk for the
  // two reasons the walk exists — it is exhaustive and it runs FIRST.
  //
  // "First" is the whole design here, not a preference. Both defects #6050
  // measured live downstream of this line: the emitter hands an undefined bind
  // to knex (a bare `Undefined binding(s)` Error, outside ADR-0112), and the
  // `$not` branch's {@link nullSafeNegationOperand} rewrite consults
  // {@link operatorIsNullTotal} / {@link nullValueSatisfiesOperator}, whose
  // `=== null` spelling disagrees with the `$ne` emitter's `== null` about
  // exactly this value. `applyFilterCondition` runs the whole reduction before
  // it reaches either, so a refusal raised here makes BOTH unreachable rather
  // than repaired — and the polarity tables never have to answer a question
  // nobody ruled on. See {@link undefinedComparandError} for the measured
  // local/remote matrix and why `null` is untouched.
  assertDefinedComparands(key, value, here);

  // [#5347] `$null`'s comparand is a boolean by declaration. Checked on this
  // walk rather than in the emitter's `$null` arm for the same
  // evaluation-order reason, and checked on the RAW value so the message names
  // the shape the caller sent rather than whatever `coerceFilterValue` made of
  // it. Only `$null` is inspected: the surrounding operator vocabulary is the
  // emitter's `default: throw` to enforce, and widening this walk into a second
  // vocabulary gate is how two lists drift apart (#3948).
  // `hasOwnProperty` rather than `'$null' in value` so an inherited key can
  // never trip the gate, and rather than `Object.hasOwn` because this package
  // targets es2020. `{ $null: undefined }` still counts: the key is own and
  // enumerable, and `undefined` is exactly one of the comparands the issue
  // measured a divergence on.
  if (
    isFilterNode(value) &&
    Object.prototype.hasOwnProperty.call(value, '$null') &&
    typeof value.$null !== 'boolean'
  ) {
    throw nonBooleanNullComparandError(key, value.$null, `${here}.$null`);
  }

  // [#5369] `$exists`'s comparand is a boolean by the same declaration, refused
  // on the same walk, for the same evaluation-order reason. Kept as a separate
  // `if` rather than folded into a loop over a two-name list: each operator gets
  // its own message naming its own emitter's default direction, and a shared
  // loop would be the start of the second vocabulary gate the block above warns
  // about (#3948).
  if (
    isFilterNode(value) &&
    Object.prototype.hasOwnProperty.call(value, '$exists') &&
    typeof value.$exists !== 'boolean'
  ) {
    throw nonBooleanExistsComparandError(key, value.$exists, `${here}.$exists`);
  }

  // [#5702] `$icontains`'s comparand is a NON-EMPTY string by declaration,
  // refused on this walk for the same evaluation-order reason as the two gates
  // above: an empty comparand makes the predicate match every row, and a gate
  // the emitter carries alone is skipped wholesale whenever a boolean identity
  // settles the enclosing node — so `{ $or: [ {}, { name: { $icontains: '' } } ] }`
  // would be refused or silently widened depending on its SIBLINGS.
  if (
    isFilterNode(value) &&
    Object.prototype.hasOwnProperty.call(value, '$icontains') &&
    (typeof value.$icontains !== 'string' || value.$icontains === '')
  ) {
    throw icontainsComparandError(key, value.$icontains, `${here}.$icontains`);
  }

  // A field key always contributes a predicate.
  return 'clause';
}

// ── [#5146] NULL-safe `$not` ─────────────────────────────────────────────────

/**
 * [#5146] What a single field constraint needs so its compiled SQL is TOTAL —
 * TRUE or FALSE for every row, never UNKNOWN.
 *
 * - `'none'`         — the predicate is already total (`IS NULL` / `IS NOT NULL`).
 * - `'requireValue'` — a NULL column does NOT satisfy it: `col IS NOT NULL AND (…)`.
 * - `'allowNull'`    — a NULL column DOES satisfy it: `col IS NULL OR (…)`.
 */
type NullGuard = 'none' | 'requireValue' | 'allowNull';

/**
 * [#5146] Does a NULL column satisfy this one operator, under the semantics the
 * JS backends (`driver-memory` `match`, `formula` `matchesFilterCondition`)
 * give it?
 *
 * They evaluate a missing/null field in ordinary two-valued JS: `undefined !==
 * 'won'` is simply `true`. This table is that answer, per operator — measured
 * against both, not assumed. The default is the large positive-comparison
 * family (`$gt`/`$in`/`$contains`/…), every member of which answers `false` for
 * a value that is not there.
 */
function nullValueSatisfiesOperator(op: string, value: unknown): boolean {
  switch (op) {
    // `$eq: null` IS the null predicate; any other comparand is a value test.
    //
    // [#6050] These two arms are STRICT (`=== null`) while the `$ne` emitter
    // used to be LOOSE (`== null`) — the #5298 invariant broken at its own
    // definition, since a polarity table pins the spelling of its own emitter.
    // The repair is the gate, not a third spelling: `reduceFilterKey` refuses
    // an `undefined` comparand before this table is consulted, so `null` and
    // real values are the only comparands left and the emitter now reads
    // `=== null` too. Both spellings are exhaustive over the surviving domain,
    // and they are the SAME spelling — which is what the invariant asks for.
    case '$eq': return value === null;
    case '$ne': return value !== null;
    // [#5347] `$null` is now TOTAL over its declared domain: `reduceFilterKey`
    // refuses a non-boolean comparand before this table is ever consulted, so
    // the only values that reach here are `true` and `false`. The arm was
    // `value !== false` — a lenient read written to mirror the emitter's own
    // `opValue === false` identity test, because at the time BOTH had to agree
    // about a third value that could arrive. Neither does any more, so the arm
    // says what it means: a NULL column satisfies `$null` exactly when the
    // caller asked for null.
    //
    // Tightened rather than left alone deliberately. `value !== false` and
    // `value === true` are equivalent only while the refusal upstream holds; the
    // lenient spelling would keep compiling if that gate were ever moved or
    // removed, and would silently resume answering for shapes nobody ruled on.
    // The strict spelling cannot — it is the same "declared = enforced" reflex
    // the refusal itself is.
    case '$null': return value === true;
    // [#5369] The gate this arm's old comment said was missing now EXISTS:
    // `reduceFilterKey` refuses a non-boolean `$exists` comparand beside the
    // `$null` one, so `true` and `false` are the only values that reach here.
    //
    // The line itself is deliberately unchanged, and #5369's suggestion to
    // "tighten it to `value === true`" is not applied — it points the wrong way.
    // This table answers "does a NULL column SATISFY the operator", and a NULL
    // column satisfies `$exists` exactly when the caller asked for `false`
    // ("no value"). `$null: true` and `$exists: false` are the same question, so
    // their arms are correctly each other's mirror, not each other's copy. With
    // the gate holding, `value === false` is already an exhaustive two-way
    // choice over the declared domain — the lenient-vs-strict distinction that
    // made #5347 rewrite the `$null` arm does not exist here, because both
    // spellings agree on both surviving values.
    case '$exists': return value === false;
    // Negative-polarity set/substring tests: "not among" / "does not contain"
    // hold vacuously for a value that is absent.
    case '$nin': return true;
    // `$notContains` is the one operator where the two JS backends disagree on a
    // null-valued field (`driver-memory` answers false because `typeof null !==
    // 'string'`; `formula` answers true). `formula` is followed here because it
    // is what this driver already answers for the shape today, so the ruling on
    // that disagreement stays where it belongs — the issue that records it —
    // instead of being made silently by this rewrite.
    case '$notContains': return true;
    default: return false;
  }
}

/** [#5146] Is this operator's compiled SQL already total for a NULL column? */
function operatorIsNullTotal(op: string, value: unknown): boolean {
  switch (op) {
    // Compile to `IS NULL` / `IS NOT NULL` — two-valued by construction.
    case '$null':
    case '$exists':
      return true;
    // A null comparand makes these null PREDICATES too (see the `$eq`/`$ne`
    // arms of the emitter below), not comparisons.
    //
    // [#6050] Same note as {@link nullValueSatisfiesOperator}'s `$eq`/`$ne`
    // arms: this `=== null` and the emitter's test now read the same value set,
    // because `undefined` is refused before either runs.
    case '$eq':
    case '$ne':
      return value === null;
    default:
      return false;
  }
}

/**
 * [#5146] The guard one field constraint needs. A constraint is the AND of its
 * operators, so it is total when every operator is, and a NULL column satisfies
 * it only when it satisfies all of them.
 */
function nullGuardForFieldSpec(spec: unknown): NullGuard {
  // `{ field: null }` compiles to `IS NULL` — already total.
  if (spec === null) return 'none';
  // A scalar / Date / array comparand is an implicit `=`; a NULL column fails it.
  if (typeof spec !== 'object' || spec instanceof Date || Array.isArray(spec)) return 'requireValue';
  const entries = Object.entries(spec as Record<string, unknown>);
  // [#5240, was #5146] The `entries.length === 0` escape that used to sit here —
  // "`{ field: {} }` compiles to no SQL, so guarding it would turn a shape that
  // emits nothing into a live `IS NULL` predicate, i.e. would RULE on #5240 from
  // here" — is GONE, together with the ambiguity it was protecting. #5240 ruled
  // the shape REFUSED, and `reduceFilterKey` raises that refusal while validating
  // the tree, which `applyFilterCondition` does BEFORE its `$not` branch calls
  // this rewrite. So an empty spec can no longer reach this function at all.
  let total = true;
  let nullSatisfies = true;
  for (const [op, value] of entries) {
    if (!operatorIsNullTotal(op, value)) total = false;
    if (!nullValueSatisfiesOperator(op, value)) nullSatisfies = false;
  }
  if (total) return 'none';
  return nullSatisfies ? 'allowNull' : 'requireValue';
}

/**
 * [#5146] Rewrite the operand of a `$not` so every leaf compiles to a TOTAL
 * predicate, which is what makes `NOT (…)` mean the same thing here as it does
 * in `driver-memory` / `formula`.
 *
 * # The defect
 *
 * SQL is three-valued: `NULL = 'won'` is UNKNOWN, `NOT UNKNOWN` is still
 * UNKNOWN, and a `WHERE` keeps only TRUE — so `{ $not: { stage: 'won' } }`
 * dropped every row whose `stage` is NULL. The JS backends evaluate the same
 * filter in two-valued logic (`undefined !== 'won'` → the row matches), so ONE
 * declared operator gave two different answers depending on which driver ran
 * it. On a CEL `!expr` read scope lowered by `cel-to-filter.ts` that is not a
 * count that differs — it is the SAME permission rule admitting a different
 * set of rows per backend. Ruled NULL-safe in #5146: "the column has no value"
 * counts as NOT satisfying the negated condition, matching the 2:1 majority.
 *
 * # Why the guard is pushed to the LEAF, not hung off the `NOT`
 *
 * The issue states the fix as `NOT (…) OR col IS NULL`, and for the flat shape
 * that motivates it the two are identical — `NOT (a IS NOT NULL AND a = 'won')`
 * is `NOT (a = 'won') OR a IS NULL`. They stop being identical as soon as the
 * operand nests: hoisting the guard to the top of a `$not` whose operand is a
 * `$or` re-admits rows the JS backends exclude (a NULL `a` would satisfy the
 * whole negation even when the `$or`'s OTHER branch is satisfied). Totalising
 * each leaf makes the rewrite compositional instead — De Morgan is sound over
 * two-valued leaves, so `$and`, `$or` and a nested `$not` all stay correct
 * without special cases.
 *
 * # Why polarity is per operator
 *
 * A blanket "OR col IS NULL" would also WIDEN the negative-polarity operators:
 * `{ $not: { a: { $ne: 5 } } }` means "a is 5", and both JS backends exclude a
 * NULL row from it (`null !== 5` holds, so the operand matches, so the negation
 * does not). Adding an unconditional null escape there would hand back exactly
 * the rows the filter excludes — the silent widening class this driver keeps
 * paying for (#2704, #5134). So each leaf is guarded in the direction its own
 * operator answers, per {@link nullValueSatisfiesOperator}.
 *
 * This rewrite only ever runs INSIDE a `$not`, and a POSITIVE comparison's SQL is
 * untouched by it or by anything else — `{ a: 1 }` still compiles to `a = 1`.
 *
 * [#5298] What changed since is the other half: the three operators that carry
 * their own negation (`$ne`, `$nin`, `$notContains`) are NULL-safe outside a
 * `$not` too, emitted directly by {@link SqlDriver.applyNullSafeNegative} rather
 * than through this rewrite. Both paths read the same polarity table and reach
 * the same answer; they stay separate because this one has to compose through De
 * Morgan over a whole operand tree, while that one guards a single leaf.
 *
 * A nested `$not` is deliberately left alone: its own branch totalises its
 * operand, and `NOT <total>` is itself total, so recursing into it here would
 * only stack a redundant guard on the same column.
 */
function nullSafeNegationOperand(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const guarded: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      out[key] = value.map((element) => nullSafeNegationOperand(element as Record<string, unknown>));
      continue;
    }
    if (key.startsWith('$')) {
      // `$not` (handled by its own branch) and anything else `$`-prefixed keep
      // whatever this driver does with them today — the rewrite rules on NULL,
      // not on the operator vocabulary.
      out[key] = value;
      continue;
    }
    const guard = nullGuardForFieldSpec(value);
    if (guard === 'none') {
      out[key] = value;
    } else if (guard === 'requireValue') {
      // `col IS NOT NULL AND (…)` — both conjuncts of the enclosing node.
      guarded.push({ [key]: { $null: false } }, { [key]: value });
    } else {
      // `col IS NULL OR (…)` — one conjunct, so the OR binds tighter than the
      // AND the node's keys form.
      guarded.push({ $or: [{ [key]: { $null: true } }, { [key]: value }] });
    }
  }
  if (guarded.length > 0) {
    const existing = Array.isArray(out.$and) ? out.$and : [];
    out.$and = [...existing, ...guarded];
  }
  return out;
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

// ── Window Function Types (driver-private, #6212) ────────────────────────────

/**
 * One entry of {@link SqlWindowFunctionQuery.windowFunctions} — the flat shape
 * {@link SqlDriver.findWithWindowFunctions} actually reads.
 *
 * This type lives HERE, not in `packages/spec`, deliberately. #4286 retired the
 * spec's window cluster (`WindowFunctionNodeSchema` and friends) precisely
 * because it declared `field` / `over` / `frame` members this door never read —
 * a vocabulary describing an input no executor accepts. Re-adding a window
 * vocabulary to the spec would undo that judgement; window functions are a
 * SQL-driver-private capability (the door is not on `IDataDriver`), so the
 * driver declares its own shape at the layer that owns it. The spec's own
 * removal note names this shape verbatim — `{ function, alias, partitionBy?,
 * orderBy? }`, `packages/spec/src/data/query.zod.ts` — as does the published
 * migration prescription (`query-window-functions-retired` in
 * `packages/spec/src/migrations/registry.ts`), which points embedders at this
 * door. Those two texts and this type must keep saying the same thing.
 *
 * Every member is what {@link SqlDriver.buildWindowFunction} consumes and
 * nothing else:
 * - `function` is emitted as `FUNC()` — uppercased, ARGUMENT-LESS. `lag(revenue)`
 *   renders as `LAG()`; the builder has no argument slot, which is why there is
 *   no `field` member to declare (the skills' aggregation rules say the same).
 * - `orderBy`'s `order` is optional here even though a `DriverQuery`'s top-level
 *   `SortNode` requires it: the builder reads `s.order || 'asc'`, so absence is
 *   a spelling this door genuinely accepts. Declaring it required would reject
 *   input that works.
 */
export interface SqlWindowFunctionSpec {
  /** Window function name, emitted argument-less and uppercased (`rank` → `RANK()`). */
  function: string;
  /** Column alias the computed value is projected as. */
  alias: string;
  /** `PARTITION BY` targets, mapped through the driver's storage-name mapping. */
  partitionBy?: string[];
  /** `ORDER BY` inside the `OVER (…)` clause; `order` defaults to `asc`. */
  orderBy?: { field: string; order?: 'asc' | 'desc' }[];
}

/**
 * The query {@link SqlDriver.findWithWindowFunctions} takes: a
 * {@link DriverQuery} — the contract shape, minus the redundant `object` the
 * first argument already carries (#5181) — carrying this driver's private
 * `windowFunctions` array.
 *
 * `windowFunctions` is `Omit`ed off `DriverQuery` before being re-declared
 * because the spec key is a `retiredKey()` TOMBSTONE: `QueryAST['windowFunctions']`
 * resolves to `undefined`, so a plain intersection would leave the property
 * unwritable and this door's own documented payload would not compile. The
 * tombstone is correct — the REQUEST surface really has no window functions —
 * and this type is what keeps the driver-level door open without reopening it.
 */
export type SqlWindowFunctionQuery = Omit<DriverQuery, 'windowFunctions'> & {
  windowFunctions?: SqlWindowFunctionSpec[];
};

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
    /**
     * Durability-degradation channel (see AGENTS.md §Degradation log levels):
     * used when a constraint the metadata claims is enforced is NOT — e.g. a
     * NULL-safe unique that could not be (re)built (ADR-0120 D4). Falls back
     * to `warn` when the injected sink has no `error`.
     */
    error?: (msg: string, meta?: any) => void;
  } = {
    warn: (msg, meta) => console.warn(msg, meta ?? ''),
    error: (msg, meta) => console.error(msg, meta ?? ''),
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

  async find(object: string, query: DriverQuery, options?: DriverOptions): Promise<any[]> {
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
    query: DriverQuery,
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
  async findOne(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
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
   * Bootstrap helper: scan the data table for the highest counter value among
   * the values matching `prefix` (optionally scoped to a tenant). Used the first
   * time a sequence row is created so legacy/seeded data continues monotonically.
   *
   * # Where the counter sits in a stored value (#6468)
   *
   * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, so a format
   * with tokens AFTER the `{0..0}` slot (`{000}-{YYYY}` → `001-2026`) does not
   * end in the counter. Concatenating every digit of the tail read that as
   * `12026` against a true counter of `1`, and the engine's own fallback seeding
   * read the same row as `2026` — two different wrong answers for one dataset,
   * so the issued band depended on which driver ran.
   *
   * `prefix` and `suffix` are `renderAutonumber`'s own output, computed by the
   * caller and passed down: this driver derives no format understanding of its
   * own, and the engine's `seedAutonumber` applies the identical rule to the
   * identical two strings.
   *
   *   - **Either declared ⇒ ANCHORED**: the counter is the digit run at the
   *     START of what follows the prefix, after removing the declared suffix
   *     when the row carries it.
   *   - **Neither declared ⇒ UNANCHORED**: the legacy reading (every digit in
   *     the value, concatenated) is kept byte-for-byte.
   *
   * ## Why the suffix is NOT pushed into the LIKE
   *
   * `like 'prefix%suffix'` looks tempting and is wrong: the counter scope is the
   * rendered PREFIX, so `{000}-{YYYY}` keeps ONE counter across years while its
   * suffix renders `-2025` on last year's rows. Filtering on the current
   * suffix would drop exactly those rows and seed BELOW the real max — the
   * duplicate-record-number harm, self-inflicted. The predicate therefore stays
   * `prefix%` and the suffix is applied per row, where a non-match simply means
   * "different suffix, same counter".
   */
  protected async scanMaxNumericTail(
    queryRunner: Knex | Knex.Transaction,
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    suffix = '',
  ): Promise<number> {
    const escapedPrefix = prefix.replace(/([\\%_])/g, '\\$1');
    let builder = queryRunner(tableName).select(field).where(field, 'like', `${escapedPrefix}%`).whereNotNull(field);
    if (tenantField && tenantId !== null) {
      builder = builder.where(tenantField, tenantId);
    }
    const rows = await builder;
    let maxN = 0;
    const anchored = prefix !== '' || suffix !== '';
    for (const r of rows as any[]) {
      const v: string = (r as any)[field];
      if (typeof v !== 'string') continue;
      let n: number;
      if (anchored) {
        // A driver-side `LIKE` can match looser than JS `startsWith` (collation,
        // case-insensitive columns); re-check so another scope cannot inflate
        // this counter, mirroring the engine's own JS-side re-check.
        if (prefix && !v.startsWith(prefix)) continue;
        let core = v.slice(prefix.length);
        if (suffix && core.endsWith(suffix)) core = core.slice(0, core.length - suffix.length);
        const head = core.match(/^\d+/);
        if (!head) continue;
        n = parseInt(head[0], 10);
      } else {
        // Unanchored: `prefix` is '' here, so this is the whole value.
        n = parseInt(v.replace(/[^0-9]/g, ''), 10);
      }
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
    // Rendered text AFTER the sequence slot — forwarded verbatim to the
    // bootstrap scan so it can find the counter in values that do not end in it
    // (#6468). Purely positional plumbing; no sequencing logic reads it.
    suffix = '',
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
          suffix,
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
        probe.suffix,
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

  async updateMany(object: string, query: DriverQuery, data: any, options?: DriverOptions): Promise<number> {
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

  async deleteMany(object: string, query: DriverQuery, options?: DriverOptions): Promise<number> {
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

  async count(object: string, query?: DriverQuery, options?: DriverOptions): Promise<number> {
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

    const result = await builder;
    // Only after the statement actually succeeded — an index we failed to
    // create is not one we own (#4884).
    if (INDEX_DDL_PREFIX.test(command)) this.noteRuntimeIndexDdl(command);
    return result;
  }

  /**
   * Index names this process created through raw {@link execute} DDL, keyed by
   * table (#4884).
   *
   * The framework runs a handful of index migrations the additive metadata sync
   * cannot express — ADR-0048's partial UNIQUE overlay indexes on `sys_metadata`
   * are the reference case, issued by `metadata-protocol`'s `ensureOverlayIndex`
   * through this very seam. The drift detector has no other way to tell those
   * apart from an index a stale metadata declaration abandoned, and it used to
   * tell an operator to `--allow-destructive` the *draft-overlay uniqueness
   * guarantee* on a database this build had created seconds earlier.
   *
   * This is a ledger of fact, not a heuristic: an entry means "this process ran
   * that CREATE INDEX and it succeeded". Process-scoped by design — a restart
   * starts empty, and the durable half of the guarantee is
   * {@link isSyncReproducibleIndex}, which reads the index's own definition.
   */
  protected readonly runtimeCreatedIndexes = new Map<string, Set<string>>();

  /** Record (or, on a DROP, forget) an index this driver just created via raw DDL. */
  protected noteRuntimeIndexDdl(sql: string): void {
    const created = CREATE_INDEX_DDL.exec(sql);
    if (created) {
      const table = lastIdentifierSegment(created[2]);
      let names = this.runtimeCreatedIndexes.get(table);
      if (!names) this.runtimeCreatedIndexes.set(table, (names = new Set<string>()));
      names.add(unquoteSqlIdentifier(created[1]));
      return;
    }
    const dropped = DROP_INDEX_DDL.exec(sql);
    if (!dropped) return;
    // SQLite / Postgres `DROP INDEX` names no table, so forget the name
    // wherever it is recorded — the ledger must never outlive the index.
    const name = lastIdentifierSegment(dropped[1]);
    for (const names of this.runtimeCreatedIndexes.values()) names.delete(name);
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

  /**
   * [#6212] `query` is a {@link DriverQuery}, not `any`.
   *
   * `any` here was not "the object name goes unchecked", it was every check off
   * on the members this body READS: `where`'s filter dialect, `groupBy`'s node
   * union, `aggregations`' node shape. #5181 narrowed the six methods
   * `IDataDriver` declares and #6075 followed through on five drivers;
   * `aggregate` is not on that contract, so neither reached it.
   */
  async aggregate(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
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
      // projected column name so the resulting row keys match in-memory
      // bucketDateValue — see the `outKey` note below for what that name is.
      // [#6212] The element type is `GroupByNode` — the spec's own union — so
      // the local `Array<string | { field, dateGranularity? }>` restatement is
      // gone. It had drifted from the declaration it was restating: `alias` was
      // missing from it and `dateGranularity` was widened to `string`, which is
      // what forced the `as any` on the `buildDateBucketExpr` call below.
      for (const g of query.groupBy) {
        if (typeof g === 'string') {
          builder.groupBy(g);
          builder.select(g);
          const kind = this.readPresentationKind(table, g);
          if (kind) presentedOutput.set(g, kind);
        } else if (g && typeof g === 'object' && g.field) {
          // [#6401] The projected column is named `alias ?? field` — the rule
          // `AggregationNodeSchema.alias` already gets a few dozen lines below,
          // and the one `in-memory-aggregation.ts` has always applied
          // (`g.alias ?? g.field`). This face was the half that PARSED the key
          // and ignored it, so one aggregate came back keyed by `closed_at`
          // under pushdown and by `qtr` under the in-memory fallback — decided
          // by a driver capability bit and a timezone the caller cannot see
          // (`engine.ts`'s `allStructuredSupported && !tzRequiresInMemory`
          // fork). GROUP BY still keys on the FIELD; only the projection is
          // renamed, so the buckets are identical and only their column name
          // moves.
          const outKey = g.alias ?? g.field;
          if (g.dateGranularity) {
            const bucket = this.buildDateBucketExpr(g.field, g.dateGranularity, table);
            if (!bucket) {
              // [#6212] Was a bare `throw new Error(...)`; see
              // {@link refuseDateBucketedGroupBy} for why it now carries the
              // ADR-0112 envelope and what the remote face answers.
              refuseDateBucketedGroupBy(
                g.dateGranularity,
                Object.entries(this.dateGranularityCapabilities).filter(([, on]) => on).map(([k]) => k),
                `dialect '${(this.config as any).client}'`,
              );
            }
            builder.groupByRaw(bucket.sql, bucket.bindings);
            builder.select(this.knex.raw(`${bucket.sql} as ??`, [...bucket.bindings, outKey]));
          } else {
            builder.groupBy(g.field);
            // `?? as ??` only when the name actually moves: an alias equal to
            // the field would otherwise rewrite `select "region"` into
            // `select "region" as "region"` on every dialect for no gain.
            builder.select(outKey === g.field ? g.field : this.knex.raw('?? as ??', [g.field, outKey]));
            // Keyed by the OUTPUT column, like the aggregation branch below —
            // `presentReadColumns` matches on the name the row actually
            // carries, so an aliased group value went unpresented before.
            const kind = this.readPresentationKind(table, g.field);
            if (kind) presentedOutput.set(outKey, kind);
          }
        }
      }
    }

    // [#6321] Was `query.aggregations || query.aggregate` / `agg.function ||
    // agg.func`. Neither `aggregate` nor `func` is declared anywhere in the
    // Query Protocol — `QueryASTSchema` declares `aggregations` and
    // `AggregationNodeSchema` declares `function` — so those two limbs were a
    // private dialect this consumer tolerated, which is what PD#12 rejects. The
    // only writers were this package's own fixtures and driver-sqlite-wasm's
    // (#4984's family: a fixture spelling the alias keeps the lenient limb green
    // forever, and nothing ever measures that deleting it costs nothing). Both
    // fixture sets now spell the declared keys, the non-test writer count was
    // zero when measured, and ADR-0049 says an unenforced tolerance goes.
    const aggregates = query.aggregations;
    if (aggregates) {
      for (const agg of aggregates) {
        const funcName = agg.function;
        const lowering = this.mapAggregateFunc(funcName);
        // Spec: `field` is optional for COUNT (means COUNT(*)).
        const fieldExpr = agg.field ?? '*';
        // [#6409] `count_distinct` lowers to `count(distinct ??)`. The keyword
        // goes in the SQL FRAGMENT, never in a binding: `??` still binds the
        // column as a knex identifier exactly as it did for the other five, so
        // the caller's field name has no path into the statement text. And
        // `COUNT(DISTINCT *)` is not valid SQL anywhere — a distinct aggregate
        // with no field is refused rather than emitted, so the caller reads
        // their own mistake instead of a dialect's syntax error wrapped in a
        // 500 (see {@link refuseDistinctAggregateWithoutField}).
        if (lowering.distinct && fieldExpr === '*') refuseDistinctAggregateWithoutField(funcName);
        const rawFunc = lowering.distinct ? `${lowering.sql}(distinct ??)` : `${lowering.sql}(??)`;
        if (agg.alias) {
          if (fieldExpr === '*') {
            builder.select(this.knex.raw(`${lowering.sql}(*) as ??`, [agg.alias]));
          } else {
            builder.select(this.knex.raw(`${rawFunc} as ??`, [fieldExpr, agg.alias]));
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
            builder.select(this.knex.raw(`${lowering.sql}(*)`));
          } else {
            builder.select(this.knex.raw(rawFunc, [fieldExpr]));
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

  /**
   * Distinct values of one field, optionally constrained.
   *
   * The third argument is a **bare {@link FilterCondition}** — the same value
   * `find()` carries under `query.where`, NOT a query envelope. The body has
   * always said so (`applyFilters(builder, filters)` is handed the argument
   * itself, never a `.where` off it); `filters?: any` simply left that sentence
   * out of the type, and #6320 measured what the omission costs.
   *
   * What the annotation actually buys, measured rather than assumed (#6320):
   *
   * - **A truthy SCALAR no longer compiles.** `distinct('orders', 'product',
   *   'completed')` used to type-check and RESOLVE the *unfiltered* set —
   *   `applyFilters` emits no predicate for a non-object, non-array `where`
   *   (see the closing comment there). That silent widening is the family
   *   #6320/#5234 are about, and it is what this narrowing removes.
   * - **A query envelope still compiles, and that is not fixable here.**
   *   `FilterCondition` is an open map (`[key: string]: any`) because a filter
   *   key is a *field name*, so `{ object, where }` is structurally a perfectly
   *   good filter — one that constrains columns named `object` and `where`.
   *   No type can separate it from a legitimate filter. It is caught at
   *   RUNTIME instead, loudly: `INVALID_FILTER` / 400 out of
   *   {@link assertCompilableComparand}, because the envelope's `where` value
   *   is an object and no comparand may be. `driver-memory`'s half of that
   *   asymmetry (a bare filter there returns the unfiltered set in silence)
   *   stays open under the #5499 freeze; this driver's half never was silent.
   *
   * Held by `sql-driver-distinct-filter-narrowing.test.ts`.
   */
  async distinct(object: string, field: string, filters?: FilterCondition, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);
    // The third read door that skipped the chokepoint, and the one #6792 does
    // NOT name — the card asserts the opposite ("called at 13 sites — …,
    // `count`, `distinct`, …"). It is not among them; the 13th read site is
    // `aggregate()`. Found by the gate this change ships, not by the card.
    //
    // VALUES rather than rows, which lowers the volume and not the class:
    // measured on `main` at `6595262`, `distinct(account, 'name', undefined,
    // { tenantId: 'org_a' })` returned `[A1, A2, B1, B2, P1]` — every other
    // tenant's values for the named column. Documented with a runnable example
    // (`content/docs/protocol/objectql/query-syntax.mdx`), so it is exposed the
    // same way the window door is.
    this.applyTenantScope(builder, object, options);

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

  /**
   * The one live window-function door (#4286): not on `IDataDriver`, callable
   * directly on a SQL driver instance. Takes {@link SqlWindowFunctionQuery} —
   * the contract query shape plus this driver's private `windowFunctions`
   * array — so `where` / `orderBy` / `limit` / `offset` are checked here
   * exactly as they are on `find()`, instead of being erased along with the
   * driver-private part (#6212).
   */
  async findWithWindowFunctions(object: string, query: SqlWindowFunctionQuery, options?: DriverOptions): Promise<any[]> {
    const builder = this.getBuilder(object, options);
    // ROWS, so this is the read-side wall itself — not a consistency tidy-up
    // (#6792). This door returned every tenant's rows to a caller that passed
    // `options.tenantId`, because it built through `getBuilder` and then simply
    // never reached the chokepoint all thirteen other doors route through.
    // Measured on `main` at `6595262` with two tenants seeded: `tenantId:
    // 'org_a'` returned `[a1, a2, b1, b2, p1]` here and `[a1, a2, p1]` through
    // `find()` — org_b's rows, handed to org_a, at the driver layer.
    //
    // Placed BESIDE `getBuilder` and above the caller's `where`, which is the
    // position `findRows()` uses: the predicate has to be on the builder before
    // anything reads it, and `applyTenantScope` is what owns the NULL-org
    // platform-row and ADR-0105 D2 union semantics. Re-deriving either here
    // would be a second, worse copy of the wall.
    this.applyTenantScope(builder, object, options);

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

    // PRESENCE, not truthiness — the same test `findRows()` makes (#6577).
    // `limit: 0` means "return no records" (#6485), and `0` is falsy, so
    // `if (query.limit)` dropped the clause and answered a request for NOTHING
    // with the WHOLE table. Measured on `main` before this line changed: three
    // rows seeded, `{ limit: 0 }` returned 3 here and 0 through `find()` — one
    // driver, two answers to one `QueryAST`.
    if (query.limit !== undefined) builder.limit(query.limit);
    if (query.offset !== undefined) builder.offset(query.offset);

    return await builder;
  }

  // ===================================
  // Query Plan Analysis
  // ===================================

  /** IDataDriver standard: analyze query performance */
  async explain(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
    return this.analyzeQuery(object, query, options);
  }

  /**
   * `explain()`'s implementation, and the only other caller of it. It reads
   * `fields` / `where` / `orderBy` / `limit` / `offset` — every one of them a
   * `DriverQuery` member — so it takes `DriverQuery`, which is what `explain()`
   * already declared and forwarded here (#6212).
   */
  async analyzeQuery(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
    const builder = this.getBuilder(object, options);
    // A PLAN, not rows — so this is a smaller fix than the one above, and it is
    // made on its own merits rather than riding in on that one (#6792). It is
    // the SAME defect #6577 fixed on this method one builder line lower: a plan
    // is only worth reading if it explains the statement `find()` would
    // actually run, and a missing tenant predicate is not a cosmetic
    // difference — it changes selectivity and therefore which index the planner
    // picks, so the EXPLAIN answers for a query nobody will execute.
    // Measured on `main` at `6595262`, `tenantId: 'org_a'`:
    //   analyze -> select * from `os6792_account`
    //   find    -> select * from `os6792_account`
    //              where (`organization_id` = ? or `organization_id` is null)
    //              order by `id` asc
    this.applyTenantScope(builder, object, options);

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

    // PRESENCE, not truthiness — see `findWithWindowFunctions()` above (#6577).
    // The stake is different here and no smaller: this door returns a PLAN, and
    // a plan is only worth reading if it explains the statement `find()` would
    // actually run. Measured on `main` before this line changed: `{ limit: 0 }`
    // compiled to `select * from `orders`` while `find()` sent
    // `select * from `orders` order by `id` asc limit ?` — an EXPLAIN for a
    // different query, which is the one thing an EXPLAIN must never be.
    if (query.limit !== undefined) builder.limit(query.limit);
    if (query.offset !== undefined) builder.offset(query.offset);

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
  protected async ensureShardTable(shardName: string, obj: { fields?: Record<string, any>; tenancy?: any }): Promise<void> {
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
      // Shard bookkeeping is aliased AFTER this method runs, so resolve the
      // tenant column from the object schema itself — a declared
      // `unique: 'organization'` index (ADR-0120 D1) must scope identically on
      // every shard of the base table.
      await this.syncDeclaredIndexes(shardName, perShard, new Set(Object.keys(colInfo)), this.computeTenantField(obj));
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
        isUniqueScopeDeclared(f?.unique),
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
    const entries = diffManagedIndexes({
      table: tableName,
      expected: expectedIndexes({ table: tableName, fields, tenantField, declaredIndexes, physicalColumns }),
      // `declaredIndexes` goes to BOTH: it is what the table should have, and
      // therefore also what must never be mistaken for legacy debt (#3955).
      legacy: legacyUniqueReplacements({ table: tableName, fields, tenantField, physicalColumns, declaredIndexes }),
      physical: await this.introspectIndexes(tableName),
      // Indexes the framework built through raw DDL on this boot are its own to
      // manage — never this differ's to propose dropping (#4884).
      runtimeCreated: this.runtimeCreatedIndexes.get(tableName),
      // Lets the differ recognise the NULL-safe organization key part as the
      // sync's own vocabulary (ADR-0120 D3).
      tenantField,
    });
    // ADR-0120 D4: the duplicate pre-flight probe decides each NULL-safe
    // unique op's fate — clean data upgrades the pure tightening to `safe`
    // (dev autoMigrate may apply it); duplicates block the op with a row
    // report. Data-dependent, so it runs HERE, not in the pure differ.
    await this.applyNullSafeUniquePreflight(entries);
    return entries;
  }

  /**
   * ADR-0120 D4 — duplicate pre-flight for NULL-safe organization uniques.
   *
   * Probes every index op that would CREATE a unique index whose organization
   * key part is the NULL-safe COALESCE form, by grouping over that exact key:
   *
   *   - `recreate_index` marked `tightenNullSafeOnly` (the bare composite
   *     tightening into its COALESCE form — same identities, physical fully
   *     plain): a clean probe recategorises it `safe`, so dev
   *     `autoMigrate: 'safe'` and a plain `os migrate apply` may apply it; a
   *     dirty probe keeps it blocked (`destructive` + a re-probe refusal in
   *     {@link applyIndexDriftOp}) and reports the offending rows.
   *   - `create_index` for a unique NULL-safe index: a dirty probe demotes the
   *     default `safe` to blocked with the same row report — the CREATE could
   *     only fail at apply time otherwise, with a raw driver error naming no
   *     rows.
   *
   * `replace_unique_index` is deliberately NOT probed: the legacy index it
   * retires is a platform-wide unique, strictly stronger than the NULL-safe
   * composite, so duplicates in the new key are impossible by construction.
   */
  protected async applyNullSafeUniquePreflight(entries: ManagedDriftEntry[]): Promise<void> {
    for (const d of entries) {
      const op = d.op;
      if (op.type !== 'recreate_index' && op.type !== 'create_index') continue;
      if (!op.unique || !op.nullSafeColumns || op.nullSafeColumns.length === 0) continue;
      const tighten = op.type === 'recreate_index' && op.tightenNullSafeOnly === true;
      // A generic unique recreate (columns differ beyond the key-part form)
      // keeps its pre-ADR-0120 semantics untouched.
      if (op.type === 'recreate_index' && !tighten) continue;

      let duplicates: Array<{ key: string; rows: number }>;
      try {
        duplicates = await this.probeNullSafeUniqueDuplicates(op.table, op.columns, op.nullSafeColumns);
      } catch (e: any) {
        // Probe failure must fail SAFE: without evidence the data is clean the
        // op may not claim eligibility for auto-apply.
        this.logger.warn(
          `[schema-drift] duplicate pre-flight for '${op.indexName}' on '${op.table}' failed — leaving the op gated`,
          e?.message ?? e,
        );
        continue;
      }

      const signature = d.expected;
      if (duplicates.length === 0) {
        if (tighten) {
          d.category = 'safe';
          d.severity = 'warning';
          d.message =
            `${op.table}: index '${op.indexName}' tightens to ${signature} — the organization key part becomes ` +
            `NULL-safe (ADR-0120 D3), so rows without an organization are constrained too. The duplicate ` +
            `pre-flight probe found no conflicting rows: pure tightening, applied by "os migrate apply" ` +
            `(auto-applied at boot under dev autoMigrate: 'safe').`;
        }
        continue;
      }

      const report = duplicates
        .slice(0, 5)
        .map((g) => `(${g.key}) × ${g.rows} rows`)
        .join('; ');
      const more = duplicates.length > 5 ? `; …and ${duplicates.length - 5} more group(s)` : '';
      d.category = 'destructive';
      d.severity = 'error';
      d.message =
        `${op.table}: cannot ${tighten ? 'tighten' : 'create'} '${op.indexName}' as ${signature} — existing rows ` +
        `already violate the NULL-safe unique constraint (duplicates the old index wrongly admitted, #5030): ` +
        `${report}${more}. The op is BLOCKED: apply re-probes and refuses, and the existing index stays in place ` +
        `(ADR-0120 D4). Deduplicate the listed rows, then re-run "os migrate plan".`;
    }
  }

  /**
   * Find duplicate groups under a NULL-safe organization unique key: GROUP BY
   * the exact key the index will enforce — `COALESCE(<org>, '__global__')` for
   * the NULL-safe parts, the bare column otherwise — HAVING COUNT(*) > 1.
   * Returns one entry per conflicting group, `key` naming columns and values.
   */
  protected async probeNullSafeUniqueDuplicates(
    table: string,
    columns: string[],
    nullSafeColumns: string[],
  ): Promise<Array<{ key: string; rows: number }>> {
    const ns = new Set(nullSafeColumns);
    const q = (id: string) => this.knex.ref(id).toQuery();
    const parts = columns.map((c) =>
      ns.has(c) ? `COALESCE(${q(c)}, '${GLOBAL_TENANT}')` : q(c),
    );
    const selectList = parts.map((p, i) => `${p} AS k${i}`).join(', ');
    const groupList = parts.join(', ');
    const sql =
      `SELECT ${selectList}, COUNT(*) AS n FROM ${q(table)} ` +
      `GROUP BY ${groupList} HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 20`;
    const res: any = await this.knex.raw(sql);
    const rows: any[] = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
    return rows.map((r: any) => ({
      key: columns.map((c, i) => `${c}=${JSON.stringify(r[`k${i}`])}`).join(', '),
      rows: Number(r.n ?? r.N ?? 0),
    }));
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
    const ensure = (name: string, columns: string[], unique: boolean, nullSafeColumns?: string[]) =>
      this.syncDeclaredIndexes(op.table, [{ name, fields: columns, unique, nullSafeColumns }], physicalColumns);

    switch (op.type) {
      case 'replace_unique_index': {
        // CREATE before DROP: the composite and the legacy index have different
        // names, so uniqueness is never unenforced in between. If the create
        // fails we have not dropped anything yet and the schema is untouched.
        await ensure(op.createIndexName, op.createColumns, true, op.nullSafeColumns);
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
        await ensure(op.indexName, op.columns, op.unique, op.nullSafeColumns);
        // Honest applied-reporting: `syncDeclaredIndexes` degrades some
        // failures (a NULL-safe unique over data that still violates it) into
        // a loud log instead of a throw, so presence is the only proof.
        return (await this.getExistingIndexNames(op.table)).has(op.indexName);
      case 'drop_index':
        return await this.dropIndexIfExists(op.table, op.indexName);
      case 'recreate_index': {
        // Same name on both sides — the drop has to come first, and a UNIQUE
        // target can fail on existing duplicates. That is why this op is
        // categorised destructive when unique (see `diffManagedIndexes`).
        //
        // ADR-0120 D4: the NULL-safe tightening re-runs the duplicate
        // pre-flight HERE, immediately before the drop — the plan-time probe
        // may be stale, and at no point may a constraint be dropped without
        // its replacement being creatable. Duplicates → refuse, old index
        // untouched.
        const nullSafe = op.unique && (op.nullSafeColumns?.length ?? 0) > 0;
        if (nullSafe) {
          const duplicates = await this.probeNullSafeUniqueDuplicates(
            op.table,
            op.columns,
            op.nullSafeColumns!,
          );
          if (duplicates.length > 0) {
            (this.logger.error ?? this.logger.warn)(
              `[schema-drift] REFUSING to rebuild '${op.indexName}' on '${op.table}' as a NULL-safe unique — ` +
                `${duplicates.length} duplicate group(s) violate it (e.g. ${duplicates[0].key} × ${duplicates[0].rows} rows). ` +
                `The existing index is left in place; deduplicate and re-run "os migrate plan" (ADR-0120 D4).`,
            );
            return false;
          }
        }
        await this.dropIndexIfExists(op.table, op.indexName);
        try {
          await ensure(op.indexName, op.columns, op.unique, op.nullSafeColumns);
        } catch (e) {
          if (nullSafe) await this.restoreBareIndexAfterFailedTighten(op, e);
          throw e;
        }
        const present = (await this.getExistingIndexNames(op.table)).has(op.indexName);
        if (!present && nullSafe) await this.restoreBareIndexAfterFailedTighten(op, undefined);
        return present;
      }
      default:
        return false;
    }
  }

  /**
   * Last-resort restore for the ADR-0120 D4 tightening: the old index is
   * already dropped and the NULL-safe replacement could not be created (a
   * write raced the probe, or the dialect refused the expression key). Put the
   * previous BARE composite back under the same name so the constraint that
   * existed before the attempt keeps existing — then say, at `error` level,
   * exactly what is NOT enforced and how to fix it, because from the outside
   * everything keeps looking normal (the durability-degradation rule).
   */
  protected async restoreBareIndexAfterFailedTighten(
    op: Extract<DriftOp, { type: 'recreate_index' }>,
    cause: unknown,
  ): Promise<void> {
    try {
      await this.syncDeclaredIndexes(
        op.table,
        [{ name: op.indexName, fields: op.columns, unique: op.unique }],
        new Set(Object.keys(await this.knex(op.table).columnInfo())),
      );
    } catch {
      /* the error below reports the state either way */
    }
    const restored = (await this.getExistingIndexNames(op.table)).has(op.indexName);
    (this.logger.error ?? this.logger.warn)(
      `[schema-drift] could not create the NULL-safe unique '${op.indexName}' on '${op.table}' after dropping ` +
        `the old index${restored ? ' — restored the previous bare composite' : ' — AND the restore failed, so the ' +
        'constraint is currently NOT enforced'}. Rows without an organization are ${restored ? 'still ' : ''}not ` +
        `constrained (#5030); re-run "os migrate plan" and apply the reported op (ADR-0120 D4).`,
      (cause as any)?.message ?? cause,
    );
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
   *
   * ⚠️ The key is read from the index DEFINITION, not from the dialect's
   * per-column catalogue view (#4884). Those views describe an expression key
   * with a NULL column and nothing else, so `(type, name, organization_id,
   * COALESCE(package_id,''))` used to arrive here as three columns — and a
   * healthy ADR-0048 overlay index read as drift against its own four-column
   * declaration. The partial predicate is captured for the same reason: it is
   * what tells the differ this index is none of its business
   * (`isSyncReproducibleIndex`).
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
        // `sqlite_master.sql` is the only place an expression key or a WHERE
        // predicate survives; it is NULL for the indexes SQLite auto-creates
        // for a UNIQUE/PK constraint, which are plain by construction.
        const ddlByName = new Map<string, string>();
        const master: any = await this.knex.raw(
          `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
          [tableName],
        );
        for (const r of Array.isArray(master) ? master : (master?.rows ?? [])) {
          if (typeof r?.sql === 'string' && r.sql) ddlByName.set(r.name, r.sql);
        }
        const list: any = await this.knex.raw(`PRAGMA index_list(${safe})`);
        for (const r of list) {
          const entry = upsert(r.name, r.unique === 1 || r.unique === true, r.origin === 'pk');
          const parsed = parseIndexDdl(ddlByName.get(r.name) ?? '');
          if (parsed) {
            applyIndexKeyParts(entry, parsed.keyParts);
            if (parsed.partial) entry.partial = true;
          } else {
            const info: any = await this.knex.raw(`PRAGMA index_info(${JSON.stringify(r.name)})`);
            for (const c of info) if (c.name != null) entry.columns.push(c.name);
          }
          // `PRAGMA index_list` reports partiality directly (SQLite ≥ 3.8.9);
          // belt-and-braces with the parsed predicate above.
          if (r.partial === 1 || r.partial === true) entry.partial = true;
        }
      } else if (this.isPostgres) {
        const res: any = await this.knex.raw(
          `SELECT i.relname AS index_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
                  (ix.indpred IS NOT NULL) AS is_partial,
                  pg_get_indexdef(ix.indexrelid) AS indexdef
             FROM pg_class t
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_index ix ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
            WHERE t.relname = ? AND n.nspname = 'public'
            ORDER BY i.relname`,
          [tableName],
        );
        for (const r of res.rows) {
          const entry = upsert(r.index_name, r.is_unique === true, r.is_primary === true);
          if (r.is_partial === true) entry.partial = true;
          const parsed = parseIndexDdl(r.indexdef);
          if (parsed) applyIndexKeyParts(entry, parsed.keyParts);
        }
      } else if (this.isMysql) {
        // `EXPRESSION` only exists from MySQL 8.0.13 (functional indexes); on an
        // older server or MariaDB the column is unknown and the query errors, so
        // fall back rather than lose index introspection wholesale.
        const columns = 'INDEX_NAME, NON_UNIQUE, COLUMN_NAME, EXPRESSION';
        const statisticsQuery = (select: string) =>
          this.knex.raw(
            `SELECT ${select}
               FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
            [tableName],
          );
        let res: any;
        try {
          res = await statisticsQuery(columns);
        } catch {
          res = await statisticsQuery('INDEX_NAME, NON_UNIQUE, COLUMN_NAME');
        }
        for (const r of res[0]) {
          const entry = upsert(r.INDEX_NAME, Number(r.NON_UNIQUE) === 0, r.INDEX_NAME === 'PRIMARY');
          if (r.COLUMN_NAME != null) entry.columns.push(r.COLUMN_NAME);
          else if (r.EXPRESSION != null) applyIndexKeyParts(entry, [String(r.EXPRESSION)]);
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
  ): Array<{ name: string; fields: string[]; unique: true; nullSafeColumns?: string[] }> {
    return uniqueIndexesFromFields(tableName, fields, tenantField).map((i) => ({
      name: i.name,
      fields: i.columns,
      unique: true as const,
      ...(i.nullSafeColumns ? { nullSafeColumns: i.nullSafeColumns } : {}),
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
    // Pass the tenant column through rather than letting `syncDeclaredIndexes`
    // re-resolve it: every caller of this method already holds the value the
    // registration recorded, and a declared `unique: 'organization'` index
    // (ADR-0120 D1) must scope against exactly that column.
    await this.syncDeclaredIndexes(tableName, [...fromFields, ...declared], physicalColumns, tenantField);
  }

  /**
   * Materialize declared object-level indexes.
   *
   * - Multi-column and single-column indexes are both supported.
   * - `unique: true` / `'global'` emits a UNIQUE index over the column list
   *   taken VERBATIM — no tenant column is injected. That verbatim behavior is
   *   the `'global'` arm of the ADR-0120 D1 scope vocabulary (it was the only
   *   arm before that ADR): a `'global'` declared index already names its
   *   columns and is frequently platform-wide on purpose (a DNS hostname, a
   *   reserved slug, an external provider id, every engine dedup key), so
   *   rewriting it would break real constraints. NULL-distinct semantics are
   *   the default across SQLite/Postgres/MySQL, so multiple NULL rows remain
   *   allowed while non-NULL duplicates are rejected — matching the
   *   convergence-on-conflict pattern the messaging pipeline relies on.
   * - `unique: 'organization'` (ADR-0120 D1/D3) prepends the table's tenant
   *   column in its NULL-safe form — `COALESCE(tenantField, '__global__')` —
   *   resolved here at registration, where tenancy is known; with no tenant
   *   column it degrades to the listed columns (S11). Field-level `unique` is
   *   scoped upstream in {@link uniqueIndexesFromFields} and arrives here
   *   pre-resolved (`nullSafeColumns`). Both routes land on
   *   {@link normalizeDeclaredIndex}, the differ's normalizer, so what the
   *   sync CREATES and what the differ EXPECTS cannot drift apart.
   * - Idempotent: indexes already present (by deterministic name) are
   *   skipped, and an "already exists" race is absorbed.
   * - Indexes referencing a column that wasn't materialized (e.g. a virtual
   *   `formula` field) are skipped with a warning rather than failing sync.
   * - A NULL-safe unique whose data already violates it (legacy duplicates the
   *   void constraint admitted, #5030) is NOT created; the failure is logged
   *   at `error` (a declared constraint is not enforced — the
   *   durability-degradation rule) and surfaces as drift with a row report via
   *   the ADR-0120 D4 pre-flight, instead of failing the whole boot.
   */
  protected async syncDeclaredIndexes(
    tableName: string,
    indexes: DeclaredIndexInput[],
    physicalColumns: Set<string>,
    tenantField?: string | null,
  ): Promise<void> {
    const existing = await this.getExistingIndexNames(tableName);
    const resolvedTenantField = tenantField !== undefined ? tenantField : this.resolveTenantField(tableName);

    for (const idx of indexes) {
      const norm = normalizeDeclaredIndex(tableName, idx, resolvedTenantField);
      if (!norm) continue;
      const { name, columns, unique } = norm;
      const nullSafe = new Set(norm.nullSafeColumns ?? []);

      const missing = columns.filter((f) => !physicalColumns.has(f));
      if (missing.length > 0) {
        this.logger.warn(
          `[sql-driver] skipping declared index on "${tableName}" — column(s) not materialized: ${missing.join(', ')}`,
          { tableName, fields: columns },
        );
        continue;
      }

      if (existing.has(name)) continue;

      try {
        if (nullSafe.size > 0) {
          await this.createNullSafeUniqueIndex(tableName, name, columns, nullSafe);
        } else {
          await this.knex.schema.alterTable(tableName, (table) => {
            if (unique) {
              table.unique(columns, { indexName: name });
            } else {
              table.index(columns, name);
            }
          });
        }
        existing.add(name);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // A concurrent creator or a pre-existing equivalent index under a
        // different name can race us here — both are benign for our intent
        // (the index exists). Anything else is a real failure.
        if (/already exists|duplicate key name|exists/i.test(msg)) continue;
        // The ERROR OBJECT, not `msg` (#6543). This used to be a private
        // inline regex over the message alone, which is the only channel the
        // SQLite family reliably fills — but Postgres answers this exact
        // failure with `could not create unique index "…"` and puts the
        // verdict on `code` (SQLSTATE 23505) instead, so a message-only read
        // missed the dialect entirely and took the boot down on the very case
        // the branch below exists to absorb. The shared predicate reads
        // `code` / `errno` / `message` / `cause`; see
        // `@objectstack/types`' `unique-violation.ts` for why it is the one
        // name for this question.
        if (nullSafe.size > 0 && isUniqueViolationError(e)) {
          // Existing rows violate the NULL-safe unique — the #5030 defect made
          // visible. Do not take the boot down: the declared constraint is not
          // enforced yet, say so at `error` (from the outside everything looks
          // normal), and let the D4 drift pre-flight report the exact rows.
          (this.logger.error ?? this.logger.warn)(
            `[sql-driver] cannot create NULL-safe unique index '${name}' on "${tableName}" — existing rows ` +
              `violate it (duplicates the previous NULL-distinct index admitted, #5030). The constraint ` +
              `'${columns.join(', ')}' is NOT enforced until the data is deduplicated: run "os migrate plan" ` +
              `for the conflicting rows (ADR-0120 D4).`,
            msg,
          );
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Raw DDL for an organization-scoped unique index (ADR-0120 D3): knex's
   * schema builder cannot express an expression key part, so the CREATE is
   * spelled out. SQLite and Postgres take the function call as a key part
   * directly; MySQL requires functional key parts to be parenthesized.
   *
   * On a MySQL that predates functional key parts (< 8.0.13) or MariaDB, the
   * expression form is rejected — degrade to the BARE composite so non-NULL
   * rows keep their constraint, and say at `error` level exactly what is not
   * enforced (the NULL-organization bucket) and what fixes it. A silent bare
   * fallback would re-open #5030 unnamed; failing the boot would brick every
   * such deployment for every unique field. The drift differ keeps reporting
   * the tightening for the day the server is upgraded.
   */
  protected async createNullSafeUniqueIndex(
    tableName: string,
    name: string,
    columns: string[],
    nullSafe: ReadonlySet<string>,
  ): Promise<void> {
    const q = (id: string) => this.knex.ref(id).toQuery();
    const parts = columns.map((c) => {
      if (!nullSafe.has(c)) return q(c);
      const expr = `COALESCE(${q(c)}, '${GLOBAL_TENANT}')`;
      return this.isMysql ? `(${expr})` : expr;
    });
    const sql = `CREATE UNIQUE INDEX ${q(name)} ON ${q(tableName)} (${parts.join(', ')})`;
    try {
      await this.knex.raw(sql);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // The positive limb is this site's own question — "does this server
      // reject functional key parts?" — and stays a message test, because
      // that is the only channel the answer is on. The NEGATIVE limb was a
      // seventh spelling of the unique-violation vocabulary (`/duplicate/i`)
      // and is now the shared predicate (#6543): a conflict must never be
      // read as a syntax rejection and silently degraded to the bare
      // composite, and on the `errno`-only shape mysql2 can hand back, a
      // message-only exclusion did not fire.
      const functionalUnsupported =
        this.isMysql && /syntax|functional|not supported|near '\(/i.test(msg) && !isUniqueViolationError(e);
      if (!functionalUnsupported) throw e;
      (this.logger.error ?? this.logger.warn)(
        `[sql-driver] this MySQL/MariaDB server rejects functional key parts — created '${name}' on ` +
          `"${tableName}" over the BARE columns instead. Rows without an organization are NOT constrained ` +
          `by it (#5030): upgrade to MySQL >= 8.0.13 and re-run "os migrate plan" to tighten it (ADR-0120 D3).`,
        msg,
      );
      await this.knex.schema.alterTable(tableName, (table) => {
        table.unique(columns, { indexName: name });
      });
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
   * Whether this deployment requested an organization wall — the same resolved
   * POSTURE the SchemaRegistry and SecurityPlugin key off. Gates the
   * tenant-audit warning, which is only meaningful where tenant isolation is
   * something the deployment actually asked for.
   *
   * [ADR-0105 D1 / #5262] ⛔ Never `resolveMultiOrgEnabled()`. That boolean was
   * DEMOTED to a back-compat input of `resolveTenancyPosture()` and reads
   * `false` on a deployment configured the documented way
   * (`OS_TENANCY_POSTURE=isolated|group`, legacy boolean unset), so the
   * tenant-audit warning — the one signal that catches a sudo/seed write
   * landing outside its tenant — was silently off on exactly the walled
   * deployments it exists for.
   *
   * REQUESTED posture, not the `tenancy` service's effective answer, for two
   * reasons. This class is a driver: it is constructed from connection config
   * with no kernel or service registry to ask, so the effective posture is not
   * reachable here at all. And the asymmetry runs the right way for a WARNING —
   * a spurious line on a degraded stack costs a log entry, while a suppressed
   * one on a walled stack is the defect being fixed.
   *
   * ⚠️ Read LIVE on every call, never memoised. The previous `_multiTenantMode`
   * field froze a process-level fact into a per-instance verdict on whichever
   * write happened to land first — the "startup reading recorded as a judgment"
   * shape AGENTS.md warns about — which made the gate unable to see anything a
   * later boot phase (or a test) established. It is affordable because
   * {@link auditMissingTenant} now consults it only AFTER the cheap `tenantId`
   * early-out, so a normal tenant-scoped write never reaches this at all.
   */
  protected isMultiTenantMode(): boolean {
    return postureEnforcesWall(resolveTenancyPosture());
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
   *
   * This is the single chokepoint for read-side tenant isolation in the SQL
   * driver, and every read door routes through it — `findRows()` (what
   * `find()`/`findOne()` use), `count()`, `aggregate()`, `distinct()`,
   * `findWithWindowFunctions()`, `analyzeQuery()`/`explain()`, and the
   * update/delete predicates and their readbacks. Write-side tenancy is a
   * different mechanism and deliberately not this one: inserts stamp the
   * column via {@link injectTenantOnInsert}, so the three `insert` builders
   * (create / upsert / bulkCreate) reach `getBuilder` without coming here.
   *
   * ⚠️ That sentence used to be written as a claim — "every CRUD method routes
   * through it" — and it was FALSE for as long as it had existed (#6792).
   * Three doors built through `getBuilder` and never arrived:
   * `findWithWindowFunctions` (ROWS — a caller passing `tenantId` got every
   * tenant's rows), `analyzeQuery`/`explain` (a PLAN for a statement `find()`
   * would not run), and `distinct` (every tenant's values for one column). The
   * first two were filed; the third was found only because the invariant was
   * finally MEASURED. Nothing had ever checked it, which is exactly how a
   * docstring becomes the last place a wrong fact survives.
   *
   * So it is no longer a claim. `scripts/check-tenant-chokepoint.mjs`
   * (`pnpm check:tenant-chokepoint`, wired into `.github/workflows/lint.yml`)
   * re-derives it from the AST on every run: a method that builds through
   * `getBuilder(object, options)` and lets that builder escape as a read must
   * call this, or carry a written exemption. Edit this list and the gate will
   * disagree with you — that is the point.
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
    // A write that DID carry its tenant is the case this audit has nothing to
    // say about, and it is the overwhelmingly common one — so it exits here,
    // before the posture read below. Ordering only (both guards are pure
    // predicates over independent facts); it is what makes `isMultiTenantMode()`
    // affordable as a live read now that it no longer memoises (#5262).
    const tenantId = options?.tenantId;
    if (tenantId !== undefined && tenantId !== null && tenantId !== '') return;
    // Only meaningful in multi-tenant deployments. Single-tenant stacks have no
    // tenant isolation, yet the kernel now ALWAYS provisions an `organization_id`
    // column (its existence is decoupled from the tenant flag). Column presence
    // alone therefore no longer implies "tenant-scoped" — without this gate every
    // system/sudo write (e.g. the notification/http delivery dispatchers' claim
    // updates) would spam a meaningless warning on single-tenant boots.
    if (!this.isMultiTenantMode()) return;
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
    /**
     * [#5298] Wrap a value test so a row whose column has no value SATISFIES it:
     * `(<expr> IS NULL OR <test>)`.
     *
     * `expr.sql` is a storage-normalising expression over ONE column
     * ({@link filterColumnExpr}), and every dialect's `datetime()` / `CASE`
     * form answers NULL for a NULL input — so testing the expression is the
     * same question as testing the raw column, and keeps the whole predicate
     * readable as one unit. `expr.bindings` is repeated because `expr.sql`
     * appears twice.
     */
    const nullSafe = (testSql: string, testBindings: any[]): void => {
      builder[raw](`(${expr.sql} IS NULL OR ${testSql})`, [...expr.bindings, ...testBindings]);
    };
    const binary = (sqlOp: string, negative = false): boolean => {
      // A null comparand is a null PREDICATE, not a comparison — hand it back so
      // the caller compiles `IS NULL` / `IS NOT NULL` as it always has.
      if (value == null) return false;
      const sql = `${expr.sql} ${sqlOp} ?`;
      const bindings = [...expr.bindings, value];
      if (negative) nullSafe(sql, bindings);
      else builder[raw](sql, bindings);
      return true;
    };
    const list = (sqlOp: 'in' | 'not in'): boolean => {
      if (!Array.isArray(value) || value.length === 0) return false;
      const placeholders = value.map(() => '?').join(', ');
      const sql = `${expr.sql} ${sqlOp} (${placeholders})`;
      const bindings = [...expr.bindings, ...value];
      // [#5298] Only `not in` is negative-polarity; `in` stays a bare test.
      if (sqlOp === 'not in') nullSafe(sql, bindings);
      else builder[raw](sql, bindings);
      return true;
    };

    switch (op) {
      case '=': case '==': case '$eq':
        return binary('=');
      case '!=': case '<>': case '$ne':
        // [#5298] NULL-safe — the same ruling the plain-column arm below follows.
        return binary('<>', true);
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

    // [#5158] `where` is a `FilterCondition` OBJECT. It always was — the spec
    // declares `QueryASTSchema.where: FilterConditionSchema` — but this method
    // used to carry a SECOND compiler for the array spelling, including an
    // INFIX dialect (`[condA, 'or', condB]`) that no schema ever declared and
    // that `parseFilterAST` cannot express. `FilterArray` is now declared as
    // INPUT-ONLY authoring sugar (`spec/data/filter.zod.ts`, #5285) and BOTH
    // doors into the runtime lower it before a driver is reached: the protocol
    // face (`metadata-protocol`) and the engine (`ObjectQL.find`/`findOne`/
    // `count`/`aggregate`/`update`/`delete`). So an array here is a bug in the
    // caller, not a dialect to compile — and refusing it is what converges this
    // driver with cloud's `RemoteTransport.buildWhereSQL`, which has refused
    // the same input since cloud#1075. That fork had zero tests on either side.
    if (Array.isArray(filters)) {
      // `[]` keeps its meaning — "no filter", not a failed filter. Unchanged
      // from every previous version of this method, and the same reading
      // `parseFilterAST([])` gives it.
      if (filters.length === 0) return;
      throw filterArrayReachedDriverError(filters);
    }

    const table = this.coercionKey(builder);

    if (typeof filters === 'object') {
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
        // #5240 — `{ field: {} }` reaches this loop when NO key of the filter
        // carries an operator; the combinator path refuses it on the reduction
        // walk. Refused here with the SAME message so one condition has one
        // wording wherever the author wrote it — this position used to answer
        // with #5041's generic "cannot be bound as a SQL parameter", which
        // describes a comparand and not a constraint with no operator at all.
        if (isEmptyFieldConstraint(value)) throw emptyFieldConstraintError(key, `filter.${key}`);
        // #6050 — the same position as the `undefined` gate on the reduction
        // walk, reached the same way `{ field: {} }` above reaches its own: this
        // loop runs when NO key of the filter carries an operator, so the walk
        // never sees the node. `{ d: undefined }` IS that shape — `typeof
        // undefined` is not `'object'`, so it cannot make `hasMongoOperators`
        // true — and it is the single most likely spelling of the defect
        // (`{ owner_id: ctx.user?.id }`). ONE function answers both call sites
        // so the two positions cannot drift into two verdicts, which is the
        // #5240 lesson this driver already paid for once.
        assertDefinedComparands(key, value, `filter.${key}`);
        // #5041 — the plain `{ field: value }` map compiles to an implicit `=`,
        // so it is a comparison emitter too and gets the same gate.
        assertCompilableComparand(column, '=', value);
        const coerced = this.coerceFilterValue(table, key, value);
        const expr = this.filterColumnExpr(table, key, column);
        if (expr && this.applyNormalizedComparison(builder, 'and', expr, '=', coerced)) continue;
        builder.where(column, coerced as any);
      }
      return;
    }

    // A truthy non-object, non-array `where` (`'active'`, `42`) emits no
    // predicate. Pre-existing behaviour on a shape only a cast can produce —
    // the protocol face rejects it (`unusableFilterError`) and `FilterCondition`
    // does not describe it. Untouched here on purpose: #5158 is about the ARRAY
    // dialect, and widening the refusal is a separate change with its own
    // blast radius.
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
   * [#5298] Emit a NEGATIVE-polarity value test so a row whose column is NULL
   * satisfies it: `(col IS NULL OR <test>)`.
   *
   * # Why the non-negated operators need this at all
   *
   * SQL is three-valued and a `WHERE` keeps only TRUE, so `d <> 'v1'` is
   * UNKNOWN — and therefore dropped — for every row where `d` is NULL, while
   * `driver-memory` and `formula` evaluate the same filter in two-valued JS
   * (`undefined !== 'v1'` is simply true) and return those rows. #5146 ruled
   * that divergence for `$not`; #5298 ruled it the same way for the three
   * operators that carry their negation in the operator itself — `$ne`,
   * `$nin`, `$notContains`. "The column has no value" satisfies a test for
   * "not this value", on every backend.
   *
   * It is a security fix as much as a consistency one: one RLS rule is
   * evaluated by the read-side SQL lowering AND the write-side `check`
   * evaluator, so a per-backend answer here means one permission rule admitting
   * two different row sets (`read-scope-sql.ts` carries the same change).
   *
   * # Why OR-expansion and not a dialect equivalent
   *
   * `IS DISTINCT FROM` (Postgres) / `IS NOT` (SQLite) / `<=>` (MySQL) each
   * express this in one operator, and all three were rejected: `NOT LIKE` has
   * no such form at all, so `$notContains` would need the OR shape anyway and
   * the driver would carry two shapes for one ruling; the SQLite spelling
   * depends on an engine version this repo does not pin (sql.js / libSQL move
   * independently); and measured `EXPLAIN QUERY PLAN` output is identical
   * either way — `<>`, `NOT IN` and `NOT LIKE` were already full scans before
   * this change, so there is no index to lose and none to win back. One shape,
   * every dialect.
   *
   * # Why a group and not a raw string
   *
   * The callback form keeps the predicate ONE unit for the enclosing builder,
   * so an `$or` branch attaches it as a single clause and the wrapping
   * parentheses are Knex's, not hand-built — the `IS NULL OR` must never
   * escape its own conjunct and widen a sibling.
   */
  private applyNullSafeNegative(
    builder: any,
    method: string,
    field: string,
    emitValueTest: (qb: any) => void,
  ): void {
    (builder as any)[method]((qb: any) => {
      qb.whereNull(field);
      emitValueTest(qb);
    });
  }

  /**
   * Parameterized text match for the `$contains` family and `$icontains`, with
   * the comparand's metacharacters escaped so it matches LITERALLY — otherwise
   * a value of `%` matches every row (a filter-bypass, P0). `shape` positions
   * the wildcard: `contains` → `%v%`, `starts` → `v%`, `ends` → `%v`.
   *
   * **[#6518] The construct is chosen by DIALECT, and that is the whole point
   * of this method's existence.** Everything about which SQL is emitted lives in
   * {@link textMatchPredicate}; this method only picks `whereRaw` vs
   * `orWhereRaw`. See that function for the per-dialect table and the measured
   * evidence behind each cell — in one sentence: case sensitivity used to be
   * the DIALECT's answer (SQLite's `LIKE` folds ASCII, Postgres's does not,
   * MySQL's follows its collation) where #4706 Q2 = A says it is the
   * CONTRACT's, and `LOWER()` folds the whole Unicode range on Postgres/MySQL
   * where #4706 Q1 = A says `$icontains` folds ASCII only.
   *
   * **Second implementation, deliberately** (#5567):
   * `packages/services/service-analytics/src/like-pattern.ts` carries the same
   * LIKE transform — same escaped character class, same three shapes, same bound
   * `ESCAPE` — because `service-analytics` depends on no driver and this is a
   * private method taking a knex builder, so there is nothing for it to import.
   * That file's header explains the choice; it is held to the LIKE arm of
   * {@link textMatchPredicate}, character for character, by
   * `service-analytics`'s `like-metacharacter-escape.test.ts`. A third hand-copy
   * is the thing to refuse: import from one of the two, or add a consumer to
   * that test.
   *
   * **[#5234] `String(value)` is safe here because nothing unrenderable reaches
   * it.** {@link assertCompilableComparand} refuses an object comparand on this
   * family before any emitter runs, so the only values arriving are the ones
   * {@link isRenderableTextComparand} admits — a string, number, bigint,
   * boolean, `null`, `undefined` or `Date`, each of which `String()` renders
   * faithfully. Do NOT add a second, tolerant reading of an object here: the
   * `[object Object]` pattern this used to build was valid SQL matching a
   * literal nobody wrote, and `service-analytics` refuses the same shape at its
   * own two doors so one `$contains` still means one thing on every face.
   */
  private applyLike(
    builder: any,
    method: string,
    field: string,
    value: unknown,
    shape: TextMatchShape,
    negate = false,
    fold = false,
  ): void {
    const rawMethod = method.startsWith('or') ? 'orWhereRaw' : 'whereRaw';
    const { sql, bindings } = textMatchPredicate(this.dialectName, field, value, shape, negate, fold);
    builder[rawMethod](sql, bindings);
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
   *
   * # Boolean identities (#5134)
   *
   * Every combinator is decided by {@link reduceFilterNode} BEFORE anything is
   * emitted, because Knex renders no SQL for a group that received no clause —
   * so "the group is empty" and "the group is satisfied" used to compile to the
   * same query. That is not an identity, it is a dropped clause, and the two
   * identities point in opposite directions: empty `$and` is TRUE, empty `$or`
   * is FALSE, and `$not` of an empty (TRUE) group is FALSE. The old code
   * answered the whole table to all three; `$and` was right only because
   * "dropped" coincides with TRUE on the AND side.
   *
   * The reduction also makes every group this method opens provably NON-EMPTY:
   * a `'true'` combinator is skipped outright, `'true'` members of a `$and` and
   * `'false'` members of a `$or` are dropped as their identities, and a node
   * that reduces to `'false'` never reaches the loop at all. So Knex is never
   * again in a position to silently discard a group.
   *
   * # Zero-operator field constraints (#5240)
   *
   * `{ field: {} }` is REFUSED by that same reduction walk, in every position.
   * It used to be this method's last remaining way to emit nothing for a key
   * that looked like a predicate — so it read as TRUE here while the top-level
   * `applyFilters` path refused it and the two JS backends answered FALSE. One
   * declared shape, three answers; see {@link emptyFieldConstraintError}.
   *
   * # NULL-safe negation (#5146 `$not`, #5298 the negative operators)
   *
   * `$not` negates a predicate that {@link nullSafeNegationOperand} has first
   * made TOTAL, because SQL's `NOT UNKNOWN` is UNKNOWN and a `WHERE` drops it —
   * which used to hide every row whose compared column was NULL, while
   * `driver-memory` and `formula` returned those same rows.
   *
   * #5298 extended the same ruling to the non-negated path: `$ne`, `$nin` and
   * `$notContains` emit `(col IS NULL OR <test>)` via
   * {@link SqlDriver.applyNullSafeNegative}. A POSITIVE comparison is still
   * compiled exactly as it always was — `{ a: 1 }` is `a = 1`, `$in` is `in (…)`
   * — so nothing on the majority path changed shape.
   */
  protected applyFilterCondition(builder: Knex.QueryBuilder, condition: any, logicalOp: 'and' | 'or' = 'and', tableHint?: string | null) {
    if (!condition || typeof condition !== 'object') return;
    const table = tableHint ?? this.coercionKey(builder);

    // #5134 — shape-validate the whole tree and decide its boolean value first.
    // A malformed node throws here, before any identity is applied, so "compiled
    // to empty" can only ever mean "genuinely empty".
    const verdict = reduceFilterNode(condition as Record<string, unknown>, 'filter');
    if (verdict === 'true') return;
    if (verdict === 'false') {
      this.applyFalseConstant(builder, logicalOp);
      return;
    }

    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        // #5134 — an all-TRUE `$and` (including `$and: []`) IS the AND identity;
        // emitting nothing for it is now a decision, not an accident. A FALSE
        // member cannot reach here: it would have made the node FALSE above.
        if (reduceFilterKey(key, value, 'filter') === 'true') continue;
        const branches = value.filter(
          (sub) => reduceFilterNode(sub as Record<string, unknown>, 'filter') === 'clause',
        );
        // Attach this group to the parent the way `logicalOp` asks, matching
        // `$or`/`$not` below. Nothing passes 'or' today (the sole caller uses
        // 'and' and no branch propagates 'or' any more), but leaving one of the
        // four combinators deaf to the flag is how the rules drift apart again.
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method]((qb: any) => {
          for (const sub of branches) {
            qb.where((subQb: any) => {
              this.applyFilterCondition(subQb, sub, 'and', table);
            });
          }
        });
      } else if (key === '$or' && Array.isArray(value)) {
        // #5134 — one TRUE disjunct makes the whole `$or` TRUE, so `{$or:[{a},{}]}`
        // matches every row instead of quietly compiling to just `(a = ?)`.
        if (reduceFilterKey(key, value, 'filter') === 'true') continue;
        // FALSE disjuncts are the OR identity — dropped. At least one `'clause'`
        // member survives, or the key would have been TRUE/FALSE above.
        const branches = value.filter(
          (sub) => reduceFilterNode(sub as Record<string, unknown>, 'filter') === 'clause',
        );
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method]((qb: any) => {
          for (const sub of branches) {
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
      } else if (key === '$not') {
        // Spec LOGICAL_OPERATORS declares `$not` alongside `$and`/`$or`; both
        // driver-mongodb and driver-memory implement it, and CEL `!expr` in a
        // permission/scope rule compiles to `{ $not: {...} }` (cel-to-filter.ts).
        // Without this branch `$not` fell through to the field handler, was
        // treated as a column named "$not", and produced wrong SQL — the same
        // class of silent filter-bypass this fix (issue #2704) closes.
        //
        // #5134 — `$not` of a FALSE group is TRUE: skip it. `$not` of a TRUE
        // group is FALSE and never reaches here (the node reduced to FALSE), and
        // a non-node operand was refused by the reduction, so `value` is a node.
        if (reduceFilterKey(key, value, 'filter') === 'true') continue;
        // #5146 — negate a TOTAL predicate, so a row whose column is NULL gets
        // the same answer here as it does in driver-memory / formula instead of
        // vanishing into SQL's UNKNOWN. See {@link nullSafeNegationOperand} for
        // why the guard sits on each leaf rather than beside the `NOT`, and why
        // its direction is per operator. The reduction above ran on the ORIGINAL
        // operand; the rewrite preserves every verdict (each guarded conjunct
        // still carries a field key, so a `'clause'` stays a `'clause'`).
        const negated = nullSafeNegationOperand(value as Record<string, unknown>);
        const notMethod = logicalOp === 'or' ? 'orWhereNot' : 'whereNot';
        (builder as any)[notMethod]((qb: any) => {
          this.applyFilterCondition(qb, negated, 'and', table);
        });
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const localField = this.mapSortField(key);
        const field = this.remoteColumn(table, key, localField);
        // Non-null only for a SQLite `Field.datetime`, whose two stored forms
        // (INTEGER epoch / ISO TEXT) must be unified before comparing (#3912).
        const columnExpr = this.filterColumnExpr(table, localField, field);
        for (const [rawOp, opValue] of Object.entries(value as Record<string, any>)) {
          const method = logicalOp === 'or' ? 'orWhere' : 'where';
          // #5041 — reject a comparand that cannot become a bind parameter
          // BEFORE any rewrite or coercion touches it, so the message names the
          // shape the caller actually sent.
          assertCompilableComparand(field, rawOp, opValue);
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
              // UNCHANGED by #5298: `IS NOT NULL` is already total, and both
              // sides of the ruling agree a row with no value does NOT have
              // "any value". Only the value COMPARISON below becomes NULL-safe.
              //
              // [#6050] The test was `coerced == null` — LOOSE, so it also
              // caught `undefined`, while the two polarity tables that must
              // pin THIS emitter's spelling (`operatorIsNullTotal`,
              // `nullValueSatisfiesOperator`) read `=== null`. That split was
              // defect B: `{ $not: { d: { $ne: undefined } } }` compiled a
              // guarded tautology and answered `[]` where remote answered
              // `['3','4']`. Now that `undefined` is refused upstream the two
              // spellings cover the same domain, and the strict one is written
              // for the reason #5347 gave when it tightened the `$null` arm:
              // a lenient test keeps compiling if the gate is ever moved, and
              // silently resumes answering for a value nobody ruled on. Note
              // `coerceFilterValue` is total (every arm returns its input on a
              // shape it cannot canonicalise), so it cannot manufacture an
              // `undefined` the gate never saw.
              if (coerced === null) (builder as any)[logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull'](field);
              else this.applyNullSafeNegative(builder, method, field, (qb) => qb.orWhere(field, '<>', coerced));
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
              // [#5298] NULL-safe: "not among this list" holds vacuously for a
              // value that is not there, which is what every JS backend answers.
              this.applyNullSafeNegative(builder, method, field, (qb) =>
                qb.orWhereNotIn(field, coerced as any[]),
              );
              break;
            }
            case '$contains':
              this.applyContainsLike(builder, method, field, opValue);
              break;
            // [#5702] The case-INSENSITIVE twin of `$contains`, and the
            // replacement `RETIRED_FILTER_OPERATORS` prescribes for `$regex`.
            // Same `applyLike` — same escaped character class, same bound
            // `ESCAPE` — with the fold applied to BOTH sides, because folding
            // only the comparand compares a folded needle against a raw column
            // and matches just the rows that were already lower-case.
            case '$icontains':
              this.applyLike(builder, method, field, opValue, 'contains', false, true);
              break;
            case '$notContains':
              // [#5298] NULL-safe: `NOT LIKE` is UNKNOWN for a NULL column, and
              // "does not contain" is true of a value that is not there.
              this.applyNullSafeNegative(builder, method, field, (qb) =>
                this.applyLike(qb, 'orWhere', field, opValue, 'contains', true),
              );
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
            //
            // [#5347] `opValue` is a boolean here — `reduceFilterKey` refused
            // anything else while validating the tree, which happens before this
            // emitter runs. The `=== false` test is therefore an exhaustive
            // two-way choice, not the "anything but false is IS NULL" rule it
            // used to be; that rule was this driver's half of a three-way split
            // across the backends. See {@link nonBooleanNullComparandError}.
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
            default: {
              // [#5702] A RETIRED spelling gets the prescription, not the
              // vocabulary list: the author who wrote `$regex` needs
              // `$icontains`, and a list of fifteen names does not say so.
              const retired = retiredFilterOperatorError(op, field, Object.keys(value as object));
              if (retired) throw retired;
              throw unsupportedFilterError(
                `Unsupported filter operator "${op}" on field "${field}". Supported operators: ` +
                  `$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $between, $contains, $notContains, ` +
                  `$startsWith, $endsWith, $icontains, $null, $exists.`,
              );
            }
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

  /**
   * [#5134] Emit the dialect FALSE constant — a predicate that matches no row.
   *
   * `1 = 0` is the spelling already used for this condition on both sides of the
   * repo: `read-scope-sql.ts` compiles an empty `$in` to it, and Knex itself
   * renders an empty `whereIn` as `1 = 0`. It is valid on every dialect this
   * driver targets (unlike a bare `FALSE`, which MySQL accepts but older SQL
   * Server does not), needs no bindings, and keeps the query a normal SELECT so
   * `LIMIT`/`ORDER BY`/aggregates all still behave.
   */
  private applyFalseConstant(builder: any, logicalOp: 'and' | 'or'): void {
    builder[logicalOp === 'or' ? 'orWhereRaw' : 'whereRaw']('1 = 0');
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
    query: DriverQuery,
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

  /**
   * How a declared aggregation lowers into SQL, or a refusal that says which
   * KIND of "no" this is (#5907).
   *
   * The `switch` this replaced answered both conditions with one bare `Error`
   * carrying no `code` and no `status`, so `mapDataError` fell to its default
   * branch and a caller's `median` typo arrived as an opaque 500 — the #1116 /
   * #1117 gap, at the aggregate door. The lowering table is now the single
   * source of what this face compiles, and {@link refuseAggregateFunction}
   * decides between the two refusals.
   *
   * [#6409] Returns the {@link SqlAggregateLowering} RECORD rather than the bare
   * SQL function name it used to. `count_distinct` lowers to
   * `COUNT(DISTINCT x)` — a keyword inside the argument list, not a different
   * function name — so a caller of this method needs both halves to emit the
   * call. Every entry answering `{ sql, distinct: false }` compiles to exactly
   * the text the previous `string` return produced.
   */
  protected mapAggregateFunc(func: string): SqlAggregateLowering {
    const lowering = SQL_AGGREGATE_FUNCTIONS.get(func);
    if (lowering !== undefined) return lowering;
    refuseAggregateFunction(func);
  }

  // ── Window function builder ─────────────────────────────────────────────────

  protected buildWindowFunction(spec: SqlWindowFunctionSpec): string {
    const func = spec.function.toUpperCase();
    let sql = `${func}()`;

    const overParts: string[] = [];

    if (spec.partitionBy && Array.isArray(spec.partitionBy) && spec.partitionBy.length > 0) {
      const partitionFields = spec.partitionBy.map((f: string) => this.mapSortField(f)).join(', ');
      overParts.push(`PARTITION BY ${partitionFields}`);
    }

    if (spec.orderBy && Array.isArray(spec.orderBy) && spec.orderBy.length > 0) {
      const orderFields = spec.orderBy
        .map((s) => {
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
