/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * URL persistence for a list's end-user state (ADR-0047) — the ONE module that
 * owns the `uf_` search-param family.
 *
 * Quick-filter selections live in `uf_<field>` search params (comma-joined
 * values, each URI-encoded so literal commas survive); the active tab preset is
 * carried as `uf__tab=<tabId>` via the reserved `_tab` key. Mirroring the state
 * into the URL makes filter selections survive a reload and makes filtered
 * lists shareable as links — Airtable Interfaces parity.
 *
 * objectui#11860 extends the same family, under four more reserved keys, to
 * the rest of the list toolbar's state — the maintainer's contract for the list
 * surface: views, filters, sort and grouping go into the URL, transient panels
 * and dialogs do not. Each value is a spec shape serialized as JSON, never a
 * grammar of this module's own:
 *
 * | Param        | Carries                                   | Shape                                   |
 * |--------------|-------------------------------------------|-----------------------------------------|
 * | `uf__filter` | the Filter panel's conditions             | `{ logic, conditions }`, each condition one spec `ViewFilterRule` |
 * | `uf__search` | the search term                           | the term itself                         |
 * | `uf__sort`   | the sort                                  | the spec `ListViewSchema.sort` array    |
 * | `uf__group`  | the toolbar grouping                      | the spec `GroupingConfig`               |
 *
 * - `uf__filter` is the FilterBuilder group (`FilterBuilderRowGroup`, derived
 *   from `@object-ui/types`' `FilterGroup` — `logic` is its own key) with
 *   every row folded to the spec's `ViewFilterRule` (`{ field, operator, value }`) through
 *   `foldFilterGroupToSpecRules`, the fold "save as view" uses: blank and
 *   unfinished rows are not written, row ids are stripped, operators are
 *   canonical. The rule list alone is the shape `ListViewSchema.filter`
 *   stores, and it is AND-only; the panel also offers OR, so `logic` travels
 *   beside it. The filter AST (`@objectstack/spec/data`) was measured and
 *   refused for this: it is the query dialect, and a round trip through it
 *   loses the row the user built (`before` comes back as `less_than`, an `in`
 *   row comes back expanded into an OR of equalities).
 * - Reading is strict and quiet: a value that does not parse, a condition the
 *   spec's `ViewFilterRuleSchema` refuses, a sort entry `ListViewSchema.sort`
 *   refuses, a grouping level or envelope `GroupingConfigSchema` refuses, and
 *   an entry naming a field the caller does not accept are each DROPPED, and
 *   the list still opens. Nothing here throws.
 * - `uf__group` has no empty form: the spec's `GroupingConfig` requires at
 *   least one level, so a cleared grouping deletes the param, and a list
 *   opened without it shows the grouping its view declares.
 */

import { GroupingConfigSchema, ListViewSchema, ViewFilterRuleSchema } from '@objectstack/spec/ui';
import type { GroupingConfig, ViewFilterRule } from '@objectstack/spec/ui';
import type { FilterBuilderRowGroup } from '@object-ui/components';
import { toFilterGroup } from '@object-ui/plugin-view';
import { foldFilterGroupToSpecRules } from './viewFilterFold.js';

const PREFIX = 'uf_';

/** The Filter panel's conditions (objectui#11860). */
export const LIST_FILTER_PARAM = `${PREFIX}_filter`;
/** The list's search term (objectui#11860). */
export const LIST_SEARCH_PARAM = `${PREFIX}_search`;
/** The list's sort (objectui#11860). */
export const LIST_SORT_PARAM = `${PREFIX}_sort`;
/** The list's toolbar grouping (objectui#11860). */
export const LIST_GROUP_PARAM = `${PREFIX}_group`;

/**
 * The reserved keys that are list state, not quick-filter selections. Kept out
 * of {@link parseUserFilterParams}, whose result is handed to `UserFilters` as
 * `initialSelections` — a field-keyed map with `_tab` as its only reserved key.
 */
const LIST_STATE_PARAMS: ReadonlySet<string> = new Set([
  LIST_FILTER_PARAM,
  LIST_SEARCH_PARAM,
  LIST_SORT_PARAM,
  LIST_GROUP_PARAM,
]);

/** Read `uf_*` params into the UserFilters `initialSelections` shape. */
export function parseUserFilterParams(
  searchParams: URLSearchParams,
): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  searchParams.forEach((value, key) => {
    if (key.startsWith(PREFIX) && value !== '' && !LIST_STATE_PARAMS.has(key)) {
      const field = key.slice(PREFIX.length);
      out[field] = value.split(',').map(v => {
        try { return decodeURIComponent(v); } catch { return v; }
      });
    }
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Mirror a selections payload into a copy of the given params. Only the
 * fields present in `selections` are touched — empty value lists delete
 * their param. Returns the next URLSearchParams (caller decides replace).
 */
export function applyUserFilterParams(
  prev: URLSearchParams,
  selections: Record<string, Array<string | number | boolean>>,
): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [field, values] of Object.entries(selections)) {
    const key = PREFIX + field;
    if (values && values.length > 0) {
      next.set(key, values.map(v => encodeURIComponent(String(v))).join(','));
    } else {
      next.delete(key);
    }
  }
  return next;
}

/**
 * The `uf_*` params of a URL, serialized in their order — every piece of list
 * state the URL carries, quick filters included. Empty when it carries none.
 *
 * A host compares two of these to tell list state it wrote itself from list
 * state that arrived with the URL (an opened link).
 */
export function userFilterParamsKey(searchParams: URLSearchParams): string {
  const own = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key.startsWith(PREFIX) && value !== '') own.append(key, value);
  });
  return own.toString();
}

