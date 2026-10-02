// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21109, ruling A] The row-level write `check` judges the row AS IT WILL BE
 * STORED.
 *
 * The check runs in-process: `matchesFilterCondition` (`@objectstack/formula`)
 * evaluates the compiled `check` filter against the write's post-image. That
 * image is the payload as a caller or a hook wrote it, before any driver puts a
 * value into its column's storage form. The read the same policy scopes is
 * compiled by the driver, which compares the STORED value against a comparand
 * it has put into the same form. For a `date`, `datetime` or `time` column the
 * two forms differ: a `due_on` written as `'2026-01-05T15:00:00Z'` or as a
 * `Date` is stored as `'2026-01-05'`. So one row got two answers. Measured
 * through `ObjectQL.insert` + `SecurityPlugin` + `SqlDriver` before this step,
 * as a member resolving a permission set:
 *
 * | `check` | written | write | stored | read under the same predicate |
 * |---|---|---|---|---|
 * | `record.due_on == '2026-01-05'` | `'2026-01-05T15:00:00Z'` / a `Date` | 403 | `2026-01-05` | shown |
 * | `record.due_on > '2026-01-05'` | `'2026-01-05T15:00:00Z'` | admitted | `2026-01-05` | hidden |
 * | `record.start_time == '09:00'` | `'09:00:00'` | 403 | `09:00:00` | shown |
 * | `record.due_at == '2026-01-05T10:00:00Z'` | `'2026-01-05T18:00:00+08:00'` | 403 | `2026-01-05T10:00:00.000Z` | shown |
 *
 * ## The step
 *
 * {@link storedFormCheckJudge} is the one step every write-check path passes
 * through (the insert seam, the by-id update image, the update seams), before
 * `matchesFilterCondition` judges a `check` clause. On each column the object
 * DECLARES `date`, `datetime` or `time` (the spec's `CALENDAR_DATE_TYPES`,
 * `INSTANT_TYPES`, `CLOCK_TIME_TYPES`), it puts two things into
 * `@objectstack/core`'s `temporalStorageForm`, the rule the SQL drivers and
 * the memory driver call when they write such a column and when they compare
 * one:
 *
 * - the post-image's value, so the check sees the value that will be stored;
 * - every comparand of the value comparisons on that column (`$eq`, `$ne`, the
 *   four orderings, `$in`, `$nin`, `$between`, and implicit equality), because
 *   the read compares the stored value against the comparand in that form
 *   (`driver-sql`'s `coerceFilterValue`, `driver-memory`'s matcher, objectql's
 *   `having` walker all pair the two). Putting only the image into the form
 *   would refuse a write the read shows whenever a policy spells its comparand
 *   another way: `record.start_time == '09:00'` against a stored `'09:00:00'`.
 *
 * Only the declaration decides which columns: a column the object declares
 * neither temporal nor multi-valued (below) is judged exactly as before,
 * whatever its value looks like, and an object whose schema cannot be loaded
 * hands over no columns, so nothing is put into any form. The types come from
 * the declaration the write check already reads (`declaredComparisonColumns`),
 * never from the values.
 *
 * The rule is total: a value it cannot read (junk, a `{placeholder}`, a
 * `{ $field }` reference) comes back unchanged and is judged as written.
 * Presence (`$exists`, `$null`, `$empty`), the text operators and a
 * `{ $field }` comparand are not compared as values of the column, and are left
 * as written, as the drivers leave them.
 *
 * ## [#21238] A declared multi-valued column: the image only
 *
 * The same raw-versus-stored split held on another column class. A column the
 * object declares multi-valued (the spec's `isMultiValueField`, over the same
 * declared `type` and `multiple`) stores a LIST, and the write door stores a
 * lone scalar as a one-member list: `tags: 'x'` is stored as `['x']`. The
 * insert seam and the by-id update image are formed before that door runs, so
 * judged raw, measured through `ObjectQL.insert` + `SecurityPlugin` + two SQL
 * driver families as a member resolving a permission set:
 *
 * | `check` | written | write | stored | read under the same predicate |
 * |---|---|---|---|---|
 * | `record.tags.contains('x')` | `'x'` | 403 | `["x"]` | shown |
 * | `!record.tags.contains('x')` | `'x'` | admitted | `["x"]` | hidden |
 *
 * So the post-image's value on each such column goes through
 * `@objectstack/core`'s `multiValueStorageForm`, the rule objectql's record
 * validator (`normalizeMultiValueFields`) stores it by. ⛔ No copy of it lives
 * here. The door also leaves out the columns the engine owns (`system` /
 * `readonly`), and the declaration this step reads does not carry those flags.
 * That difference is outside what a caller steers: the engine strips a
 * caller's value on such a column before its own seams, which judge the row it
 * stores, so only a hook's own write there is judged wrapped while it is stored
 * as written — the boundary the insert seam already states for the values the
 * platform owns.
 *
 * The comparands are left as written, because the read pairs none with the
 * wrap: `$contains` / `$notContains` take one MEMBER, and every scalar
 * comparison on such a column is refused by the read
 * (`JSON_COLUMN_INCOMPATIBLE_OPERATORS`), never compared with a list.
 *
 * ## What it does not carry
 *
 * `driver-mongodb` stores these columns through its own copy of the rule
 * (`mongodb-temporal.ts`), not through `temporalStorageForm`. Measured shape by
 * shape, the two agree on every value the write door admits, a `datetime`
 * being the same instant in the driver's BSON `Date`, except one: a `Date` in a
 * UTC year from 0001 to 0999 written to a `date` column, whose year that copy
 * leaves unpadded (`999-06-15`). This step judges the four-digit form the
 * rule declares.
 */

