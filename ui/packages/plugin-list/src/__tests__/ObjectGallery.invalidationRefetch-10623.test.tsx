/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10623 — an `object-gallery` block re-reads its cards when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object it queries, and it does so in place.
 *
 * Before this card the fetch effect named no nonce, so a write declared on the
 * bus (a page action over raw HTTP, a flow, a server action) left the cards
 * stale until something remounted the gallery. The effect now names the
 * `useDataInvalidation` nonce for the object it queries (the objectui#10494
 * shape).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source that counts reads. The bare
 * `useDataInvalidation` reader mounted beside the block is the positive
 * control: it proves the event reached subscribers in this harness.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Registers `object-gallery` (the registration sits in the component module).
import '../ObjectGallery';

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
  let wonName = 'Globex';
  return {
    rename(next: string) {
      wonName = next;
    },
    find: vi.fn(async () => ({
      data: [
        { id: '1', name: 'Acme', status: 'open' },
        { id: '2', name: wonName, status: 'won' },
      ],
      total: 2,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { name: { type: 'text' }, status: { type: 'text' } } })),
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

const BLOCK = { type: 'object-gallery', objectName: 'deal', gallery: { titleField: 'name' } };

describe('object-gallery re-reads on the data-invalidation bus (objectui#10623)', () => {
  it('an unscoped change (objectName "*") re-runs its query once, and a collapsed group stays collapsed', async () => {
    const ds = makeDataSource();
    renderBlock({ ...BLOCK, grouping: { fields: [{ field: 'status' }] } }, ds);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);

    // Local UI state the re-read must not reset: collapse the `open` group.
    fireEvent.click(screen.getByRole('button', { name: /open/ }));
    expect(screen.queryByText('Acme')).toBeNull();

    ds.rename('Globex (renamed)');
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.find, 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(screen.getByText('Globex (renamed)')).toBeTruthy();
    expect(screen.queryByText('Acme'), 'the re-read reset the collapsed group').toBeNull();
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
      notifyDataChanged({ objectName: 'deal', recordId: '2' });
    });
    await settle();
    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).toHaveBeenCalledTimes(2);
  });

  it('a block drawing inline rows queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    renderBlock({ ...BLOCK, data: [{ id: '9', name: 'Inline', status: 'open' }] }, ds);
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).not.toHaveBeenCalled();
  });
});
