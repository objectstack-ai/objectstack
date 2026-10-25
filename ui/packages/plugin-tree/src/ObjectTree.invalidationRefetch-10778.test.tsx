/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10778 — an `object-tree` block re-reads its rows when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object it queries, and it does so in place.
 *
 * Before this card the record effect named no nonce, so a write declared on the
 * bus (a page action over raw HTTP, a flow, a server action) left the tree
 * stale until something remounted it — and `PageView`'s remount is what
 * objectui#10519 removes. The effect now names the `useDataInvalidation` nonce
 * for the object its `object` provider queries (the objectui#10623 shape).
 *
 * How the tree names its object, one case each:
 *  - `objectName` on the node, folded to the `object` provider;
 *  - `data: { provider: 'object', object }` with no `objectName` (the provider
 *    config's own `object` is the one `find` names);
 *  - inline rows (`staticData`, or `{ provider: 'value', items }` under
 *    `data`) name no object and are not a query of the adapter: nothing to
 *    subscribe to (a bare array under `data` is not an inline spelling any
 *    more — objectui#8348 judges `data` against the block's published row,
 *    the `ViewData` union — so this case uses the row's `staticData` rung);
 *  - rows a HOST hands down as the `data` prop (the `list-view` seat) do not
 *    exempt it: the `object` arm runs its own full query ahead of them, so
 *    its freshness must not rest on the host's rows moving (a host that hands
 *    an equal re-read down as the same array never moves them).
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
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';
// Registers `object-tree` through this package's own entry.
import './index';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

function makeDataSource() {
  let rootName = 'Acme';
  return {
    rename(next: string) {
      rootName = next;
    },
    find: vi.fn(async (_object: string, _query?: unknown) => ({
      data: [
        { id: '1', name: rootName, parent_id: null },
        { id: '2', name: 'Engineering', parent_id: '1' },
      ],
      total: 2,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'category',
      fields: { name: { type: 'text' }, parent_id: { type: 'text' } },
    })),
  };
}

/** The positive control: a bare reader of the same object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('category');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderBlock = (
  schema: Record<string, unknown>,
  ds: ReturnType<typeof makeDataSource>,
  hostProps: Record<string, unknown> = {},
) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={schema as any} {...hostProps} />
    </SchemaRendererProvider>,
  );

const BLOCK = { type: 'object-tree', objectName: 'category', parentField: 'parent_id', labelField: 'name' };

describe('object-tree re-reads on the data-invalidation bus (objectui#10778)', () => {
  it('an unscoped change (objectName "*") re-runs its query once, in place', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);

    // The user flips the root's expansion: component state a remount would lose.
    const toggle = screen.getByRole('button', { name: /Expand|Collapse/ });
    const before = toggle.getAttribute('aria-label');
    await act(async () => {
      toggle.click();
    });
    const flipped = screen.getByRole('button', { name: /Expand|Collapse/ }).getAttribute('aria-label');
    expect(flipped).not.toBe(before);

    ds.rename('Acme (renamed)');
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.find, 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(screen.getByText('Acme (renamed)')).toBeTruthy();
    // The re-read is in place: the same component instance, so the user's
    // expansion choice survives it.
    expect(
      screen.getByRole('button', { name: /Expand|Collapse/ }).getAttribute('aria-label'),
      'the tree lost the user’s expansion choice: it was remounted by the re-read',
    ).toBe(flipped);
  });

  it('a change to its own object re-runs its query once; another object does not', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.find, 'a change to another object re-read this block').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'category', recordId: '2' });
    });
    await settle();
    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).toHaveBeenCalledTimes(2);
  });

  it('a tree bound through `data: { provider: "object" }` alone re-reads on that object', async () => {
    const ds = makeDataSource();
    const { objectName: _bound, ...rest } = BLOCK;
    renderBlock({ ...rest, data: { provider: 'object', object: 'category' } }, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();
    expect(ds.find.mock.calls[0][0]).toBe('category');

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'category' });
    });
    await settle();
    expect(ds.find, 'the provider-bound tree never re-read after its object changed').toHaveBeenCalledTimes(2);
  });

  it('a tree drawing inline rows queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    const inlineFind = vi.spyOn(ValueDataSource.prototype, 'find');
    const rows = [
      { id: '1', name: 'Inline root', parent_id: null },
      { id: '2', name: 'Inline child', parent_id: '1' },
    ];
    renderBlock({ ...BLOCK, staticData: rows }, ds);
    renderBlock({ type: 'object-tree', parentField: 'parent_id', labelField: 'name', data: { provider: 'value', items: rows } }, ds);
    await waitFor(() => expect(screen.getAllByText('Inline root')).toHaveLength(2));
    await settle();
    const inlineReadsOnMount = inlineFind.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getAllByTestId('bus-control').map((n) => n.textContent)).toEqual(['1', '1']);
    expect(ds.find).not.toHaveBeenCalled();
    expect(inlineFind.mock.calls.length, 'the inline tree re-ran its query on an invalidation').toBe(inlineReadsOnMount);
  });

  it('a tree whose host hands down rows still re-reads its own query', async () => {
    const ds = makeDataSource();
    // The host's rows do not move — the shape of a host that hands an equal
    // re-read down as the same array, whose projection need not carry what
    // changed.
    const hostRows = [{ id: '9', name: 'Host row' }];
    renderBlock(BLOCK, ds, { data: hostRows });
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find, 'the host-fed tree never re-ran its own query').toHaveBeenCalledTimes(2);
  });
});
