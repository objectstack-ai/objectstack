/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10664 (the census row for `object-view`) — the non-grid fetch
 * re-reads when `table.sort` changes, and only then.
 *
 * The effect lowers `currentNamedViewConfig?.sort || activeViewQueryInputs?.sort
 * || schema.table?.sort` onto `$orderby`. The first two sources are in its
 * dependency list; the third was not. A mounted calendar / kanban view whose
 * `table.sort` changed (and whose named view and active view declare none) kept
 * the old order until something else re-ran the read. It is now keyed by
 * CONTENT, so an equal sort in a fresh array is not a change (AGENTS.md #10).
 *
 * The CONTROL (an equal sort in a fresh array) is green before and after; it
 * goes red for a fix that keys on the array's identity.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

// The same seams `ObjectView.sortSink.test.tsx` stubs: the child renderers are
// not what these cases read, only the query this component issues itself.
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

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

const BY_NAME_ASC = [{ field: 'name', order: 'asc' }];
const BY_NAME_DESC = [{ field: 'name', order: 'desc' }];

const mockDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

const schemaFor = (sort: unknown) =>
  ({ type: 'object-view', objectName: 'task', defaultViewType: 'calendar', table: { sort } }) as unknown as ObjectViewSchema;

function mount() {
  const ds = mockDataSource();
  const view = render(<ObjectView schema={schemaFor(BY_NAME_ASC)} dataSource={ds as any} />);
  const rerender = (sort: unknown) => view.rerender(<ObjectView schema={schemaFor(sort)} dataSource={ds as any} />);
  return { ds, rerender };
}

const orderbys = (ds: ReturnType<typeof mockDataSource>) => ds.find.mock.calls.map((c: any[]) => c[1]?.$orderby);

describe('object-view keys its non-grid read on the table sort it sends (objectui#10664)', () => {
  it('SUBJECT: a changed `table.sort` re-reads, with the new `$orderby`', async () => {
    const { ds, rerender } = mount();
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await settle();
    expect(orderbys(ds)).toEqual([{ name: 'asc' }]);

    await act(async () => { rerender(BY_NAME_DESC); });
    await settle();

    expect(orderbys(ds), 'the changed sort never reached a read').toEqual([{ name: 'asc' }, { name: 'desc' }]);
  });

  it('CONTROL: an equal `table.sort` in a fresh array does not re-read', async () => {
    const { ds, rerender } = mount();
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await settle();
    const atRest = ds.find.mock.calls.length;

    await act(async () => { rerender([{ field: 'name', order: 'asc' }]); });
    await settle();

    expect(ds.find.mock.calls.length, 'an equal sort re-read the view').toBe(atRest);
  });
});
