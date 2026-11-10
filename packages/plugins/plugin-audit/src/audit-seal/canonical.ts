// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
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

/** The declared shape the canonical form reads: each field's `type`. */
export type SealedFieldTypes = Readonly<Record<string, { readonly type?: string }>>;

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

/**
 * One column's value in canonical form, by the column's declared type.
 *
 *  - absent (`undefined`) and `null` are both `null` — and are committed too,
 *    so a value appearing where there was none is a change;
 *  - `datetime` → {@link canonicalDatetime};
 *  - `date` → `YYYY-MM-DD`;
 *  - `boolean` → `true`/`false` (a driver's `0`/`1` included);
 *  - anything else as the JSON value it is. A `Date` under any other type is a
 *    datetime; a value JCS cannot write is refused.
 */
export function canonicalValue(value: unknown, type: string | undefined, at = 'value'): unknown {
  if (value === undefined || value === null) return null;
  // `date` first: a driver hands a date column back as a `Date` too.
  if (type === 'date') {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
    return canonicalDatetime(value, at).slice(0, 10);
  }
  if (type === 'datetime' || value instanceof Date) return canonicalDatetime(value, at);
  if (type === 'boolean') {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    throw new CanonicalFormError(`${at}: a ${typeof value} that is not a boolean`);
  }
  return value;
}

function sha256(...parts: Array<Buffer | Uint8Array>): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/**
 * The commitment of value `v` (already canonical) under `salt`:
 * `SHA-256(salt ‖ JCS(v))`, lowercase hex (D1).
 */
export function commitValue(salt: Uint8Array, value: unknown): string {
  return sha256(salt, canonicalJsonBytes(value)).toString('hex');
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
  for (const column of columns.clear) leaf[column] = canonicalValue(row[column], types[column]?.type, `${id}.${column}`);
  for (const column of columns.committed) {
    leaf[column] = overrides?.[column]
      ?? commitValue(saltOf(id, column), canonicalValue(row[column], types[column]?.type, `${id}.${column}`));
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
