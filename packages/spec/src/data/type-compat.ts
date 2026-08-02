// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL ⇆ ObjectStack field-type compatibility matrix (ADR-0015 §4.6).
 *
 * A pure, dialect-aware module mapping remote SQL column types
 * (`text`, `varchar(255)`, `numeric(10,2)`, `timestamptz`, `jsonb`, …) to
 * ObjectStack field types, and answering "can this remote column back this
 * field type?". Used by `IExternalDatasourceService`:
 *
 *   - `generateObjectDraft` → {@link suggestFieldTypeForSqlType} to draft
 *     `*.object.ts`.
 *   - `validateObject`      → {@link isCompatible} to diff a declared field
 *     against the remote column.
 *
 * Naming: NOT `suggestFieldType` — that name belongs to the typo-correction
 * helper in `shared/suggestions.zod.ts` (invalid authored FieldType →
 * `string[]` of candidates, exported from the root entry). This one is the
 * deterministic SQL-column → FieldType mapper; the two sharing one name was
 * the #4411 dual-source trap (#4539).
 *
 * No I/O, no driver coupling — operates on raw type strings so it can be
 * unit-tested independently and extended per dialect without touching the
 * runtime.
 */

import type { FieldType } from './field.zod';

/** SQL dialects whose type vocabularies the matrix understands. */
export type SqlDialect =
  | 'postgres'
  | 'mysql'
  | 'sqlite'
  | 'snowflake'
  | 'bigquery'
  | 'mongo';

/**
 * Result of a compatibility check:
 * - `true`   — exact / safe mapping.
 * - `'lossy'`— usable but information may be lost (e.g. `jsonb` → `text`,
 *   `numeric(38,0)` → JS `number`). Generated drafts flag these `// REVIEW:`.
 * - `false`  — incompatible; the validator emits a `type_mismatch` diff.
 */
export type Compatibility = boolean | 'lossy';

/**
 * Canonical "base" SQL type after stripping parameters/qualifiers and
 * applying dialect aliases. Internal vocabulary the matrix is keyed on.
 */
type CanonicalSqlType =
  | 'text'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'json'
  | 'uuid'
  | 'binary'
  | 'enum'
  | 'array'
  | 'vector'
  | 'unknown';

/**
 * Per-dialect aliases mapping vendor type names to a {@link CanonicalSqlType}.
 * Only entries that differ from the shared base map (below) need listing.
 */
const DIALECT_ALIASES: Partial<Record<SqlDialect, Record<string, CanonicalSqlType>>> = {
  postgres: {
    int2: 'integer', int4: 'integer', int8: 'bigint', serial: 'integer', bigserial: 'bigint',
    float4: 'float', float8: 'float', numeric: 'decimal', bool: 'boolean',
    timestamptz: 'datetime', timestamp: 'datetime', timetz: 'time',
    jsonb: 'json', json: 'json', uuid: 'uuid', bytea: 'binary', bpchar: 'text',
    citext: 'text', vector: 'vector',
  },
  mysql: {
    tinyint: 'integer', smallint: 'integer', mediumint: 'integer', int: 'integer',
    bigint: 'bigint', double: 'float', real: 'float', decimal: 'decimal',
    datetime: 'datetime', timestamp: 'datetime', tinytext: 'text', mediumtext: 'text',
    longtext: 'text', json: 'json', blob: 'binary', longblob: 'binary', enum: 'enum',
  },
  sqlite: {
    integer: 'integer', int: 'integer', real: 'float', numeric: 'decimal',
    text: 'text', blob: 'binary',
  },
  snowflake: {
    number: 'decimal', int: 'integer', integer: 'integer', bigint: 'bigint',
    float: 'float', double: 'float', string: 'text', varchar: 'text', variant: 'json',
    object: 'json', array: 'array', boolean: 'boolean', timestamp_ntz: 'datetime',
    timestamp_tz: 'datetime', timestamp_ltz: 'datetime', binary: 'binary',
  },
  bigquery: {
    int64: 'bigint', float64: 'float', numeric: 'decimal', bignumeric: 'decimal',
    string: 'text', bytes: 'binary', bool: 'boolean', boolean: 'boolean',
    timestamp: 'datetime', datetime: 'datetime', struct: 'json', json: 'json',
    array: 'array', record: 'json',
  },
  mongo: {
    objectid: 'text', string: 'text', double: 'float', int: 'integer', long: 'bigint',
    decimal: 'decimal', bool: 'boolean', boolean: 'boolean', date: 'datetime',
    object: 'json', array: 'array', bindata: 'binary',
  },
};

/**
 * Dialect-agnostic base map of common ANSI/SQL type names to canonical types.
 * Consulted after dialect aliases.
 */
const BASE_ALIASES: Record<string, CanonicalSqlType> = {
  text: 'text', varchar: 'text', char: 'text', character: 'text', string: 'text',
  'character varying': 'text', nvarchar: 'text', nchar: 'text', clob: 'text',
  integer: 'integer', int: 'integer', smallint: 'integer', tinyint: 'integer',
  bigint: 'bigint',
  decimal: 'decimal', numeric: 'decimal', number: 'decimal', money: 'decimal',
  float: 'float', double: 'float', 'double precision': 'float', real: 'float',
  boolean: 'boolean', bool: 'boolean', bit: 'boolean',
  date: 'date',
  time: 'time',
  datetime: 'datetime', timestamp: 'datetime',
  json: 'json', jsonb: 'json',
  uuid: 'uuid', guid: 'uuid',
  binary: 'binary', varbinary: 'binary', blob: 'binary', bytes: 'binary',
  enum: 'enum',
  array: 'array',
  vector: 'vector',
};

