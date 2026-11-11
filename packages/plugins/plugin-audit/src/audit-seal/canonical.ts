// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type { FieldType } from '@objectstack/spec/data';
import { canonicalJsonBytes } from './jcs.js';

/**
 * ADR-0154 D1 — the canonical form of a sealed row: each row is one leaf, its
 * clear columns enter as values and its value columns as salted commitments.
 *
 * The canonical form is what makes a row hash the same wherever it is read
 * from. The hot store and the archive datasource may hand one column back in
 * different types (a `Date`, an ISO string, a SQL `YYYY-MM-DD HH:MM:SS` text,
 * epoch milliseconds; `0`/`1` for a boolean), and the row moves from one to
 * the other at `archive.after`. So every value is brought to one spelling by
 * its column's DECLARED type before it is serialized ({@link canonicalValue}),
 * and the serialization is RFC 8785 (`canonicalJson` in `./jcs.ts`).
 *
 * `canon` version 1 is the form below. A future form is a new version that
 * travels in every checkpoint (`canon_version`), never a silent change here.
 */
export const AUDIT_SEAL_CANON_VERSION = 1;

/** A canonical-form refusal: a row or a value the form has no spelling for. */
export class CanonicalFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalFormError';
  }
}

/**
 * The column set of a checkpoint, recorded IN the checkpoint (D1): which
 * columns entered the leaf in clear and which as commitments, each list
 * sorted. Read off the checkpoint, never off the live definition, so a field
 * added to the object later changes no sealed leaf.
 */
export interface SealedColumnSet {
  readonly clear: readonly string[];
  readonly committed: readonly string[];
}

/**
 * The declared shape the canonical form reads of one field: its `type`, and
 * whether it is a multi-value column (`multiple: true` stores a list).
 */
export interface SealedFieldType {
  readonly type?: string;
  readonly multiple?: boolean;
}

/** The declared shape the canonical form reads: each field's `type` and `multiple`. */
export type SealedFieldTypes = Readonly<Record<string, SealedFieldType>>;

/**
 * The normalisation rules of `canon` version 1 (ADR-0154 D1, open question 1
 * ruled A widened). Each rule has ONE spelling, and takes every spelling a
 * driver hands back for it to that one:
 *
 *  - `text` — a string, as it is. Nothing else: a number under a text column
 *    is a store disagreeing with the declaration, not a spelling.
 *  - `number` — a finite JS number. A decimal text (an exact-decimal column
 *    reads back as one on PostgreSQL) and a bigint are read as the number they
 *    spell, only when that number carries them exactly: an integer must be a
 *    safe integer, and a decimal text must survive the trip to a double
 *    (`12.50` is `12.5`; `0.1000000000000000055` is refused, since `0.1`
 *    would seal a value the store does not hold).
 *  - `boolean` — `true`/`false`, a driver's `1`/`0` and `'1'`/`'0'` included.
 *  - `date` — `YYYY-MM-DD`: that text, or a `Date` at UTC midnight. A `Date`
 *    at any other instant is refused rather than cut to a day, since which
 *    day it names depends on the zone the driver read it in.
 *  - `datetime` — {@link canonicalDatetime}.
 *  - `json` — the parsed JSON value: a string is parsed (a JSON column reads
 *    back as text on SQLite and parsed on PostgreSQL), anything else is taken
 *    as the value it is.
 */
export type AuditSealCanonRule = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';

/**
 * The rule of every declared field type, exhaustive over `FieldType`: a type
 * added to the spec fails this file's type check until it is given a rule or
 * `null`. `null` is "no rule", and an object that declares a column of such a
 * type is not sealed (reported once, at `error`, by the sealer):
 *
 *  - `password`, `secret` — what the store holds is not the value; a secret is
 *    a ciphertext re-wrapped on key rotation, which would read as a change;
 *  - `formula`, `summary` — computed from other rows or columns, not stored
 *    with the row;
 *  - `image`, `file`, `avatar`, `video`, `audio` — a reference whose stored
 *    shape is the file service's (an id, a URL, or an object), with no one
 *    spelling.
 *
 * A field declared `multiple: true` stores a list, so a `text` rule reads as
 * `json` there.
 */
