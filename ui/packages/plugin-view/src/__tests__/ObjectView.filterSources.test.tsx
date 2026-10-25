/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The filter a non-grid view actually queries with.
 *
 * `ObjectView` fetches its own data for calendar / kanban / gallery / timeline
 * (grid delegates to `ObjectGrid`). It built the filter by hand and lost it in
 * two ways, both silent:
 *
 *   1. `baseFilter.length > 0` — `undefined > 0` for an object. So a
 *      `table.defaultFilters`, declared `Record<string, any>`, was dropped and
 *      the view returned EVERY record. `ObjectGrid` assigns the same value
 *      straight to `params.$filter`, so one view definition filtered correctly
 *      as a grid and returned everything as a calendar.
 *   2. `['and', ...baseFilter, ...userFilter]` — spreading a `ViewFilterRule[]`
 *      puts bare rule objects where the AST expects nodes. Covered at the merge
 *      level in core's `filter-source-merge.test.ts`, which pins what the server
 *      does with the old shape.
 *   3. Even UNSPREAD, a `ViewFilterRule[]` was never AST: it reached `$filter`
 *      as rule objects and the server answered `400 INVALID_FILTER`
 *      (objectui#3431). This file is one of the two producers that feed the
 *      shared `toFilterNode` sink — the other is `plugin-list`'s
 *      `buildEffectiveFilter` — which is why the lowering lives there and not
 *      in either caller.
 *
 * ⚠️ objectui#12030: the cells below used `table.defaultFilters` as the vehicle
 * for each source shape. `@objectstack/spec` 18 retired that key (a tombstone
 * refusing it by name) and `ObjectView` no longer reads it, so the same shapes
 * now ride the canonical `table.filter`, and one cell pins the retired key as
 * inert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { convertSortToQueryParams } from '@object-ui/core';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>,
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

function renderCalendar(schema: Partial<ObjectViewSchema>) {
  const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
  const ds: any = {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  };
  render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'task',
        // Anything but `grid` — grid delegates its fetch to ObjectGrid, and
        // `defaultViewType` is the key `currentViewType` actually reads.
        defaultViewType: 'calendar',
        ...schema,
      } as ObjectViewSchema}
      dataSource={ds}
    />,
  );
  return find;
}

/** The `$filter` the view actually queried with. */
async function queriedFilter(find: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(find).toHaveBeenCalled());
  return find.mock.calls[0][1]?.$filter;
}

describe('ObjectView carries every filter source into the query', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps an OBJECT table.filter instead of dropping it', async () => {
    const find = renderCalendar({ table: { filter: { status: 'active' } } as any });
    // Was `undefined` — the view queried unfiltered and showed every record.
    expect(await queriedFilter(find)).toEqual(['status', '=', 'active']);
  });

  it('LOWERS a ViewFilterRule[] table.filter into AST nodes', async () => {
    // objectui#3431. This case used to assert `toEqual(rules)` — that the rule
    // objects reached `$filter` VERBATIM — and it was green because that is
    // what happened, not because it was right: the server refuses an array of
    // rule objects with `400 INVALID_FILTER`, so this view queried nothing at
    // all. `toFilterNode` now lowers the rules; `eq` canonicalises to `equals`
    // through the spec's own `normalizeFilterOperator`, the same exit the
    // write side uses.
    const rules = [{ field: 'stage', operator: 'eq', value: 'won' }];
    const find = renderCalendar({ table: { filter: rules } as any });
    expect(await queriedFilter(find)).toEqual([['stage', 'equals', 'won']]);
  });

  it('keeps an AST-shaped source', async () => {
    const find = renderCalendar({ table: { filter: [['stage', '=', 'won']] } as any });
    expect(await queriedFilter(find)).toEqual([['stage', '=', 'won']]);
  });

  it('a retired table.defaultFilters is not read: the view queries unfiltered (objectui#12030)', async () => {
    const find = renderCalendar({ table: { defaultFilters: { status: 'active' } } as any });
    expect(await queriedFilter(find)).toBeUndefined();
  });

  it('sends no filter when the view declares none', async () => {
    expect(await queriedFilter(renderCalendar({}))).toBeUndefined();
  });

  it('sends no filter for an empty source rather than an empty array', async () => {
    expect(await queriedFilter(renderCalendar({ table: { filter: {} } as any }))).toBeUndefined();
    expect(await queriedFilter(renderCalendar({ table: { filter: [] } as any }))).toBeUndefined();
  });
});

/**
 * `mergedFilters` / `mergedSort` — what ObjectView hands the renderer it
 * delegates to (the `renderListView` slot, used by the Studio design surface).
 *
 * Both used to open with a branch keyed on ObjectView's own filter/sort state,
 * and the filter one REPLACED the view's filter with the user's rather than
 * combining them. Nothing ever wrote that state, so neither branch could run —
 * they were deleted rather than corrected, because the delegated renderer owns
 * the filter UI and does its own combining. These pin what survives.
 */
