/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12292 — the SECOND projection build site, for the rows' concurrency
 * token.
 *
 * The grid's inline-edit save sends each row's `updated_at` as `If-Match`. In
 * the console the rows do not come from the grid's own query: `ListView`
 * fetches them and hands them down, and its `$select` was built from the
 * columns. A list that shows no `updated_at` column therefore handed the grid
 * rows with no token, and every save from it went out unguarded, exactly as
 * the card reproduced on the showcase task grid. `plugin-grid`'s
 * `inlineEditConcurrency-12292.test.tsx` pins the grid's own build site; this
 * pins this one.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'task_12292';

const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text', label: 'Title' },
    estimate_hours: { name: 'estimate_hours', type: 'number', label: 'Estimate' },
  },
};

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

/** Mount a list view; `lastSelect` reads the `$select` of its latest query. */
async function mount(schemaExtra: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const schema: any = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: ['title', 'estimate_hours'],
    ...schemaExtra,
  };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  const lastSelect = () => (dataSource.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
  // The projection reads the object's definition, so wait for a query that
  // was built with it: its `$select` names a declared column.
  await waitFor(() => expect(lastSelect()).toContain('estimate_hours'));
  return { dataSource, lastSelect };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ListView — an inline-editable grid\'s rows carry their concurrency token (objectui#12292)', () => {
  it('asks for `updated_at` when the grid opens in inline-edit mode, though no column shows it', async () => {
    const { lastSelect } = await mount({ inlineEdit: true });
    await waitFor(() => expect(lastSelect()).toContain('updated_at'));
    expect(lastSelect()).toEqual(expect.arrayContaining(['id', 'title', 'estimate_hours']));
  });

  it('does not ask for it while the grid is not in inline-edit mode', async () => {
    const { dataSource, lastSelect } = await mount({});
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    expect(dataSource.find.mock.calls.length).toBeGreaterThan(0);
    for (const call of dataSource.find.mock.calls) {
      expect(call[1]?.$select ?? []).not.toContain('updated_at');
    }
    expect(lastSelect()).toEqual(expect.arrayContaining(['id', 'title', 'estimate_hours']));
  });
});
