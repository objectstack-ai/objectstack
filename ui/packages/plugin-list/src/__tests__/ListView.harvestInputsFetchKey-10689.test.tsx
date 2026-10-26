/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10689 — `ListView`'s fetch effect re-reads when an input its query
 * reads changes, and only then. The objectui#10664 family rule: every input the
 * query reads is in the effect's dependencies, keyed by content.
 *
 * The query reads `conditionalFormatting`, `rowActionDefs` and `bulkActionDefs`
 * through the predicate-operand harvest (objectui#3501), which puts each
 * predicate's operands into `$select`. None of the three was named in the
 * dependency list, so a rule added to a mounted list never had its operand
 * fetched: the rows kept arriving without the field the rule reads.
 *
 * They are keyed by the harvested operand NAMES, a string compared by value
 * (AGENTS.md #10), so an equal re-render, or a change the query cannot see (a
 * rule's colour), costs no round trip.
 *
 * `plugin-grid`'s `ObjectGrid.harvestInputsFetchKey-10689.test.tsx` pins the
 * grid's own load effect, the other build site of the same projection.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'account';

// Held as module constants so every re-render below hands the list the SAME
// references for the inputs this card does not touch: `columns` and
// `searchableFields` are named by identity in the effect's dependency list.
const COLUMNS = ['name'];
const PAGINATION = { pageSize: 50 };
const SEARCHABLE = ['name'];

function makeDataSource() {
  const find = vi.fn(async () => ({
    data: [{ id: 'r1', name: 'Acme', industry: 'Tech', owner: 'u1', status: 'open', region: 'EU' }],
    total: 1,
  }));
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text' },
        industry: { name: 'industry', type: 'text' },
        owner: { name: 'owner', type: 'text' },
        status: { name: 'status', type: 'text' },
        region: { name: 'region', type: 'text' },
      },
    })),
  } as any;
}

const listSchema = (extra: Record<string, unknown> = {}): any => ({
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'grid',
  columns: COLUMNS,
  pagination: PAGINATION,
  ...extra,
});

// The grid is stubbed: this file pins the LIST's fetch, and the grid it hands
// its rows to fetches nothing of its own on this path.
let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
afterEach(() => cleanup());

/** Long enough for any effect a step schedules to have run and settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

const selects = (find: ReturnType<typeof vi.fn>) =>
  find.mock.calls.map((call: any[]) => call[1]?.$select as string[] | undefined);

/** Mount, wait for the first read to land, and settle every follow-up effect. */
async function mount(ds: any, extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const tree = (schema: any) => (
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} {...props} />
    </SchemaRendererProvider>
  );
  const view = render(tree(listSchema(extra)));
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  await settle();
  const rerender = async (next: Record<string, unknown>) => {
    view.rerender(tree(listSchema(next)));
    await settle();
  };
  return { rerender };
}

const INDUSTRY_RULE = { condition: "record.industry == 'Tech'", style: { backgroundColor: '#fee2e2' } };
const ROW_DEF = { name: 'escalate', label: 'Escalate', visible: "record.owner == 'u1'" };
const BULK_DEF = { name: 'archive', label: 'Archive', disabled: "record.status == 'closed'" };

describe('ListView re-reads when a harvested predicate input changes (objectui#10689)', () => {
  it('CONTROL — a fresh mount with the rule selects its operand, in one read', async () => {
    const ds = makeDataSource();
    await mount(ds, { conditionalFormatting: [INDUSTRY_RULE] });
    expect(selects(ds.find)).toEqual([['id', 'name', 'industry']]);
  });

  it('a `conditionalFormatting` rule added to a mounted list re-reads once, with its operand in `$select`', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds);
    expect(selects(ds.find)).toEqual([['id', 'name']]);

    await rerender({ conditionalFormatting: [INDUSTRY_RULE] });

    expect(
      selects(ds.find),
      'The rule was added to a mounted list and the list never re-read, so the rows keep\n'
        + 'arriving without `industry` and the rule never matches. The fetch effect must name\n'
        + 'the harvested operands in its dependencies (objectui#10689).',
    ).toEqual([['id', 'name'], ['id', 'name', 'industry']]);
  });

  it('a `rowActionDefs` def added to a mounted list re-reads once, with its `visible` operand', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds);

    await rerender({ rowActionDefs: [ROW_DEF] });

    expect(selects(ds.find)).toEqual([['id', 'name'], ['id', 'name', 'owner']]);
  });

  it('a `bulkActionDefs` def added to a mounted list re-reads once, with its `disabled` operand', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds);

    await rerender({ bulkActionDefs: [BULK_DEF] });

    expect(selects(ds.find)).toEqual([['id', 'name'], ['id', 'name', 'status']]);
  });

  it('CONTROL — an equal re-render (new arrays, same content) does not re-read', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds, {
      conditionalFormatting: [INDUSTRY_RULE],
      rowActionDefs: [ROW_DEF],
      bulkActionDefs: [BULK_DEF],
    });
    expect(ds.find).toHaveBeenCalledTimes(1);

    await rerender({
      conditionalFormatting: [{ ...INDUSTRY_RULE, style: { ...INDUSTRY_RULE.style } }],
      rowActionDefs: [{ ...ROW_DEF }],
      bulkActionDefs: [{ ...BULK_DEF }],
    });

    expect(ds.find, 'an equal re-render must cost no round trip').toHaveBeenCalledTimes(1);
  });

  it('a rule change the query cannot see (its style) does not re-read', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds, { conditionalFormatting: [INDUSTRY_RULE] });

    await rerender({
      conditionalFormatting: [{ ...INDUSTRY_RULE, style: { backgroundColor: '#dcfce7' } }],
    });

    expect(ds.find).toHaveBeenCalledTimes(1);
  });
});

describe('ListView `searchableFields` — the row already keyed on main, pinned (objectui#10689)', () => {
  const searchFieldsOf = (find: ReturnType<typeof vi.fn>) =>
    find.mock.calls.map((call: any[]) => call[1]?.$searchFields as string[] | undefined);

  it('`searchableFields` changed on a mounted list re-reads once, with the new `$searchFields`', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds, { searchableFields: SEARCHABLE }, { initialSearchTerm: 'acme' });
    expect(searchFieldsOf(ds.find)).toEqual([['name']]);

    await rerender({ searchableFields: ['name', 'region'] });

    expect(searchFieldsOf(ds.find)).toEqual([['name'], ['name', 'region']]);
  });
});
