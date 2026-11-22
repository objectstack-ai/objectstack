/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** The spec `sort` union a related list declares: `'field'` / `'-field'`, or `[{ field, order }]`. */
export type RelatedListSortSpec = string | Array<{ field: string; order: 'asc' | 'desc' }>;

/**
 * A related list's declared sort as the row read sends it (`$orderby`): the
 * spec `sort` union normalized into the object-array form. The record page's
 * payload asks a list's first rows in this order (objectstack#27627), so a
 * compact card can take them.
 */
export function normalizeSortSpec(
  sort: RelatedListSortSpec | undefined,
): Array<{ field: string; order: 'asc' | 'desc' }> {
  if (!sort) return [];
  if (typeof sort === 'string') {
    const trimmed = sort.trim();
    if (!trimmed) return [];
    return trimmed.startsWith('-')
      ? [{ field: trimmed.slice(1), order: 'desc' }]
      : [{ field: trimmed, order: 'asc' }];
  }
  return sort.filter((s) => !!s?.field);
}