import { multiValueStorageForm, temporalStorageForm, type TemporalComparandKind } from '@objectstack/core';
import { matchesFilterCondition, type MatchesFilterOptions } from '@objectstack/formula';
import {
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  INSTANT_TYPES,
  filterSubtreeProvenanceOf,
  isMultiValueField,
  markFilterSubtreeProvenance,
} from '@objectstack/spec/data';

/** The declared temporal columns of one object, by name, each with its storage rule's kind. */
export type DeclaredTemporalColumns = ReadonlyMap<string, TemporalComparandKind>;

/** [#21238] The declared multi-valued columns of one object, by name. */
export type DeclaredMultiValueColumns = ReadonlySet<string>;

const NO_MULTI_VALUE_COLUMNS: DeclaredMultiValueColumns = new Set();

/**
 * The operators whose comparand is a VALUE of the column, compared with the
 * stored value. The drivers put these comparands into the column's storage
 * form; every other operator's operand is left as written.
 */
const VALUE_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$between',
]);

/** The value-comparison operators whose comparand is a LIST of values. */
const LIST_COMPARAND_OPERATORS: ReadonlySet<string> = new Set(['$in', '$nin', '$between']);

/** The storage rule a declared type takes, or `undefined` for a non-temporal type. */
function temporalKindOfDeclaredType(type: string): TemporalComparandKind | undefined {
  if (CALENDAR_DATE_TYPES.has(type)) return 'date';
  if (INSTANT_TYPES.has(type)) return 'datetime';
  if (CLOCK_TIME_TYPES.has(type)) return 'time';
  return undefined;
}

/**
 * The columns `columns` declares `date`, `datetime` or `time`. Empty when the
 * object hands over no declaration.
 */
export function declaredTemporalColumns(columns: MatchesFilterOptions | undefined): DeclaredTemporalColumns {
  const out = new Map<string, TemporalComparandKind>();
  for (const [name, decl] of Object.entries(columns?.fields ?? {})) {
    const kind = temporalKindOfDeclaredType(decl.type);
    if (kind) out.set(name, kind);
  }
  return out;
}

/**
 * [#21238] The columns `columns` declares multi-valued — the spec's
 * `isMultiValueField` over each column's declared `type` and `multiple`, the
 * one predicate the write door asks. Empty when the object hands over no
 * declaration.
 */
export function declaredMultiValueColumns(columns: MatchesFilterOptions | undefined): DeclaredMultiValueColumns {
  const out = new Set<string>();
  for (const [name, decl] of Object.entries(columns?.fields ?? {})) {
    if (isMultiValueField({ type: decl.type, multiple: decl.multiple === true })) out.add(name);
  }
  return out;
}

/** A plain object: a filter node, an operator map or a `{ $field }` reference — never a comparand value. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Copy the filter-subtree provenance mark of `from` onto `to`, the node replacing it. */
function carryProvenance<T>(from: unknown, to: T): T {
  const mark = filterSubtreeProvenanceOf(from);
  return mark === null ? to : markFilterSubtreeProvenance(to, mark);
}

/** One comparand in its column's storage form; a reference or any other structure as written. */
function storedComparand(value: unknown, kind: TemporalComparandKind): unknown {
  if (isPlainObject(value) || Array.isArray(value)) return value;
  return temporalStorageForm(value, kind);
}

/** A value-comparison operand in its column's storage form, a list member by member. */
function storedOperand(op: string, value: unknown, kind: TemporalComparandKind): unknown {
  if (!LIST_COMPARAND_OPERATORS.has(op) || !Array.isArray(value)) return storedComparand(value, kind);
  let copy: unknown[] | undefined;
  value.forEach((member, index) => {
    const stored = storedComparand(member, kind);
    if (stored !== member) {
      copy ??= [...value];
      copy[index] = stored;
    }
  });
  return copy ? carryProvenance(value, copy) : value;
}