/** One sort entry, in the spec's `ListViewSchema.sort` element shape. */
export interface ListSortRule {
  field: string;
  order: 'asc' | 'desc';
}

/** The list state a URL carries, read by {@link parseListStateParams}. */
export interface ListUrlState {
  /** The Filter panel's group, ready for `ListView`'s `initialFilters`. */
  filters?: FilterBuilderRowGroup;
  /** The search term, ready for `ListView`'s `initialSearchTerm`. */
  search?: string;
  /** The sort, in the spec's `ListViewSchema.sort` shape. */
  sort?: ListSortRule[];
  /** The grouping, in the spec's `GroupingConfig` shape — ready for `schema.grouping`. */
  grouping?: GroupingConfig;
}

/**
 * Which fields a URL may name. A host answers from the object it renders: a
 * field the object does not declare (a stale link) or one the user cannot read
 * is refused, and the entry naming it is dropped.
 */
export type ListUrlFieldGate = (field: string) => boolean;

const SORT_ENTRY_SCHEMA = ListViewSchema.shape.sort.unwrap().element;
const GROUPING_LEVEL_SCHEMA = GroupingConfigSchema.shape.fields.element;

function parseJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseFilterParam(raw: string | null, acceptField: ListUrlFieldGate): FilterBuilderRowGroup | undefined {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const { logic, conditions } = parsed as { logic?: unknown; conditions?: unknown };
  if ((logic !== 'and' && logic !== 'or') || !Array.isArray(conditions)) return undefined;
  const rules: ViewFilterRule[] = [];
  for (const condition of conditions) {
    const rule = ViewFilterRuleSchema.safeParse(condition);
    if (rule.success && acceptField(rule.data.field)) rules.push(rule.data);
  }
  if (rules.length === 0) return undefined;
  // The READ direction a stored view's filter already takes into the builder
  // (`toFilterGroup`, `@object-ui/plugin-view`): one row per rule, a fresh
  // row id each — ids are React keys, never carried in the URL.
  return { ...toFilterGroup(rules), logic };
}

