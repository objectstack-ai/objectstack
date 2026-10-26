/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A column-header sort from the child grid becomes THE view's sort (#3106).
 *
 * ListView fetches the rows and hands one window down to the grid, so a sort
 * the grid applied to that window would order fifty rows and claim to have
 * ordered the list. The header's sort now lands in `currentSort` — the same
 * state the toolbar's sort builder writes — which makes it a server `$orderby`
 * over the whole collection.
 *
 * Sharing that one state is also what makes "does a header sort outrank the
 * saved view's sort?" a non-question: there is one sort, with two controls onto
 * it, so they cannot disagree and there is no precedence to define.
 *
 * plugin-grid is not a dependency of plugin-list (that would be a cycle), so
 * this registers a stub `object-grid` that captures what ListView hands it and
 * lets the test invoke `onSortChange` — the composition neither package's own
 * unit tests can reach.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const TOTAL = 3125;
const PAGE_SIZE = 50;

let lastGridProps: any = null;

function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from(
      { length: Math.max(0, Math.min(top, TOTAL - skip)) },
      (_, i) => ({ id: `id-${skip + i}`, name: `Row ${skip + i}` }),
    );
    return { data: rows, total: TOTAL, hasMore: skip + rows.length < TOTAL };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
    }),
  } as any;
}

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'task',
  fields: ['name', 'status'],
  pagination: { pageSize: PAGE_SIZE },
} as any;

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

beforeEach(() => { lastGridProps = null; });
afterEach(() => { cleanup(); lastGridProps = null; });

function renderList(ds: any, overrides?: Partial<ListViewSchema>) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={{ ...schema, ...overrides } as ListViewSchema} dataSource={ds} />
    </SchemaRendererProvider>,
  );
}

describe('ListView — a column-header sort becomes the view sort (#3106)', () => {
  it('hands the grid the controlled sort and a way to report one', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(Array.isArray(lastGridProps.sort)).toBe(true);
    expect(typeof lastGridProps.onSortChange).toBe('function');
  });

  it('refetches the WHOLE collection with the requested $orderby', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));

    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'desc' }]);
    });
  });

  it('returns to page 1 — a new ordering makes the old page a different set of rows', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(typeof lastGridProps?.onPageChange).toBe('function'));

    await act(async () => { lastGridProps.onPageChange(4); });
    await waitFor(() => expect(lastFindParams(ds).$skip).toBeGreaterThan(0));

    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'asc' }]);
    });

    await waitFor(() => {
      const p = lastFindParams(ds);
      expect(p.$orderby).toEqual([{ field: 'status', order: 'asc' }]);
      expect(p.$skip ?? 0).toBe(0);
    });
  });

  it('feeds the sort straight back down, so the header renders what the server was asked for', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));

    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });

    await waitFor(() => {
      expect(lastGridProps.sort).toEqual([
        expect.objectContaining({ field: 'status', order: 'desc' }),
      ]);
    });
  });

  it('REPLACES the view\'s declared sort rather than stacking on it', async () => {
    const ds = makeDataSource();
    renderList(ds, { sort: 'name asc' } as any);
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));

    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'desc' }]);
    });
  });

  it('reports the sort through onSortChange, so a host persists it like a builder edit', async () => {
    // A header sort is not a lesser sort: whatever a host does to remember the
    // toolbar's sort, it does with this one.
    const onSortChange = vi.fn();
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} onSortChange={onSortChange} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));

    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'asc' }]);
    });

    expect(onSortChange).toHaveBeenCalledWith([
      expect.objectContaining({ field: 'status', order: 'asc' }),
    ]);
  });
});
