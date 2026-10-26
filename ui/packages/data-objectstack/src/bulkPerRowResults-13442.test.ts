/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13442 — two halves of one slow bulk action.
 *
 * 1. `bulkUpdate` / `bulkDelete` keep each failed row's id and the server's
 *    reason. The server's `updateMany` / `deleteMany` with
 *    `continueOnError: true` already answer one `results[]` row per record,
 *    a failed one carrying `errors[].message`; the adapter read only
 *    `succeeded`, so the bulk dialog showed `batch_0: 2 records failed` and
 *    apps fell back to one-row batches to learn which rows and why.
 * 2. `batchMutationEvents` holds the per-write mutation events of a run and
 *    delivers them coalesced, so subscribed views refetch once per run, not
 *    once per row.
 *
 * What is real in the first half: the adapter AND `@objectstack/client`. Only
 * `fetch` is stubbed, answering the batch routes with a `BatchUpdateResponse`
 * (`@objectstack/spec/api`) shaped like the one the server builds under
 * `continueOnError: true` — a failed row keeps its `id` and request `index`.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import type { DataSourceMutationEvent } from '@object-ui/types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A real adapter over a stubbed `fetch` that answers one batch route. */
function adapterAnswering(route: 'updateMany' | 'deleteMany', answer: (body: any) => unknown) {
  const requests: Array<{ url: string; body: any }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/discovery')) {
      return json(200, { success: true, data: { capabilities: {}, routes: {} } });
    }
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && url.endsWith(`/${route}`)) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({ url, body });
      return json(200, answer(body));
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
  });
  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch, autoReconnect: false });
  return { adapter, requests };
}

describe('bulkUpdate keeps each failed row (objectui#13442)', () => {
  it('a 2-failure updateMany answer surfaces 2 per-record errors with their ids and messages', async () => {
    const ids = ['r1', 'r2', 'r3', 'r4', 'r5'];
    const reasons: Record<string, string> = {
      r2: 'Discharge date is required before push',
      r4: 'Patient record is locked by another workflow',
    };
    const { adapter, requests } = adapterAnswering('updateMany', (body) => {
      const results = body.records.map((rec: { id: string }, index: number) =>
        reasons[rec.id]
          ? { id: rec.id, success: false, index, errors: [{ code: 'VALIDATION_FAILED', message: reasons[rec.id] }] }
          : { id: rec.id, success: true, index, data: { id: rec.id } },
      );
      return { success: false, operation: 'update', total: ids.length, succeeded: 3, failed: 2, results };
    });

    const res = await adapter.bulkUpdate('ehr_order', ids, { push_now: true });

    expect(res).toEqual({
      succeeded: 3,
      errors: [
        { id: 'r2', error: 'Discharge date is required before push' },
        { id: 'r4', error: 'Patient record is locked by another workflow' },
      ],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      records: ids.map((id) => ({ id, data: { push_now: true } })),
      options: { continueOnError: true },
    });
  });

  it('attributes a failed row by its request index when it carries no id', async () => {
    // The spec's own partial-success example: the failed row has `index`
    // and `errors`, and no `id` ("Record ID if operation succeeded").
    const { adapter } = adapterAnswering('updateMany', () => ({
      success: false,
      operation: 'update',
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { id: 'a', success: true, index: 0 },
        { success: false, index: 1, errors: [{ code: 'validation_error', message: 'Invalid email format' }] },
      ],
    }));

    const res = await adapter.bulkUpdate('contact', ['a', 'b'], { email: 'x' });

    expect(res).toEqual({ succeeded: 1, errors: [{ id: 'b', error: 'Invalid email format' }] });
  });

  it('joins several reasons for one row', async () => {
    const { adapter } = adapterAnswering('updateMany', () => ({
      success: false,
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { id: 'a', success: true, index: 0 },
        {
          id: 'b',
          success: false,
          index: 1,
          errors: [
            { code: 'VALIDATION_FAILED', message: 'Amount must be positive' },
            { code: 'VALIDATION_FAILED', message: 'Currency is required' },
          ],
        },
      ],
    }));

    const res = await adapter.bulkUpdate('invoice', ['a', 'b'], { amount: -1 });

    expect(res.errors).toEqual([{ id: 'b', error: 'Amount must be positive; Currency is required' }]);
  });
});