/** One column's constraint with its comparands in the column's storage form. */
function storedColumnSpec(spec: unknown, kind: TemporalComparandKind): unknown {
  if (!isPlainObject(spec)) return Array.isArray(spec) ? spec : storedComparand(spec, kind);
  // A plain object under a column is an operator map, or a `{ $field }`
  // reference in implicit-equality position, which is left as written.
  if (!Object.keys(spec).some((k) => k.startsWith('$')) || '$field' in spec) return spec;
  let out: Record<string, unknown> | undefined;
  for (const [op, operand] of Object.entries(spec)) {
    if (!VALUE_COMPARISON_OPERATORS.has(op)) continue;
    const stored = storedOperand(op, operand, kind);
    if (stored !== operand) {
      out ??= { ...spec };
      out[op] = stored;
    }
  }
  return out ? carryProvenance(spec, out) : spec;
}

/**
 * `filter` with every value comparand on a declared temporal column in that
 * column's storage form. Copy-on-write: a subtree nothing rewrote is returned
 * by reference, so a filter with nothing to put into a form comes back as the
 * SAME object, and a rewritten node carries the provenance mark of the node it
 * replaces.
 */
export function storedFormCheckFilter<T>(filter: T, columns: DeclaredTemporalColumns): T {
  if (columns.size === 0 || !isPlainObject(filter)) return filter;
  const node = filter as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  const replace = (key: string, value: unknown): void => {
    out ??= { ...node };
    out[key] = value;
  };
  for (const [key, value] of Object.entries(node)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) continue;
      let copy: unknown[] | undefined;
      value.forEach((child, index) => {
        const stored = storedFormCheckFilter(child, columns);
        if (stored !== child) {
          copy ??= [...value];
          copy[index] = stored;
        }
      });
      if (copy) replace(key, carryProvenance(value, copy));
      continue;
    }
    if (key === '$not') {
      const stored = storedFormCheckFilter(value, columns);
      if (stored !== value) replace(key, stored);
      continue;
    }
    // Any other `$` key is not a column: left as written, for the evaluator
    // that owns its answer.
    if (key.startsWith('$')) continue;
    const kind = columns.get(key);
    if (!kind) continue;
    const stored = storedColumnSpec(value, kind);
    if (stored !== value) replace(key, stored);
  }
  return (out ? carryProvenance(node, out) : filter) as T;
}

/**
 * `image` with every declared temporal column's value in its storage form, and
 * [#21238] every declared multi-valued column's value in the form the write
 * door stores it in (`multiValueStorageForm`) — the row the driver will store.
 * Copy-on-write: the caller's image is never mutated, and an image with
 * nothing to put into a form comes back as the SAME object.
 */
export function storedFormImage(
  image: Record<string, unknown>,
  columns: DeclaredTemporalColumns,
  multiValue: DeclaredMultiValueColumns = NO_MULTI_VALUE_COLUMNS,
): Record<string, unknown> {
  let out: Record<string, unknown> | undefined;
  const put = (column: string, value: unknown, stored: unknown): void => {
    if (stored === value) return;
    out ??= { ...image };
    out[column] = stored;
  };
  for (const [column, kind] of columns) {
    if (!Object.prototype.hasOwnProperty.call(image, column)) continue;
    const value = image[column];
    put(column, value, temporalStorageForm(value, kind));
  }
  for (const column of multiValue) {
    if (!Object.prototype.hasOwnProperty.call(image, column)) continue;
    const value = image[column];
    put(column, value, multiValueStorageForm(value));
  }
  return out ?? image;
}

/**
 * The write check's judge: does an image satisfy every compiled `check` part,
 * judged on the stored form (see the module note)? The parts are put into the
 * form once, here; each image is put into it per call. `columns` is the
 * object's declaration as the evaluator reads it, and is also handed to
 * `matchesFilterCondition` unchanged, so its comparison-class refusal and its
 * `$contains` reading are what they were.
 *
 * A refusal the evaluator raises propagates unchanged. The parts the caller
 * attributes it to are its own: the rewritten parts are used for evaluation
 * only.
 */
export function storedFormCheckJudge(
  parts: readonly Record<string, unknown>[],
  columns: MatchesFilterOptions | undefined,
): (image: Record<string, unknown>) => boolean {
  const temporal = declaredTemporalColumns(columns);
  const multiValue = declaredMultiValueColumns(columns);
  // The comparands are put into the temporal form only: on a multi-valued
  // column the read pairs no comparand with the wrap (see the module note).
  const storedParts = parts.map((part) => storedFormCheckFilter(part, temporal));
  return (image) => {
    const stored = storedFormImage(image, temporal, multiValue);
    return storedParts.every((part) => matchesFilterCondition(stored, part as never, columns));
  };
}
