/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The pure half of the list's condition row (filter and sort chips): which
 * value control a field takes, what a quick pick writes into the filter group,
 * how a condition reads as a chip, and how the sort array is reordered.
 *
 * Nothing here invents a storage shape. A quick pick writes ordinary rows of
 * the advanced panel's own group (`FilterBuilderRowGroup`, the operators of
 * `FILTER_BUILDER_OPERATORS`), so the host stores, persists and lowers them
 * exactly as it stores a row written in the advanced panel; a sort chip edits
 * the same `SortItem[]` the sort panel and the column header write.
 */

import {
  FILTER_DATE_LIKE_TYPES,
  FILTER_LOOKUP_LIKE_TYPES,
  FILTER_NUMBER_LIKE_TYPES,
  FILTER_SELECT_LIKE_TYPES,
} from '@object-ui/types';
import { jsonColumnFilterOperators } from '@object-ui/components';
import type { FilterBuilderRow, FilterBuilderRowGroup, SortItem } from '@object-ui/components';

/** One field the condition controls can name: the shape the list's field lists already carry. */
export interface ConditionField {
  value: string;
  label: string;
  type?: string;
  /** The field's declared `multiple` flag: with the type, whether its value is a list. */
  multiple?: boolean;
  options?: ReadonlyArray<{ value: string | number | boolean; label: string; color?: string }>;
  referenceTo?: string;
  displayField?: string;
  idField?: string;
  /** Listed but not choosable anew (a sort the list keeps only because it is in use). */
  disabled?: boolean;
}

/** The value control a field's type takes in the quick filter. */
export type QuickFilterFamily = 'option' | 'lookup' | 'text' | 'number' | 'date' | 'boolean';

const NUMBER_TYPES: ReadonlySet<string> = new Set<string>(FILTER_NUMBER_LIKE_TYPES);
const DATE_TYPES: ReadonlySet<string> = new Set<string>(FILTER_DATE_LIKE_TYPES);
const SELECT_TYPES: ReadonlySet<string> = new Set<string>(FILTER_SELECT_LIKE_TYPES);
const LOOKUP_TYPES: ReadonlySet<string> = new Set<string>(FILTER_LOOKUP_LIKE_TYPES);

export function quickFilterFamily(field: Pick<ConditionField, 'type' | 'options'> | undefined): QuickFilterFamily {
  const type = field?.type ?? 'text';
  if (type === 'boolean') return 'boolean';
  if (NUMBER_TYPES.has(type)) return 'number';
  if (DATE_TYPES.has(type)) return 'date';
  if (LOOKUP_TYPES.has(type)) return field?.options?.length ? 'option' : 'lookup';
  if (SELECT_TYPES.has(type) || (field?.options?.length ?? 0) > 0) return 'option';
  return 'text';
}

/**
 * The operators the quick filter offers per family, first one the default.
 * Every id is one the advanced panel draws for the same type and one the
 * list's query lowering maps, so a quick row reopens in the advanced panel as
 * the same row.
 */
export const QUICK_FILTER_OPERATORS: Readonly<Record<QuickFilterFamily, readonly FilterBuilderRow['operator'][]>> = {
  option: ['in', 'not_in', 'is_empty', 'is_not_empty'],
  lookup: ['in', 'not_in', 'is_empty', 'is_not_empty'],
  text: ['contains', 'not_contains', 'equals', 'starts_with', 'is_empty', 'is_not_empty'],
  number: ['greater_than_or_equal', 'less_than_or_equal', 'equals', 'between'],
  date: ['between', 'before', 'after', 'is_empty', 'is_not_empty'],
  boolean: ['equals'],
};

/**
 * The operators the quick filter offers for one field, first one the default.
 *
 * A field stored as a JSON column (a multi-value field, or a structured-JSON
 * type) takes the advanced panel's own JSON-column set,
 * `jsonColumnFilterOperators` — the one helper both surfaces read, so the
 * quick filter never offers an operator the server refuses on such a field
 * (`等于` / `属于` on a multi-select answer `400 INVALID_FILTER`). Every other
 * field takes its family's list.
 */
