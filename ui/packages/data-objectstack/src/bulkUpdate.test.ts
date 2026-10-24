/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/**
 * Build a DataSource instance with a stubbed `fetch` that satisfies the
 * one-shot discovery probe inside `connect()`. The client object is then
 * swapped out for a lightweight mock so we can assert directly against
 * the `updateMany` / `update` calls without spinning real HTTP.
 */
function makeDS(stub: { updateMany?: any; update?: any }) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (_url: any, _init: any) => {
      const body = { success: true, data: { capabilities: {}, routes: {} } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  });
  // Pre-mark connected so connect() short-circuits without hitting fetch.
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: stub };
  return ds;
}

describe('ObjectStackDataSource.bulkUpdate', () => {
  it('returns 0 and skips network when ids is empty', async () => {
    const updateMany = vi.fn();
    const ds = makeDS({ updateMany });
    const n = await ds.bulkUpdate('sys_notification', [], { is_read: true });
    expect(n).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('issues a single updateMany call with the per-id record shape', async () => {
    const updateMany = vi.fn().mockResolvedValue({ succeeded: 3, failed: 0, results: [] });
    const ds = makeDS({ updateMany });
    const n = await ds.bulkUpdate('sys_notification', ['a', 'b', 'c'], {
      is_read: true,
      read_at: '2026-05-23T05:00:00.000Z',
    });
    expect(n).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [resource, records, opts] = updateMany.mock.calls[0];
    expect(resource).toBe('sys_notification');
    expect(opts).toEqual({ continueOnError: true });
    expect(records).toEqual([
      { id: 'a', data: { is_read: true, read_at: '2026-05-23T05:00:00.000Z' } },
      { id: 'b', data: { is_read: true, read_at: '2026-05-23T05:00:00.000Z' } },
      { id: 'c', data: { is_read: true, read_at: '2026-05-23T05:00:00.000Z' } },
    ]);
  });

  it('honors server-reported partial success counts', async () => {
    const updateMany = vi.fn().mockResolvedValue({ succeeded: 2, failed: 1, results: [] });
    const ds = makeDS({ updateMany });
    const n = await ds.bulkUpdate('sys_notification', ['a', 'b', 'c'], { is_read: true });
    expect(n).toBe(2);
  });

  it('falls back to per-id updates when client.data.updateMany is missing', async () => {
    const update = vi.fn().mockResolvedValue({ record: {} });
    const ds = makeDS({ update });
    const n = await ds.bulkUpdate('sys_notification', ['a', 'b'], { is_read: true });
    expect(n).toBe(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0]).toBe('sys_notification');
    expect(update.mock.calls[0][1]).toBe('a');
    expect(update.mock.calls[0][2]).toEqual({ is_read: true });
  });

  it('fallback path tolerates per-row failures (continueOnError semantics)', async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ record: {} })
      .mockRejectedValueOnce(new Error('row 2 failed'))
      .mockResolvedValueOnce({ record: {} });
    const ds = makeDS({ update });
    const n = await ds.bulkUpdate('sys_notification', ['a', 'b', 'c'], { is_read: true });
    expect(n).toBe(2);
    expect(update).toHaveBeenCalledTimes(3);
  });
});
