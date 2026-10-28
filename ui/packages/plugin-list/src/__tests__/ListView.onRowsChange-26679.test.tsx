/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26679 — `ListView` reports the rows it shows (`onRowsChange`),
 * in the order it shows them, so the console's record drawer can step through
 * them with ↑ ↓ at its root.
 *
 * Answered where `onTotalChange` is: a paged grid that draws the rows it
 * fetched. A kind with no single row order (here a board) answers with no
 * rows, so a host never steps through a stale set.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'crm_lead';
const objectDef = {
  name: OBJECT,
  label: 'Lead',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    status: {
      name: 'status', type: 'select', label: 'Status',
      options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }],
    },
  },
};
const ROWS = [
  { id: 'l_3', name: 'Mira Costa', status: 'new' },
  { id: 'l_1', name: 'Kai Watanabe', status: 'won' },
  { id: 'l_2', name: 'Lena Fischer', status: 'new' },
];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? objectDef : null)),
  }) as any;

function mount(schemaExtra: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const onRowsChange = vi.fn();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, columns: ['name', 'status'], ...schemaExtra } as any}
        dataSource={dataSource}
        onRowsChange={onRowsChange}
      />
    </SchemaRendererProvider>,
  );
  return { dataSource, onRowsChange };
}

const lastIds = (fn: ReturnType<typeof vi.fn>) =>
  (fn.mock.calls.at(-1)?.[0] as Array<{ id: string }> | undefined)?.map((r) => r.id);

afterEach(() => cleanup());

describe('ListView onRowsChange (objectstack#26679)', () => {
  it('a paged grid reports the rows it shows, in their shown order', async () => {
    const { dataSource, onRowsChange } = mount({ viewType: 'grid' });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await waitFor(() => expect(lastIds(onRowsChange)).toEqual(['l_3', 'l_1', 'l_2']));
  });

  it('control: a board has no single row order and reports no rows', async () => {
    const { dataSource, onRowsChange } = mount({
      viewType: 'kanban',
      options: { kanban: { groupBy: 'status' } },
    });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await waitFor(() => expect(onRowsChange).toHaveBeenCalled());
    expect(onRowsChange.mock.calls.every(([rows]) => rows.length === 0)).toBe(true);
  });
});
