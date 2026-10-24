/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10778 — an `object-data-table` block (`ObjectDataTable`) re-reads
 * its rows when the data-invalidation bus (`notifyDataChanged` from
 * `@object-ui/react`) reports a write to the object it queries, in place.
 *
 * Before this card the fetch effect named no nonce, so a write declared on the
 * bus (a page action over raw HTTP, a flow, a server action) left the table
 * stale until something remounted it — and `PageView`'s remount is what
 * objectui#10519 removes. The effect now names the `useDataInvalidation` nonce
 * for `schema.objectName` (the objectui#10623 shape).
 *
 * The same component is what a `dashboard` block draws for a table widget over
 * `{ provider: 'object' }`, and what every drill-down drawer in this package
 * lists its records with, so the dashboard case below rides the same reader.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source that counts reads. The bare
 * `useDataInvalidation` reader mounted beside the block is the positive
 * control: it proves the event reached subscribers in this harness, so a block
 * that did not re-read failed to listen rather than missed an event that never
 * came.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Side-effect imports at MODULE scope (AGENTS.md's flaky-test rule):
// `@object-ui/components` registers the `data-table` this widget renders onward,
// the package entry registers `object-data-table` and `dashboard`.
import '@object-ui/components';
import './index';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

function makeDataSource() {
  let name = 'Acme';
  return {
    rename(next: string) {
      name = next;
    },
    find: vi.fn(async (_object: string, _query?: unknown) => ({ data: [{ id: '1', name, amount: 3 }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'deal',
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
    })),
  };
}

/** The positive control: a bare reader of the same object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('deal');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderBlock = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const BLOCK = { type: 'object-data-table', objectName: 'deal', columns: [{ accessorKey: 'name', header: 'Name' }] };

describe('object-data-table re-reads on the data-invalidation bus (objectui#10778)', () => {
  it('an unscoped change (objectName "*") re-runs its query once, in place', async () => {
    const ds = makeDataSource();
    const { container, getByTestId, getByText } = renderBlock(BLOCK, ds);
    await waitFor(() => expect(getByText('Acme')).toBeTruthy());
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    ds.rename('Acme (renamed)');
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.find, 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(getByText('Acme (renamed)')).toBeTruthy();
    // The re-read is in place: the same table node, so its scroll and paging survive.
    expect(container.querySelector('table'), 'the table was remounted by the re-read').toBe(table);
  });

  it('a change to its own object re-runs its query once; another object does not', async () => {
    const ds = makeDataSource();
    const { getByTestId } = renderBlock(BLOCK, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.find, 'a change to another object re-read this block').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'deal', recordId: '1' });
    });
    await settle();
    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).toHaveBeenCalledTimes(2);
  });

  it('a table over authored rows queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    const { getByTestId } = renderBlock({ ...BLOCK, data: [{ id: '7', name: 'Authored' }] }, ds);
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('a `dashboard` block’s object-bound table widget re-reads through the same component', async () => {
    const ds = makeDataSource();
    const { getByTestId, getByText } = renderBlock(
      {
        type: 'dashboard',
        widgets: [{ id: 'deals', type: 'table', title: 'Deals', options: { data: { provider: 'object', object: 'deal' } } }],
      },
      ds,
    );
    await waitFor(() => expect(getByText('Acme')).toBeTruthy());
    await settle();
    const readsOnMount = ds.find.mock.calls.filter(([object]) => object === 'deal').length;
    expect(readsOnMount).toBe(1);

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(
      ds.find.mock.calls.filter(([object]) => object === 'deal').length,
      'the dashboard table widget never re-read after the bus reported a change',
    ).toBe(2);
  });
});
