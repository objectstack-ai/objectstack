/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10689 — `ObjectGrid`'s load effect re-reads when an input its query
 * reads changes, and only then. The objectui#10664 family rule: every input the
 * query reads is in the effect's dependencies, keyed by content.
 *
 * The query reads four schema inputs that the dependency list did not name:
 *
 *   - `conditionalFormatting`, `rowActionDefs` and `bulkActionDefs`, through the
 *     predicate-operand harvest (objectui#3501) that puts each predicate's
 *     operands into `$select`;
 *   - `searchableFields`, sent as `$searchFields` beside a search term.
 *
 * So a rule added to a mounted grid never had its operand fetched: the rows
 * kept arriving without the field, and the rule, which reads it, never matched.
 *
 * Each input is keyed by the part of it the query reads, as a string compared
 * by value (AGENTS.md #10): the harvested operand NAMES for the three predicate
 * carriers (the shape `groupingProjectionKey` already takes for `grouping`), and
 * the `$searchFields` the query sends. So an equal re-render, or a change the
 * query cannot see (a rule's colour), costs no round trip.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => cleanup());

const OBJECT = 'account';

// Held as module constants so every re-render below hands the grid the SAME
// references for the inputs this card does not touch. `columns` and
// `pagination` are named by identity in the effect's dependency list, so a
// fresh literal of either would re-read for a reason of its own.
const COLUMNS = [{ field: 'name', label: 'Name' }];
const PAGINATION = { pageSize: 50 };

function makeDataSource() {
  const find = vi.fn(async () => ({
    data: [{ id: 'r1', name: 'Acme', industry: 'Tech', owner: 'u1', status: 'open', region: 'EU' }],
    total: 1,
    hasMore: false,
    pageSize: 50,
  }));
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        industry: { type: 'text' },
        owner: { type: 'text' },
        status: { type: 'text' },
        region: { type: 'text' },
      },
    }),
  } as any;
}

const gridSchema = (extra: Record<string, unknown> = {}): any => ({
  type: 'object-grid',
  objectName: OBJECT,
  columns: COLUMNS,
  pagination: PAGINATION,
  ...extra,
});

/** Long enough for any effect a step schedules to have run and settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

const selects = (find: ReturnType<typeof vi.fn>) =>
  find.mock.calls.map((call: any[]) => call[1]?.$select as string[] | undefined);

/** Mount, wait for the first read to land, and settle every follow-up effect. */
async function mount(ds: any, extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const view = render(<ObjectGrid schema={gridSchema(extra)} dataSource={ds} {...props} />);
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  await settle();
  const rerender = async (next: Record<string, unknown>, nextProps: Record<string, unknown> = props) => {
    view.rerender(<ObjectGrid schema={gridSchema(next)} dataSource={ds} {...nextProps} />);
    await settle();
  };
  return { rerender };
}

const INDUSTRY_RULE = { condition: "record.industry == 'Tech'", style: { backgroundColor: '#fee2e2' } };
const ROW_DEF = { name: 'escalate', label: 'Escalate', visible: "record.owner == 'u1'" };
const BULK_DEF = { name: 'archive', label: 'Archive', disabled: "record.status == 'closed'" };

describe('ObjectGrid re-reads when a harvested predicate input changes (objectui#10689)', () => {
  it('CONTROL — a fresh mount with the rule selects its operand, in one read', async () => {
    const ds = makeDataSource();
    await mount(ds, { conditionalFormatting: [INDUSTRY_RULE] });
    expect(selects(ds.find)).toEqual([['id', 'name', 'industry']]);
  });

  it('a `conditionalFormatting` rule added to a mounted grid re-reads once, with its operand in `$select`', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds);
    expect(selects(ds.find)).toEqual([['id', 'name']]);

    await rerender({ conditionalFormatting: [INDUSTRY_RULE] });

    expect(
      selects(ds.find),
      'The rule was added to a mounted grid and the grid never re-read, so the rows keep\n'
        + 'arriving without `industry` and the rule never matches. The load effect must name\n'
        + 'the harvested operands in its dependencies (objectui#10689).',
    ).toEqual([['id', 'name'], ['id', 'name', 'industry']]);
  });

  it('a `rowActionDefs` def added to a mounted grid re-reads once, with its `visible` operand', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds);

    await rerender({ rowActionDefs: [ROW_DEF] });

    expect(selects(ds.find)).toEqual([['id', 'name'], ['id', 'name', 'owner']]);
  });

  it('a `bulkActionDefs` def added to a mounted grid re-reads once, with its `disabled` operand', async () => {
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
      searchableFields: ['name', 'industry'],
    }, { search: 'acme' });
    expect(ds.find).toHaveBeenCalledTimes(1);

    await rerender({
      conditionalFormatting: [{ ...INDUSTRY_RULE, style: { ...INDUSTRY_RULE.style } }],
      rowActionDefs: [{ ...ROW_DEF }],
      bulkActionDefs: [{ ...BULK_DEF }],
      searchableFields: ['name', 'industry'],
    }, { search: 'acme' });

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

describe('ObjectGrid re-reads when `searchableFields` changes under a search term (objectui#10689)', () => {
  const searchFieldsOf = (find: ReturnType<typeof vi.fn>) =>
    find.mock.calls.map((call: any[]) => call[1]?.$searchFields as string[] | undefined);

  it('`searchableFields` changed on a mounted grid re-reads once, with the new `$searchFields`', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds, { searchableFields: ['name'] }, { search: 'acme' });
    expect(searchFieldsOf(ds.find)).toEqual([['name']]);

    await rerender({ searchableFields: ['name', 'region'] }, { search: 'acme' });

    expect(
      searchFieldsOf(ds.find),
      'The view narrowed its search to new fields and the grid never re-read, so the rows on\n'
        + 'screen still answer the old `$searchFields` (objectui#10689).',
    ).toEqual([['name'], ['name', 'region']]);
  });

  it('without a search term `$searchFields` is not sent, so a change to it does not re-read', async () => {
    const ds = makeDataSource();
    const { rerender } = await mount(ds, { searchableFields: ['name'] });
    expect(searchFieldsOf(ds.find)).toEqual([undefined]);

    await rerender({ searchableFields: ['name', 'region'] });

    expect(ds.find).toHaveBeenCalledTimes(1);
  });
});