export const AUDIT_SEAL_TYPE_RULES = {
  text: 'text', textarea: 'text', email: 'text', url: 'text', phone: 'text',
  password: null, secret: null,
  markdown: 'text', html: 'text', richtext: 'text',
  number: 'number', currency: 'number', percent: 'number',
  date: 'date', datetime: 'datetime', time: 'text',
  boolean: 'boolean', toggle: 'boolean',
  select: 'text', multiselect: 'json', radio: 'text', checkboxes: 'json',
  lookup: 'text', master_detail: 'text', tree: 'text', user: 'text',
  image: null, file: null, avatar: null, video: null, audio: null,
  formula: null, summary: null, autonumber: 'text',
  composite: 'json', repeater: 'json', record: 'json', location: 'json', address: 'json',
  code: 'text', json: 'json', color: 'text',
  rating: 'number', slider: 'number', signature: 'text', qrcode: 'text', progress: 'number',
  tags: 'json', vector: 'json',
} as const satisfies Record<FieldType, AuditSealCanonRule | null>;

/** The rule a declared field reads by, or `null` when its type has none. */
export function canonRuleOf(field: SealedFieldType | undefined): AuditSealCanonRule | null {
  const type = field?.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(AUDIT_SEAL_TYPE_RULES, type)) return null;
  const rule: AuditSealCanonRule | null = AUDIT_SEAL_TYPE_RULES[type as FieldType];
  return rule === 'text' && field?.multiple === true ? 'json' : rule;
}

/** A column the canonical form has no rule for: its name and declared type. */
export interface UnsealableColumn {
  readonly column: string;
  readonly type: string | null;
}

/**
 * The columns of a column set whose declared type has no rule. Any one of them,
 * clear or committed, means the object is not sealed: a commitment is taken over
 * the canonical value too, so a committed column needs one spelling as much as a
 * clear one.
 */
export function unsealableColumns(columns: SealedColumnSet, types: SealedFieldTypes): UnsealableColumn[] {
  return [...columns.clear, ...columns.committed]
    .filter((column) => canonRuleOf(types[column]) === null)
    .map((column) => ({ column, type: typeof types[column]?.type === 'string' ? (types[column].type as string) : null }))
    .sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
}

/**
 * The column set for an object: every declared field, with `valueFields`
 * committed and the rest in clear. `id` and `created_at` must be declared and
 * must stay in clear — a leaf is ordered and located by them.
 */
export function sealedColumnSet(fields: SealedFieldTypes, valueFields: readonly string[]): SealedColumnSet {
  const declared = Object.keys(fields);
  for (const name of valueFields) {
    if (!declared.includes(name)) throw new CanonicalFormError(`value field '${name}' is not a declared field`);
  }
  for (const name of ['id', 'created_at']) {
    if (!declared.includes(name)) throw new CanonicalFormError(`a sealed object must declare '${name}'`);
    if (valueFields.includes(name)) throw new CanonicalFormError(`'${name}' cannot be a value field; a leaf is ordered by it`);
  }
  const committed = [...new Set(valueFields)].sort();
  const clear = declared.filter((name) => !committed.includes(name)).sort();
  return { clear, committed };
}

/** `YYYY-MM-DD HH:MM:SS[.fff…]` with no zone designator — a SQL datetime text. */
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * A datetime in the one spelling D1 fixes: UTC ISO-8601 to the millisecond,
 * `YYYY-MM-DDTHH:mm:ss.sssZ`, whatever the driver returned: a `Date`, an
 * ISO-8601 text, a zoneless SQL text, or a number. A zoneless SQL text is read
 * as UTC, which is how every writer of this platform stores it. A number is
 * read as epoch milliseconds (not seconds); digits handed over as text are a
 * text, not a number, and are refused unless they parse as a datetime text.
 */
