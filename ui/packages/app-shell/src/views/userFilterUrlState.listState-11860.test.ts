/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11860 — the list toolbar's state in the `uf_` URL family: the
 * Filter panel's conditions (`uf__filter`), the search term (`uf__search`), the
 * sort (`uf__sort`) and the grouping (`uf__group`).
 *
 * Pinned here, without mounting anything: the round trip of every piece through
 * a real `URLSearchParams` string, the spec shapes the values carry, and the
 * reads that DROP rather than throw — a value that is not JSON, a condition the
 * spec's `ViewFilterRuleSchema` refuses, a field the caller does not accept.
 * The host side (`ObjectView`) is pinned by
 * `ObjectView.listUrlState-11860.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { GroupingConfigSchema, ViewFilterRuleSchema } from '@objectstack/spec/ui';
import type { FilterBuilderRowGroup, GroupingConfigValue, SortItem } from '@object-ui/components';
import {
  LIST_FILTER_PARAM,
  LIST_GROUP_PARAM,
  LIST_SEARCH_PARAM,
  LIST_SORT_PARAM,
  applyListStateParams,
  applyUserFilterParams,
  parseListStateParams,
  parseUserFilterParams,
  userFilterParamsKey,
} from './userFilterUrlState';

const FIELDS = new Set(['priority', 'status', 'due_date', 'amount', 'archived_at', 'name']);
const acceptKnown = (field: string) => FIELDS.has(field);

/** Through a real query string, the way a link carries it. */
function viaLink(params: URLSearchParams): URLSearchParams {
  return new URLSearchParams(`?${params.toString()}`);
}

/** A row as the panel holds it, minus the id the read mints fresh. */
const rowsOf = (group: FilterBuilderRowGroup | undefined) =>
  group?.conditions.map(({ field, operator, value }) => ({ field, operator, value }));

describe('the Filter panel round-trips through `uf__filter` (objectui#11860)', () => {
  it('an AND group of the operators the panel offers comes back row for row', () => {
    const group: FilterBuilderRowGroup = {
      id: 'root',
      logic: 'and',
      conditions: [
        { id: 'a', field: 'priority', operator: 'equals', value: 'urgent' },
        { id: 'b', field: 'due_date', operator: 'before', value: '2026-11-01' },
        { id: 'c', field: 'status', operator: 'in', value: ['open', 'blocked'] },
        { id: 'd', field: 'amount', operator: 'between', value: [10, 20] },
        { id: 'e', field: 'archived_at', operator: 'is_empty', value: '' },
      ],
    };
    const state = parseListStateParams(
      viaLink(applyListStateParams(new URLSearchParams(), { filters: group })),
      acceptKnown,
    );
    expect(state.filters?.logic).toBe('and');
    expect(rowsOf(state.filters)).toEqual([
      { field: 'priority', operator: 'equals', value: 'urgent' },
      // `before` stays `before`: the filter AST would have answered `less_than`.
      { field: 'due_date', operator: 'before', value: '2026-11-01' },
      // `in` stays one row: the filter AST would have answered an OR of equalities.
      { field: 'status', operator: 'in', value: ['open', 'blocked'] },
      { field: 'amount', operator: 'between', value: [10, 20] },
      { field: 'archived_at', operator: 'is_empty', value: '' },
    ]);
    // Every row gets an id of its own — the builder keys and edits rows by it.
    const ids = state.filters!.conditions.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('an OR group keeps its logic', () => {
    const group: FilterBuilderRowGroup = {
      logic: 'or',
      conditions: [
        { id: 'a', field: 'priority', operator: 'equals', value: 'urgent' },
        { id: 'b', field: 'status', operator: 'equals', value: 'blocked' },
      ],
    };
    const state = parseListStateParams(
      viaLink(applyListStateParams(new URLSearchParams(), { filters: group })),
      acceptKnown,
    );
    expect(state.filters?.logic).toBe('or');
    expect(rowsOf(state.filters)).toHaveLength(2);
  });

  it('carries spec rules: no row id, canonical operators, each one a valid `ViewFilterRule`', () => {
    const params = applyListStateParams(new URLSearchParams(), {
      filters: {
        logic: 'and',
        conditions: [
          // A row read back from storage written before objectui#9306 may still
          // carry the deprecated camelCase spelling.
          { id: 'a', field: 'priority', operator: 'notEquals' as never, value: 'low' },
        ],
      },
    });
    const carried = JSON.parse(params.get(LIST_FILTER_PARAM)!);
    expect(carried).toEqual({ logic: 'and', conditions: [{ field: 'priority', operator: 'not_equals', value: 'low' }] });
    for (const rule of carried.conditions) expect(ViewFilterRuleSchema.safeParse(rule).success).toBe(true);
  });

  it('writes nothing for a blank or unfinished row — what the list does not apply is not linked', () => {
    const params = applyListStateParams(new URLSearchParams(`${LIST_FILTER_PARAM}=stale`), {
      filters: {
        logic: 'and',
        conditions: [
          { id: 'a', field: '', operator: 'equals', value: '' },
          { id: 'b', field: 'priority', operator: 'equals', value: '' },
        ],
      },
    });
    expect(params.has(LIST_FILTER_PARAM)).toBe(false);
  });
});

describe('a malformed or stale `uf__filter` is dropped, and nothing throws (objectui#11860)', () => {
  const read = (raw: string, accept = acceptKnown) =>
    parseListStateParams(new URLSearchParams({ [LIST_FILTER_PARAM]: raw }), accept).filters;

  it('a value that is not JSON', () => {
    expect(read('{not json')).toBeUndefined();
  });

  it('JSON that is not the group shape', () => {
    expect(read('[{"field":"priority","operator":"equals","value":"urgent"}]')).toBeUndefined();
    expect(read('{"logic":"xor","conditions":[]}')).toBeUndefined();
    expect(read('{"logic":"and"}')).toBeUndefined();
    expect(read('"priority"')).toBeUndefined();
  });

  it('a condition the spec refuses is dropped and its siblings are kept', () => {
    const group = read(
      JSON.stringify({
        logic: 'and',
        conditions: [
          { field: 'priority', operator: 'equals', value: 'urgent' },
          { field: 'status', operator: 'resembles', value: 'open' },
          { field: 'status', operator: 'equals', value: { $ne: 'open' } },
          { field: 'status', operator: 'equals', value: 'open', extra: 1 },
        ],
      }),
    );
    expect(rowsOf(group)).toEqual([{ field: 'priority', operator: 'equals', value: 'urgent' }]);
  });

  it('a field the object does not declare, or the user cannot read, is dropped', () => {
    const raw = JSON.stringify({
      logic: 'and',
      conditions: [
        { field: 'ghost', operator: 'equals', value: 'x' },
        { field: 'priority', operator: 'equals', value: 'urgent' },
        { field: 'status', operator: 'equals', value: 'open' },
      ],
    });
    expect(rowsOf(read(raw, (f) => acceptKnown(f) && f !== 'status'))).toEqual([
      { field: 'priority', operator: 'equals', value: 'urgent' },
    ]);
  });

  it('a group whose every condition is dropped carries no filter', () => {
    expect(read('{"logic":"and","conditions":[{"field":"ghost","operator":"equals","value":"x"}]}')).toBeUndefined();
  });
});

describe('the sort and the search term (objectui#11860)', () => {
  it('the sort round-trips in the spec `ListViewSchema.sort` shape, row ids stripped', () => {
    // What `ListView` reports through `onSortChange`: builder rows, id included.
    const reported: SortItem[] = [
      { id: 'x', field: 'due_date', order: 'asc' },
      { id: 'y', field: 'name', order: 'desc' },
    ];
    const params = applyListStateParams(new URLSearchParams(), { sort: reported });
    expect(JSON.parse(params.get(LIST_SORT_PARAM)!)).toEqual([
      { field: 'due_date', order: 'asc' },
      { field: 'name', order: 'desc' },
    ]);
    expect(parseListStateParams(viaLink(params), acceptKnown).sort).toEqual([
      { field: 'due_date', order: 'asc' },
      { field: 'name', order: 'desc' },
    ]);
  });

  it('a cleared sort is carried as an empty list — it differs from the view default', () => {
    const params = applyListStateParams(new URLSearchParams(), { sort: [] });
    expect(params.get(LIST_SORT_PARAM)).toBe('[]');
    expect(parseListStateParams(viaLink(params), acceptKnown).sort).toEqual([]);
  });

  it('a sort entry the spec refuses or naming a field not accepted is dropped', () => {
    const raw = JSON.stringify([
      { field: 'ghost', order: 'asc' },
      { field: 'name', order: 'sideways' },
      { field: 'due_date', order: 'desc' },
    ]);
    expect(parseListStateParams(new URLSearchParams({ [LIST_SORT_PARAM]: raw }), acceptKnown).sort).toEqual([
      { field: 'due_date', order: 'desc' },
    ]);
    expect(
      parseListStateParams(new URLSearchParams({ [LIST_SORT_PARAM]: '[{"field":"ghost","order":"asc"}]' }), acceptKnown).sort,
    ).toBeUndefined();
    expect(parseListStateParams(new URLSearchParams({ [LIST_SORT_PARAM]: 'name desc' }), acceptKnown).sort).toBeUndefined();
  });

  it('the search term round-trips verbatim, the characters a query string treats as structure included', () => {
    const term = 'Smith & Sons + 50%, "quoted"';
    const params = applyListStateParams(new URLSearchParams(), { search: term });
    expect(parseListStateParams(viaLink(params), acceptKnown).search).toBe(term);
  });

  it('an empty piece deletes its param, and an absent piece is left alone', () => {
    const start = new URLSearchParams({ [LIST_SEARCH_PARAM]: 'x', [LIST_SORT_PARAM]: '[]', recordId: 'r1' });
    const next = applyListStateParams(start, { search: '' });
    expect(next.has(LIST_SEARCH_PARAM)).toBe(false);
    expect(next.get(LIST_SORT_PARAM)).toBe('[]');
    expect(next.get('recordId')).toBe('r1');
  });
});

describe('the toolbar grouping round-trips through `uf__group` (objectui#11860)', () => {
  it('what the grouping editor emits is the spec `GroupingConfig`, and comes back unchanged', () => {
    // The editor's own value type, as `GroupingEditor`'s `onChange` hands it.
    const emitted: GroupingConfigValue = {
      fields: [
        { field: 'status', order: 'desc', collapsed: true },
        { field: 'priority', order: 'asc', collapsed: false },
      ],
    };
    // The spec parses it as it is: no key added, none refused.
    expect(GroupingConfigSchema.parse(emitted)).toEqual(emitted);
    const params = applyListStateParams(new URLSearchParams(), { grouping: emitted });
    expect(JSON.parse(params.get(LIST_GROUP_PARAM)!)).toEqual(emitted);
    expect(parseListStateParams(viaLink(params), acceptKnown).grouping).toEqual(emitted);
  });

  it('a level that leaves out `order` and `collapsed` reads back with the spec defaults', () => {
    const params = new URLSearchParams({ [LIST_GROUP_PARAM]: JSON.stringify({ fields: [{ field: 'status' }] }) });
    expect(parseListStateParams(params, acceptKnown).grouping).toEqual({
      fields: [{ field: 'status', order: 'asc', collapsed: false }],
    });
  });

  it('a level the spec refuses, or naming a field not accepted, is dropped; the others keep their order', () => {
    const raw = JSON.stringify({
      fields: [
        { field: 'ghost', order: 'asc' },
        { field: 'priority', order: 'sideways' },
        { field: 'status', order: 'desc', collapsed: true },
        { field: 'name', order: 'asc', extra: 1 },
        { field: 'due_date' },
      ],
    });
    expect(parseListStateParams(new URLSearchParams({ [LIST_GROUP_PARAM]: raw }), acceptKnown).grouping).toEqual({
      fields: [
        { field: 'status', order: 'desc', collapsed: true },
        { field: 'due_date', order: 'asc', collapsed: false },
      ],
    });
  });

  it('a value that is not JSON, not the spec envelope, or left with no level carries no grouping', () => {
    const read = (raw: string) =>
      parseListStateParams(new URLSearchParams({ [LIST_GROUP_PARAM]: raw }), acceptKnown).grouping;
    expect(read('{not json')).toBeUndefined();
    expect(read('status')).toBeUndefined();
    expect(read(JSON.stringify([{ field: 'status' }]))).toBeUndefined();
    expect(read(JSON.stringify({ fields: [] }))).toBeUndefined();
    expect(read(JSON.stringify({ fields: [{ field: 'ghost' }] }))).toBeUndefined();
    // `GroupingConfigSchema` declares `fields` alone: another key drops the whole value.
    expect(read(JSON.stringify({ fields: [{ field: 'status' }], groupBy: 'priority' }))).toBeUndefined();
  });

  it('a cleared grouping deletes the param, and an absent piece leaves it alone', () => {
    const start = applyListStateParams(new URLSearchParams({ recordId: 'r1' }), {
      grouping: { fields: [{ field: 'status' }] },
    });
    expect(applyListStateParams(start, { search: 'x' }).get(LIST_GROUP_PARAM)).toBe(start.get(LIST_GROUP_PARAM));
    for (const cleared of [null, undefined, { fields: [] }]) {
      const next = applyListStateParams(start, { grouping: cleared as never });
      expect(next.has(LIST_GROUP_PARAM)).toBe(false);
      expect(next.get('recordId')).toBe('r1');
    }
  });
});

describe('the list-state keys are not quick-filter selections (objectui#11860)', () => {
  it('`parseUserFilterParams` hands `UserFilters` its fields and `_tab`, never a list-state key', () => {
    let params = applyUserFilterParams(new URLSearchParams(), { status: ['open'], _tab: ['mine'] });
    params = applyListStateParams(params, {
      search: 'x',
      sort: [{ field: 'name', order: 'asc' }],
      filters: { logic: 'and', conditions: [{ id: 'a', field: 'priority', operator: 'equals', value: 'urgent' }] },
      grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] },
    });
    expect(params.has(LIST_GROUP_PARAM)).toBe(true);
    expect(parseUserFilterParams(viaLink(params))).toEqual({ status: ['open'], _tab: ['mine'] });
  });

  it('`userFilterParamsKey` names every `uf_*` param and nothing else', () => {
    const params = new URLSearchParams({ recordId: 'r1', uf_status: 'open', [LIST_SEARCH_PARAM]: 'x', uf_empty: '' });
    expect(userFilterParamsKey(params)).toBe(`uf_status=open&${LIST_SEARCH_PARAM}=x`);
    expect(userFilterParamsKey(new URLSearchParams({ recordId: 'r1' }))).toBe('');
  });
});
