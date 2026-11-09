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

import { ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE, AggregationFunction, MULTI_OPTION_TYPES, NUMERIC_VALUE_TYPES, RETIRED_FILTER_OPERATORS, STRUCTURED_JSON_TYPES, hasDanglingLikeEscape, hasNulInLikePattern, isAcceptedFilterComparand, isListComparandOperator, isMultiValueField, isNowDefaultToken, reduceFilterKeyVerdict, reduceFilterVerdict } from '@objectstack/spec/data';
import type { FilterVerdictHooks, SchemaMode, FilterVerdict as SharedFilterVerdict, ValueShapeFieldDef } from '@objectstack/spec/data';
import type { DriverQuery, IntrospectedColumn as SpecIntrospectedColumn, IntrospectedSchema as SpecIntrospectedSchema, IntrospectedTable as SpecIntrospectedTable } from '@objectstack/spec/contracts';
import { jsonColumnOperatorRefusalText, temporalStorageForm } from '@objectstack/core';
import type { JsonColumnFieldClass } from '@objectstack/core';
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
 * null" (#field-zoo). `composite`/`address`/`location`/`record` are objects;
 * the rest are arrays.
 *
 * ⚠️ The FILE family (`image`/`file`/`avatar`/`video`/`audio`) was a member
 * until the ADR-0104 addendum ruled that its physical column holds the BARE
 * `sys_file` id in a STRING column rather than a JSON-quoted id in a JSON
 * column. Its membership is no longer a constant: a SINGLE-VALUE media field
 * is a JSON column on a deployment that has not moved its columns and a string
 * column on one that has, so the question is asked per driver instance through
 * {@link SqlDriver.mediaColumnIsJson} rather than of this set. A
 * `multiple: true` media field is unaffected — its value is a LIST of ids, it
 * is a JSON column on every deployment, and `isMultiValueField` already says so
 * above every type check (`file` / `image` are `MULTI_CAPABLE_TYPES` members;
 * #17469 refuses `multiple: true` on `avatar` / `video` / `audio` at the
 * authoring entrance rather than arrayifying their column).
 *
 * ⛔ Do not re-add the family here. Every reader of this set treats membership
 * as deployment-independent, which is exactly what the family stopped being.
 */
export const JSON_COLUMN_TYPES = new Set<string>([
  // Spec value-shape classes (ADR-0104 D1): structured JSON payloads and the
  // inherently-array option types. Membership is owned by @objectstack/spec —
  // a type added there becomes a JSON column here without touching this file.
  ...STRUCTURED_JSON_TYPES, ...MULTI_OPTION_TYPES,
  // Driver-internal aliases (external/introspected columns) — not authorable
  // FieldTypes, so they stay a local extra.
  'object', 'array',
]);

/**
 * The `varchar(n)` width a moved single-value media column gets.
 *
 * ⚠️ NOT a taste: it is the width `os generate migration --format sql` already
 * emits for the family (`VARCHAR(2048)` in `packages/cli/src/commands/
 * generate.ts`), and the maintainer ruling in ADR-0104's 2026-09-05 addendum is that the GENERATOR
 * states the ruled end-state and does not move — the driver is the side that
 * moves to meet it. A driver that created knex's default `varchar(255)` here
 * would open a fresh divergence between the two producers of the same column
 * on the very change that closes the old one.
 *
 * Mirrored by {@link SqlDriver.varcharColumnChars}, which is what the drift
 * detector asks rather than restating the width; the two are pinned equal by
 * `sql-driver-11565-row-byte-budget.test.ts` for every declared `FieldType`.
 */