export function canonicalDatetime(value: unknown, at = 'value'): string {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number') date = new Date(value);
  else if (typeof value === 'string') {
    const text = value.trim();
    date = new Date(ZONELESS_DATETIME.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  } else {
    throw new CanonicalFormError(`${at}: a ${value === null ? 'null' : typeof value} is not a datetime`);
  }
  if (Number.isNaN(date.getTime())) throw new CanonicalFormError(`${at}: a ${typeof value} that does not parse as a datetime`);
  return date.toISOString();
}

/** A decimal number's digits and exponent with no leading or trailing zeros: equal for equal values. */
function decimalKey(text: string): string {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return text;
  const [, sign, whole = '', fraction = '', exponent = '0'] = match;
  let digits = whole + fraction;
  let power = Number(exponent) - fraction.length;
  const leading = digits.length - digits.replace(/^0+/, '').length;
  digits = digits.slice(leading);
  const trailing = digits.length - digits.replace(/0+$/, '').length;
  digits = digits.slice(0, digits.length - trailing);
  power += trailing;
  if (digits === '') return '0';
  return `${sign === '-' ? '-' : ''}${digits}e${power}`;
}

/** `[+-]digits[.digits][e[+-]digits]` — a decimal number written as text. */
const DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function canonicalNumber(value: unknown, at: string): number {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new CanonicalFormError(`${at}: a bigint outside the safe integer range has no number spelling`);
    }
    n = Number(value);
  } else if (typeof value === 'string' && DECIMAL_TEXT.test(value.trim())) {
    const text = value.trim();
    n = Number(text);
    if (Number.isFinite(n) && decimalKey(text) !== decimalKey(String(n))) {
      throw new CanonicalFormError(`${at}: a decimal text that a double cannot carry exactly`);
    }
  } else {
    throw new CanonicalFormError(`${at}: a ${value === null ? 'null' : typeof value} that is not a number`);
  }
  if (!Number.isFinite(n)) throw new CanonicalFormError(`${at}: a non-finite number`);
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) throw new CanonicalFormError(`${at}: an integer outside the safe range`);
  return n === 0 ? 0 : n; // -0 is 0
}

/** `YYYY-MM-DD`. */
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

function canonicalDate(value: unknown, at: string): string {
  if (typeof value === 'string') {
    const match = DATE_TEXT.exec(value.trim());
    if (match) {
      const [, y, m, d] = match;
      const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      if (date.toISOString().slice(0, 10) === value.trim()) return value.trim();
    }
    throw new CanonicalFormError(`${at}: a string that is not a YYYY-MM-DD date`);
  }
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) throw new CanonicalFormError(`${at}: an invalid Date`);
    if (time % 86_400_000 !== 0) {
      throw new CanonicalFormError(`${at}: a Date that is not at UTC midnight names no one day`);
    }
    return value.toISOString().slice(0, 10);
  }
  throw new CanonicalFormError(`${at}: a ${value === null ? 'null' : typeof value} that is not a date`);
}

function canonicalBoolean(value: unknown, at: string): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new CanonicalFormError(`${at}: a ${typeof value} that is not a boolean`);
}

function canonicalJsonValue(value: unknown, at: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new CanonicalFormError(`${at}: a string that does not parse as JSON`);
  }
}

/**
 * One column's value in canonical form, by the rule of the column's declared
 * type ({@link AUDIT_SEAL_TYPE_RULES}).
 *
 *  - absent (`undefined`) and `null` are both `null` — and are committed too,
 *    so a value appearing where there was none is a change;
 *  - a type with no rule is refused, whatever the value.
 *
 * A refusal names `at` and the value's type, never the value: a value column
 * holds audit payloads, and an error message is logged.
 */
