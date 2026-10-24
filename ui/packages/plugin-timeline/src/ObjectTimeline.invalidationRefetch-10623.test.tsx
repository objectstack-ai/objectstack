/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10623 — an `object-timeline` block re-reads its rows when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object it queries, and it does so in place.
 *
 * Before this card the fetch effect named no nonce, so a write declared on the
 * bus (a page action over raw HTTP, a flow, a server action) left the rail
 * stale until something remounted it. The effect now names the
 * `useDataInvalidation` nonce for the object it queries (the objectui#10494
 * shape).
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
// Registers `object-timeline` through this package's own entry.
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
  let title = 'Kickoff';
  return {
    rename(next: string) {
      title = next;
    },
    find: vi.fn(async () => ({ data: [{ id: '1', name: title, due: '2026-01-05' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'task', fields: { name: { type: 'text' }, due: { type: 'date' } } })),
  };
}

/** The positive control: a bare reader of the same object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('task');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderBlock = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const BLOCK = { type: 'object-timeline', objectName: 'task', timeline: { titleField: 'name', startDateField: 'due' } };

describe('object-timeline re-reads on the data-invalidation bus (objectui#10623)', () => {
  it('an unscoped change (objectName "*") re-runs its query once, in place', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await waitFor(() => expect(screen.getByText('Kickoff')).toBeTruthy());
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);
    const canvas = screen.getByTestId('timeline-canvas');

    ds.rename('Kickoff (moved)');
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.find, 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(screen.getByText('Kickoff (moved)')).toBeTruthy();
    // The re-read is in place: the same canvas node, so its scroll survives.
    expect(screen.getByTestId('timeline-canvas'), 'the canvas was remounted by the re-read').toBe(canvas);
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
      notifyDataChanged({ objectName: 'task', recordId: '1' });
    });
    await settle();
    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).toHaveBeenCalledTimes(2);
  });

  it('a block drawing authored items queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    renderBlock(
      { ...BLOCK, items: [{ title: 'Authored', time: '2026-01-05' }] },
      ds,
    );
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.find).not.toHaveBeenCalled();
  });
});
