/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * sort-values — reduce a *cell value* to the primitive a CLIENT-SIDE sort should
 * order by, and compare two of those primitives (objectui#3096).
 *
 * Why this exists: a relational column (`lookup` / `master_detail` / `tree` /
 * `user` — see `EXPANDABLE_FIELD_TYPES`) does not hold the string its cell
 * shows. Depending on the surface it holds either the `$expand`-ed related
 * RECORD (`{ id, name, … }`) or a raw foreign-key id whose label was resolved
 * separately. Both break the naive comparators these surfaces used to inline:
 *
 *   - `a[col] < b[col]` on two objects is ALWAYS false, so the comparator
 *     collapses to the constant `1` and the "sort" permutes rows into an order
 *     with no relation to anything on screen;
 *   - `String(a[col])` on an object is `"[object Object]"` — every row compares
 *     equal, so the sort silently does nothing;
 *   - comparing raw ids (`rec_7f3…`) orders a column of human-readable names by
 *     an opaque key, which reads to the user as "sorting is broken".
 *
 * Reducing the value to the label the cell renders makes a client-side sort
 * order by what the user actually sees. This CANNOT fix a server `$orderby`,
 * where the sort key is the stored id by construction — surfaces that sort on
 * the server must instead not offer relational columns as sort keys (that half
 * of #3096 lives at each entry point).
 *
 * Pure (no React / i18n), so every renderer package can share it.
 */

import { getRecordDisplayName } from './record-title.js';

/** A cell value reduced to something two rows can be ordered by. */
export type SortValue = string | number | boolean | null;

export interface SortValueOptions {
  /**
   * `id → label` map for relational columns whose cell value is still a RAW id
   * because the surface resolves labels client-side instead of asking the
   * server for `$expand` (RelatedList does exactly this). When the raw value
   * has an entry, the label the cell renders becomes the sort key.
   */
  labels?: Record<string, string>;
}

/**
 * Reduce one cell value to the primitive a client-side sort should order by.
 *
 * - empty (`null` / `undefined` / `''`) → `null`, so callers can place blanks
 *   consistently rather than sorting `undefined` against a string;
 * - a `labels` hit (by the raw id) wins — that IS the string in the cell;
 * - an expanded reference record resolves through {@link getRecordDisplayName},
 *   the ONE shared display-name resolver (ADR-0079), so the sort key and the
 *   lookup cell agree on which field names a record;
 * - arrays join their resolved parts, mirroring how a multi-value cell reads;
 * - primitives pass through unchanged (numbers stay numbers, so a number column
 *   still sorts numerically rather than lexicographically).
 */
export function getSortValue(value: unknown, options?: SortValueOptions): SortValue {
  if (value === null || value === undefined || value === '') return null;

  const labels = options?.labels;

  if (typeof value === 'string') {
    return labels?.[value] ?? value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // A numeric foreign key still deserves its resolved label.
    return labels?.[String(value)] ?? value;
  }

  if (typeof value === 'boolean') return value;

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => getSortValue(entry, options))
      .filter((entry): entry is Exclude<SortValue, null> => entry !== null)
      .map((entry) => String(entry));
    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // An expanded record can still carry a client-resolved label (the surface
    // built its map from ids, the server expanded the same field).
    const id = record.id ?? record._id;
    if (id !== null && id !== undefined) {
      const mapped = labels?.[String(id)];
      if (mapped) return mapped;
    }
    // `fallback: ''` so a record with nothing name-like reduces to `null`
    // (sorted with the blanks) instead of the literal string "Untitled",
    // which would bunch unrelated empty records under "U".
    const name = getRecordDisplayName(undefined, record, { fallback: '' });
    return name === '' ? null : name;
  }

  return String(value);
}

/**
 * Compare two {@link SortValue}s **ascending**.
 *
 * Callers negate the result for descending, which is also why blanks are placed
 * last here rather than "always last": negating moves them to the front, the
 * same convention the inline comparators this replaces already had.
 *
 * Same-typed values compare in their own domain (numbers numerically, booleans
 * false-before-true); anything else falls back to a locale-aware string compare
 * with `numeric: true`, so `Item 2` precedes `Item 10`.
 */
export function compareSortValues(a: SortValue, b: SortValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Convenience wrapper: reduce both cell values and compare them ascending.
 *
 * Prefer resolving the sort key ONCE per row (decorate → sort → undecorate)
 * when sorting a whole collection — `getRecordDisplayName` walks the record, so
 * calling it inside the comparator repeats that walk `O(n log n)` times.
 */
export function compareCellValues(
  a: unknown,
  b: unknown,
  options?: SortValueOptions,
): number {
  return compareSortValues(getSortValue(a, options), getSortValue(b, options));
}
