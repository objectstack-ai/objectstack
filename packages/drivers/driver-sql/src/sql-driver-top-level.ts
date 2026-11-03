// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29520 codemod] The top-level declarations ahead of `SqlDriver` in
// `sql-driver.ts` that moved out whole by
// `scripts/codemod-split-sql-driver.mjs` (lever (b) of ruling 6591753301).
//
// A MOVE, not a redesign: each declaration below is its `sql-driver.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF:
// it imports neither `sql-driver.ts` nor any `sql-driver-*` module, so it is
// evaluated before the class and forms no cycle with it. `sql-driver.ts`
// re-exports, by name, every declaration here it exported before, so every
// importer of `./sql-driver.js` reads what it read.

import { AggregationFunction, NUMERIC_VALUE_TYPES, isAcceptedFilterComparand, isMultiValueField, isNowDefaultToken } from '@objectstack/spec/data';
import type { SchemaMode, FilterVerdict as SharedFilterVerdict, ValueShapeFieldDef } from '@objectstack/spec/data';
import type { DriverQuery, IntrospectedColumn as SpecIntrospectedColumn, IntrospectedSchema as SpecIntrospectedSchema, IntrospectedTable as SpecIntrospectedTable } from '@objectstack/spec/contracts';
import { temporalStorageForm } from '@objectstack/core';
import { StandardErrorCode } from '@objectstack/spec/api';
import type { PhysicalIndex } from './schema-drift.js';
import { probeAbsentSqliteDatabaseFile } from './sqlite-database-file.js';
import type { Knex } from 'knex';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * [#20768] The async scope of a driver's own PRE-DDL question: the ADR-0104
 * media-arm resolver that {@link SqlDriver.resolveFileColumnsMoved} asks at the
 * start of the first `initObjects`, before this driver has created any table.
 *
 * The resolver the engine supplies answers by reading `sys_migration`. On the
 * first boot of a new database that table does not exist yet, because this
 * very schema pass is what creates it. The backend refuses the read, and the
 * resolver answers "not moved", which is the correct answer for a store with
 * no columns. So the refusal is the ordinary state of a new database, and not
 * a `DATABASE_ERROR` to put in front of an operator.
 *
 * Two questions read through this scope — that one, and the ADR-0131 D1
 * certification {@link SqlDriver.isTenantKeyCertified} asks of the same
 * ledger — and only {@link SqlDriver.backendStatementFault} consults it. ⛔ It demotes one class,
 * a missing table, recognised by the shared `isMissingTableError`. Any other
 * refusal inside the scope still warns, and so does a missing table outside it.
 *
 * Module-level rather than per instance: the read the question issues goes to
 * whichever driver serves the ledger. On a multi-datasource composition that
 * can be another instance of this class, and it is in the same async chain.
 */
export const PRE_DDL_QUESTION_SCOPE = new AsyncLocalStorage<true>();

/**
 * [ADR-0131 D1] The `WHERE` of a unique key's duplicate probe: every plain key
 * part NOT NULL, so the probe groups only the rows the index constrains (SQL
 * UNIQUE is NULL-distinct). Empty when every part is NULL-safe. The Turso
 * remote face spells the same clause with its own identifier quoting.
 */
function uniqueProbeNotNullClause(
  columns: readonly string[],
  nullSafe: ReadonlySet<string>,
  quote: (identifier: string) => string,
): string {
  const plain = columns.filter((c) => !nullSafe.has(c));
  return plain.length === 0 ? '' : ` WHERE ${plain.map((c) => `${quote(c)} IS NOT NULL`).join(' AND ')}`;
}

/**
 * Default ID length for auto-generated IDs.
 */
const DEFAULT_ID_LENGTH = 16;

/**
 * [#21385] What every refusal line in this file knows about the dialect text it
 * logs: a statement THIS driver sent raised it, so a statement may lead that
 * text whatever word it opens with. The shared cut then runs without asking the
 * leak predicate, exactly as it does at the engine's raw-statement door.
 */
export const OWN_STATEMENT_FAULT = { statementSent: true } as const;

// ── Raw index DDL the driver executes on the framework's behalf (#4884) ──────
/** An SQL identifier in any dialect's quoting, or bare. */
const SQL_IDENTIFIER = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_$]*)';
/** Cheap prefilter so ordinary `execute()` traffic never touches the parsers below. */
export const INDEX_DDL_PREFIX = /^\s*(?:create|drop)\s+(?:unique\s+)?index\b/i;
export const CREATE_INDEX_DDL = new RegExp(
  `^\\s*create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?` +
    `(${SQL_IDENTIFIER})\\s+on\\s+(${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})?)`,
  'i',
);
export const DROP_INDEX_DDL = new RegExp(
  `^\\s*drop\\s+index\\s+(?:concurrently\\s+)?(?:if\\s+exists\\s+)?` +
    `(${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})?)`,
  'i',
);

