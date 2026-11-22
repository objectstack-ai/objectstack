/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The drill list's conditions, as the list's own filter chips
 * (objectstack-ai/objectstack#36256 item 3).
 *
 * A drill hands the list one filter object (the widget filter, the clicked
 * bucket and the measure's scope, composed by `composeDrillFilter`). The list
 * draws the reader's conditions as chips that can be changed and removed, and
 * the view's own filter as locked chips it can only read when it is a rule
 * array. So each condition of the drill that is one field compared with one
 * value becomes a row of the list's filter group (`initialFilters`), drawn as an
 * ordinary chip; everything else (a nested relationship condition, an `$or`, an
 * operator the rows have no id for) stays the list's base `filter`, applied
 * as it was. Both are ANDed, so the list matches the drill exactly until the
 * reader edits a chip.
 *
 * Values must already be resolved (`resolveFilterPlaceholders`): a chip shows
 * what the query compares, never a `{token}`.
 */

import type { FilterBuilderRow, FilterBuilderRowGroup } from '@object-ui/components';

/** The row operator each comparison operator of the filter dialect reads as. */
const ROW_OPERATOR: Readonly<Record<string, FilterBuilderRow['operator']>> = {
  $eq: 'equals',
  $ne: 'not_equals',
  $in: 'in',
  $nin: 'not_in',
  $gt: 'greater_than',
  $gte: 'greater_than_or_equal',
  $lt: 'less_than',
  $lte: 'less_than_or_equal',
  $contains: 'contains',
};

type Scalar = string | number | boolean;

const isScalar = (v: unknown): v is Scalar =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Split a filter into its ANDed single-key parts: `$and` members and the keys of one object. */
function andParts(filter: unknown): Record<string, unknown>[] {
  if (!isPlainObject(filter)) return [];
  const parts: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' && Array.isArray(value)) {
      for (const member of value) parts.push(...andParts(member));
    } else {
      parts.push({ [key]: value });
    }
  }
  return parts;
}

/** The rows one `{ field: condition }` part reads as, or `null` when it is no row. */
function rowsOf(field: string, condition: unknown): Omit<FilterBuilderRow, 'id'>[] | null {
  if (field.startsWith('$')) return null;
  if (isScalar(condition)) return [{ field, operator: 'equals', value: condition }];
  if (!isPlainObject(condition)) return null;
  const entries = Object.entries(condition);
  if (entries.length === 0) return null;
  const rows: Omit<FilterBuilderRow, 'id'>[] = [];
  for (const [op, value] of entries) {
    if (op === '$null' && typeof value === 'boolean') {
      rows.push({ field, operator: value ? 'is_null' : 'is_not_null' });
      continue;
    }
    const operator = ROW_OPERATOR[op];
    if (!operator) return null;
    const list = operator === 'in' || operator === 'not_in';
    if (list ? !Array.isArray(value) || !value.every(isScalar) : !isScalar(value)) return null;
    rows.push({ field, operator, value: value as FilterBuilderRow['value'] });
  }
  return rows;
}

export interface DrillListConditions {
  /** The conditions drawn as the list's chips, its `initialFilters`. */
  chips: FilterBuilderRowGroup;
  /** What no chip can say, kept as the list's base `filter`; `undefined` when nothing is left. */
  rest: Record<string, unknown> | undefined;
}

/**
 * The words the list's chips give a date bound: `before` / `after` lower to
 * the same `<` / `>` as `less_than` / `greater_than`, and are the operators
 * the list's date filter draws, so a half-open date bucket reads 「before
 * 2027-01-01」, not an operator id.
 */
const DATE_ROW_OPERATOR: Readonly<Record<string, FilterBuilderRow['operator']>> = {
  less_than: 'before',
  greater_than: 'after',
};

export interface DrillListConditionOptions {
  /** The fields that hold a date or a date-time (read from the object's definition). */
  dateFields?: ReadonlySet<string>;
}

/** Split a resolved drill filter into chip rows and the rest (see the file header). */
export function drillListConditions(
  filter: Record<string, unknown> | undefined,
  { dateFields }: DrillListConditionOptions = {},
): DrillListConditions {
  const conditions: FilterBuilderRow[] = [];
  const rest: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const part of andParts(filter)) {
    const [field, condition] = Object.entries(part)[0];
    const rows = rowsOf(field, condition);
    if (!rows) {
      rest.push(part);
      continue;
    }
    // A condition stated twice (the widget filter's range and the clicked
    // bucket's) ANDs to itself: one chip says it.
    for (const stated of rows) {
      const dated = dateFields?.has(stated.field) ? DATE_ROW_OPERATOR[stated.operator] : undefined;
      const row = dated ? { ...stated, operator: dated } : stated;
      const key = JSON.stringify([row.field, row.operator, row.value]);
      if (seen.has(key)) continue;
      seen.add(key);
      conditions.push({ ...row, id: `drill-${conditions.length}` });
    }
  }
  return {
    chips: { logic: 'and', conditions },
    rest: rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : { $and: rest },
  };
}

/**
 * The fields a drill's measure scope says hold a value — `{ field: { $null:
 * false } }`, which the dataset answer's `drillScopes` writes for a measure
 * over a field (the spec's `drillScopes` description). Those are the fields
 * the clicked number aggregates, so the list shows them by default.
 */
export function measuredFieldsOf(scope: unknown): string[] {
  return andParts(scope)
    .map((part) => Object.entries(part)[0])
    .filter(([field, c]) => !field.startsWith('$') && isPlainObject(c) && c.$null === false && Object.keys(c).length === 1)
    .map(([field]) => field);
}
