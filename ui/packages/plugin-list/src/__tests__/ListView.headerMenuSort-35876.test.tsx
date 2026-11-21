/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35876 — the list keeps a multi-level sort.
 *
 * The grid's column header opens a menu (pinned in components'
 * `data-table-header-menu-35876.test.tsx`) and hands back the ONE column the
 * reader picked. Here: what the list makes of it — with no sort or a single
 * level the column replaces the sort; with two levels or more it becomes the
 * first level and no other level is dropped. And a sort chip opens every
 * level in one panel instead of flipping its direction; the panel's handles
 * reorder the levels.
 *
 * plugin-grid is not a dependency of plugin-list, so a stub `object-grid`
 * captures what ListView hands it, as `ListView.headerSort.test.tsx` does.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const OBJECT = 'meeting_35876';
const DEFINITION = {
  name: OBJECT,
  label: 'Meeting',
  fields: {
    name: { type: 'text', label: 'Name' },
    meeting_date: { type: 'date', label: 'Date' },
    location: { type: 'text', label: 'Location' },
  },
};

let lastGridProps: any = null;
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

type Level = { field: string; order: 'asc' | 'desc' };

function mount(sort: Level[] = []) {
  const onSortChange = vi.fn();
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'A' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
  };
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: [{ field: 'name' }, { field: 'meeting_date' }, { field: 'location' }],
    ...(sort.length ? { sort } : {}),
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <ListView schema={schema} dataSource={ds as unknown as DataSource} onSortChange={onSortChange} />
    </SchemaRendererProvider>,
  );
  return { ds, onSortChange };
}

const levels = (items: Array<{ field: string; order: string }>) => items.map((s) => [s.field, s.order]);
const TWO: Level[] = [{ field: 'meeting_date', order: 'asc' }, { field: 'location', order: 'asc' }];

async function pickInHeaderMenu(field: string, order: 'asc' | 'desc') {
  await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));
  await act(async () => { lastGridProps.onSortChange([{ field, order }]); });
}

describe('ListView — the header menu keeps a multi-level sort (objectstack#35876)', () => {
  it('asks the grid for the header menu', async () => {
    mount();
    await waitFor(() => expect(lastGridProps).not.toBeNull());
    expect(lastGridProps.headerMenu).toBe(true);
  });

  it('two levels, a new column picked ascending: three levels, the new one first', async () => {
    const { onSortChange } = mount(TWO);
    await pickInHeaderMenu('name', 'asc');
    expect(levels(onSortChange.mock.calls.at(-1)![0])).toEqual([['name', 'asc'], ['meeting_date', 'asc'], ['location', 'asc']]);
    await waitFor(() => expect(levels(lastGridProps.sort)).toEqual([['name', 'asc'], ['meeting_date', 'asc'], ['location', 'asc']]));
  });

  it('two levels, a column already in the sort picked descending: still two levels, it moves first with the new direction', async () => {
    const { onSortChange } = mount(TWO);
    await pickInHeaderMenu('location', 'desc');
    expect(levels(onSortChange.mock.calls.at(-1)![0])).toEqual([['location', 'desc'], ['meeting_date', 'asc']]);
  });

  it('no sort, a column picked descending: that column alone', async () => {
    const { onSortChange } = mount();
    await pickInHeaderMenu('location', 'desc');
    expect(levels(onSortChange.mock.calls.at(-1)![0])).toEqual([['location', 'desc']]);
  });

  it('one level, another column picked: it replaces the sort', async () => {
    const { onSortChange } = mount([{ field: 'meeting_date', order: 'asc' }]);
    await pickInHeaderMenu('name', 'asc');
    expect(levels(onSortChange.mock.calls.at(-1)![0])).toEqual([['name', 'asc']]);
  });
});

describe('ListView — a sort chip opens the sort panel (objectstack#35876)', () => {
  const slot = () => screen.getByTestId('list-condition-row');

  it('a click on the chip opens every level and leaves the direction alone', async () => {
    const { ds, onSortChange } = mount(TWO);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    // Since objectstack#35878 the sort is ONE chip, however many levels.
    const chip = await within(slot()).findByTestId('condition-sort');
    expect(chip).toHaveAttribute('data-levels', '2');
    fireEvent.click(chip);
    const panel = await screen.findByTestId('sort-chip-panel');
    expect(within(panel).getAllByTestId('sort-builder-row')).toHaveLength(2);
    expect(within(panel).getAllByTestId('sort-builder-handle')).toHaveLength(2);
    expect(levels(lastGridProps.sort)).toEqual([['meeting_date', 'asc'], ['location', 'asc']]);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("a level's handle moves it: ArrowUp on the second handle makes it the first level", async () => {
    const { ds, onSortChange } = mount(TWO);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(await within(slot()).findByTestId('condition-sort'));
    const panel = await screen.findByTestId('sort-chip-panel');
    fireEvent.keyDown(within(panel).getAllByTestId('sort-builder-handle')[1], { key: 'ArrowUp' });
    await waitFor(() => expect(onSortChange).toHaveBeenCalled());
    expect(levels(onSortChange.mock.calls.at(-1)![0])).toEqual([['location', 'asc'], ['meeting_date', 'asc']]);
    await waitFor(() => expect(levels(lastGridProps.sort)).toEqual([['location', 'asc'], ['meeting_date', 'asc']]));
    expect(within(slot()).getByTestId('condition-sort')).toHaveTextContent(/^Sorted by Location/);
  });

  it("a mouse drag of a level's handle onto another row moves it there, and the chip it sits in does not undo it", async () => {
    const { ds, onSortChange } = mount([...TWO, { field: 'name', order: 'desc' }]);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(await within(slot()).findByTestId('condition-sort'));
    const panel = await screen.findByTestId('sort-chip-panel');
    const handles = within(panel).getAllByTestId('sort-builder-handle');
    const rows = within(panel).getAllByTestId('sort-builder-row');
    fireEvent.dragStart(handles[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    fireEvent.dragEnd(handles[2]);
    await waitFor(() => expect(onSortChange).toHaveBeenCalled());
    expect(levels(onSortChange.mock.calls.at(-1)![0])).toEqual([['name', 'desc'], ['meeting_date', 'asc'], ['location', 'asc']]);
    await waitFor(() => expect(levels(lastGridProps.sort)).toEqual([['name', 'desc'], ['meeting_date', 'asc'], ['location', 'asc']]));
  });
});
