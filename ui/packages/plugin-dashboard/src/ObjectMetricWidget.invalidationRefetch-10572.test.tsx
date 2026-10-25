/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10572 — an `object-metric` block (`ObjectMetricWidget`) re-reads its value when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object it aggregates.
 *
 * Before this card a page action over raw HTTP (an `api` target, a flow, a
 * server action) fires no `onMutation`, so this block on a page learned of such
 * a write only because `PageView` remounted the whole page — the remount
 * objectui#10519 removes. Its fetch effect now names the
 * `useDataInvalidation` nonce for the object it queries (the objectui#10494
 * shape).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a fake data source that counts reads.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
// Registers `object-metric`.
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
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(),
    aggregate: vi.fn(async () => [{ amount: 7 }]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { amount: { type: 'number' } } })),
  };
}

const renderBlock = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const BLOCK = { type: 'object-metric', objectName: 'deal', aggregate: { field: 'amount', function: 'sum' }, label: 'Pipeline' };

describe('object-metric re-reads on the data-invalidation bus (objectui#10572)', () => {
  it('an unscoped change (objectName "*") re-runs its query once', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await settle();
    expect(ds.aggregate).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(ds.aggregate, 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
  });

  it('a change to its own object re-runs its query once; another object does not', async () => {
    const ds = makeDataSource();
    renderBlock(BLOCK, ds);
    await settle();
    expect(ds.aggregate).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.aggregate).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'deal', recordId: '1' });
    });
    await settle();
    expect(ds.aggregate).toHaveBeenCalledTimes(2);
  });
});