/** Peel one layer of `"…"` / `` `…` `` / `[…]` quoting off an identifier. */
export function unquoteSqlIdentifier(raw: string): string {
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
export function lastIdentifierSegment(raw: string): string {
  const parts = raw.match(new RegExp(SQL_IDENTIFIER, 'g'));
  return unquoteSqlIdentifier(parts && parts.length > 0 ? parts[parts.length - 1] : raw);
}

/**
 * Internal table that persists per-(object, tenant, field) auto-number
 * counters so sequences are monotonic, tenant-isolated, and resilient to
 * concurrent writers. Lazily created on first autonumber-bearing insert.
 */
export const SEQUENCES_TABLE = '_objectstack_sequences';

/**
 * How many times `create()` will re-seed a stale autonumber counter and retry
 * a refused INSERT before giving the unique violation back to the caller
 * (#5495).
 *
 * One is enough for the defect this bounds: a re-seed jumps the counter to the
 * observed MAX in a single step, so the whole "one-time storm per database"
 * collapses to one retry no matter how far behind the counter had fallen. The
 * remaining budget is for concurrent writers taking the re-seeded number
 * between our scan and our INSERT, which is a per-attempt race rather than a
 * standing condition. The bound is what keeps a genuinely un-satisfiable insert
 * from looping: at exhaustion the original error is rethrown unchanged.
 */
const AUTONUMBER_COLLISION_RETRIES = 3;

/**
 * One autonumber value this driver generated for a row it is about to insert
 * (#5495) — the field, the value, and the coordinates under which that value's
 * counter would be re-seeded.
 *
 * Its reason for existing is the distinction between "a number this driver
 * handed out" and "a value the caller typed": only the former may be
 * regenerated after a unique violation, and only the latter's 409 belongs to
 * the client.
 */
export interface AutoNumberReservation {
  /** The `auto_number` field on the object. */
  field: string;
  /** Physical table the value lives in (external objects map away from the object name). */
  tableName: string;
  /** Full rendered prefix — the LIKE anchor the re-seed scan uses. */
  prefix: string;
  /** Rendered counter scope (date/`{field}` tokens); `''` for a fixed-prefix format. */
  scope: string;
  /** Rendered text after the counter slot (#6468). */
  suffix: string;
  /** Tenant column for this object, or `null` when it has none. */
  tenantField: string | null;
  /** Tenant this row belongs to, or `null` for the global counter. */
  tenantId: string | null;
  /** The rendered value written onto the row. */
  value: string;
}

/**
 * Field types whose value is a numeric scalar. SINGLE SOURCE for the DDL
 * column-type switch (these map to INTEGER/REAL columns) and the read-side
 * coercion registry (`numericFields`).
 *
 * ⚠️ [#16318] The read coercion no longer reads this whole set on every
 * dialect. The three ALIASES below are how an external, introspected column
 * reaches the driver, and on PostgreSQL a `bigint` arrives as a STRING; the
 * server-dialect arm therefore reads {@link SqlDriver.numericValueFields}, the
 * authorable `NUMERIC_VALUE_TYPES` half, and SQLite keeps this full set for the
 * legacy TEXT-affinity repair described below. The DDL switch is unchanged.
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
export const NUMERIC_SCALAR_TYPES = new Set<string>([
  // Spec numeric value class (ADR-0104 D1) + driver-internal SQL aliases.
  ...NUMERIC_VALUE_TYPES,
  'integer', 'int', 'float',
]);

// [#20387, #21042] Whether a column holds FRACTIONS — the exact-decimal members
// of `NUMERIC_COLUMN_REPRESENTATION` and this driver's `float` alias — is the
// `'fractional'` class of `aggregandColumnClass` (`@objectstack/core`), the one
// predicate the analytics native-SQL face asks too. Read into
// {@link SqlDriver.fractionalNumericFields}.

/**
 * The builtin audit-timestamp columns every managed object carries. They are
 * stamped to a single canonical instant format on SQLite (see
 * `stampInsertTimestamps`/`update`) and presented on read — on EVERY dialect —
 * as that same canonical instant text by {@link presentAuditTimestampOutput}
 * ([ADR-0053 D-F1], #13973).
 */
export const AUDIT_TIMESTAMP_COLUMNS = ['created_at', 'updated_at'] as const;

/**
 * [#21241] The fractional-seconds precision of every MySQL `DATETIME` column
 * this driver creates, and therefore of every server-clock expression that
 * defaults or stamps one. `DATETIME(3)` keeps the canonical instant's
 * milliseconds (#3942).
 *
 * ONE source, read by every site that spells it: the declared `Field.datetime`
 * column ({@link SqlDriver.createColumn}), the builtin audit columns
 * ({@link SqlDriver.createAuditTimestampColumn}), the `NOW()` column default
 * ({@link SqlDriver.nowColumnDefault}), the UPDATE stamp
 * ({@link SqlDriver.updatedAtStamp}) and the legacy `TIMESTAMP` widening
 * ({@link SqlDriver.migrateMysqlDatetimeColumns}).
 *
 * A column and its default cannot disagree, and that is not a style point:
 * MySQL refuses a `CURRENT_TIMESTAMP` default whose precision differs from its
 * `DATETIME` column's (`ER_INVALID_DEFAULT`, "Invalid default value for …"),
 * so the whole `CREATE TABLE` fails. The audit columns carried `now(3)` beside
 * their `DATETIME(3)` as a second literal, and the declared-field default fell
 * through to a bare `knex.fn.now()` beside the same `DATETIME(3)` column.
 * Measured on MySQL 8.0.46: every table declaring a `defaultValue: 'NOW()'`
 * datetime field (`sys_activity.timestamp`, `sys_presence.last_seen`) was
 * never created, and its data door answered `500`.
 */
export const MYSQL_DATETIME_PRECISION = 3;

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
 * Fold a client library's `Date` — what node-pg materialises a `timestamptz`
 * as and what mysql2 materialises a `DATETIME(3)` as — into the canonical
 * instant text, `YYYY-MM-DDTHH:MM:SS.sssZ`.
 *
 * Total in the sense #14078 ruled for the shared consumer spelling: the ONE
 * `Date` shape `toISOString()` refuses — an Invalid `Date`, whose time value
 * is `NaN` — is handed back UNCHANGED rather than thrown on. Both live
 * dialects are measured to produce it from rows that are already on disk (a
 * MySQL zero `DATETIME`; a Postgres year past 275760, inside the server's
 * range and outside JS's — `sql-driver-14078-invalid-date-materialisation.test.ts`),
 * and it has no canonical text to fold to. It is neither nulled (that erases a
 * stored value silently) nor spelled as the text `Invalid Date` (that would
 * change the wire, where `JSON.stringify` already serialises it as `null`); it
 * leaves as the client's `Date`, which is exactly the shape the ruled-B
 * consumer arms (`canonicalIsoInstant` and kin) already absorb.
 * [ADR-0053 D-F3].
 */
function isoFromValidDate(value: Date): unknown {
  return Number.isNaN(value.getTime()) ? value : value.toISOString();
}

/**
 * What a record read door hands out for a builtin audit timestamp, on every
 * dialect ([ADR-0053 D-F1], #13973): the canonical instant text.
 *
 * Two arms, one per shape the dialects actually produce. A `Date` — the
 * client-level materialisation on Postgres (`timestamptz`) and MySQL
 * (`DATETIME(3)`), which the driver deliberately does NOT alter at the client
 * parser ([ADR-0053 D-F2]; see {@link SqlDriver.withPostgresCalendarDayAsText})
 * — is folded by {@link isoFromValidDate}. A string — SQLite's TEXT, canonical
 * post-ADR-0074 or a legacy zone-naive `CURRENT_TIMESTAMP` — takes ADR-0074's
 * {@link repairNaiveUtcAuditTimestamp}, which is idempotent on the canonical
 * form. Every other shape passes through untouched, exactly as before.
 *
 * Before #13973 the string arm ran inside `if (this.isSqlite)` and the `Date`
 * arm did not exist, so the two live dialects handed the client's `Date`
 * through the read door — the divergence the #13973 census measured eight
 * consumers to be wrong under (#13382 in production, #13993–#13999 by reading),
 * every one in the direction "expected the text, received a `Date`".
 */
function presentAuditTimestampOutput(value: unknown): unknown {
  if (value instanceof Date) return isoFromValidDate(value);
  return repairNaiveUtcAuditTimestamp(value);
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
export const isNowDefaultValue = isNowDefaultToken;

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
 *
 * Runs on EVERY dialect since #13973 ([ADR-0053 D-F1]): the name records the
 * storage forms it was written to fold (SQLite's INTEGER epoch and naive TEXT),
 * not where it runs. Postgres and MySQL store a real `timestamptz` /
 * `DATETIME(3)` and never carry the mixed-storage ambiguity, but their client
 * libraries hand the column back as a JS `Date`, and that `Date` used to leave
 * the read door as-is — the SQLite-gated fold was the whole of the dialect
 * divergence the #13973 census measured. The `Date` arm below is the one those
 * two dialects take, and the client parser stays untouched ([ADR-0053 D-F2]).
 */
function normalizeSqliteDatetimeOutput(value: unknown): unknown {
  if (value == null) return value;
  // INTEGER/REAL epoch milliseconds — what better-sqlite3 binds a JS `Date` to.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // The client-level materialisation on Postgres and MySQL (never what
  // better-sqlite3 returns): fold it to the canonical text, an Invalid `Date`
  // passing through — see `isoFromValidDate` for why that is the total arm.
  if (value instanceof Date) return isoFromValidDate(value);
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
  // [#20176] The rule is `@objectstack/core`'s — the same function
  // `driver-memory` and the engine's per-aggregation `filter` / `having` read.
  // This body was a word-for-word copy of it until the rule was lifted there.
  return temporalStorageForm(value, 'datetime');
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
export function mysqlDatetimeLiteral(canonical: unknown): unknown {
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
  // [#20176] The rule is `@objectstack/core`'s — see {@link canonicalUtcDatetime}.
  // A value that is not a bare time-of-day is read as an instant by the
  // `datetime` rule there and keeps its UTC time-of-day, as it did here.
  return temporalStorageForm(value, 'time');
}

/**
 * How many times {@link SqlDriver.sqliteCanonicalTimeSql} spells its column
 * reference — the binding count a caller must supply per use of the expression.
 * (1 `typeof` + 3 per `strftime` CASE branch pair × 2 + 1 `coalesce` fallback.)
 */
export const SQLITE_TIME_EXPR_REFS = 8;

/**
 * How many times {@link SqlDriver.sqliteNonTemporalTextSql} spells its column
 * reference — the binding count a caller must supply per use of the predicate.
 * (1 `typeof` + 2 `instr` + 1 `julianday`.)
 */
export const SQLITE_NON_TEMPORAL_TEXT_REFS = 4;

/**
 * [#8790] Does this dialect error say the statement named a column the backend
 * could not resolve?
 *
 * ONE spelling of the question, read by both halves that have to answer it —
 * {@link SqlDriver.findRows}' recovery ladder and {@link SqlDriver.count}. It
 * used to be an inline predicate inside `findRows` alone, which is exactly how
 * one condition ended up with two behaviours: `find()` swallowed it into `[]`
 * and `count()`, having no copy of the test, threw the dialect's own error.
 *
 * REACH — all three dialects this driver speaks: SQLite (`no such column: x`),
 * Postgres (`column "x" does not exist`) and, since #8926, MySQL
 * (`Unknown column 'x' in 'where clause'` / `'field list'` / `'order clause'`
 * — `ER_BAD_FIELD_ERROR` spells every clause position with one sentence).
 *
 * [#8926, maintainer ruling 2026-08-16] The MySQL arm is the late one, and it
 * was ruled rather than assumed, because this predicate serves both consumers
 * at once and widening it therefore moves the accept set in BOTH directions in
 * one line: MySQL gains the #8790 refusal envelope (`INVALID_FILTER` / 400
 * naming the column, the dialect message with its inlined bound literals kept
 * to the server log — the narrowing), AND it gains the #3821 projection and
 * ORDER-BY recoveries it never had, so a query that used to throw the raw
 * dialect error now returns rows (the widening). Both halves are intended —
 * full dialect parity, one shared predicate; a split predicate (envelope
 * without recoveries) was considered and refused as a second spelling of one
 * fact. The widening is safe for the same structural reason #8790 could turn
 * the ladder's terminal into a refusal: every rung is rebuilt from
 * `buildBase()`, which unconditionally re-applies `query.where`, so a wider
 * predicate hands MySQL a recovered projection or sort but can never drop a
 * WHERE.
 */
export function isUnresolvableColumnError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  if (typeof message !== 'string') return false;
  return (
    message.includes('no such column') ||
    (message.includes('column') && message.includes('does not exist')) ||
    message.includes("Unknown column '")
  );
}

/**
 * [#16019] The raw-execution twin of {@link backendStatementFaultError}: the
 * envelope {@link SqlDriver.execute} raises when the backend refuses a
 * statement it was handed verbatim. `no such function: translate` on a SQLite
 * datasource whose analytics compiler emitted a function the dialect lacks
 * (#16028) is the measured case; every other dialect refusal on this path is
 * the same class.
 *
 * # Why this exists beside the read-exit terminal
 *
 * Every typed read exit (`find`, `count`, `aggregate`) already terminates in
 * {@link SqlDriver.backendStatementFault}, so a dialect refusal there leaves
 * the driver DECLARED — `code: DATABASE_ERROR`, `status: 500` — and the HTTP
 * doors withhold its prose by that declaration (`declaresServerFault`). The
 * raw path had no terminal at all: `execute()` awaited `knex.raw()` bare, so
 * the dialect's own error object left the driver with no `status`, a `code`
 * from the backend's vocabulary (`SQLITE_ERROR`) and knex's `<statement> -
 * <diagnostic>` message. Undeclared, it fell to `looksLikeInternalErrorLeak`
 * at the doors — a phrasing heuristic that recognises `no such column:` and
 * not `no such function:` — so whether a caller saw the engine's text was a
 * property of which limb the message happened to match, and one transport
 * over, of whether the message carried a statement prefix at all.
 *
 * Maintainer ruling 2026-09-06 (decision batch #57, option 3): the substring
 * list is not grown; the driver declares its own fault and the doors classify
 * on the declaration. This is that declaration for the raw path — the idiom
 * this file already spells at its other terminals, not a second mechanism.
 *
 * # What the envelope carries, and what it does not
 *
 * The message is COMPOSED, for the reason `backendStatementFaultError` gives:
 * there is no cut of a dialect's text that keeps its words and reliably drops
 * a caller's inlined value. No statement, no diagnostic and no function name
 * reaches the message. The dialect error travels whole under `cause`,
 * NON-ENUMERABLE — readable by cause-following predicates
 * (`isMissingTableError` still classifies a missing table on this path
 * through it), invisible to `JSON.stringify` and `{ ...err }` — and the driver
 * writes its diagnostic to the server log before composing, with the statement
 * and its bound values cut (#21385). ⛔ No `DRIVER_TARGETED_TABLE`
 * is declared here: a raw statement may reference any number of tables, and
 * naming one would make a missing JOINED table read as the caller's own — the
 * misclassification #13438 exists to prevent.
 *
 * @param cause - the dialect error, kept whole for the log and for
 *                cause-following predicates.
 */
export function rawStatementFaultError(cause: unknown): Error {
  const err = new Error(
    'The database refused to run a raw statement. The driver could not attribute the failure ' +
      'to any part of the request, so no verdict about the statement is claimed here. The ' +
      "backend's own diagnostic was written to the server log for an operator to read, with " +
      'the statement and its bound values cut.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.DATABASE_ERROR;
  err.status = 500;
  Object.defineProperty(err, 'cause', {
    value: cause,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return err;
}

/**
 * [#21227] The refusal {@link SqlDriver.readBackInsertedRows} raises when an
 * INSERT was accepted but a row it wrote is not there to be read back.
 *
 * `create` and `bulkCreate` answer the stored record (`IDataDriver.create`).
 * On a dialect whose INSERT returns no rows the driver reads what it wrote
 * back by the id it wrote, and only a row removed between the two statements
 * (a concurrent delete, a trigger) can be missing. There is then no stored
 * record to answer. Answering the caller's payload in its place would look
 * like a success while answering a row that is not stored, and would hide a
 * read-back keyed on the wrong column for good, so the door refuses instead.
 *
 * `DATABASE_ERROR` / 500, the pair this file's other terminals declare for a
 * fault the request did not cause. The message is composed and names only the
 * object the caller passed. The ids, which are the driver's own values (the
 * caller's `id` / `_id` or a minted nanoid, never a business column), travel
 * under a non-enumerable `cause` for the server log, as in
 * {@link backendStatementFaultError}.
 */
function insertedRowsNotReadBackError(object: string, missingIds: unknown[], writtenCount: number): Error {
  const err = new Error(
    `The database accepted the insert into object '${object}', but ${missingIds.length} of its ` +
      `${writtenCount} row(s) could not be read back by the id this driver wrote, so the stored ` +
      'record cannot be answered. This database returns no rows from an INSERT, so the driver ' +
      'reads each written row back by its id, and a row removed between the two statements (a ' +
      'concurrent delete or a trigger) leaves nothing to read. The write was not retried, because ' +
      're-issuing it could duplicate a row that did land.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.DATABASE_ERROR;
  err.status = 500;
  Object.defineProperty(err, 'cause', {
    value: new Error(`no row carries the written id(s) ${JSON.stringify(missingIds)} after the insert`),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return err;
}

/** [#9354] Marks the enveloped refusal below, so the flush's own catch can tell
 *  it from every other failure without re-running the recognizer on a wrapper. */
export const LOCK_WAIT_REFUSAL = Symbol.for('objectstack.driver-sql.deferredDdlLockWaitRefusal');

/** [#9354] True only for the refusal {@link deferredDdlLockWaitError} built. */
function isDeferredDdlLockWaitRefusal(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as Record<symbol, unknown>)[LOCK_WAIT_REFUSAL]);
}

/**
 * [#7929] The full, operand-naming text of a refusal whose caller-visible
 * message was redacted — carried on the Error under a SYMBOL key.
 *
 * A symbol rather than a string property because the carrier must not travel:
 * `JSON.stringify(err)`, `{ ...err }`, `Object.keys`, `for…in` and the
 * structured-clone boundary all skip symbol keys, so an error mapper that
 * spreads or serialises the error cannot put the text back on the wire — which
 * is the one way this redaction could be undone without anyone editing it.
 * `Symbol.for` (the global registry) rather than a module-local symbol so a
 * duplicated copy of this package still resolves the same key.
 */
const WITHHELD_FILTER_DIAGNOSTIC = Symbol.for('objectstack.driver-sql.withheldFilterDiagnostic');

/**
 * [#7929] Set on an error once its diagnostic has been written to the log, so
 * the seam can be applied at more than one frame without the operator reading
 * one refusal twice. Needed because knex invokes a WHERE-group callback lazily,
 * which puts nested refusals outside the filter entry point's `catch` — see
 * {@link SqlDriver.withWithheldFilterLog}.
 */
const WITHHELD_FILTER_LOGGED = Symbol.for('objectstack.driver-sql.withheldFilterLogged');

/**
 * [#8220] The filter subtree the refusal was raised FROM — the reference the
 * throw site held — so {@link SqlDriver.resolveWithheldFilterRefusal} can ask
 * the spec's provenance resolver where that node sits under the query's own
 * `where` root. A symbol for the same non-travel reason as the diagnostic:
 * nothing that serialises or spreads the error can carry a live tree reference
 * to a place that could misread it.
 */
const WITHHELD_FILTER_SUBTREE = Symbol.for('objectstack.driver-sql.withheldFilterSubtree');

/**
 * [#8220] The full author-facing message of a refusal whose subtree turns out
 * to be positively marked `'author'` — the diagnostic plus the repair
 * prescription the redacted message states only generically. Kept beside the
 * diagnostic rather than derived from it at resolution time so each builder
 * owns ONE composition of its own wording, redacted and restored alike.
 */
const WITHHELD_FILTER_AUTHOR_TEXT = Symbol.for('objectstack.driver-sql.withheldFilterAuthorText');

/**
 * [#7929] The withheld diagnostic carried by `err`, or `null` for any other
 * error. The read half of {@link withheldFilterError} — used by
 * {@link SqlDriver.logWithheldFilterDiagnostic} to write the text to the
 * server log, and exported so a host that maps driver errors itself can do the
 * same rather than re-deriving the seam.
 */
export function withheldFilterDiagnosticOf(err: unknown): string | null {
  if (err === null || (typeof err !== 'object' && typeof err !== 'function')) return null;
  const text = (err as Record<symbol, unknown>)[WITHHELD_FILTER_DIAGNOSTIC];
  return typeof text === 'string' ? text : null;
}

/**
 * [#8197, maintainer ruling 2026-08-15] The node a TARGET-FIELD refusal hands
 * {@link SqlDriver.resolveWithheldFilterRefusal} — and the one place this
 * family's shape is written down.
 *
 * # The family, and why it is exactly these five
 *
 * #7929/B withheld the cross-field operands; this card measured what B did not
 * reach. Five refusals in this file name the constraint's TARGET column, and
 * every one of them is raised by a predicate an RLS rule can plausibly produce:
 * {@link jsonColumnOperatorError} (the #7398 gate — a CEL permission rule over a
 * `multiple: true` field lowers to a membership test on a JSON-stored column,
 * the most reachable of the five), {@link emptyFieldConstraintError},
 * {@link unbindableComparandError} (which also answers a MALFORMED `{ $field }`
 * — one that is not a `FieldReferenceSchema`, so the cross-field arm does not
 * recognise it) and {@link betweenArityError}. On such a predicate the target
 * column is as administrator-authored as the referent B already withholds, which
 * is the argument the ruling accepted.
 *
 * # What redaction takes, and why it is more than the field name
 *
 * Everything DERIVED FROM THE PREDICATE: the target field, the operator, the
 * comparand's contents, the filter path and any list index. What stays is the
 * refusal's IDENTITY (`INVALID_FILTER` / 400), WHICH class fired, and the
 * capability statement and prescription — none of which is derived from what the
 * caller or the administrator wrote. That is #7929's own line, applied
 * unchanged: it withheld both operands because "echoing the target would leave
 * half the disclosure live", and a comparand preview (`received an object
 * ({"a":1})`) is the administrator's literal just as surely as a column name is.
 * ⛔ Do not soften this into "field name only" — one file must not carry two
 * redaction disciplines.
 *
 * # Which node, and why the fallback is safe
 *
 * The DEEPEST resolvable node wins, because
 * `resolveFilterSubtreeProvenance` reads the innermost mark on the ancestor
 * chain: handing it an ancestor when a nearer node exists would drop a mark set
 * closer to the leaf. `comparand` is that node when it is an object — the
 * reference the throw site holds, findable under the query's `where` root by
 * IDENTITY — and `enclosing` (the field-spec map, or the condition node) takes
 * over when it is not.
 *
 * The fallback cannot widen disclosure, and the reason is structural rather than
 * empirical: `markFilterSubtreeProvenance` silently no-ops on a non-object, so a
 * primitive comparand can never carry a mark of its own, and its effective
 * provenance IS its enclosing node's. The two candidates therefore differ only
 * where the deeper one has nothing to say.
 */
function refusalSubtree(comparand: unknown, enclosing: unknown): unknown {
  return comparand !== null && typeof comparand === 'object' ? comparand : enclosing;
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

// [#20335, #20889] `AGGREGATE_ANSWER_KIND` — what each declared aggregate
// function ANSWERS, and the one-double precision policy for that answer — lives
// in `@objectstack/core` (`utils/aggregate-answer.ts`), imported above with its
// `'number'` presenter, so the analytics native-SQL face presents a count or a
// total with this driver's own rule.

// [#20387, #21042] `AGGREGATE_ACCUMULATION` — what each declared aggregate
// function ACCUMULATES IN on PostgreSQL and MySQL, the arithmetic half of the
// one-double policy — lives in `@objectstack/core` (`utils/aggregate-answer.ts`)
// with its docblock, beside the boolean-aggregand cast and the column-class
// predicate both read. {@link SqlDriver.aggregate} asks them through
// `aggregandOperandSql`, so the analytics native-SQL face accumulates the same
// operand with this driver's own rule.

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
    `not a gap in this one.`,
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
 * `/data` routes `mapDataError`'s generic status passthrough spans 400-599, so
 * this declared 501 DOES survive to the wire as `501` / `NOT_IMPLEMENTED` —
 * pinned end-to-end by `rest-5xx-status-passthrough.test.ts`. This paragraph
 * read the opposite until #7402 closed #5582: the passthrough was 4xx-ONLY,
 * this was its first live producer, and the status fell to
 * `UNCLASSIFIED_FAULT`'s `500 INTERNAL_ERROR`. What that band does drop is the
 * PROSE — a 5xx body is the generic `Internal server error` — so the driver's
 * job at the throw site is unchanged: state the condition truthfully
 * (ADR-0112), which is what reaches every in-process caller and the operator
 * log.
 */
function uncompilableAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is declared but not implemented by this backend. ` +
    `Compiled here: ${[...SQL_AGGREGATE_FUNCTIONS.keys()].join(', ')}. The name is spelled ` +
    `correctly and @objectstack/spec AggregationFunction declares it — this is a capability gap ` +
    `in the backend, not a mistake in the query, which is why it answers NOT_IMPLEMENTED/501 ` +
    `rather than a 400. Aggregate with a function this backend compiles; whether the declaration ` +
    `itself should stand is ADR-0049's enforce-or-remove question.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  return err;
}

/**
 * [#10576] An aggregation entry carries a per-aggregation `filter`
 * (`AggregationNodeSchema.filter`, the contract half of #10413) and this
 * backend compiles no conditional-aggregate expression (SQL `FILTER (WHERE …)`
 * / `CASE WHEN`) for it — so it is refused rather than silently aggregating
 * the UNFILTERED rows, which is exactly the wrong-numbers defect #10413
 * measured ("won deals" counting every row). Same class and envelope as
 * {@link uncompilableAggregateFunctionError}: the query is spelled correctly
 * and the spec declares the key, so this is a capability gap in the backend
 * (NOT_IMPLEMENTED/501), not a mistake in the query (400).
 *
 * Unreachable through `engine.aggregate`, deliberately: the engine routes any
 * call whose aggregations carry a filter through its in-memory lowering
 * (`applyInMemoryAggregation`), which honours the predicate on every driver.
 * This guard is the direct-caller half of "no silent drop, anywhere" — the
 * refusal names the remedy so a direct caller knows the engine path works.
 */
function unsupportedAggregationFilterError(alias: string, backend: string): Error {
  const err = new Error(
    `Per-aggregation \`filter\` on "${alias}" is not supported by this backend (${backend}). ` +
    `The query is spelled correctly and @objectstack/spec AggregationNodeSchema declares the key — ` +
    `this backend compiles no conditional-aggregate (SQL FILTER (WHERE …) / CASE WHEN) expression ` +
    `for it, so it is refused rather than silently aggregating the UNFILTERED rows, which ` +
    `is why it answers NOT_IMPLEMENTED/501 rather than a 400. \`engine.aggregate\` lowers filtered ` +
    `aggregations in memory for every driver without native support — route the query through the ` +
    `engine, or drop the \`filter\` key.`,
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
    `the column whose values are deduplicated. Add "field" to the aggregations[] entry.`,
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
 * The window functions {@link SqlDriver.findWithWindowFunctions} compiles —
 * a CLOSED set, keyed by the lowercased name a caller may spell in any case.
 *
 * The door emits a function ARGUMENT-LESS (`FUNC() OVER (…)`, see
 * {@link SqlWindowFunctionSpec}), so the set is exactly the standard ranking
 * functions that take no argument, each one available on every dialect this
 * driver targets (PostgreSQL, MySQL 8, SQLite 3.25+). The name used to be
 * spliced into the statement verbatim; it is now looked up here and only the
 * value from this table reaches SQL, so the statement's text is never the
 * caller's.
 */
const SQL_WINDOW_FUNCTIONS: ReadonlyMap<string, string> = new Map([
  ['row_number', 'ROW_NUMBER'],
  ['rank', 'RANK'],
  ['dense_rank', 'DENSE_RANK'],
  ['percent_rank', 'PERCENT_RANK'],
  ['cume_dist', 'CUME_DIST'],
]);

/** The two `OVER (ORDER BY …)` directions, keyed by the lowercased spelling. */
const SQL_WINDOW_SORT_DIRECTIONS: ReadonlyMap<string, 'ASC' | 'DESC'> = new Map([
  ['asc', 'ASC'],
  ['desc', 'DESC'],
]);

/**
 * A `windowFunctions[]` entry this door cannot compile: an unknown function
 * name or sort direction. A malformed query (`INVALID_QUERY`, 400), the class
 * {@link undeclaredAggregateFunctionError} answers at the aggregate door.
 */
function invalidWindowFunctionQueryError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  return err;
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
    `in memory for every granularity absent from it, which is always correct.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

/**
 * [#11567] A field reached DDL carrying `reference_to` — a key `FieldSchema`
 * REFUSES — so this face refuses it too, in the spec's own words.
 *
 * ## Why the DDL seam needs a door the schema already has
 *
 * `reference` is the only relationship spelling the spec declares. ON THE
 * AUTHORING FACE `reference_to` is a REJECTED ALIAS, not a normalised one.
 * Measured on `origin/main`:
 *
 * ```
 * FieldSchema.safeParse({ name:'parent', type:'lookup', reference_to:'p' })
 *   => success:false, issue.code = `unrecognized_keys`
 *      "Unrecognized key(s) on this field: `reference_to`.
 *       Did you mean `reference_to` → `reference`?"
 * ```
 *
 * ⚠️ That verdict is the authoring face and only the authoring face — do NOT
 * read this door as "a stored `reference_to` stays verbatim forever". #13700
 * landed the `field-reference-to-alias` conversion (`toMajor: 18`,
 * `retiredFromLoadPath: true`, in `packages/spec/src/conversions/registry.ts`),
 * and its docblock already states the split this comment has to be read
 * against: the entry "covers the two paths that serve or rewrite EXISTING data
 * — stored rehydration and `os migrate meta`", where the key is NORMALISED to
 * `reference` rather than refused, while "the DDL doors above keep guarding
 * the third path (metadata handed straight to a driver, around both the gate
 * and the stored pass); they are downstream of this entry, not replaced by
 * it." This door is one of those DDL doors. Refused when authored, rewritten
 * when already at rest, refused again here — three paths, and this comment
 * speaks for the third.
 *
 * Until #11567 this driver read `reference_to` and ONLY `reference_to`, as the
 * gate on a `table.foreign(name).references('id')`. So one key had TWO doors
 * with opposite answers: the authoring door refused it, while the DDL door
 * silently honoured it and changed the PHYSICAL SCHEMA — and the silent one
 * was the one that touched the database. It was reachable only by metadata
 * that went around Zod (`registerObject` deliberately skips it, #3896), which
 * is why no authored deployment ever had these constraints: measured across
 * all 44 exported platform objects on live Postgres 16.13 and MySQL 8.0.46,
 * **zero** FOREIGN KEYs existed. The emission is retired; this is the door
 * that stays, so the driver stops disagreeing with the spec in silence.
 *
 * ## Why refuse rather than ignore
 *
 * Ignoring the key would be a THIRD answer to one question. An author who
 * wrote `reference_to` meant to point the field somewhere; a driver that drops
 * it on the floor creates a column pointing nowhere and says nothing — the
 * "dropped silently" shape #4001 closed at the schema, re-opened one layer
 * down. The refusal is stated at the DDL seam because that is the last place
 * the mistake is still cheap: before the column exists, not after rows are in
 * it.
 *
 * `VALIDATION_ERROR`/400 rather than a 500 (ADR-0112): the metadata is the
 * caller's, the condition is decided entirely by what the caller wrote, and
 * the fix is a one-word rename. A bare `throw new Error` would leave
 * `code`/`status` undefined and serve an opaque 500 through `mapDataError` for
 * a named, caller-fixable condition — the trade {@link refuseDateBucketedGroupBy}
 * records above (#6212).
 */
function refuseRejectedReferenceAlias(column: string): never {
  const err = new Error(
    `[sql-driver] field '${column}' declares \`reference_to\`, a rejected alias of \`reference\`. ` +
    `Did you mean \`reference_to\` → \`reference\`? \`reference\` is the only relationship spelling ` +
    `@objectstack/spec declares, and \`FieldSchema\` refuses this key with that same verdict ` +
    `(\`unrecognized_keys\`) — so a field still carrying it at DDL time went around the schema ` +
    `(raw \`registerObject\` skips Zod). Rename the key. The column is built from ` +
    `\`reference\`, and referential integrity is enforced by the ENGINE via \`deleteBehavior\` ` +
    `(the 409 DELETE_RESTRICTED), not by a database FOREIGN KEY: the FK DDL this ` +
    `key used to gate is retired, because it could never fire for a spec-conformant lookup in the first place.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
}

/**
 * [#16319] Has this field declared a `type` at all?
 *
 * The whole predicate the DDL emitter needs, and deliberately no more: it asks
 * PRESENCE, not membership. Membership is decided one layer up and for the whole
 * object — see {@link refuseUndeclaredFieldType}.
 */
function isDeclaredFieldType(field: { type?: unknown }): boolean {
  return typeof field.type === 'string' && field.type !== '';
}

/**
 * [#17469] Is this column MULTI-VALUED — the one question, asked of the one
 * predicate `@objectstack/spec` publishes.
 *
 * Maintainer ruling 2026-09-13 (decision batch #128 item 5, option 1′): there is
 * ONE definition of "multi-valued", `isMultiValueField`, and storage follows it.
 * Every site below used to read `field.multiple` raw, which answered `true` on
 * types the spec predicate calls single-valued — so the DDL built a JSON array
 * column, the read-side deserializer agreed with it, and a consumer shaping a
 * query from the SPEC predicate composed `=` against that column and was
 * answered 400. `FieldSchema` now refuses the flag on those types at the
 * authoring entrance, and this is the storage half of the same ruling.
 *
 * Takes the resolved `type` rather than reading `field.type`, because the
 * callers below have already applied their own resolution (`field.type ||
 * 'string'`, the driver-internal alias default) and two spellings of that
 * default is how the drift this fixes started.
 */
export function isMultiValuedColumn(type: string, field: { multiple?: unknown } | null | undefined): boolean {
  return isMultiValueField({ type, multiple: field?.multiple === true });
}

/**
 * [#20444] The declared value shape of every field that declares a `type` —
 * the {@link SqlDriver.valueShapeFields} entry for one object. Reads the RAW
 * `type`, deliberately not the `field.type || 'string'` default the column
 * registries apply: a field with no type has no row of the ruled 「is empty」
 * table, and inventing `'string'` for it here would answer `$empty` with a row
 * nobody declared.
 */
export function declaredValueShapes(fields: Record<string, unknown> | undefined): Record<string, ValueShapeFieldDef> {
  const shapes: Record<string, ValueShapeFieldDef> = {};
  for (const [name, field] of Object.entries(fields ?? {})) {
    const type = (field as { type?: unknown } | null | undefined)?.type;
    if (typeof type !== 'string' || type === '') continue;
    shapes[name] = { type, multiple: (field as { multiple?: unknown }).multiple === true };
  }
  return shapes;
}

/**
 * [#17231] ADR-0113's physical column constraint, asked once for every column
 * {@link SqlDriver.createColumn} builds.
 *
 * It exists because `createColumn` has TWO exits: the multi-value short-circuit
 * above its per-type switch, and the shared tail below it. The constraint used
 * to be read only at the tail, so `storage: { notNull: true }` on a multi-valued
 * field was silently inert on the platform's own table while BOTH
 * `os generate migration` formats emitted it — one declaration, two databases,
 * an INSERT omitting the field accepted by the platform's table and refused by
 * every generated one. One exit acquiring the constraint and the other not is
 * exactly how that happened, so the predicate is stated once here instead of
 * being spelled at each exit.
 *
 * Truthiness rather than `=== true` deliberately: that is the test the tail has
 * always applied, and this move is about WHERE the question is asked, never
 * about which values answer it.
 */
function declaresColumnNotNull(field: unknown): boolean {
  return Boolean((field as { storage?: { notNull?: boolean } } | null | undefined)?.storage?.notNull);
}

/**
 * [#16319] DDL-time defence: a field declaration with NO `type` gets no column
 * — it gets a refusal.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2): 「一个没写
 * type(或拼错)的字段 应该禁止加载」, and 「下游默认值全部改拒绝:`createColumn`
 * 的 `|| 'string'` … 一律改为响亮拒绝 … ⛔ 不再猜族;按构造它们应当不可达,拒绝是
 * 防御」.
 *
 * What it replaces is `createColumn`'s `const type = field.type || 'string'`,
 * which sized the column from `declaredVarcharLength(field)` — the declared
 * `maxLength` verbatim, knex's 255 without one — while BOTH `os generate
 * migration` formats defaulted the SAME declaration to `TEXT`. Two families from
 * one declaration: measured on live PostgreSQL 16.13, `{ maxLength: 100 }` with
 * no `type` produced `character varying(100)` here and `TEXT` there, so the
 * platform refused a 101-character value both generated tables accepted (#16319).
 *
 * ⭐ By construction this is now unreachable: `SchemaRegistry.registerObject`
 * refuses the whole object declaration, and every route into `syncSchema` —
 * boot rehydration, package and plugin manifests, programmatic registration —
 * is fronted by it. It stays as defence, and it stays LOUD, because the
 * alternative is a silent guess and reaching this line means the object was
 * handed to the driver by a path the registry does not front.
 *
 * ⚠️ PRESENCE only, and that boundary is deliberate — ⛔ do not widen it to
 * `FieldType` membership here without ruling on the cost. A NON-MEMBER `type`
 * still falls to this switch's own catch-all arm, unchanged: membership is
 * refused at the registration door for the whole object, which is where the
 * ruling put the single point of closure and what its acceptance list means by
 * 「驱动永远到不了」. Measured on this tree: 388 sites across ~100 of this
 * package's own test files declare a non-member spelling (`'string'` 361,
 * `'integer'` 17, `'auto_number'` 5, `'varchar'` 4, `'object'` 1) and drive
 * `initObjects` directly, never through the registry — and `'string'` is a
 * declared `case` arm of this very switch whose column shape differs from every
 * member's, so re-typing them is a corpus migration with column consequences,
 * not a spelling fix.
 *
 * `VALIDATION_ERROR` + 400, exactly as {@link refuseRejectedReferenceAlias} one
 * function up: a standard-catalog member, so no new code is minted and this
 * package's ledger entry is unchanged.
 */
function refuseUndeclaredFieldType(column: string): never {
  const err = new Error(
    `[sql-driver] field '${column}' declares no \`type\`, so no column is created for it. ` +
      `⛔ The driver no longer guesses a family here: it used to build \`varchar(255)\` (or the ` +
      `declared \`maxLength\`) while both \`os generate migration\` formats built \`TEXT\` from ` +
      `the same declaration, so the platform refused values the generated tables accepted, in ` +
      `both directions and silently. \`FieldSchema\` requires \`type\`, and ` +
      `\`SchemaRegistry.registerObject\` refuses the whole object declaration before any DDL runs ` +
      `— so reaching this line means the object was handed to \`syncSchema\` by a path that does ` +
      `not go through the registry. Give the field a \`FieldType\` member, or remove the field.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  throw err;
}

/*
 * [#8445 → #8567] `isUnbackedConflictTargetError` — "is this the conflict
 * target is not a key failure?" — is imported from `@objectstack/types`
 * (`unbacked-conflict-target.ts`), not written here.
 *
 * It began as a private regex on SQLite's sentence, because that was the only
 * dialect #8445's container could raise the condition on and transcribing the
 * other two from memory was ruled out as evidence. #8567 raised it on a real
 * Postgres 16.13 through this same knex path and found a second, unrelated
 * sentence — so the vocabulary is now per-dialect, which is the shape that
 * belongs beside `isUniqueViolationError` rather than inside a driver. The
 * measurements, the reason the `code` channel is unread on BOTH dialects
 * (SQLite's is generic; Postgres' `42P10` also fires for an out-of-range
 * `ORDER BY` position), and the reason MySQL has no limb at all are all
 * recorded there.
 *
 * ⚠️ Deliberately NOT `isUniqueViolationError`, which is imported one line
 * away: that predicate answers the OPPOSITE condition (a unique index exists
 * and the row violated it). Confusing the two would report a working
 * constraint as a missing one.
 */

/**
 * [#8445] A `conflictKeys` upsert whose target no unique index backs.
 *
 * # What the raw throw did
 *
 * `mapDataError` builds the response envelope from `error.code` / `error.status`.
 * With neither set it falls through to its default branch and ships the thrown
 * message as the whole body — and the message above is the STATEMENT, values
 * included: `{ "error": "insert into `plain` (...) values ('a@b.com', ...) ..." }`.
 * Unbranchable by any client, and an information leak of the statement text.
 * That fall-through is not a guess about `mapDataError`; it is the shape
 * `sql-driver-date-bucket.test.ts` already records for a `code`/`status`-less
 * driver throw.
 *
 * # Why `VALIDATION_ERROR` / 400
 *
 * Reused, deliberately, from the remote twin — the rationale is written out in
 * full at `driver-turso`'s `refuseUnbackedConflictTarget` (#8413) and is not
 * re-derived here. In one line: a client branching on why its call failed needs
 * two facts — **do not retry** (the next attempt fails identically; nothing is
 * transient, so a 5xx would invite a retry storm) and **nothing collided** (the
 * merge could not be attempted at all, which is why it is not
 * `RESOURCE_CONFLICT`/409 and not `DUPLICATE_VALUE`). `conflictKeys` is a
 * request argument that did not validate against the target, which is exactly
 * what the catalogued generic covers. `status: 400` puts the rejection on
 * `@objectstack/rest`'s expected-rejection list, so a caller's un-satisfiable
 * upsert stops being logged once per request as an unhandled SERVER fault.
 *
 * # The wording is the remote refusal's, first sentence for first sentence
 *
 * #5240 — one condition, one wording. `TursoDriver` picks its face from `url`,
 * so this condition can be answered by either compiler in one deployment, and a
 * second wording would make the answer a property of the connection string.
 * The text below is #8413's, verbatim, including the "table created before its
 * `unique` declaration was emitted as DDL" clause: that leg is not remote-only
 * — this face creates declared indexes, but it cannot create one over a table
 * that already holds duplicates (`syncDeclaredIndexes` degrades rather than
 * rewriting rows), so the same table arrives here with the same missing index.
 *
 * [#8567] One clause moved, on BOTH faces in the same commit: "and SQLite
 * refuses the statement" is now "and **the database** refuses the statement".
 * This face serves three dialects, and once recognition covers Postgres a
 * Postgres operator was being told SQLite had refused their statement — a
 * sentence naming the wrong engine, which is worse than a vague one because it
 * sends the reader to the wrong manual. #5240 still holds: one condition, one
 * wording, so `driver-turso`'s copy moved with it and #8568's cross-face parity
 * pin is what proves they moved together rather than drifting apart.
 *
 * ⚠️ The original error is kept as `cause` rather than discarded — the server's
 * own text is the ground truth an operator debugging the table wants (SQLite's
 * `ON CONFLICT clause does not match…`, Postgres' `there is no unique or
 * exclusion constraint…`), and nothing above this layer can recover it once
 * replaced. It is ASSIGNED rather than passed to the `Error` constructor,
 * matching the twin: the two-argument form needs the ES2022 `ErrorOptions`
 * overload.
 */
export function refuseUnbackedConflictTarget(object: string, mergeKeys: string[], cause: unknown): Error {
  const keys = mergeKeys.map((k) => `"${k}"`).join(', ');
  const err = new Error(
    `Cannot upsert into "${object}" on conflict keys (${keys}): no PRIMARY KEY or UNIQUE index ` +
      `backs them, so the merge target does not exist and the database refuses the statement. This is ` +
      `usually a table created before its "unique" declaration was emitted as DDL, or conflict ` +
      `keys naming columns that were never declared unique. Fix by declaring the column(s) ` +
      `"unique: true" and re-running schema sync so the unique index is created — if the table ` +
      `already holds duplicate values the index cannot be created until they are resolved, and ` +
      `this driver does not rewrite stored rows to force it. Alternatively upsert on the primary ` +
      `key by supplying "id" and omitting conflictKeys.`,
  ) as Error & { code?: string; status?: number; cause?: unknown };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  err.cause = cause;
  return err;
}

/**
 * What the upsert pre-flight tells {@link SqlDriver.upsert} once it has judged
 * the table's physical keys — a value rather than the bare `void` it returned
 * while every verdict it could reach was either "proceed" or a throw.
 *
 * `verifyIdentity` is [#8807]'s third answer: the statement may run, but the row
 * it lands on has to be checked afterwards. `rivals` and `tableName` are carried
 * so the refusal can name the keys the introspection actually read instead of
 * introspecting a second time to say the same thing.
 */
export interface ConflictTargetVerdict {
  verifyIdentity: boolean;
  rivals?: PhysicalIndex[];
  tableName?: string;
}

/**
 * [#8807] The merge landed on a row the caller never identified.
 *
 * # Why this is a different condition from both refusals above, per #5240
 *
 * {@link refuseUnbackedConflictTarget} answers *no index backs your target* and
 * {@link refuseAmbiguousConflictTarget} answers *your target is backed but
 * cannot be honoured* — both to a caller who NAMED a target, both before the
 * statement is compiled. This one answers a caller who named nothing at all
 * (or named `id`, the identity the driver itself supplies), and it can only be
 * answered AFTER the statement has run, because the question is which row the
 * server picked. Reusing either sentence would instruct an author to change a
 * `conflictKeys` argument they never wrote.
 *
 * The ruled principle it enforces (maintainer, 2026-08-15): *an `upsert` must
 * never modify a row whose identity the caller did not supply and whose conflict
 * key it did not name.*
 *
 * # Why the write is rolled back rather than reported
 *
 * "Never modify" is not satisfied by noticing afterwards. The check therefore
 * runs inside a transaction with the statement, and throwing here is what undoes
 * the wrong write — see {@link SqlDriver.upsert}. Reporting a completed
 * cross-row overwrite would leave the corruption and merely narrate it.
 *
 * # Why `VALIDATION_ERROR` / 400
 *
 * Same classifier, same answer as the two refusals above, and for the same
 * reason: this is conditional on the TABLE, not on the dialect. The identical
 * statement against the identical MySQL server is honoured the moment the table
 * stops carrying a rival UNIQUE key, so the remedy is a schema change and not
 * "wait for the backend". 400 also keeps the sentence on the wire — `rest`
 * withholds the body of any 5xx, and this message is the deliverable.
 *
 * Measured on live MySQL 8.0.46 through the same knex + `mysql2` path, `email`
 * and `tax_id` both `unique: true`, NO `conflictKeys` at all:
 *
 * ```
 * seed upsert({email:'d@b.com', tax_id:'T-9', title:'first'})  -> id=iVvD35rMk4BIayYc
 * B    upsert({email:'e@b.com', tax_id:'T-9', title:'second'}) -> RESOLVED, id=F-Fp1OGCQB-l5XRu
 *      ONE row, and it is the SEEDED one: iVvD35rMk4BIayYc, its `email` rewritten
 *      d@b.com -> e@b.com. The id the caller was handed back does not exist in the
 *      table at all.
 * ```
 */
function refuseCrossRowIdentityMerge(
  object: string,
  tableName: string,
  id: unknown,
  rivals: PhysicalIndex[],
): Error {
  const named = rivals.map((i) => `${i.name}(${i.columns.join(', ')})`).join(', ');
  const err = new Error(
    `Cannot upsert into "${object}": the merge landed on a row this call never identified. No ` +
      `conflict target was named, so the merge target is the primary key — but this backend is ` +
      `MySQL, whose only merge statement is ON DUPLICATE KEY UPDATE, and that statement carries ` +
      `no conflict target. The row did not collide on its primary key; it collided on another ` +
      `UNIQUE key on "${tableName}" — ${named} — and MySQL merged there instead, overwriting a ` +
      `DIFFERENT row than the one this call supplied. The write has been rolled back; nothing was ` +
      `changed. Fix by naming the business key you meant to merge on (pass it as conflictKeys, so ` +
      `the intent is checkable), by dropping or renaming the extra UNIQUE key(s) so the primary ` +
      `key is the only one the row can collide on, or by running this object on a dialect that ` +
      `honours the target — SQLite and PostgreSQL compile ON CONFLICT (...), which raises a ` +
      `unique violation here instead of merging.`,
  ) as Error & { code?: string; status?: number; cause?: unknown };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  // Schema identifiers plus the id this call supplied — the same payload
  // contract the two refusals above keep. The id is the driver's OWN value
  // (minted here, or the caller's `id`/`_id`), never a business column value.
  err.cause = new Error(
    `no row on "${tableName}" carries id ${JSON.stringify(id)} after the merge; UNIQUE keys that ` +
      `can absorb a primary-key-targeted merge: ${named}`,
  );
  return err;
}

/**
 * [#21185] The wire identity of an upsert refused because its conflict landed
 * on a row outside the organization the row is written under: the registered
 * `UNIQUE_VIOLATION` / 409, the answer a colliding insert gets.
 *
 * ⛔ No new code, by the ruling on #21185 (record 5934879010). From the
 * caller's organization the conflicting row does not exist — the caller cannot
 * read it — so the call IS an insert, and that insert collides on an
 * installation-wide key (the primary key, or a `unique: 'global'` column under
 * ADR-0120 D1). A dedicated answer would tell the caller something `create()`
 * does not; this one tells it exactly what `create()` already does, which is the
 * oracle ADR-0120 records as the accepted cost of a `'global'` key.
 */
const UPSERT_UNIQUE_VIOLATION_CODE = 'UNIQUE_VIOLATION';
/** @see {@link UPSERT_UNIQUE_VIOLATION_CODE} */
const UPSERT_UNIQUE_VIOLATION_STATUS = 409;

/**
 * [#21185] Build the refusal above. One constructor for both faces —
 * {@link SqlDriver.upsert} and the remote face `driver-turso` builds over it —
 * so the two cannot answer one condition with two sentences (#5240).
 *
 * The sentence is the engine's duplicate-record sentence (`DuplicateRecordError`
 * in `@objectstack/objectql`), in both of its forms: a single conflict key is
 * named, several are not. ⛔ It names no organization, no tenant column and no
 * value of the row the conflict landed on, and it carries no `cause` — there is
 * no server error to attach, and anything read off that row would be the
 * cross-organization detail the refusal exists to withhold. It does not begin
 * with a SQL verb (the importer's sanitiser replaces such messages wholesale).
 */
export function refuseUpsertConflictOutsideWrittenOrganization(object: string, mergeKeys: string[]): Error {
  const err = new Error(
    `Duplicate record refused on '${object}': ` +
      (mergeKeys.length === 1
        ? `a unique constraint on '${mergeKeys[0]}' already holds this value. `
        : 'a unique constraint already holds these values. ') +
      'No record was written.',
  ) as Error & { code?: string; status?: number };
  err.code = UPSERT_UNIQUE_VIOLATION_CODE;
  err.status = UPSERT_UNIQUE_VIOLATION_STATUS;
  return err;
}

/** [#21185] Is this the refusal above? Read off the envelope pair, which no dialect error carries. */
function isUpsertFenceRefusal(error: unknown): boolean {
  const e = error as { code?: unknown; status?: unknown } | null | undefined;
  return e?.code === UPSERT_UNIQUE_VIOLATION_CODE && e?.status === UPSERT_UNIQUE_VIOLATION_STATUS;
}

/**
 * The operator vocabulary {@link SqlDriver.applyFilterCondition}'s emitter
 * compiles, as the refusal below states it. A capability statement, not a
 * detail of the refused predicate, so it survives the redaction.
 */
const SUPPORTED_FILTER_OPERATORS_SENTENCE =
  'Supported operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $between, $contains, ' +
  '$notContains, $startsWith, $endsWith, $icontains, $like, $ilike, $null, $exists, $empty.';

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
export function fieldReferenceOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ref = (value as Record<string, unknown>).$field;
  return typeof ref === 'string' ? ref : null;
}

/**
 * [#25808] A `{ $now, addDays }` now-anchored comparand — the current instant
 * shifted by whole days, compared against a temporal column of the row
 * (`NowAnchorSchema`, `data/filter.zod.ts`; maintainer ruling 2026-10-26,
 * letter A). Recognised by SHAPE — an object carrying a `$now` key — the way
 * {@link fieldReferenceOf} recognises a reference, and for the same reason: the
 * evaluator (`@objectstack/formula`'s `resolveValue`) reads the same shape, so
 * the two paths agree on what an anchor IS and a malformed one is refused here
 * rather than bound as a literal object.
 *
 * `$now` arrives in two spellings. `true` is the AUTHORED form; the engine's
 * token resolver (`resolveFilterTokens`, `@objectstack/core`) pins it to the
 * tree's instant — the ISO string of the same `now` every `{N_days_ago}`
 * token in the tree resolved from — before any driver runs. A caller that
 * reaches this driver without that seam (a direct `find`, a permission filter
 * assembled in code) still carries `true`, and the driver reads its own clock
 * for it, as the evaluator does. Anything else is `invalid`.
 */
export type NowAnchor = { kind: 'instant'; at: Date } | { kind: 'invalid'; reason: string };

function nowAnchorOf(value: unknown): NowAnchor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return null;
  if (!('$now' in value)) return null;
  const raw = (value as Record<string, unknown>).$now;
  if (raw === true) return { kind: 'instant', at: new Date() };
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return { kind: 'instant', at: new Date(ms) };
    return { kind: 'invalid', reason: `$now ${JSON.stringify(raw)} is not an instant the resolver could have pinned` };
  }
  return {
    kind: 'invalid',
    reason: `$now must be the literal true (the resolver pins it to the current instant), not ${JSON.stringify(raw)}`,
  };
}

/**
 * [#5222] The operators whose `{ $field }` comparand compiles to a
 * column-to-column comparison — the six scalar comparisons, in the `$`-form
 * spelling the emitters read (array-triple / infix authorings are lowered to
 * these before a driver ever runs; see `parseFilterAST` and #5158).
 *
 * Deliberately NOT the whole of {@link SCALAR_COMPARAND_OPERATORS}: `like` /
 * `ilike` are in that set only for the bind gate, and a cross-field LIKE is
 * refused (see {@link crossFieldComparisonError}).
 */
const CROSS_FIELD_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
]);

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
 * malformed range. See {@link isListComparandOperator}.
 */
const SCALAR_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '=', '==', '!=', '<>', '>', '>=', '<', '<=', 'like', 'ilike',
  // [#7536] The `$`-forms of the two infix spellings already here. They are
  // SCALAR rather than {@link TEXT_PATTERN_OPERATORS} for the reason that set's
  // note gives: their comparand ARRIVES as the pattern, so nothing wraps or
  // escapes it and the question to ask of the value is "can this be bound",
  // which is this set's question.
  '$like', '$ilike',
]);

/**
 * Can this value be handed to a driver as a bound parameter at all?
 *
 * Same classification the write path applies in `formatInput` — anything that
 * is not a primitive, a `Date` or a binary buffer is a shape better-sqlite3
 * refuses outright and the other dialects mangle. (`ArrayBuffer.isView` covers
 * `Buffer`, which is a `Uint8Array`.)
 *
 * [#7872] The type membership is the shared comparand-type door's now
 * (`isAcceptedFilterComparand`, `@objectstack/spec/data`) — this list and
 * `RemoteTransport.serializeComparand`'s reached the identical six types twice
 * independently, which is the measured fact the door was ruled from, so the SET
 * is sourced there rather than duplicated here. Two driver-local extras stay,
 * each recorded: `undefined` answers TRUE only because the #6050 walk refuses
 * every undefined comparand FIRST with its purpose-written message, so this arm
 * is unreachable on the filter path and flipping it would only swap which error
 * fires for a direct caller; `ArrayBuffer.isView` is this driver's own bindable
 * (blob columns) that the engine-level door does not admit — it remains
 * reachable from direct driver calls, which is also where it was ever usable.
 */
function isBindableComparand(value: unknown): boolean {
  if (value === undefined) return true;
  return isAcceptedFilterComparand(value) || ArrayBuffer.isView(value);
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
 * `like` / `ilike` (and, since #7536, their `$like` / `$ilike` spellings) are
 * absent on purpose: they arrive already carrying a pattern and compile
 * through the scalar bind arm, which already refuses an object.
 */
const TEXT_PATTERN_OPERATORS: ReadonlySet<string> = new Set([
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
]);

/**
 * [#7536] The two operators whose comparand IS a `LIKE` pattern — the caller's
 * own wildcards, neither escaped nor wrapped.
 *
 * Kept as a named set beside {@link TEXT_PATTERN_OPERATORS} rather than folded
 * into it because the two families ask OPPOSITE things of the same string: a
 * `$contains` comparand is text that must be made literal (every `%` escaped),
 * while a `$like` comparand is a pattern that must be left alone (every `%` is
 * the caller's wildcard). Running one through the other's rule is precisely the
 * defect #7536 closes.
 */
const LIKE_PATTERN_OPERATORS: ReadonlySet<string> = new Set(['$like', '$ilike']);

/**
 * [#14079] Every operator that reads the column as TEXT — the union of
 * {@link TEXT_PATTERN_OPERATORS} and {@link LIKE_PATTERN_OPERATORS}. The two
 * families ask opposite things of their COMPARAND (the docblocks above), but
 * they ask the same thing of the COLUMN: that its stored value be a string. The
 * one place that question is answered at compile time is
 * {@link SqlDriver.applyTextOperatorOverNonTextColumn}, and this set is what
 * routes an operator there.
 */
const TEXT_OPERATORS: ReadonlySet<string> = new Set([
  ...TEXT_PATTERN_OPERATORS,
  ...LIKE_PATTERN_OPERATORS,
]);

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
  // [#7872] The six-type membership is the shared door's; `undefined` stays a
  // recorded local admission (see the paragraph above — the #6050 walk refuses
  // it first, so the arm is unreachable on the filter path).
  return value === undefined || isAcceptedFilterComparand(value);
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
export type TextMatchShape = 'contains' | 'starts' | 'ends';

/** The character bound into every `ESCAPE` clause this driver emits. */
export const LIKE_ESCAPE_CHARACTER = '\\';

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
export function isFilterNode(value: unknown): value is Record<string, unknown> {
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

/** [#5240] Is this field spec the zero-operator constraint refused above? */
function isEmptyFieldConstraint(spec: unknown): boolean {
  return isFilterNode(spec) && Object.keys(spec).length === 0;
}

/**
 * [#20020, the #8220 contract] What the two flag refusals above say when the
 * field's operator map is not positively marked `'author'`. The operator names
 * the refusal's CLASS (the `$between` precedent in {@link betweenArityError}),
 * and the declaration is the capability statement; the field, the value and
 * the filter path are the predicate's, and go to the server log.
 */
function nonBooleanFlagWithheldMessage(op: '$null' | '$exists'): string {
  return (
    `Operator "${op}" in this filter requires a boolean comparand (true or false). ` +
    `@objectstack/spec FieldOperatorsSchema declares ${op} as a boolean, and a non-boolean is ` +
    'refused rather than coerced because the backends read one in OPPOSITE directions. The ' +
    'field it was aimed at and the value it received are withheld from the message; the full ' +
    'diagnostic is in the server log.'
  );
}

/**
 * [#24707] PostgreSQL only: the session's `search_path` reaches one table name
 * in more than one schema, and {@link SqlDriver.introspectSchema} keys its
 * answer by bare name — one key cannot hold two tables.
 *
 * This used to be silent: the later table was overwritten by the earlier one
 * (`sales.customers` vanished behind `public.customers`), and nothing in the
 * answer said a table was missing. Keeping the first and logging the second
 * is not loud either — the HTTP and AI callers of the listing never see a
 * server log, so to them it is the same silent drop. The answer is a refusal
 * naming every colliding name with its schemas in `search_path` order, and
 * the remedy: one schema per connection (the datasource's `schema` setting is
 * what sets its `search_path`), or a rename. A connection that reaches one
 * schema — the default `public` deployment — can never collide, so no caller
 * that sees one schema is refused.
 *
 * `collisions` is non-empty; each entry's `schemas` has two or more members.
 */
export function postgresTableNameCollisionError(collisions: ReadonlyArray<{ table: string; schemas: string[] }>): Error {
  const list = (names: string[]) => names.map((s) => `'${s}'`).join(', ');
  const [first] = collisions;
  const err = new Error(
    `Cannot introspect this PostgreSQL connection: its search_path reaches ${collisions.length} table name(s) ` +
      `in more than one schema, for example '${first.table}' in ${list(first.schemas)}. ` +
      `Introspection keys each table by its bare name, so one key cannot hold both, and the bare name ` +
      `resolves only to '${first.schemas[0]}.${first.table}'; listing it once would hide the other ` +
      `table and its columns. Colliding: ` +
      collisions.map((c) => `'${c.table}' (${list(c.schemas)})`).join('; ') +
      `. Point the connection at one schema (the datasource's 'schema' setting sets its search_path), ` +
      `or rename one of the tables.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.RESOURCE_CONFLICT;
  err.status = 409;
  return err;
}

// ── Introspection Types ──────────────────────────────────────────────────────

/**
 * These are DERIVED from `packages/spec/src/contracts/schema-diff-service.ts`,
 * never re-declared beside it.
 *
 * They used to be a second, independent declaration that happened to describe
 * the same idea in a different vocabulary: this file spelled a column's key
 * membership `isPrimary?`, the spec spells it `primaryKey`; the spec also
 * declares `dialect` and a REQUIRED `introspectedAt` that this file's schema
 * type did not mention and `introspectSchema` therefore never emitted. `plugin.ts` hands
 * this driver's result straight to `ExternalDatasourceService`, which is typed
 * against the spec — so the consumer read a key no driver ever set and every
 * federated object drafted from a remote table silently lost its primary key.
 * Nothing was type-unsound; the two contracts simply never met a compiler.
 *
 * Maintainer ruling, 2026-08-22 (live session, 「同意所有」 item 9 =
 * 驱动侧对齐 spec 契约): `packages/spec` is the one contract and the DRIVER
 * aligns to it. Deriving rather than copying is what makes that mechanical —
 * a key added to the spec contract now fails this file's `tsc` until the
 * driver emits it, which is exactly the failure that was missing.
 *
 * The `Omit` carve-outs that used to mark two remaining divergences
 * (`defaultValue`, `indexes`) are RETIRED (#11122, maintainer ruling
 * 2026-08-23 option B): the spec now declares `defaultValue` as the raw
 * `unknown` this driver actually reports and `indexes` as optional, so both
 * keys are inherited straight from the spec contract. What this layer still
 * adds is EXTRA facts only — per-column `isUnique` / `maxLength`, per-table
 * `foreignKeys` / `primaryKeys` — never a second spelling of a spec key.
 */
export interface IntrospectedColumn extends SpecIntrospectedColumn {
  /**
   * SQL-introspection extra: the column ALONE carries a single-column unique
   * constraint — it is true iff some unique constraint covers this column and
   * nothing else.
   *
   * Membership of a COMPOSITE constraint is deliberately not represented on
   * this flag (#11202, maintainer ruling 2026-08-23 option A→B). `UNIQUE
   * (a, b)` constrains the pair, and a per-column boolean cannot say that;
   * setting it on both members would assert that each column is unique on its
   * own, which is a different — and false — claim, and one a consumer acts on
   * (`introspectedSchemaToObjects` in `@objectstack/objectql` turns this flag
   * into a drafted field's `unique: true`). A real composite surface is
   * option B and waits for demand; until it exists, an absent flag on a
   * composite member means "not single-column unique", never "no constraint".
   *
   * A PRIMARY KEY is NOT a unique constraint to this flag (#11654), on any
   * dialect and for any key type. `isUnique` means a *declared* single-column
   * UNIQUE constraint; key membership has a lossless face of its own
   * ({@link IntrospectedTable.primaryKeys} and `primaryKey` below), so
   * excluding keys keeps the two flags non-overlapping and drops no fact. Note
   * this is a statement about what KIND of constraint the flag reports, never
   * a claim that a key column admits duplicates. A key column that separately
   * carries its own single-column unique constraint is still flagged — the
   * constraint is what is being reported, not the column.
   *
   * All three dialect arms of {@link SqlDriver.introspectUniqueConstraints}
   * produce it through one predicate — see {@link singleColumnUniqueColumns}.
   */
  isUnique?: boolean;
  /**
   * SQL-introspection extra: declared maximum length for string types — raw
   * as knex `columnInfo()` reports it, which is a NUMBER on some dialects
   * and a STRING on SQLite (measured live, 2026-08-23: `"255"` for a
   * `t.string(…)` column). Consumers narrow via `typeof`, as
   * `schema-drift.ts`'s varchar differ already does.
   */
  maxLength?: number | string;
}

/**
 * No spec counterpart — foreign keys are a SQL-introspection extra.
 *
 * ## A composite key is ORDERED SIBLING ROWS, and that order is load-bearing
 *
 * This is deliberately a FLAT PER-COLUMN record with no ordinal field (#11324).
 * An N-column foreign key is N records, and the contract every arm of
 * {@link SqlDriver.introspectForeignKeys} owes is that those records arrive
 * **contiguous, in declared key order, each pairing its own child column with
 * its own parent column** — `(x, y) references p (a, b)` is exactly
 * `x -> p.a` then `y -> p.b`. That is what makes the ordinal unnecessary rather
 * than merely absent: the position in the array carries it.
 *
 * The reason it is written down here is that it was NOT true and nothing said
 * so. The Postgres arm joined child columns to parent columns with no ordinal
 * correlation and returned the N x N cartesian product — for the key above,
 * four records including the phantom `x -> p.b` and `y -> p.a`, which no
 * consumer of this flat shape can tell from the real two. Widening the record
 * with an ordinal was considered and rejected: it would have let a wrong ORDER
 * BY keep shipping wrong rows that merely *describe* their wrongness, where the
 * pairing is a fact the query itself must get right.
 */
export interface IntrospectedForeignKey {
  columnName: string;
  /**
   * The parent's BARE relation name, always — never conditionally qualified
   * (#11377). When the parent lives outside the session's resolution scope,
   * the qualification arrives as the separate {@link referencedSchema} key
   * rather than as a `"schema.table"` spelling here: a key whose spelling
   * depends on context is exactly the shape a consumer mis-parses.
   */
  referencedTable: string;
  referencedColumn: string;
  constraintName?: string;
  /**
   * The parent table's schema, PRESENT WHEN AND ONLY WHEN the parent lives
   * outside the session's own resolution scope — i.e. when the bare
   * {@link referencedTable} name is NOT the name this session would resolve
   * to that table (#11377). For an in-scope parent the key is ABSENT (never
   * `undefined`), so an answer that carries it is saying something.
   *
   * Until #11324 a cross-schema foreign key contributed zero rows on
   * Postgres, so this fact was unreachable; repairing that made the
   * constraint visible under a bare name the session's `search_path` does
   * not resolve — an answer true of the constraint and unusable as an
   * address, or worse, one that collides with a same-named table in the
   * current schema (the #11201 family). A consumer that turns
   * `referencedTable` into an object reference MUST read this key and refuse
   * to wire the bare name when it is present
   * (`convertIntrospectedSchemaToObjects` in `@objectstack/objectql` is the
   * reference consumer).
   *
   * Per dialect arm:
   * - **Postgres**: the parent's schema, filled when that schema is not in
   *   `current_schemas(false)` — the same `search_path` scoping every other
   *   statement in the session resolves bare names against (#11201).
   * - **MySQL**: filled symmetrically — the parent's database
   *   (`REFERENCED_TABLE_SCHEMA`) when it differs from the session's default
   *   database (`DATABASE()`); InnoDB permits cross-database foreign keys,
   *   and `KEY_COLUMN_USAGE` carries the parent's database on the same row
   *   the arm already reads.
   * - **SQLite**: never present — SQLite has no schemas, and a foreign key
   *   cannot cross an ATTACHed database at all, so the fact this key carries
   *   cannot exist there.
   */
  referencedSchema?: string;
}

/**
 * `indexes` is inherited from the spec contract, where it is OPTIONAL and
 * absence is meaningful (#11122): this driver does not introspect indexes,
 * so `introspectSchema` deliberately OMITS the key — `indexes: []` would
 * tell a schema differ that a table HAS none when it merely was not asked,
 * a worse answer than an absent key. Wiring the real read
 * ({@link SqlDriver.introspectIndexes} exists) is explicitly a separate
 * decision with its own `onFailure` ruling.
 */
export interface IntrospectedTable extends SpecIntrospectedTable {
  columns: IntrospectedColumn[];
  /** SQL-introspection extra: outbound foreign keys. */
  foreignKeys: IntrospectedForeignKey[];
  /** SQL-introspection extra: the table's primary-key columns, in key order. */
  primaryKeys: string[];
}

/**
 * `dialect` and `introspectedAt` are inherited from the spec contract, where
 * `introspectedAt` is REQUIRED — so `tsc` now refuses an `introspectSchema`
 * that omits them, which is the check that was missing while this type
 * declared `{ tables }` alone.
 */
export interface IntrospectedSchema extends SpecIntrospectedSchema {
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
  /**
   * Window function name, emitted argument-less and uppercased (`rank` → `RANK()`):
   * one of `row_number`, `rank`, `dense_rank`, `percent_rank`, `cume_dist`, in any
   * case. Any other name is refused with `INVALID_QUERY` (400).
   */
  function: string;
  /** Column alias the computed value is projected as. */
  alias: string;
  /** `PARTITION BY` targets, mapped through the driver's storage-name mapping. */
  partitionBy?: string[];
  /** `ORDER BY` inside the `OVER (…)` clause; `order` defaults to `asc`, and any value but `asc` / `desc` (any case) is refused. */
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
 *
 * `audit_timestamp` is the builtin `created_at` / `updated_at` rule —
 * {@link presentAuditTimestampOutput}, the presenter `formatOutput` applies to
 * those two columns — kept apart from `datetime` because the two presenters
 * differ on a number: the datetime fold turns an epoch INTEGER into ISO text,
 * the audit presenter passes it through (ADR-0074 §3), and a `find()` row
 * takes the latter ([ADR-0053 D-F1], #13973).
 */
export type ReadPresentationKind = 'datetime' | 'date' | 'time' | 'boolean' | 'number' | 'audit_timestamp';

/**
 * Journal modes the driver knows how to ask a file-backed SQLite database for.
 * See {@link SqlDriver.applySqliteJournalMode} for why `'wal'` is the default
 * and what `'delete'` is for.
 */
export type SqliteJournalMode = 'wal' | 'delete';

/**
 * What to do when a **file-backed** SQLite datasource points at a path that
 * does not exist yet (#6743).
 *
 * - `'create'` — SQLite's own behaviour, and the default: the file is brought
 *   into existence by the first statement on the connection.
 * - `'empty-in-memory'` — do NOT create it. Open an ephemeral `:memory:`
 *   database instead, which introspects as a database with zero tables — the
 *   same thing a freshly-created empty file introspects as. For a read-only
 *   caller (`os migrate plan`) the report is therefore identical while the
 *   filesystem is left untouched. Only a file that `'create'` could bring into
 *   existence counts as absent: one that can be neither opened nor created is
 *   refused, as `'create'`'s connect refuses it (#24961) — see
 *   {@link resolveSqliteAbsentFileTarget}.
 *
 * `'empty-in-memory'` is for callers that only ever READ. A caller that may
 * write MUST leave it at `'create'`: writes land in the ephemeral database and
 * are lost at disconnect. `os migrate apply` is exactly that caller — it boots
 * with `deferSchemaDdl` too, but flushes the deferred DDL after confirmation,
 * so it must keep `'create'`. Deferring the DDL and never opening the file are
 * different promises; #3917 made the first, this makes the second.
 */
export type SqliteAbsentFileMode = 'create' | 'empty-in-memory';

/**
 * Resolve the filename a SQLite connection should actually open, given the
 * declared target and the {@link SqliteAbsentFileMode} the host asked for.
 *
 * The ONE place the "does the target exist?" judgement is made (#6743). It is
 * exported so the service layer's native→wasm step-down can resolve the same
 * answer for its fallback rung rather than open-coding a second `existsSync`
 * that is free to drift — the two-places objection that ruled out doing this
 * check up in the CLI.
 *
 * Pseudo-filenames (`:memory:` and anything else `:`-prefixed) and non-file
 * dialects are already fileless, so they are returned untouched.
 *
 * ## Absent is not the same as unopenable (#24961)
 *
 * Only a file a boot that may write could bring into existence is absent. One
 * that can be neither opened nor created — a path under a regular file, a
 * directory this process may not write — is refused here with the
 * `SqliteDatabaseFileError` naming the file and the operating system's answer,
 * the refusal `SqlDriver.connect()` gives the same path on a boot that writes.
 * The judgement writes nothing: see `probeAbsentSqliteDatabaseFile`
 * (`sqlite-database-file.ts`), which also names the one shape it cannot see
 * without a write. It used to be
 * `existsSync`, which answers `false` for every path it cannot stat, so a
 * read-only boot opened an empty in-memory database over a file that cannot
 * exist and reported the datasource connected.
 *
 * @throws SqliteDatabaseFileError under `'empty-in-memory'`, for a file that
 *   can be neither opened nor created. Both callers get the same answer: the
 *   driver's constructor, and the service layer's wasm rung.
 */
export function resolveSqliteAbsentFileTarget(
  filename: string,
  mode: SqliteAbsentFileMode | undefined,
): { filename: string; openedEmptyInMemory: boolean } {
  if (mode !== 'empty-in-memory') return { filename, openedEmptyInMemory: false };
  if (typeof filename !== 'string' || filename === '' || filename.startsWith(':')) {
    return { filename, openedEmptyInMemory: false };
  }
  if (probeAbsentSqliteDatabaseFile(filename) === 'exists') return { filename, openedEmptyInMemory: false };
  return { filename: ':memory:', openedEmptyInMemory: true };
}

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
  /**
   * What to do when the **file-backed** SQLite target does not exist (#6743).
   * Defaults to `'create'` — SQLite's own behaviour, and what every existing
   * caller gets, since this option changes nothing unless it is passed.
   *
   * Ignored for `:memory:` and for non-SQLite dialects, neither of which can
   * bring a database file into existence.
   *
   * @see {@link SqliteAbsentFileMode}
   * @see {@link SqlDriver.sqliteOpenedEmptyInMemory}
   */
  sqliteAbsentFile?: SqliteAbsentFileMode;
  /**
   * Has THIS deployment completed the ADR-0104 column move for the file family
   * — the step that retypes the media columns and rewrites the values they
   * hold into the bare-id encoding (`sys_migration.columns_moved_at`)?
   *
   * ⛔ This is NOT the `adr-0104-file-references` flag and must never be wired
   * to it alone. Every creation-attested store since 17.0 — including every
   * dogfood boot — and every deployment that ran `os migrate
   * files-to-references --apply` before the column step existed carries that
   * flag AND JSON-quoted ids in a JSON column. The flag alone therefore cannot
   * key the write arm; `columns_moved_at` is the evidence that the columns
   * themselves moved, written by the same act that moves them.
   *
   * ## Absence is the JSON arm, and that is the whole safety property
   *
   * Omitted, `false`, a resolver that throws, a resolver that never runs — all
   * four answer "not moved", so the driver keeps today's JSON encoding. Every
   * row that exists in the world today lacks `columns_moved_at`, and a host
   * that has not been threaded this option at all is indistinguishable from
   * one whose deployment has not moved. That is the required direction: a
   * driver that guessed "moved" would write bare ids into a JSON column.
   *
   * A function is resolved ONCE per driver instance, at {@link
   * SqlDriver.initObjects}, and memoized — the flag lives in `sys_migration`,
   * which does not exist until schema sync has run, so it cannot be read at
   * construction time. A host outside that path (`skipSchemaSync`,
   * `registerObjectMetadata`-only) simply never resolves it and stays on the
   * JSON arm, which is again the correct fail-toward.
   *
   * ## Naming it at all — in EITHER polarity — shuts out the engine's supply
   *
   * The ordinary composition does not set this key: `ObjectQL.registerDriver`
   * hands the driver a resolver over `sys_migration.columns_moved_at` instead
   * (see {@link SqlDriver.setFileColumnsMovedResolver}). Setting it here says
   * the host knows its own storage better than the ledger does, so the engine
   * will not contradict it — and that is true of `false` as much as of `true`,
   * since a declared `false` overruled to `true` is bare ids in a JSON column.
   *
   * @see {@link SqlDriver.setFileColumnsMovedResolver}
   */
  fileColumnsMoved?: boolean | (() => boolean | Promise<boolean>);
};

// ── SQL Driver ───────────────────────────────────────────────────────────────

/**
 * SQL Driver for ObjectStack.
 *
 * Implements the IDataDriver contract via Knex.js for optimal SQL
 * generation against PostgreSQL, MySQL, SQLite and other SQL databases.
 */
/**
 * One column's contribution to MySQL's per-ROW budget over DECLARED widths
 * (#11565).
 *
 * `chars` is the `varchar(n)` width {@link SqlDriver.createColumn} emits for
 * the field; `bytes` is what the server charges for it — the payload
 * (`chars x bytesPerChar`) plus varchar's own length prefix.
 */
interface RowWidthContribution {
  name: string;
  chars: number;
  bytes: number;
}

/** The part of a better-sqlite3 `Database` that {@link reclaimBetterSqlite3} drives. */
interface BetterSqlite3Connection {
  exec(sql: string): unknown;
  pragma(source: string, options?: { simple: boolean }): unknown;
}

/**
 * The better-sqlite3 arm of `SqlDriver.reclaimSpace`: return the whole freelist,
 * and return the bytes it passes through the `-wal` sidecar too, without ever
 * waiting on another connection. Every statement runs through the binding's
 * `exec()` / `pragma()`, which step to completion. Synchronous by design:
 * nothing else runs on the connection between the chunks, so the freelist
 * only shrinks while the loop runs.
 *
 * Why chunks. In WAL mode one `PRAGMA incremental_vacuum` over a large
 * freelist is one transaction whose dirty pages outgrow the page cache, so
 * SQLite spills them into the WAL before the commit truncates them away.
 * Measured at 25,754 free pages: the database file went to 16,384 bytes and
 * the `-wal` sidecar to 94,430,432, held until the last connection closed. A
 * chunk that stays inside the page cache writes only the pages its commit
 * keeps. The chunk is a quarter of this connection's page cache — 1,000 pages
 * at better-sqlite3's default `cache_size` (-16000 KiB) and 4 KiB pages.
 * Readings with a reader pinning the WAL, so every frame written stays
 * visible: 2,000-page chunks left 883 frames, 4,000 left 3,779, and one
 * statement 22,920; with a 2 MB cache, 250-page chunks left 1,121 and
 * 1,000-page chunks 15,491.
 *
 * Why these two checkpoints. A `PASSIVE` checkpoint after each chunk moves
 * its frames into the database and lets the next chunk restart the WAL from
 * its start; it never waits. What it cannot do is shrink the sidecar, which
 * keeps its high-water size until something truncates it. So one
 * `TRUNCATE` checkpoint closes the call, under a busy timeout of 0 for that
 * one statement and the connection's own timeout put back afterwards: a
 * `TRUNCATE` checkpoint waits for other connections' readers through the
 * busy handler, and on this synchronous binding that wait blocks the whole
 * process — measured at 5,333 ms against a reader in the same process, the
 * connection's 5,000 ms timeout. When another connection is reading, the
 * `PASSIVE` checkpoints move only the frames that reader no longer needs and
 * the `TRUNCATE` one answers "busy" as a result row, not as an error: the
 * pages are off the freelist, and their bytes leave the files at a later
 * checkpoint (the next call, SQLite's own auto-checkpoint, or the last
 * connection closing). Outside WAL mode both checkpoints are no-ops.
 *
 * The loop stops when the freelist is empty or a chunk frees nothing: a file
 * whose `auto_vacuum` is still `NONE` never shrinks its freelist through
 * this statement (one full `VACUUM` adopts INCREMENTAL, see `SqlDriver.connect`).
 *
 * Module-local, like {@link formatDuplicateGroups}: `SqlDriver`'s `.d.ts`
 * carries its non-public members too, and this helper is no entry point.
 */
function reclaimBetterSqlite3(db: BetterSqlite3Connection): void {
  const scalar = (pragma: string): number => Number(db.pragma(pragma, { simple: true }));
  let free = scalar('freelist_count');
  if (free === 0) return;
  const cacheSize = scalar('cache_size');
  const cachePages = cacheSize >= 0 ? cacheSize : Math.floor((-cacheSize * 1024) / scalar('page_size'));
  const chunk = Math.max(1, Math.floor(cachePages / 4));
  for (;;) {
    db.exec(`PRAGMA incremental_vacuum(${chunk})`);
    db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    const left = scalar('freelist_count');
    if (left === 0 || left >= free) break;
    free = left;
  }
  const busyTimeout = scalar('busy_timeout');
  db.pragma('busy_timeout = 0');
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.pragma(`busy_timeout = ${busyTimeout}`);
  }
}

// [#29520 codemod] Declared above without `export`, and read by `sql-driver.ts` or a section module.
export {
  AUTONUMBER_COLLISION_RETRIES, CROSS_FIELD_COMPARISON_OPERATORS, DEFAULT_ID_LENGTH, FilterVerdict,
  LIKE_PATTERN_OPERATORS, RowWidthContribution, SCALAR_COMPARAND_OPERATORS, SQL_AGGREGATE_FUNCTIONS,
  SQL_WINDOW_FUNCTIONS, SQL_WINDOW_SORT_DIRECTIONS, SUPPORTED_FILTER_OPERATORS_SENTENCE, SqlAggregateLowering,
  TEXT_OPERATORS, TEXT_PATTERN_OPERATORS, WITHHELD_FILTER_AUTHOR_TEXT, WITHHELD_FILTER_DIAGNOSTIC,
  WITHHELD_FILTER_LOGGED, WITHHELD_FILTER_SUBTREE, canonicalTimeOfDay, canonicalUtcDatetime, declaresColumnNotNull,
  describeFilterOperand, insertedRowsNotReadBackError, invalidWindowFunctionQueryError, isBindableComparand,
  isDeclaredFieldType, isDeferredDdlLockWaitRefusal, isEmptyFieldConstraint, isRenderableTextComparand,
  isUpsertFenceRefusal, nonBooleanFlagWithheldMessage, normalizeSqliteDatetimeOutput, nowAnchorOf,
  presentAuditTimestampOutput, reclaimBetterSqlite3, refusalSubtree, refuseAggregateFunction,
  refuseCrossRowIdentityMerge, refuseDateBucketedGroupBy, refuseDistinctAggregateWithoutField,
  refuseRejectedReferenceAlias, refuseUndeclaredFieldType, safeShapePreview, uniqueProbeNotNullClause,
  unsupportedAggregationFilterError,
};