export function quickFilterOperators(
  field: Pick<ConditionField, 'type' | 'options' | 'multiple'> | undefined,
): readonly FilterBuilderRow['operator'][] {
  return jsonColumnFilterOperators(field) ?? QUICK_FILTER_OPERATORS[quickFilterFamily(field)];
}

export function defaultQuickOperator(field: ConditionField | undefined): FilterBuilderRow['operator'] {
  return quickFilterOperators(field)[0];
}

const VALUELESS: ReadonlySet<string> = new Set(['is_empty', 'is_not_empty', 'is_null', 'is_not_null']);

export function isValuelessOperator(operator: string): boolean {
  return VALUELESS.has(operator);
}

/** The value a row on `operator` starts from when the operator changes. */
export function seedValueFor(operator: string, previous: FilterBuilderRow['value']): FilterBuilderRow['value'] {
  if (isValuelessOperator(operator)) return undefined;
  const list = operator === 'in' || operator === 'not_in';
  const pair = operator === 'between';
  if (list) return Array.isArray(previous) ? previous : previous === undefined || previous === null || previous === '' ? [] : [previous as string];
  if (pair) return Array.isArray(previous) && previous.length === 2 ? previous : [];
  if (Array.isArray(previous)) return previous.length === 1 ? previous[0] : '';
  return previous ?? '';
}