describe('ObjectView hands the view filter to the delegated renderer', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderDelegated(schema: Partial<ObjectViewSchema>) {
    const seen: any[] = [];
    const ds: any = {
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
    };
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
        dataSource={ds}
        renderListView={({ schema: s }: any) => { seen.push(s); return <div data-testid="delegated" />; }}
      />,
    );
    return seen;
  }

  it('forwards an object table.filter unchanged', () => {
    const seen = renderDelegated({ table: { filter: { status: 'active' } } as any });
    expect(seen[0]?.filter).toEqual({ status: 'active' });
  });

  it('forwards a ViewFilterRule[] unchanged', () => {
    const rules = [{ field: 'stage', operator: 'eq', value: 'won' }];
    const seen = renderDelegated({ table: { filter: rules } as any });
    expect(seen[0]?.filter).toEqual(rules);
  });

  it('forwards no filter for a retired table.defaultFilters (objectui#12030)', () => {
    const seen = renderDelegated({ table: { defaultFilters: { status: 'active' } } as any });
    expect(seen[0]?.filter).toBeUndefined();
  });

  // ⚠️ CONTROL, green in BOTH states — named so it is not read as evidence
  // for objectui#6235. `table.sort` is the slot that legitimately carries an
  // array (`ObjectGridSchema.sort: SortConfig[]`), and it must reach
  // the delegated node UNWRAPPED. What this guards is the wrong shape the fix
  // could have taken: wrapping the chain's RESULT instead of its final branch,
  // which would re-wrap this into `[[{ field, order }]]` — verbatim
  // objectui#5270's failure, where `parseSchemaSort` and
  // `ListView.parseSortConfig` both skip a nested-array entry and return `[]`,
  // so the user sees no sort at all. Only the LAST branch may change shape;
  // this cell is how we know it was the only one.
  it('forwards a canonical table.sort array UNWRAPPED', () => {
    const seen = renderDelegated({ table: { sort: [{ field: 'name', order: 'asc' }] } as any });
    expect(seen[0]?.sort).toEqual([{ field: 'name', order: 'asc' }]);
    expect(convertSortToQueryParams(seen[0]?.sort)).toEqual({ name: 'asc' });
  });

  // ── objectui#5861 — `table.defaultSort` is RETIRED, so nothing is wrapped ──
  //
  // These three cells used to pin objectui#6235's wrap: the legacy single
  // `{ field, order }` in `table.defaultSort` was lowered into the
  // `SortConfig[]` the delegated `list-view` slot declares (and an ARRAY in it
  // was re-wrapped to `[[…]]` and refused downstream). The key is now an
  // ADR-0049 tombstone — `@objectstack/spec` refuses it by name on
  // `object-grid` — and `mergedSort` no longer has a `defaultSort` branch, so
  // each cell is FLIPPED to assert the key reaches the slot in no shape.
  // ⛔ Not deleted: they are the receipt that the alias was retired rather
  // than quietly dropped from one path while another still honours it.
  it('forwards no sort for an ARRAY in a retired defaultSort — not even the refused `[[…]]` shape', () => {
    const seen = renderDelegated({ table: { defaultSort: [{ field: 'name', order: 'asc' }] } as any });
    expect(seen[0]?.sort).toBeUndefined();
    expect(convertSortToQueryParams(seen[0]?.sort)).toBeUndefined();
  });

  it('does not WRAP a bare-object table.defaultSort any more — the slot gets no sort', () => {
    // Flipped from `WRAPS a bare-object table.defaultSort into the SortConfig[]
    // the slot declares`, which asserted `[{ field: 'created', order: 'asc' }]`.
    const seen = renderDelegated({ table: { defaultSort: { field: 'created', order: 'asc' } } as any });
    expect(seen[0]?.sort).toBeUndefined();
  });

  it('hands the delegated slot a sort its READERS can parse only from the canonical key', () => {
    // The symptom, not the shape: the forwarded value is run through the
    // repo's one sort sink, which the delegated node's `sort` reaches on every
    // non-grid view type. A retired `defaultSort` gives it nothing to order
    // by; the canonical `sort` (CONTROL, same path) still orders.
    const retired = renderDelegated({ table: { defaultSort: { field: 'created', order: 'asc' } } as any });
    expect(convertSortToQueryParams(retired[0]?.sort)).toBeUndefined();
    const canonical = renderDelegated({ table: { sort: [{ field: 'created', order: 'asc' }] } as any });
    expect(convertSortToQueryParams(canonical[0]?.sort)).toEqual({ created: 'asc' });
  });

  it('keeps the canonical table.sort when a retired defaultSort is written beside it', () => {
    // CONTROL — green in both states (before objectui#5861 the canonical key
    // outranked the wrapped legacy default; now the legacy key is not read).
    const seen = renderDelegated({
      table: { sort: [{ field: 'name', order: 'desc' }], defaultSort: { field: 'created', order: 'asc' } } as any,
    });
    expect(seen[0]?.sort).toEqual([{ field: 'name', order: 'desc' }]);
  });

  it('forwards nothing when the view declares neither', () => {
    // CONTROL — green in both states. Guards a truthy placeholder (e.g. an
    // unconditional one-entry array) reaching the slot when nothing was
    // authored, which the sink and both parsers would read as a sort that
    // does not exist.
    const seen = renderDelegated({});
    expect(seen[0]?.filter).toBeUndefined();
    expect(seen[0]?.sort).toBeUndefined();
    expect(convertSortToQueryParams(seen[0]?.sort)).toBeUndefined();
  });
});