function parseSortParam(raw: string | null, acceptField: ListUrlFieldGate): ListSortRule[] | undefined {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return undefined;
  const sort: ListSortRule[] = [];
  for (const entry of parsed) {
    const item = SORT_ENTRY_SCHEMA.safeParse(entry);
    if (item.success && acceptField(item.data.field)) {
      sort.push({ field: item.data.field, order: item.data.order });
    }
  }
  // An EMPTY array is a sort the user cleared, and it is kept: on a view that
  // declares a default sort, "no sort" and "the view's sort" differ. A param
  // whose every entry was dropped carries no sort at all.
  return parsed.length === 0 || sort.length > 0 ? sort : undefined;
}

function parseGroupingParam(raw: string | null, acceptField: ListUrlFieldGate): GroupingConfig | undefined {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const { fields } = parsed as { fields?: unknown };
  if (!Array.isArray(fields)) return undefined;
  // Level by level, as the sort is read entry by entry: a level the spec
  // refuses, or one naming a field the caller does not accept, is dropped and
  // the levels around it keep their order.
  const levels: GroupingConfig['fields'] = [];
  for (const entry of fields) {
    const level = GROUPING_LEVEL_SCHEMA.safeParse(entry);
    if (level.success && acceptField(level.data.field)) levels.push(level.data);
  }
  if (levels.length === 0) return undefined;
  // The envelope is the spec's too: a key `GroupingConfigSchema` does not
  // declare beside `fields` drops the whole value.
  const config = GroupingConfigSchema.safeParse({ ...parsed, fields: levels });
  return config.success ? config.data : undefined;
}

/**
 * Read the list state a URL carries. Each piece is `undefined` when the URL
 * does not carry it, or when nothing in it survives the checks above.
 */
export function parseListStateParams(
  searchParams: URLSearchParams,
  acceptField: ListUrlFieldGate,
): ListUrlState {
  const state: ListUrlState = {};
  const filters = parseFilterParam(searchParams.get(LIST_FILTER_PARAM), acceptField);
  if (filters) state.filters = filters;
  const search = searchParams.get(LIST_SEARCH_PARAM);
  if (search) state.search = search;
  const sort = parseSortParam(searchParams.get(LIST_SORT_PARAM), acceptField);
  if (sort) state.sort = sort;
  const grouping = parseGroupingParam(searchParams.get(LIST_GROUP_PARAM), acceptField);
  if (grouping) state.grouping = grouping;
  return state;
}

/** What a list reports to write: each piece present is written, `undefined` deletes. */
export interface ListStatePatch {
  filters?: FilterBuilderRowGroup | null;
  search?: string | null;
  sort?: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }> | null;
  grouping?: GroupingConfig | null;
}

function serializeFilterGroup(group: FilterBuilderRowGroup | null | undefined): string | undefined {
  if (!group) return undefined;
  // Folded as AND so the fold judges the ROWS only; the group's own `logic`
  // travels beside them (see the module header).
  const folded = foldFilterGroupToSpecRules({ ...group, logic: 'and' });
  if (!folded.ok || folded.rules.length === 0) return undefined;
  return JSON.stringify({ logic: group.logic === 'or' ? 'or' : 'and', conditions: folded.rules });
}

/**
 * Write list state into a copy of the given params. Only the pieces present in
 * `patch` are touched; an empty piece deletes its param. Returns the next
 * URLSearchParams (caller decides replace).
 */
export function applyListStateParams(prev: URLSearchParams, patch: ListStatePatch): URLSearchParams {
  const next = new URLSearchParams(prev);
  const write = (key: string, value: string | undefined) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  if ('filters' in patch) write(LIST_FILTER_PARAM, serializeFilterGroup(patch.filters));
  if ('search' in patch) write(LIST_SEARCH_PARAM, patch.search || undefined);
  if ('sort' in patch) {
    write(
      LIST_SORT_PARAM,
      patch.sort ? JSON.stringify(patch.sort.map(({ field, order }) => ({ field, order }))) : undefined,
    );
  }
  if ('grouping' in patch) {
    const levels = patch.grouping?.fields ?? [];
    write(
      LIST_GROUP_PARAM,
      levels.length > 0
        ? JSON.stringify({ fields: levels.map(({ field, order, collapsed }) => ({ field, order, collapsed })) })
        : undefined,
    );
  }
  return next;
}
