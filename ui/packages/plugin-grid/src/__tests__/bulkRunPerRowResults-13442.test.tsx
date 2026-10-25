/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13442 — a 100-row bulk update took ~100 s in the console for ~19 s
 * of server work. Two defects compounded:
 *
 * 1. `bulkUpdate` threw away the server's per-row results, so a partial
 *    failure reached the dialog and the error CSV as one `batch_0` entry with
 *    no record id or reason. Apps needing the reason ran `batchSize: 1`.
 * 2. On that per-row path every `update()` emitted a mutation event, and every
 *    subscribed list refetched and re-rendered after each row.
 *
 * End to end over the parts the console wires: the REAL `ObjectStackAdapter`
 * and `@objectstack/client` (only `fetch` is stubbed, by a small server), the
 * REAL `useBulkExecutor`, and — for the refetch count — the REAL `ObjectGrid`
 * reading the data-invalidation bus behind the REAL
 * `useMutationInvalidationBridge`, the way `AppContent` mounts it. Every
 * subscriber of `onMutation` (ListView, ObjectView, kanban, calendar, this
 * bridge) refetches once per event it receives, so the count below is the
 * count each of them pays.
 *
 * ⚠️ The refetch count is only measurable the way a browser runs it. Inside
 * `act()` React holds every update of the callback and renders once at the
 * end, and a stub `fetch` that answers in microtasks finishes the whole run
 * before any render — either one alone collapses N refetches into one and
 * the pin passes with the defect present (measured: removing the executor's
 * scope left it green). So that run goes OUTSIDE `act`, with React on its
 * real scheduler, and each PATCH answers after a timer, as a network does.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { registerAllFields } from '@object-ui/fields';
import { useMutationInvalidationBridge } from '@object-ui/react';
import type { BulkActionDef } from '@object-ui/types';
import { ObjectGrid } from '../ObjectGrid';
import { useBulkExecutor } from '../hooks/useBulkExecutor';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});
afterEach(() => cleanup());

const OBJECT = 'ehr_order_13442';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * The fake server: a store, `PATCH /data/:object/:id` for the per-row path,
 * and `POST /data/:object/updateMany` answering a `BatchUpdateResponse` the
 * way the server does under `continueOnError: true`. A record listed in
 * `rejections` is refused with that reason on either path.
 */
function makeServer(count: number, rejections: Record<string, string> = {}) {
  const store: Record<string, Record<string, unknown>> = {};
  for (let i = 1; i <= count; i += 1) store[`r${i}`] = { id: `r${i}`, name: `Order ${i}`, push_now: false };
  const patches: string[] = [];
  const updateManyCalls: number[] = [];

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/api/v1/discovery')) {
      return json(200, { success: true, data: { capabilities: {}, routes: {} } });
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (method === 'POST' && url.endsWith(`/api/v1/data/${OBJECT}/updateMany`)) {
      updateManyCalls.push(body.records.length);
      let succeeded = 0;
      const results = body.records.map((rec: { id: string; data: Record<string, unknown> }, index: number) => {
        if (rejections[rec.id]) {
          return { id: rec.id, success: false, index, errors: [{ code: 'VALIDATION_FAILED', message: rejections[rec.id] }] };
        }
        store[rec.id] = { ...store[rec.id], ...rec.data };
        succeeded += 1;
        return { id: rec.id, success: true, index, data: { ...store[rec.id] } };
      });
      const failed = results.length - succeeded;
      return json(200, { success: failed === 0, operation: 'update', total: results.length, succeeded, failed, results });
    }
    const one = url.match(new RegExp(`/api/v1/data/${OBJECT}/([^/?]+)$`));
    if (method === 'PATCH' && one) {
      // A network round-trip: the answer lands in a later macrotask, so React
      // gets to render (and a subscribed list to refetch) between rows.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const id = decodeURIComponent(one[1]);
      patches.push(id);
      if (rejections[id]) return json(400, { success: false, error: rejections[id], code: 'VALIDATION_FAILED' });
      store[id] = { ...store[id], ...body };
      return json(200, { success: true, data: { object: OBJECT, id, record: { ...store[id] } } });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });

  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch, autoReconnect: false });

  // Reads are served from the store; every WRITE goes through the real adapter,
  // and so do its event door and its holding scope.
  const dataSource = {
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 200 };
    }),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, push_now: { type: 'boolean' } },
    })),
    update: (resource: string, id: string, data: Record<string, unknown>) => adapter.update(resource, id, data),
    delete: (resource: string, id: string) => adapter.delete(resource, id),
    bulkUpdate: (resource: string, ids: ReadonlyArray<string>, patch: Record<string, unknown>) =>
      adapter.bulkUpdate(resource, ids, patch),
    onMutation: (cb: Parameters<ObjectStackAdapter['onMutation']>[0]) => adapter.onMutation(cb),
    batchMutationEvents: <R,>(work: () => Promise<R>) => adapter.batchMutationEvents(work),
  };

  const rows = Object.values(store).map((r) => ({ ...r }));
  return { store, patches, updateManyCalls, dataSource, rows };
}

const pushNow = (op: Partial<BulkActionDef> = {}): BulkActionDef =>
  ({ name: 'push_now', operation: 'update', patch: { push_now: true }, ...op }) as BulkActionDef;

describe('a bulk run keeps each failed row and refreshes the list once (objectui#13442)', () => {
  it('a 2-failure updateMany answer reaches the result as 2 per-record errors with ids and messages', async () => {
    const server = makeServer(100, {
      r17: 'Discharge date is required before push',
      r58: 'Patient record is locked by another workflow',
    });
    const { result } = renderHook(() => useBulkExecutor({ resource: OBJECT, dataSource: server.dataSource }));

    await act(async () => {
      await result.current.run(pushNow({ batchSize: 100 }), server.rows, {});
    });

    // One request for the whole selection — the fast path, not 100 PATCHes.
    expect(server.updateManyCalls).toEqual([100]);
    expect(server.patches).toEqual([]);
    expect(result.current.result).toEqual({
      total: 100,
      succeeded: 98,
      failed: 2,
      errors: [
        { id: 'r17', error: 'Discharge date is required before push' },
        { id: 'r58', error: 'Patient record is locked by another workflow' },
      ],
    });
  });

  it('N per-row updates in one bulk run cost the bound list exactly ONE refetch', async () => {
    const N = 25;
    const server = makeServer(N, { r9: 'Discharge date is required before push' });

    function ConsoleLikeList() {
      useMutationInvalidationBridge(server.dataSource);
      return (
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: [{ field: 'name', label: 'Name' }],
            pagination: { pageSize: 200 },
          } as any}
          dataSource={server.dataSource as any}
        />
      );
    }
    render(<ConsoleLikeList />);
    await waitFor(() => expect(screen.getByText('Order 1')).toBeInTheDocument());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
    const before = server.dataSource.find.mock.calls.length;

    const { result } = renderHook(() => useBulkExecutor({ resource: OBJECT, dataSource: server.dataSource }));
    // `batchSize: 1` — the per-row path apps were pushed onto. Run the way a
    // browser runs it: outside `act`, on React's own scheduler (see header).
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      await result.current.run(pushNow({ batchSize: 1 }), server.rows, {});
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }

    expect(server.patches, 'every row went through its own PATCH').toHaveLength(N);
    expect(result.current.result?.errors).toEqual([
      { id: 'r9', error: 'Discharge date is required before push' },
    ]);
    expect(
      server.dataSource.find.mock.calls.length - before,
      `${N} per-row writes in one run must cost the list ONE refetch, not one per row`,
    ).toBe(1);
  });
});