let rowCounter = 0;
/** A row id unique within the session; the advanced panel keys its rows on it. */
export function newConditionId(): string {
  rowCounter += 1;
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${rowCounter}`;
  return `quick-${random}`;
}

/** The group with one row replaced (by id), or appended when no row has that id. */
export function upsertCondition(group: FilterBuilderRowGroup, row: FilterBuilderRow): FilterBuilderRowGroup {
  const rows = group.conditions ?? [];
  const at = rows.findIndex((c) => c.id === row.id);
  const conditions = at === -1 ? [...rows, row] : rows.map((c, i) => (i === at ? row : c));
  return { ...group, conditions };
}

export function removeCondition(group: FilterBuilderRowGroup, id: string): FilterBuilderRowGroup {
  return { ...group, conditions: (group.conditions ?? []).filter((c) => c.id !== id) };
}

/**
 * Can each row of the group be drawn as its own chip? Only when the rows are
 * ANDed (or there is one): an OR group means the rows only hold together, so
 * the row draws them as one chip that opens the advanced panel.
 */
export function chipsAreIndependent(group: FilterBuilderRowGroup): boolean {
  return (group.conditions ?? []).length <= 1 || (group.logic ?? 'and') === 'and';
}

/** Move one entry of the sort array; priority is array order. */
export function moveSortItem(items: readonly SortItem[], from: number, to: number): SortItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Add a sort level on `field`, or — when the field already sorts the list —
 * set that level's direction. A field never sorts twice.
 */
export function addSortLevel(items: readonly SortItem[], field: string, order: 'asc' | 'desc', id: string): SortItem[] {
  const at = items.findIndex((item) => item.field === field);
  if (at !== -1) return items.map((item, i) => (i === at ? { ...item, order } : item));
  return [...items, { id, field, order }];
}

/** The direction words a sort chip uses, by field type: time, size or the alphabet. */
export type SortWording = 'time' | 'size' | 'alphabet';

export function sortWording(type: string | undefined): SortWording {
  if (type && DATE_TYPES.has(type)) return 'time';
  if (type && (NUMBER_TYPES.has(type) || type === 'boolean')) return 'size';
  return 'alphabet';
}

/** One condition of the view's own filter, read for a locked chip. */
export interface ViewConditionChip {
  key: string;
  /**
   * The field the condition compares. A condition on a related record's field
   * (the nested-relation form) names it as a path, `<lookup>.<field>`; see
   * {@link relationPathOf}.
   */
  field?: string;
  operator?: string;
  value?: unknown;
  /** Set when the element is an any-of group: its members, read the same way. */
  anyOf?: ViewConditionChip[];
}

/**
 * The view's own filter as locked chips, one per element of its list.
 *
 * A rule `{ field, operator, value }` and a triple `[field, op, value]` are
 * one chip each; an any-of group `{ or: [...] }` is one chip of its members.
 *
 * A condition on one field of a related record, the nested-relation form
 * `{ <lookup>: { <field>: V } }`, is one chip on the path `<lookup>.<field>`
 * that equals `V`. It reaches the list either as written, or lowered to the
 * triple `[<lookup>, '=', { <field>: V }]` (`toFilterNode` lowers the nested
 * form to that equality, and a drill's base filter arrives that way).
 *
 * Any other shape (a MongoDB-style object, an `and` / `or` AST node, a nested
 * condition on more than one field or with an operator) is one chip with no
 * field, which the row names as the view's condition: what the view filters
 * is still shown to be there, and nothing is guessed about it.
 */
export function readViewConditions(filter: unknown): ViewConditionChip[] {
  if (filter === null || filter === undefined) return [];
  if (!Array.isArray(filter)) {
    if (typeof filter === 'object' && Object.keys(filter as object).length === 0) return [];
    return [nestedRelationChip(filter, 'view-0') ?? { key: 'view-0' }];
  }
  if (filter.length === 0) return [];
  // A single triple at the top: `['status', '=', 'open']`.
  if (isTriple(filter)) return [tripleChip(filter, 'view-0')];
  // A whole AST node at the top: `['and', [...], [...]]`.
  if (typeof filter[0] === 'string') return [{ key: 'view-0' }];
  return filter.map((element, index) => readElement(element, `view-${index}`));
}

function isTriple(value: unknown): value is [string, string, unknown] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string' &&
    value[0] !== 'and' &&
    value[0] !== 'or'
  );
}

function tripleChip(triple: [string, string, unknown], key: string): ViewConditionChip {
  // A record in the value slot is a condition on the related record, never a
  // value to print: the nested-relation equality, or a field-less chip.
  if (isPlainRecord(triple[2])) {
    return (triple[1] === '=' ? relationChip(triple[0], triple[2], key) : undefined) ?? { key };
  }
  return { key, field: triple[0], operator: triple[1], value: triple[2] };
}

function readElement(element: unknown, key: string): ViewConditionChip {
  if (isTriple(element)) return tripleChip(element, key);
  if (isPlainRecord(element)) {
    const record = element;
    if (Array.isArray(record.or)) {
      return { key, anyOf: record.or.map((member, i) => readElement(member, `${key}-${i}`)) };
    }
    if (typeof record.field === 'string' && typeof record.operator === 'string') {
      return { key, field: record.field, operator: record.operator, value: record.value };
    }
    const nested = nestedRelationChip(record, key);
    if (nested) return nested;
  }
  return { key };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The nested-relation form as written, `{ <lookup>: { <field>: V } }`, as a path chip. */
function nestedRelationChip(filter: unknown, key: string): ViewConditionChip | undefined {
  if (!isPlainRecord(filter)) return undefined;
  const entries = Object.entries(filter);
  if (entries.length !== 1) return undefined;
  const [lookup, condition] = entries[0];
  return isPlainRecord(condition) ? relationChip(lookup, condition, key) : undefined;
}

/**
 * One related field equal to one value, `{ <field>: V }` under `<lookup>`, as
 * the chip on `<lookup>.<field>`. Anything else (several fields, an operator
 * map, a deeper relation, a `$` key) is not read: `undefined`.
 */
function relationChip(lookup: string, condition: Record<string, unknown>, key: string): ViewConditionChip | undefined {
  if (lookup.startsWith('$') || lookup.includes('.')) return undefined;
  const entries = Object.entries(condition);
  if (entries.length !== 1) return undefined;
  const [field, value] = entries[0];
  if (field.startsWith('$') || field.includes('.')) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
  return { key, field: `${lookup}.${field}`, operator: 'equals', value };
}

/**
 * A chip field that names a related record's field, `<lookup>.<field>`, split
 * into its two names; `undefined` for a field of the list's own object.
 */
export function relationPathOf(field: string | undefined): { lookup: string; field: string } | undefined {
  if (!field) return undefined;
  const at = field.indexOf('.');
  if (at <= 0 || at === field.length - 1 || field.indexOf('.', at + 1) !== -1) return undefined;
  return { lookup: field.slice(0, at), field: field.slice(at + 1) };
}