/**
 * For each canonical SQL type: the suggested ObjectStack field type plus the
 * set of field types it is exactly / lossily compatible with.
 */
const CANONICAL_TO_FIELD: Record<
  CanonicalSqlType,
  { suggested: FieldType; exact: FieldType[]; lossy: FieldType[] }
> = {
  text: { suggested: 'text', exact: ['text', 'textarea', 'email', 'url', 'phone', 'markdown', 'html', 'richtext', 'code', 'select', 'color'], lossy: [] },
  integer: { suggested: 'number', exact: ['number', 'autonumber', 'rating', 'percent'], lossy: ['currency', 'boolean'] },
  bigint: { suggested: 'number', exact: ['number', 'autonumber'], lossy: ['currency'] },
  decimal: { suggested: 'number', exact: ['number', 'currency', 'percent'], lossy: ['rating'] },
  float: { suggested: 'number', exact: ['number', 'currency', 'percent', 'slider'], lossy: [] },
  boolean: { suggested: 'boolean', exact: ['boolean', 'toggle'], lossy: [] },
  date: { suggested: 'date', exact: ['date'], lossy: ['datetime'] },
  time: { suggested: 'time', exact: ['time'], lossy: [] },
  datetime: { suggested: 'datetime', exact: ['datetime'], lossy: ['date'] },
  json: { suggested: 'json', exact: ['json', 'composite', 'repeater', 'record', 'location', 'address', 'tags', 'multiselect'], lossy: ['text'] },
  uuid: { suggested: 'text', exact: ['text', 'lookup', 'master_detail', 'user'], lossy: [] },
  binary: { suggested: 'file', exact: ['file', 'image', 'signature'], lossy: ['text'] },
  enum: { suggested: 'select', exact: ['select', 'radio', 'text'], lossy: [] },
  array: { suggested: 'multiselect', exact: ['multiselect', 'checkboxes', 'tags', 'json'], lossy: ['text'] },
  vector: { suggested: 'vector', exact: ['vector'], lossy: ['json'] },
  unknown: { suggested: 'text', exact: [], lossy: ['text', 'json'] },
};

/**
 * Reduce a raw SQL type string to its canonical form.
 *
 * Strips length/precision (`varchar(255)` → `varchar`), array suffixes
 * (`text[]` → array), and qualifiers (`timestamp without time zone` →
 * `timestamp`), then applies dialect aliases, then the base map.
 */
export function canonicalizeSqlType(rawType: string, dialect?: SqlDialect): CanonicalSqlType {
  if (!rawType) return 'unknown';
  let t = rawType.trim().toLowerCase();

  // Postgres / generic array notation: `text[]`, `_int4`.
  const isArray = t.endsWith('[]') || t.startsWith('_');
  if (isArray) return 'array';

  // Drop precision/length: `numeric(10,2)` → `numeric`, `varchar(255)` →
  // `varchar`. Linear substring slice (no regex backtracking).
  const paren = t.indexOf('(');
  if (paren !== -1) t = t.slice(0, paren).trim();

  // Normalise common trailing qualifiers using literal, anchored suffix
  // checks — avoids polynomial-backtracking regexes on uncontrolled input.
  for (const suffix of [' without time zone', ' with time zone', ' unsigned', ' signed']) {
    if (t.endsWith(suffix)) {
      t = t.slice(0, t.length - suffix.length).trim();
      break;
    }
  }

  // `timestamp with time zone` collapsed to `timestamp` above; `timestamptz`
  // handled via alias.
  const dialectMap = dialect ? DIALECT_ALIASES[dialect] : undefined;
  if (dialectMap && dialectMap[t]) return dialectMap[t];
  if (BASE_ALIASES[t]) return BASE_ALIASES[t];

  // `timestamp with time zone` may survive as `timestamp` already mapped;
  // anything else is unknown.
  return 'unknown';
}

/**
 * The ObjectStack field type best suited to back a given remote SQL column.
 * Returns `undefined` only when the type is wholly unrecognised (the caller
 * may fall back to `text` and flag it for review).
 */
export function suggestFieldTypeForSqlType(rawType: string, dialect?: SqlDialect): FieldType | undefined {
  const canonical = canonicalizeSqlType(rawType, dialect);
  if (canonical === 'unknown') return undefined;
  return CANONICAL_TO_FIELD[canonical].suggested;
}

/**
 * Whether a remote SQL column type can back the given ObjectStack field type.
 *
 * @returns `true` (exact), `'lossy'` (usable with possible loss), or `false`.
 */
export function isCompatible(
  rawType: string,
  fieldType: FieldType,
  dialect?: SqlDialect,
): Compatibility {
  const canonical = canonicalizeSqlType(rawType, dialect);
  const entry = CANONICAL_TO_FIELD[canonical];
  if (entry.exact.includes(fieldType)) return true;
  if (entry.lossy.includes(fieldType)) return 'lossy';
  // Unknown remote types are permissive-but-lossy against text/json only,
  // already encoded in CANONICAL_TO_FIELD.unknown.
  return false;
}