export function canonicalValue(value: unknown, field: SealedFieldType | undefined, at = 'value'): unknown {
  const rule = canonRuleOf(field);
  if (rule === null) {
    throw new CanonicalFormError(`${at}: the column's type '${field?.type ?? 'none'}' has no canonical rule`);
  }
  if (value === undefined || value === null) return null;
  switch (rule) {
    case 'text':
      if (typeof value !== 'string') throw new CanonicalFormError(`${at}: a ${typeof value} that is not text`);
      return value;
    case 'number':
      return canonicalNumber(value, at);
    case 'boolean':
      return canonicalBoolean(value, at);
    case 'date':
      return canonicalDate(value, at);
    case 'datetime':
      return canonicalDatetime(value, at);
    case 'json':
      return canonicalJsonValue(value, at);
  }
}

function sha256(...parts: Array<Buffer | Uint8Array>): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/**
 * The commitment of value `v` (already canonical) under `salt`:
 * `SHA-256(salt ‖ JCS(v))`, lowercase hex (D1).
 *
 * A JCS refusal names `at` and the member's POSITION, not its name: a committed
 * JSON value's member names are the payload's own keys, and stay off the log
 * with the rest of it.
 */
export function commitValue(salt: Uint8Array, value: unknown, at = '$'): string {
  return sha256(salt, canonicalJsonBytes(value, { at, opaqueNames: true })).toString('hex');
}

/** The salt of one value column of one row; see `seed.ts`. */
export type ColumnSaltOf = (rowId: string, column: string) => Uint8Array;

/**
 * A row's leaf input (D1): an object of the column set's columns, the clear
 * ones in canonical form and the committed ones as their commitments.
 *
 * `overrides` replaces a committed column's commitment with one given — how a
 * verifier rebuilds the sealed leaf of a row whose redaction amendment it has
 * accepted (D7).
 */
export function leafInput(
  row: Readonly<Record<string, unknown>>,
  columns: SealedColumnSet,
  types: SealedFieldTypes,
  saltOf: ColumnSaltOf,
  overrides?: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const id = rowIdOf(row);
  const leaf: Record<string, unknown> = {};
  for (const column of columns.clear) leaf[column] = canonicalValue(row[column], types[column], `${id}.${column}`);
  for (const column of columns.committed) {
    const at = `${id}.${column}`;
    leaf[column] = overrides?.[column] ?? commitValue(saltOf(id, column), canonicalValue(row[column], types[column], at), at);
  }
  return leaf;
}

/** The domain-separation prefixes of RFC 6962 §2.1: a leaf, an interior node. */
export const LEAF_PREFIX = 0x00;
export const NODE_PREFIX = 0x01;

/** A leaf's hash: `SHA-256(0x00 ‖ JCS(leaf input))`. */
export function leafHash(leaf: Readonly<Record<string, unknown>>): Buffer {
  return sha256(Uint8Array.of(LEAF_PREFIX), canonicalJsonBytes(leaf));
}

/** A row's id as the string every coordinate uses. */
export function rowIdOf(row: Readonly<Record<string, unknown>>): string {
  const id = row.id;
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  throw new CanonicalFormError(`a sealed row carries no usable id (a ${id === null ? 'null' : typeof id})`);
}

/** UTF-16 code-unit order — the order JCS sorts names in, and the leaf order below uses. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rows in leaf order: by canonical `created_at`, then by id (D1). Canonical
 * datetimes share one fixed-width spelling, so their string order is their
 * time order.
 */
export function inLeafOrder<T extends Readonly<Record<string, unknown>>>(rows: readonly T[]): T[] {
  const keyed = rows.map((row) => ({ row, at: canonicalDatetime(row.created_at, `${rowIdOf(row)}.created_at`), id: rowIdOf(row) }));
  keyed.sort((x, y) => compareCodeUnits(x.at, y.at) || compareCodeUnits(x.id, y.id));
  return keyed.map((k) => k.row);
}
