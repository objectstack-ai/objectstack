/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10572 — a `list-view` block re-reads its rows when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object it queries.
 *
 * Before this card the list's only refresh inputs were `refreshTrigger`, the
 * imperative `refresh()` and `dataSource.onMutation`. A page action over raw
 * HTTP (an `api` target, a flow, a server action) fires no `onMutation`, so the
 * list on a page learned of such a write only because `PageView` remounted the
 * whole page — the remount objectui#10519 removes.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source that counts reads.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
// Registers `list-view` (and `view:list`).
import '../index';

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
  return {
    find: vi.fn(async () => ({ data: [{ id: '1', name: 'Acme' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'account', fields: { name: { type: 'text', label: 'Name' } } })),
  };
}

const renderBlock = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const LIST = { type: 'list-view', data: { provider: 'object', object: 'account' }, columns: ['name'] };

describe('list-view re-reads on the data-invalidation bus (objectui#10572)', () => {
  it('an unscoped change (objectName "*") re-runs its query once', async () => {
    const ds = makeDataSource();
    renderBlock(LIST, ds);
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(ds.find, 'the list never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
  });

  it('a change to its own object re-runs its query once; another object does not', async () => {
    const ds = makeDataSource();
    renderBlock(LIST, ds);
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'account', recordId: '1' });
    });
    await settle();
    expect(ds.find).toHaveBeenCalledTimes(2);
  });

  it('a list drawing inline rows queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    renderBlock({ ...LIST, data: [{ id: '1', name: 'Inline' }] }, ds);
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(ds.find).not.toHaveBeenCalled();
  });
});
