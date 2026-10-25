/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10778 — an `object-pivot` block (`ObjectPivotTable`) re-reads the
 * rows it cross-tabs when the data-invalidation bus (`notifyDataChanged` from
 * `@object-ui/react`) reports a write to the object it queries, in place.
 *
 * Before this card the fetch effect named no nonce, so a write declared on the
 * bus (a page action over raw HTTP, a flow, a server action) left the pivot
 * stale until something remounted it — and `PageView`'s remount is what
 * objectui#10519 removes. The effect now names the `useDataInvalidation` nonce
 * for `schema.objectName` (the objectui#10623 shape). That one key covers both
 * spellings of the binding: a flat `objectName`, and the spec's per-element
 * `dataSource: { object }`, which `ObjectPivotBlock` binds onto `objectName`
 * before this component reads it.
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
// Registers `object-pivot` through this package's own entry.
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
  let amount = 3;
  return {
    bump(next: number) {
      amount = next;
    },
    find: vi.fn(async (_object: string, _query?: unknown) => ({ data: [{ id: '1', stage: 'won', region: 'EMEA', amount }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'deal',
      fields: { stage: { type: 'text' }, region: { type: 'text' }, amount: { type: 'number' } },
      listViews: {},
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

const PIVOT = { rowField: 'stage', columnField: 'region', valueField: 'amount', aggregation: 'sum' };
const BLOCK = { type: 'object-pivot', objectName: 'deal', ...PIVOT };

describe('object-pivot re-reads on the data-invalidation bus (objectui#10778)', () => {
  it('an unscoped change (objectName "*") re-runs its query once, in place', async () => {
    const ds = makeDataSource();
    const { container, getByTestId } = renderBlock(BLOCK, ds);
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);
    const table = container.querySelector('table');

    ds.bump(11);
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.find, 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('11');
    // The re-read is in place: the same table node, so its scroll survives.
    expect(container.querySelector('table'), 'the pivot was remounted by the re-read').toBe(table);
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

  it('a pivot bound through the element `dataSource: { object }` re-reads on that object', async () => {
    const ds = makeDataSource();
    renderBlock({ type: 'object-pivot', ...PIVOT, dataSource: { object: 'deal' } }, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();
    expect(ds.find.mock.calls[0][0]).toBe('deal');

    await act(async () => {
      notifyDataChanged({ objectName: 'deal' });
    });
    await settle();
    expect(ds.find, 'the element-bound pivot never re-read after its object changed').toHaveBeenCalledTimes(2);
  });

  it('a pivot over authored rows queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    const { getByTestId } = renderBlock(
      { ...BLOCK, data: [{ stage: 'won', region: 'APAC', amount: 5 }] },
      ds,
    );
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).not.toHaveBeenCalled();
  });
});