const MEDIA_ID_VARCHAR_CHARS = 2048;

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
 * part a caller can act on — stays, EXCEPT where the caller may not be its
 * author: see {@link withheldFilterError}.
 *
 * [#7929, maintainer ruling 2026-08-12] That exception is the cross-field
 * `{ $field }` family. A read scope — an administrator's CEL sharing/permission
 * rule, compiled by `compileCelToFilter` and ANDed into the query by the
 * security middleware (`plugin-security`) or by `ObjectQLStrategy.withReadScope`
 * (`service-analytics`) — reaches this compiler as a bare `FilterCondition` with
 * NOTHING marking it as policy-authored. When it is refused, the "detail a
 * caller can act on" is detail the caller never wrote: policy column names, and
 * the identity of the tenant-isolation column. Those refusals therefore keep
 * `code` and `status` and lose their operands; the full text goes to the server
 * log.
 *
 * [#8197, maintainer ruling 2026-08-15] The exception is no longer only the
 * cross-field family. The same argument reaches one step out: on a read-scope
 * predicate the refused constraint's TARGET column is as administrator-authored
 * as its referent, so the five refusals named in {@link refusalSubtree} join the
 * same seam. The paragraph above still describes every refusal in this file that
 * neither family covers.
 *
 * [#20039, the #8220 contract] On the FILTER-COMPILE path — everything
 * {@link SqlDriver.applyFilters} runs — there is no such refusal any more: the
 * class is closed. Every builder that path can throw from goes through
 * {@link withheldFilterError} with the node it was raised from, so the provenance
 * mark decides what the wire may name, and a builder added later that calls this
 * function directly instead discloses by omission. That is what
 * `sql-driver-compile-refusal-seam.test.ts` pins: it enumerates this file's
 * direct callers of this function and of {@link withheldFilterError} and holds
 * the first set to three named exceptions — the seam itself, the `'author'`
 * re-issue in {@link SqlDriver.resolveWithheldFilterRefusal}, and
 * {@link unresolvableFilterColumnError}, which is raised from a dialect error
 * AFTER the statement ran and resolves its own provenance by name
 * ({@link unresolvableColumnProvenance}) — and the second to the set its
 * behavioural table drives under all three marks.
 */
export function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

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
 * [#7929, maintainer ruling 2026-08-12, verbatim: 「接受你的全部建议。」 adopting
 * "B now, A next"] An `INVALID_FILTER` refusal that answers the caller with
 * `message` and keeps `diagnostic` — the half naming the operands — server-side.
 *
 * # Why the redaction is unconditional
 *
 * The driver cannot tell an author's filter from a policy's. Measured on both
 * merge boundaries (#7929's analytics capture, #7988's CRUD capture): the
 * predicate arrives as a bare `FilterCondition` in `where`, `DriverQuery` is
 * `Omit< QueryAST, 'object' >` and `QueryAST` has no provenance slot, and the
 * one thing that does cross (`context`) says who is asking, never which subtree
 * they did not write. A driver-side guess at provenance is precisely the shape
 * the triage lens rejected, so B withholds for EVERY caller.
 *
 * # BOTH operands are withheld, not just the `$field` one
 *
 * On a read-scope refusal the whole predicate is the administrator's: in
 * `{ amount: { $gt: { $field: 'secret_policy_column' } } }` the target `amount`
 * is as policy-authored as the referent. Echoing the target would leave half
 * the disclosure live, so the redaction takes both operands, the operator, the
 * list index and the boundary `reason` — everything derived from the predicate.
 * What stays is the refusal's IDENTITY (`INVALID_FILTER` / 400), which of the
 * three cross-field refusal classes fired, and the capability statement, none
 * of which is derived from what the caller or the administrator wrote.
 *
 * # The accepted cost, named rather than hidden
 *
 * An author debugging their OWN cross-field filter used to get the redacted
 * message too — B's accepted cost. [#8220] (A of the same ruling) is what pays
 * it back: the refusal carries the subtree it was raised from, and
 * {@link SqlDriver.resolveWithheldFilterRefusal} swaps in the full diagnostic
 * when — and ONLY when — that subtree is positively marked `'author'` by a
 * read-scope merge boundary (`markFilterSubtreeProvenance`,
 * `@objectstack/spec/data`). Unmarked or ambiguous stays exactly here, on the
 * withholding branch — the mark is permission to reveal, never a duty to prove
 * secrecy. ⛔ Do not "fix" the remaining redaction by re-adding the names
 * unconditionally, and ⛔ do not widen the REST boundary's 5xx-only withhold
 * to 4xx instead (ruled out: it would delete #5367's tiering and #5667's
 * legible-undeclared-5xx decision).
 *
 * `subtree` is the node the throw site held (the reference comparand, the
 * list member, the field-spec map). `authorText` is what an `'author'` verdict
 * puts on the wire; it defaults to `diagnostic` so no builder can end up with
 * a restored message emptier than its own server-log line.
 */
export function withheldFilterError(
  message: string,
  diagnostic: string,
  subtree?: unknown,
  authorText?: string,
): Error {
  const err = unsupportedFilterError(message);
  Object.defineProperty(err, WITHHELD_FILTER_DIAGNOSTIC, { value: diagnostic, enumerable: false });
  if (subtree !== null && typeof subtree === 'object') {
    Object.defineProperty(err, WITHHELD_FILTER_SUBTREE, { value: subtree, enumerable: false });
  }
  Object.defineProperty(err, WITHHELD_FILTER_AUTHOR_TEXT, {
    value: authorText ?? diagnostic,
    enumerable: false,
  });
  return err;
}

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
  // [#20039, the #8220 contract] The serialized array is the WHOLE predicate —
  // every field, operator and literal in it. A read scope handed to this
  // driver as the `where` root in array form would be relayed entire, so the
  // array itself is the node the seam resolves (it is the root, so its own
  // mark is its verdict), and only an `'author'`-marked one gets it back.
  return withheldFilterError(
    `A filter ARRAY reached the driver. 'where' is a FilterCondition object; the array form ` +
      `('FilterArray') is input-only authoring sugar and is lowered by @objectstack/spec ` +
      `parseFilterAST() at the engine and protocol doors before any driver sees it. This driver ` +
      `no longer carries a second compiler for it — call through ObjectQL, or lower the value ` +
      `yourself with parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no ` +
      `lowering at all: write the prefix form ["or", condA, condB]. The array's contents are ` +
      `withheld from the message; the full diagnostic is in the server log.`,
    `A filter ARRAY reached the driver: ${JSON.stringify(filters)}. ` +
      `'where' is a FilterCondition object; the array form ('FilterArray') is input-only ` +
      `authoring sugar and is lowered by @objectstack/spec parseFilterAST() at the engine ` +
      `and protocol doors before any driver sees it. This driver no longer carries a ` +
      `second compiler for it — call through ObjectQL, or lower the value yourself with ` +
      `parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no lowering at ` +
      `all: write the prefix form ["or", condA, condB].`,
    filters,
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
 *
 * [#20020, the #8220 contract] The operator, the field, the replacement and
 * the retirement note all derive from the predicate, so a refusal raised from
 * a read-scope subtree the caller never wrote keeps them in the server log;
 * `subtree` is the field's operator map, and only a positively
 * `'author'`-marked one gets the full text back. What stays on the wire is the
 * class — a RETIRED operator, not an unknown one.
 */
function retiredFilterOperatorError(
  op: string,
  field: string,
  siblings: readonly string[] = [],
  subtree?: unknown,
): Error | null {
  const guidance = RETIRED_FILTER_OPERATORS[op];
  if (!guidance) return null;
  const replacement = guidance.to ? ` Write "${guidance.to}" instead.` : '';
  const alsoRetired = siblings.filter((key) => key !== op && RETIRED_FILTER_OPERATORS[key]);
  const also = alsoRetired.length
    ? ` The same field constraint also carries the retired ` +
      `${alsoRetired.map((key) => `"${key}"`).join(', ')} — one "${guidance.to}" replaces the whole ` +
      `shape, so this is ONE mistake with ONE fix, not one per key.`
    : '';
  const full =
    `Filter operator "${op}" on field "${field}" is RETIRED and is no longer evaluated by this ` +
    `driver.${replacement} ${guidance.why}${also}`;
  return withheldFilterError(
    'A filter operator in this filter is RETIRED and is no longer evaluated by this driver. The ' +
      'operator, the field it was aimed at and the operator that replaces it are withheld from ' +
      'the message; the full diagnostic is in the server log.',
    full,
    subtree,
  );
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
 * An operator outside the emitter's vocabulary and outside the retired table.
 *
 * [#20020, the #8220 contract] The operator name and the field are the
 * predicate's, so they go to the server log unless `subtree` — the field's
 * operator map — is positively marked `'author'`. The supported vocabulary is
 * the capability statement and stays on the wire either way.
 */
function unsupportedFilterOperatorError(op: string, field: string, subtree?: unknown): Error {
  return withheldFilterError(
    `A filter operator in this filter is not one this driver evaluates. ` +
      `${SUPPORTED_FILTER_OPERATORS_SENTENCE} The operator and the field it was aimed at are ` +
      `withheld from the message; the full diagnostic is in the server log.`,
    `Unsupported filter operator "${op}" on field "${field}". ${SUPPORTED_FILTER_OPERATORS_SENTENCE}`,
    subtree,
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
function icontainsComparandError(field: string, value: unknown, path: string, subtree?: unknown): Error {
  const shown = typeof value === 'string' ? `""` : JSON.stringify(value) ?? String(value);
  // [#20039, the #8220 contract] The field, the path and the comparand are the
  // predicate's; the operator names the refusal's CLASS (one builder, one
  // operator), so it stays on the wire with the capability statement.
  return withheldFilterError(
    `Operator "$icontains" in this filter requires a NON-EMPTY string comparand. "$icontains" is a ` +
      `case-insensitive LITERAL substring search, so its comparand is the text to look for — an ` +
      `empty one matches every row (a predicate that constrains nothing), and a non-string one ` +
      `would have to be coerced into text this query never asked for. The field it was aimed at ` +
      `and the value it received are withheld from the message; the full diagnostic is in the ` +
      `server log.`,
    `Operator "$icontains" on field "${field}" at ${path} requires a NON-EMPTY string comparand, ` +
      `received ${shown}. "$icontains" is a case-insensitive LITERAL substring search, so its ` +
      `comparand is the text to look for — an empty one matches every row (a predicate that ` +
      `constrains nothing), and a non-string one would have to be coerced into text this query ` +
      `never asked for.`,
    subtree,
  );
}

/**
 * [#7536] `$like` / `$ilike` received a comparand that is not a string.
 *
 * The declared comparand is `z.string()`, and the coercion the emitter would
 * otherwise apply is worse here than at `$icontains`: a `$like` comparand is a
 * PATTERN, so `String(value)` does not merely invent text, it invents WILDCARDS
 * — `String({})` is `[object Object]`, whose `[` opens a GLOB character class
 * on the SQLite dialects. An empty string is deliberately NOT refused (see the
 * gate's own note): `LIKE ''` matches only the empty string, which constrains
 * plenty.
 */
function likePatternComparandError(
  field: string,
  op: string,
  value: unknown,
  path: string,
  subtree?: unknown,
): Error {
  // [#20039, the #8220 contract] `$like` and `$ilike` share this builder, so
  // WHICH of the two fired is the predicate's, not the class's — withheld with
  // the field, the path and the comparand, as the combinator door withholds
  // which of `$and` / `$or` it was.
  return withheldFilterError(
    `A pattern operator ("$like" / "$ilike") in this filter requires a string comparand. It takes ` +
      `a PATTERN — "%" matches any sequence, "_" matches one character, and a backslash escapes ` +
      `either — so a non-string comparand cannot be coerced without inventing wildcards the caller ` +
      `never wrote. For a literal substring search write "$contains", whose comparand IS text. ` +
      `Which operator it was, the field it was aimed at and the value it received are withheld ` +
      `from the message; the full diagnostic is in the server log.`,
    `Operator "${op}" on field "${field}" at ${path} requires a string comparand, received ` +
      `${describeFilterOperand(value)} (${safeShapePreview(value)}). "${op}" takes a PATTERN — ` +
      `"%" matches any sequence, "_" matches one character, and a backslash escapes either — so ` +
      `a non-string comparand cannot be coerced without inventing wildcards the caller never ` +
      `wrote. For a literal substring search write "$contains", whose comparand IS text.`,
    subtree,
  );
}

/**
 * [#7536] A `$like` / `$ilike` pattern ending in a lone unpaired backslash.
 *
 * Refused rather than given a meaning because no meaning survives all five
 * backends: Postgres raises `LIKE pattern must not end with escape character`
 * at query time, SQLite's GLOB has no escape character at all and would read
 * the backslash as an ordinary one, and the JS faces would have to invent a
 * third answer. A shape that cannot mean one thing everywhere is refused at the
 * door — the direction #5041 / #5234 already settled for comparands this driver
 * cannot compile faithfully. `hasDanglingLikeEscape` is the spec's shared test,
 * so every face refuses the SAME patterns.
 */
function danglingLikeEscapeError(
  field: string,
  op: string,
  pattern: string,
  path: string,
  subtree?: unknown,
): Error {
  // [#20039, the #8220 contract] The pattern is the predicate's literal, and so
  // are the field, the path and which of the two pattern operators it was.
  return withheldFilterError(
    `A pattern operator ("$like" / "$ilike") in this filter has a pattern ending in a lone unpaired ` +
      `backslash. A backslash escapes the character after it, so a trailing one escapes nothing and ` +
      `the backends disagree about what it means — Postgres rejects the pattern outright, SQLite's ` +
      `GLOB has no escape character to reject. Write "\\\\\\\\" to match a literal backslash, or drop ` +
      `the trailing one. Which operator it was, the field it was aimed at and the pattern are ` +
      `withheld from the message; the full diagnostic is in the server log.`,
    `Operator "${op}" on field "${field}" at ${path} has a pattern ending in a lone unpaired ` +
      `backslash (${JSON.stringify(pattern)}). A backslash escapes the character after it, so a ` +
      `trailing one escapes nothing and the backends disagree about what it means — Postgres ` +
      `rejects the pattern outright, SQLite's GLOB has no escape character to reject. Write ` +
      `"\\\\\\\\" to match a literal backslash, or drop the trailing one.`,
    subtree,
  );
}

/**
 * [#20041] A `$like` / `$ilike` pattern holding U+0000 (NUL).
 *
 * Refused for the reason {@link danglingLikeEscapeError} is: no meaning survives
 * every backend. This driver's SQLite arm compiles the pattern to `GLOB`, and
 * SQLite reads a pattern only up to its first U+0000, so the pattern was CUT
 * there and answered a different question than the JS faces, with nothing
 * raised. Measured on better-sqlite3, sql.js and libSQL alike: `'%'` + U+0000
 * returned every non-NULL row, where `@objectstack/formula` returns only the
 * values ending in U+0000. There is no NUL-safe SQLite pattern primitive to
 * compile to instead. `hasNulInLikePattern` is the spec's shared test, asked on
 * the same walk as the dangling escape, so every face refuses the SAME patterns
 * — on every dialect of this driver, not only SQLite.
 *
 * Asked AFTER the dangling escape, so a pattern that has both keeps the refusal
 * it already had.
 */
function nulLikePatternError(
  field: string,
  op: string,
  pattern: string,
  path: string,
  subtree?: unknown,
): Error {
  // [#20041, the #8220 contract] The pattern is the predicate's literal, and so
  // are the field, the path and which of the two pattern operators it was.
  return withheldFilterError(
    `A pattern operator ("$like" / "$ilike") in this filter has a pattern holding the NUL character ` +
      `U+0000. SQLite reads a pattern only up to its first NUL, so such a pattern would match a ` +
      `different set of rows there than on the other backends, and no escape makes the character ` +
      `portable. Remove it from the pattern. Which operator it was, the field it was aimed at and ` +
      `the pattern are withheld from the message; the full diagnostic is in the server log.`,
    `Operator "${op}" on field "${field}" at ${path} has a pattern holding the NUL character ` +
      `U+0000 (${JSON.stringify(pattern)}). SQLite reads a pattern only up to its first NUL, so ` +
      `such a pattern would match a different set of rows there than on the other backends, and ` +
      `no escape makes the character portable. Remove it from the pattern.`,
    subtree,
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
 * [#25808] A `{ $now }` anchor reached a position this driver does not compile:
 * a list member, a text pattern, the bare `{ field: { $now: true } }` spelling
 * (which reaches the operator loop as an operator named `$now`). The same
 * boundary as {@link crossFieldComparisonError}, for the same reason, with the
 * same withholding (#7929): the anchor compiles only as the WHOLE comparand of
 * one of the six scalar comparisons, where {@link SqlDriver.applyNowAnchorComparison}
 * answers it.
 */
export function nowAnchorPositionError(field: string, op: string, subtree?: unknown, index?: number): Error {
  const position = index === undefined ? '' : ` at index ${index} of its value list`;
  const diagnostic =
    `Operator "${op}" on field "${field}" compares against a now-anchored comparand ` +
    `({ "$now": true, "addDays": … })${position}, a position SQL push-down does not compile.`;
  return withheldFilterError(
    `A now-anchored comparand ({ "$now": true, "addDays": … }) in this filter sits in a position SQL ` +
      `push-down does not compile. It compiles only as the whole comparand of a scalar comparison ` +
      `operator ($eq/$ne/$gt/$gte/$lt/$lte) on a date or datetime column. Compare against a literal ` +
      `value here, or write the test as one of those comparisons. The field and the operator this ` +
      `filter used are withheld from the message; the full diagnostic is in the server log.`,
    diagnostic,
    subtree,
    `${diagnostic} It compiles only as the whole comparand of a scalar comparison operator ` +
      `($eq/$ne/$gt/$gte/$lt/$lte) on a date or datetime column.`,
  );
}

/**
 * [#5041→#5222] `{ $field }` reached a position this driver does NOT compile to
 * a column-to-column comparison.
 *
 * `FieldReferenceSchema` is declared in the spec and really is PRODUCED —
 * `compileCelToFilter` emits `{ $field: path }` for a field-to-field comparison
 * in a CEL permission/RLS rule. #5041 refused the shape everywhere (before it,
 * the reference object was handed to Knex as a BIND VALUE and sqlite answered
 * with a bare `TypeError`); #5222 narrowed that gate: the reference now
 * COMPILES when it is the whole comparand of one of the six scalar comparison
 * operators ({@link CROSS_FIELD_COMPARISON_OPERATORS} — see
 * {@link SqlDriver.applyCrossFieldComparison}). This error answers every
 * position still outside that boundary, deliberately:
 *
 * - **`$in` / `$nin` / `$between` list MEMBERS.** The memory evaluator resolves
 *   a member per record and `looseEq`s it, which SQL's `IN (…)` bind list has
 *   no slot for — compiling it would need per-member OR-expansion whose NULL
 *   and type-affinity behaviour was not proven conformance-equivalent, and an
 *   unproven push-down of a permission shape is the #3948 class. Before #5041
 *   this position did not even crash: it compiled and returned ZERO ROWS.
 * - **The string operators (`$contains` / `$startsWith` / … / `like`).** In
 *   memory the referenced value is matched as a LITERAL substring; in SQL it
 *   would become the TEXT of a LIKE pattern, so any `%` / `_` / `\` stored in
 *   the referenced column would act as WILDCARDS — the filter-bypass class
 *   `applyLike` escapes literal comparands to prevent. Escaping a column-side
 *   value portably needs a dialect REPLACE chain nobody has proven; refused.
 * - **Any other operator** (`$null`, a retired spelling, …): no cross-field
 *   reading exists to compile.
 *
 * [#7929] The operands, the operator and the list index are withheld from the
 * caller-visible half and kept in the server-log half — see
 * {@link withheldFilterError} for why, and for what stays. [#8220] `subtree`
 * is the offending node itself, so a positively author-marked filter gets the
 * naming half back.
 */
export function crossFieldComparisonError(
  field: string,
  op: string,
  ref: string,
  subtree?: unknown,
  index?: number,
): Error {
  const position = index === undefined ? '' : ` at index ${index} of its value list`;
  const diagnostic =
    `Operator "${op}" on field "${field}" compares against another field ` +
    `({ "$field": "${ref}" })${position}, a position SQL push-down does not compile.`;
  return withheldFilterError(
    `A cross-field comparison ({ "$field": … }) in this filter sits in a position SQL ` +
      `push-down does not compile. Cross-field comparison compiles only as the whole comparand ` +
      `of a scalar comparison operator ($eq/$ne/$gt/$gte/$lt/$lte) between two same-table ` +
      `declared columns. Compare against a literal value here, or evaluate the rule in memory ` +
      `(matchesFilter). The columns and the operator this filter used are withheld from the ` +
      `message; the full diagnostic is in the server log.`,
    diagnostic,
    subtree,
    `${diagnostic} Cross-field comparison compiles only as the whole comparand of a scalar ` +
      `comparison operator ($eq/$ne/$gt/$gte/$lt/$lte) between two same-table declared columns. ` +
      `Compare against a literal value here, or evaluate the rule in memory (matchesFilter).`,
  );
}

/**
 * [#5222] `{ field: { $field: 'other' } }` — a field reference used as a BARE
 * field spec, i.e. in the implicit-equality position where a literal comparand
 * would mean `field = value`.
 *
 * ## [#7597] It no longer has an AUTHORING route — and is still refused
 *
 * `parseFilterAST` used to lower the authored triple
 * `['amount', '=', { $field: 'budget' }]` (and its `==` / `equals` / `eq`
 * spellings) to exactly this shape, while `['amount', '>', …]` kept its
 * operator and lowered to `{ $gt: … }` — one authoring dialect producing both
 * a supported and an unsupported spelling of the same intent, with the
 * unsupported one silent on the path that produced it. #7597 fixed the sink:
 * an equality triple whose comparand is a `FieldReferenceSchema` now lowers to
 * `{ $eq: ref }`, which this driver compiles. The array sugar therefore cannot
 * reach this error any more.
 *
 * What CAN still reach it is a hand-authored `FilterCondition` carrying the
 * bare form, and that keeps being refused rather than compiled to `$eq`,
 * deliberately: the in-memory evaluator does NOT read this shape as an
 * equality. `matches-filter.ts` `evalField` sees an all-`$` key set and
 * dispatches `$field` to `evalOp`, which has no arm for it and answers `false`
 * (its fail-closed default). Compiling a column-to-column equality here would
 * make SQL answer rows for a filter the memory path answers `false` for — a
 * NEW divergence. #7597 ruled that the evaluator's unknown-operator posture
 * stays as #6520 left it and moved the LOWERING instead, so this message keeps
 * pointing at the `$eq` spelling that does compile.
 *
 * [#7929] It points at that spelling with PLACEHOLDER names now. The old text
 * wrote the corrected filter out with the two real column names — twice — which
 * on a read-scope refusal hands the administrator's policy back to the tenant
 * as a suggestion. The SHAPE survives the redaction; the names do not.
 */
function bareFieldReferenceError(field: string, ref: string, subtree?: unknown): Error {
  const diagnostic =
    `Field "${field}" is constrained by a bare field reference ({ "$field": "${ref}" }) with no ` +
    `operator. The spelling that compiles is ` +
    `{ "${field}": { "$eq": { "$field": "${ref}" } } }.`;
  return withheldFilterError(
    `A field in this filter is constrained by a bare field reference ({ "$field": … }) with no ` +
      `operator. Write the comparison explicitly — { "TARGET_FIELD": { "$eq": { "$field": ` +
      `"OTHER_FIELD" } } } — which compiles to a column-to-column comparison. The bare form is ` +
      `refused because the in-memory evaluator does not read it as an equality (it matches no ` +
      `record), so compiling it here would make the two execution paths answer this filter ` +
      `differently. The columns this filter named are withheld from the message; the ` +
      `full diagnostic is in the server log.`,
    diagnostic,
    subtree,
    `${diagnostic} The bare form is refused because the in-memory evaluator does not read it as ` +
      `an equality (it matches no record), so compiling it here would make the two execution ` +
      `paths answer this filter differently.`,
  );
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
function assertCompilableComparand(
  field: string,
  op: string,
  value: unknown,
  // [#8197] The node ENCLOSING this comparand — the field-spec map, or the
  // filter node for the bare `{ field: value }` spelling. Used only when the
  // comparand itself cannot carry a mark; see {@link refusalSubtree}.
  enclosing?: unknown,
): void {
  const ref = fieldReferenceOf(value);
  if (ref !== null) throw crossFieldComparisonError(field, op, ref, value);
  // [#25808] …and a now-anchored comparand, outside the six comparisons.
  if (nowAnchorOf(value) !== null) throw nowAnchorPositionError(field, op, value);

  // [#5234] The pattern family answers first: an array IS an object here, so
  // the member scan below would otherwise report `{$contains: ['a', {}]}` as a
  // bad LIST member — a message about a list the operator never takes.
  if (TEXT_PATTERN_OPERATORS.has(op) && !isRenderableTextComparand(value)) {
    // [#20039] `value` is an object or an array here — markable, and the
    // deepest node the throw site holds (see {@link refusalSubtree}).
    throw unrenderableTextComparandError(field, op, value, refusalSubtree(value, enclosing));
  }

  if (Array.isArray(value)) {
    for (const [index, member] of value.entries()) {
      const memberRef = fieldReferenceOf(member);
      if (memberRef !== null) throw crossFieldComparisonError(field, op, memberRef, member, index);
      if (nowAnchorOf(member) !== null) throw nowAnchorPositionError(field, op, member, index);
      // [#5234] Every member of a list operator's array is a comparand in its
      // own right and gets the same bind test the whole comparand gets. Scoped
      // to the operators for which an array is legitimate (the spec's list
      // half, {@link isListComparandOperator}), so a scalar operator handed an
      // array keeps answering with its own message ("requires a single
      // comparable value") instead of reporting the first bad member of a list
      // it should never have been given.
      // [#20039] The member when it is an object, else the list that holds it.
      if (isListComparandOperator(op) && !isBindableComparand(member)) {
        throw unbindableListMemberError(field, op, member, index, refusalSubtree(member, value));
      }
    }
    // An array IS the comparand for the list operators; only a scalar operator
    // is wrong to receive one, and that falls through to the check below.
  }

  if (!SCALAR_COMPARAND_OPERATORS.has(op) || isBindableComparand(value)) return;

  throw unbindableComparandError(field, op, value, refusalSubtree(value, enclosing));
}

/**
 * [#5041] A scalar operator's comparand that cannot become a bind parameter.
 *
 * [#8197] Extracted from {@link assertCompilableComparand}'s body — where it was
 * an inline `unsupportedFilterError` — for one reason: it is a member of
 * {@link refusalSubtree}'s family and needed somewhere to compose its redacted
 * and restored wordings side by side, which is the arrangement every other
 * withheld refusal in this file already uses.
 *
 * It also answers the MALFORMED cross-field spelling. `{ "$gt": { "$field": 42 } }`
 * is not a `FieldReferenceSchema` (the referent must be a string), so
 * {@link fieldReferenceOf} does not recognise it and the cross-field arm never
 * sees it — it arrives here as an ordinary unbindable object. Its comparand
 * preview used to print `{"$field":42}` beside the target column; both halves
 * are predicate-derived and both are now redacted.
 */
function unbindableComparandError(
  field: string,
  op: string,
  value: unknown,
  subtree?: unknown,
): Error {
  return withheldFilterError(
    `A comparison in this filter requires a single comparable value, but received a value that ` +
      `cannot be bound as a SQL parameter. Use ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} (or a ` +
      `binary value); for a list use $in/$nin, and for a range use $between. The field, the ` +
      `operator and the value this filter used are withheld from the message; the full ` +
      `diagnostic is in the server log.`,
    `Operator "${op}" on field "${field}" requires a single comparable value, but received ` +
      `${Array.isArray(value) ? 'an array' : `an object (${safeShapePreview(value)})`}, which cannot be ` +
      `bound as a SQL parameter. Use ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} (or a binary ` +
      `value); for a list use $in/$nin, and for a range use $between.`,
    subtree,
  );
}

/**
 * `$between` handed something that is not a two-element range.
 *
 * [#8197] The operator is NAMED in the redacted half, and it is the one thing in
 * this family that is: `$between` here is the refusal's CLASS, not a variable of
 * it — the same "which class fired" {@link crossFieldComparisonError} keeps. The
 * three refusals whose operator varies within one class (the JSON-column gate,
 * the bind gate) withhold theirs, because there the operator says WHICH
 * constraint of the predicate failed rather than which rule refused it.
 *
 * The target field is the whole disclosure, so redacting it leaves a sentence
 * that is still the complete repair: a `$between` takes `[min, max]`, and an
 * author who wrote one malformed range in one filter has no second candidate to
 * confuse it with.
 */
function betweenArityError(field: string, subtree?: unknown): Error {
  return withheldFilterError(
    `Operator "$between" in this filter requires a [min, max] value array. The field it was ` +
      `aimed at is withheld from the message; the full diagnostic is in the server log.`,
    `Operator "$between" on field "${field}" requires a [min, max] value array.`,
    subtree,
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
function unbindableListMemberError(
  field: string,
  op: string,
  value: unknown,
  index: number,
  subtree?: unknown,
): Error {
  // [#20039, the #8220 contract] The index is what tells the bad member apart
  // from its neighbours — for the AUTHOR. On a read-scope list it, the member's
  // preview, the field and which of the three list operators it was are all the
  // administrator's, so they go to the server log.
  return withheldFilterError(
    `A list operator ("$in" / "$nin" / "$between") in this filter has a member that cannot be ` +
      `bound as a SQL parameter. Every member of an $in/$nin/$between list is a comparand in its ` +
      `own right — use ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} (or a binary value). Refusing ` +
      `rather than binding it: the member can equal no stored value, so the list silently loses ` +
      `that entry (and a $nin loses the exclusion the caller wrote). Which operator it was, the ` +
      `field it was aimed at, the member's position in the list and its value are withheld from ` +
      `the message; the full diagnostic is in the server log.`,
    `Operator "${op}" on field "${field}" has a value at index ${index} of its list that cannot be ` +
      `bound as a SQL parameter: ${safeShapePreview(value)}. Every member of an $in/$nin/$between ` +
      `list is a comparand in its own right — use ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} ` +
      `(or a binary value). Refusing rather than binding it: the member can equal no stored value, ` +
      `so the list silently loses that entry (and a $nin loses the exclusion the caller wrote).`,
    subtree,
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
function unrenderableTextComparandError(
  field: string,
  op: string,
  value: unknown,
  subtree?: unknown,
): Error {
  // [#20039, the #8220 contract] The comparand's preview is the predicate's
  // literal, and the field and the operator (five share this builder) name
  // which constraint failed, not which rule refused it.
  return withheldFilterError(
    `A text-matching operator in this filter matches against the TEXT of a pattern, but received a ` +
      `comparand that is an object or an array. The spec declares this comparand a string ` +
      `(filter.zod.ts StringOperatorSchema); ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} is ` +
      `accepted. Refusing rather than stringifying it: String({}) is "[object Object]", so the ` +
      `pattern that ran would be one the caller never wrote. The operator, the field it was aimed ` +
      `at and the value it received are withheld from the message; the full diagnostic is in the ` +
      `server log.`,
    `Operator "${op}" on field "${field}" matches against the TEXT of a pattern, but received ` +
      `${Array.isArray(value) ? 'an array' : 'an object'} (${safeShapePreview(value)}). The spec ` +
      `declares this comparand a string (filter.zod.ts StringOperatorSchema); ` +
      `${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} is accepted. Refusing rather than stringifying ` +
      `it: String({}) is "[object Object]", so the pattern that ran was one the caller never ` +
      `wrote — valid SQL, and a row storing that literal text would have matched it.`,
    subtree,
  );
}

/**
 * [#7398] The column-type gate's operator set — `JSON_COLUMN_INCOMPATIBLE_OPERATORS`
 * — and the words of its refusal live in `@objectstack/core`
 * (`json-column-operator-refusal.ts`) since #21007, imported above under the
 * same name, unchanged. They moved there because `@objectstack/objectql`
 * evaluates a per-aggregation `filter` itself and now refuses the same operators
 * on the same declared fields: one set and one sentence for both faces, rather
 * than a copy each. The reasoning behind every member and every sentence is in
 * that module's docblocks.
 */

/**
 * [#7398] A scalar-comparison operator met a column this driver stores as JSON
 * TEXT, so the comparison can never mean what the caller wrote — the measured
 * consequences are on {@link jsonColumnOperatorRefusalText}.
 *
 * ADR-0112 class 1 — a caller mistake, so `INVALID_FILTER` / 400, the same
 * envelope {@link unsupportedFilterError} gives the unknown-operator refusal
 * one arm over.
 *
 * The prescription is `$contains` (and an `$or` of `$contains` for any-of)
 * because that is the membership spelling on such a column (the spec's
 * `$contains` docblock); a closed-spec-set `$overlaps` / `$containsAny` is the
 * issue's ask 2 and is deliberately not answered here.
 *
 * [#8197] The most reachable member of {@link refusalSubtree}'s family, and the
 * one the card led with: a CEL permission rule over a multi-select field lowers
 * to exactly this membership test, so the column this gate names is the
 * administrator's. The prescription survives redaction with PLACEHOLDER names —
 * the SHAPE is the repair, and the shape names nothing.
 *
 * [#21007] The TEXT is `@objectstack/core`'s; the CONSTRUCTOR stays here,
 * because the #8220 provenance seam it goes through is this driver's.
 * [#21067] That text no longer names this driver's storage form, since the
 * engine and `driver-memory` print it too; the measured SQL consequences above
 * live in the builder's docblock.
 *
 * [#21236] The `$contains` prescription is the multi-value class's. A
 * single-value file-class field inside the ADR-0104 window is a JSON column
 * here too, but it holds one JSON string, and `$contains` with its exact id
 * answered no rows. So `fieldClass`, which the gate reads from this driver's
 * registries ({@link SqlDriver.jsonColumnFieldClass}), picks the words, and
 * that class is told to finish the media-column move.
 */
function jsonColumnOperatorError(
  field: string,
  op: string,
  bare: boolean,
  fieldClass: JsonColumnFieldClass,
  subtree?: unknown,
): Error {
  const { message, diagnostic } = jsonColumnOperatorRefusalText(field, op, bare, fieldClass);
  return withheldFilterError(message, diagnostic, subtree);
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
function assertFilterNode(
  value: unknown,
  path: string,
  enclosing?: unknown,
): asserts value is Record<string, unknown> {
  if (isFilterNode(value)) return;
  // [#20039, the #8220 contract] The position, the kind and the preview are the
  // predicate's (a policy's literal, measured: `$or: ['<the literal>']`). The
  // node is the refused value when it is an object — an array, a `Date` — and
  // otherwise `enclosing`: the `$and` / `$or` list that holds it, or the node
  // carrying `$not`, whose provenance a primitive inherits.
  throw withheldFilterError(
    `A filter node in this filter is not a filter condition object. Every element of "$and"/"$or" ` +
      `and the operand of "$not" must be a plain object of field constraints (e.g. { "status": ` +
      `"active" }) or nested combinators — @objectstack/spec FilterConditionSchema declares this ` +
      `position as a FilterCondition. It is refused rather than skipped because skipping it would ` +
      `silently change which rows match. Where it sits, what it is and its value are withheld from ` +
      `the message; the full diagnostic is in the server log.`,
    `Filter node at ${path} is a ${describeFilterOperand(value)} (${safeShapePreview(value)}), not a filter ` +
      `condition object. Every element of "$and"/"$or" and the operand of "$not" must be a plain object of ` +
      `field constraints (e.g. { "status": "active" }) or nested combinators — @objectstack/spec ` +
      `FilterConditionSchema declares this position as a FilterCondition. It is refused rather than skipped ` +
      `because skipping it would silently change which rows match.`,
    refusalSubtree(value, enclosing),
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
function emptyFieldConstraintError(field: string, path: string, subtree?: unknown): Error {
  return withheldFilterError(
    `A field constraint in this filter carries zero operators ({ "FIELD": {} }). A field ` +
      `constraint must name at least one operator (e.g. { "FIELD": { "$eq": "value" } }) or be a ` +
      `direct comparand (e.g. { "FIELD": "value" }). It is refused rather than ignored because ` +
      `the backends disagreed on what it means — this driver dropped it inside $and/$or/$not ` +
      `(matching EVERY row) while refusing it at the top level, and driver-memory / ` +
      `@objectstack/formula answered "matches nothing". The field this filter named and ` +
      `its position are withheld from the message; the full diagnostic is in the server ` +
      `log.`,
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field constraint ` +
      `must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a direct ` +
      `comparand (e.g. { "${field}": "value" }). It is refused rather than ignored because the ` +
      `backends disagreed on what it means — this driver dropped it inside $and/$or/$not (matching ` +
      `EVERY row) while refusing it at the top level, and driver-memory / @objectstack/formula ` +
      `answered "matches nothing".`,
    subtree,
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
function unknownLogicalOperatorError(key: string, path: string, subtree?: unknown): Error {
  // [#20039, the #8220 contract] The key is the predicate's — `$`-prefixed or
  // not, it is a name the filter's author wrote — and so is its position. The
  // node is the one CARRYING the key (never its value, which may be marked on
  // its own: the key belongs to the node above it).
  return withheldFilterError(
    `A filter node in this filter carries a $-prefixed key that is not a declared combinator. A ` +
      `filter node's $-prefixed keys are the declared logical operators $and, $or and $not ` +
      `(@objectstack/spec LOGICAL_OPERATORS); every other key is a field name. It is refused rather ` +
      `than compiled as a COLUMN of that name, which would produce a predicate that matched no row ` +
      `and reported nothing. The key and where it sits are withheld from the message; the full ` +
      `diagnostic is in the server log.`,
    `Unsupported filter combinator "${key}" at ${path}. A filter node's $-prefixed keys are the ` +
      `declared logical operators $and, $or and $not (@objectstack/spec LOGICAL_OPERATORS); every ` +
      `other key is a field name. It is refused rather than compiled as a COLUMN of that name, ` +
      `which is what this driver used to do — producing a predicate that matched no row and ` +
      `reported nothing, so a caller could not tell "no rows matched" from "the filter never ` +
      `compiled".`,
    subtree,
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
 * the polarity table's `value === false` arm (this driver's
 * `nullValueSatisfiesOperator` then; since #20822 the shared lowering's) stay
 * exactly as they are. Once the gate holds, `true` and `false` are the only
 * comparands that reach either, so both tests are already exhaustive two-way choices — the
 * lenient-vs-strict question #5347 had to answer for `$null` does not arise
 * here, because both spellings agree on the two surviving values.
 */
function nonBooleanExistsComparandError(
  field: string,
  value: unknown,
  path: string,
  subtree?: unknown,
): Error {
  return withheldFilterError(
    nonBooleanFlagWithheldMessage('$exists'),
    `Operator "$exists" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $exists as a boolean. It is refused rather ` +
      `than coerced for the same reason $null is: a non-boolean lands on whichever side ` +
      `the backend's two-branch conditional happens to default to, and those defaults point in ` +
      `OPPOSITE directions — this driver's \`=== false\` test compiles IS NOT NULL for anything ` +
      `but false, a \`=== true\` test compiles IS NULL for anything but true. Note "false" the ` +
      `STRING is truthy, so it lands on the side opposite the false it was written to mean.`,
    subtree,
  );
}

function nonBooleanNullComparandError(
  field: string,
  value: unknown,
  path: string,
  subtree?: unknown,
): Error {
  return withheldFilterError(
    nonBooleanFlagWithheldMessage('$null'),
    `Operator "$null" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather ` +
      `than coerced because the backends read a non-boolean in OPPOSITE directions — this driver ` +
      `compiled IS NULL (anything but false), driver-memory's query path and driver-mongodb ` +
      `compiled IS NOT NULL (anything but true), and driver-memory's matcher dropped the ` +
      `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite ` +
      `the false it was written to mean.`,
    subtree,
  );
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

// ── [#20444] The `$empty` operator ───────────────────────────────────────────

/**
 * [#20444] A non-boolean `$empty` comparand. `FieldOperatorsSchema` declares
 * `$empty: z.boolean()`, and the spec's save door already refuses anything else
 * (`filter-save-door-refusals.ts` counts it among the boolean flags beside
 * `$null` / `$exists`). Refused here on the validating walk for the reason its
 * two siblings are: a two-branch emitter has a DEFAULT side, and a third value
 * would silently land on it.
 */
function nonBooleanEmptyComparandError(
  field: string,
  value: unknown,
  path: string,
  subtree?: unknown,
): Error {
  return withheldFilterError(
    'Operator "$empty" in this filter requires a boolean comparand (true or false). ' +
      '@objectstack/spec FieldOperatorsSchema declares $empty as a boolean, and a non-boolean is ' +
      'refused rather than coerced: true asks for the empty rows, false for their exact ' +
      'complement, and any other value would land on whichever side a compiler defaults to. The ' +
      'field it was aimed at and the value it received are withheld from the message; the full ' +
      'diagnostic is in the server log.',
    `Operator "$empty" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $empty as a boolean: true asks for the ` +
      `empty rows, false for their exact complement.`,
    subtree,
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
 *    `IS NOT NULL`, a TOTAL predicate), while its polarity tables
 *    `operatorIsNullTotal` and `nullValueSatisfiesOperator` (deleted by #20822;
 *    the shared lowering carries the rule now) read `value === null` (STRICT — so they
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
function undefinedComparandError(field: string, path: string, subtree?: unknown): Error {
  // [#20039, the #8220 contract] The field and the position are the
  // predicate's; the repair survives redaction with a PLACEHOLDER name, as the
  // zero-operator refusal's does — the shape is the repair, and it names
  // nothing. `undefined` itself can never carry a mark, so `subtree` is the
  // nearest object holding it (the node, the operator map, or the list).
  return withheldFilterError(
    `A comparand in this filter is undefined. @objectstack/spec FieldOperatorsSchema declares no ` +
      `undefined comparand, and in JavaScript { "FIELD": undefined } cannot be told apart from ` +
      `omitting the key — yet the two mean OPPOSITE things (a predicate versus no constraint at ` +
      `all), so there is no reading of it that is not a guess. Write null if you meant the null ` +
      `predicate ({ "FIELD": null } or { "FIELD": { "$null": true } }), or omit the key when the ` +
      `value is genuinely absent. The field it was aimed at and where it sits are withheld from ` +
      `the message; the full diagnostic is in the server log.`,
    `Comparand at ${path} is undefined. @objectstack/spec FieldOperatorsSchema declares no ` +
      `undefined comparand, and in JavaScript { "${field}": undefined } cannot be told apart from ` +
      `omitting the key — yet the two mean OPPOSITE things (a predicate versus no constraint at ` +
      `all), so there is no reading of it that is not a guess. Write null if you meant the null ` +
      `predicate ({ "${field}": null } or { "${field}": { "$null": true } }), or omit the key when ` +
      `the value is genuinely absent (e.g. \`if (id !== undefined) where.${field} = id\`). It is ` +
      `refused rather than compiled because the backends disagreed: driver-sql handed it to knex ` +
      `and got a bare "Undefined binding(s)" Error carrying no code, while Turso's remote transport ` +
      `compiled it to IS NULL — so \`{ owner_id: ctx.user?.id }\` with a missing id silently ` +
      `matched every env-wide row instead of failing.`,
    subtree,
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
function assertDefinedComparands(
  field: string,
  spec: unknown,
  path: string,
  // [#20039] The filter node carrying `field` — the only object that holds a
  // DIRECT `{ field: undefined }`. The two deeper positions hand over the
  // nearest object of their own: the operator map, and the list.
  enclosing?: unknown,
): void {
  if (spec === undefined) throw undefinedComparandError(field, path, enclosing);
  if (!isFilterNode(spec)) return;
  for (const [op, opValue] of Object.entries(spec)) {
    if (op === '$null' || op === '$exists') continue;
    const opPath = `${path}.${op}`;
    if (opValue === undefined) throw undefinedComparandError(field, opPath, spec);
    if (!Array.isArray(opValue)) continue;
    opValue.forEach((member, index) => {
      if (member === undefined) throw undefinedComparandError(field, `${opPath}[${index}]`, opValue);
    });
  }
}

/**
 * [#5134] `$and`/`$or` take a list; anything else is refused, never coerced.
 *
 * [#20020, the #8220 contract] The operand's preview and the combinator's
 * position are the predicate's, so they go to the server log unless the
 * refusal's node is positively marked `'author'`. That node is the operand
 * itself when it is an object (the deepest markable node), and otherwise
 * `enclosing` — the filter node that carries the combinator key, which a
 * primitive operand inherits its provenance from.
 */
function assertFilterNodeList(
  value: unknown,
  key: string,
  path: string,
  enclosing?: unknown,
): asserts value is unknown[] {
  if (Array.isArray(value)) return;
  throw withheldFilterError(
    'A filter combinator ("$and" / "$or") in this filter requires an array of filter conditions. ' +
      '@objectstack/spec FilterConditionSchema declares both as FilterCondition[]. Which one it ' +
      'was, where it sits and the value it received are withheld from the message; the full ' +
      'diagnostic is in the server log.',
    `Filter combinator "${key}" at ${path} requires an array of filter conditions, but received a ` +
      `${describeFilterOperand(value)} (${safeShapePreview(value)}). @objectstack/spec FilterConditionSchema ` +
      `declares "${key}" as FilterCondition[].`,
    refusalSubtree(value, enclosing),
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
  return reduceFilterVerdict(node, { ...sqlFilterVerdictHooks(node, path), path });
}

/**
 * [#5134] The verdict of ONE key of a filter node. `enclosing` is the node the
 * key belongs to — see {@link sqlFilterVerdictHooks} for what reads it.
 */
function reduceFilterKey(key: string, value: unknown, path: string, enclosing?: unknown): FilterVerdict {
  return reduceFilterKeyVerdict(key, value, { ...sqlFilterVerdictHooks(enclosing, path), path });
}

/**
 * [#5659] This driver's half of the reduction: the shape refusals, at the
 * positions the shared walk visits them.
 *
 * `assertFilterNodeList` / `assertFilterNode` are wrapped in arrows rather than
 * passed by reference because they are TypeScript assertion functions, whose
 * narrowing is meaningless — and whose declaration requirements are a nuisance
 * — through a property reference. Nothing else about the call changes.
 *
 * [#20020] Built per reduction rather than shared, because the non-list
 * combinator refusal needs the NODE that carries the combinator key, and the
 * shared walk hands `assertNodeList` only the operand, the key and the path.
 * The node is recovered from the path without widening that spec-declared hook
 * signature: every node the walk reduces is either `root` (at `rootPath`) or
 * an element / `$not` operand it announced through `assertNode` at the exact
 * path it then reduces it under — so recording those announcements is a
 * complete path-to-node index for the positions `assertNodeList` can name. The
 * index is keyed only by paths built from combinator keys and list indices,
 * never by a field name, so a field key containing a dot cannot collide with it.
 *
 * [#20039] Every refusal the walk raises now asks the same index, because every
 * one of them is withheld through the #8220 seam and needs the node it was
 * raised FROM: `classifyKey` gets the node carrying the key (the only object
 * holding a direct `{ field: undefined }`, and the owner of an undeclared
 * `$`-key), and `assertNode` gets what ENCLOSES a non-node element — the
 * `$and` / `$or` list, recorded as `assertNodeList` announces it (the walk
 * announces a list before it visits a single element), or the node carrying
 * `$not`. Lists are kept in their own map, keyed by the combinator key's
 * position, so the node index above stays exactly what it was.
 */
function sqlFilterVerdictHooks(root: unknown, rootPath: string): FilterVerdictHooks {
  const nodeAt = new Map<string, unknown>([[rootPath, root]]);
  const listAt = new Map<string, unknown>();
  // The walk names a key's position `${nodePath}.${key}` (bare `key` under an
  // empty prefix), so stripping the key recovers the node's own path.
  const nodeCarrying = (key: string, path: string): unknown =>
    nodeAt.get(path === key ? '' : path.slice(0, path.length - key.length - 1));
  return {
    assertNodeList: (value, key, path) => {
      listAt.set(path, value);
      assertFilterNodeList(value, key, path, nodeCarrying(key, path));
    },
    assertNode: (value, path) => {
      nodeAt.set(path, value);
      // An element's position is `${listPath}[${index}]`; the `$not` operand's
      // is the key's own position, so its enclosing node is the one carrying it.
      const element = /\[\d+\]$/.exec(path);
      assertFilterNode(
        value,
        path,
        element ? listAt.get(path.slice(0, element.index)) : nodeCarrying('$not', path),
      );
    },
    classifyKey: (key, value, here) => classifyFilterKey(key, value, here, nodeCarrying(key, here)),
  };
}

/**
 * [#5134] The verdict of ONE **non-combinator** key — and this driver's gate on
 * everything a field constraint may not be.
 *
 * `here` is the already-joined path of the key, exactly as the reduction hands
 * it over; the three combinator arms this used to open with are the shared
 * walk's now, and the refusals below are unchanged from when they sat under
 * them.
 */
function classifyFilterKey(
  key: string,
  value: unknown,
  here: string,
  // [#20039] The filter node this key belongs to — see
  // {@link sqlFilterVerdictHooks}. Absent means withheld for every refusal
  // below that would have used it, the fail-closed direction.
  enclosing?: unknown,
): FilterVerdict {
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
  if (key.startsWith('$')) throw unknownLogicalOperatorError(key, here, enclosing);

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
  // [#8197] `value` IS the `{}` — an object, so it is markable and findable by
  // identity under the query's `where` root. The reduction walks the same tree
  // the merge boundaries marked, by reference, so nothing is copied between the
  // mark and this throw.
  if (isEmptyFieldConstraint(value)) throw emptyFieldConstraintError(key, here, value);

  // [#6050] `undefined` in a comparand position, refused on THIS walk for the
  // two reasons the walk exists — it is exhaustive and it runs FIRST.
  //
  // "First" is the whole design here, not a preference. Both defects #6050
  // measured live downstream of this line: the emitter hands an undefined bind
  // to knex (a bare `Undefined binding(s)` Error, outside ADR-0112), and the
  // polarity tables of the `$not` rewrite this driver carried until #20822
  // (the shared lowering's rule 3 now) read it `=== null`, disagreeing with
  // the `$ne` emitter's `== null` about exactly this value.
  // `applyFilterCondition` runs the whole reduction before
  // it reaches either, so a refusal raised here makes BOTH unreachable rather
  // than repaired — and the polarity tables never have to answer a question
  // nobody ruled on. See {@link undefinedComparandError} for the measured
  // local/remote matrix and why `null` is untouched.
  assertDefinedComparands(key, value, here, enclosing);

  // [#7929, maintainer ruling 2026-08-12] A `{ $field }` comparand at any
  // operator OUTSIDE the six that compile one is the CROSS-FIELD refusal —
  // answered here, ahead of the comparand-SHAPE gates below.
  //
  // Not a new refusal: every one of these shapes was already refused, and the
  // set of accepted filters is byte-identical. What changes is WHICH refusal
  // answers, and that is the point. `$icontains`, `$like`/`$ilike`, `$null` and
  // `$exists` each carry their own comparand-shape gate on this walk, and each
  // gate renders the offending comparand into its message — so a field
  // reference came back to the caller as `received {"$field":"…"}`, naming the
  // referenced column, while the same reference at `$contains` (no gate here,
  // refused at the emitter) was answered by the cross-field refusal instead.
  // Measured on `origin/main`: five operators disclosing, four not, decided by
  // nothing a caller can see. One condition — "this comparand is a reference to
  // another field, in a position SQL push-down does not compile" — now has one
  // answer, and that answer is the redacted one.
  //
  // The six scalar comparison operators are skipped because a reference IS
  // their compiled meaning ({@link SqlDriver.applyCrossFieldComparison}); their
  // own boundary refusals are raised there with the same withhold.
  if (isFilterNode(value)) {
    for (const [op, comparand] of Object.entries(value)) {
      if (CROSS_FIELD_COMPARISON_OPERATORS.has(op)) continue;
      const ref = fieldReferenceOf(comparand);
      if (ref !== null) throw crossFieldComparisonError(key, op, ref, comparand);
      // [#25808] A now-anchored comparand under any other operator, likewise.
      if (nowAnchorOf(comparand) !== null) throw nowAnchorPositionError(key, op, comparand);
    }
  }

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
    throw nonBooleanNullComparandError(key, value.$null, `${here}.$null`, value);
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
    throw nonBooleanExistsComparandError(key, value.$exists, `${here}.$exists`, value);
  }

  // [#20444] `$empty`'s comparand is a boolean by the same declaration, refused
  // on the same walk for the same evaluation-order reason — its own `if`, not a
  // loop over a flag list, for the reason the `$exists` gate above gives.
  if (
    isFilterNode(value) &&
    Object.prototype.hasOwnProperty.call(value, '$empty') &&
    typeof value.$empty !== 'boolean'
  ) {
    throw nonBooleanEmptyComparandError(key, value.$empty, `${here}.$empty`, value);
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
    throw icontainsComparandError(
      key,
      value.$icontains,
      `${here}.$icontains`,
      refusalSubtree(value.$icontains, value),
    );
  }

  // [#7536] `$like` / `$ilike` carry a PATTERN, gated on this same walk and for
  // the same evaluation-order reason as the three above.
  //
  // Note what is NOT refused: an EMPTY pattern. `$icontains: ''` is refused
  // because every row contains the empty substring, so it constrains nothing —
  // but `LIKE ''` matches only the empty string, which is a narrow and perfectly
  // well-formed predicate. Copying the sibling's rule here would refuse a
  // legitimate query.
  if (isFilterNode(value)) {
    for (const op of LIKE_PATTERN_OPERATORS) {
      if (!Object.prototype.hasOwnProperty.call(value, op)) continue;
      const pattern = (value as Record<string, unknown>)[op];
      // [#20039] The comparand when it is an object, else the operator map.
      if (typeof pattern !== 'string') {
        throw likePatternComparandError(key, op, pattern, `${here}.${op}`, refusalSubtree(pattern, value));
      }
      if (hasDanglingLikeEscape(pattern)) {
        throw danglingLikeEscapeError(key, op, pattern, `${here}.${op}`, value);
      }
      // [#20041] A pattern holding U+0000 — SQLite's GLOB cuts it there. The
      // operator map is the node, as for the dangling escape.
      if (hasNulInLikePattern(pattern)) {
        throw nulLikePatternError(key, op, pattern, `${here}.${op}`, value);
      }
    }
  }

  // A field key always contributes a predicate.
  return 'clause';
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
  AUTONUMBER_COLLISION_RETRIES, CROSS_FIELD_COMPARISON_OPERATORS, DEFAULT_ID_LENGTH, MEDIA_ID_VARCHAR_CHARS,
  RowWidthContribution, SQL_AGGREGATE_FUNCTIONS, SQL_WINDOW_FUNCTIONS, SQL_WINDOW_SORT_DIRECTIONS,
  SqlAggregateLowering, TEXT_OPERATORS, WITHHELD_FILTER_AUTHOR_TEXT, WITHHELD_FILTER_LOGGED, WITHHELD_FILTER_SUBTREE,
  assertCompilableComparand, assertDefinedComparands, bareFieldReferenceError, betweenArityError, canonicalTimeOfDay,
  canonicalUtcDatetime, declaresColumnNotNull, emptyFieldConstraintError, filterArrayReachedDriverError,
  insertedRowsNotReadBackError, invalidWindowFunctionQueryError, isDeclaredFieldType, isDeferredDdlLockWaitRefusal,
  isEmptyFieldConstraint, isUpsertFenceRefusal, jsonColumnOperatorError, normalizeSqliteDatetimeOutput, nowAnchorOf,
  presentAuditTimestampOutput, reclaimBetterSqlite3, reduceFilterKey, reduceFilterNode, refusalSubtree,
  refuseAggregateFunction, refuseCrossRowIdentityMerge, refuseDateBucketedGroupBy,
  refuseDistinctAggregateWithoutField, refuseRejectedReferenceAlias, refuseUndeclaredFieldType,
  retiredFilterOperatorError, uniqueProbeNotNullClause, unsupportedAggregationFilterError,
  unsupportedFilterOperatorError,
};