describe('bulkDelete keeps each failed row (objectui#13442)', () => {
  it('reports a refused row with its reason, and a row the server kept with a generic one', async () => {
    const { adapter } = adapterAnswering('deleteMany', (body) => ({
      success: false,
      operation: 'delete',
      total: body.ids.length,
      succeeded: 1,
      failed: 2,
      results: [
        { id: 'a', success: true, index: 0 },
        { id: 'b', success: false, index: 1, errors: [{ code: 'FORBIDDEN', message: 'Cannot delete a closed order' }] },
        // `deleteMany`'s "matched, and deliberately NOT removed": no errors[].
        { id: 'c', success: false, index: 2 },
      ],
    }));

    const res = await adapter.bulkDelete('order', ['a', 'b', 'c']);

    expect(res).toEqual({
      succeeded: 1,
      errors: [
        { id: 'b', error: 'Cannot delete a closed order' },
        { id: 'c', error: 'Record was not deleted' },
      ],
    });
  });
});

/** An adapter whose client is a stub, for the event-holding half. */
function stubbedAdapter() {
  const adapter: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => json(200, { success: true, data: { capabilities: {}, routes: {} } })),
  });
  adapter.connected = true;
  adapter.connectionState = 'connected';
  adapter.client = {
    data: {
      update: vi.fn(async (_resource: string, id: string, data: Record<string, unknown>) => ({
        record: { id, ...data },
      })),
      create: vi.fn(async (_resource: string, data: Record<string, unknown>) => ({
        record: { id: 'new', ...data },
      })),
      delete: vi.fn(async () => ({ success: true })),
    },
  };
  const events: DataSourceMutationEvent[] = [];
  adapter.onMutation((e: DataSourceMutationEvent) => events.push(e));
  return { adapter: adapter as ObjectStackAdapter<any>, events };
}

describe('batchMutationEvents holds a run’s events and delivers them coalesced (objectui#13442)', () => {
  it('N updates in one scope reach subscribers as ONE resource-level event when it settles', async () => {
    const { adapter, events } = stubbedAdapter();
    const N = 50;

    let seenInside = -1;
    await adapter.batchMutationEvents(async () => {
      for (let i = 0; i < N; i += 1) await adapter.update('task', `r${i}`, { done: true });
      seenInside = events.length;
    });

    expect(seenInside, 'no event may reach a subscriber while the scope is open').toBe(0);
    expect(events).toEqual([{ type: 'update', resource: 'task' }]);
  });

  it('control: the same N updates outside a scope notify once per write', async () => {
    const { adapter, events } = stubbedAdapter();
    for (let i = 0; i < 50; i += 1) await adapter.update('task', `r${i}`, { done: true });
    expect(events).toHaveLength(50);
  });

  it('a single held event is delivered as it was, id and record intact', async () => {
    const { adapter, events } = stubbedAdapter();
    await adapter.batchMutationEvents(() => adapter.update('task', 'r1', { done: true }));
    expect(events).toEqual([{ type: 'update', resource: 'task', id: 'r1', record: { id: 'r1', done: true } }]);
  });

  it('coalesces per (type, resource), in the order each pair was first held', async () => {
    const { adapter, events } = stubbedAdapter();
    await adapter.batchMutationEvents(async () => {
      await adapter.update('task', 'r1', { done: true });
      await adapter.delete('note', 'n1');
      await adapter.update('task', 'r2', { done: true });
      await adapter.delete('note', 'n2');
      await adapter.create('task', { title: 'x' });
    });
    expect(events).toEqual([
      { type: 'update', resource: 'task' },
      { type: 'delete', resource: 'note' },
      { type: 'create', resource: 'task', record: { id: 'new', title: 'x' } },
    ]);
  });

  it('passes the result through, and still delivers when the work rejects', async () => {
    const { adapter, events } = stubbedAdapter();
    await expect(adapter.batchMutationEvents(async () => 42)).resolves.toBe(42);

    const boom = new Error('stopped half way');
    await expect(
      adapter.batchMutationEvents(async () => {
        await adapter.update('task', 'r1', { done: true });
        await adapter.update('task', 'r2', { done: true });
        throw boom;
      }),
    ).rejects.toBe(boom);
    // The two writes landed before the rejection, so their refresh is owed.
    expect(events).toEqual([{ type: 'update', resource: 'task' }]);
  });

  it('nested scopes deliver once, when the outermost settles', async () => {
    const { adapter, events } = stubbedAdapter();
    let afterInner = -1;
    await adapter.batchMutationEvents(async () => {
      await adapter.update('task', 'r1', { done: true });
      await adapter.batchMutationEvents(() => adapter.update('task', 'r2', { done: true }));
      afterInner = events.length;
      await adapter.update('task', 'r3', { done: true });
    });
    expect(afterInner).toBe(0);
    expect(events).toEqual([{ type: 'update', resource: 'task' }]);
  });
});
